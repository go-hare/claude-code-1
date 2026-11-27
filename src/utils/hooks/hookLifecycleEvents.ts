import {
  getOriginalCwd,
  getProjectRoot,
  getRegisteredHooks,
  getSessionId,
} from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  hookJSONOutputSchema,
  isAsyncHookJSONOutput,
  isSyncHookJSONOutput,
} from '../../types/hooks.js'
import type { AssistantMessage } from '../../types/message.js'
import { getAgentContext, isDelegatedObservation } from '../agentContext.js'
import { logForDebugging } from '../debug.js'
import { isBareMode } from '../envUtils.js'
import {
  getErrnoCode,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../errors.js'
import { extractTextContent } from '../messages.js'
import {
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from '../plugins/functionHooksModules.js'
import { invalidateSessionEnvCache } from '../sessionEnvironment.js'
import { getPinnedStorageV5 } from '../storageV5/index.js'
import { hasHookForEvent } from './hookConfigRegistry.js'
import {
  createBaseHookInput,
  isManagedEnabledPlugin,
  TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  type TypedSyncHookOutput,
} from './hookCore.js'
import { formatOutsideReplHookFailures } from './hookErrorDisplay.js'
import { formatHookFailureSummaryLine } from './hookFailureSummary.js'
import {
  getSessionEndHooksBoundMs,
  getSessionEndHookTimeoutMs,
} from './hookInputHelpers.js'
import {
  executeHooksOutsideREPL,
  getHookWorktreePath,
} from './hookOutsideReplEngine.js'
import {
  getHooksConfigFromSnapshot,
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from './hooksConfigSnapshot.js'
import type {
  ElicitationResponse,
  HookBlockingError,
  HookOutsideReplResult,
} from './hookTypes.js'
import { resolveHookCwd } from './resolveHookCwd.js'
import { clearSessionHooks } from './sessionHooks.js'
import { stat as statPath } from 'node:fs/promises'
import { isAbsolute, resolve as resolvePath } from 'path'
import type {
  ConfigChangeHookInput,
  CwdChangedHookInput,
  DirectoryAddedHookInput,
  ElicitationHookInput,
  ElicitationResultHookInput,
  ExitReason,
  FileChangedHookInput,
  HookInput,
  InstructionsLoadedHookInput,
  NotificationHookInput,
  PostCompactHookInput,
  PreCompactHookInput,
  SessionEndHookInput,
  StopFailureHookInput,
} from 'src/entrypoints/agentSdkTypes.js'
import stripAnsi from 'strip-ansi'

/**
 * Execute notification hooks if configured
 * @param notificationData The notification data to pass to hooks
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Promise that resolves when all hooks complete
 */
export async function executeNotificationHooks(
  notificationData: {
    message: string
    title?: string
    notificationType: string
  },
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<void> {
  const { message, title, notificationType } = notificationData
  const hookInput: NotificationHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'Notification',
    message,
    title,
    notification_type: notificationType,
  }

  await executeHooksOutsideREPL({
    hookInput,
    timeoutMs,
    matchQuery: notificationType,
    storageV5: persist.storageV5 ?? getPinnedStorageV5(),
    credentials: persist.credentials,
  })
}

export async function executeStopFailureHooks(
  lastMessage: AssistantMessage,
  toolUseContext?: ToolUseContext,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): Promise<void> {
  // densable P$e: settingsHooksOff skips StopFailure entirely.
  if (toolUseContext?.options.settingsHooksOff === true) {
    return
  }
  const appState = toolUseContext?.getAppState()
  // executeHooksOutsideREPL hardcodes main sessionId (:2738). Agent frontmatter
  // hooks (registerFrontmatterHooks) key by agentId; gating with agentId here
  // would pass the gate but fail execution. Align gate with execution.
  const sessionId = getSessionId()
  if (!hasHookForEvent('StopFailure', appState, sessionId)) return

  const rawContent = lastMessage.message?.content
  const lastAssistantText =
    (Array.isArray(rawContent)
      ? extractTextContent(
          rawContent as readonly { readonly type: string }[],
          '\n',
        ).trim()
      : typeof rawContent === 'string'
        ? rawContent.trim()
        : '') || undefined

  // Some createAssistantAPIErrorMessage call sites omit `error` (e.g.
  // image-size at errors.ts:431). Default to 'unknown' so matcher filtering
  // at getMatchingHooks:1525 always applies.
  const error = (lastMessage.error as string | undefined) ?? 'unknown'
  const hookInput: StopFailureHookInput = {
    ...createBaseHookInput(undefined, undefined, toolUseContext),
    hook_event_name: 'StopFailure',
    error,
    error_details: lastMessage.errorDetails,
    last_assistant_message: lastAssistantText,
  }

  await executeHooksOutsideREPL({
    getAppState: toolUseContext?.getAppState,
    hookInput,
    timeoutMs,
    matchQuery: error,
    storageV5: toolUseContext?.storageV5 ?? getPinnedStorageV5(),
  })
}

/**
 * Execute pre-compact hooks if configured
 * @param compactData The compact data to pass to hooks
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Object with optional newCustomInstructions and userDisplayMessage
 */
const PRECOMPACT_OUTPUT_LIMIT = 10_000

const PRECOMPACT_PRESERVE_MARKERS = [
  '<artifact-content-authored-by-others/>',
  '<remote-control-device-report/>',
]

function sliceUtf16Safe(text: string, maxLen: number): string {
  if (maxLen <= 0) return ''
  if (text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const last = cut.charCodeAt(maxLen - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

export async function executePreCompactHooks(
  compactData: {
    trigger: 'manual' | 'auto'
    customInstructions: string | null
  },
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  context?: ToolUseContext,
): Promise<{
  newCustomInstructions?: string
  userDisplayMessage?: string
  blockedBy?: string
}> {
  if (context?.options.settingsHooksOff === true) return {}
  const activeAgentCtx = getAgentContext()
  const delegated = isDelegatedObservation(activeAgentCtx)
  // 2.1.323 #2103: include agent_id and agent_type when a subagent compacts
  const compactAgentId = context?.agentId ?? activeAgentCtx?.agentId
  const compactAgentType =
    context?.agentType ??
    (activeAgentCtx?.agentType === 'subagent'
      ? activeAgentCtx.subagentName
      : undefined)
  const hookInput: PreCompactHookInput = {
    ...createBaseHookInput(undefined, undefined, {
      agentId: compactAgentId,
      agentType: compactAgentType,
    }),
    hook_event_name: 'PreCompact',
    trigger: compactData.trigger,
    custom_instructions: compactData.customInstructions,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    matchQuery: compactData.trigger,
    signal,
    timeoutMs,
    storageV5: context?.storageV5,
    credentials: context?.credentials,
    agentId: compactAgentId,
  })

  if (results.length === 0) {
    return {}
  }

  // Extract custom instructions from successful hooks with non-empty output
  // and build user display messages with command info (cut at 10,000 chars per hook)
  const successfulOutputs: string[] = []
  const displayMessages: string[] = []
  for (const result of results) {
    if (result.cancelled) continue
    let trimmed = result.output.trim()
    if (result.succeeded && !result.blocked) {
      let preservedPrefix = ''
      if (trimmed.length > PRECOMPACT_OUTPUT_LIMIT) {
        logForDebugging(
          `PreCompact [${result.command}] output cut from ${trimmed.length} to ${PRECOMPACT_OUTPUT_LIMIT} characters`,
          { level: 'warn' },
        )
        const cut = sliceUtf16Safe(trimmed, PRECOMPACT_OUTPUT_LIMIT)
        const markers = PRECOMPACT_PRESERVE_MARKERS.filter(m =>
          trimmed.includes(m),
        )
        preservedPrefix = markers
          .filter(m => !cut.includes(m))
          .map(m => `${m}\n`)
          .join('')
        trimmed = `${cut}\n\n[PreCompact hook [${result.command}] output cut: ${trimmed.length} characters is over the ${PRECOMPACT_OUTPUT_LIMIT}-character limit]`
      }
      if (trimmed) {
        successfulOutputs.push(`${preservedPrefix}${trimmed}`)
        displayMessages.push(
          `PreCompact [${result.command}] completed successfully: ${trimmed}`,
        )
      } else {
        displayMessages.push(
          `PreCompact [${result.command}] completed successfully`,
        )
      }
    } else {
      if (trimmed) {
        displayMessages.push(
          `PreCompact [${result.command}] failed: ${trimmed}`,
        )
      } else {
        displayMessages.push(`PreCompact [${result.command}] failed`)
      }
    }
  }

  const blocked = results.filter(result => result.blocked)
  const blockResult =
    blocked.length > 0
      ? {
          blockedBy: blocked
            .map(result => {
              const output = result.output.trim()
              return `[${result.command}]${output ? `: ${output}` : ''}`
            })
            .join('\n'),
        }
      : {}
  if (delegated) return blockResult
  return {
    ...blockResult,
    newCustomInstructions:
      successfulOutputs.length > 0 ? successfulOutputs.join('\n\n') : undefined,
    userDisplayMessage:
      displayMessages.length > 0 ? displayMessages.join('\n') : undefined,
  }
}

/**
 * Execute post-compact hooks if configured
 * @param compactData The compact data to pass to hooks, including the summary
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Object with optional userDisplayMessage
 */
export async function executePostCompactHooks(
  compactData: {
    trigger: 'manual' | 'auto'
    compactSummary: string
  },
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  context?: ToolUseContext,
): Promise<{
  userDisplayMessage?: string
}> {
  const activeAgentCtx = getAgentContext()
  if (
    context?.options.settingsHooksOff === true ||
    isDelegatedObservation(activeAgentCtx)
  )
    return {}
  // 2.1.323 #2103: include agent_id and agent_type when a subagent compacts
  const compactAgentId = context?.agentId ?? activeAgentCtx?.agentId
  const compactAgentType =
    context?.agentType ??
    (activeAgentCtx?.agentType === 'subagent'
      ? activeAgentCtx.subagentName
      : undefined)
  const hookInput: PostCompactHookInput = {
    ...createBaseHookInput(undefined, undefined, {
      agentId: compactAgentId,
      agentType: compactAgentType,
    }),
    hook_event_name: 'PostCompact',
    trigger: compactData.trigger,
    compact_summary: compactData.compactSummary,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    matchQuery: compactData.trigger,
    signal,
    timeoutMs,
    storageV5: context?.storageV5,
    credentials: context?.credentials,
    agentId: compactAgentId,
  })

  if (results.length === 0) {
    return {}
  }

  const displayMessages: string[] = []
  for (const result of results) {
    if (result.cancelled) continue
    if (result.succeeded) {
      if (result.output.trim()) {
        displayMessages.push(
          `PostCompact [${result.command}] completed successfully: ${result.output.trim()}`,
        )
      } else {
        displayMessages.push(
          `PostCompact [${result.command}] completed successfully`,
        )
      }
    } else {
      if (result.output.trim()) {
        displayMessages.push(
          `PostCompact [${result.command}] failed: ${result.output.trim()}`,
        )
      } else {
        displayMessages.push(`PostCompact [${result.command}] failed`)
      }
    }
  }

  return {
    userDisplayMessage:
      displayMessages.length > 0 ? displayMessages.join('\n') : undefined,
  }
}

/**
 * Execute session end hooks if configured
 * @param reason The reason for ending the session
 * @param options Optional parameters including app state functions and signal
 * @returns Promise that resolves when all hooks complete
 */
export async function executeSessionEndHooks(
  reason: ExitReason,
  options?: {
    getAppState?: () => AppState
    setAppState?: (updater: (prev: AppState) => AppState) => void
    signal?: AbortSignal
    timeoutMs?: number
    storageV5?: unknown
    credentials?: unknown
  },
): Promise<void> {
  const {
    getAppState,
    setAppState,
    signal,
    timeoutMs = getSessionEndHookTimeoutMs(),
    storageV5,
    credentials,
  } = options || {}

  const endingSessionId = getSessionId()
  const hookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'SessionEnd' as const,
    reason,
  } as unknown as SessionEndHookInput

  const results = await executeHooksOutsideREPL({
    getAppState,
    hookInput,
    matchQuery: reason,
    signal,
    timeoutMs,
    storageV5: storageV5 ?? getPinnedStorageV5(),
    credentials,
  })

  // Official 2.1.327 (#432): surface non-throwing SessionEnd hook failures
  // (including empty-output failures and in-session `/clear` & `/resume` runs)
  // via UI notifications when Ink is mounted, or stderr during shutdown.
  const failureMessages = formatOutsideReplHookFailures('SessionEnd', results)
  if (failureMessages.length > 0) {
    if (setAppState && (reason === 'clear' || reason === 'resume')) {
      const queued = failureMessages.map((text, idx) => ({
        key:
          idx === 0
            ? 'session-end-hook-error'
            : `session-end-hook-error-${idx}`,
        text,
        color: 'error' as const,
        priority: 'high' as const,
      }))
      // Route through the notification queue helper so a dismissal timer is
      // armed instead of writing notifications.current without a timeout.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { enqueueNotificationsOutsideReact } =
        require('../../context/notifications.js') as typeof import('../../context/notifications.js')
      enqueueNotificationsOutsideReact(setAppState, queued)
    } else {
      // During shutdown, Ink is unmounted so we can write directly to stderr
      for (const errMsg of failureMessages) {
        process.stderr.write(`${errMsg}\n`)
      }
    }
  }

  // Clear session hooks after execution
  if (setAppState) {
    clearSessionHooks(setAppState, endingSessionId)
  }

  if (
    !isBareMode() &&
    !shouldDisableAllHooksIncludingManaged() &&
    hasMatchingFunctionHook('session.end')
  ) {
    const boundMs = getSessionEndHooksBoundMs()
    const boundSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(boundMs)])
      : AbortSignal.timeout(boundMs)
    let boundTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        runFunctionHookChain(
          'session.end',
          {
            sessionId: endingSessionId,
            reason,
            resume: { id: endingSessionId },
          },
          async () => ({ sessionId: endingSessionId }),
          undefined,
          undefined,
          { signal: boundSignal },
        ),
        new Promise<never>((_, reject) => {
          boundTimer = setTimeout(
            () => reject(new Error('SessionEnd bound exceeded')),
            boundMs,
          )
          boundTimer.unref?.()
        }),
      ])
    } catch (err) {
      const detail = boundSignal.aborted
        ? 'cut at the SessionEnd bound, the session ends regardless'
        : `failed: ${err instanceof Error ? err.message : String(err)}`
      logForDebugging(`session.end (${reason}): ${detail}`, { level: 'warn' })
    } finally {
      if (boundTimer !== undefined) clearTimeout(boundTimer)
    }
  }
}

export type ConfigChangeSource =
  | 'user_settings'
  | 'project_settings'
  | 'local_settings'
  | 'policy_settings'
  | 'skills'

/**
 * Execute config change hooks when configuration files change during a session.
 * Fired by file watchers when settings, skills, or commands change on disk.
 * Enables enterprise admins to audit/log configuration changes for security.
 *
 * Policy settings are enterprise-managed and must never be blockable by hooks.
 * Hooks still fire (for audit logging) but blocking results are ignored — callers
 * will always see an empty result for policy sources.
 *
 * @param source The type of config that changed
 * @param filePath Optional path to the changed file
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 */
export async function executeConfigChangeHooks(
  source: ConfigChangeSource,
  filePath?: string,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<HookOutsideReplResult[]> {
  const hookInput: ConfigChangeHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'ConfigChange',
    source,
    file_path: filePath,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    timeoutMs,
    matchQuery: source,
    storageV5: persist.storageV5 ?? getPinnedStorageV5(),
    credentials: persist.credentials,
  })

  // Policy settings are enterprise-managed — hooks fire for audit logging
  // but must never block policy changes from being applied
  if (source === 'policy_settings') {
    return results.map(r => ({ ...r, blocked: false }))
  }

  return results
}

async function executeEnvHooks(
  hookInput: HookInput,
  timeoutMs: number,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<{
  results: HookOutsideReplResult[]
  watchPaths: string[]
  systemMessages: string[]
}> {
  const results = await executeHooksOutsideREPL({
    hookInput,
    timeoutMs,
    storageV5: persist.storageV5 ?? getPinnedStorageV5(),
    credentials: persist.credentials,
  })
  if (results.length > 0) {
    invalidateSessionEnvCache()
  }
  const watchPaths = results.flatMap(r => r.watchPaths ?? [])
  const systemMessages = results
    .map(r => r.systemMessage)
    .filter((m): m is string => !!m)
  return { results, watchPaths, systemMessages }
}

export function executeCwdChangedHooks(
  oldCwd: string,
  newCwd: string,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<{
  results: HookOutsideReplResult[]
  watchPaths: string[]
  systemMessages: string[]
}> {
  const hookInput: CwdChangedHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'CwdChanged',
    old_cwd: oldCwd,
    new_cwd: newCwd,
  }
  return executeEnvHooks(hookInput, timeoutMs, persist)
}

export function executeFileChangedHooks(
  filePath: string,
  event: 'change' | 'add' | 'unlink',
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<{
  results: HookOutsideReplResult[]
  watchPaths: string[]
  systemMessages: string[]
}> {
  const hookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'FileChanged' as const,
    file_path: filePath,
    event,
  } as unknown as FileChangedHookInput
  return executeEnvHooks(hookInput, timeoutMs, persist)
}

/**
 * densable 2.1.219 s2t / executeDirectoryAddedHooks:
 *   n = { ...Kf(void 0), hook_event_name: "DirectoryAdded", directory: e, source: t }
 *   o = await wL({ hookInput: n, matchQuery: t, timeoutMs: r })
 *   return { results: o, systemMessages: o.map(systemMessage).filter(Boolean) }
 *
 * @param directory Absolute path of the directory that was added
 * @param source "slash_command" for /add-dir, "register_repo_root" for SDK control_request
 */
export async function executeDirectoryAddedHooks(
  directory: string,
  source: 'slash_command' | 'register_repo_root',
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<{
  results: HookOutsideReplResult[]
  systemMessages: string[]
}> {
  const hookInput: DirectoryAddedHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'DirectoryAdded',
    directory,
    source,
  }
  const results = await executeHooksOutsideREPL({
    hookInput,
    matchQuery: source,
    timeoutMs,
    storageV5: persist.storageV5 ?? getPinnedStorageV5(),
    credentials: persist.credentials,
  })
  const systemMessages = results
    .map(r => r.systemMessage)
    .filter((m): m is string => !!m)
  return { results, systemMessages }
}

export type InstructionsLoadReason =
  | 'session_start'
  | 'nested_traversal'
  | 'path_glob_match'
  | 'include'
  | 'compact'

export type InstructionsMemoryType = 'User' | 'Project' | 'Local' | 'Managed'

/**
 * Check if InstructionsLoaded hooks are configured (without executing them).
 * Callers should check this before invoking executeInstructionsLoadedHooks to avoid
 * building hook inputs for every instruction file when no hook is configured.
 *
 * Checks both settings-file hooks (getHooksConfigFromSnapshot) and registered
 * hooks (plugin hooks + SDK callback hooks via registerHookCallbacks). Session-
 * derived hooks (structured output enforcement etc.) are internal and not checked.
 */
export function hasInstructionsLoadedHook(): boolean {
  const snapshotHooks = getHooksConfigFromSnapshot()?.['InstructionsLoaded']
  if (snapshotHooks && snapshotHooks.length > 0) return true
  const registeredHooks = getRegisteredHooks()?.['InstructionsLoaded']
  if (registeredHooks && registeredHooks.length > 0) return true
  return false
}

/**
 * Execute InstructionsLoaded hooks when an instruction file (CLAUDE.md or
 * .claude/rules/*.md) is loaded into context. Fire-and-forget — this hook is
 * for observability/audit only and does not support blocking.
 *
 * Dispatch sites:
 * - Eager load at session start (getMemoryFiles in claudemd.ts)
 * - Eager reload after compaction (getMemoryFiles cache cleared by
 *   runPostCompactCleanup; next call reports load_reason: 'compact')
 * - Lazy load when Claude touches a file that triggers nested CLAUDE.md or
 *   conditional rules with paths: frontmatter (memoryFilesToAttachments in
 *   attachments.ts)
 */
export async function executeInstructionsLoadedHooks(
  filePath: string,
  memoryType: InstructionsMemoryType,
  loadReason: InstructionsLoadReason,
  options?: {
    globs?: string[]
    triggerFilePath?: string
    parentFilePath?: string
    timeoutMs?: number
  },
): Promise<void> {
  const {
    globs,
    triggerFilePath,
    parentFilePath,
    timeoutMs = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  } = options ?? {}

  const hookInput: InstructionsLoadedHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'InstructionsLoaded',
    file_path: filePath,
    memory_type: memoryType,
    load_reason: loadReason,
    globs,
    trigger_file_path: triggerFilePath,
    parent_file_path: parentFilePath,
  }

  await executeHooksOutsideREPL({
    hookInput,
    timeoutMs,
    matchQuery: loadReason,
  })
}

/** Result of an elicitation hook execution (non-REPL path). */
export type ElicitationHookResult = {
  elicitationResponse?: ElicitationResponse
  blockingError?: HookBlockingError
}

/** Result of an elicitation-result hook execution (non-REPL path). */
export type ElicitationResultHookResult = {
  elicitationResultResponse?: ElicitationResponse
  blockingError?: HookBlockingError
}

/**
 * Parse elicitation-specific fields from a HookOutsideReplResult.
 * Mirrors the relevant branches of processHookJSONOutput for Elicitation
 * and ElicitationResult hook events.
 */
function parseElicitationHookOutput(
  result: HookOutsideReplResult,
  expectedEventName: 'Elicitation' | 'ElicitationResult',
): {
  response?: ElicitationResponse
  blockingError?: HookBlockingError
} {
  // Exit code 2 = blocking (same as executeHooks path)
  if (result.blocked && !result.succeeded) {
    return {
      blockingError: {
        blockingError: result.output || `Elicitation blocked by hook`,
        command: result.command,
      },
    }
  }

  if (!result.output.trim()) {
    return {}
  }

  // Try to parse JSON output for structured elicitation response
  const trimmed = result.output.trim()
  if (!trimmed.startsWith('{')) {
    return {}
  }

  try {
    const parsed = hookJSONOutputSchema().parse(JSON.parse(trimmed))
    if (isAsyncHookJSONOutput(parsed)) {
      return {}
    }
    if (!isSyncHookJSONOutput(parsed)) {
      return {}
    }

    // Cast to typed interface for type-safe property access
    const typedParsed = parsed as TypedSyncHookOutput

    // Check for top-level decision: 'block' (exit code 0 + JSON block)
    if (typedParsed.decision === 'block' || result.blocked) {
      return {
        blockingError: {
          blockingError: typedParsed.reason || 'Elicitation blocked by hook',
          command: result.command,
        },
      }
    }

    const specific = typedParsed.hookSpecificOutput
    if (!specific || specific.hookEventName !== expectedEventName) {
      return {}
    }

    if (!('action' in specific) || !(specific as { action?: string }).action) {
      return {}
    }

    const typedSpecific = specific as {
      action: string
      content?: Record<string, unknown>
    }
    const response: ElicitationResponse = {
      action: typedSpecific.action as ElicitationResponse['action'],
      content: typedSpecific.content as
        | ElicitationResponse['content']
        | undefined,
    }

    const out: {
      response?: ElicitationResponse
      blockingError?: HookBlockingError
    } = { response }

    if (typedSpecific.action === 'decline') {
      out.blockingError = {
        blockingError:
          typedParsed.reason ||
          (expectedEventName === 'Elicitation'
            ? 'Elicitation denied by hook'
            : 'Elicitation result blocked by hook'),
        command: result.command,
      }
    }

    return out
  } catch {
    return {}
  }
}

export async function executeElicitationHooks({
  serverName,
  message,
  requestedSchema,
  permissionMode,
  signal,
  timeoutMs = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  mode,
  url,
  elicitationId,
  storageV5,
  credentials,
}: {
  serverName: string
  message: string
  requestedSchema?: Record<string, unknown>
  permissionMode?: string
  signal?: AbortSignal
  timeoutMs?: number
  mode?: 'form' | 'url'
  url?: string
  elicitationId?: string
  storageV5?: unknown
  credentials?: unknown
}): Promise<ElicitationHookResult> {
  const hookInput: ElicitationHookInput = {
    ...createBaseHookInput(permissionMode),
    hook_event_name: 'Elicitation',
    mcp_server_name: serverName,
    message,
    mode,
    url,
    elicitation_id: elicitationId,
    requested_schema: requestedSchema,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    matchQuery: serverName,
    signal,
    timeoutMs,
    storageV5: storageV5 ?? getPinnedStorageV5(),
    credentials,
  })

  let elicitationResponse: ElicitationResponse | undefined
  let blockingError: HookBlockingError | undefined

  for (const result of results) {
    const parsed = parseElicitationHookOutput(result, 'Elicitation')
    if (parsed.blockingError) {
      blockingError = parsed.blockingError
    }
    if (parsed.response) {
      elicitationResponse = parsed.response
    }
  }

  return { elicitationResponse, blockingError }
}

export async function executeElicitationResultHooks({
  serverName,
  action,
  content,
  permissionMode,
  signal,
  timeoutMs = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  mode,
  elicitationId,
  storageV5,
  credentials,
}: {
  serverName: string
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
  permissionMode?: string
  signal?: AbortSignal
  timeoutMs?: number
  mode?: 'form' | 'url'
  elicitationId?: string
  storageV5?: unknown
  credentials?: unknown
}): Promise<ElicitationResultHookResult> {
  const hookInput: ElicitationResultHookInput = {
    ...createBaseHookInput(permissionMode),
    hook_event_name: 'ElicitationResult',
    mcp_server_name: serverName,
    elicitation_id: elicitationId,
    mode,
    action,
    content,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    matchQuery: serverName,
    signal,
    timeoutMs,
    storageV5: storageV5 ?? getPinnedStorageV5(),
    credentials,
  })

  let elicitationResultResponse: ElicitationResponse | undefined
  let blockingError: HookBlockingError | undefined

  for (const result of results) {
    const parsed = parseElicitationHookOutput(result, 'ElicitationResult')
    if (parsed.blockingError) {
      blockingError = parsed.blockingError
    }
    if (parsed.response) {
      elicitationResultResponse = parsed.response
    }
  }

  return { elicitationResultResponse, blockingError }
}

/**
 * Check if WorktreeCreate hooks are configured (without executing them).
 *
 * Checks both settings-file hooks (getHooksConfigFromSnapshot) and registered
 * hooks (plugin hooks + SDK callback hooks via registerHookCallbacks).
 *
 * Must mirror the managedOnly filtering in getHooksConfig() — when
 * shouldAllowManagedHooksOnly() is true, plugin hooks (pluginRoot set) are
 * skipped at execution, so we must also skip them here. Otherwise this returns
 * true but executeWorktreeCreateHook() finds no matching hooks and throws,
 * blocking the git-worktree fallback.
 */
export function hasWorktreeCreateHook(): boolean {
  if (shouldDisableAllHooksIncludingManaged()) return false
  const snapshotHooks = getHooksConfigFromSnapshot()?.['WorktreeCreate']
  if (snapshotHooks && snapshotHooks.length > 0) return true
  const registeredHooks = getRegisteredHooks()?.['WorktreeCreate']
  if (!registeredHooks || registeredHooks.length === 0) return false
  // Mirror getHooksConfig(): skip non-managed plugin hooks in managed-only mode
  const managedOnly = shouldAllowManagedHooksOnly()
  return registeredHooks.some(
    matcher =>
      !(
        managedOnly &&
        'pluginRoot' in matcher &&
        !isManagedEnabledPlugin(
          'pluginId' in matcher ? matcher.pluginId : undefined,
          'pluginName' in matcher ? matcher.pluginName : undefined,
        )
      ),
  )
}

/**
 * densable gjr / hasWorktreeRemoveHook — WorktreeRemove matchers exist.
 * cleanupWorktree: hook fail + gjr → keep; !gjr → git fallback.
 */
export function hasWorktreeRemoveHook(): boolean {
  if (shouldDisableAllHooksIncludingManaged()) return false
  const snapshotHooks = getHooksConfigFromSnapshot()?.['WorktreeRemove']
  if (snapshotHooks && snapshotHooks.length > 0) return true
  const registeredHooks = getRegisteredHooks()?.['WorktreeRemove']
  if (!registeredHooks || registeredHooks.length === 0) return false
  const managedOnly = shouldAllowManagedHooksOnly()
  return registeredHooks.some(
    matcher =>
      !(
        managedOnly &&
        'pluginRoot' in matcher &&
        !isManagedEnabledPlugin(
          'pluginId' in matcher ? matcher.pluginId : undefined,
          'pluginName' in matcher ? matcher.pluginName : undefined,
        )
      ),
  )
}

/**
 * Execute WorktreeCreate hooks.
 * Returns the worktree path from hook stdout.
 * Throws if hooks fail or produce no output.
 * Callers should check hasWorktreeCreateHook() before calling this.
 */
export async function executeWorktreeCreateHook(
  name: string,
): Promise<{ worktreePath: string } | undefined> {
  const hookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'WorktreeCreate' as const,
    name,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    timeoutMs: TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  })

  const worktreePath = getHookWorktreePath(results)
  if (worktreePath === undefined) {
    if (results.length === 0) {
      if (!hasWorktreeCreateHook()) return undefined
      throw new Error(
        'WorktreeCreate hook failed: hook is configured but did not run (workspace not trusted or matcher mismatch)',
      )
    }
    const failedOutputs = results
      .filter(result => !result.succeeded)
      .map(
        result =>
          `${result.command}: ${stripAnsi(result.output.trim()) || 'no output'}`,
      )
    if (failedOutputs.length === 0)
      throw new Error(
        'WorktreeCreate hook failed: hook succeeded but returned no worktree path (command: echo the path to stdout; http/callback: return hookSpecificOutput.worktreePath)',
      )
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      `WorktreeCreate hook failed: ${failedOutputs.join('; ')}`,
      'WorktreeCreate hook failed (stderr redacted)',
    )
  }
  return {
    worktreePath: isAbsolute(worktreePath)
      ? worktreePath
      : resolvePath(
          await resolveHookCwd(hookInput.cwd, {
            originalCwd: getOriginalCwd(),
            projectRoot: getProjectRoot(),
          }),
          worktreePath,
        ),
  }
}

/**
 * Execute WorktreeRemove hooks if configured.
 * Returns the gold289 configuration/removal/failure result, including a failure summary.
 *
 * Checks both settings-file hooks (getHooksConfigFromSnapshot) and registered
 * hooks (plugin hooks + SDK callback hooks via registerHookCallbacks).
 */
export async function executeWorktreeRemoveHook(
  worktreePath: string,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<
  | { kind: 'not_configured' }
  | { kind: 'removed' }
  | { kind: 'failed'; summary: string }
> {
  if (!hasWorktreeRemoveHook() && !hasMatchingFunctionHook('WorktreeRemove')) {
    return { kind: 'not_configured' }
  }

  const hookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'WorktreeRemove' as const,
    worktree_path: worktreePath,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    timeoutMs: TOOL_HOOK_EXECUTION_TIMEOUT_MS,
    storageV5: persist.storageV5,
    credentials: persist.credentials,
  })

  if (results.length === 0) {
    if (!hasWorktreeRemoveHook()) return { kind: 'not_configured' }
    return {
      kind: 'failed',
      summary:
        'is configured but did not run (workspace not trusted, or no matching hook entries)',
    }
  }
  const failures = results.filter(result => !result.succeeded)
  for (const result of failures)
    logForDebugging(
      `WorktreeRemove hook failed [${result.command}]: ${result.output.trim()}`,
      { level: 'error' },
    )
  const first = failures[0]
  if (first === undefined) return { kind: 'removed' }
  const line =
    first.output.split('\n').map(formatHookFailureSummaryLine).find(Boolean) ??
    ''
  const detail = line ? ` (${line})` : ''
  const summary =
    first.exitCode !== undefined
      ? `exited ${first.exitCode}${detail}`
      : `failed${detail || ' with no output'}`
  const gone = await statPath(worktreePath).then(
    () => false,
    error => {
      const code = getErrnoCode(error)
      return code === 'ENOENT' || code === 'ENOTDIR'
    },
  )
  if (gone) {
    logForDebugging(
      `WorktreeRemove hook ${summary}, but nothing is left at ${worktreePath} — treating it as removed`,
      { level: 'warn' },
    )
    return { kind: 'removed' }
  }
  return { kind: 'failed', summary }
}
