/**
 * Headless bidirectional streaming session orchestrator (`runHeadlessStreaming`).
 *
 * Constructs `HeadlessStreamingContext`, wires signal/auth/rate-limit listeners,
 * resumes interrupted turns, and composes the MCP/plugin, turn-runner, background
 * wake, and inbound control-loop subsystems.
 */
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import type { StructuredIO } from 'src/cli/structuredIO.js'
import type {
  MCPServerConnection,
  McpSdkServerConfig,
} from 'src/services/mcp/types.js'
import type { Command } from 'src/commands.js'
import type { Tools } from 'src/Tool.js'
import type { Message } from 'src/types/message.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import {
  type HeadlessSetAppState,
  HeadlessControlPlane,
  type HeadlessAppState,
  reregisterChannelHandlerAfterReconnect,
  handleOrphanedPermissionResponse,
} from 'src/cli/headless/HeadlessControlPlane.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  type ThinkingConfig,
  modelSupportsAdaptiveThinking,
} from 'src/utils/thinking.js'
import type { SDKStatus } from 'src/entrypoints/agentSdkTypes.js'
import type {
  OverdueSessionStartHooks,
  TurnInterruptionState,
} from 'src/utils/conversationRecovery.js'
import type { PlanModeOnResume } from 'src/utils/permissions/planModeResume.js'
import type { HookDeferredToolAttachment } from 'src/utils/attachments.js'
import type { AppState } from 'src/state/AppStateStore.js'
import { registerHookHeartbeatSink } from '../../utils/hooks/hookHeartbeat.js'
import { getSessionId, getTotalCostUSD } from 'src/bootstrap/state.js'
import {
  addTranscriptMirror,
  wasTurnStoppedByHook,
  isTrailingNoReplyNote,
  stripUnresumedInterruptedMessages,
  markNotChainParent,
} from 'src/utils/sessionStorage.js'
import {
  setPermissionModeChangedListener,
  notifyInternalMetadataChanged,
  getSessionState,
} from 'src/utils/sessionState.js'
import { feature } from 'bun:bundle'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID, type UUID } from 'crypto'
import {
  PendingReRunSendsTracker,
  CcrFolderRestorer,
  CostMetadataPusher,
  type RescueYieldCommandHead,
} from './startupAndAccount.js'
import { CutOffReRunStopTracker } from '../rapidFollowupPreempt.js'
import { RetractedWireUuidTracker } from 'src/query/queryHelpers.js'
import type { PromptVariant } from 'src/services/PromptSuggestion/promptSuggestion.js'
import { AwsAuthStatusManager } from 'src/utils/awsAuthStatusManager.js'
import {
  type ClaudeAILimits,
  statusListeners,
} from 'src/services/claudeAiLimits.js'
import { isClaudeAISubscriber, getOauthAccountInfo } from 'src/utils/auth.js'
import { toSDKRateLimitInfo } from 'src/utils/messages/mappers.js'
import {
  enqueue,
  getCommandQueueSnapshot,
  subscribeToCommandQueue,
  getCommandsByMaxPriority,
  getCommandQueue,
} from 'src/utils/messageQueueManager.js'
import { setProjectsThreadStateSource } from 'src/utils/processUserInput/projectsThreadState.js'
import { extractReadFilesFromMessages } from 'src/utils/queryHelpers.js'
import { getCwd } from 'src/utils/cwd.js'
import {
  READ_FILE_STATE_CACHE_SIZE,
  createFileStateCacheWithSizeLimit,
} from 'src/utils/fileStateCache.js'
import { ToolStateSlots } from 'src/utils/toolState.js'
import { createTaskRegistry } from 'src/utils/taskRegistry.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js'
import { removeInterruptedMessage } from './interruptAndCancel.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { QueuedCommand } from 'src/types/textInputTypes.js'
import { getModelOptions } from 'src/utils/model/modelOptions.js'
import {
  getDefaultMainLoopModel,
  parseUserSpecifiedModel,
} from 'src/utils/model/model.js'
import {
  modelSupportsEffort,
  modelSupportsMaxEffort,
  EFFORT_LEVELS,
} from 'src/utils/effort.js'
import { isFastModeSupportedByModel } from 'src/utils/fastMode.js'
import { modelSupportsAutoMode } from 'src/utils/betas.js'
import { createIdleTimeoutManager } from 'src/utils/idleTimeout.js'
import type { HeadlessStreamingContext } from './streamingTypes.js'
import {
  setBackgroundCeilingProvider,
  setSpawnedTurnTakenCallback,
} from 'src/utils/plugins/functionHooksModules.js'
import { logForDiagnosticsNoPII } from 'src/utils/diagLogs.js'
import { createAbortErrorReason } from 'src/utils/abortController.js'
import {
  gracefulShutdown,
  markPrintModeSignalHandlersRegistered,
} from 'src/utils/gracefulShutdown.js'
import { registerCleanup } from 'src/utils/cleanupRegistry.js'
import { getRunningTasks } from '../../utils/task/framework.js'
import { isBackgroundTask } from '../../tasks/types.js'
import { initializeStreamingMcpAndPlugins } from './mcpAndPlugins.js'
import { createTurnRunner } from './turnRunner.js'
import { setupUdsInboxLoop, setupKairosCronLoop } from './backgroundLoops.js'
import { startControlInputLoop } from './controlLoop.js'

export function runHeadlessStreaming<
  TState extends HeadlessAppState = AppState,
>(
  structuredIO: StructuredIO,
  mcpClients: MCPServerConnection[],
  commands: Command[],
  tools: Tools,
  initialMessages: Message[],
  canUseTool: CanUseToolFn,
  sdkMcpConfigs: Record<string, McpSdkServerConfig>,
  getAppStateParam: () => TState,
  setAppStateParam: HeadlessSetAppState<TState>,
  agents: AgentDefinition[],
  options: {
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
  },
  turnInterruptionState?: TurnInterruptionState,
  /**
   * Official requestDialog host (cvf) armed in runHeadless — refusal_fallback /
   * fable_overage / mcp_url_elicitation parks via ask → ToolUseContext.
   */
  printRequestDialog?: (
    spec: {
      kind: string
      default: unknown
      result?: () => {
        safeParse: (v: unknown) => { success: boolean; data?: unknown }
      }
    },
    payload: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>,
): AsyncIterable<StdoutMessage> {
  const getAppState = getAppStateParam as unknown as () => AppState
  const setAppState = setAppStateParam as unknown as (
    f: (prev: AppState) => AppState,
  ) => void
  // Official QueryEngine latches F once. Local print builds a new ask()
  // Same queue sendRequest() enqueues to — one FIFO for everything.
  const output = structuredIO.outbound

  // Official 2.1.323 #1970: register 30s hook progress heartbeat sink on the
  // headless/SDK output stream so long-running hooks keep the host alive.
  const unregisterHookHeartbeatSink =
    options.outputFormat === 'stream-json' || Boolean(options.sdkUrl)
      ? registerHookHeartbeatSink(event => {
          output.enqueue({
            ...event,
            session_id: getSessionId(),
          } as unknown as StdoutMessage)
          output.enqueue({ type: 'keep_alive' })
        })
      : undefined

  // densable Bbr — stream-json sessionStore parent peels transcript_mirror frames
  if (options.outputFormat === 'stream-json' && options.sessionMirror) {
    addTranscriptMirror((filePath, entries) => {
      output.enqueue({
        type: 'transcript_mirror',
        filePath,
        entries,
      })
    })
  }

  // Wire the central onChangeAppState mode-diff hook to the SDK output stream.
  setPermissionModeChangedListener(newMode => {
    // Only emit for SDK-exposed modes.
    if (
      newMode === 'default' ||
      newMode === 'acceptEdits' ||
      newMode === 'bypassPermissions' ||
      newMode === 'plan' ||
      newMode === (feature('TRANSCRIPT_CLASSIFIER') && 'auto') ||
      newMode === 'dontAsk'
    ) {
      output.enqueue({
        type: 'system',
        subtype: 'status',
        status: null,
        permissionMode: newMode as PermissionMode,
        uuid: randomUUID(),
        session_id: getSessionId(),
      })
    }
  })

  const pendingReRunSends = new PendingReRunSendsTracker()
  const cutOffReRunStopTracker = new CutOffReRunStopTracker()
  const wireRetractedTracker = new RetractedWireUuidTracker()
  const ccrFolderRestorer = new CcrFolderRestorer()
  const costMetadataPusher = new CostMetadataPusher(
    notifyInternalMetadataChanged,
  )
  const recoveredToolUseIds = new Set<string>()
  const mcpStartupAbortRef: { current: AbortController | null } = {
    current: null,
  }

  // Prompt suggestion tracking (push model)
  const suggestionState: {
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
  } = {
    abortController: null,
    inflightPromise: null,
    lastEmitted: null,
    pendingSuggestion: null,
    pendingLastEmittedEntry: null,
  }

  // Set up AWS auth status listener if enabled
  let unsubscribeAuthStatus: (() => void) | undefined
  if (options.enableAuthStatus) {
    const authStatusManager = AwsAuthStatusManager.getInstance()
    unsubscribeAuthStatus = authStatusManager.subscribe(status => {
      output.enqueue({
        type: 'auth_status',
        isAuthenticating: status.isAuthenticating,
        output: status.output,
        error: status.error,
        uuid: randomUUID(),
        session_id: getSessionId(),
      })
    })
  }

  // Set up rate limit status listener to emit SDKRateLimitEvent for all status changes.
  // Emitting for all statuses (including 'allowed') ensures consumers can clear warnings
  // when rate limits reset. The upstream emitStatusChange already deduplicates via isEqual.
  const rateLimitListener = (limits: ClaudeAILimits) => {
    const overageEnabled =
      limits.status === 'allowed_warning' &&
      limits.rateLimitType !== 'overage' &&
      isClaudeAISubscriber()
        ? getOauthAccountInfo()?.hasExtraUsageEnabled
        : undefined
    const rateLimitInfo = toSDKRateLimitInfo(limits, {
      ...(overageEnabled !== undefined && { overageEnabled }),
    })
    if (rateLimitInfo) {
      output.enqueue({
        type: 'rate_limit_event',
        rate_limit_info: rateLimitInfo,
        uuid: randomUUID(),
        session_id: getSessionId(),
      } as unknown as Parameters<typeof output.enqueue>[0])
    }
  }
  statusListeners.add(rateLimitListener)

  // Messages for internal tracking, directly mutated by ask(). These messages
  // include Assistant, User, Attachment, and Progress messages.
  // TODO: Clean up this code to avoid passing around a mutable array.
  const mutableMessages: Message[] = initialMessages
  // densable print `uDo` — projects pDo source. GB + isProjectsSession still
  // default off; snapshotThreadState stays no-op until those gates pass.
  setProjectsThreadStateSource({
    messages: () => mutableMessages,
    isProjectsSession: () => false,
    isThread: () => false,
    isOverview: () => false,
    ownerRowsWrittenAt: () => undefined,
  })

  // densable T.current=P after loadInitialMessages — live array for W4g/lVr
  void import('../../utils/sandbox/sandboxNetworkHeadlessRefs.js').then(m => {
    m.setSandboxNetworkHeadlessMessages(mutableMessages)
  })

  // Seed the readFileState cache from the transcript (content the model saw,
  // with message timestamps) so getChangedFiles can detect external edits.
  // This cache instance must persist across ask() calls, since the edit tool
  // relies on this as a global state.
  let readFileState = extractReadFilesFromMessages(
    initialMessages,
    getCwd(),
    READ_FILE_STATE_CACHE_SIZE,
  )
  const sessionToolState = new ToolStateSlots()
  const sessionTaskRegistry = createTaskRegistry(getAppState, setAppState)

  // Client-supplied readFileState seeds (via seed_read_state control request).
  // The stdin IIFE runs concurrently with ask() — a seed arriving mid-turn
  // would be lost to ask()'s clone-then-replace (QueryEngine.ts finally block)
  // if written directly into readFileState. Instead, seeds land here, merge
  // into getReadFileCache's view (readFileState-wins-ties: seeds fill gaps),
  // and are re-applied then CLEARED in setReadFileCache. One-shot: each seed
  // survives exactly one clone-replace cycle, then becomes a regular
  // readFileState entry subject to compact's clear like everything else.
  const pendingSeeds = createFileStateCacheWithSizeLimit(
    READ_FILE_STATE_CACHE_SIZE,
  )

  // Auto-resume interrupted turns on restart so CC continues from where it
  // left off without requiring the SDK to re-send the prompt.
  // Official --reply-on-resume (bg mid-turn fork / exit handoff) is the same
  // path without needing CLAUDE_CODE_RESUME_INTERRUPTED_TURN.
  // Official RESUME_INTERRUPTED_TURN densable.
  let resumeInterruptedTurnEnv = Boolean(
    process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN,
  )
  try {
    const { isResumeInterruptedTurnEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    resumeInterruptedTurnEnv = isResumeInterruptedTurnEnabled()
  } catch {
    // keep raw env fallback
  }
  const shouldReplyOnResume =
    resumeInterruptedTurnEnv || Boolean(options.replyOnResume)
  // Official 2.1.323 #2078 & #2144 & 2.1.325 #2316: never auto-resume a turn
  // stopped by a hook returning `continue: false`, nor a trailing no-reply
  // file arrival note right after a completed first reply, nor a Code Mode
  // session that ended mid-script (`waitForNextPrompt === true`).
  const resumeBlockedByHookOrNoReplyNote =
    wasTurnStoppedByHook(mutableMessages) ||
    isTrailingNoReplyNote(mutableMessages) ||
    options.codeModeWaitForNextPrompt === true
  if (
    turnInterruptionState &&
    turnInterruptionState.kind !== 'none' &&
    shouldReplyOnResume &&
    !resumeBlockedByHookOrNoReplyNote
  ) {
    logForDebugging(
      `[print.ts] Auto-resuming interrupted turn (kind: ${turnInterruptionState.kind}${options.replyOnResume ? ', reply-on-resume' : ''})`,
    )
    // densable BJr: tengu_resume_interrupted_turn surface/kind
    logEvent('tengu_resume_interrupted_turn', {
      surface:
        'print' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      kind: (turnInterruptionState.message.isMeta
        ? 'synthetic_continue'
        : 'resubmit') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    // Remove the interrupted message and its sentinel, then re-enqueue so
    // the model sees it exactly once. For mid-turn interruptions, the
    // deserialization layer transforms them into interrupted_prompt by
    // appending a synthetic "Continue from where you left off." message.
    removeInterruptedMessage(mutableMessages, turnInterruptionState.message)
    {
      const answered = new Set<string>()
      let lastAssistantUses: string[] = []
      for (const message of mutableMessages) {
        if (message.type === 'user') {
          const content = message.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (
                block !== null &&
                typeof block === 'object' &&
                (block as { type?: unknown }).type === 'tool_result' &&
                typeof (block as { tool_use_id?: unknown }).tool_use_id ===
                  'string'
              ) {
                answered.add((block as { tool_use_id: string }).tool_use_id)
              }
            }
          }
        }
        if (message.type === 'assistant') {
          const content = message.message?.content
          lastAssistantUses = []
          if (Array.isArray(content)) {
            for (const block of content) {
              if (
                block !== null &&
                typeof block === 'object' &&
                (block as { type?: unknown }).type === 'tool_use' &&
                typeof (block as { id?: unknown }).id === 'string'
              ) {
                lastAssistantUses.push((block as { id: string }).id)
              }
            }
          }
        }
      }
      for (const id of lastAssistantUses) {
        if (!answered.has(id)) {
          recoveredToolUseIds.add(id)
        }
      }
    }
    const interruptedMsg =
      turnInterruptionState.message as typeof turnInterruptionState.message & {
        client_composed?: boolean
        seeded_summon?: boolean
        queueSkipSlashCommands?: boolean
      }
    const reRunUuid = randomUUID()
    const reRunCmd = {
      mode: 'prompt' as const,
      value: interruptedMsg.message!.content as string | ContentBlockParam[],
      uuid: reRunUuid,
      ...(interruptedMsg.client_composed === true ||
      interruptedMsg.queueSkipSlashCommands === true
        ? { skipSlashCommands: true }
        : {}),
      ...(interruptedMsg.client_composed === true ||
      interruptedMsg.seeded_summon === true
        ? { skipAttachments: true }
        : {}),
      ...(turnInterruptionState.endedOnApiError !== undefined &&
      recoveredToolUseIds.size === 0
        ? { yieldsToPersonPrompt: turnInterruptionState.endedOnApiError }
        : {}),
      ...(turnInterruptionState.endedOnApiErrorPastCalls !== undefined
        ? {
            yieldsToPersonPrompt:
              turnInterruptionState.endedOnApiErrorPastCalls,
            wentPastOpenCalls: true,
          }
        : {}),
    } as QueuedCommand & RescueYieldCommandHead
    pendingReRunSends.leaveItsSendsTo({
      uuid: reRunUuid,
      isMeta: interruptedMsg.isMeta === true,
      resumedTurnUserMessageUuid: interruptedMsg.uuid,
    })
    cutOffReRunStopTracker.arm(
      reRunUuid,
      interruptedMsg as unknown as Record<string, unknown>,
    )
    enqueue(reRunCmd)
  } else if (turnInterruptionState && turnInterruptionState.kind !== 'none') {
    // Official 2.1.323 #1981 & #2142: when an interrupted message is NOT
    // resumed, strip any synthetic NRR sentinel / meta continuation and mark
    // the interrupted message as non-chain-parent so the next user message
    // does not join onto it, while keeping real user messages visible (#2142).
    stripUnresumedInterruptedMessages(mutableMessages, turnInterruptionState)
    if (turnInterruptionState.message.uuid) {
      markNotChainParent(turnInterruptionState.message.uuid)
    }
  }

  // Official Evf + Svf parked-permission resume densable — when
  // resume-interrupted is on and external_metadata.pending_action is a
  // non-dialog permission, plan a short grace wait for a late control_response.
  // The actual wait runs at message-loop start (async) so unexpected answers
  // can still land via handleOrphanedPermissionResponse.
  let parkedPermissionResumePlan:
    | {
        wait: true
        parked: { request_id: string; tool_use_id: string }
        waitMs: number
      }
    | undefined
  if (shouldReplyOnResume && !options.codeModeWaitForNextPrompt) {
    try {
      const { planParkedPermissionResume } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/userDialog.js') as typeof import('../../utils/userDialog.js')
      const { getSessionMetadataSnapshot } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/sessionState.js') as typeof import('../../utils/sessionState.js')
      const meta = getSessionMetadataSnapshot()
      const plan = planParkedPermissionResume({
        resumeInterruptedTurn: true,
        pendingAction: meta.pending_action ?? null,
        restoreKind: turnInterruptionState?.kind ?? 'worker',
      })
      if (plan.wait) {
        parkedPermissionResumePlan = plan
        logForDebugging(
          `[print.ts] Parked permission toolUseID=${plan.parked.tool_use_id} request_id=${plan.parked.request_id} waitMs=${plan.waitMs}`,
        )
      }
    } catch {
      // densable optional
    }
  }

  const modelOptions = getModelOptions()
  const modelInfos = modelOptions.map(option => {
    const modelId = option.value === null ? 'default' : option.value
    const resolvedModel =
      modelId === 'default'
        ? getDefaultMainLoopModel()
        : parseUserSpecifiedModel(modelId)
    const hasEffort = modelSupportsEffort(resolvedModel)
    const hasAdaptiveThinking = modelSupportsAdaptiveThinking(resolvedModel)
    const hasFastMode = isFastModeSupportedByModel(option.value)
    const hasAutoMode = modelSupportsAutoMode(resolvedModel)
    return {
      name: modelId,
      value: modelId,
      displayName: option.label,
      description: option.description,
      ...(hasEffort && {
        supportsEffort: true,
        supportedEffortLevels: modelSupportsMaxEffort(resolvedModel)
          ? [...EFFORT_LEVELS]
          : EFFORT_LEVELS.filter(l => l !== 'max'),
      }),
      ...(hasAdaptiveThinking && { supportsAdaptiveThinking: true }),
      ...(hasFastMode && { supportsFastMode: true }),
      ...(hasAutoMode && { supportsAutoMode: true }),
    }
  })
  let activeUserSpecifiedModel = options.userSpecifiedModel

  // Official 2.1.326 #246 (`UPs`): rapid follow-up preemption controller for
  // SDK hosts that declared `rapidFollowupPreempt: true` in `initialize`.
  const {
    RapidFollowupPreemptController,
    declareSdkRapidFollowupPreempt,
    isRapidFollowupPreemptEnabled,
  } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../rapidFollowupPreempt.js') as typeof import('../rapidFollowupPreempt.js')

  const rapidFollowupDrain = {
    get abortController() {
      return streamCtx.abortController ?? undefined
    },
    endSessionRequested: false,
  }
  const rapidFollowupPreempt = new RapidFollowupPreemptController({
    messageQueue: {
      getCommandQueueSnapshot,
      subscribe: subscribeToCommandQueue,
    },
    drain: rapidFollowupDrain,
    enabled: isRapidFollowupPreemptEnabled,
    emit: frame => {
      output.enqueue({
        ...frame,
        uuid: randomUUID(),
        session_id: getSessionId(),
      } as unknown as StdoutMessage)
    },
  })
  rapidFollowupPreempt.install()

  const idleTimeout = createIdleTimeoutManager(() => !streamCtx.running)

  const streamCtx: HeadlessStreamingContext = {
    structuredIO,
    mcpClients,
    commands,
    tools,
    canUseTool,
    sdkMcpConfigs,
    getAppState,
    setAppState,
    agents,
    options,
    printRequestDialog,
    output,
    mutableMessages,
    sessionToolState,
    sessionTaskRegistry,
    pendingSeeds,
    modelInfos,
    pendingReRunSends,
    cutOffReRunStopTracker,
    wireRetractedTracker,
    ccrFolderRestorer,
    costMetadataPusher,
    recoveredToolUseIds,
    suggestionState,
    mcpStartupAbortRef,
    rapidFollowupDrain,
    rapidFollowupPreempt,
    declareSdkRapidFollowupPreempt,
    idleTimeout,
    elicitationRegistered: new Map<string, object>(),
    CLAIM_SESSION_START_QUEUE_WAIT_MS: 30_000,
    parkedPermissionResumePlan,
    rateLimitListener,
    unsubscribeAuthStatus,
    unregisterHookHeartbeatSink,

    // Mutable session state
    pendingDeferredToolUse: options.deferredToolUse,
    deferredCallRefusesTurns: false,
    running: false,
    runPhase: undefined,
    inputClosed: false,
    claimFirstTurnAck: undefined,
    shutdownPromptInjected: false,
    heldBackResult: null,
    turnAbortedForShutdown: false,
    shuttingDownForPrint: false,
    abortController: undefined,
    pendingSetModelPromise: Promise.resolve(),
    printStartGate: undefined,
    printPrewait: undefined,
    pluginCeilingTurns: 0,
    drainingHandoff: undefined,
    cronScheduler: null,
    hookHeartbeatTurnId: 0,
    readFileState,
    activeUserSpecifiedModel,
    sdkClients: [],
    sdkTools: [],
    sdkMcpBackgroundRetry: undefined,
    dynamicMcpState: {
      clients: [],
      tools: [],
      configs: {},
    },
    pendingContextUsagePromise: Promise.resolve(),
    bridgeHandle: null,
    workSecretSession: null,
    hearthMount: null,
    hearthMountStartup: null,
    bridgeLastForwardedIndex: 0,
    pluginInstallPromise: null,
    currentCommands: commands,
    currentAgents: agents,
    activeRunPromise: undefined,
    sessionStoppedAfterRestart: false,

    // Bound helpers (wired immediately below)
    controlPlane: undefined as unknown as HeadlessControlPlane,
    takePendingDeferredToolUse: () => {
      const next = streamCtx.pendingDeferredToolUse
      streamCtx.pendingDeferredToolUse = undefined
      return next
    },
    injectModelSwitchBreadcrumbs: () => {},
    registerElicitationHandlers: () => {},
    updateSdkMcp: async () => {},
    seedHeadlessMcpIdentity: () => {},
    attachHeadlessRemoteReconnect: () => {},
    headlessMcpIdentityBoundary:
      undefined as unknown as HeadlessStreamingContext['headlessMcpIdentityBoundary'],
    withControlReconnect: async (_name, work) => work(),
    buildAllTools: () => tools,
    drainPrintSdkEvents: () => {},
    forwardMessagesToBridge: () => {},
    applyMcpServerChanges: async () => ({
      response: { added: [], removed: [], errors: {} },
      sdkServersChanged: false,
    }),
    buildMcpServerStatuses: () => [],
    refreshPluginState: async () => {},
    applyPluginMcpDiff: async () => {},
    unsubscribeSkillChanges: () => {},
    scheduleProactiveTick: undefined,
    run: async () => {},
    sendControlResponseSuccess: () => {},
    sendControlResponseError: () => {},
  }

  setBackgroundCeilingProvider(() => {
    if (
      options.maxBudgetUsd !== undefined &&
      getTotalCostUSD() >= options.maxBudgetUsd
    ) {
      return 'the run is past its --max-budget-usd limit'
    }
    if (
      options.maxTurns !== undefined &&
      options.maxTurns > 0 &&
      streamCtx.pluginCeilingTurns >= options.maxTurns
    ) {
      return 'the run reached its --max-turns limit'
    }
    if (streamCtx.inputClosed) {
      return 'the host has ended its input'
    }
    return undefined
  })
  setSpawnedTurnTakenCallback(() => {
    streamCtx.pluginCeilingTurns += 1
  })

  // densable print/SDK signal ownership (uxs / Vwo):
  // SIGINT → Vwo user_abort + abort turn + gracefulShutdown(0)
  // SIGTERM → Vwo remote_cancel + abort turn + kill Bash trees + exit 143
  const cancelLoopWakeupsOnSignal = (
    reason: 'user_abort' | 'remote_cancel',
  ) => {
    try {
      const { cancelLoopWakeupsOnUserAbort } =
        require('../../utils/loopDynamic.js') as typeof import('../../utils/loopDynamic.js')
      cancelLoopWakeupsOnUserAbort(reason)
    } catch {
      // loopDynamic may be unavailable in partial test mocks
    }
  }
  const sigintHandler = () => {
    logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGINT' })
    streamCtx.shuttingDownForPrint = true
    cancelLoopWakeupsOnSignal('user_abort')
    if (
      streamCtx.abortController &&
      !streamCtx.abortController.signal.aborted
    ) {
      streamCtx.turnAbortedForShutdown = true
      streamCtx.abortController.abort(createAbortErrorReason('user-cancel'))
    }
    void gracefulShutdown(0)
  }
  process.on('SIGINT', sigintHandler)

  const sigtermHandler = () => {
    logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGTERM' })
    streamCtx.shuttingDownForPrint = true
    cancelLoopWakeupsOnSignal('remote_cancel')
    if (
      streamCtx.abortController &&
      !streamCtx.abortController.signal.aborted
    ) {
      streamCtx.turnAbortedForShutdown = true
      streamCtx.abortController.abort(createAbortErrorReason('remote-cancel'))
    }
    void gracefulShutdown(143)
  }
  process.on('SIGTERM', sigtermHandler)
  markPrintModeSignalHandlersRegistered()

  // Dump run()'s state at SIGTERM so a stuck session's healthsweep can name
  // the do/while(waitingForAgents) poll without reading the transcript.
  registerCleanup(async () => {
    const bg: Record<string, number> = {}
    for (const t of getRunningTasks(getAppState())) {
      if (isBackgroundTask(t)) bg[t.type] = (bg[t.type] ?? 0) + 1
    }
    logForDiagnosticsNoPII('info', 'run_state_at_shutdown', {
      run_active: streamCtx.running,
      run_phase: streamCtx.runPhase,
      worker_status: getSessionState(),
      internal_events_pending: structuredIO.internalEventsPending,
      bg_tasks: bg,
    })
  })

  // Abort the current operation when a 'now' priority message arrives.
  subscribeToCommandQueue(() => {
    if (
      streamCtx.abortController &&
      getCommandsByMaxPriority('now').length > 0
    ) {
      // densable Dm.interruptBeforeArm — latch user-intent cmds before abort.
      streamCtx.printPrewait?.interruptBeforeArm(getCommandQueue())
      streamCtx.abortController.abort('interrupt')
    }
  })

  // Initialize MCP/plugin lifecycle, turn runner, UDS inbox, and Kairos cron
  initializeStreamingMcpAndPlugins(streamCtx)
  streamCtx.run = createTurnRunner(streamCtx)
  setupUdsInboxLoop(streamCtx)
  setupKairosCronLoop(streamCtx)

  const controlPlane = new HeadlessControlPlane({
    output,
    getAppState: getAppState as () => HeadlessAppState,
    setAppState: setAppState as unknown as (
      f: (prev: HeadlessAppState) => HeadlessAppState,
    ) => void,
    onConnectedClient: client => {
      streamCtx.registerElicitationHandlers([client])
      reregisterChannelHandlerAfterReconnect(client)
    },
  })
  streamCtx.controlPlane = controlPlane
  streamCtx.sendControlResponseSuccess = (message, response) =>
    controlPlane.sendControlResponseSuccess(message, response)
  streamCtx.sendControlResponseError = (message, errMsg) =>
    controlPlane.sendControlResponseError(message, errMsg)

  // Handle unexpected permission responses by looking up the unresolved tool
  // call in the transcript and executing it
  const handledOrphanedToolUseIds = new Set<string>()
  structuredIO.setUnexpectedResponseCallback(async message => {
    await handleOrphanedPermissionResponse({
      message,
      setAppState,
      getAppState,
      handledToolUseIds: handledOrphanedToolUseIds,
      sessionStoppedAfterRestart: streamCtx.sessionStoppedAfterRestart,
      onEnqueued: () => {
        // The first message of a session might be the orphaned permission
        // check rather than a user prompt, so kick off the loop.
        void streamCtx.run()
      },
    })
  })

  startControlInputLoop(streamCtx)

  return output
}
