import type { SpinnerMode } from '../components/Spinner/types.js'
import type { QuerySource } from '../constants/querySource.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { AutoCompactTrackingState } from '../services/compact/autoCompact.js'
import type { ToolBridgeEvent } from '../services/tools/toolExecution.js'
import type { ToolUseContext } from '../Tool.js'
import type {
  AssistantMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  TombstoneMessage,
  ToolUseSummaryMessage,
} from '../types/message.js'
import type { AdvisorStripPlan } from '../utils/messages.js'
import type { ModelFacts } from '../utils/model/modelFacts.js'
import type { RefusalFallbackResult } from '../utils/printRequestDialog.js'
import type { PromptCacheTtl } from '../utils/promptCacheTtl.js'
import type { SystemPrompt } from '../utils/systemPromptType.js'
import type { ThinkingStripPlan } from '../utils/thinking.js'
import type { QueryDeps } from './deps.js'
import type { Continue } from './transitions.js'

export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  skipCacheWrite?: boolean
  /** densable 2.1.248 #2 — per-agent experimental.cacheTtl → Ivt/jTt. */
  agentCacheTtlOverride?: PromptCacheTtl
  /**
   * densable Fl / pe — omitClaudeMd kept only managed policy CLAUDE.md.
   * Memory inject filters to type==="Managed" when this is set.
   */
  managedInstructionsOnly?: boolean
  /**
   * Official drain: when the dequeued turn carried stopHookActive (stop-hook
   * continuation / concurrent re-queue), seed the loop so nested stop hooks
   * see stop_hook_active=true. Undefined on normal keyboard turns.
   */
  stopHookActive?: boolean
  /**
   * densable `tte` snapshot captured before system-prompt render.
   * queryLoop falls back to getPromptRenderEpoch() when omitted.
   */
  promptRenderEpoch?: number
  /**
   * densable `zu` snapshot. queryLoop reuses when model matches, else Tqe.
   */
  modelFacts?: ModelFacts
  // API task_budget (output_config.task_budget, beta task-budgets-2026-03-13).
  // Distinct from the tokenBudget +500k auto-continue feature. `total` is the
  // budget for the whole agentic turn; `remaining` is computed per iteration
  // from cumulative API usage. See configureTaskBudgetParams in claude.ts.
  taskBudget?: { total: number }
  /**
   * densable Aa `requiresHandback` — SubagentHandback arm. Semantic field on
   * query params (gold BODY in Aa); not a public minify-shaped API.
   */
  requiresHandback?: boolean
  /**
   * densable qC → Gut `thinkingStripPlan` / `advisorStripPlan`. Compact
   * qjt threads these into runQuery; Lv peels attachments at normalize.
   */
  thinkingStripPlan?: ThinkingStripPlan
  advisorStripPlan?: AdvisorStripPlan
  /**
   * Official 2.1.328 (#555): optional callback invoked after automatic or
   * reactive compaction to rebuild the system prompt the way `/compact` does,
   * instead of reusing the earlier session system prompt.
   */
  renderSystemPrompt?: (
    context: ToolUseContext,
    modelFacts?: ModelFacts,
  ) => Promise<
    | SystemPrompt
    | { systemPrompt: SystemPrompt; promptRenderEpoch?: number }
    | undefined
  >
  deps?: QueryDeps
}

export type AmberMoleskinEntry = {
  windowSize?: number
  repl: number
  sdk: number
}

export type AmberMoleskinTable = {
  entries: Array<{ windowSize: number; repl: number; sdk: number }>
  defaultEntry: { repl: number; sdk: number } | null
}

export type QueryLoopEvent =
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage
  | ToolBridgeEvent
  | { type: 'spinner_mode'; mode: SpinnerMode }

/** Mutable state carried between queryLoop iterations. */
export type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  serverErrorCutRetryCount?: number
  hasAttemptedReactiveCompact: boolean
  /** Official 2.1.328 (`chunk@305854618.js @206900`): two-pass 413 reactive compact. */
  reactiveCompactDeeperPass?: 'none' | 'available' | 'spent'
  /** Official 2.1.328 `resumeIncompleteThinking`: resume thinking cut at max_tokens. */
  resumeIncompleteThinking?: boolean
  /** Official 2.1.328 `refusalRetrySpent`: one-shot same-model refusal retry latch. */
  refusalRetrySpent?: boolean
  /** Official 2.1.328 `Ol`: one-shot guard on overriding MCP endTurn via Stop hook / failed sibling. */
  mcpEndTurnOverrideSpent?: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  stopHookBlockCount: number
  turnCount: number
  /**
   * densable Pe.thinkingOnlyNudged — one-shot latch on the continue bag after
   * a jlt nudge (gold-251-g #11). Not React AppState.
   */
  thinkingOnlyNudged: boolean
  /**
   * Official 2.1.328 `emptyCompletionResent` — one-shot latch on the continue
   * bag after an empty completion was resent once before giving up.
   */
  emptyCompletionResent: boolean
  malformedToolUseRetryCount?: number
  // Why the previous iteration continued. Undefined on first iteration.
  // Lets tests assert recovery paths fired without inspecting message contents.
  transition:
    | Continue
    | { reason: 'refusal_retry'; model?: string }
    | { reason: 'prompt_as_file' }
    | undefined
}

export type QueryLoopState = State

export type ObserverActivityTap = {
  capture: (value: unknown) => void
  flushSegment: () => void
  finish: (reason: string) => void
}

export type CallerFallbackRequest = {
  originalModel: string
  fallbackModel: string
  requestId?: string | null
  apiRefusalCategory?: string | null
  silentArmAtTrigger?: boolean
}

export type BackfillClonePair = {
  src: AssistantMessage
  dst: AssistantMessage
}

export type RefusalFallbackLoopState = {
  attemptWithFallback: boolean
  refusalContinuationActive: boolean
  silentStitchPending: boolean
  silentStitchText: string | undefined
  exactSalvagePackage:
    | {
        text: string
        originals: readonly { uuid?: string }[]
      }
    | undefined
  clientRetrySupersedesUuids: string[] | undefined
  convoluteArcadesRetryActive: boolean
  partialResponseMetaMessage: Message | undefined
  pendingFallbackCreditCode: string | undefined
  pendingFallbackCreditMintModel: string | undefined
  refusalFallbackPreferencePending: boolean
  refusalFallbackPreferenceChoice: RefusalFallbackResult | undefined
  refusalFallbackEffort:
    | { model: string; level: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
    | undefined
  lastBatchingReminderSent:
    | { afterUuid: string; text: string; model: string }
    | undefined
  triedFallbackModels: Set<string>
  lastDeltaStopReason: string | undefined
  lastDeltaOutputTokens: number | undefined
  backfillClones: BackfillClonePair[]
  withheldLongContextRefusal: AssistantMessage | undefined
  withheldSafetyMonitorBlock: AssistantMessage | undefined
  withheldSameModelRefusal: AssistantMessage | undefined
  pendingCallerFallbackRequest: CallerFallbackRequest | undefined
}
