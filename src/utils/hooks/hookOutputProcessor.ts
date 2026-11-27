import type { ToolUseContext } from '../../Tool.js'
import {
  type HookCallback,
  isAsyncHookJSONOutput,
  type PermissionRequestResult,
} from '../../types/hooks.js'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage } from '../attachments.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
import { jsonStringify } from '../slowOperations.js'
import {
  escapeSystemReminderTags,
  type TypedSyncHookOutput,
} from './hookCore.js'
import type {
  AggregatedHookResult,
  ElicitationResponse,
  HookResult,
} from './hookTypes.js'
import type { FunctionHook } from './sessionHooks.js'
import {
  parseAllowedTerminalSequence,
  rejectedTerminalSequenceMessage,
} from './terminalSequence.js'
import type {
  HookEvent,
  HookInput,
  SyncHookJSONOutput,
} from 'src/entrypoints/agentSdkTypes.js'

export function classicResultFields(key: string, event: HookEvent): string[] {
  switch (key) {
    case 'block':
      return event === 'PreModelSwitch'
        ? ['blockingError']
        : [
            'blockingError',
            'permissionBehavior',
            'hookPermissionDecisionReason',
          ]
    case 'additionalContext':
      return ['additionalContexts']
    case 'permissionDecision':
    case 'permissionDecisionReason':
      return ['permissionBehavior', 'hookPermissionDecisionReason']
    case 'decision':
      return ['permissionRequestResult', 'permissionBehavior', 'updatedInput']
    case 'delta':
      return ['displayContent']
    case 'additionalContexts':
    case 'permissionBehavior':
    case 'hookPermissionDecisionReason':
    case 'permissionRequestResult':
    case 'updatedInput':
    case 'preventContinuation':
    case 'stopReason':
    case 'sessionTitle':
    case 'suppressOriginalPrompt':
    case 'initialUserMessage':
    case 'watchPaths':
    case 'reloadSkills':
    case 'updatedToolOutput':
    case 'updatedMCPToolOutput':
    case 'retry':
    case 'displayContent':
      return [key]
    default:
      return []
  }
}

export function projectClassicHookResults(
  results: AggregatedHookResult[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  const ranks: Record<string, number> = { allow: 1, ask: 2, deny: 3 }
  for (const result of results) {
    if (result.blockingError)
      projected.block = result.blockingError.blockingError
    if (result.additionalContexts?.length) {
      projected.additionalContext = [
        ...((projected.additionalContext as string[] | undefined) ?? []),
        ...result.additionalContexts,
      ]
    }
    if (result.watchPaths?.length) {
      projected.watchPaths = [
        ...((projected.watchPaths as string[] | undefined) ?? []),
        ...result.watchPaths,
      ]
    }
    if (result.permissionBehavior && ranks[result.permissionBehavior]) {
      const previous = projected.permissionDecision as string | undefined
      if (
        (ranks[result.permissionBehavior] ?? 0) >= (ranks[previous ?? ''] ?? 0)
      ) {
        projected.permissionDecision = result.permissionBehavior
        projected.permissionDecisionReason = result.hookPermissionDecisionReason
      }
    }
    if (result.permissionRequestResult && projected.decision === undefined) {
      projected.decision = result.permissionRequestResult
    }
    for (const key of [
      'preventContinuation',
      'stopReason',
      'initialUserMessage',
      'sessionTitle',
      'suppressOriginalPrompt',
      'reloadSkills',
      'updatedToolOutput',
      'updatedMCPToolOutput',
      'retry',
      'displayContent',
    ] as const) {
      if (result[key] !== undefined) projected[key] = result[key]
    }
  }
  return projected
}

export function processHookJSONOutput({
  json: rawJson,
  command,
  hookName,
  toolUseID,
  hookEvent,
  expectedHookEvent,
  stdout,
  stderr,
  exitCode,
  durationMs,
}: {
  json: SyncHookJSONOutput
  command: string
  hookName: string
  toolUseID: string
  hookEvent: HookEvent
  expectedHookEvent?: HookEvent
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
}): Partial<HookResult> {
  const result: Partial<HookResult> = {}

  // Cast to typed interface for type-safe property access
  const rawTyped = rawJson as TypedSyncHookOutput

  // Official 2.1.328 tne / l$o (chunk@294254613.js:4252516): if a hook already
  // blocked (decision === 'block' or continue === false) and emitted a
  // hookSpecificOutput naming a different event, drop hookSpecificOutput and
  // preserve the security block instead of throwing and discarding the block.
  const dropMismatchedHookSpecificOutput =
    expectedHookEvent !== undefined &&
    expectedHookEvent !== 'PermissionRequest' &&
    (rawTyped.decision === 'block' || rawTyped.continue === false) &&
    rawTyped.hookSpecificOutput !== undefined &&
    rawTyped.hookSpecificOutput.hookEventName !== expectedHookEvent
  if (dropMismatchedHookSpecificOutput) {
    logForDebugging(
      `Hook ${hookName} blocked, but its hookSpecificOutput was ignored because it names ${rawTyped.hookSpecificOutput?.hookEventName}, not ${expectedHookEvent}. Set hookEventName to ${expectedHookEvent} to use it.`,
      { level: 'warn' },
    )
    result.suppressOriginalPrompt = true
  }

  const json: TypedSyncHookOutput = dropMismatchedHookSpecificOutput
    ? { ...rawTyped, hookSpecificOutput: undefined }
    : rawTyped

  // At this point we know it's a sync response
  const syncJson = json

  // Handle common elements
  if (syncJson.continue === false) {
    result.preventContinuation = true
    if (syncJson.stopReason) {
      result.stopReason = syncJson.stopReason
    }
  }

  if (json.decision) {
    switch (json.decision) {
      case 'approve':
        result.permissionBehavior = 'allow'
        break
      case 'block':
        // Official 2.1.326 #296: `"decision": "block"` sets deny + reason +
        // blockingError and cannot be downgraded by a weaker permissionDecision.
        result.permissionBehavior = 'deny'
        result.hookPermissionDecisionReason = json.reason || 'Blocked by hook'
        result.blockingError = {
          blockingError: json.reason || 'Blocked by hook',
          command,
        }
        break
      default:
        // Handle unknown decision types as errors
        throw new Error(
          `Unknown hook decision type: ${json.decision}. Valid types are: approve, block`,
        )
    }
  }

  // Handle systemMessage field
  if (json.systemMessage) {
    result.systemMessage = json.systemMessage
  }

  if (json.terminalSequence) {
    const allowed = parseAllowedTerminalSequence(json.terminalSequence)
    if (allowed !== null) {
      result.terminalSequence = allowed
    } else {
      logForDebugging(rejectedTerminalSequenceMessage(hookName, hookEvent))
    }
  }

  // Handle PreToolUse specific
  if (
    json.hookSpecificOutput?.hookEventName === 'PreToolUse' &&
    json.hookSpecificOutput.permissionDecision
  ) {
    // Official 2.1.326 #296: If top-level `"decision": "block"` was already
    // emitted, keep the block rather than downgrading to allow/ask/defer.
    const alreadyBlocked = json.decision === 'block'
    switch (json.hookSpecificOutput.permissionDecision) {
      case 'allow':
        if (!alreadyBlocked) {
          result.permissionBehavior = 'allow'
        }
        break
      case 'deny':
        result.permissionBehavior = 'deny'
        result.blockingError = {
          blockingError:
            json.hookSpecificOutput.permissionDecisionReason ||
            json.reason ||
            'Blocked by hook',
          command,
        }
        break
      case 'ask':
        if (!alreadyBlocked) {
          result.permissionBehavior = 'ask'
        }
        break
      case 'defer':
        if (!alreadyBlocked) {
          result.permissionBehavior = 'defer'
        }
        break
      default:
        // Handle unknown decision types as errors
        throw new Error(
          `Unknown hook permissionDecision type: ${json.hookSpecificOutput.permissionDecision}. Valid types are: allow, deny, ask, defer`,
        )
    }
  }
  if (result.permissionBehavior !== undefined && json.reason !== undefined) {
    result.hookPermissionDecisionReason = json.reason
  }

  // Handle hookSpecificOutput
  if (json.hookSpecificOutput) {
    // Validate hook event name matches expected if provided
    if (
      expectedHookEvent &&
      json.hookSpecificOutput.hookEventName !== expectedHookEvent
    ) {
      throw new Error(
        `Hook returned incorrect event name: expected '${expectedHookEvent}' but got '${json.hookSpecificOutput.hookEventName}'. Full stdout: ${jsonStringify(json, null, 2)}`,
      )
    }

    switch (json.hookSpecificOutput.hookEventName) {
      case 'PreToolUse': {
        // PreToolUse permissionDecision is already resolved above with the
        // `alreadyBlocked` guard so top-level `decision: 'block'` can never be
        // downgraded to 'allow'/'ask'/'defer'. Preserve any block reason when
        // a weaker permissionDecision was ignored or permissionDecisionReason
        // is omitted.
        const downgradedFromBlock =
          json.decision === 'block' &&
          json.hookSpecificOutput.permissionDecision !== undefined &&
          json.hookSpecificOutput.permissionDecision !== 'deny'
        if (!downgradedFromBlock) {
          result.hookPermissionDecisionReason =
            json.hookSpecificOutput.permissionDecisionReason ??
            result.hookPermissionDecisionReason
        }
        // Extract updatedInput if provided
        if (json.hookSpecificOutput.updatedInput) {
          result.updatedInput = json.hookSpecificOutput.updatedInput
        }
        // Extract additionalContext if provided
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      }
      case 'UserPromptSubmit':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        result.sessionTitle = json.hookSpecificOutput.sessionTitle
        result.suppressOriginalPrompt =
          json.hookSpecificOutput.suppressOriginalPrompt
        break
      case 'UserPromptExpansion':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        result.suppressOriginalPrompt =
          json.hookSpecificOutput.suppressOriginalPrompt
        break
      case 'SessionStart':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        result.initialUserMessage = json.hookSpecificOutput.initialUserMessage
        result.sessionTitle = json.hookSpecificOutput.sessionTitle
        result.reloadSkills = json.hookSpecificOutput.reloadSkills
        if (
          'watchPaths' in json.hookSpecificOutput &&
          json.hookSpecificOutput.watchPaths
        ) {
          result.watchPaths = json.hookSpecificOutput.watchPaths
        }
        break
      case 'Setup':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'PreModelSwitch':
        if (json.hookSpecificOutput.permissionDecision) {
          switch (json.hookSpecificOutput.permissionDecision) {
            case 'allow':
              result.permissionBehavior = 'allow'
              break
            case 'deny':
              result.permissionBehavior = 'deny'
              result.blockingError = {
                blockingError:
                  json.hookSpecificOutput.permissionDecisionReason ||
                  json.reason ||
                  'Blocked by hook',
                command,
              }
              break
            case 'ask':
              result.permissionBehavior = 'ask'
              break
          }
        }
        if (json.hookSpecificOutput.permissionDecisionReason !== undefined) {
          result.hookPermissionDecisionReason =
            json.hookSpecificOutput.permissionDecisionReason
        }
        break
      case 'PostModelSwitch':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'SubagentStart':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'PostToolUse':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        if (json.hookSpecificOutput.updatedToolOutput !== undefined) {
          result.updatedToolOutput = json.hookSpecificOutput.updatedToolOutput
        }
        if (json.hookSpecificOutput.updatedMCPToolOutput) {
          result.updatedMCPToolOutput =
            json.hookSpecificOutput.updatedMCPToolOutput
        } else if (json.hookSpecificOutput.updatedMCPToolOutput !== undefined) {
          result.legacyMcpRewriteSuppressed = true
        }
        result.classifierContext = json.hookSpecificOutput.classifierContext
        break
      case 'PostToolUseFailure':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'PostToolBatch':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'Stop':
      case 'SubagentStop':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'PermissionDenied':
        result.retry = json.hookSpecificOutput.retry
        break
      case 'PermissionRequest':
        // Extract the permission request decision
        if (json.hookSpecificOutput.decision) {
          result.permissionRequestResult = json.hookSpecificOutput.decision
          // Also update permissionBehavior for consistency
          result.permissionBehavior =
            json.hookSpecificOutput.decision.behavior === 'allow'
              ? 'allow'
              : 'deny'
          if (
            json.hookSpecificOutput.decision.behavior === 'allow' &&
            json.hookSpecificOutput.decision.updatedInput
          ) {
            result.updatedInput = json.hookSpecificOutput.decision.updatedInput
          }
        }
        break
      case 'Elicitation':
        if (json.hookSpecificOutput.action) {
          result.elicitationResponse = {
            action: json.hookSpecificOutput.action,
            content: json.hookSpecificOutput.content as
              | ElicitationResponse['content']
              | undefined,
          }
          if (json.hookSpecificOutput.action === 'decline') {
            result.blockingError = {
              blockingError: json.reason || 'Elicitation denied by hook',
              command,
            }
          }
        }
        break
      case 'ElicitationResult':
        if (json.hookSpecificOutput.action) {
          result.elicitationResultResponse = {
            action: json.hookSpecificOutput.action,
            content: json.hookSpecificOutput.content as
              | ElicitationResponse['content']
              | undefined,
          }
          if (json.hookSpecificOutput.action === 'decline') {
            result.blockingError = {
              blockingError:
                json.reason || 'Elicitation result blocked by hook',
              command,
            }
          }
        }
        break
      // densable 2.1.222 MessageDisplay — displayContent replaces streaming chunk
      case 'MessageDisplay':
        if (json.hookSpecificOutput.displayContent !== undefined) {
          result.displayContent = json.hookSpecificOutput.displayContent
        }
        break
    }
  }

  if (result.additionalContext !== undefined) {
    result.additionalContext = escapeSystemReminderTags(
      result.additionalContext,
    )
  }
  if (result.blockingError !== undefined) {
    result.blockingError = {
      ...result.blockingError,
      blockingError: escapeSystemReminderTags(
        result.blockingError.blockingError,
      ),
    }
  }
  if (result.systemMessage !== undefined) {
    result.systemMessage = escapeSystemReminderTags(result.systemMessage)
  }

  return {
    ...result,
    message: result.blockingError
      ? createAttachmentMessage({
          type: 'hook_blocking_error',
          hookName,
          toolUseID,
          hookEvent,
          blockingError: result.blockingError,
        })
      : createAttachmentMessage({
          type: 'hook_success',
          hookName,
          toolUseID,
          hookEvent,
          // JSON-output hooks inject context via additionalContext →
          // hook_additional_context, not this field. Empty content suppresses
          // the trivial "X hook success: Success" system-reminder that
          // otherwise pollutes every turn (messages.ts:3577 skips on '').
          content: '',
          stdout,
          stderr,
          exitCode,
          command,
          durationMs,
        }),
  }
}

const CLASSIC_HOOK_PINNED_FIELDS = [
  'hook_event_name',
  'session_id',
  'transcript_path',
  'cwd',
  'scratchpad_dir',
  'prompt_id',
  'permission_mode',
  'agent_id',
  'agent_type',
  'served_call',
  'caller_session_id',
  'effort',
] as const

const CLASSIC_ALLOWED_UPDATED_PERMISSION_DESTINATIONS = new Set([
  'userSettings',
  'projectSettings',
  'localSettings',
  'session',
  'cliArg',
])

const CLASSIC_ALLOWED_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
])

function checkClassicUpdatedPermissionEntry(
  entry: unknown,
): string | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return 'an updatedPermissions entry that is not an object'
  }
  const rec = entry as Record<string, unknown>
  if (
    typeof rec.destination !== 'string' ||
    !CLASSIC_ALLOWED_UPDATED_PERMISSION_DESTINATIONS.has(rec.destination)
  ) {
    return 'an updatedPermissions entry with an unknown destination'
  }
  switch (rec.type) {
    case 'addRules':
    case 'replaceRules':
    case 'removeRules':
      return (rec.behavior === 'allow' ||
        rec.behavior === 'deny' ||
        rec.behavior === 'ask') &&
        Array.isArray(rec.rules) &&
        rec.rules.every(
          r =>
            r !== null &&
            typeof r === 'object' &&
            !Array.isArray(r) &&
            typeof (r as Record<string, unknown>).toolName === 'string' &&
            ((r as Record<string, unknown>).ruleContent === undefined ||
              typeof (r as Record<string, unknown>).ruleContent === 'string'),
        )
        ? undefined
        : `an updatedPermissions ${rec.type} without rules and a behavior`
    case 'setMode':
      return typeof rec.mode === 'string' &&
        CLASSIC_ALLOWED_PERMISSION_MODES.has(rec.mode)
        ? undefined
        : 'an updatedPermissions setMode with an unknown mode'
    case 'addDirectories':
    case 'removeDirectories':
      return Array.isArray(rec.directories) &&
        rec.directories.every(d => typeof d === 'string')
        ? undefined
        : `an updatedPermissions ${rec.type} without directories`
    default:
      return 'an updatedPermissions entry of an unknown type'
  }
}

function checkClassicDecisionObject(decision: unknown): string | undefined {
  if (decision === undefined) return undefined
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return 'a decision that is not an object'
  }
  const rec = decision as Record<string, unknown>
  if (rec.behavior === 'deny') {
    return (rec.message === undefined || typeof rec.message === 'string') &&
      (rec.interrupt === undefined || typeof rec.interrupt === 'boolean')
      ? undefined
      : 'a deny decision whose message or interrupt has the wrong type'
  }
  if (rec.behavior !== 'allow') {
    return 'a decision whose behavior is not allow or deny'
  }
  if (
    rec.updatedInput !== undefined &&
    (!rec.updatedInput ||
      typeof rec.updatedInput !== 'object' ||
      Array.isArray(rec.updatedInput))
  ) {
    return 'an allow decision whose updatedInput is not an object'
  }
  if (rec.updatedPermissions === undefined) return undefined
  if (!Array.isArray(rec.updatedPermissions)) {
    return 'an allow decision whose updatedPermissions is not a list'
  }
  for (const item of rec.updatedPermissions) {
    const problem = checkClassicUpdatedPermissionEntry(item)
    if (problem !== undefined) return problem
  }
  return undefined
}

/** densable Zer — pin read-only classic fields across next() and validate return fields. */
export const CLASSIC_HOOK_HOP_SITE = {
  checkArgument(
    passed: Record<string, unknown>,
    original: Record<string, unknown>,
  ): string | undefined {
    for (const key of CLASSIC_HOOK_PINNED_FIELDS) {
      if (JSON.stringify(passed[key]) !== JSON.stringify(original[key])) {
        return `a changed ${key} (pinned)`
      }
    }
    return undefined
  },
  check(returned: unknown): string | undefined {
    if (!returned || typeof returned !== 'object' || Array.isArray(returned)) {
      return 'a non-object result'
    }
    const rec = returned as Record<string, unknown>
    const badFields = [
      ...[
        'block',
        'stopReason',
        'sessionTitle',
        'initialUserMessage',
        'displayContent',
        'permissionDecisionReason',
        'worktreePath',
      ].filter(k => rec[k] !== undefined && typeof rec[k] !== 'string'),
      ...[
        'preventContinuation',
        'suppressOriginalPrompt',
        'reloadSkills',
        'retry',
      ].filter(k => rec[k] !== undefined && rec[k] !== true),
      ...['additionalContext', 'watchPaths'].filter(
        k =>
          rec[k] !== undefined &&
          !(
            typeof rec[k] === 'string' ||
            (Array.isArray(rec[k]) && rec[k].every(s => typeof s === 'string'))
          ),
      ),
    ]
    if (badFields.length > 0) {
      return `${badFields.join(', ')} of the wrong type`
    }
    const pd = rec.permissionDecision
    if (pd !== undefined && pd !== 'allow' && pd !== 'deny' && pd !== 'ask') {
      return 'a permissionDecision that is not allow, deny or ask'
    }
    return checkClassicDecisionObject(rec.decision)
  },
}

const PERMISSION_DECISION_RANK: Readonly<Record<string, number>> = {
  allow: 1,
  ask: 2,
  deny: 3,
}

/** densable Vlt + Xlt — stricter permissionDecision wins; non-decision managed fields persist. */
export function mergeManagedAndDownstreamClassicEvent(
  managedResult: Record<string, unknown>,
  downstreamEvent: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...downstreamEvent }
  const rank = (val: unknown): number =>
    typeof val === 'string' ? (PERMISSION_DECISION_RANK[val] ?? 0) : 0
  const downstreamStricter =
    rank(downstreamEvent.permissionDecision) >
    rank(managedResult.permissionDecision)
  const [winner, loser] = downstreamStricter
    ? [downstreamEvent, managedResult]
    : [managedResult, downstreamEvent]
  if (winner.permissionDecision !== undefined) {
    merged.permissionDecision = winner.permissionDecision
    const reason =
      winner.permissionDecisionReason ??
      (winner.permissionDecision === loser.permissionDecision
        ? loser.permissionDecisionReason
        : undefined)
    if (reason !== undefined) {
      merged.permissionDecisionReason = reason
    } else {
      delete merged.permissionDecisionReason
    }
  }
  const managedDecision = managedResult.decision as
    | PermissionRequestResult
    | undefined
  const downstreamDecision = downstreamEvent.decision as
    | PermissionRequestResult
    | undefined
  if (downstreamDecision?.behavior === 'deny') {
    merged.decision = downstreamDecision
  } else if (managedDecision !== undefined) {
    merged.decision = managedDecision
  }
  for (const key of ['additionalContext', 'watchPaths'] as const) {
    const mArr = Array.isArray(managedResult[key])
      ? managedResult[key]
      : typeof managedResult[key] === 'string'
        ? [managedResult[key]]
        : []
    const dArr = Array.isArray(downstreamEvent[key])
      ? downstreamEvent[key]
      : typeof downstreamEvent[key] === 'string'
        ? [downstreamEvent[key]]
        : []
    if (mArr.length > 0 || dArr.length > 0) {
      merged[key] = [...mArr, ...dArr]
    }
  }
  const decisionKeys = new Set([
    'additionalContext',
    'watchPaths',
    'permissionDecision',
    'permissionDecisionReason',
    'decision',
  ])
  for (const [key, val] of Object.entries(managedResult)) {
    if (!decisionKeys.has(key) && val !== undefined) {
      merged[key] = val
    }
  }
  return merged
}

export async function executeFunctionHook({
  hook,
  messages,
  hookName,
  toolUseID,
  hookEvent,
  timeoutMs,
  signal,
}: {
  hook: FunctionHook
  messages: Message[]
  hookName: string
  toolUseID: string
  hookEvent: HookEvent
  timeoutMs: number
  signal?: AbortSignal
}): Promise<HookResult> {
  const callbackTimeoutMs = hook.timeout ?? timeoutMs
  const { signal: abortSignal, cleanup } = createCombinedAbortSignal(signal, {
    timeoutMs: callbackTimeoutMs,
  })

  try {
    // Check if already aborted
    if (abortSignal.aborted) {
      cleanup()
      return {
        outcome: 'cancelled',
        hook,
      }
    }

    // Execute callback with abort signal
    const passed = await new Promise<boolean>((resolve, reject) => {
      // Handle abort signal
      const onAbort = () => reject(new Error('Function hook cancelled'))
      abortSignal.addEventListener('abort', onAbort)

      // Execute callback
      Promise.resolve(hook.callback(messages, abortSignal))
        .then(result => {
          abortSignal.removeEventListener('abort', onAbort)
          resolve(result)
        })
        .catch(error => {
          abortSignal.removeEventListener('abort', onAbort)
          reject(error)
        })
    })

    cleanup()

    if (passed) {
      return {
        outcome: 'success',
        hook,
      }
    }
    return {
      blockingError: {
        blockingError: hook.errorMessage,
        command: 'function',
      },
      outcome: 'blocking',
      hook,
    }
  } catch (error) {
    cleanup()

    // Handle cancellation
    if (
      error instanceof Error &&
      (error.message === 'Function hook cancelled' ||
        error.name === 'AbortError')
    ) {
      return {
        outcome: 'cancelled',
        hook,
      }
    }

    // Log for monitoring
    logError(error)
    return {
      message: createAttachmentMessage({
        type: 'hook_error_during_execution',
        hookName,
        toolUseID,
        hookEvent,
        content:
          error instanceof Error
            ? error.message
            : 'Function hook execution error',
      }),
      outcome: 'non_blocking_error',
      hook,
    }
  }
}

export async function executeHookCallback({
  toolUseID,
  hook,
  hookEvent,
  hookInput,
  signal,
  hookIndex,
  toolUseContext,
}: {
  toolUseID: string
  hook: HookCallback
  hookEvent: HookEvent
  hookInput: HookInput
  signal: AbortSignal
  hookIndex?: number
  toolUseContext?: ToolUseContext
}): Promise<HookResult> {
  // Create context for callbacks that need state access
  const context = toolUseContext
    ? {
        getAppState: toolUseContext.getAppState,
      }
    : undefined
  const json = await hook.callback(
    hookInput,
    toolUseID,
    signal,
    hookIndex,
    context,
  )
  if (isAsyncHookJSONOutput(json)) {
    return {
      outcome: 'success',
      hook,
    }
  }

  const processed = processHookJSONOutput({
    json,
    command: 'callback',
    // TODO: If the hook came from a plugin, use the full path to the plugin for easier debugging
    hookName: `${hookEvent}:Callback`,
    toolUseID,
    hookEvent,
    expectedHookEvent: hookEvent,
    // Callbacks don't have stdout/stderr/exitCode
    stdout: undefined,
    stderr: undefined,
    exitCode: undefined,
  })
  return {
    ...processed,
    outcome: 'success',
    hook,
  }
}
