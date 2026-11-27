import { feature } from 'bun:bundle'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID } from 'crypto'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getSessionId } from '../bootstrap/state.js'
import type { QuerySource } from '../constants/querySource.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { isResumedUsageMessageDelta } from '../services/api/claude/streamResumption.js'
import { isPromptTooLongMessage } from '../services/api/errors.js'
import { FallbackTriggeredError } from '../services/api/withRetry.js'
import { recordSentClaudeMdTokens } from '../services/compact/autoCompact.js'
import { applyStreamMediaReplay } from '../services/compact/streamMediaReplay.js'
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import {
  mergeToolDrainEvents,
  StreamingToolExecutor,
} from '../services/tools/StreamingToolExecutor.js'
import { isToolBridgeEvent } from '../services/tools/toolExecution.js'
import { findToolByName, type ToolUseContext } from '../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  UserMessage,
} from '../types/message.js'
import { prependUserContext } from '../utils/api.js'
import { createAttachmentMessage } from '../utils/attachments.js'
import { injectBatchingReminder } from '../utils/batchingReminder.js'
import { getContextWindowForModel } from '../utils/context.js'
import { logAntError, logForDebugging } from '../utils/debug.js'
import { ImageResizeError } from '../utils/imageResizer.js'
import { ImageSizeError } from '../utils/imageValidation.js'
import { logError } from '../utils/log.js'
import {
  createAssistantAPIErrorMessage,
  isThinkingMessage,
  stripSignatureBlocks,
} from '../utils/messages.js'
import { renderModelName } from '../utils/model/model.js'
import { getModelFacts, type ModelFacts } from '../utils/model/modelFacts.js'
import { getAPIProvider } from '../utils/model/providers.js'
import {
  applyPluginToolListDenyRules,
  applyPluginToolListFilter,
} from '../utils/plugins/pluginToolList.js'
import type { PromptCacheTtl } from '../utils/promptCacheTtl.js'
import { queryCheckpoint } from '../utils/queryProfiler.js'
import type { SystemPrompt } from '../utils/systemPromptType.js'
import {
  deriveAttributionFromQuerySource,
  type OTelAttributionInput,
} from '../utils/telemetry/pluginTelemetry.js'
import {
  emitRelayThinkingStripped,
  takePendingThinkingStripped,
  type ThinkingConfig,
  type ThinkingStripPlan,
} from '../utils/thinking.js'
import type { AdvisorStripPlan } from '../utils/messages.js'
import type { EffortValue } from '../utils/effort.js'
import { accumulateToolResultForMidTurn } from './accumulateToolResultForMidTurn.js'
import type { QueryConfig } from './config.js'
import type { QueryDeps } from './deps.js'
import {
  endTurnSourceFromToolResult,
  type ToolEndTurnSource,
} from './endTurnFromToolResult.js'
import {
  isTruncatedAfterOutputRecovery,
  isWithheldMaxOutputTokens,
  resolveRefusalFallbackCandidate,
  yieldMissingToolResultBlocks,
} from './queryHelpers.js'
import type {
  BackfillClonePair,
  QueryLoopEvent,
  RefusalFallbackLoopState,
} from './queryTypes.js'
import type { Terminal } from './transitions.js'
import {
  isSafetyMonitorBlockedMessage,
  isSameModelRefusalMessage,
} from './turnHelpers.js'
import {
  type CallModelParams,
  getQueryFunctionHooks,
  streamTurnStepWithHooks,
} from './turnStepHooks.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const reactiveCompact = feature('REACTIVE_COMPACT')
  ? (require('../services/compact/reactiveCompact.js') as typeof import('../services/compact/reactiveCompact.js'))
  : null
const contextCollapse = feature('CONTEXT_COLLAPSE')
  ? (require('../services/contextCollapse/index.js') as typeof import('../services/contextCollapse/index.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

function syncBackfillClones(backfillClones: BackfillClonePair[]): void {
  for (const { src, dst } of backfillClones) {
    const srcMsg = src.message as unknown as Record<string, unknown>
    const dstMsg = dst.message as unknown as Record<string, unknown>
    dst.message.usage = src.message.usage
    dst.message.stop_reason = src.message.stop_reason
    if ('stop_details' in srcMsg) {
      dstMsg.stop_details = srcMsg.stop_details
    }
    if (srcMsg.context_management !== undefined) {
      dstMsg.context_management = srcMsg.context_management
    }
    if (srcMsg.resumable !== undefined) {
      dstMsg.resumable = srcMsg.resumable
    }
    if (srcMsg.pausedResponses !== undefined) {
      dstMsg.pausedResponses = srcMsg.pausedResponses
    }
  }
}

function* emitRefusalContinuationEnd(deps: {
  path: 'success' | 'error'
  loopState: RefusalFallbackLoopState
  queryChainIdForAnalytics: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  queryDepth: number
  querySource: QuerySource
  clearExactOnBareEnd: boolean
}): Generator<QueryLoopEvent, void> {
  const {
    path,
    loopState,
    queryChainIdForAnalytics,
    queryDepth,
    querySource,
    clearExactOnBareEnd,
  } = deps
  if (loopState.convoluteArcadesRetryActive) {
    loopState.convoluteArcadesRetryActive = false
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveConvoluteArcadesRetryOutcome } =
        require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
      const outcome = resolveConvoluteArcadesRetryOutcome({
        path,
        silentStitchPending: loopState.silentStitchPending,
      })
      loopState.silentStitchPending = false
      loopState.silentStitchText = undefined
      loopState.partialResponseMetaMessage = undefined
      loopState.exactSalvagePackage = undefined
      logEvent('tengu_convolute_arcades_retry_outcome', {
        outcome:
          outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        queryChainId: queryChainIdForAnalytics,
        queryDepth,
        querySource:
          querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } catch {
      loopState.silentStitchPending = false
      loopState.silentStitchText = undefined
      loopState.partialResponseMetaMessage = undefined
      loopState.exactSalvagePackage = undefined
    }
    yield {
      type: 'refusal_continuation' as const,
      phase: 'end' as const,
    } as unknown as Message
    loopState.refusalContinuationActive = false
  } else if (loopState.refusalContinuationActive) {
    loopState.refusalContinuationActive = false
    if (clearExactOnBareEnd) {
      loopState.exactSalvagePackage = undefined
    }
    yield {
      type: 'refusal_continuation' as const,
      phase: 'end' as const,
    } as unknown as Message
  }
}

export type RunStreamingApiAttemptResult =
  | {
      ok: false
      terminal: Terminal
    }
  | {
      ok: true
      currentModel: string
      modelFacts: ModelFacts
      toolUseContext: ToolUseContext
      messagesForQuery: Message[]
      streamingToolExecutor: StreamingToolExecutor
      needsFollowUp: boolean
      toolRequestedEndTurn: ToolEndTurnSource | false
      lastDeltaStopReason: string | undefined
      lastDeltaOutputTokens: number | undefined
      withheldLongContextRefusal: AssistantMessage | undefined
      withheldSafetyMonitorBlock: AssistantMessage | undefined
      withheldSameModelRefusal: AssistantMessage | undefined
    }

/**
 * Runs the streaming API attempt loop with transparent refusal/availability
 * model fallback, server_fallback seam merging, silent-stitch salvage,
 * tool_use observable-input backfill, withheld error buffering, and live
 * StreamingToolExecutor draining.
 */
export async function* runStreamingApiAttemptWithFallbacks(deps: {
  messagesForQuery: Message[]
  fullSystemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  fallbackModel: string | undefined
  querySource: QuerySource
  skipCacheWrite: boolean | undefined
  agentCacheTtlOverride: PromptCacheTtl | undefined
  thinkingStripPlan: ThinkingStripPlan | undefined
  advisorStripPlan: AdvisorStripPlan | undefined
  promptRenderEpoch: number
  currentModel: string
  modelFacts: ModelFacts
  layeredThinkingConfig: ThinkingConfig
  layeredEffortValue: EffortValue | undefined
  maxOutputTokensOverride: number | undefined
  maxOutputTokensRecoveryCount: number
  resumeIncompleteThinking: boolean | undefined
  taskBudgetTotal: number | undefined
  taskBudgetRemaining: number | undefined
  config: QueryConfig
  queryDeps: QueryDeps
  queryTracking: { chainId: string; depth: number }
  queryChainIdForAnalytics: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  turnStepTurnId: string | undefined
  nextTurnStepIndex: () => number
  dumpPromptsFetch: CallModelParams['options']['fetchOverride']
  autoModeServerContextKickoff: unknown
  capturedMcpAttribution: {
    activeMcpServer?: string
    activeMcpTool?: string
  }
  attributeMcpUsage: boolean
  clearActiveMcpStamps: (
    opts: ToolUseContext['options'],
    enabled: boolean,
  ) => void
  mediaRecoveryEnabled: boolean
  sameModelRefusalArmed: boolean
  assistantMessages: AssistantMessage[]
  toolResults: (UserMessage | AttachmentMessage)[]
  toolUseBlocks: ToolUseBlock[]
  streamingToolExecutor: StreamingToolExecutor
  leftoverStampTurnEffort: (model: unknown) => void
  leftoverDrainSpinnerModes: () => Generator<QueryLoopEvent>
}): AsyncGenerator<QueryLoopEvent, RunStreamingApiAttemptResult> {
  const {
    fullSystemPrompt,
    userContext,
    canUseTool,
    fallbackModel,
    querySource,
    skipCacheWrite,
    agentCacheTtlOverride,
    thinkingStripPlan,
    advisorStripPlan,
    promptRenderEpoch,
    layeredThinkingConfig,
    layeredEffortValue,
    maxOutputTokensOverride,
    maxOutputTokensRecoveryCount,
    resumeIncompleteThinking,
    taskBudgetTotal,
    taskBudgetRemaining,
    config,
    queryDeps,
    queryTracking,
    queryChainIdForAnalytics,
    turnStepTurnId,
    nextTurnStepIndex,
    dumpPromptsFetch,
    autoModeServerContextKickoff,
    capturedMcpAttribution,
    attributeMcpUsage,
    clearActiveMcpStamps,
    mediaRecoveryEnabled,
    sameModelRefusalArmed,
    assistantMessages,
    toolResults,
    toolUseBlocks,
    leftoverStampTurnEffort,
    leftoverDrainSpinnerModes,
  } = deps

  let currentModel = deps.currentModel
  let modelFacts = deps.modelFacts
  let toolUseContext = deps.toolUseContext
  let messagesForQuery = deps.messagesForQuery
  let streamingToolExecutor = deps.streamingToolExecutor
  let needsFollowUp = false
  let toolRequestedEndTurn: ToolEndTurnSource | false = false

  const appState = toolUseContext.getAppState()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getToolPermissionContextFromLayers } =
    require('../engine/permissionLayerReaders.js') as typeof import('../engine/permissionLayerReaders.js')

  const loopState: RefusalFallbackLoopState = {
    attemptWithFallback: true,
    refusalContinuationActive: false,
    silentStitchPending: false,
    silentStitchText: undefined,
    exactSalvagePackage: undefined,
    clientRetrySupersedesUuids: undefined,
    convoluteArcadesRetryActive: false,
    partialResponseMetaMessage: undefined,
    pendingFallbackCreditCode: undefined,
    pendingFallbackCreditMintModel: undefined,
    refusalFallbackPreferencePending: false,
    refusalFallbackPreferenceChoice: undefined,
    refusalFallbackEffort: undefined,
    lastBatchingReminderSent: undefined,
    triedFallbackModels: new Set<string>([currentModel]),
    lastDeltaStopReason: undefined,
    lastDeltaOutputTokens: undefined,
    backfillClones: [],
    withheldLongContextRefusal: undefined,
    withheldSafetyMonitorBlock: undefined,
    withheldSameModelRefusal: undefined,
    pendingCallerFallbackRequest: undefined,
  }

  try {
    while (loopState.attemptWithFallback) {
      loopState.attemptWithFallback = false
      loopState.lastDeltaStopReason = undefined
      loopState.lastDeltaOutputTokens = undefined
      loopState.backfillClones.length = 0
      loopState.withheldSafetyMonitorBlock = undefined
      loopState.withheldSameModelRefusal = undefined
      loopState.pendingCallerFallbackRequest = undefined

      try {
        let streamingFallbackOccured = false
        const withheldMediaBuffer: Array<
          StreamEvent | AssistantMessage | SystemAPIErrorMessage
        > = []
        queryCheckpoint('query_api_streaming_start')

        // densable _u / mXn — skip inject when silent-stitch meta (_o)
        const injected =
          loopState.partialResponseMetaMessage !== undefined
            ? {
                messages: [
                  ...messagesForQuery,
                  loopState.partialResponseMetaMessage,
                ],
                text: null as string | null,
                afterUuid: null as string | null,
              }
            : injectBatchingReminder(
                messagesForQuery,
                { id: getSessionId() },
                currentModel,
              )
        if (
          injected.text !== null &&
          injected.afterUuid !== null &&
          !(
            loopState.lastBatchingReminderSent?.afterUuid ===
              injected.afterUuid &&
            loopState.lastBatchingReminderSent.text === injected.text &&
            loopState.lastBatchingReminderSent.model === currentModel
          )
        ) {
          loopState.lastBatchingReminderSent = {
            afterUuid: injected.afterUuid,
            text: injected.text,
            model: currentModel,
          }
          const sent = createAttachmentMessage({
            type: 'batching_reminder_sent',
            text: injected.text,
            model: currentModel,
          })
          yield sent
          messagesForQuery = [...messagesForQuery, sent]
        }
        const callMessages = injected.messages
        const creditCodeForAttempt = loopState.pendingFallbackCreditCode
        const creditMintModelForAttempt =
          loopState.pendingFallbackCreditMintModel
        loopState.pendingFallbackCreditCode = undefined
        loopState.pendingFallbackCreditMintModel = undefined

        const autoModeServerContext = await (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { awaitAutoModeServerContext } =
              require('../services/api/autoModeServerContext.js') as typeof import('../services/api/autoModeServerContext.js')
            return await awaitAutoModeServerContext(
              autoModeServerContextKickoff as Parameters<
                typeof awaitAutoModeServerContext
              >[0],
            )
          } catch {
            return undefined
          }
        })()
        const serverClassifierKickoffActive = (() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { isServerClassifierKickoffActive } =
              require('../services/api/autoModeServerContext.js') as typeof import('../services/api/autoModeServerContext.js')
            return isServerClassifierKickoffActive(toolUseContext)
          } catch {
            return false
          }
        })()

        // Official 2.1.323 #2126: forward active skill/plugin/agent/MCP attribution
        const derivedAttribution = deriveAttributionFromQuerySource(
          querySource,
          toolUseContext.options.activeSkill,
        )
        const requestAttribution: OTelAttributionInput | undefined =
          derivedAttribution.attributionSkill !== undefined ||
          derivedAttribution.attributionPlugin !== undefined ||
          derivedAttribution.attributionAgent !== undefined ||
          capturedMcpAttribution.activeMcpServer !== undefined
            ? {
                ...derivedAttribution,
                ...(capturedMcpAttribution.activeMcpServer !== undefined
                  ? {
                      attributionMcpServer:
                        capturedMcpAttribution.activeMcpServer,
                    }
                  : {}),
                ...(capturedMcpAttribution.activeMcpTool !== undefined
                  ? {
                      attributionMcpTool: capturedMcpAttribution.activeMcpTool,
                    }
                  : {}),
              }
            : undefined

        const modelCallArgs: CallModelParams = {
          messages: prependUserContext(callMessages, userContext),
          systemPrompt: fullSystemPrompt,
          thinkingConfig: layeredThinkingConfig,
          tools: applyPluginToolListFilter(toolUseContext.options.tools),
          signal: toolUseContext.abortController.signal,
          options: {
            async getToolPermissionContext() {
              return applyPluginToolListDenyRules(
                getToolPermissionContextFromLayers(toolUseContext),
              )
            },
            model: currentModel,
            modelFacts,
            promptRenderEpoch,
            ...(config.gates.fastModeEnabled && {
              fastMode: appState.fastMode,
            }),
            toolChoice: undefined,
            isNonInteractiveSession:
              toolUseContext.options.isNonInteractiveSession,
            fallbackModel,
            ...(() => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const {
                  planRefusalFallbackArm,
                  resolveSilentRearmModel,
                  resolveRefusalFallbackModelAndLane,
                  isRefusalFallbackEnabled,
                  getSwitchModelsOnFlag,
                  shouldAskRefusalFallbackPreference,
                } =
                  require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
                if (!isRefusalFallbackEnabled()) return {}
                const isMainThread = toolUseContext.agentId === undefined
                loopState.refusalFallbackPreferencePending =
                  shouldAskRefusalFallbackPreference({
                    toolUseContext,
                    isMainThread,
                  })
                const arm = planRefusalFallbackArm({
                  currentModel,
                  alreadyUsed: false,
                  declined: false,
                  requestDialog: toolUseContext.requestDialog,
                  isMainThread,
                  isAgentThread: !isMainThread,
                  switchModelsOnFlag: getSwitchModelsOnFlag(),
                  preferenceQuestionPending:
                    loopState.refusalFallbackPreferencePending,
                  resolveArmedFallbackModel: () =>
                    resolveRefusalFallbackCandidate({
                      currentModel,
                      fallbackModel,
                    }),
                })
                const silentRearm = resolveSilentRearmModel({
                  currentModel,
                  isVisiblyArmable: arm.visibleModel !== undefined,
                  silentRearmGateEnabled: false,
                })
                const resolved = resolveRefusalFallbackModelAndLane({
                  visibleModel: arm.visibleModel,
                  silentRearmModel: silentRearm,
                  serverLane: arm.serverLane,
                })
                if (
                  !resolved.refusalFallbackModel &&
                  !resolved.serverRefusalFallback &&
                  creditCodeForAttempt === undefined
                ) {
                  return {}
                }
                return {
                  ...(resolved.refusalFallbackModel !== undefined && {
                    refusalFallbackModel: resolved.refusalFallbackModel,
                    refusalFallbackModelLane: resolved.refusalFallbackModelLane,
                    refusalFallbackSilentArmActive:
                      resolved.refusalFallbackSilentArmActive,
                  }),
                  ...(resolved.serverRefusalFallback !== undefined && {
                    serverRefusalFallback: resolved.serverRefusalFallback,
                  }),
                  ...(creditCodeForAttempt !== undefined && {
                    fallbackCreditCode: creditCodeForAttempt,
                    ...(creditMintModelForAttempt !== undefined && {
                      fallbackCreditMintModel: creditMintModelForAttempt,
                    }),
                  }),
                  ...(arm.visibleModel !== undefined && {
                    fallbackCreditLaneArmed: true,
                  }),
                  ...(loopState.refusalFallbackPreferencePending && {
                    refusalFallbackPreferencePending: true,
                  }),
                  ...(loopState.refusalFallbackEffort?.model ===
                    currentModel && {
                    refusalFallbackEffort:
                      loopState.refusalFallbackEffort.level,
                  }),
                }
              } catch {
                return {}
              }
            })(),
            onStreamingFallback: () => {
              streamingFallbackOccured = true
            },
            querySource,
            autoModeServerContext,
            ...(autoModeServerContext !== undefined &&
              serverClassifierKickoffActive && { serverClassifier: true }),
            promptTooLongIsHandled: true,
            agents: toolUseContext.options.agentDefinitions.activeAgents,
            allowedAgentTypes:
              toolUseContext.options.agentDefinitions.allowedAgentTypes,
            hasAppendSystemPrompt: !!toolUseContext.options.appendSystemPrompt,
            maxOutputTokensOverride,
            fetchOverride: dumpPromptsFetch,
            mcpTools: appState.mcp.tools,
            hasPendingMcpServers: appState.mcp.clients.some(
              c => c.type === 'pending',
            ),
            activeMcpServer: capturedMcpAttribution.activeMcpServer,
            activeMcpTool: capturedMcpAttribution.activeMcpTool,
            ...(requestAttribution !== undefined
              ? ({
                  attribution: requestAttribution,
                } as Partial<CallModelParams['options']>)
              : {}),
            queryTracking,
            effortValue: layeredEffortValue,
            advisorModel: appState.advisorModel,
            continuesCutReply: maxOutputTokensRecoveryCount > 0,
            ...(resumeIncompleteThinking === true && {
              resumeIncompleteThinking: true,
            }),
            onMessageDelta: () => {
              syncBackfillClones(loopState.backfillClones)
            },
            refusalFallbackHandledByCaller: true,
            skipCacheWrite,
            agentCacheTtlOverride,
            thinkingStripPlan,
            advisorStripPlan,
            agentId: toolUseContext.agentId,
            isBackgroundAgent: toolUseContext.isBackgroundAgent,
            requestDialog: toolUseContext.requestDialog,
            addNotification: toolUseContext.addNotification,
            onRetryStatus: toolUseContext.setRetryStatus,
            ...(taskBudgetTotal !== undefined && {
              taskBudget: {
                total: taskBudgetTotal,
                ...(taskBudgetRemaining !== undefined && {
                  remaining: taskBudgetRemaining,
                }),
              },
            }),
            langfuseTrace: toolUseContext.langfuseTrace,
          },
        }

        const turnStepHooks =
          turnStepTurnId !== undefined ? getQueryFunctionHooks() : null
        const modelStream =
          turnStepTurnId !== undefined &&
          turnStepHooks !== null &&
          turnStepHooks.hasMatchingFunctionHook('turn.step')
            ? streamTurnStepWithHooks({
                hooks: turnStepHooks,
                callModel: queryDeps.callModel,
                callArgs: modelCallArgs,
                turnId: turnStepTurnId,
                stepIndex: nextTurnStepIndex(),
              })
            : queryDeps.callModel(modelCallArgs)

        let recordedClaudeMdTokensForRequest = false
        function* drainStreamingTools(): Generator<QueryLoopEvent> {
          if (
            !streamingToolExecutor ||
            toolUseContext.abortController.signal.aborted
          )
            return
          for (const result of streamingToolExecutor.getCompletedResults()) {
            if (isToolBridgeEvent(result)) {
              yield result
              continue
            }
            if (result.message) {
              yield result.message
              const endTurn = endTurnSourceFromToolResult(result.message)
              if (endTurn) toolRequestedEndTurn = endTurn
              accumulateToolResultForMidTurn(
                result.message,
                toolResults,
                applyPluginToolListFilter(
                  toolUseContext.options.refreshTools?.() ??
                    toolUseContext.options.tools,
                ),
                toolUseContext.options.mainLoopModel,
              )
            }
          }
        }

        for await (const message of mergeToolDrainEvents(
          modelStream,
          () => streamingToolExecutor ?? undefined,
        )) {
          if (message.type === 'tool_drain_tick') {
            yield* drainStreamingTools()
            continue
          }
          if (message.type === 'stream_event') {
            const streamEv = message.event as
              | {
                  type?: unknown
                  delta?: { stop_reason?: unknown }
                  usage?: { output_tokens?: unknown }
                }
              | undefined
            if (streamEv?.type === 'message_delta') {
              if (typeof streamEv.delta?.stop_reason === 'string') {
                loopState.lastDeltaStopReason = streamEv.delta.stop_reason
              }
              if (typeof streamEv.usage?.output_tokens === 'number') {
                loopState.lastDeltaOutputTokens = streamEv.usage.output_tokens
              }
              syncBackfillClones(loopState.backfillClones)
              if (
                !isResumedUsageMessageDelta(
                  streamEv as Parameters<typeof isResumedUsageMessageDelta>[0],
                )
              ) {
                loopState.backfillClones.length = 0
              }
            }
          }
          yield* leftoverDrainSpinnerModes()

          // densable server_fallback consumer — retainedText/Messages + Gt seam gate
          if (
            message &&
            typeof message === 'object' &&
            (message as { type?: string }).type === 'server_fallback'
          ) {
            const sf = message as {
              type: 'server_fallback'
              fromModel: string
              toModel: string
              reason?: string
              apiRefusalCategory?: string | null
              midStream: boolean
              requestId?: string | null
              discardedMessages?: readonly {
                uuid?: string
                isApiErrorMessage?: boolean
                message?: { content?: unknown }
              }[]
              retainedMessages?: readonly {
                uuid?: string
                isApiErrorMessage?: boolean
                message?: { content?: unknown }
              }[]
              retainedText?: string
              finalStopReason?: string | null
            }
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const {
                planServerFallbackSeamMerge,
                buildRefusalContinuationBeginEvent,
                buildQueryModelChangeEvent,
                planRefusalFallbackPresentation,
                buildModelRefusalFallbackSystemMessage,
                SERVER_FALLBACK_SILENT_STITCH_SKIP_WARN,
              } =
                require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
              const discarded = sf.discardedMessages ?? []
              const isMainThread = toolUseContext.agentId === undefined
              const presentation = planRefusalFallbackPresentation({
                reason: sf.reason ?? 'refusal',
                midStream: sf.midStream === true,
                discardedMessages: discarded as readonly {
                  message?: { content?: readonly { type?: string }[] }
                }[],
                requestId: sf.requestId,
                fromModel: sf.fromModel,
                finalStopReason: sf.finalStopReason,
                apiRefusalCategory: sf.apiRefusalCategory,
                isMainThread,
                originalModelScope: querySource,
              })
              logEvent('tengu_server_fallback', {
                from_model:
                  sf.fromModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                to_model:
                  sf.toModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                reason: (sf.reason ??
                  'refusal') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                mid_stream: sf.midStream === true,
                discarded_count: discarded.length,
                retained_chars:
                  typeof sf.retainedText === 'string'
                    ? sf.retainedText.length
                    : 0,
                queryChainId: queryChainIdForAnalytics,
                queryDepth: queryTracking.depth,
                entitlement_blind: presentation.telemetry.entitlementBlind,
              })
              leftoverStampTurnEffort(sf.toModel)
              yield buildQueryModelChangeEvent(sf.toModel) as unknown as Message
              for (const m of discarded) {
                yield {
                  type: 'tombstone' as const,
                  message: m,
                  displayOnly: true,
                } as unknown as Message
              }
              const seam = planServerFallbackSeamMerge({
                midStream: sf.midStream === true,
                retainedText: sf.retainedText,
                retainedMessages: sf.retainedMessages,
                silentStitchPending: loopState.silentStitchPending,
              })
              if (seam.action === 'skip_silent_stitch_pending') {
                logForDebugging(SERVER_FALLBACK_SILENT_STITCH_SKIP_WARN, {
                  level: 'warn',
                })
              } else if (seam.action === 'merge') {
                loopState.refusalContinuationActive = true
                loopState.exactSalvagePackage = {
                  text: seam.yt.text,
                  originals: seam.yt.originals,
                }
                yield buildRefusalContinuationBeginEvent(
                  seam.yt,
                ) as unknown as Message
              }
              if (presentation.showBanner) {
                const banner = buildModelRefusalFallbackSystemMessage({
                  content: `Switched to ${renderModelName(sf.toModel)} after a model refusal on ${renderModelName(sf.fromModel)}`,
                  fromModel: sf.fromModel,
                  toModel: sf.toModel,
                  requestId: sf.requestId,
                  apiRefusalCategory: sf.apiRefusalCategory,
                  timestamp: new Date().toISOString(),
                  uuid: crypto.randomUUID(),
                  reason: sf.reason ?? 'refusal',
                })
                yield banner as unknown as Message
              }
            } catch {
              // densable optional
            }
            continue
          }

          // densable refusal_no_fallback — chain exhausted multi-exit
          if (
            message &&
            typeof message === 'object' &&
            (message as { type?: string }).type === 'refusal_no_fallback'
          ) {
            const rnf = message as {
              type: 'refusal_no_fallback'
              reason?: string
            }
            if (loopState.refusalContinuationActive) {
              loopState.refusalContinuationActive = false
              yield {
                type: 'refusal_continuation' as const,
                phase: 'end' as const,
              } as unknown as Message
            }
            logEvent('tengu_rotunda_pennant_chain_exhausted', {
              reason: (rnf.reason ??
                'client_chain_exhausted') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              queryChainId: queryChainIdForAnalytics,
              queryDepth: queryTracking.depth,
              querySource:
                querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            continue
          }

          // Official stream fallback_request densable consumer (query path)
          if (
            message &&
            typeof message === 'object' &&
            (message as { type?: string }).type === 'fallback_request'
          ) {
            const fb = message as {
              type: 'fallback_request'
              trigger?: string
              originalModel: string
              fallbackModel: string
              requestId?: string | null
              apiRefusalCategory?: string | null
              silentArmAtTrigger?: boolean
              routeMatched?: 'category' | 'catch_all' | null
              creditCode?: string | null
            }
            if (typeof fb.creditCode === 'string' && fb.creditCode.length > 0) {
              loopState.pendingFallbackCreditCode = fb.creditCode
              loopState.pendingFallbackCreditMintModel = fb.originalModel
            }
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const {
                salvageRefusalPartialText,
                planRefusalFallbackPresentation,
                buildModelRefusalFallbackSystemMessage,
                planRefusalContinuationBeginWithSilentStitchGate,
                SERVER_FALLBACK_SILENT_STITCH_SKIP_WARN,
              } =
                require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
              const salvage = salvageRefusalPartialText({
                messages: assistantMessages,
              })
              const isMainThread = toolUseContext.agentId === undefined
              const presentation = planRefusalFallbackPresentation({
                reason: fb.trigger ?? 'refusal',
                midStream: assistantMessages.length > 0,
                discardedMessages: assistantMessages as unknown as readonly {
                  message?: { content?: readonly { type?: string }[] }
                }[],
                requestId: fb.requestId,
                fromModel: fb.originalModel,
                apiRefusalCategory: fb.apiRefusalCategory,
                isMainThread,
                originalModelScope: querySource,
              })
              logEvent('tengu_refusal_fallback_request', {
                original_model:
                  fb.originalModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                fallback_model:
                  fb.fallbackModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                queryChainId: queryChainIdForAnalytics,
                queryDepth: queryTracking.depth,
                mid_stream: presentation.telemetry.midStream,
                had_partial_text: salvage.partialTextChars > 0,
                partial_text_chars: salvage.partialTextChars,
                salvaged_tool_use_count: salvage.toolUseCount,
                silent_arm: fb.silentArmAtTrigger === true,
                entitlement_blind: presentation.telemetry.entitlementBlind,
                ...(fb.routeMatched != null
                  ? {
                      route_matched:
                        fb.routeMatched as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    }
                  : {}),
              })
              if (presentation.showBanner) {
                const banner = buildModelRefusalFallbackSystemMessage({
                  content: `Switched to ${renderModelName(fb.fallbackModel)} after a model refusal on ${renderModelName(fb.originalModel)}`,
                  fromModel: fb.originalModel,
                  toModel: fb.fallbackModel,
                  requestId: fb.requestId,
                  apiRefusalCategory: fb.apiRefusalCategory,
                  timestamp: new Date().toISOString(),
                  uuid: crypto.randomUUID(),
                  reason: 'refusal',
                })
                yield banner as unknown as Message
              }
              const beginPlan =
                planRefusalContinuationBeginWithSilentStitchGate({
                  messages: assistantMessages,
                  silentStitchPending: loopState.silentStitchPending,
                })
              if (beginPlan.action === 'skip_silent_stitch_pending') {
                logForDebugging(SERVER_FALLBACK_SILENT_STITCH_SKIP_WARN, {
                  level: 'warn',
                })
              } else if (beginPlan.action === 'begin') {
                loopState.refusalContinuationActive = true
                try {
                  const { planSilentStitchFillOnFallbackRequest } =
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
                  const fill = planSilentStitchFillOnFallbackRequest({
                    silentArmAtTrigger: fb.silentArmAtTrigger === true,
                    salvageText: beginPlan.event.salvageText,
                  })
                  if (fill.fillSilentStitch) {
                    loopState.silentStitchPending = true
                    if (typeof beginPlan.event.salvageText === 'string') {
                      loopState.silentStitchText = beginPlan.event.salvageText
                      try {
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const {
                          buildPartialResponseSalvageMetaContent,
                          planSameModelRefusalRetryNudge,
                        } =
                          require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const { createUserMessage } =
                          require('../utils/messages.js') as typeof import('../utils/messages.js')
                        const producedNothing =
                          salvage.partialTextChars === 0 &&
                          salvage.toolUseCount === 0
                        const nudgePlan = planSameModelRefusalRetryNudge({
                          producedNothing,
                          interruptedToolCount: salvage.toolUseCount,
                        })
                        loopState.partialResponseMetaMessage =
                          createUserMessage({
                            content: producedNothing
                              ? nudgePlan.nudgeContent
                              : buildPartialResponseSalvageMetaContent(
                                  beginPlan.event.salvageText,
                                ),
                            isMeta: true,
                            ...(nudgePlan.isVirtual && { isVirtual: true }),
                          })
                      } catch {
                        // densable optional
                      }
                    }
                  }
                  if (fill.fillConvolute) {
                    loopState.convoluteArcadesRetryActive = true
                  }
                } catch {
                  if (fb.silentArmAtTrigger === true) {
                    loopState.convoluteArcadesRetryActive = true
                  }
                }
                yield beginPlan.event as unknown as Message
              }
            } catch {
              // densable optional
            }
            if (
              loopState.refusalFallbackPreferencePending &&
              fb.silentArmAtTrigger !== true
            ) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { askRefusalFallbackPreference } =
                  require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
                loopState.refusalFallbackPreferenceChoice =
                  await askRefusalFallbackPreference({
                    canUseTool,
                    toolUseContext,
                    originalModel: fb.originalModel,
                    fallbackModel: fb.fallbackModel,
                    apiRefusalCategory: fb.apiRefusalCategory,
                    telemetry: {
                      original_model: fb.originalModel,
                      fallback_model: fb.fallbackModel,
                    },
                  })
              } catch {
                loopState.refusalFallbackPreferenceChoice = 'retry_fallback'
              }
            }
            loopState.pendingCallerFallbackRequest = {
              originalModel: fb.originalModel,
              fallbackModel: fb.fallbackModel,
              requestId: fb.requestId,
              apiRefusalCategory: fb.apiRefusalCategory,
              silentArmAtTrigger: fb.silentArmAtTrigger,
            }
            loopState.backfillClones.length = 0
            continue
          }

          if (streamingFallbackOccured) {
            streamingFallbackOccured = false
            for (const msg of assistantMessages) {
              yield { type: 'tombstone' as const, message: msg }
            }
            logEvent('tengu_orphaned_messages_tombstoned', {
              orphanedMessageCount: assistantMessages.length,
              queryChainId: queryChainIdForAnalytics,
              queryDepth: queryTracking.depth,
            })

            assistantMessages.length = 0
            toolResults.length = 0
            toolUseBlocks.length = 0
            needsFollowUp = false
            loopState.backfillClones.length = 0

            if (streamingToolExecutor) {
              streamingToolExecutor.discard()
              clearActiveMcpStamps(toolUseContext.options, attributeMcpUsage)
              streamingToolExecutor = new StreamingToolExecutor(
                toolUseContext.options.tools,
                canUseTool,
                toolUseContext,
              )
            }
          }

          let yieldMessage: typeof message = message
          if (message.type === 'assistant') {
            const assistantMsg = message as AssistantMessage
            if (
              !recordedClaudeMdTokensForRequest &&
              !assistantMsg.isApiErrorMessage &&
              toolUseContext.agentId === undefined &&
              querySource !== 'compact' &&
              querySource !== 'session_memory'
            ) {
              recordedClaudeMdTokensForRequest = true
              recordSentClaudeMdTokens(
                userContext.claudeMd
                  ? roughTokenCountEstimation(userContext.claudeMd)
                  : 0,
              )
            }
            const contentArr = Array.isArray(assistantMsg.message?.content)
              ? (assistantMsg.message.content as unknown as Array<{
                  type: string
                  input?: unknown
                  name?: string
                  [key: string]: unknown
                }>)
              : []
            let clonedContent: typeof contentArr | undefined
            for (let i = 0; i < contentArr.length; i++) {
              const block = contentArr[i]!
              if (
                block.type === 'tool_use' &&
                typeof block.input === 'object' &&
                block.input !== null
              ) {
                const tool = findToolByName(
                  toolUseContext.options.tools,
                  block.name as string,
                )
                if (tool?.backfillObservableInput) {
                  const originalInput = block.input as Record<string, unknown>
                  const inputCopy = { ...originalInput }
                  tool.backfillObservableInput(inputCopy)
                  const addedFields = Object.keys(inputCopy).some(
                    k => !(k in originalInput),
                  )
                  if (addedFields) {
                    clonedContent ??= [...contentArr]
                    clonedContent[i] = { ...block, input: inputCopy }
                  }
                }
              }
            }
            if (clonedContent) {
              yieldMessage = {
                ...message,
                message: {
                  ...(assistantMsg.message ?? {}),
                  content: clonedContent,
                },
              } as typeof message
              loopState.backfillClones.push({
                src: assistantMsg,
                dst: yieldMessage as AssistantMessage,
              })
            }
          }

          let withholdPtl = false
          if (feature('CONTEXT_COLLAPSE')) {
            if (
              contextCollapse?.isWithheldPromptTooLong(
                message as Message,
                isPromptTooLongMessage as (msg: Message) => boolean,
                querySource,
              )
            ) {
              withholdPtl = true
            }
          }
          if (reactiveCompact?.isWithheldPromptTooLong(message as Message)) {
            withholdPtl = true
          }
          if (
            !needsFollowUp &&
            reactiveCompact?.isEligibleForLongContextRefusalCompact(
              message as Message,
              getContextWindowForModel(currentModel),
              querySource,
            )
          ) {
            withholdPtl = true
            loopState.withheldLongContextRefusal = message as AssistantMessage
          }
          const { withheld: baseWithheld, replay: withheldMediaReplay } =
            applyStreamMediaReplay(withheldMediaBuffer, message, {
              ptl: withholdPtl,
              media:
                mediaRecoveryEnabled &&
                reactiveCompact?.isWithheldMediaSizeError(
                  message as Message,
                ) === true,
              maxOutputTokens: isWithheldMaxOutputTokens(message),
              truncatedAfterOutput:
                !needsFollowUp &&
                isTruncatedAfterOutputRecovery(
                  message,
                  toolUseContext,
                  querySource,
                ),
            })
          let withheld = baseWithheld
          if (
            !withheld &&
            needsFollowUp &&
            isSafetyMonitorBlockedMessage(message)
          ) {
            withheld = true
            loopState.withheldSafetyMonitorBlock = message
          }
          if (
            !withheld &&
            sameModelRefusalArmed &&
            isSameModelRefusalMessage(message)
          ) {
            withheld = true
            loopState.withheldSameModelRefusal = message
          }

          let landedAssistant: AssistantMessage | undefined
          if (
            message.type === 'assistant' &&
            !(message as AssistantMessage).isApiErrorMessage &&
            (loopState.exactSalvagePackage !== undefined ||
              loopState.silentStitchPending ||
              loopState.clientRetrySupersedesUuids !== undefined)
          ) {
            const assistantForLand = yieldMessage as AssistantMessage
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { planRefusalLandJoin } =
                require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
              const content = assistantForLand.message?.content
              if (
                Array.isArray(content) &&
                (loopState.exactSalvagePackage !== undefined ||
                  loopState.silentStitchPending)
              ) {
                const land = planRefusalLandJoin({
                  content,
                  exactSalvage: loopState.exactSalvagePackage,
                  softSalvageText: loopState.silentStitchText,
                  isMainThread: toolUseContext.agentId === undefined,
                })
                if (land.joined) {
                  landedAssistant = {
                    ...assistantForLand,
                    message: {
                      ...assistantForLand.message,
                      content: land.content,
                    },
                    ...(land.supersedesUuids !== undefined &&
                    land.supersedesUuids.length > 0
                      ? { supersedesUuids: land.supersedesUuids }
                      : {}),
                  } as AssistantMessage
                  loopState.backfillClones.push({
                    src: message as AssistantMessage,
                    dst: landedAssistant,
                  })
                  yieldMessage = landedAssistant
                  if (
                    land.supersedesUuids !== undefined &&
                    land.supersedesUuids.length > 0
                  ) {
                    logEvent('tengu_refusal_fallback_supersedes', {
                      lane: 'server_stitch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      count: land.supersedesUuids.length,
                      queryChainId: queryChainIdForAnalytics,
                      queryDepth: queryTracking.depth,
                    })
                  }
                  if (land.clearExact) {
                    loopState.exactSalvagePackage = undefined
                  }
                  if (land.clearSoft) {
                    loopState.silentStitchPending = false
                    loopState.silentStitchText = undefined
                    loopState.partialResponseMetaMessage = undefined
                  }
                }
              }
            } catch {
              // densable optional
            }
            if (loopState.clientRetrySupersedesUuids !== undefined) {
              const uuids = loopState.clientRetrySupersedesUuids
              loopState.clientRetrySupersedesUuids = undefined
              landedAssistant = {
                ...((landedAssistant ?? yieldMessage) as AssistantMessage),
                supersedesUuids: uuids,
              } as AssistantMessage
              yieldMessage = landedAssistant
              logEvent('tengu_refusal_fallback_supersedes', {
                lane: 'client_retry' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                count: uuids.length,
                queryChainId: queryChainIdForAnalytics,
                queryDepth: queryTracking.depth,
              })
            }
          }

          if (!withheld) {
            for (const replayed of withheldMediaReplay) {
              yield replayed
            }
            yield yieldMessage
          }
          if (message.type === 'assistant') {
            const assistantMessage =
              landedAssistant ?? (message as AssistantMessage)
            assistantMessages.push(assistantMessage)

            const msgToolUseBlocks = (
              Array.isArray(assistantMessage.message?.content)
                ? assistantMessage.message.content
                : []
            ).filter(
              (content: { type: string }) => content.type === 'tool_use',
            ) as ToolUseBlock[]
            if (msgToolUseBlocks.length > 0) {
              toolUseBlocks.push(...msgToolUseBlocks)
              needsFollowUp = true
            }

            if (
              streamingToolExecutor &&
              !toolUseContext.abortController.signal.aborted
            ) {
              for (const toolBlock of msgToolUseBlocks) {
                streamingToolExecutor.addTool(toolBlock, assistantMessage)
              }
            }
          }

          yield* drainStreamingTools()
        }

        queryCheckpoint('query_api_streaming_end')
        syncBackfillClones(loopState.backfillClones)
        loopState.backfillClones.length = 0

        if (loopState.pendingCallerFallbackRequest !== undefined) {
          const fbReq = loopState.pendingCallerFallbackRequest
          loopState.pendingCallerFallbackRequest = undefined
          let choice = loopState.refusalFallbackPreferenceChoice
          if (
            choice === undefined &&
            !fbReq.silentArmAtTrigger &&
            toolUseContext.requestDialog
          ) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const {
                getProviderRefusalFallbackGuidanceText,
                getSwitchModelsOnFlag,
                runRefusalFallbackDialogFlow,
              } =
                require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
              const flow = await runRefusalFallbackDialogFlow({
                decision: {
                  isMainThread: toolUseContext.agentId === undefined,
                  requestDialog: toolUseContext.requestDialog,
                  silentAttempt: false,
                  switchModelsOnFlag: getSwitchModelsOnFlag(),
                },
                requestDialog: toolUseContext.requestDialog,
                signal: toolUseContext.abortController.signal,
                payload: {
                  originalModel: fbReq.originalModel,
                  fallbackModel: fbReq.fallbackModel,
                  apiRefusalCategory: fbReq.apiRefusalCategory ?? null,
                  guidanceText: getProviderRefusalFallbackGuidanceText(
                    getAPIProvider() === 'firstParty',
                  ),
                },
              })
              choice = flow.choice
            } catch {
              choice = 'retry_fallback'
            }
          }
          loopState.refusalFallbackPreferenceChoice = choice
          if (choice === undefined || choice === 'retry_fallback') {
            throw new FallbackTriggeredError(
              fbReq.originalModel,
              fbReq.fallbackModel,
              'refusal',
            )
          }
        }

        // densable Zue() @184980379 — Xue stash, else relay-stopped strip
        {
          const stripped =
            takePendingThinkingStripped() ??
            emitRelayThinkingStripped(
              assistantMessages.some(m => isThinkingMessage(m)),
            )
          if (stripped) {
            yield createAttachmentMessage(stripped)
          }
        }
      } catch (innerError) {
        if (
          innerError instanceof FallbackTriggeredError &&
          (innerError.fallbackModel || fallbackModel)
        ) {
          if (
            loopState.refusalFallbackPreferenceChoice === 'cancelled' ||
            loopState.refusalFallbackPreferenceChoice === 'edit_prompt'
          ) {
            if (loopState.refusalFallbackPreferenceChoice === 'edit_prompt') {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { createAbortErrorReason } =
                  require('../utils/abortController.js') as typeof import('../utils/abortController.js')
                toolUseContext.abortController.abort(
                  createAbortErrorReason('refusal-fallback-edit'),
                )
              } catch {
                toolUseContext.abortController.abort()
              }
            }
            assistantMessages.length = 0
            toolResults.length = 0
            toolUseBlocks.length = 0
            needsFollowUp = false
            loopState.backfillClones.length = 0
          } else {
            const switchTo =
              innerError.fallbackModel &&
              typeof innerError.fallbackModel === 'string'
                ? innerError.fallbackModel
                : (fallbackModel as string)
            if (loopState.triedFallbackModels.has(switchTo)) {
              throw innerError
            }
            loopState.triedFallbackModels.add(switchTo)
            currentModel = switchTo
            modelFacts = getModelFacts(currentModel)
            leftoverStampTurnEffort(switchTo)
            loopState.attemptWithFallback = true

            const carriedFromError = (
              innerError as {
                carriedEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
              }
            ).carriedEffort
            const carriedLevel =
              carriedFromError ??
              (loopState.refusalFallbackEffort?.model === currentModel
                ? loopState.refusalFallbackEffort.level
                : undefined)
            const heldBySession = !toolUseContext.agentId
            if (heldBySession) {
              loopState.refusalFallbackEffort = undefined
            } else if (carriedLevel !== undefined) {
              loopState.refusalFallbackEffort = {
                model: switchTo,
                level: carriedLevel,
              }
            }

            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const {
                planRefusalFallbackAppStateRebind,
                applyRefusalFallbackAppStateRebind,
                applyRefusalFallbackLatchArm,
              } =
                require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const {
                getMainLoopModelOverride,
                setMainLoopModelOverride,
                setRefusalFallbackModelLatch,
                markRefusalFallbackOccurred,
              } =
                require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
              const curAppState = toolUseContext.getAppState()
              applyRefusalFallbackLatchArm({
                fallbackModel: switchTo,
                previousOverride: getMainLoopModelOverride(),
                previousAppStateModel: curAppState.mainLoopModel,
                previousModelForSession: curAppState.mainLoopModelForSession,
                setLatch: latch =>
                  setRefusalFallbackModelLatch({
                    ...(latch as Parameters<
                      typeof setRefusalFallbackModelLatch
                    >[0]),
                    ...(heldBySession &&
                      carriedLevel !== undefined && {
                        carriedEffort: carriedLevel,
                      }),
                  }),
                setMainLoopModelOverride,
                markOccurred: markRefusalFallbackOccurred,
              })
              const rebind = planRefusalFallbackAppStateRebind({
                appStateModel: switchTo,
                forSessionValue: null,
                overrideValue: switchTo,
                currentMainLoopModel: curAppState.mainLoopModel,
                currentMainLoopModelForSession:
                  curAppState.mainLoopModelForSession,
                fastMode: curAppState.fastMode,
              })
              applyRefusalFallbackAppStateRebind({
                plan: rebind,
                setAppState: toolUseContext.setAppState as unknown as (
                  f: (prev: {
                    mainLoopModel?: string | null
                    mainLoopModelForSession?: string | null
                    fastMode?: boolean
                    [k: string]: unknown
                  }) => {
                    mainLoopModel?: string | null
                    mainLoopModelForSession?: string | null
                    fastMode?: boolean
                    [k: string]: unknown
                  },
                ) => void,
                setMainLoopModelOverride,
              })
            } catch {
              // BMg densable optional
            }

            yield* yieldMissingToolResultBlocks(
              assistantMessages,
              'Model fallback triggered',
            )
            assistantMessages.length = 0
            toolResults.length = 0
            toolUseBlocks.length = 0
            needsFollowUp = false
            loopState.backfillClones.length = 0

            toolUseContext = {
              ...toolUseContext,
              options: {
                ...toolUseContext.options,
                mainLoopModel: switchTo,
              },
            }

            if (streamingToolExecutor) {
              streamingToolExecutor.discard()
              clearActiveMcpStamps(toolUseContext.options, attributeMcpUsage)
              streamingToolExecutor = new StreamingToolExecutor(
                toolUseContext.options.tools,
                canUseTool,
                toolUseContext,
              )
            }

            messagesForQuery = stripSignatureBlocks(messagesForQuery)

            const fallbackReason =
              'reason' in innerError &&
              typeof (innerError as { reason?: unknown }).reason === 'string'
                ? (innerError as { reason: string }).reason
                : 'overloaded'
            logEvent('tengu_model_fallback_triggered', {
              original_model:
                innerError.originalModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              fallback_model:
                switchTo as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              reason:
                fallbackReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              entrypoint:
                'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              queryChainId: queryChainIdForAnalytics,
              queryDepth: queryTracking.depth,
            })

            yield {
              type: 'query_model_change' as const,
              toModel: switchTo,
            } as unknown as Message

            if (
              fallbackReason === 'model_not_found' ||
              fallbackReason === 'permission_denied' ||
              fallbackReason === 'model_blocked'
            ) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { setMainLoopModelOverride } =
                  require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
                setMainLoopModelOverride(switchTo)
                toolUseContext.setAppState(prev => ({
                  ...prev,
                  mainLoopModel: switchTo,
                  mainLoopModelForSession: null,
                }))
              } catch {
                // optional
              }
              yield {
                type: 'system' as const,
                subtype: 'model_fallback' as const,
                content: `Switched to ${renderModelName(switchTo)} because ${renderModelName(innerError.originalModel)} is not available`,
                level: 'warning' as const,
                trigger: fallbackReason,
                originalModel: innerError.originalModel,
                fallbackModel: switchTo,
                isMeta: false as const,
                timestamp: new Date().toISOString(),
                uuid: randomUUID(),
              } as unknown as Message
            } else if (fallbackReason === 'last_resort') {
              yield {
                type: 'system' as const,
                subtype: 'model_fallback' as const,
                content: `Switched to ${renderModelName(switchTo)} because ${renderModelName(innerError.originalModel)} returned an error that could not be retried`,
                level: 'warning' as const,
                trigger: 'last_resort' as const,
                originalModel: innerError.originalModel,
                fallbackModel: switchTo,
                isMeta: false as const,
                timestamp: new Date().toISOString(),
                uuid: randomUUID(),
              } as unknown as Message
            } else if (fallbackReason !== 'refusal') {
              yield {
                type: 'system' as const,
                subtype: 'model_fallback' as const,
                content: `Switched to ${renderModelName(switchTo)} due to high demand for ${renderModelName(innerError.originalModel)}`,
                level: 'warning' as const,
                trigger:
                  fallbackReason === 'server_error'
                    ? ('server_error' as const)
                    : ('overloaded' as const),
                originalModel: innerError.originalModel,
                fallbackModel: switchTo,
                isMeta: false as const,
                timestamp: new Date().toISOString(),
                uuid: randomUUID(),
              } as unknown as Message
            }
          }
        } else {
          yield* emitRefusalContinuationEnd({
            path: 'error',
            loopState,
            queryChainIdForAnalytics,
            queryDepth: queryTracking.depth,
            querySource,
            clearExactOnBareEnd: true,
          })
          throw innerError
        }
      }
    }

    yield* emitRefusalContinuationEnd({
      path: 'success',
      loopState,
      queryChainIdForAnalytics,
      queryDepth: queryTracking.depth,
      querySource,
      clearExactOnBareEnd: true,
    })
  } catch (error) {
    yield* emitRefusalContinuationEnd({
      path: 'error',
      loopState,
      queryChainIdForAnalytics,
      queryDepth: queryTracking.depth,
      querySource,
      clearExactOnBareEnd: false,
    })
    logError(error)
    const errMsg = error instanceof Error ? error.message : String(error)
    logEvent('tengu_query_error', {
      assistantMessages: assistantMessages.length,
      toolUses: assistantMessages.flatMap(_ =>
        (Array.isArray(_.message?.content)
          ? (_.message.content as Array<{ type: string }>)
          : []
        ).filter(content => content.type === 'tool_use'),
      ).length,
      queryChainId: queryChainIdForAnalytics,
      queryDepth: queryTracking.depth,
    })

    if (error instanceof ImageSizeError || error instanceof ImageResizeError) {
      yield createAssistantAPIErrorMessage({
        content: error.message,
      })
      yield* leftoverDrainSpinnerModes()
      return { ok: false, terminal: { reason: 'image_error' } }
    }

    yield* yieldMissingToolResultBlocks(assistantMessages, errMsg)
    yield createAssistantAPIErrorMessage({
      content: errMsg,
    })
    logAntError('Query error', error)
    yield* leftoverDrainSpinnerModes()
    return { ok: false, terminal: { reason: 'model_error', error } }
  }

  return {
    ok: true,
    currentModel,
    modelFacts,
    toolUseContext,
    messagesForQuery,
    streamingToolExecutor,
    needsFollowUp,
    toolRequestedEndTurn,
    lastDeltaStopReason: loopState.lastDeltaStopReason,
    lastDeltaOutputTokens: loopState.lastDeltaOutputTokens,
    withheldLongContextRefusal: loopState.withheldLongContextRefusal,
    withheldSafetyMonitorBlock: loopState.withheldSafetyMonitorBlock,
    withheldSameModelRefusal: loopState.withheldSameModelRefusal,
  }
}
