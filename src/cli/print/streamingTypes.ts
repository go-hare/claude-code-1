/**
 * Shared types and mutable session context interfaces for the modularized
 * headless streaming pipeline (`src/cli/print/*`).
 *
 * Pure type-only module — zero runtime code, zero circular dependencies.
 */
import type { UUID } from 'crypto'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { ReplBridgeHandle } from 'src/bridge/replBridge.js'
import type {
  DynamicMcpState,
  HeadlessControlPlane,
} from 'src/cli/headless/HeadlessControlPlane.js'
import type {
  createPrintPrewaitLatch,
  createPrintStartGate,
} from 'src/cli/printDrainGates.js'
import type { createPrintTaskNotificationCoalesceState } from 'src/cli/printTaskNotificationCoalesce.js'
import type { CutOffReRunStopTracker } from 'src/cli/rapidFollowupPreempt.js'
import type { RapidFollowupPreemptController } from 'src/cli/rapidFollowupPreempt.js'
import type { StructuredIO } from 'src/cli/structuredIO.js'
import type { Command } from 'src/commands.js'
import type {
  McpServerConfigForProcessTransport,
  McpServerStatus,
  ModelInfo,
  SDKStatus,
} from 'src/entrypoints/agentSdkTypes.js'
import type {
  SDKControlMcpSetServersResponse,
  SDKControlRequest,
  StdoutMessage,
} from 'src/entrypoints/sdk/controlTypes.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { RetractedWireUuidTracker } from 'src/query/queryHelpers.js'
import type { PromptVariant } from 'src/services/PromptSuggestion/promptSuggestion.js'
import type { ClaudeAILimits } from 'src/services/claudeAiLimits.js'
import type { createHeadlessMcpIdentityBoundary } from 'src/services/mcp/headlessMcpIdentityBoundary.js'
import type {
  MCPServerConnection,
  McpSdkServerConfig,
} from 'src/services/mcp/types.js'
import type { AppState } from 'src/state/AppStateStore.js'
import type { Tools } from 'src/Tool.js'
import type { Message } from 'src/types/message.js'
import type { QueuedCommand } from 'src/types/textInputTypes.js'
import type { HookDeferredToolAttachment } from 'src/utils/attachments.js'
import type { OverdueSessionStartHooks } from 'src/utils/conversationRecovery.js'
import type { CronScheduler } from 'src/utils/cronScheduler.js'
import type { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import type { createIdleTimeoutManager } from 'src/utils/idleTimeout.js'
import type { PlanModeOnResume } from 'src/utils/permissions/planModeResume.js'
import type { extractReadFilesFromMessages } from 'src/utils/queryHelpers.js'
import type { Stream } from 'src/utils/stream.js'
import type { createTaskRegistry } from 'src/utils/taskRegistry.js'
import type { ThinkingConfig } from 'src/utils/thinking.js'
import type { ToolStateSlots } from 'src/utils/toolState.js'
import type {
  CcrFolderRestorer,
  CostMetadataPusher,
  PendingReRunSendsTracker,
} from './startupAndAccount.js'

export type RunPhase =
  | 'draining_commands'
  | 'waiting_for_agents'
  | 'finally_flush'
  | 'finally_post_flush'

export type PrintRequestDialogFn = (
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

export type RunHeadlessStreamingOptions = {
  verbose: boolean | undefined
  jsonSchema: Record<string, unknown> | undefined
  permissionPromptToolName: string | undefined
  allowedTools: string[] | undefined
  thinkingConfig: ThinkingConfig | undefined
  maxTurns: number | undefined
  maxBudgetUsd: number | undefined
  taskBudget: { total: number } | undefined
  systemPrompt: string | undefined
  appendSystemPrompt: string | undefined
  /** Official --append-subagent-system-prompt (Task-tool subagents only). */
  appendSubagentSystemPrompt?: string | undefined
  userSpecifiedModel: string | undefined
  fallbackModel: string | undefined
  replayUserMessages?: boolean | undefined
  includePartialMessages?: boolean | undefined
  /** densable 2.1.283 — SDK sessionStore transcript_mirror frames */
  sessionMirror?: boolean | undefined
  /** densable 2.1.219 #6 — nested subagent text/thinking on stream-json */
  forwardSubagentText?: boolean | undefined
  enableAuthStatus?: boolean | undefined
  agent?: string | undefined
  setSDKStatus?: (status: SDKStatus) => void
  promptSuggestions?: boolean | undefined
  workload?: string | undefined
  overdueSessionStartHooks?: OverdueSessionStartHooks | undefined
  /** Official --reply-on-resume: auto-continue interrupted turn on resume. */
  replyOnResume?: boolean | undefined
  /** Official 2.1.325 #2316: resumed Code Mode session ended mid-script; wait for next prompt. */
  codeModeWaitForNextPrompt?: boolean | undefined
  /** densable #27 stream-json commands_changed emission gate */
  outputFormat?: string | undefined
  /** Official Jqy `planModeOnResume` — restored | declined | none */
  planModeOnResume?: PlanModeOnResume
  /** Official JNs `F` — `$2l` attachment from resume, consumed on first ask. */
  deferredToolUse?: HookDeferredToolAttachment
  /**
   * Official `fu` — CLI `--permission-mode` supplied this invocation.
   * densable ne host reads this on claim_session.
   */
  permissionModeSuppliedOnInvocation?: boolean
  /**
   * densable `D.sdkUrl` — when set, headless wires
   * `createHeadlessHearthMount` (Ga) + sync("startup").
   */
  sdkUrl?: string | undefined
  subscribeAppState?: (listener: () => void) => () => void
}

export type PromptSuggestionState = {
  abortController: AbortController | null
  inflightPromise: Promise<void> | null
  lastEmitted: {
    text: string
    emittedAt: number
    promptId: PromptVariant
    generationRequestId: string | null
  } | null
  pendingSuggestion: {
    type: 'prompt_suggestion'
    suggestion: string
    uuid: UUID
    session_id: string
  } | null
  pendingLastEmittedEntry: {
    text: string
    promptId: PromptVariant
    generationRequestId: string | null
  } | null
}

export type ParkedPermissionResumePlan = {
  wait: true
  parked: { request_id: string; tool_use_id: string }
  waitMs: number
}

export type WorkSecretSessionHandle = Awaited<
  ReturnType<
    typeof import('src/bridge/serverConfigSession.js')['createHeadlessWorkSecretSession']
  >
>

export type HearthMountHandle = Awaited<
  ReturnType<
    typeof import('src/bridge/projectsReplyMount.js')['createHeadlessHearthMount']
  >
>

export type TurnRunDrainState = {
  isMainThread: (cmd: QueuedCommand) => boolean
  collectRequiredMcpServers: () => Set<string>
  configuredMcpStartupWaitMs: number | undefined
  command: QueuedCommand | undefined
  firstTurnJoinsPending: boolean
  pollEmptyDispatchStalled: boolean
  pollDispatchTarget: QueuedCommand | undefined
  lastDispatchAborted: boolean
  taskNotificationCoalesce: ReturnType<
    typeof createPrintTaskNotificationCoalesceState
  >
  startGate: ReturnType<typeof createPrintStartGate>
  prewait: ReturnType<typeof createPrintPrewaitLatch>
}

export type ControlRequestDispatchContext = {
  msg: SDKControlRequest
  req: Record<string, unknown>
  inFlightControlRequests: Map<string, AbortController>
  isInitialized: () => boolean
  deferControlLifecycleUntilDone: (work: () => void | Promise<void>) => void
  completeControlLifecycleImmediately: (
    work: () => void | Promise<void>,
  ) => void
}

export type HeadlessStreamingContext = {
  // Core immutable session dependencies
  readonly structuredIO: StructuredIO
  readonly mcpClients: MCPServerConnection[]
  readonly commands: Command[]
  readonly tools: Tools
  readonly canUseTool: CanUseToolFn
  readonly sdkMcpConfigs: Record<string, McpSdkServerConfig>
  readonly getAppState: () => AppState
  readonly setAppState: (f: (prev: AppState) => AppState) => void
  readonly agents: AgentDefinition[]
  readonly options: RunHeadlessStreamingOptions
  readonly printRequestDialog?: PrintRequestDialogFn
  readonly output: Stream<StdoutMessage>
  readonly mutableMessages: Message[]
  readonly sessionToolState: ToolStateSlots
  readonly sessionTaskRegistry: ReturnType<typeof createTaskRegistry>
  readonly pendingSeeds: ReturnType<typeof createFileStateCacheWithSizeLimit>
  readonly modelInfos: ModelInfo[]
  readonly pendingReRunSends: PendingReRunSendsTracker
  readonly cutOffReRunStopTracker: CutOffReRunStopTracker
  readonly wireRetractedTracker: RetractedWireUuidTracker
  readonly ccrFolderRestorer: CcrFolderRestorer
  readonly costMetadataPusher: CostMetadataPusher
  readonly recoveredToolUseIds: Set<string>
  readonly suggestionState: PromptSuggestionState
  readonly mcpStartupAbortRef: { current: AbortController | null }
  readonly rapidFollowupDrain: {
    readonly abortController: AbortController | undefined
    endSessionRequested: boolean
  }
  readonly rapidFollowupPreempt: RapidFollowupPreemptController
  readonly declareSdkRapidFollowupPreempt: (enabled: boolean) => void
  readonly idleTimeout: ReturnType<typeof createIdleTimeoutManager>
  readonly elicitationRegistered: Map<string, object>
  readonly CLAIM_SESSION_START_QUEUE_WAIT_MS: number
  readonly parkedPermissionResumePlan?: ParkedPermissionResumePlan
  readonly rateLimitListener: (limits: ClaudeAILimits) => void
  readonly unsubscribeAuthStatus?: () => void
  readonly unregisterHookHeartbeatSink?: () => void

  // Mutable session state
  pendingDeferredToolUse: HookDeferredToolAttachment | undefined
  deferredCallRefusesTurns: boolean
  running: boolean
  runPhase: RunPhase | undefined
  inputClosed: boolean
  claimFirstTurnAck:
    | ((et: { queued?: string } | { cannotQueue: string }) => void)
    | undefined
  shutdownPromptInjected: boolean
  heldBackResult: StdoutMessage | null
  turnAbortedForShutdown: boolean
  shuttingDownForPrint: boolean
  abortController: AbortController | undefined
  pendingSetModelPromise: Promise<void>
  printStartGate: ReturnType<typeof createPrintStartGate> | undefined
  printPrewait: ReturnType<typeof createPrintPrewaitLatch> | undefined
  pluginCeilingTurns: number
  drainingHandoff: QueuedCommand | undefined
  cronScheduler: CronScheduler | null
  hookHeartbeatTurnId: number
  readFileState: ReturnType<typeof extractReadFilesFromMessages>
  activeUserSpecifiedModel: string | undefined
  sdkClients: MCPServerConnection[]
  sdkTools: Tools
  sdkMcpBackgroundRetry: Promise<void> | undefined
  dynamicMcpState: DynamicMcpState
  pendingContextUsagePromise: Promise<void>
  bridgeHandle: ReplBridgeHandle | null
  workSecretSession: WorkSecretSessionHandle | null
  hearthMount: HearthMountHandle | null
  hearthMountStartup: Promise<void> | null
  bridgeLastForwardedIndex: number
  pluginInstallPromise: Promise<void> | null
  currentCommands: Command[]
  currentAgents: AgentDefinition[]
  activeRunPromise: Promise<void> | undefined
  sessionStoppedAfterRestart: boolean

  // Wired helper handles (initialized during streaming session setup)
  controlPlane: HeadlessControlPlane
  takePendingDeferredToolUse: () => HookDeferredToolAttachment | undefined
  injectModelSwitchBreadcrumbs: (
    modelArg: string,
    resolvedModel: string,
  ) => void
  registerElicitationHandlers: (clients: MCPServerConnection[]) => void
  updateSdkMcp: (failedAction?: 'retry' | 'skip') => Promise<void>
  seedHeadlessMcpIdentity: () => void
  attachHeadlessRemoteReconnect: (
    clients: readonly MCPServerConnection[],
  ) => void
  headlessMcpIdentityBoundary: ReturnType<
    typeof createHeadlessMcpIdentityBoundary
  >
  withControlReconnect: <T>(name: string, run: () => Promise<T>) => Promise<T>
  buildAllTools: (appState: AppState) => Tools
  drainPrintSdkEvents: (forwardParentFrames?: boolean) => void
  forwardMessagesToBridge: () => void
  applyMcpServerChanges: (
    servers: Record<string, McpServerConfigForProcessTransport>,
  ) => Promise<{
    response: SDKControlMcpSetServersResponse
    sdkServersChanged: boolean
  }>
  buildMcpServerStatuses: () => McpServerStatus[]
  refreshPluginState: () => Promise<void>
  applyPluginMcpDiff: () => Promise<void>
  unsubscribeSkillChanges: () => void
  scheduleProactiveTick: (() => void) | undefined
  run: () => Promise<void>
  sendControlResponseSuccess: (
    message: { request_id: string } | SDKControlRequest,
    response?: Record<string, unknown>,
  ) => void
  sendControlResponseError: (
    message: { request_id: string } | SDKControlRequest,
    errorMessage: string,
  ) => void
}
