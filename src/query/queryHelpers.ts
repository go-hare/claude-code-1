import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { QuerySource } from '../constants/querySource.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import type { ToolUseContext } from '../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  StreamEvent,
  UserMessage,
} from '../types/message.js'
import type { AutonomyTurnOutcome } from '../utils/autonomyQueueLifecycle.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import { createUserMessage } from '../utils/messages.js'
import type { Continue, Terminal } from './transitions.js'

/** densable Acn / ip — tool_calls payload from the resolved batch. */
export function collectPostToolBatchCalls(
  toolUseBlocks: ToolUseBlock[],
  toolResults: Array<UserMessage | AttachmentMessage>,
): Array<{
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  tool_response?: unknown
}> {
  const responses = new Map<string, unknown>()
  for (const result of toolResults) {
    if (result.type === 'user' && Array.isArray(result.message.content)) {
      for (const block of result.message.content) {
        if (block.type === 'tool_result') {
          responses.set(block.tool_use_id, block.content)
        }
      }
    }
  }
  return toolUseBlocks.map(block => ({
    tool_name: block.name,
    tool_input: block.input,
    tool_use_id: block.id,
    tool_response: responses.get(block.id),
  }))
}

export function* yieldMissingToolResultBlocks(
  assistantMessages: AssistantMessage[],
  errorMessage: string,
) {
  for (const assistantMessage of assistantMessages) {
    // Extract all tool use blocks from this assistant message
    const toolUseBlocks = (
      Array.isArray(assistantMessage.message?.content)
        ? assistantMessage.message.content
        : []
    ).filter(
      (content: { type: string }) => content.type === 'tool_use',
    ) as ToolUseBlock[]

    // Emit an interruption message for each tool use
    for (const toolUse of toolUseBlocks) {
      yield createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: errorMessage,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: errorMessage,
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
  }
}

export const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3

/** Main-thread max_output_tokens_recovery nudge copy. */
export const MAIN_MAX_OUTPUT_TOKENS_RECOVERY_PROMPT =
  `Output token limit hit. Resume directly — no apology, no recap of what you were doing. ` +
  `Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.`

/**
 * Official 2.1.325 #2342 (`cmo`): subagent max_output_tokens_recovery asks for
 * the WHOLE answer again, more briefly, because the caller only receives the
 * final message rather than concatenated pieces.
 */
export const SUBAGENT_MAX_OUTPUT_TOKENS_RECOVERY_PROMPT =
  `Output token limit hit. Your caller does not receive an answer in pieces. ` +
  `If you were giving your final answer, give the whole answer again, more briefly — no apology, no mention of the cut-off. ` +
  `Otherwise continue the work in smaller pieces.`

/**
 * Official 2.1.327 #480 (`Yus`): when a subagent hits the output token limit a
 * second time, tighten to half the length (keeping exact text untouched) and
 * instruct it to say up front in the first line if the answer is partial.
 */
export const SUBAGENT_MAX_OUTPUT_TOKENS_SECOND_RECOVERY_PROMPT =
  `Output token limit hit again. Your caller does not receive an answer in pieces. ` +
  `If you were giving your final answer, give the whole answer in at most half the length of your last attempt: ` +
  `keep every item and cut the detail. Do not shorten text that must stay exact, such as code, data or translations. ` +
  `If it cannot be made that short, say so in your first line, then give what fits. ` +
  `If you were not giving your final answer, continue the work in smaller pieces.`

export function getMaxOutputTokensRecoveryPrompt(
  isSubagent: boolean,
  attempt = 1,
): string {
  if (!isSubagent) {
    return MAIN_MAX_OUTPUT_TOKENS_RECOVERY_PROMPT
  }
  return attempt >= 2
    ? SUBAGENT_MAX_OUTPUT_TOKENS_SECOND_RECOVERY_PROMPT
    : SUBAGENT_MAX_OUTPUT_TOKENS_RECOVERY_PROMPT
}

/**
 * densable fl(e, o) — emit spinner recovering bag when the loop continues
 * for max_output_tokens_recovery. Gold skips when o (agentId) is set.
 */
export function announceOutputLimitRecovery(
  transition: Continue | undefined,
  toolUseContext: ToolUseContext,
): void {
  try {
    if (toolUseContext.agentId !== undefined) return
    if (transition?.reason !== 'max_output_tokens_recovery') return
    // densable u(r,o): setMode("requesting", recovery) atomically.
    toolUseContext.setStreamMode?.('requesting')
    toolUseContext.setOutputLimitRecovery?.({
      attempt: transition.attempt,
      limit: MAX_OUTPUT_TOKENS_RECOVERY_LIMIT,
    })
  } catch (err) {
    logError(err)
  }
}

/** densable `Blt` — inserted meta user text on the first malformed tool_use. */
export const MALFORMED_TOOL_USE_RETRY_PROMPT =
  'The previous response failed to produce a valid tool call. Please retry the tool call now.'

/** Second failure. densable does not insert the neighbor `bin` prompt here. */
export const MALFORMED_TOOL_USE_EXHAUSTED_TEXT =
  "The model's tool call could not be parsed (retry also failed)."

/** densable `jlt` @184252339 — thinking-only visible-output nudge. */
export const THINKING_ONLY_RETRY_PROMPT =
  '[Your previous response had no visible output. Please continue and produce a user-visible response.]'

/** densable `bjn` @186859505. */
export const LEAKED_INVOKE_RE = /<antml:invoke\b/

export type MalformedToolUseRetryAction =
  | { action: 'retry'; prompt: typeof MALFORMED_TOOL_USE_RETRY_PROMPT }
  | { action: 'exhausted'; text: typeof MALFORMED_TOOL_USE_EXHAUSTED_TEXT }
  | { action: 'continue' }

/**
 * densable `CAt` @186859544.
 * `e.flatMap((r)=>r.message.content).findLast((r)=>r.type==="text")?.text??""`
 */
export function assistantTextHasLeakedInvoke(
  messages: readonly AssistantMessage[],
): boolean {
  const lastText =
    messages
      .flatMap(
        r =>
          r.message.content as unknown as {
            type: string
            text?: string
          }[],
      )
      .findLast(r => r.type === 'text')?.text ?? ''
  return LEAKED_INVOKE_RE.test(lastText)
}

export const MAX_MALFORMED_TOOL_USE_RETRIES = 2

/**
 * densable query loop: stop_reason tool_use, zero parsed tool uses, not an
 * API error. Retries up to MAX_MALFORMED_TOOL_USE_RETRIES (2) times before exhausted.
 */
export function malformedToolUseRetryAction(input: {
  stopReason: string | null | undefined
  parsedToolUseCount: number
  isApiErrorMessage: boolean
  previousReason: string | undefined
  retryCount?: number
}): MalformedToolUseRetryAction {
  if (
    input.stopReason !== 'tool_use' ||
    input.parsedToolUseCount !== 0 ||
    input.isApiErrorMessage
  ) {
    return { action: 'continue' }
  }
  if (input.retryCount !== undefined) {
    if (input.retryCount < MAX_MALFORMED_TOOL_USE_RETRIES) {
      return { action: 'retry', prompt: MALFORMED_TOOL_USE_RETRY_PROMPT }
    }
    return { action: 'exhausted', text: MALFORMED_TOOL_USE_EXHAUSTED_TEXT }
  }
  if (input.previousReason !== 'malformed_tool_use_retry') {
    return { action: 'retry', prompt: MALFORMED_TOOL_USE_RETRY_PROMPT }
  }
  return { action: 'exhausted', text: MALFORMED_TOOL_USE_EXHAUSTED_TEXT }
}

/**
 * Official 2.1.325 (#1374): tracks retracted wire UUIDs across malformed
 * `tool_use` retries so both the synthetic retry message (`retractedWireUuids`
 * -> `retracted_message_uuids`) and any subsequent assistant message
 * (`supersedes`) can name them.
 */
export class RetractedWireUuidTracker {
  private uuids: string[] = []

  add(messages: readonly { uuid: string }[]): string[] {
    const added: string[] = []
    for (const msg of messages) {
      if (!this.uuids.includes(msg.uuid)) {
        this.uuids.push(msg.uuid)
      }
      added.push(msg.uuid)
    }
    return added
  }

  getAll(): readonly string[] {
    return this.uuids
  }

  consumeForSupersedes(): string[] | undefined {
    if (this.uuids.length === 0) return undefined
    const out = [...this.uuids]
    this.uuids = []
    return out
  }
}

export function buildRetractedWireFields(msg: {
  retractedWireUuids?: readonly string[]
}): { retracted_message_uuids?: string[] } {
  if (msg.retractedWireUuids && msg.retractedWireUuids.length > 0) {
    return { retracted_message_uuids: [...msg.retractedWireUuids] }
  }
  return {}
}

/**
 * densable ap / GJn.
 * truncatedAfterOutput && (subagent || (main && noninteractive)) && GB.
 */
export function querySourceFamilyOf(
  querySource: QuerySource,
): string | undefined {
  try {
    const { getQuerySourceFamily } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/observerAgents.js') as typeof import('../utils/observerAgents.js')
    return getQuerySourceFamily(querySource)
  } catch {
    return undefined
  }
}

export function isTruncatedAfterOutputRecovery(
  msg: Message | StreamEvent | undefined,
  toolUseContext: ToolUseContext,
  querySource: QuerySource,
): msg is AssistantMessage {
  if (!msg || msg.type !== 'assistant') return false
  const assistant = msg as AssistantMessage
  if (assistant.isApiErrorMessage !== true) return false
  if (assistant.truncatedAfterOutput !== true) return false
  if (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_truncated_response_recovery',
      true,
    ) !== true
  ) {
    return false
  }
  const family = querySourceFamilyOf(querySource)
  if (family === 'subagent') return true
  return (
    family === 'main' && toolUseContext.options.isNonInteractiveSession === true
  )
}

/** densable gwt — main / non-subagent truncated recovery. */
const TRUNCATED_RECOVERY_RESUME =
  `Your response above was cut off mid-stream. Resume directly from where it stops — no apology, no recap. ` +
  `If none of it survived, answer the request from the start.`

/** densable hwt — subagent truncated recovery. */
const TRUNCATED_RECOVERY_REWRITE =
  `Your response above was cut off mid-stream and only your next message is delivered. ` +
  `Write the complete response again from the start — no apology, no mention of the cut-off.`

export function truncatedRecoveryCopy(querySource: QuerySource): string {
  return querySourceFamilyOf(querySource) === 'subagent'
    ? TRUNCATED_RECOVERY_REWRITE
    : TRUNCATED_RECOVERY_RESUME
}

/**
 * Is this a max_output_tokens error message? If so, the streaming loop should
 * withhold it from SDK callers until we know whether the recovery loop can
 * continue. Yielding early leaks an intermediate error to SDK callers (e.g.
 * cowork/desktop) that terminate the session on any `error` field — the
 * recovery loop keeps running but nobody is listening.
 *
 * Mirrors reactiveCompact.isWithheldPromptTooLong.
 */
export function isWithheldMaxOutputTokens(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return msg?.type === 'assistant' && msg.apiError === 'max_output_tokens'
}

export function getAutonomyTurnOutcome(params: {
  terminal?: Terminal
  thrownError?: unknown
}): AutonomyTurnOutcome {
  if (params.thrownError !== undefined) {
    return { type: 'failed', error: params.thrownError }
  }

  const terminal = params.terminal
  const reason = terminal?.reason
  switch (reason) {
    case 'completed':
      return { type: 'completed' }
    case undefined:
    case 'aborted_streaming':
    case 'aborted_tools':
      return { type: 'cancelled' }
    case 'model_error':
      return { type: 'failed', error: terminal.error }
    case 'api_error':
      return { type: 'failed', error: terminal.error ?? terminal.errorKind }
    default:
      return {
        type: 'failed',
        message: `query ended without successful completion: ${reason}`,
      }
  }
}

/**
 * densable Aa p7e / bounce — if the subagent is armed for SubagentHandback
 * and has not delivered, inject a meta bounce (capped at yGo=3) instead of
 * ending the turn. Never export minify `p7e`/`yGo`.
 */
function* enforceHandbackSend(
  toolUseContext: ToolUseContext,
): Generator<UserMessage, UserMessage | undefined> {
  const agentId = toolUseContext.agentId
  if (agentId === undefined) return undefined
  try {
    const {
      formatHandbackSendEnforceMessage,
      HANDBACK_SEND_ENFORCE_MAX,
      lookupHandbackReport,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/subagentHandback.js') as typeof import('../utils/subagentHandback.js')
    const { hasHandbackWaitKids, sweepStaleKeepaliveReasons, updateTaskState } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/task/framework.js') as typeof import('../utils/task/framework.js')
    const { isLocalAgentTask } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../tasks/LocalAgentTask/LocalAgentTask.js') as typeof import('../tasks/LocalAgentTask/LocalAgentTask.js')
    const getAppState = toolUseContext.getAppState
    const setAppState =
      toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState
    const { createTaskRegistry } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/taskRegistry.js') as typeof import('../utils/taskRegistry.js')
    const registry =
      toolUseContext.taskRegistry ??
      createTaskRegistry(getAppState, setAppState)
    const task = getAppState().tasks[agentId]
    const delivered = lookupHandbackReport(
      isLocalAgentTask(task) ? task : undefined,
      agentId,
    )
    const bounces =
      isLocalAgentTask(task) && typeof task.handbackBounces === 'number'
        ? task.handbackBounces
        : 0
    // densable Yq — sweep stale keepalive holds before d9e wait-kids.
    sweepStaleKeepaliveReasons(agentId, registry)
    const waitingOnChildren = hasHandbackWaitKids(agentId, registry)
    if (
      delivered !== undefined &&
      delivered.length === 0 &&
      !waitingOnChildren &&
      bounces < HANDBACK_SEND_ENFORCE_MAX
    ) {
      updateTaskState(agentId, setAppState, t => {
        if (!isLocalAgentTask(t)) return t
        return { ...t, handbackBounces: bounces + 1 }
      })
      const bounce = createUserMessage({
        content: formatHandbackSendEnforceMessage(),
        isMeta: true,
      })
      yield bounce
      return bounce
    }
  } catch (err) {
    logForDebugging(
      `Subagent hand-back enforcement failed: ${errorMessage(err)}`,
      {
        level: 'error',
      },
    )
  }
  return undefined
}

/**
 * densable Aa turn-end p7e — bounce on the zero-tool_use completed exit.
 * Gold does not bounce on max_turns / toolRequestedEndTurn / hook_stopped.
 */
export function* maybeHandbackBounce(
  params: { requiresHandback?: boolean },
  querySource: QuerySource,
  toolUseContext: ToolUseContext,
): Generator<UserMessage, UserMessage | undefined> {
  if (!params.requiresHandback || toolUseContext.agentId === undefined) {
    return undefined
  }
  const { getQuerySourceFamily: querySourceFamily } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../utils/observerAgents.js') as typeof import('../utils/observerAgents.js')
  if (querySourceFamily(querySource) === 'auxiliary') return undefined
  return yield* enforceHandbackSend(toolUseContext)
}

/**
 * densable Aa after bounce: Z3n && CDo leftover → skill_inline_command_handoff.
 */
export function maybeSkillInlineCommandHandoffNotRun(
  messages: Message[],
  thisTurnAssistants: Message[],
  querySource: QuerySource,
  agentId: string | undefined,
): void {
  const { getQuerySourceFamily: querySourceFamily } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../utils/observerAgents.js') as typeof import('../utils/observerAgents.js')
  if (querySourceFamily(querySource) === 'auxiliary') return
  const { maybeLogSkillInlineCommandHandoffNotRun } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../utils/skills/skillInlineCommandHandoff.js') as typeof import('../utils/skills/skillInlineCommandHandoff.js')
  maybeLogSkillInlineCommandHandoffNotRun(
    messages,
    thisTurnAssistants,
    agentId ?? null,
  )
}

/**
 * v2.1.314 (#1445): SEA Ad(jp(e), "walk_down_opus_lineup") — resolve a
 * refusal-fallback model when ANTHROPIC_DEFAULT_OPUS_MODEL, availableModels,
 * or deniedModels restricts the default fallback target.
 */
export function resolveRefusalFallbackCandidate(input: {
  currentModel: string
  fallbackModel?: string
}): string | undefined {
  const { currentModel, fallbackModel } = input
  const isCandidateUsable = (
    candidate: string | undefined,
  ): candidate is string => {
    if (!candidate || candidate === currentModel) return false
    try {
      const { isModelAllowed } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/model/modelAllowlist.js') as typeof import('../utils/model/modelAllowlist.js')
      if (!isModelAllowed(candidate)) return false
    } catch {
      // Allowlist module unavailable in minimal test environments
    }
    try {
      const { isModelDenied } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/model/entitlementOverlay.js') as typeof import('../utils/model/entitlementOverlay.js')
      if (isModelDenied(candidate)) return false
    } catch {
      // Entitlement overlay unavailable in minimal test environments
    }
    return true
  }

  const raw =
    fallbackModel && fallbackModel !== currentModel ? fallbackModel : undefined
  if (raw !== undefined) {
    let target = raw
    try {
      const { applyEntitlementBlindFallbackTarget } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/model/entitlementOverlay.js') as typeof import('../utils/model/entitlementOverlay.js')
      target = applyEntitlementBlindFallbackTarget(raw)
    } catch {
      // ignore
    }
    if (isCandidateUsable(target)) return target
  }

  const candidates: Array<string | undefined> = []
  const envOpus = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  if (envOpus) candidates.push(envOpus)
  try {
    const { newestAllowedModelInFamily } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/model/modelAllowlist.js') as typeof import('../utils/model/modelAllowlist.js')
    candidates.push(
      newestAllowedModelInFamily('opus') ?? undefined,
      newestAllowedModelInFamily('sonnet') ?? undefined,
      newestAllowedModelInFamily('haiku') ?? undefined,
    )
  } catch {
    // ignore
  }
  try {
    const { getDefaultOpusModel, getDefaultSonnetModel, getDefaultHaikuModel } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/model/model.js') as typeof import('../utils/model/model.js')
    candidates.push(
      getDefaultOpusModel(),
      getDefaultSonnetModel(),
      getDefaultHaikuModel(),
    )
  } catch {
    // ignore
  }

  for (const cand of candidates) {
    if (isCandidateUsable(cand)) return cand
  }
  return undefined
}
