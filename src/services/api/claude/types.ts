import type { ClientOptions } from '@anthropic-ai/sdk'
import { APIConnectionError } from '@anthropic-ai/sdk/error'
import type {
  BetaContentBlock,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaMessageStreamParams,
  BetaStopReason,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { QuerySource } from 'src/constants/querySource.js'
import type { Notification } from 'src/context/notifications.js'
import type { StreamCostCreditState } from 'src/services/api/streamCostCredit.js'
import type { AgentId } from 'src/types/ids.js'
import type { AgentContext } from 'src/utils/agentContext.js'
import type { EffortLevel, EffortValue } from 'src/utils/effort.js'
import type { ModelFacts } from 'src/utils/model/modelFacts.js'
import type { PromptCacheTtl } from 'src/utils/promptCacheTtl.js'
import type {
  KeepForeignThinkingMode,
  ThinkingStripPlan,
} from 'src/utils/thinking.js'
import type {
  QueryChainTracking,
  ToolPermissionContext,
  Tools,
} from '../../../Tool.js'
import type { ConnectorTextBlock } from '../../../types/connectorText.js'
import type { AssistantMessage, UserMessage } from '../../../types/message.js'
import type { RetryStatus } from '../../../utils/advisorNetworkStall.js'
import type { StreamSuspendedError } from '../../../utils/firstByteWatchdog.js'
import type { AdvisorStripPlan } from '../../../utils/messages.js'
import type { ApiSystemMessage } from '../../../utils/midConversationSystem.js'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type { startLLMRequestSpan } from '../../../utils/telemetry/sessionTracing.js'
import type { QuotaRejectedQuerySourceBucket } from '../../claudeAiLimits.js'
import type { LangfuseSpan } from '../../langfuse/index.js'
import type { RefusedToolSchemaResolver } from '../../mcp/mcpToolSchema.js'
import type { AutoModeServerContextResolved } from '../autoModeServerContext.js'
import type { Context1mBetaRetryPhase } from '../errors.js'
import type { GlobalCacheStrategy, NonNullableUsage } from '../logging.js'
import type { ModelRedirectTrackingState } from '../modelRedirectGuard.js'
import type { ServerClassifierRequest } from '../serverClassifier.js'

/**
 * Official 2.1.328 `Dpr` (`chunk@286370035.js:315894`) — stream ended cleanly
 * without receiving `message_start` or any completed blocks / stop_reason.
 */
export class StreamNoEventsError extends Error {
  constructor() {
    super('Stream ended without receiving any events')
    this.name = 'StreamNoEventsError'
  }
}

/**
 * Official 2.1.328 `wve` (`chunk@286370035.js:316016`) — malformed or
 * out-of-order SSE event (event on an unstarted or already-closed block).
 */
export class StreamMalformedEventError extends Error {
  readonly blockState: 'unstarted' | 'closed' | 'unreadable'

  constructor(blockState: 'unstarted' | 'closed' | 'unreadable') {
    super(
      blockState === 'closed'
        ? 'Content block already closed'
        : blockState === 'unreadable'
          ? 'Stream event unreadable'
          : 'Content block not found',
    )
    this.name = 'StreamMalformedEventError'
    this.blockState = blockState
  }
}

/**
 * Official 2.1.321 `t7n` (#1878) + 2.1.328 `Lpr` (`chunk@286370035.js:316275`):
 * retryable stream truncation error for clean EOF mid-block / before terminal
 * `message_delta`, or mid-stream `EPROTO` / `ERR_SSL_*` after an SSE event.
 */
export class StreamTruncatedError extends APIConnectionError {
  readonly code = 'StreamTruncated'
  override readonly cause: unknown

  constructor(cause?: unknown) {
    super({
      message:
        cause === undefined
          ? 'Stream ended before the response was complete'
          : 'Stream truncated due to mid-stream TLS error',
      cause: cause instanceof Error ? cause : undefined,
    })
    this.name = 'StreamTruncatedError'
    this.cause = cause
  }
}

export class ToolSearchRefusalError extends Error {
  constructor(cause: unknown) {
    super('the model call is made again', { cause })
    this.name = 'ToolSearchRefusalError'
  }
}

/** Official c0e — output-content-filter streaming retry cap (#14). */
export const OUTPUT_FILTERED_RETRY_CAP = 1

export class OutputFilteredStreamRetryError extends Error {
  constructor() {
    super('Output content filter retry')
    this.name = 'OutputFilteredStreamRetryError'
  }
}

/** Official Hqn — block types that suppress synthetic content_block_stop (#121). */
export const SUPPRESS_ABANDONED_BLOCK_STOP_TYPES = new Set([
  'tool_use',
  'server_tool_use',
  'mcp_tool_use',
])

export type Options = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  toolChoice?: BetaToolChoiceTool | BetaToolChoiceAuto | undefined
  isNonInteractiveSession: boolean
  extraToolSchemas?: BetaToolUnion[]
  maxOutputTokensOverride?: number
  fallbackModel?: string
  _availabilityFallbackRetried?: boolean
  _toolSearchRefusalRetried?: boolean
  onStreamingFallback?: () => void
  querySource: QuerySource
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: ClientOptions['fetch']
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  /** densable 2.1.248 #2 — Ivt `{agentCacheTtlOverride}` from query. */
  agentCacheTtlOverride?: PromptCacheTtl
  temperatureOverride?: number
  effortValue?: EffortValue
  mcpTools: Tools
  hasPendingMcpServers?: boolean
  queryTracking?: QueryChainTracking
  agentId?: AgentId // Only set for subagents
  /**
   * densable 2.1.222 #6 — one-shot MCP attribution for this API request
   * (captured from tool-use stamps when querySource family is main/subagent).
   */
  activeMcpServer?: string
  activeMcpTool?: string
  /**
   * Official isBackgroundAgent — when true with agentId, session activity
   * does not bump mainLoopRefcount ($Qn second arg via HOn fallback).
   */
  isBackgroundAgent?: boolean
  /**
   * Official requestDialog host (print cvf) — FXl refusal_fallback /
   * X6e fable overage parks. Plumbed from ToolUseContext via query.
   */
  requestDialog?: (
    spec: {
      kind: string
      default: unknown
      result?: () => {
        safeParse: (v: unknown) => { success: boolean; data?: unknown }
      }
    },
    payload: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>
  /**
   * Official refusalFallbackModel — armed fallback for refusal path (visible
   * or silent rearm). When set, takes precedence over generic fallbackModel
   * for the FXl/stream refusal consumer densable.
   */
  refusalFallbackModel?: string
  /**
   * Official refusalFallbackModelLane — "visible" | "silent".
   * Silent lane suppresses the dialog (OXl silent_ab).
   */
  refusalFallbackModelLane?: 'visible' | 'silent'
  /**
   * Official refusalFallbackSilentArmActive — silent rearm armed without
   * visible/server lane (pi densable).
   */
  refusalFallbackSilentArmActive?: boolean
  /**
   * Official refusalFallbackEffort (#36) — loop-level carried effort from a
   * refusal fallback when not latched onto the main session.
   */
  refusalFallbackEffort?: EffortLevel
  /**
   * densable serverRefusalFallback — server-lane arm `{forModel, model}`.
   * When set, stream materializes content_block_start type "fallback" into
   * QueryEvent `server_fallback` (midStream salvage / non-mid end hop).
   * mode drives ekd default vs explicit fallbacks body.
   */
  serverRefusalFallback?: {
    forModel: string
    model: string
    mode?: 'default' | 'explicit'
  }
  /**
   * densable fallbackCreditCode — stamp fallback_credit_token on next request
   * after mint from stop_details (G2s).
   */
  fallbackCreditCode?: string
  /**
   * densable fallbackCreditMintModel — model that minted the credit (optional).
   */
  fallbackCreditMintModel?: string
  /**
   * densable fallbackCreditLaneArmed — visibleModel armed → rkd credit beta.
   */
  fallbackCreditLaneArmed?: boolean
  autoModeServerContext?: AutoModeServerContextResolved
  serverClassifier?: boolean
  /**
   * densable Jn — query armed Ba; stream skips FXl so query qa can ask.
   */
  refusalFallbackPreferencePending?: boolean
  outputFormat?: BetaJSONOutputFormat
  fastMode?: boolean
  advisorModel?: string
  /**
   * Official 2.1.327 (#481): true when continuing a reply that hit the output
   * token limit; allows unrecognized models cut at 32,000 tokens to continue
   * with a limit of 128,000 tokens.
   */
  continuesCutReply?: boolean
  /**
   * Official 2.1.328 (#570): when true (e.g. subagent progress summaries), an
   * effort rejection retries without effort on this call only, without turning
   * effort off for the model across the session.
   */
  leavesEffortSupportAlone?: boolean
  /** Official 2.1.328 `Yso` `keepForeignThinking` policy (default `'none'`). */
  keepForeignThinking?: KeepForeignThinkingMode
  /** Official 2.1.328 `ie.resumeIncompleteThinking` — suppress blanket thinking strip when resuming incomplete thinking. */
  resumeIncompleteThinking?: boolean
  /**
   * Callback invoked after `message_delta` writes back `usage`, `stop_reason`,
   * `stop_details`, `context_management`, `resumable`, and `pausedResponses`
   * onto `newMessages` so callers holding cloned messages can sync them.
   */
  onMessageDelta?: (messages: AssistantMessage[]) => void
  /**
   * When true, refusal fallback yields `fallback_request` cleanly and returns
   * for caller (`query.ts`) handling instead of running the dialog inside SSE.
   */
  refusalFallbackHandledByCaller?: boolean
  /** Opt-in flag to enable transparent `pause_turn` stream resumption (`Wno`). */
  enableStreamResumption?: boolean
  addNotification?: (notif: Notification) => void
  /**
   * densable 2.1.214 #39 onRetryStatus — stream stall / retry UI status.
   * `null` clears; `{kind:"stalled", deadline}` shows
   * "Waiting for API response · will retry in … · check your network".
   */
  onRetryStatus?: (status: RetryStatus | null) => void
  // API-side task budget (output_config.task_budget). Distinct from the
  // tokenBudget.ts +500k auto-continue feature — this one is sent to the API
  // so the model can pace itself. `remaining` is computed by the caller
  // (query.ts decrements across the agentic loop).
  taskBudget?: { total: number; remaining?: number }
  /** Langfuse root trace span for observability. No-op if null/undefined. */
  langfuseTrace?: LangfuseSpan | null
  /**
   * densable promptTooLongIsHandled — skip cli_api_error / tengu_api_error
   * when classifyAPIError is prompt_too_long (title / compact / hook_prompt
   * and the main query already recover). Official Options field.
   */
  promptTooLongIsHandled?: boolean
  /**
   * densable qC/Gut `thinkingStripPlan` / `advisorStripPlan` — Lv peels
   * attachments at normalize. Compact qjt threads these through runQuery.
   */
  thinkingStripPlan?: ThinkingStripPlan
  advisorStripPlan?: AdvisorStripPlan
  toolResultCuts?: ReadonlyMap<string, string>
  /**
   * densable agentContext — official Options field. queryModel falls back
   * to getAgentContext() ALS when omitted. Title `B` passes S() explicitly.
   */
  agentContext?: AgentContext
  /**
   * densable credentials — official Options / fk `i`. Host handle (`Ce`)
   * passed to getAnthropicClient → Op refresh + `_F`/`dl` dead-refresh throw.
   */
  credentials?: unknown
  /**
   * densable storageV5 — official Options / fk `a`. Persist handle for
   * Op refresh (`aO`) and YOo gzip latch. Local `$t()`/`tn()` host is absent;
   * the handle is still threaded (same as saveGlobalConfig 2nd arg).
   * Title `B` does not pass this field.
   */
  storageV5?: unknown
  /**
   * densable `zu` snapshot. queryModel reuses when model matches and
   * querySource is not auto_mode / auto_mode_investigator (`$z`).
   */
  modelFacts?: ModelFacts
  /**
   * densable `tte` epoch. Threaded on Options (gold Uwt `promptEpoch`).
   */
  promptRenderEpoch?: number
}

export type HaikuOptions = Omit<Options, 'model' | 'getToolPermissionContext'>

export type QueryWithModelOptions = Omit<Options, 'getToolPermissionContext'>

export type ServerFallbackHop = {
  fromModel: string
  model: string
  reason: string
  category: string | null
}

export type PendingMediaCap = {
  limit: number
  steps: number
  refusedAt: number
}

export type MediaItemCapEntry = {
  model: string
  limit?: number
  gaveUp: boolean
}

export type NormalizedApiMessage =
  | UserMessage
  | AssistantMessage
  | ApiSystemMessage

export type PausedResponseLimit = 'pause_turn' | 'max_tokens' | 'server_timeout'

export type PausedResponseRecord = {
  limit: PausedResponseLimit
  usage: NonNullableUsage
  finishedBlocks: number
  requestId?: string
  resumedRequestId?: string
}

export type SessionCostAttribution = {
  activeMcpServer?: string
  activeMcpTool?: string
  querySource: QuerySource
  intendedPromptCacheTtl: '1h' | '5m'
  agentContext: AgentContext | undefined
}

export type PreparedMessagesAndTools = {
  previousRequestId: string | undefined
  resolvedModel: string
  isAgenticQuery: boolean
  quotaRejectQuerySourceBucket: QuotaRejectedQuerySourceBucket
  betas: string[]
  advisorModel: string | undefined
  useSearchExtraTools: boolean
  deferredToolNames: Set<string>
  filteredTools: Tools
  needsToolBasedCacheMarker: boolean
  globalCacheStrategy: GlobalCacheStrategy
  toolSchemas: BetaToolUnion[]
  toolSchemasForApi: BetaToolUnion[]
  messagesForAPI: NormalizedApiMessage[]
  midConvFallback: (() => NormalizedApiMessage[]) | null
  sessionIdForMediaCap: string
  mediaTakenOut: Array<{ type: string }> | undefined
}

export type PreparedAnthropicContext = {
  systemPrompt: SystemPrompt
  buildSystem: () => TextBlockParam[]
  system: TextBlockParam[]
  useBetas: boolean
  sessionCostAttribution: SessionCostAttribution
  allTools: BetaToolUnion[]
  isFastMode: boolean
  afkHeaderLatched: boolean
  fastModeHeaderLatched: boolean
  requestedEffort: EffortValue | undefined
  effort: EffortValue | undefined
  llmSpan: ReturnType<typeof startLLMRequestSpan>
}

export type ApiRequestAdaptationState = {
  betas: string[]
  messagesForAPI: NormalizedApiMessage[]
  midConvFallback: (() => NormalizedApiMessage[]) | null
  system: TextBlockParam[]
  effort: EffortValue | undefined
  effortLevelForTranscript: EffortLevel | undefined
  lastRequestBetas: string[] | undefined
  lastRequestBedrockBetas: string[]
  strippedBedrockBetas: Set<string>
  lastSentThinkingDisplay: string | undefined
  lastSentBindingControls: boolean
  lastSentTokenCount: boolean
  lastBindingControlsOnThirdParty: boolean
  prefixLockStripAttempt: number
  lastSentClearToolUses: boolean
  clearToolUsesDisabledForRequest: boolean
  pendingMediaCap: PendingMediaCap | undefined
  context1mBetaRetryPhase: Context1mBetaRetryPhase
  toolSchemaResolver: RefusedToolSchemaResolver
  lastSentToolSchemas: BetaToolUnion[] | undefined
  targetedMediaStripCounts: Map<string, number>
  loggedEffortClamp: boolean
  serverClassifierRequest: ServerClassifierRequest | undefined
}

export type StreamEnvelopeState = {
  streamMessageEnvelopeOpen: boolean
  openBlockIndexForEnvelope: number | null
  openBlockSuppressStop: boolean
  currentApiMessageId: string | null
  abandonedFromBlockIndex: number
}

export type QueryModelRuntimeState = {
  startIncludingRetries: number
  start: number
  attemptNumber: number
  attemptStartTimes: number[]
  streamRequestId: string | null | undefined
  clientRequestId: string | undefined
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins -- Response is available in Node 18+ and is used by the SDK
  streamResponse: Response | undefined
  redirectTrackingState: ModelRedirectTrackingState
  newMessages: AssistantMessage[]
  ttftMs: number
  partialMessage: BetaMessage | undefined
  contentBlocks: (BetaContentBlock | ConnectorTextBlock)[]
  textDeltas: Map<number, string[]>
  usage: NonNullableUsage
  costUSD: number
  stopReason: BetaStopReason | null
  streamCostCredit: StreamCostCreditState
  didFallBackToNonStreaming: boolean
  fallbackMessage: AssistantMessage | undefined
  maxOutputTokens: number
  responseHeaders: globalThis.Headers | undefined
  research: unknown
  isFastModeRequest: boolean
  isAdvisorInProgress: boolean
  serverFallbackEmitted: boolean
  fallbackCreditMinted: boolean
  mintedFallbackCreditCode: string | undefined
  deferredServerFallbackHop: ServerFallbackHop | undefined
  lastServerFallbackHop: ServerFallbackHop | undefined
  malformedFallbackBlockIndexes: Set<number>
  thinkingOnlyWatchdogRetryCount: number
  thinkingOnlyStaleRetryCount: number
  outputFilteredRetryCount: number
  confirmPendingMaxTokensCeiling: (() => void) | undefined
}

export type StreamAttemptLoopState = {
  streamMessageInProgress: boolean
  messageDeltaCompleted: boolean
  openContentBlockIndex: number | null
  closedContentBlocks: Set<number>
  thinkingEstimatedTokens: number
  contextManagementResponse: unknown
  pausedResponses: PausedResponseRecord[]
  pausedRequestId: string | null | undefined
  envelope: StreamEnvelopeState
  streamIdleAborted: boolean
  streamSuspendedError: StreamSuspendedError | undefined
  streamWatchdogFiredAt: number | null
  streamLoopStartedAt: number
  lastEventTime: number | null
  streamEventsReceived: number
  msToFirstEvent: number | null
  isFirstChunk: boolean
  totalStallTime: number
  stallCount: number
}

export type StreamParamsSnapshot = BetaMessageStreamParams
