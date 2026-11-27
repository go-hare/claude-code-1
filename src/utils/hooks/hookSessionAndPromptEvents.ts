import {
  getIsNonInteractiveSession,
  getSessionId,
} from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import type { ToolUseContext } from '../../Tool.js'
import type { PromptRequest, PromptResponse } from '../../types/hooks.js'
import { type AgentId, asSessionId } from '../../types/ids.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import { getAgentContext } from '../agentContext.js'
import { createAttachmentMessage } from '../attachments.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { isBareMode } from '../envUtils.js'
import { ControlStreamClosedError, errorMessage } from '../errors.js'
import { logError } from '../log.js'
import {
  createSystemMessage,
  createUserMessage,
  extractTextContent,
  getLastAssistantMessage,
} from '../messages.js'
import {
  getLoadedFunctionHooksModules,
  getPluginRegisteredCommands,
  hasMatchingFunctionHook,
  type LoadedFunctionHooksModule,
  runFunctionHookChain,
  setLaterLoadedSessionStart,
} from '../plugins/functionHooksModules.js'
import {
  startSessionActivity,
  stopSessionActivity,
} from '../sessionActivity.js'
import { invalidateSessionEnvCache } from '../sessionEnvironment.js'
import { getAgentTranscriptPath } from '../sessionPaths.js'
import { getCurrentSessionTitle } from '../sessionStorage.js'
import { getPinnedStorageV5 } from '../storageV5/index.js'
import { hasHookForEvent } from './hookConfigRegistry.js'
import {
  createBaseHookInput,
  escapeSystemReminderTags,
  type SessionStartHookExecutionOptions,
  TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS,
} from './hookCore.js'
import { executeHooks } from './hookEngine.js'
import { getUserPromptExpansionHookBlockingMessage } from './hookInputHelpers.js'
import { shouldDisableAllHooksIncludingManaged } from './hooksConfigSnapshot.js'
import type { AggregatedHookResult } from './hookTypes.js'
import {
  contextTokensAfterCompact,
  cre,
  Ewe,
  getModelSwitchSession,
  hJ,
  Hye,
  Kle,
  KSn,
  LOe,
  Lsn,
  type ModelSwitchRequest,
  modelSwitchToolUseId,
  nVn,
  Osn,
  yBn,
  yEt,
} from './modelSwitchHooks.js'
import { getSessionFunctionHooks } from './sessionHooks.js'
import {
  snapshotStopBackgroundTasks,
  snapshotStopSessionCrons,
} from './stopHookPayload.js'
import { randomUUID } from 'crypto'
import type {
  MessageDisplayHookInput,
  PostModelSwitchHookInput,
  PreModelSwitchHookInput,
  SessionStartHookInput,
  SetupHookInput,
  StopHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  TaskCompletedHookInput,
  TaskCreatedHookInput,
  TeammateIdleHookInput,
  UserPromptExpansionHookInput,
  UserPromptSubmitHookInput,
} from 'src/entrypoints/agentSdkTypes.js'
import type { HookResultMessage } from 'src/types/message.js'

/**
 * Execute stop hooks if configured.
 * densable `are` last arg `M` — default turn_end.
 */
export type StopHookPass =
  | 'turn_end'
  | 'turn_end_reactions'
  | 'blockable_turn_end'

export async function* executeStopHooks(
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  stopHookActive: boolean = false,
  subagentId?: AgentId,
  toolUseContext?: ToolUseContext,
  messages?: Message[],
  agentType?: string,
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>,
  stopPass: StopHookPass = 'turn_end',
): AsyncGenerator<AggregatedHookResult> {
  const hookEvent = subagentId ? 'SubagentStop' : 'Stop'
  const appState = toolUseContext?.getAppState()
  const sessionId = toolUseContext?.agentId ?? getSessionId()
  if (!hasHookForEvent(hookEvent, appState, sessionId)) {
    return
  }
  // densable: turn_end_reactions no-ops when this session has no function Stop hooks.
  if (stopPass === 'turn_end_reactions') {
    const functionHooks = appState
      ? getSessionFunctionHooks(appState, sessionId, hookEvent).get(hookEvent)
      : undefined
    if (!functionHooks?.length) {
      return
    }
  }

  // Extract text content from the last assistant message so hooks can
  // inspect the final response without reading the transcript file.
  const lastAssistantMessage = messages
    ? getLastAssistantMessage(messages)
    : undefined
  const lastAssistantContent = lastAssistantMessage?.message?.content
  const lastAssistantText = lastAssistantMessage
    ? (Array.isArray(lastAssistantContent)
        ? extractTextContent(
            lastAssistantContent as readonly { readonly type: string }[],
            '\n',
          ).trim()
        : typeof lastAssistantContent === 'string'
          ? lastAssistantContent.trim()
          : '') || undefined
    : undefined

  const stopExtras = {
    background_tasks: snapshotStopBackgroundTasks(appState?.tasks),
    session_crons: snapshotStopSessionCrons(),
  }

  const hookInput: StopHookInput | SubagentStopHookInput = subagentId
    ? {
        ...createBaseHookInput(permissionMode, undefined, toolUseContext),
        hook_event_name: 'SubagentStop',
        stop_hook_active: stopHookActive,
        agent_id: subagentId,
        agent_transcript_path: getAgentTranscriptPath(subagentId),
        agent_type: agentType ?? '',
        last_assistant_message: lastAssistantText,
        ...stopExtras,
      }
    : {
        ...createBaseHookInput(permissionMode, undefined, toolUseContext),
        hook_event_name: 'Stop',
        stop_hook_active: stopHookActive,
        last_assistant_message: lastAssistantText,
        ...stopExtras,
      }

  // Trust check is now centralized in executeHooks()
  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal,
    timeoutMs,
    toolUseContext,
    messages,
    requestPrompt,
    skipSessionFunctionHooks:
      stopPass !== 'turn_end' && stopPass !== 'turn_end_reactions',
    sessionFunctionHooksOnly: stopPass === 'turn_end_reactions',
  })
}

/**
 * Execute TeammateIdle hooks when a teammate is about to go idle.
 * If a hook blocks (exit code 2), the teammate should continue working instead of going idle.
 * @param teammateName The name of the teammate going idle
 * @param teamName The team this teammate belongs to
 * @param permissionMode Optional permission mode
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @param toolUseContext Optional ToolUseContext for agentId/agentType and session hooks (official YGo @4225480)
 * @param storageV5 Optional storageV5 override
 * @returns Async generator that yields progress messages and blocking errors
 */
export async function* executeTeammateIdleHooks(
  teammateName: string,
  teamName: string,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  toolUseContext?: ToolUseContext,
  storageV5?: unknown,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: TeammateIdleHookInput = {
    ...createBaseHookInput(
      permissionMode,
      undefined,
      toolUseContext
        ? {
            agentId: toolUseContext.agentId,
            agentType: toolUseContext.agentType,
          }
        : undefined,
    ),
    hook_event_name: 'TeammateIdle',
    teammate_name: teammateName,
    team_name: teamName,
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal,
    timeoutMs,
    toolUseContext,
    storageV5:
      storageV5 ??
      (toolUseContext as { storageV5?: unknown } | undefined)?.storageV5 ??
      getPinnedStorageV5(),
  })
}

/**
 * Execute TaskCreated hooks when a task is being created.
 * If a hook blocks (exit code 2), the task creation should be prevented and feedback returned.
 * @param taskId The ID of the task being created
 * @param taskSubject The subject/title of the task
 * @param taskDescription Optional description of the task
 * @param teammateName Optional name of the teammate creating the task
 * @param teamName Optional team name
 * @param permissionMode Optional permission mode
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @param toolUseContext Optional ToolUseContext for resolving appState and sessionId
 * @returns Async generator that yields progress messages and blocking errors
 */
export async function* executeTaskCreatedHooks(
  taskId: string,
  taskSubject: string,
  taskDescription?: string,
  teammateName?: string,
  teamName?: string,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  toolUseContext?: ToolUseContext,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: TaskCreatedHookInput = {
    ...createBaseHookInput(permissionMode),
    hook_event_name: 'TaskCreated',
    task_id: taskId,
    task_subject: taskSubject,
    task_description: taskDescription,
    teammate_name: teammateName,
    team_name: teamName,
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal,
    timeoutMs,
    toolUseContext,
  })
}

/**
 * Execute TaskCompleted hooks when a task is being marked as completed.
 * If a hook blocks (exit code 2), the task completion should be prevented and feedback returned.
 * @param taskId The ID of the task being completed
 * @param taskSubject The subject/title of the task
 * @param taskDescription Optional description of the task
 * @param teammateName Optional name of the teammate completing the task
 * @param teamName Optional team name
 * @param permissionMode Optional permission mode
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @param toolUseContext Optional ToolUseContext for resolving appState and sessionId
 * @returns Async generator that yields progress messages and blocking errors
 */
export async function* executeTaskCompletedHooks(
  taskId: string,
  taskSubject: string,
  taskDescription?: string,
  teammateName?: string,
  teamName?: string,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  toolUseContext?: ToolUseContext,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: TaskCompletedHookInput = {
    ...createBaseHookInput(permissionMode),
    hook_event_name: 'TaskCompleted',
    task_id: taskId,
    task_subject: taskSubject,
    task_description: taskDescription,
    teammate_name: teammateName,
    team_name: teamName,
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal,
    timeoutMs,
    toolUseContext,
  })
}

/**
 * Execute start hooks if configured
 * @param prompt The user prompt that will be passed to the tool
 * @param permissionMode Permission mode from toolPermissionContext
 * @param toolUseContext ToolUseContext for prompt-based hooks
 * @returns Async generator that yields progress messages and hook results
 */
/**
 * Official 2.1.328 (#663): Code Mode no longer runs UserPromptSubmit hooks
 * (managed ones included) on scripts' output. To redact Code Mode script
 * output, configure a PostToolUse hook returning `updatedToolOutput`.
 */
export function shouldSkipUserPromptSubmitForCodeModeScriptOutput(opts?: {
  isCodeModeScriptOutput?: boolean
}): boolean {
  return opts?.isCodeModeScriptOutput === true
}

export async function* executeUserPromptSubmitHooks(
  prompt: string,
  permissionMode: string,
  toolUseContext: ToolUseContext,
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>,
  options?: { isCodeModeScriptOutput?: boolean },
): AsyncGenerator<AggregatedHookResult> {
  if (shouldSkipUserPromptSubmitForCodeModeScriptOutput(options)) {
    return
  }
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  if (!hasHookForEvent('UserPromptSubmit', appState, sessionId)) {
    return
  }

  const hookInput: UserPromptSubmitHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'UserPromptSubmit',
    prompt,
    session_title: getCurrentSessionTitle(getSessionId()),
  }

  // 2.1.323 #2051: when Stop is pressed right after sending a message while
  // UserPromptSubmit (or a plugin prompt hook) is still running, treat the
  // aborted hook as cancelled instead of surfacing an error.
  for await (const result of executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal: toolUseContext.abortController.signal,
    timeoutMs: USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS,
    toolUseContext,
    requestPrompt,
  })) {
    const hookAttachment =
      result.message?.type === 'attachment'
        ? result.message.attachment
        : undefined
    if (
      toolUseContext.abortController.signal.aborted &&
      (result.blockingError ||
        hookAttachment?.type === 'hook_non_blocking_error' ||
        hookAttachment?.type === 'hook_error_during_execution' ||
        hookAttachment?.type === 'hook_blocking_error')
    ) {
      const existingToolUseID =
        hookAttachment &&
        'toolUseID' in hookAttachment &&
        typeof hookAttachment.toolUseID === 'string'
          ? hookAttachment.toolUseID
          : randomUUID()
      yield {
        message: createAttachmentMessage({
          type: 'hook_cancelled',
          hookName: 'UserPromptSubmit',
          toolUseID: existingToolUseID,
          hookEvent: 'UserPromptSubmit',
        }),
      }
      continue
    }
    yield result
  }
}

/**
 * densable AMr — UserPromptExpansion command hooks.
 */
export async function* executeUserPromptExpansionHooks(
  expansionType: 'slash_command' | 'mcp_prompt',
  commandName: string,
  commandArgs: string,
  commandSource: string | undefined,
  prompt: string,
  permissionMode: string,
  toolUseContext: ToolUseContext,
): AsyncGenerator<AggregatedHookResult> {
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  if (!hasHookForEvent('UserPromptExpansion', appState, sessionId)) {
    return
  }

  const hookInput: UserPromptExpansionHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'UserPromptExpansion',
    expansion_type: expansionType,
    command_name: commandName,
    command_args: commandArgs,
    command_source: commandSource,
    prompt,
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal: toolUseContext.abortController.signal,
    timeoutMs: TOOL_HOOK_EXECUTION_TIMEOUT_MS,
    toolUseContext,
  })
}

export type UserPromptExpansionMessage =
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | SystemMessage
  | ProgressMessage

export type UserPromptExpansionBlocked<T> = {
  blocked: {
    messages: UserPromptExpansionMessage[]
    shouldQuery: false
    resultText: string
    command: T
  }
}

export type UserPromptExpansionOk = {
  hookMessages: UserPromptExpansionMessage[]
}

/**
 * densable Ze — run UserPromptExpansion around a slash / MCP prompt expansion.
 */
export async function runUserPromptExpansionHook<
  T extends { name: string; source?: string },
>(
  command: T,
  args: string,
  toolUseContext: ToolUseContext,
): Promise<UserPromptExpansionBlocked<T> | UserPromptExpansionOk> {
  const hookMessages: UserPromptExpansionMessage[] = []
  const prompt = args ? `/${command.name} ${args}` : `/${command.name}`
  try {
    const permissionMode =
      toolUseContext.getAppState().toolPermissionContext.mode
    for await (const result of executeUserPromptExpansionHooks(
      command.source === 'mcp' ? 'mcp_prompt' : 'slash_command',
      command.name,
      args,
      command.source,
      prompt,
      permissionMode,
      toolUseContext,
    )) {
      if (result.message?.type === 'progress') {
        continue
      }
      if (result.blockingError) {
        const blockingMessage = getUserPromptExpansionHookBlockingMessage(
          result.blockingError,
        )
        const blockText = result.suppressOriginalPrompt
          ? blockingMessage
          : `${blockingMessage}\n\nOriginal prompt: ${prompt}`
        return {
          blocked: {
            messages: [
              createSystemMessage(blockText, 'warning', undefined, true),
            ],
            shouldQuery: false,
            resultText: blockText,
            command,
          },
        }
      }
      if (result.preventContinuation) {
        const stopText = result.stopReason
          ? `Operation stopped by hook: ${result.stopReason}`
          : 'Operation stopped by hook'
        return {
          blocked: {
            messages: [
              createUserMessage({ content: stopText, isMeta: true }),
              createSystemMessage(stopText, 'warning', undefined, true),
            ],
            shouldQuery: false,
            resultText: stopText,
            command,
          },
        }
      }
      if (result.additionalContexts?.length) {
        hookMessages.push(
          createAttachmentMessage({
            type: 'hook_additional_context',
            content: result.additionalContexts.map(escapeSystemReminderTags),
            hookName: 'UserPromptExpansion',
            toolUseID: `hook-${randomUUID()}`,
            hookEvent: 'UserPromptExpansion',
          }),
        )
      }
      const hookMessage = result.message
      if (
        hookMessage &&
        !(
          hookMessage.type === 'attachment' &&
          hookMessage.attachment?.type === 'hook_success' &&
          hookMessage.attachment.content === ''
        )
      ) {
        hookMessages.push(hookMessage as UserPromptExpansionMessage)
      }
    }
  } catch (err) {
    if (!(err instanceof ControlStreamClosedError)) {
      throw err
    }
    logForDebugging(
      'UserPromptExpansion hooks cancelled (control stream closed)',
    )
  }
  return { hookMessages }
}

/**
 * Execute session start hooks if configured
 * @param source The source of the session start (startup, resume, clear)
 * @param sessionId Optional The session id to use as hook input
 * @param agentType Optional The agent type (from --agent flag) running this session
 * @param model Optional The model being used for this session
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and hook results
 */
/** Official `ees` — keepalive holder id (refcount only, not mainLoopRefcount). */
const STARTUP_HOOK_HOLD = 'startup-hook-hold'

type SessionStartLateLoadPayload = {
  surface: string | null
  isInteractive: boolean
}

/**
 * densable `hn`. Unique English:
 * `session.start: raised for ${name} (loaded later)`.
 * Never export minify `hn`.
 */
function raiseSessionStartForLaterLoadedModules(
  mods: readonly LoadedFunctionHooksModule[],
  seen: WeakSet<LoadedFunctionHooksModule>,
  payload: SessionStartLateLoadPayload,
  signal?: AbortSignal,
  orphaned?: AbortSignal,
): void {
  if (signal?.aborted || orphaned?.aborted) return
  const effectiveSignal =
    signal && orphaned
      ? AbortSignal.any([signal, orphaned])
      : (signal ?? orphaned)
  for (const mod of mods) {
    if (signal?.aborted || orphaned?.aborted) return
    if (seen.has(mod)) continue
    seen.add(mod)
    if (!hasMatchingFunctionHook('session.start', undefined, [mod])) continue
    logForDebugging(`session.start: raised for ${mod.name} (loaded later)`)
    const name = mod.name
    const cwd = getCwd()
    Promise.resolve()
      .then(() => {
        if (signal?.aborted || orphaned?.aborted) return
        return runFunctionHookChain(
          'session.start',
          {
            cwd,
            surface: payload.surface,
            isInteractive: payload.isInteractive,
          },
          async () => ({ cwd }),
          name,
          undefined,
          effectiveSignal ? { signal: effectiveSignal } : undefined,
        )
      })
      .catch((err: unknown) => {
        logForDebugging(
          `session.start: failed for ${name}: ${errorMessage(err)}`,
          { level: 'error' },
        )
      })
  }
}

/** densable `yn` `Azn.set`. Never export minify `yn`. */
function armLaterLoadedSessionStart(
  payload: SessionStartLateLoadPayload,
  signal?: AbortSignal,
  orphaned?: AbortSignal,
): void {
  const seen = new WeakSet<LoadedFunctionHooksModule>(
    getLoadedFunctionHooksModules(),
  )
  setLaterLoadedSessionStart(mods =>
    raiseSessionStartForLaterLoadedModules(
      mods,
      seen,
      payload,
      signal,
      orphaned,
    ),
  )
}

export async function* executeSessionStartHooks(
  // densable 2.1.214 #47: source enum includes "fork"
  source: 'startup' | 'resume' | 'clear' | 'compact' | 'fork',
  sessionId?: string,
  agentType?: string,
  model?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  forceSyncExecution?: boolean,
  messages?: Message[],
  sessionStartOptions?: SessionStartHookExecutionOptions,
): AsyncGenerator<AggregatedHookResult> {
  const orphaned = sessionStartOptions?.orphaned
  const storageV5 = sessionStartOptions?.storageV5 ?? getPinnedStorageV5()
  if (orphaned?.aborted) {
    return
  }
  const effectiveSignal =
    signal && orphaned
      ? AbortSignal.any([signal, orphaned])
      : (signal ?? orphaned)
  const resolvedId = sessionId ?? getSessionId()
  const resumeFields =
    (source === 'resume' || source === 'fork') && messages
      ? KSn(messages, model, resolvedId)
      : {}
  // 2.1.323 #2103: forward agent_id and agent_type on post-compaction SessionStart hooks
  const activeAgentCtx = getAgentContext()
  const resolvedAgentId =
    sessionStartOptions?.agentId ?? activeAgentCtx?.agentId
  const resolvedAgentType =
    agentType ??
    (activeAgentCtx?.agentType === 'subagent'
      ? activeAgentCtx.subagentName
      : undefined)
  const hookInput: SessionStartHookInput = {
    ...createBaseHookInput(undefined, sessionId, {
      agentId: resolvedAgentId,
      agentType: resolvedAgentType,
    }),
    hook_event_name: 'SessionStart',
    source,
    agent_type: resolvedAgentType,
    model,
    session_title: getCurrentSessionTitle(asSessionId(resolvedId)),
    ...resumeFields,
  }

  // Official flo: ihr("hook_exec", ees) / try yield* S2 / finally shr
  startSessionActivity('hook_exec', STARTUP_HOOK_HOLD)
  try {
    if (
      source !== 'clear' &&
      source !== 'compact' &&
      !isBareMode() &&
      !shouldDisableAllHooksIncludingManaged()
    ) {
      const isInteractive = !getIsNonInteractiveSession()
      const cwd = getCwd()
      const surface = isInteractive ? 'terminal' : null
      // densable leftover `yn` — WeakSet snapshot + Azn.set, then session.start.
      armLaterLoadedSessionStart({ surface, isInteractive }, signal, orphaned)
      if (hasMatchingFunctionHook('session.start')) {
        logForDebugging(
          `session.start: raised (surface ${surface ?? 'none'}, ${isInteractive ? 'interactive' : 'not interactive'})`,
        )
        try {
          await runFunctionHookChain(
            'session.start',
            {
              cwd,
              surface,
              isInteractive,
            },
            async () => ({ cwd }),
            undefined,
            undefined,
            effectiveSignal ? { signal: effectiveSignal } : undefined,
          )
        } catch (err) {
          logForDebugging(`session.start: failed: ${errorMessage(err)}`, {
            level: 'error',
          })
        }
        if (getPluginRegisteredCommands().length > 0) {
          const { clearCommandMemoizationCaches } = await import(
            '../../commands.js'
          )
          clearCommandMemoizationCaches()
          try {
            const { notifySkillsInvalidated } = await import(
              '../skills/skillChangeDetector.js'
            )
            notifySkillsInvalidated()
          } catch {
            // optional in isolated tests
          }
        }
      }
    }
    if (orphaned?.aborted) {
      return
    }
    yield* executeHooks({
      hookInput,
      toolUseID: randomUUID(),
      matchQuery: source,
      signal: effectiveSignal,
      timeoutMs,
      forceSyncExecution,
      sessionStartOptions,
      storageV5,
    })
  } finally {
    invalidateSessionEnvCache()
    stopSessionActivity('hook_exec', STARTUP_HOOK_HOLD)
  }
}

export type PreModelSwitchDecision =
  | { decision: 'block'; reason: string; messages: string[] }
  | { decision: 'ask'; reason: string | undefined; messages: string[] }
  | { decision: 'proceed'; skipConfirm: boolean; messages: string[] }

/** densable dD */
function hasPreModelSwitchHooks(session: { id: string }): boolean {
  if (nVn()) return true
  return hasHookForEvent('PreModelSwitch', undefined, session.id)
}

/**
 * densable hdt — PreModelSwitch. yield* executeHooks (local z_).
 * Block / ask / proceed+skipConfirm per gold-a.
 */
export async function executePreModelSwitchHooks(
  switchTo: ModelSwitchRequest,
  messages: Message[] = [],
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PreModelSwitchDecision> {
  const session = getModelSwitchSession()
  const collected: string[] = []
  await Osn()
  if (await Lsn(true)) {
    return {
      decision: 'block',
      reason:
        'plugin hooks could not be loaded, so PreModelSwitch hooks could not be checked; see the debug log',
      messages: collected,
    }
  }
  if (!hasPreModelSwitchHooks(session)) {
    return { decision: 'proceed', skipConfirm: false, messages: collected }
  }
  if (cre(switchTo.toModel)) await hJ(switchTo.toModel)
  const contextTokens = contextTokensAfterCompact(messages)
  const hookInput: PreModelSwitchHookInput = {
    ...createBaseHookInput(undefined, session.id),
    hook_event_name: 'PreModelSwitch',
    from_model: switchTo.fromModel,
    to_model: switchTo.toModel,
    requested_model: switchTo.requestedModel,
    source: switchTo.source,
    ...Ewe(switchTo.toModel, contextTokens),
  }
  const matchQuery = LOe(switchTo.toModel) ? switchTo.toModel : undefined
  let blockReason: string | undefined
  let askReason: string | undefined
  let asked = false
  let skipConfirm = false
  void Kle.of(session)
  try {
    for await (const result of executeHooks({
      hookInput,
      toolUseID: modelSwitchToolUseId(),
      matchQuery,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? Hye,
    })) {
      yBn(result.message, collected)
      const attachment =
        result.message?.type === 'attachment'
          ? result.message.attachment
          : undefined
      if (
        attachment?.type === 'hook_cancelled' &&
        !opts.signal?.aborted &&
        attachment.hookName
      ) {
        blockReason ??= `PreModelSwitch hook ${attachment.hookName} did not respond before its timeout`
      }
      if (result.blockingError) {
        blockReason ??= result.blockingError.blockingError
      } else if (result.permissionBehavior === 'ask') {
        asked = true
        askReason ??= result.hookPermissionDecisionReason
      } else if (result.permissionBehavior === 'allow') {
        skipConfirm = true
      }
    }
  } catch (err) {
    const closed = err instanceof ControlStreamClosedError
    logError(
      new Error(
        `PreModelSwitch hooks did not complete: ${closed ? 'control stream closed' : String(err)}`,
      ),
    )
    blockReason ??= closed
      ? 'PreModelSwitch hooks were cancelled (the control stream closed) before answering'
      : 'a PreModelSwitch hook failed before answering'
  }
  if (blockReason !== undefined) {
    return { decision: 'block', reason: blockReason, messages: collected }
  }
  if (asked) {
    return { decision: 'ask', reason: askReason, messages: collected }
  }
  return { decision: 'proceed', skipConfirm, messages: collected }
}

/**
 * densable ydt — PostModelSwitch. Fire-and-forget; stores pending on yEt.
 */
export function executePostModelSwitchHooks(
  switchTo: ModelSwitchRequest,
  messages: Message[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  const session = getModelSwitchSession()
  const store = yEt.of(session)
  const sessionId = session.id
  store.landedOn = { sessionId, toModel: switchTo.toModel }
  const run = (async () => {
    await Osn()
    if (await Lsn(false)) {
      logError(
        new Error(
          'PostModelSwitch: plugin hooks could not be loaded; plugin-delivered hooks are missing from this run',
        ),
      )
    }
    if (cre(switchTo.toModel)) await hJ(switchTo.toModel)
    const contextTokens = contextTokensAfterCompact(messages)
    const hookInput: PostModelSwitchHookInput = {
      ...createBaseHookInput(undefined, sessionId),
      hook_event_name: 'PostModelSwitch',
      from_model: switchTo.fromModel,
      to_model: switchTo.toModel,
      requested_model: switchTo.requestedModel,
      source: switchTo.source,
      ...Ewe(switchTo.toModel, contextTokens),
    }
    const matchQuery = LOe(switchTo.toModel) ? switchTo.toModel : undefined
    const contexts: string[] = []
    const hookMessages: HookResultMessage[] = []
    try {
      for await (const result of executeHooks({
        hookInput,
        toolUseID: modelSwitchToolUseId(),
        matchQuery,
        timeoutMs: opts.timeoutMs ?? Hye,
      })) {
        if (result.additionalContexts) {
          contexts.push(...result.additionalContexts)
        }
        if (result.message?.type === 'attachment') {
          const att = result.message.attachment
          if (att?.type === 'hook_success' && 'content' in att && att.content) {
            if (typeof att.content === 'string') contexts.push(att.content)
          }
          if (att?.type !== 'hook_blocking_error') {
            hookMessages.push(result.message)
          }
        }
        if (result.blockingError) {
          hookMessages.push(
            createAttachmentMessage({
              type: 'hook_blocking_error',
              hookName: 'PostModelSwitch',
              toolUseID: `PostModelSwitch:${switchTo.toModel}`,
              hookEvent: 'PostModelSwitch',
              blockingError: result.blockingError,
            }),
          )
        }
      }
    } catch (err) {
      const closed = err instanceof ControlStreamClosedError
      if (closed) {
        logForDebugging(
          'PostModelSwitch hooks cancelled (control stream closed)',
          { level: 'debug' },
        )
      } else {
        logError(new Error(`PostModelSwitch hooks failed: ${String(err)}`))
      }
    }
    if (contexts.length > 0 || hookMessages.length > 0) {
      store.pending.push({
        sessionId,
        toModel: switchTo.toModel,
        contexts,
        messages: hookMessages,
      })
    }
  })()
    .catch(err => {
      logError(new Error(`PostModelSwitch hooks failed: ${String(err)}`))
    })
    .finally(() => {
      store.inFlight.delete(run)
    })
  store.inFlight.add(run)
  return run
}

/**
 * Execute setup hooks if configured
 * @param trigger The trigger type ('init' or 'maintenance')
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @param forceSyncExecution If true, async hooks will not be backgrounded
 * @returns Async generator that yields progress messages and hook results
 */
export async function* executeSetupHooks(
  trigger: 'init' | 'maintenance',
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  forceSyncExecution?: boolean,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: SetupHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'Setup',
    trigger,
  }

  // Official mlo: ihr("hook_exec", ees) / try yield* S2 / finally shr
  startSessionActivity('hook_exec', STARTUP_HOOK_HOLD)
  try {
    yield* executeHooks({
      hookInput,
      toolUseID: randomUUID(),
      matchQuery: trigger,
      signal,
      timeoutMs,
      forceSyncExecution,
    })
  } finally {
    invalidateSessionEnvCache()
    stopSessionActivity('hook_exec', STARTUP_HOOK_HOLD)
  }
}

/**
 * Execute subagent start hooks if configured
 * @param agentId The unique identifier for the subagent
 * @param agentType The type/name of the subagent being started
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and hook results
 */
export async function* executeSubagentStartHooks(
  agentId: string,
  agentType: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  storageV5?: unknown,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: SubagentStartHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'SubagentStart',
    agent_id: agentId,
    agent_type: agentType,
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    matchQuery: agentType,
    signal,
    timeoutMs,
    storageV5: storageV5 ?? getPinnedStorageV5(),
  })
}

/**
 * densable GCr — MessageDisplay hook flush generator.
 * forceSyncExecution + suppressPerInvocationTelemetry for streaming hot path.
 */
export async function* executeMessageDisplayHooks(
  params: {
    turnId: string
    messageId: string
    index: number
    final: boolean
    delta: string
  },
  getAppState: () => AppState,
  signal?: AbortSignal,
  timeoutMs: number = 10_000,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: MessageDisplayHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'MessageDisplay',
    turn_id: params.turnId,
    message_id: params.messageId,
    index: params.index,
    final: params.final,
    delta: params.delta,
  }
  yield* executeHooks({
    hookInput,
    toolUseID: `${params.messageId}-${params.index}`,
    signal,
    timeoutMs,
    forceSyncExecution: true,
    // densable suppressPerInvocationTelemetry — keep stream path quiet
    suppressPerInvocationTelemetry: true,
    toolUseContext: {
      getAppState,
    } as ToolUseContext,
  })
}
