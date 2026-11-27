/**
 * Headless streaming inbound StructuredIO control request & user message loop.
 *
 * Preserves Stage-1 E1-P1-5 synchronous interrupt receipt before abortController.abort(...)
 * with static settlePollEventsDiscardedUndelivered import.
 */
import type { HeadlessStreamingContext } from './streamingTypes.js'
import { handleRemoteAndSessionControlRequest } from './remoteAndSessionControlHandlers.js'
import { handleUiControlRequest } from './uiControlHandlers.js'
import { handleMcpAndWorkspaceControlRequest } from './mcpAndWorkspaceControlHandlers.js'
import {
  createMidTurnHookRunner,
  appendHookAdditionalContextToPromptContent,
  type MidTurnCloudHookOutcome,
  evaluateMidTurnCloudUserPromptSubmitHooks,
} from './hooksAndPermissions.js'
import { logForDiagnosticsNoPII } from 'src/utils/diagLogs.js'
import {
  shouldCompleteEventLifecycleImmediately,
  shouldEmitControlFinallyCompleted,
} from 'src/utils/controlRequestLifecycle.js'
import { notifyCommandLifecycle } from 'src/utils/commandLifecycle.js'
import type {
  SDKControlRequest,
  StdoutMessage,
} from 'src/entrypoints/sdk/controlTypes.js'
import { logError } from 'src/utils/log.js'
import {
  shouldRejectParkedControl,
  parkedControlRejectMessage,
  isSpareUnclaimed,
  buildNotClaimedExecutionResult,
} from 'src/cli/spareClaim.js'
import {
  handleHeadlessSendNow,
  backgroundForegroundBashToDeliverMessage,
  backgroundForegroundToolCalls,
  queryForegroundSession,
} from 'src/utils/foregroundToolCalls.js'
import {
  getCommandQueueSnapshot,
  dequeueAllMatching,
  getCommandQueue,
  hasCommandsInQueue,
  getMainThreadQueueLength,
  enqueue,
} from 'src/utils/messageQueueManager.js'
import { logEvent } from 'src/services/analytics/index.js'
import {
  type HeadlessInterruptReceipt,
  buildHeadlessInterruptReceipt,
  interruptAndWaitForRewindSettlement,
  handleHeadlessCancelAsyncMessage,
  handleIncomingControlCancelRequest,
} from './interruptAndCancel.js'
import {
  markSessionStoppedForPluginInput,
  setBackgroundCeilingProvider,
  setSpawnedTurnTakenCallback,
} from 'src/utils/plugins/functionHooksModules.js'
import { settlePollEventsDiscardedUndelivered } from 'src/cli/printControlExtras.js'
import {
  createAbortErrorReason,
  createAbortController,
} from 'src/utils/abortController.js'
import type { Message } from 'src/types/message.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { stopTask } from '../../tasks/stopTask.js'
import { notifySweptBackgroundAgents } from '../../utils/task/framework.js'
import {
  handleInitializeRequest,
  handleSetPermissionMode,
  handleRewindFiles,
  shouldInterruptParkedQuestionOnStreamClose,
} from 'src/cli/headless/HeadlessControlPlane.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  setSdkAgentProgressSummariesEnabled,
  getSessionId,
  getIsRemoteMode,
} from 'src/bootstrap/state.js'
import { collectContextData } from 'src/commands/context/context-noninteractive.js'
import {
  getMainLoopModel,
  parseUserSpecifiedModel,
} from 'src/utils/model/model.js'
import { resolvePrintSystemPrompt } from './outputFormatting.js'
import type { JSONRPCMessage } from 'src/services/mcp/types.js'
import { pruneDetachedToolCalls } from '../../utils/detachedToolCallStore.js'
import { type UUID, randomUUID } from 'crypto'
import { stampIdLessAssistantEntry } from 'src/utils/conversationRecovery.js'
import { toInternalMessages } from 'src/utils/messages/mappers.js'
import type {
  SDKMessage,
  SDKUserMessage,
} from 'src/entrypoints/agentSdkTypes.js'
import { doesMessageExistInSession } from 'src/utils/sessionStorage.js'
import {
  getReceivedMessageUuidsState,
  trackReceivedMessageUuid,
  resizeInboundImageBlocks,
} from './startupAndAccount.js'
import { personWrote } from 'src/utils/crossSessionInbound.js'
import type { QueuedCommand } from 'src/types/textInputTypes.js'
import { resolveAndPrepend } from 'src/bridge/inboundAttachments.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { parseInboundFileAttachments } from 'src/utils/processUserInput/inboundFileAttachments.js'
import { RemoteIO } from 'src/cli/remoteIO.js'
import {
  hasHookForEvent,
  executeUserPromptSubmitHooks,
} from 'src/utils/hooks.js'
import { EMPTY_USAGE } from '@ant/model-provider'
import { sleep } from 'src/utils/sleep.js'
import { finalizePendingAsyncHooks } from 'src/utils/hooks/AsyncHookRegistry.js'
import { statusListeners } from 'src/services/claudeAiLimits.js'
import { stopAllHookHeartbeatsForSession } from '../../utils/hooks/hookHeartbeat.js'

export function startControlInputLoop(
  streamCtx: HeadlessStreamingContext,
): void {
  void (async () => {
    // Official Svf: brief grace wait for a late parked-permission answer
    // before the stdin loop starts draining. unexpectedResponseCallback is
    // already wired, so a matching control_response can enqueue the orphan.
    if (streamCtx.parkedPermissionResumePlan) {
      try {
        const { waitForParkedPermissionAnswer } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../utils/userDialog.js') as typeof import('../../utils/userDialog.js')
        await waitForParkedPermissionAnswer({
          waitMs: streamCtx.parkedPermissionResumePlan.waitMs,
          // Never resolves from the answer side here — the wait is purely a
          // grace window so late control_response can hit the callback above.
          answer: new Promise<null>(() => {}),
        })
      } catch {
        // densable optional
      }
    }
    let initialized = false
    const midTurnHookRunner = createMidTurnHookRunner()
    const inFlightControlRequests = new Map<string, AbortController>()
    logForDiagnosticsNoPII('info', 'cli_message_loop_started')
    for await (const message of streamCtx.structuredIO.structuredInput) {
      // Non-user events are handled inline (no queue). started→completed in
      // the same tick carries no information, so only fire completed.
      // densable 2.1.212 #23: do NOT mark control_request complete here —
      // handlers may still be in-flight (await initialize / fire-and-forget
      // side_question). Early complete → session restart loses the request.
      // control_response is reported by StructuredIO.processLine (orphans too).
      // bash_command (densable) also owns its own lifecycle bookends.
      const eventId = 'uuid' in message ? message.uuid : undefined
      if (eventId && shouldCompleteEventLifecycleImmediately(message.type)) {
        notifyCommandLifecycle(eventId as string, 'completed')
      }

      if (message.type === 'control_request') {
        // Type assertion: structuredInput yields StdinMessage | SDKMessage, but
        // when type === 'control_request' the object has request_id and request.
        // The union with SDKMessage (typed as `any`) causes request to be `unknown`.
        // Cast to SDKControlRequest (via unknown) for type safety on known subtypes,
        // and use Record<string, unknown> for subtypes not in the zod schema union.
        const msg = message as unknown as SDKControlRequest
        // Wider-typed alias for request properties on subtypes not in the zod schema.
        // The schema union doesn't include end_session, channel_enable, mcp_authenticate,
        // claude_authenticate, etc. so accessing their properties narrows to `never`.
        const req = msg.request as Record<string, unknown>
        // densable Ko / ra / Ns — lifecycle ownership for control_request:
        // - sync/awaited handlers: finally emits completed if !deferred
        // - ra: started now, completed when async work finishes (F&F with wait)
        // - Ns: completed now, async continues (long mcp_call; not yet local)
        let lifecycleDeferred = false
        const deferControlLifecycleUntilDone = (
          work: () => void | Promise<void>,
        ): void => {
          lifecycleDeferred = true
          if (eventId) {
            notifyCommandLifecycle(eventId as string, 'started')
          }
          void Promise.resolve()
            .then(work)
            .finally(() => {
              if (eventId) {
                notifyCommandLifecycle(eventId as string, 'completed')
              }
            })
            .catch(err => {
              logError(err)
            })
        }
        // densable Ns — completed now, work continues (e.g. long mcp_call).
        // Kept for 1:1 parity; local mcp_call subtype not yet ported.
        const completeControlLifecycleImmediately = (
          work: () => void | Promise<void>,
        ): void => {
          lifecycleDeferred = true
          if (eventId) {
            notifyCommandLifecycle(eventId as string, 'completed')
          }
          void Promise.resolve()
            .then(work)
            .catch(err => {
              logError(err)
            })
        }
        void completeControlLifecycleImmediately
        try {
          // densable `MYe() && !my(subtype)` then `je(..., Vmt()==="failed"?cy:uy)`.
          if (shouldRejectParkedControl(msg.request.subtype)) {
            streamCtx.sendControlResponseError(
              msg,
              parkedControlRejectMessage(),
            )
            continue
          }
          if (msg.request.subtype === 'interrupt') {
            const interruptReq = msg.request as {
              subtype: 'interrupt'
              send_now?: boolean
              cancel_queued?: boolean
              spare_background_tasks?: boolean
              message_uuid?: string
            }
            if (
              interruptReq.send_now === true &&
              interruptReq.cancel_queued !== true
            ) {
              const sendNowRes = handleHeadlessSendNow({
                queuedCommands: getCommandQueueSnapshot(),
                pressedUuid: interruptReq.message_uuid,
                turnUnderWay: Boolean(streamCtx.abortController),
                abortController: streamCtx.abortController,
                deliver: () => {
                  const movedBash = backgroundForegroundBashToDeliverMessage(
                    streamCtx.getAppState,
                    streamCtx.setAppState,
                  )
                  const movedCalls = backgroundForegroundToolCalls(
                    queryForegroundSession,
                  )
                  return movedBash > 0 || movedCalls > 0
                },
              })
              logEvent('headless_interrupt_send_now', {
                outcome: sendNowRes.send_now,
              })
              streamCtx.sendControlResponseSuccess(
                msg,
                sendNowRes as unknown as Record<string, unknown>,
              )
              continue
            }
            const cancelQueued = interruptReq.cancel_queued === true
            const spareBackgroundTasks =
              interruptReq.spare_background_tasks === true
            const hadActiveTurn = Boolean(
              streamCtx.abortController &&
                !streamCtx.abortController.signal.aborted,
            )
            if (
              streamCtx.mcpStartupAbortRef.current &&
              !streamCtx.mcpStartupAbortRef.current.signal.aborted
            ) {
              streamCtx.mcpStartupAbortRef.current.abort()
            }
            let interruptReceipt: HeadlessInterruptReceipt
            if (streamCtx.abortController) {
              streamCtx.sessionStoppedAfterRestart = true
              markSessionStoppedForPluginInput()
              // Invoke buildHeadlessInterruptReceipt() -> requeueTaken() synchronously
              // BEFORE abortController.abort(...) with zero await/microtask yield so
              // query.ts's post-loop settleTaken() can never race and drop resurrected prompts.
              interruptReceipt = buildHeadlessInterruptReceipt({
                cancelQueued,
                turnOutcome: hadActiveTurn ? 'stopped' : 'idle',
                onCommandLifecycle: (uuid, state) => {
                  notifyCommandLifecycle(uuid, state)
                },
                onPollEventsDiscarded: (commands, reason) => {
                  settlePollEventsDiscardedUndelivered(commands, reason)
                },
              })
              streamCtx.abortController.abort(
                createAbortErrorReason('user-cancel'),
              )
            } else {
              streamCtx.sessionStoppedAfterRestart = true
              // Official 2.1.326 #95: if Stop arrived while restarting and the
              // auto-resumed cut-off turn is still queued, cancel it and persist
              // an interruption marker so a later restart will not re-run it.
              if (streamCtx.cutOffReRunStopTracker.hasPendingCutOffReRun()) {
                const { createUserInterruptionMessage } =
                  require('../../utils/messages.js') as typeof import('../../utils/messages.js')
                const { recordTranscript } =
                  require('../../utils/sessionStorage.js') as typeof import('../../utils/sessionStorage.js')
                streamCtx.cutOffReRunStopTracker.handleInterruptBeforeStart({
                  removeFromQueue: uuid =>
                    dequeueAllMatching(c => c.uuid === uuid).length > 0,
                  currentMessages:
                    streamCtx.mutableMessages as unknown as Record<
                      string,
                      unknown
                    >[],
                  buildInterruptionMessage: () =>
                    createUserInterruptionMessage({
                      toolUse: false,
                    }) as unknown as Record<string, unknown>,
                  persistTranscript: async msgs => {
                    await recordTranscript(msgs as unknown as Message[])
                  },
                  onError: err => {
                    logForDebugging(
                      `[print.ts] storing a Stop over the cut-off turn failed: ${errorMessage(err)}`,
                      { level: 'warn' },
                    )
                  },
                })
              }
              // #1634: interrupt arriving while a turn is queued/waiting (e.g.
              // right after set_model) must cancel the pending queued message.
              streamCtx.printPrewait?.interruptBeforeArm(getCommandQueue())
              interruptReceipt = buildHeadlessInterruptReceipt({
                cancelQueued,
                turnOutcome: 'idle',
                onCommandLifecycle: (uuid, state) => {
                  notifyCommandLifecycle(uuid, state)
                },
                onPollEventsDiscarded: (commands, reason) => {
                  settlePollEventsDiscardedUndelivered(commands, reason)
                },
              })
            }
            // Official 2.1.328 (`chunk@323105654.js:827500`): respect
            // `spare_background_tasks: true` — only sweep running background
            // subagents when not spared.
            if (!spareBackgroundTasks) {
              // Official 2.1.328 (#593): notify the model when SDK interrupt
              // stops background subagents so it does not claim they are still running.
              const bgAgentsOnInterrupt = Object.values(
                streamCtx.getAppState().tasks ?? {},
              ).filter(
                t =>
                  t.type === 'local_agent' &&
                  t.status === 'running' &&
                  (!('isBackgrounded' in t) || t.isBackgrounded),
              )
              if (bgAgentsOnInterrupt.length > 0) {
                for (const agentTask of bgAgentsOnInterrupt) {
                  void stopTask(agentTask.id, {
                    getAppState: streamCtx.getAppState,
                    setAppState: streamCtx.setAppState,
                    source: 'user',
                  }).catch(() => undefined)
                }
                notifySweptBackgroundAgents(
                  streamCtx.getAppState().tasks,
                  streamCtx.setAppState,
                  {
                    sweptIds: bgAgentsOnInterrupt.map(t => t.id),
                  },
                )
                streamCtx.drainPrintSdkEvents()
              }
            }
            midTurnHookRunner.abortAll()
            streamCtx.drainPrintSdkEvents()
            streamCtx.suggestionState.abortController?.abort()
            streamCtx.suggestionState.abortController = null
            streamCtx.suggestionState.lastEmitted = null
            streamCtx.suggestionState.pendingSuggestion = null
            streamCtx.sendControlResponseSuccess(
              msg,
              interruptReceipt as unknown as Record<string, unknown>,
            )
          } else if (req.subtype === 'end_session') {
            streamCtx.rapidFollowupDrain.endSessionRequested = true
            midTurnHookRunner.abortAll()
            streamCtx.drainPrintSdkEvents()
            if (
              streamCtx.mcpStartupAbortRef.current &&
              !streamCtx.mcpStartupAbortRef.current.signal.aborted
            ) {
              streamCtx.mcpStartupAbortRef.current.abort()
            }
            logForDebugging(
              `[print.ts] end_session received, reason=${req.reason ?? 'unspecified'}`,
            )
            if (streamCtx.abortController) {
              streamCtx.sessionStoppedAfterRestart = true
              markSessionStoppedForPluginInput()
              streamCtx.abortController.abort()
            } else {
              streamCtx.sessionStoppedAfterRestart = true
              // Official 2.1.326 #95: if Stop arrived while restarting and the
              // auto-resumed cut-off turn is still queued, cancel it and persist
              // an interruption marker so a later restart will not re-run it.
              if (streamCtx.cutOffReRunStopTracker.hasPendingCutOffReRun()) {
                const { createUserInterruptionMessage } =
                  require('../../utils/messages.js') as typeof import('../../utils/messages.js')
                const { recordTranscript } =
                  require('../../utils/sessionStorage.js') as typeof import('../../utils/sessionStorage.js')
                streamCtx.cutOffReRunStopTracker.handleInterruptBeforeStart({
                  removeFromQueue: uuid =>
                    dequeueAllMatching(c => c.uuid === uuid).length > 0,
                  currentMessages:
                    streamCtx.mutableMessages as unknown as Record<
                      string,
                      unknown
                    >[],
                  buildInterruptionMessage: () =>
                    createUserInterruptionMessage({
                      toolUse: false,
                    }) as unknown as Record<string, unknown>,
                  persistTranscript: async msgs => {
                    await recordTranscript(msgs as unknown as Message[])
                  },
                  onError: err => {
                    logForDebugging(
                      `[print.ts] storing a Stop over the cut-off turn failed: ${errorMessage(err)}`,
                      { level: 'warn' },
                    )
                  },
                })
              }
              // #1634: interrupt arriving while a turn is queued/waiting (e.g.
              // right after set_model) must cancel the pending queued message.
              streamCtx.printPrewait?.interruptBeforeArm(getCommandQueue())
            }
            // Official 2.1.328 (#593): notify the model when SDK interrupt
            // stops background subagents so it does not claim they are still running.
            const bgAgentsOnInterrupt = Object.values(
              streamCtx.getAppState().tasks ?? {},
            ).filter(
              t =>
                t.type === 'local_agent' &&
                t.status === 'running' &&
                (!('isBackgrounded' in t) || t.isBackgrounded),
            )
            if (bgAgentsOnInterrupt.length > 0) {
              for (const agentTask of bgAgentsOnInterrupt) {
                void stopTask(agentTask.id, {
                  getAppState: streamCtx.getAppState,
                  setAppState: streamCtx.setAppState,
                  source: 'user',
                }).catch(() => undefined)
              }
              notifySweptBackgroundAgents(
                streamCtx.getAppState().tasks,
                streamCtx.setAppState,
                {
                  sweptIds: bgAgentsOnInterrupt.map(t => t.id),
                },
              )
              streamCtx.drainPrintSdkEvents()
            }
            streamCtx.suggestionState.abortController?.abort()
            streamCtx.suggestionState.abortController = null
            streamCtx.suggestionState.lastEmitted = null
            streamCtx.suggestionState.pendingSuggestion = null
            streamCtx.sendControlResponseSuccess(msg)
            break // exits for-await → falls through to inputClosed=true drain below
          } else if (msg.request.subtype === 'initialize') {
            // SDK MCP server names from the initialize message
            // Populated by both browser and ProcessTransport sessions
            if (
              msg.request.sdkMcpServers &&
              msg.request.sdkMcpServers.length > 0
            ) {
              for (const serverName of msg.request.sdkMcpServers) {
                // Create placeholder config for SDK MCP servers
                // The actual server connection is managed by the SDK Query class
                streamCtx.sdkMcpConfigs[serverName] = {
                  type: 'sdk',
                  name: serverName,
                }
              }
            }

            await handleInitializeRequest(
              msg.request,
              msg.request_id,
              initialized,
              streamCtx.output,
              streamCtx.commands,
              streamCtx.modelInfos,
              streamCtx.structuredIO,
              !!streamCtx.options.enableAuthStatus,
              streamCtx.options,
              streamCtx.agents,
              streamCtx.getAppState,
            )

            // Enable prompt suggestions in AppState when SDK consumer opts in,
            // unless disabled by CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION / AMt (#175).
            const {
              shouldAllowPromptSuggestionInSdk: shouldAllowSdkPromptSuggestion,
            } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('../../services/PromptSuggestion/promptSuggestion.js') as typeof import('../../services/PromptSuggestion/promptSuggestion.js')
            if (
              msg.request.promptSuggestions &&
              shouldAllowSdkPromptSuggestion()
            ) {
              streamCtx.setAppState(prev => {
                if (prev.promptSuggestionEnabled) return prev
                return { ...prev, promptSuggestionEnabled: true }
              })
            }

            if (
              msg.request.agentProgressSummaries &&
              getFeatureValue_CACHED_MAY_BE_STALE('tengu_slate_prism', true)
            ) {
              setSdkAgentProgressSummariesEnabled(true)
            }

            // Official 2.1.326 #246: first-attached-client-wins rapid follow-up preempt
            const rapidFollowupFlag = (
              msg.request as unknown as { rapidFollowupPreempt?: unknown }
            ).rapidFollowupPreempt
            if (typeof rapidFollowupFlag === 'boolean') {
              streamCtx.declareSdkRapidFollowupPreempt(rapidFollowupFlag)
            }

            initialized = true

            // If the auto-resume logic pre-enqueued a command, drain it now
            // that initialize has set up systemPrompt, agents, hooks, etc.
            if (hasCommandsInQueue()) {
              void streamCtx.run()
            }
          } else if (msg.request.subtype === 'set_permission_mode') {
            // #1726: Serialize set_permission_mode behind pendingSetModelPromise
            // so a back-to-back set_model + set_permission_mode('auto') sees the
            // newly selected model instead of refusing auto mode on the old one.
            const m = msg.request // for typescript (TODO: use readonly types to avoid this)
            const reqId = msg.request_id
            deferControlLifecycleUntilDone(() => {
              const runSetPermissionMode = () => {
                streamCtx.setAppState(prev => ({
                  ...prev,
                  toolPermissionContext: handleSetPermissionMode(
                    m,
                    reqId,
                    prev.toolPermissionContext,
                    streamCtx.output,
                  ),
                }))
              }
              streamCtx.pendingSetModelPromise =
                streamCtx.pendingSetModelPromise.then(
                  runSetPermissionMode,
                  runSetPermissionMode,
                )
              return streamCtx.pendingSetModelPromise
            })
            // handleSetPermissionMode sends the control_response; the
            // notifySessionMetadataChanged that used to follow here is
            // now fired by onChangeAppState (with externalized mode name).
          } else if (msg.request.subtype === 'set_model') {
            // #1634: Do not block the stdin loop on handleSetModel so a
            // following user message + interrupt can be read and cancelled.
            const setModelMsg = msg as SDKControlRequest & {
              request: { subtype: 'set_model'; model?: string }
            }
            deferControlLifecycleUntilDone(() => {
              const runSetModel = () =>
                streamCtx.controlPlane.handleSetModel(setModelMsg, {
                  activeUserSpecifiedModel: streamCtx.activeUserSpecifiedModel,
                  setActiveUserSpecifiedModel: model => {
                    streamCtx.activeUserSpecifiedModel = model
                  },
                  mutableMessages: streamCtx.mutableMessages,
                  injectModelSwitchBreadcrumbs:
                    streamCtx.injectModelSwitchBreadcrumbs,
                })
              streamCtx.pendingSetModelPromise =
                streamCtx.pendingSetModelPromise.then(runSetModel, runSetModel)
              return streamCtx.pendingSetModelPromise
            })
          } else if (msg.request.subtype === 'set_max_thinking_tokens') {
            if (msg.request.max_thinking_tokens === null) {
              streamCtx.options.thinkingConfig = undefined
            } else if (msg.request.max_thinking_tokens === 0) {
              streamCtx.options.thinkingConfig = { type: 'disabled' }
            } else {
              streamCtx.options.thinkingConfig = {
                type: 'enabled',
                budgetTokens: msg.request.max_thinking_tokens,
              }
            }
            streamCtx.sendControlResponseSuccess(msg)
          } else if (msg.request.subtype === 'mcp_status') {
            streamCtx.sendControlResponseSuccess(msg, {
              mcpServers: streamCtx.buildMcpServerStatuses(),
            })
          } else if (msg.request.subtype === 'get_context_usage') {
            const contextUsageMsg = msg
            const runContextUsage = async (): Promise<void> => {
              try {
                const appState = streamCtx.getAppState()
                const data = await collectContextData({
                  messages: streamCtx.mutableMessages,
                  getAppState: streamCtx.getAppState,
                  options: {
                    mainLoopModel: getMainLoopModel(),
                    tools: streamCtx.buildAllTools(appState),
                    agentDefinitions: appState.agentDefinitions,
                    customSystemPrompt: resolvePrintSystemPrompt(
                      streamCtx.options.systemPrompt,
                    ),
                    appendSystemPrompt: streamCtx.options.appendSystemPrompt,
                  },
                })
                streamCtx.sendControlResponseSuccess(contextUsageMsg, {
                  ...data,
                })
              } catch (error) {
                streamCtx.sendControlResponseError(
                  contextUsageMsg,
                  errorMessage(error),
                )
              }
            }
            // Serialize get_context_usage requests with each other without
            // blocking set_model, messages, or interrupts in the control loop.
            streamCtx.pendingContextUsagePromise =
              streamCtx.pendingContextUsagePromise.then(
                runContextUsage,
                runContextUsage,
              )
          } else if (msg.request.subtype === 'mcp_message') {
            // Handle MCP notifications from SDK servers
            const mcpRequest = msg.request as Record<string, unknown>
            const sdkClient = streamCtx.sdkClients.find(
              client => client.name === mcpRequest.server_name,
            )
            // Check client exists - dynamically added SDK servers may have
            // placeholder clients with null client until updateSdkMcp() runs
            if (
              sdkClient &&
              sdkClient.type === 'connected' &&
              sdkClient.client?.transport?.onmessage
            ) {
              sdkClient.client.transport.onmessage(
                mcpRequest.message as JSONRPCMessage,
              )
            }
            streamCtx.sendControlResponseSuccess(msg)
          } else if (req.subtype === 'rewind_conversation') {
            // Official 2.1.328 (`chunk@323105654.js:854500, 860400-861500`):
            // When `busy && interrupt_if_running === true`, abort active turn
            // and await turn settlement BEFORE splicing `mutableMessages`.
            const { rewindTargetUuidError, findRewindCut } = await import(
              '../printControlHosts.js'
            )
            if (typeof req.target_message_uuid !== 'string') {
              streamCtx.sendControlResponseError(msg, rewindTargetUuidError())
              continue
            }
            const isTurnBusy = () =>
              (streamCtx.running &&
                streamCtx.runPhase !== 'waiting_for_agents') ||
              getMainThreadQueueLength() > 0
            if (isTurnBusy() && req.interrupt_if_running !== true) {
              streamCtx.sendControlResponseSuccess(msg, {
                rewound: false,
                reason: 'turn_running',
              })
              continue
            }
            if (
              req.interrupt_if_running === true &&
              (streamCtx.running || streamCtx.abortController)
            ) {
              await interruptAndWaitForRewindSettlement({
                getAbortController: () => streamCtx.abortController,
                isRunning: () =>
                  streamCtx.running &&
                  streamCtx.runPhase !== 'waiting_for_agents',
                getSettlingPromise: () => streamCtx.activeRunPromise,
              })
              if (isTurnBusy()) {
                streamCtx.sendControlResponseSuccess(msg, {
                  rewound: false,
                  reason: 'turn_running',
                })
                continue
              }
            }
            const cut = findRewindCut(
              streamCtx.mutableMessages,
              req.target_message_uuid,
            )
            if ('refuse' in cut) {
              streamCtx.sendControlResponseSuccess(msg, {
                rewound: false,
                reason: cut.refuse,
              })
              continue
            }
            const removed = streamCtx.mutableMessages.splice(cut.index + 1)
            pruneDetachedToolCalls(removed, streamCtx.mutableMessages)
            streamCtx.sendControlResponseSuccess(msg, {
              rewound: true,
              targetMessageUuid: cut.echoUuid,
              ...(cut.prefillText !== undefined && {
                prefillText: cut.prefillText,
              }),
              ...(cut.precedingAssistantUuid !== undefined && {
                precedingAssistantUuid: cut.precedingAssistantUuid,
              }),
            })
          } else if (msg.request.subtype === 'rewind_files') {
            const appState = streamCtx.getAppState()
            const result = await handleRewindFiles(
              msg.request.user_message_id as UUID,
              appState,
              streamCtx.setAppState,
              msg.request.dry_run ?? false,
            )
            if (result.canRewind || msg.request.dry_run) {
              streamCtx.sendControlResponseSuccess(msg, result)
            } else {
              streamCtx.sendControlResponseError(
                msg,
                (result.error as string) ?? 'Unexpected error',
              )
            }
          } else if (msg.request.subtype === 'cancel_async_message') {
            const { settlePollEventsDiscardedUndelivered } = await import(
              'src/cli/printControlExtras.js'
            )
            const cancelRes = handleHeadlessCancelAsyncMessage({
              targetUuid: msg.request.message_uuid,
              sender: 'host',
              onCommandLifecycle: (uuid, state) => {
                notifyCommandLifecycle(uuid, state)
              },
              onPollEventsDiscarded: (commands, reason) => {
                settlePollEventsDiscardedUndelivered(commands, reason)
              },
            })
            streamCtx.sendControlResponseSuccess(
              msg,
              cancelRes as unknown as Record<string, unknown>,
            )
          } else if (
            await handleRemoteAndSessionControlRequest(streamCtx, {
              msg,
              req,
              inFlightControlRequests,
              isInitialized: () => initialized,
              deferControlLifecycleUntilDone,
              completeControlLifecycleImmediately,
            })
          ) {
            // handled by remoteAndSessionControlHandlers
          } else if (
            await handleUiControlRequest(streamCtx, {
              msg,
              req,
              inFlightControlRequests,
              isInitialized: () => initialized,
              deferControlLifecycleUntilDone,
              completeControlLifecycleImmediately,
            })
          ) {
            // handled by uiControlHandlers
          } else if (
            await handleMcpAndWorkspaceControlRequest(streamCtx, {
              msg,
              req,
              inFlightControlRequests,
              isInitialized: () => initialized,
              deferControlLifecycleUntilDone,
              completeControlLifecycleImmediately,
            })
          ) {
            // handled by mcpAndWorkspaceControlHandlers
          } else {
            // Unknown control request subtype — send an error response so
            // the caller doesn't hang waiting for a reply that never comes.
            streamCtx.sendControlResponseError(
              msg,
              `Unsupported control request subtype: ${(msg.request as { subtype: string }).subtype}`,
            )
          }
        } finally {
          // densable: if (Rr && !Ko) e.onCommandLifecycle?.(Rr, "completed")
          // Sync / fully-awaited handlers complete here. ra/Ns set Ko so they
          // own completed themselves (after async work, or immediately).
          if (
            shouldEmitControlFinallyCompleted(
              lifecycleDeferred,
              Boolean(eventId),
            )
          ) {
            notifyCommandLifecycle(eventId as string, 'completed')
          }
        }
        continue
      } else if (message.type === 'control_response') {
        // Replay control_response messages when replay mode is enabled
        if (streamCtx.options.replayUserMessages) {
          streamCtx.output.enqueue(message as StdoutMessage)
        }
        continue
      } else if (message.type === 'control_cancel_request') {
        // Official 2.1.328 (`chunk@323105654.js:917860`): abort matching
        // in-flight control request by `request_id`.
        const reqId = (message as { request_id?: string }).request_id
        handleIncomingControlCancelRequest(inFlightControlRequests, reqId)
        continue
      } else if (message.type === 'keep_alive') {
        // Silently ignore keep-alive messages
        continue
      } else if (message.type === 'update_environment_variables') {
        // Handled in structuredIO.ts, but TypeScript needs the type guard
        continue
      } else if (message.type === 'assistant' || message.type === 'system') {
        // History replay from bridge: inject into mutableMessages as
        // conversation context so the model sees prior turns.
        // Stamp id-less assistant tool calls before same-id merge.
        const injected =
          message.type === 'assistant'
            ? stampIdLessAssistantEntry(message)
            : message
        const internalMsgs = toInternalMessages([injected as SDKMessage])
        streamCtx.mutableMessages.push(...internalMsgs)
        // Echo assistant messages back so CCR displays them
        if (
          injected.type === 'assistant' &&
          streamCtx.options.replayUserMessages
        ) {
          streamCtx.output.enqueue(injected as StdoutMessage)
        }
        continue
      }
      // After handling control, keep-alive, env-var, assistant, and system
      // messages above, only user messages should remain.
      if (message.type !== 'user') {
        continue
      }
      // densable MYe() unclaimed user @199187468 — O6 error_during_execution
      if (isSpareUnclaimed()) {
        streamCtx.claimFirstTurnAck?.({
          cannotQueue: 'refused, the claim failed',
        })
        streamCtx.output.enqueue(
          buildNotClaimedExecutionResult(getSessionId()) as StdoutMessage,
        )
        continue
      }
      // Type assertion: after the type guard, message is a user message.
      // The union with SDKMessage (any) prevents proper narrowing.
      const userMsg = message as SDKUserMessage

      // First prompt message implicitly initializes if not already done.
      initialized = true

      // Check for duplicate user message - skip if already processed
      if (userMsg.uuid) {
        const sessionId = getSessionId() as UUID
        const existsInSession = await doesMessageExistInSession(
          sessionId,
          userMsg.uuid as UUID,
        )

        // Check both historical duplicates (from file) and runtime duplicates (this session)
        if (
          existsInSession ||
          getReceivedMessageUuidsState().uuids.has(userMsg.uuid as UUID)
        ) {
          logForDebugging(`Skipping duplicate user message: ${userMsg.uuid}`)
          // Send acknowledgment for duplicate message if replay mode is enabled
          if (streamCtx.options.replayUserMessages) {
            logForDebugging(
              `Sending acknowledgment for duplicate user message: ${userMsg.uuid}`,
            )
            streamCtx.output.enqueue({
              type: 'user',
              content: (userMsg.message as { content?: string })?.content ?? '',
              message: userMsg.message as unknown,
              session_id: sessionId,
              parent_tool_use_id: null,
              uuid: userMsg.uuid as string,
              timestamp: (userMsg as { timestamp?: string }).timestamp,
              isReplay: true,
            } as unknown as StdoutMessage)
          }
          // Historical dup = transcript already has this turn's output, so it
          // ran but its lifecycle was never closed (interrupted before ack).
          // Runtime dups don't need this — the original enqueue path closes them.
          if (existsInSession) {
            notifyCommandLifecycle(userMsg.uuid as string, 'completed')
          }
          // Don't enqueue duplicate messages for execution
          continue
        }

        // Track this UUID to prevent runtime duplicates
        trackReceivedMessageUuid(userMsg.uuid as UUID)
      }

      // #1733: Refuse later user input once an unavailable deferred tool call
      // has been preserved so the transcript cannot diverge past the unresolved call.
      if (streamCtx.deferredCallRefusesTurns) {
        logForDebugging(
          '[print.ts] Refusing later user input because an unavailable deferred tool call is preserved',
        )
        if (userMsg.uuid) {
          notifyCommandLifecycle(userMsg.uuid as string, 'completed')
        }
        continue
      }

      // #1882: Human user wrote a message (even while Claude is still working) —
      // reset cross-session rate-limit / loop-pause counters immediately.
      personWrote()

      // Official 2.1.323 #2199: preserve host-supplied prompt provenance fields
      // (`isHumanTypedPrompt` / `suppressWorkflowKeyword` / `origin`) onto the
      // queued command so workflow gating receives them on `toolUseContext.promptProvenance`.
      const rawUserMsg = userMsg as unknown as Record<string, unknown>
      const hostIsHumanTyped =
        typeof rawUserMsg.isHumanTypedPrompt === 'boolean'
          ? rawUserMsg.isHumanTypedPrompt
          : typeof rawUserMsg.is_human_typed_prompt === 'boolean'
            ? rawUserMsg.is_human_typed_prompt
            : undefined
      const hostSuppressWorkflowKeyword =
        typeof rawUserMsg.suppressWorkflowKeyword === 'boolean'
          ? rawUserMsg.suppressWorkflowKeyword
          : typeof rawUserMsg.suppress_workflow_keyword === 'boolean'
            ? rawUserMsg.suppress_workflow_keyword
            : undefined
      const hostOrigin =
        rawUserMsg.origin && typeof rawUserMsg.origin === 'object'
          ? (rawUserMsg.origin as QueuedCommand['origin'])
          : undefined

      const enqueueInboundUserMessage = async (extra?: {
        skipSubmissionHooks?: boolean
        additionalContexts?: readonly string[]
      }): Promise<void> => {
        const resolvedContent = await resizeInboundImageBlocks(
          await resolveAndPrepend(
            userMsg,
            (userMsg.message as { content: ContentBlockParam[] }).content,
          ),
        )
        const valueWithHookContext =
          extra?.additionalContexts && extra.additionalContexts.length > 0
            ? appendHookAdditionalContextToPromptContent(
                resolvedContent,
                extra.additionalContexts,
              )
            : resolvedContent
        enqueue({
          mode: 'prompt' as const,
          // file_attachments rides the protobuf catchall from the web composer.
          // Same-ref no-op when absent (no 'file_attachments' key).
          value: valueWithHookContext,
          uuid: userMsg.uuid as `${string}-${string}-${string}-${string}-${string}`,
          priority: (userMsg as { priority?: string })
            .priority as import('src/types/textInputTypes.js').QueuePriority,
          // densable inbound D7 @202257989 — stamp file_attachments onto the queued command.
          fileAttachments: parseInboundFileAttachments(userMsg),
          ...(extra?.skipSubmissionHooks === true
            ? { skipSubmissionHooks: true }
            : {}),
          ...(hostOrigin !== undefined ? { origin: hostOrigin } : {}),
          ...(hostSuppressWorkflowKeyword !== undefined
            ? { suppressWorkflowKeyword: hostSuppressWorkflowKeyword }
            : {}),
          ...(hostIsHumanTyped !== undefined
            ? ({ isHumanTypedPrompt: hostIsHumanTyped } as Record<
                string,
                unknown
              >)
            : {}),
          // densable 2.1.283 Zp: client_composed → skipSlash + skipAttachments;
          // seeded_summon → skipAttachments.
          // #1413: queueSkipSlashCommands + <bash-stdout>/<local-command-stdout>
          ...(userMsg.client_composed === true
            ? { skipSlashCommands: true, skipAttachments: true }
            : userMsg.seeded_summon === true
              ? { skipAttachments: true }
              : (userMsg as { queueSkipSlashCommands?: boolean })
                    .queueSkipSlashCommands === true
                ? { skipSlashCommands: true }
                : {}),
        })
        // densable afterEnqueue hp/bo @199194235 — claim SessionStart wait
        {
          const content = (userMsg.message as { content?: unknown })?.content
          const ackText =
            typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? content
                    .map(b =>
                      b &&
                      typeof b === 'object' &&
                      'type' in b &&
                      b.type === 'text' &&
                      'text' in b &&
                      typeof b.text === 'string'
                        ? b.text
                        : '',
                    )
                    .join('')
                : undefined
          if (ackText !== undefined) {
            streamCtx.claimFirstTurnAck?.({ queued: ackText })
          }
        }
        void streamCtx.run()
      }

      // Official 2.1.327 #431 + BH3-P1-5: evaluate mid-turn cloud
      // UserPromptSubmit hooks asynchronously on a serialized runner so slow
      // hooks never stall `interrupt` / `end_session` / `stop_task` control
      // requests on `structuredIO`, and non-blocking results are preserved and
      // marked `skipSubmissionHooks: true` so `promptSubmit.ts` never executes
      // the hook a second time when dequeued.
      const shouldRunMidTurnCloudHook =
        streamCtx.running &&
        (getIsRemoteMode() || streamCtx.structuredIO instanceof RemoteIO) &&
        hasHookForEvent(
          'UserPromptSubmit',
          streamCtx.getAppState(),
          getSessionId(),
        )
      const rawMidTurnContent = (userMsg.message as { content?: unknown })
        ?.content
      const midTurnPromptText = shouldRunMidTurnCloudHook
        ? typeof rawMidTurnContent === 'string'
          ? rawMidTurnContent
          : Array.isArray(rawMidTurnContent)
            ? rawMidTurnContent
                .map(b =>
                  b &&
                  typeof b === 'object' &&
                  'type' in b &&
                  b.type === 'text' &&
                  'text' in b &&
                  typeof b.text === 'string'
                    ? b.text
                    : '',
                )
                .join('\n')
            : ''
        : ''

      let midTurnLifecycleCancelled = false
      const cancelMidTurnUserMessage = (): void => {
        if (midTurnLifecycleCancelled) return
        midTurnLifecycleCancelled = true
        if (userMsg.uuid) {
          notifyCommandLifecycle(userMsg.uuid as string, 'cancelled')
        }
      }

      if (shouldRunMidTurnCloudHook && midTurnPromptText.trim().length > 0) {
        midTurnHookRunner.schedule(async evalSignal => {
          if (
            evalSignal.aborted ||
            streamCtx.rapidFollowupDrain.endSessionRequested
          ) {
            cancelMidTurnUserMessage()
            return
          }
          const evalAbort = createAbortController()
          const onEvalAbort = () => {
            if (!evalAbort.signal.aborted) evalAbort.abort()
          }
          evalSignal.addEventListener('abort', onEvalAbort, { once: true })
          let outcome: MidTurnCloudHookOutcome
          try {
            const hookCtx = {
              abortController: evalAbort,
              getAppState: streamCtx.getAppState,
              setAppState: streamCtx.setAppState,
              options: {
                commands: streamCtx.currentCommands,
                tools: streamCtx.buildAllTools(streamCtx.getAppState()),
                mainLoopModel: streamCtx.activeUserSpecifiedModel
                  ? parseUserSpecifiedModel(streamCtx.activeUserSpecifiedModel)
                  : getMainLoopModel(),
                mcpClients: [
                  ...streamCtx.getAppState().mcp.clients,
                  ...streamCtx.sdkClients,
                  ...streamCtx.dynamicMcpState.clients,
                ],
                isNonInteractiveSession: true,
              },
              messages: streamCtx.mutableMessages,
              readFileState: streamCtx.readFileState,
            } as unknown as Parameters<typeof executeUserPromptSubmitHooks>[2]
            outcome = await evaluateMidTurnCloudUserPromptSubmitHooks(
              midTurnPromptText,
              () =>
                executeUserPromptSubmitHooks(
                  midTurnPromptText,
                  streamCtx.getAppState().toolPermissionContext.mode,
                  hookCtx,
                ),
              evalSignal,
            )
          } catch (err) {
            logForDebugging(
              `[print.ts] Mid-turn cloud UserPromptSubmit hook error: ${errorMessage(err)}`,
              { level: 'warn' },
            )
            outcome = {
              kind: 'allow',
              additionalContexts: [],
            }
          } finally {
            evalSignal.removeEventListener('abort', onEvalAbort)
          }
          if (
            outcome.kind === 'cancelled' ||
            evalSignal.aborted ||
            streamCtx.rapidFollowupDrain.endSessionRequested
          ) {
            cancelMidTurnUserMessage()
            return
          }
          if (outcome.kind === 'blocked' || outcome.kind === 'stopped') {
            streamCtx.output.enqueue({
              type: 'assistant',
              message: {
                id: `msg_${randomUUID()}`,
                type: 'message',
                role: 'assistant',
                model: '<synthetic>',
                content: [{ type: 'text', text: outcome.message }],
                stop_reason: null,
                stop_sequence: null,
                usage: EMPTY_USAGE,
              },
              parent_tool_use_id: null,
              session_id: getSessionId(),
              uuid: randomUUID(),
            } as unknown as StdoutMessage)
            if (userMsg.uuid) {
              notifyCommandLifecycle(userMsg.uuid as string, 'completed')
            }
            return
          }
          if (outcome.sessionTitle) {
            try {
              const { saveCustomTitle } = await import(
                'src/utils/sessionStorage.js'
              )
              await saveCustomTitle(
                getSessionId() as import('crypto').UUID,
                outcome.sessionTitle,
                undefined,
                'user',
              )
            } catch {
              // best-effort title persistence
            }
          }
          if (
            evalSignal.aborted ||
            streamCtx.rapidFollowupDrain.endSessionRequested
          ) {
            cancelMidTurnUserMessage()
            return
          }
          await enqueueInboundUserMessage({
            skipSubmissionHooks: true,
            additionalContexts: outcome.additionalContexts,
          })
        }, cancelMidTurnUserMessage)
        continue
      }

      if (midTurnHookRunner.hasPending) {
        midTurnHookRunner.schedule(async evalSignal => {
          if (
            evalSignal.aborted ||
            streamCtx.rapidFollowupDrain.endSessionRequested
          ) {
            cancelMidTurnUserMessage()
            return
          }
          await enqueueInboundUserMessage()
        }, cancelMidTurnUserMessage)
        continue
      }

      await enqueueInboundUserMessage()
    }
    if (!streamCtx.rapidFollowupDrain.endSessionRequested) {
      await midTurnHookRunner.waitForIdle()
    }
    streamCtx.inputClosed = true
    // Official 2.1.328 (#673) `tengu_cinder_swift`: when the input stream
    // closes with an open/parked AskUserQuestion prompt (default ON for 3P
    // providers or when telemetry/GrowthBook is off), abort/end the active
    // turn instead of synthesizing a denial that lets the model keep running.
    if (
      streamCtx.running &&
      streamCtx.abortController &&
      shouldInterruptParkedQuestionOnStreamClose()
    ) {
      const hasPendingQuestion =
        typeof (
          streamCtx.structuredIO as {
            hasPendingPermissionForTool?: (name: string) => boolean
          }
        ).hasPendingPermissionForTool === 'function'
          ? (
              streamCtx.structuredIO as unknown as {
                hasPendingPermissionForTool: (name: string) => boolean
              }
            ).hasPendingPermissionForTool('AskUserQuestion')
          : false
      if (hasPendingQuestion) {
        streamCtx.abortController.abort()
      }
    }
    streamCtx.claimFirstTurnAck?.({ cannotQueue: 'the input ended first' })
    streamCtx.cronScheduler?.stop()
    if (!streamCtx.running) {
      // If a push-suggestion is in-flight, wait for it to emit before closing
      // the output stream (5 s safety timeout to prevent hanging).
      if (streamCtx.suggestionState.inflightPromise) {
        await Promise.race([
          streamCtx.suggestionState.inflightPromise,
          sleep(5000),
        ])
      }
      streamCtx.suggestionState.abortController?.abort()
      streamCtx.suggestionState.abortController = null
      await finalizePendingAsyncHooks()
      streamCtx.unsubscribeSkillChanges()
      streamCtx.unsubscribeAuthStatus?.()
      statusListeners.delete(streamCtx.rateLimitListener)
      streamCtx.controlPlane.dispose()
      setBackgroundCeilingProvider(undefined)
      setSpawnedTurnTakenCallback(undefined)
      stopAllHookHeartbeatsForSession()
      streamCtx.unregisterHookHeartbeatSink?.()
      streamCtx.drainPrintSdkEvents()
      streamCtx.output.done()
    }
  })()
}
