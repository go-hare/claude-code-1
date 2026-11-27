import { feature } from 'bun:bundle'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  POLL_CHUNK_MAX_BYTES,
  POLL_CHUNK_MAX_EVENTS,
} from '@claude-code/builtin-tools/tools/PollTool/constants.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import type { QuerySource } from '../constants/querySource.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getAutoCompactThreshold,
  getEffectiveContextWindowSize,
} from '../services/compact/autoCompact.js'
import { findToolByName, type ToolUseContext } from '../Tool.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../types/message.js'
import type { QueuedCommand } from '../types/textInputTypes.js'
import { getAgentContext, runWithAgentContext } from '../utils/agentContext.js'
import {
  createAttachmentMessage,
  getQueuedCommandAttachments,
} from '../utils/attachments.js'
import { notifyCommandLifecycle } from '../utils/commandLifecycle.js'
import { getContextWindowForModel } from '../utils/context.js'
import { logForDebugging } from '../utils/debug.js'
import { isAbortError } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import {
  consume as consumeFromQueue,
  getCommandsByMaxPriority,
  isMidTurnFoldSuspended,
  registerFoldInFlight,
  unregisterFoldInFlight,
  wasPutBack,
} from '../utils/messageQueueManager.js'
import { createAssistantAPIErrorMessage } from '../utils/messages.js'
import { getModelFacts, type ModelFacts } from '../utils/model/modelFacts.js'
import { getBootstrapSession, RootSessionSlot } from '../utils/sessionRoot.js'
import {
  getMaxOutputTokensRecoveryPrompt,
  querySourceFamilyOf,
} from './queryHelpers.js'
import type {
  AmberMoleskinTable,
  ObserverActivityTap,
  QueryLoopEvent,
  QueryParams,
} from './queryTypes.js'
import type { Terminal } from './transitions.js'

/**
 * densable `OS` @186864583 sha=`97e1299be7b26e5e`.
 * Gold: `let o=cT(e); if(!Jh||!o||!t.startsWith("repl_main_thread")||e.agentId)return;
 * Jh().markApiFailure(o,pu(),r.error,ex(r)??r.errorDetails??"",r.apiError).catch(()=>{})`
 */
export function OS(
  e: { agentId?: string },
  t: string,
  r: {
    error?: unknown
    errorDetails?: unknown
    apiError?: unknown
  },
): void {
  const o = undefined as unknown
  const Jh = undefined as
    | undefined
    | (() => {
        markApiFailure: (
          costHandle: unknown,
          now: unknown,
          error: unknown,
          details: unknown,
          apiError: unknown,
        ) => Promise<void>
      })
  if (!Jh || !o || !t.startsWith('repl_main_thread') || e.agentId) return
  const details =
    (typeof r.errorDetails === 'string' ? r.errorDetails : undefined) ?? ''
  void Jh()
    .markApiFailure(o, Date.now(), r.error, details, r.apiError)
    .catch(() => {})
}

function parseAmberMoleskinFraction(value: unknown): number | null {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value < 1
  ) {
    return value
  }
  return null
}

function parseAmberMoleskinEntry(
  value: unknown,
): { repl: number; sdk: number } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const rec = value as Record<string, unknown>
  const repl = parseAmberMoleskinFraction(rec.repl)
  const sdk = parseAmberMoleskinFraction(rec.sdk)
  return repl === null || sdk === null ? null : { repl, sdk }
}

/** Official JEn — parse `tengu_amber_moleskin` window-keyed precompute table. */
export function parseAmberMoleskinTable(
  raw: unknown,
): AmberMoleskinTable | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const entries: Array<{ windowSize: number; repl: number; sdk: number }> = []
  let defaultEntry: { repl: number; sdk: number } | null = null
  for (const [key, val] of Object.entries(raw)) {
    const parsed = parseAmberMoleskinEntry(val)
    if (parsed === null) return null
    if (key === 'default') {
      defaultEntry = parsed
      continue
    }
    const windowSize = Number(key)
    if (!Number.isSafeInteger(windowSize) || windowSize <= 0) return null
    entries.push({ windowSize, ...parsed })
  }
  if (entries.length === 0 && defaultEntry === null) return null
  return { entries, defaultEntry }
}

/** Official Nlt — resolve precompute buffer fraction from `tengu_amber_moleskin`. */
export function resolvePrecomputeBufferFraction(
  tableValue: unknown,
  windowSize: number,
  entrypoint: string | undefined,
  fallbackFraction: number,
): {
  fraction: number
  source:
    | 'scalar'
    | 'malformed'
    | 'table_no_match'
    | 'table_exact'
    | 'table_default'
  matchedWindowKey?: number
} {
  if (tableValue === null || tableValue === undefined) {
    return { fraction: fallbackFraction, source: 'scalar' }
  }
  const table = parseAmberMoleskinTable(tableValue)
  if (table === null) {
    return { fraction: fallbackFraction, source: 'malformed' }
  }
  const kind = entrypoint === 'sdk' ? 'sdk' : 'repl'
  const exact = table.entries.find(e => e.windowSize === windowSize)
  if (exact !== undefined) {
    return {
      fraction: exact[kind],
      source: 'table_exact',
      matchedWindowKey: exact.windowSize,
    }
  }
  if (table.defaultEntry === null) {
    return { fraction: fallbackFraction, source: 'table_no_match' }
  }
  return { fraction: table.defaultEntry[kind], source: 'table_default' }
}

const DEFAULT_PRECOMPUTE_BUFFER_FRACTION = 0.2
const precomputeArmTableMalformedSlot = new RootSessionSlot<{
  logged: boolean
}>(() => ({ logged: false }))

/** Official 2.1.328 `Pkt()` (`tengu_amber_rokovoko`, default `oBe = 0.2`). */
export function getScalarPrecomputeBufferFraction(): number {
  const val = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_amber_rokovoko',
    DEFAULT_PRECOMPUTE_BUFFER_FRACTION,
  )
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val < 1
    ? val
    : DEFAULT_PRECOMPUTE_BUFFER_FRACTION
}

/**
 * Official 2.1.328 `Okt` (`chunk@294254613.js @2075971`): resolve the live
 * precompute buffer fraction from `tengu_amber_moleskin` (falling back to
 * `tengu_amber_rokovoko` / `0.2`) and emit a one-shot malformed-table event.
 */
export function resolveLivePrecomputeBufferFraction(
  model: string,
  querySource: string | undefined,
): ReturnType<typeof resolvePrecomputeBufferFraction> {
  const rawTable = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_amber_moleskin',
    null,
  )
  const windowSize = getContextWindowForModel(model)
  const resolved = resolvePrecomputeBufferFraction(
    rawTable,
    windowSize,
    querySource,
    getScalarPrecomputeBufferFraction(),
  )
  const malformedSlot = precomputeArmTableMalformedSlot.of(
    getBootstrapSession(),
  )
  if (resolved.source === 'malformed' && !malformedSlot.logged) {
    malformedSlot.logged = true
    logEvent('tengu_precompute_arm_table_malformed', {
      payloadType: (Array.isArray(rawTable)
        ? 'array'
        : typeof rawTable) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  return resolved
}

/**
 * Official 2.1.328 `wWn` / `MWn` (`chunk@294254613.js @2068650`): compute the
 * live precompute arming threshold in tokens from `resolvePrecomputeBufferFraction`.
 */
export function getPrecomputeArmThreshold(
  model: string,
  querySource: string | undefined,
): ReturnType<typeof resolvePrecomputeBufferFraction> & {
  threshold: number
  effectiveWindow: number
} {
  const effectiveWindow = getEffectiveContextWindowSize(model)
  const resolved = resolveLivePrecomputeBufferFraction(model, querySource)
  const autoCompactThreshold = getAutoCompactThreshold(model, { querySource })
  const threshold = Math.min(
    effectiveWindow - Math.round(effectiveWindow * resolved.fraction),
    autoCompactThreshold,
  )
  return {
    ...resolved,
    threshold,
    effectiveWindow,
  }
}

const GOAL_TOOL_NAMES = new Set([
  'SetGoal',
  'ProposeGoal',
  'PauseGoal',
  'GetGoal',
])

/** Official 2.1.328 `cf` (`chunk@305854618.js @207056`): preserve stopHookBlockCount on goal-only tool turns. */
export function isGoalToolsOnly(blocks: readonly ToolUseBlock[]): boolean {
  return blocks.length > 0 && blocks.every(b => GOAL_TOOL_NAMES.has(b.name))
}

/**
 * Official 2.1.328 `wSr` / `Iir` (`chunk@294254613.js:756964`): non-mutating
 * 20-event / 32KB group-preserving poll-event slice so aborting during
 * attachment building leaves events safely queued.
 */
export function selectPollEventChunk(
  pollEvents: readonly QueuedCommand[],
): QueuedCommand[] {
  if (pollEvents.length === 0) return []
  const chunk: QueuedCommand[] = []
  let bytes = 0
  for (let i = 0; i < pollEvents.length; ) {
    const groupId = (pollEvents[i]!.pollEvent as { group?: string } | undefined)
      ?.group
    let end = i + 1
    while (
      groupId !== undefined &&
      end < pollEvents.length &&
      (pollEvents[end]!.pollEvent as { group?: string } | undefined)?.group ===
        groupId
    ) {
      end++
    }
    const group = pollEvents.slice(i, end)
    const groupBytes = group.reduce(
      (sum, cmd) =>
        sum + Buffer.byteLength(cmd.pollEvent?.envelope ?? '', 'utf8'),
      0,
    )
    if (
      chunk.length > 0 &&
      (chunk.length + group.length > POLL_CHUNK_MAX_EVENTS ||
        bytes + groupBytes > POLL_CHUNK_MAX_BYTES)
    ) {
      break
    }
    chunk.push(...group)
    bytes += groupBytes
    i = end
  }
  return chunk
}

/** Official 2.1.328 `Xus` (`chunk@285203830.js @12178`): max_tokens cut inside a tool call. */
export const TOOL_CALL_CUT_RECOVERY_PROMPT =
  'Your response was cut off because it exceeded the output token limit. The cut fell inside a tool call, so that call did not run and nothing of it was kept. Make the call again in a shorter response: split long content across several smaller tool calls. For a long file, write the first part and then append the rest in later calls.'

/** Official 2.1.328 `qus` (`chunk@285203830.js @11247`): max_tokens cut in finished text block (reopen fence/table). */
export const REOPEN_BLOCK_RECOVERY_PROMPT =
  'Your response was cut off because it exceeded the output token limit. Continue from where you left off and finish the response. Start a new code fence or table header first if you were inside one.'

/** Official 2.1.328 `CHn` (`chunk@285203830.js @9869`): MCP endTurn overridden by failed sibling tool call. */
export const MCP_END_TURN_FAILED_SIBLING_OVERRIDE_PROMPT =
  'The turn did not end: a tool call in your last message asked to end it, but another call in that message failed. Deal with the failure, then finish the turn. The calls that succeeded took effect, so do not repeat them.'

/** Official 2.1.328 `amo` / `Kus` (`chunk@285203830.js @10150`): same-model refusal retry nudge. */
export const SAME_MODEL_REFUSAL_RETRY_PROMPT =
  'Your response above was stopped by a safety classifier — this is not a tool or API error. The rest of it was withheld, and tool calls in it that had not finished did not run. Do not produce that content again, even reworded.'

export const SAME_MODEL_REFUSAL_RETRY_INTERRUPTED_PROMPT = `${SAME_MODEL_REFUSAL_RETRY_PROMPT} Exception: a tool call whose result reads "Interrupted" was already running when stopped, so some of its effects may have happened.`

export const MAX_SERVER_ERROR_CUT_RETRIES = 5

export function buildCutRetryWaitMessage(
  error: unknown,
  retryInMs: number,
  retryAttempt: number,
  uuid: () => string,
): SystemAPIErrorMessage {
  return {
    type: 'system' as const,
    subtype: 'api_error' as const,
    level: 'error' as const,
    error,
    retryInMs,
    retryAttempt,
    maxRetries: MAX_SERVER_ERROR_CUT_RETRIES,
    source: 'cut_retry',
    timestamp: new Date().toISOString(),
    uuid: uuid(),
  } as unknown as SystemAPIErrorMessage
}

export function isSafetyMonitorBlockedMessage(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return (
    msg?.type === 'assistant' &&
    msg.isApiErrorMessage === true &&
    msg.apiError === 'safety_monitor_blocked'
  )
}

export function isSameModelRefusalMessage(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return (
    msg?.type === 'assistant' &&
    msg.isApiErrorMessage === true &&
    (msg.message as { stop_reason?: unknown } | undefined)?.stop_reason ===
      'refusal'
  )
}

export function isSameModelRefusalRetryArmed(
  querySource: QuerySource,
  refusalRetrySpent: boolean,
): boolean {
  if (refusalRetrySpent) return false
  if (querySourceFamilyOf(querySource) === 'auxiliary') return false
  if (
    process.env.CLAUDE_CODE_DISABLE_REFUSAL_RETRY === '1' ||
    process.env.CLAUDE_CODE_DISABLE_REFUSAL_RETRY === 'true'
  ) {
    return false
  }
  return true
}

/**
 * Official 2.1.328 `x_` (`chunk@305854618.js @166703`): single non-error
 * assistant message containing only an incomplete thinking block cut at
 * `max_tokens` with server `resumable === true`.
 */
export function canResumeIncompleteThinking(
  responses: readonly AssistantMessage[],
): boolean {
  const nonError = responses.filter(m => !m.isApiErrorMessage)
  if (nonError.length !== 1) return false
  const msg = nonError[0]!
  const content = msg.message?.content
  if (!Array.isArray(content) || content.length !== 1) return false
  const firstBlock = content[0] as { type?: string } | undefined
  if (
    firstBlock?.type !== 'thinking' &&
    firstBlock?.type !== 'redacted_thinking'
  ) {
    return false
  }
  const inner = msg.message as unknown as {
    stop_reason?: unknown
    resumable?: unknown
  }
  return inner.stop_reason === 'max_tokens' && inner.resumable === true
}

/**
 * Official 2.1.328 `O_` (`chunk@305854618.js @167100`): select specific
 * `max_tokens` recovery nudge (`tool_call_cut` / `reopen_block` / default).
 */
export function selectMaxOutputTokensRecoveryPrompt(
  responses: readonly AssistantMessage[],
  isSubagent: boolean,
  attempt: number,
): string {
  const toolCallCut = responses.some(
    m =>
      (m as AssistantMessage & { toolCallCutAtOutputLimit?: boolean })
        .toolCallCutAtOutputLimit === true,
  )
  if (toolCallCut) {
    return TOOL_CALL_CUT_RECOVERY_PROMPT
  }
  const lastNonError = responses.findLast(m => !m.isApiErrorMessage)
  const content = lastNonError?.message?.content
  const lastBlock = Array.isArray(content)
    ? (content.at(-1) as { type?: string; text?: string } | undefined)
    : undefined
  const endedInNonEmptyText =
    lastNonError?.message?.stop_reason === 'max_tokens' &&
    lastBlock?.type === 'text' &&
    typeof lastBlock.text === 'string' &&
    lastBlock.text.trim() !== '' &&
    !responses.some(
      m =>
        (m as AssistantMessage & { cutInUnfinishedBlock?: boolean })
          .cutInUnfinishedBlock === true,
    )
  if (!isSubagent && endedInNonEmptyText) {
    return REOPEN_BLOCK_RECOVERY_PROMPT
  }
  return getMaxOutputTokensRecoveryPrompt(isSubagent, attempt)
}

/**
 * Official 2.1.325 #2356: propagate `querySource` and scheduled-task / `/loop`
 * execution flags into `ToolUseContext.options` so `SkillTool`
 * (`isScheduledOrLoopSkillExecution`) asks before running skills declaring
 * `allowed-tools` or `hooks`.
 */
export function buildPropagatedToolUseOptions(
  params: QueryParams,
): ToolUseContext['options'] {
  const existingToolOpts = params.toolUseContext
    .options as ToolUseContext['options'] & {
    isCron?: boolean
    isScheduledTask?: boolean
    isLoop?: boolean
  }
  const effectiveQuerySource =
    existingToolOpts.querySource ?? params.querySource
  let turnTriggeredByScheduledFire = false
  let turnOriginKind: string | undefined
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i]
    if (!m) continue
    if (m.type === 'assistant') break
    if (
      m.type === 'system' &&
      (m as { subtype?: unknown }).subtype === 'scheduled_task_fire'
    ) {
      turnTriggeredByScheduledFire = true
      break
    }
    if (m.type === 'user' && !m.isMeta) {
      const originKind = (m as { origin?: { kind?: string } }).origin?.kind
      if (originKind) {
        turnOriginKind = originKind
      }
      if (
        originKind === 'cron' ||
        originKind === 'scheduled' ||
        originKind === 'loop'
      ) {
        turnTriggeredByScheduledFire = true
        break
      }
    }
  }
  const querySourceMatchesScheduledOrLoop =
    typeof effectiveQuerySource === 'string' &&
    /(?:^|_)(?:cron|schedule|scheduled|loop)(?:$|_)/i.test(effectiveQuerySource)
  const isScheduledOrLoop =
    existingToolOpts.isCron === true ||
    existingToolOpts.isScheduledTask === true ||
    existingToolOpts.isLoop === true ||
    turnTriggeredByScheduledFire ||
    querySourceMatchesScheduledOrLoop
  const isLoopTurn =
    existingToolOpts.isLoop === true ||
    turnOriginKind === 'loop' ||
    (typeof effectiveQuerySource === 'string' &&
      /(?:^|_)loop(?:$|_)/i.test(effectiveQuerySource))
  return {
    ...existingToolOpts,
    querySource: effectiveQuerySource,
    ...(isScheduledOrLoop
      ? {
          isCron: true,
          isScheduledTask: true,
          isLoop: isLoopTurn,
        }
      : {}),
  } as ToolUseContext['options']
}

/**
 * Official queryWithObserverTap / VOu: arm main-session observer host when
 * mainThreadAgent declares `observer:`, and create the activity tap.
 */
export async function setupMainSessionObserverAndTap(
  paramsWithTrace: QueryParams,
): Promise<ObserverActivityTap | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      createObserverActivityTap,
      ensureMainSessionObserver,
      getQuerySourceFamily,
    } =
      require('../utils/observerAgents.js') as typeof import('../utils/observerAgents.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMainThreadAgentType } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    if (getQuerySourceFamily(paramsWithTrace.querySource) === 'main') {
      const activeAgents =
        paramsWithTrace.toolUseContext.options.agentDefinitions?.activeAgents ??
        []
      const mainType = getMainThreadAgentType()
      const mainAgentDefinition = mainType
        ? activeAgents.find(a => a.agentType === mainType)
        : undefined
      if (mainAgentDefinition?.observer) {
        const ensurePromise = (async () => {
          try {
            const { installAgentObserverRuntimeHost } = await import(
              '@claude-code/builtin-tools/tools/AgentTool/observerRuntimeHost.js'
            )
            await installAgentObserverRuntimeHost({
              toolUseContext: paramsWithTrace.toolUseContext,
              canUseTool: paramsWithTrace.canUseTool,
              setAppState:
                paramsWithTrace.toolUseContext.setAppStateForTasks ??
                paramsWithTrace.toolUseContext.setAppState,
              log: msg => logForDebugging(msg),
            })
          } catch (err) {
            logForDebugging(
              `[agentObserver] real host install failed (arm may refuse first-run): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
          const armCtx = paramsWithTrace.toolUseContext
          let armingPermissionMode: string | undefined
          try {
            armingPermissionMode =
              armCtx.getAppState().toolPermissionContext.mode
          } catch {
            armingPermissionMode = undefined
          }
          const { createAgentId } = await import('src/utils/uuid.js')
          return ensureMainSessionObserver({
            mainAgentDefinition,
            activeAgents,
            armingToolUseContext: armCtx,
            canUseTool: paramsWithTrace.canUseTool,
            setAppState: armCtx.setAppStateForTasks ?? armCtx.setAppState,
            ...(armingPermissionMode !== undefined
              ? { armingPermissionMode }
              : {}),
            generateObserverTaskId: () => createAgentId(),
            tools: armCtx.options.tools?.map(t => ({
              name: t.name,
              ...(t.aliases ? { aliases: t.aliases } : {}),
            })),
            allowedAgentTypes:
              armCtx.options.agentDefinitions?.allowedAgentTypes,
            gateCanUseTool: async ({
              subagentType,
              description: gateDesc,
              prompt: gatePrompt,
            }) => {
              const agentTool =
                findToolByName(armCtx.options.tools, 'Agent') ??
                findToolByName(armCtx.options.tools, 'Task')
              if (!agentTool) return 'deny'
              try {
                const result = await agentTool.checkPermissions(
                  {
                    description: gateDesc,
                    prompt: gatePrompt,
                    subagent_type: subagentType,
                    run_in_background: true,
                  },
                  armCtx,
                )
                if (result.behavior === 'allow') return 'allow'
                if (result.behavior === 'deny') return 'deny'
                if (result.behavior === 'ask') return 'ask'
                return 'allow'
              } catch {
                return 'error'
              }
            },
            isObserverProcessRunning: observerTaskId => {
              try {
                const task = armCtx.getAppState().tasks?.[observerTaskId] as
                  | { type?: string; status?: string }
                  | undefined
                return task?.type === 'local_agent' && task.status === 'running'
              } catch {
                return false
              }
            },
            log: msg => logForDebugging(msg),
          })
        })()
        const nonInteractive =
          paramsWithTrace.toolUseContext.options.isNonInteractiveSession ===
          true
        if (nonInteractive) {
          try {
            await ensurePromise
          } catch (err) {
            logForDebugging(
              `[agentObserver] non-interactive arm failed (degrading to unobserved): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        } else {
          void ensurePromise.catch(err => {
            logForDebugging(
              `[agentObserver] main-session ensure failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          })
        }
      }
    }
    return createObserverActivityTap({
      querySource: paramsWithTrace.querySource,
      toolUseContext: paramsWithTrace.toolUseContext,
      messages: paramsWithTrace.messages,
      turnStartIndex: 0,
      log: msg => logForDebugging(msg),
    })
  } catch {
    return null
  }
}

/**
 * Official 2.1.328 turn-start poll-event fold (`chunk@305854618.js @226800-227600`).
 */
export async function* drainTurnStartPollEvents(deps: {
  querySource: QuerySource
  toolUseContext: ToolUseContext
  messages: Message[]
  consumedCommandUuids: string[]
}): AsyncGenerator<Message, Message[]> {
  let messages = deps.messages
  const isMainThread =
    deps.querySource.startsWith('repl_main_thread') ||
    deps.querySource === 'sdk'
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isMainThreadQueuedCommand } =
    require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
  const rawTurnStartPoll = isMidTurnFoldSuspended()
    ? []
    : getCommandsByMaxPriority('next').filter(cmd => {
        if (cmd.mode !== 'poll-event') return false
        if (cmd.waitsOutStop === true || cmd.passive === true) return false
        if (isMainThread) return isMainThreadQueuedCommand(cmd)
        return cmd.agentId === deps.toolUseContext.agentId
      })
  const turnStartPoll = selectPollEventChunk(rawTurnStartPoll)
  if (turnStartPoll.length > 0) {
    registerFoldInFlight(turnStartPoll)
    try {
      const built = await getQueuedCommandAttachments(turnStartPoll)
      if (
        built.some(attachment => attachment.type === 'poll_events') &&
        !deps.toolUseContext.abortController.signal.aborted &&
        !isMidTurnFoldSuspended()
      ) {
        for (const att of built) {
          const msg = createAttachmentMessage(att)
          messages = [...messages, msg]
          yield msg
        }
        consumeFromQueue(turnStartPoll, { reason: 'absorbed_mid_turn' })
        for (const cmd of turnStartPoll) {
          if (cmd.uuid && !wasPutBack(cmd.uuid)) {
            deps.consumedCommandUuids.push(cmd.uuid)
            notifyCommandLifecycle(cmd.uuid, 'started')
          }
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        const { QUERY_TURN_START_POLL_EVENTS_ABORTED } = await import(
          '../cli/printControlExtras.js'
        )
        logForDebugging(QUERY_TURN_START_POLL_EVENTS_ABORTED)
      } else {
        logError(err)
      }
    } finally {
      unregisterFoldInFlight(turnStartPoll)
    }
  }
  return messages
}

/**
 * Official 2.1.323 #2103: preserve subagent identity during post-compaction
 * SessionStart('compact') hooks when running compaction inside a subagent.
 */
export async function runWithSubagentContextIfNeeded<T>(
  toolUseContext: ToolUseContext,
  querySource: QuerySource,
  fn: () => Promise<T>,
): Promise<T> {
  const activeAgentCtx = getAgentContext()
  if (
    !toolUseContext.agentId ||
    activeAgentCtx?.agentId === toolUseContext.agentId
  ) {
    return fn()
  }
  const subagentName =
    activeAgentCtx?.agentType === 'subagent' && activeAgentCtx.subagentName
      ? activeAgentCtx.subagentName
      : querySource?.startsWith('agent:builtin:')
        ? querySource.slice('agent:builtin:'.length)
        : querySource?.startsWith('agent:custom:')
          ? querySource.slice('agent:custom:'.length)
          : querySource?.startsWith('agent:')
            ? querySource.slice('agent:'.length)
            : undefined
  return runWithAgentContext(
    {
      agentId: toolUseContext.agentId,
      agentType: 'subagent',
      ...(subagentName ? { subagentName } : {}),
      isBackgroundAgent: toolUseContext.isBackgroundAgent,
    },
    fn,
  )
}

/**
 * Official model_fable_consent densable at query_setup (X6e + ORu).
 */
export async function* runFableOverageConsentGate(deps: {
  currentModel: string
  modelFacts: ModelFacts
  toolUseContext: ToolUseContext
  leftoverStampTurnEffort: (model: unknown) => void
  leftoverDrainSpinnerModes: () => Generator<QueryLoopEvent>
}): AsyncGenerator<
  QueryLoopEvent,
  | {
      action: 'continue'
      currentModel: string
      modelFacts: ModelFacts
      toolUseContext: ToolUseContext
    }
  | { action: 'return'; terminal: Terminal }
> {
  let { currentModel, modelFacts, toolUseContext } = deps
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      isFableModel,
      runFableOverageConsentFlow,
      shouldWatchFableParkCommandQueue,
    } =
      require('../utils/fableConsent.js') as typeof import('../utils/fableConsent.js')
    if (isFableModel(currentModel)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getOauthAccountInfo } =
        require('../utils/auth.js') as typeof import('../utils/auth.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getDefaultMainLoopModel } =
        require('../utils/model/model.js') as typeof import('../utils/model/model.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveFableBridgeDialogTimeoutMsOrDefault } =
        require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
      const oauth = getOauthAccountInfo()
      const defaultFallbackModel = getDefaultMainLoopModel()
      const fallbackAllowed =
        Boolean(defaultFallbackModel) && !isFableModel(defaultFallbackModel)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const {
        getFableSessionFallbackConsented,
        setFableSessionFallbackConsented,
      } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      const xo = shouldWatchFableParkCommandQueue()
      const flow = await runFableOverageConsentFlow({
        model: currentModel,
        requestDialog: toolUseContext.requestDialog ?? null,
        organizationUuid: oauth?.organizationUuid ?? null,
        accountUuid: oauth?.accountUuid ?? null,
        sessionFallbackConsented: getFableSessionFallbackConsented(),
        onSessionConsent: () => {
          setFableSessionFallbackConsented(true)
        },
        signal: toolUseContext.abortController.signal,
        parkTimeoutMs: xo
          ? resolveFableBridgeDialogTimeoutMsOrDefault()
          : undefined,
        fallbackModel: fallbackAllowed ? defaultFallbackModel : null,
        isFallbackAllowed: fallbackAllowed,
        overagesEnabled: true,
      })
      if (flow.reason === 'parent_aborted') {
        yield* deps.leftoverDrainSpinnerModes()
        return { action: 'return', terminal: { reason: 'aborted_streaming' } }
      }
      if (flow.shouldAbort) {
        yield createAssistantAPIErrorMessage({
          content:
            flow.errorMessage ??
            'Your model policy only allows Fable 5, which requires usage credits — /model to set it up',
          error: 'billing_error',
        })
        yield* deps.leftoverDrainSpinnerModes()
        return {
          action: 'return',
          terminal: {
            reason: 'model_error',
            error: new Error(flow.errorMessage ?? 'model_fable_consent'),
          },
        }
      }
      if (
        (flow.choice === 'switch_default' ||
          flow.reason === 'model_consent_fallback' ||
          flow.reason === 'dialog_declined' ||
          flow.reason === 'no_dialog_fallback') &&
        flow.fallbackModel
      ) {
        currentModel = flow.fallbackModel
        modelFacts = getModelFacts(currentModel)
        deps.leftoverStampTurnEffort(flow.fallbackModel)
        toolUseContext = {
          ...toolUseContext,
          options: {
            ...toolUseContext.options,
            mainLoopModel: flow.fallbackModel,
          },
        }
      }
      const { isUsageCreditsHintEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/rateLimitMessages.js') as typeof import('../services/rateLimitMessages.js')
      if (
        flow.choice === 'consent' &&
        flow.purchaseIntent?.next === 'open_purchase' &&
        isUsageCreditsHintEnabled()
      ) {
        const hint = flow.purchaseIntent.commandHint ?? '/usage-credits'
        toolUseContext.addNotification?.({
          key: 'fable-open-purchase',
          text: `Fable 5 needs usage credits — run ${hint} to buy, or /model to switch`,
          priority: 'immediate',
        })
      }
    }
  } catch {
    // densable optional — never block query on fable consent failures
  }
  return { action: 'continue', currentModel, modelFacts, toolUseContext }
}

/** Official B3s / KSa carriedEffort turn-start latch reconciliation. */
export function reconcileCarriedEffortLatch(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      getRefusalFallbackModelLatch,
      getMainLoopModelOverride,
      clearCarriedEffortFromLatch,
    } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    const latch = getRefusalFallbackModelLatch()
    if (latch?.carriedEffort !== undefined) {
      const killed = getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_loggia_passage',
        false,
      )
      const override = getMainLoopModelOverride()
      if (killed) {
        clearCarriedEffortFromLatch('kill_switch')
      } else if (
        override == null ||
        override.toLowerCase() !== latch.fallbackModel.toLowerCase()
      ) {
        clearCarriedEffortFromLatch('model_change')
      }
    }
  } catch {
    // carriedEffort reconciliation optional
  }
}

/**
 * Chicago MCP: auto-unhide + lock release on interrupt. Main thread only —
 * subagents must not release the main session's lock.
 */
export async function cleanupChicagoMcpIfMainThread(
  toolUseContext: ToolUseContext,
): Promise<void> {
  if (feature('CHICAGO_MCP')) {
    if (!toolUseContext.agentId) {
      try {
        const { cleanupComputerUseAfterTurn } = await import(
          '../utils/computerUse/cleanup.js'
        )
        await cleanupComputerUseAfterTurn(toolUseContext)
      } catch {
        // Failures are silent — this is dogfooding cleanup, not critical path
      }
    }
  }
}

export function bindPluginDevModsForIteration(
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bindPluginDevModsSession, restorePluginDevModsHost } =
      require('../utils/plugins/pluginDevMods.js') as typeof import('../utils/plugins/pluginDevMods.js')
    const { refreshActivePlugins } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/plugins/refresh.js') as typeof import('../utils/plugins/refresh.js')
    bindPluginDevModsSession({
      canUseTool,
      toolContext: ac => ({
        ...toolUseContext,
        abortController: ac,
      }),
      reloadPlugins: async () => {
        await refreshActivePlugins(toolUseContext.setAppState, {
          applyStagedInstalls: false,
        })
      },
    })
    restorePluginDevModsHost()
  } catch {
    // optional until plugin_dev_mods host is present
  }
}

/**
 * Clear JSC's native Performance buffers so OTel's globalThis.performance
 * marks/measures don't accumulate unbounded C++ memory across turns.
 */
export function clearNativePerformanceBuffers(): void {
  const gPerf = globalThis.performance
  if (gPerf && typeof gPerf.clearMarks === 'function') {
    try {
      gPerf.clearMarks()
      gPerf.clearMeasures?.()
      gPerf.clearResourceTimings?.()
    } catch {
      // Non-critical
    }
  }
}
