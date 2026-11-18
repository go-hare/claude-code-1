import { randomUUID, type UUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { feature } from 'bun:bundle'
import type * as React from 'react'
import { getReplBridgeHandle } from '../../bridge/replBridgeHandle.js'
import {
  getBudgetContinuationCount,
  getCurrentTurnTokenBudget,
  getMainThreadAgentId,
  getPromptRenderEpoch,
  getSessionId,
  getTurnClassifierCount,
  getTurnClassifierDurationMs,
  getTurnHookCount,
  getTurnHookDurationMs,
  getTurnOutputTokens,
  getTurnToolCount,
  getTurnToolDurationMs,
  resetTurnClassifierDuration,
  resetTurnHookDuration,
  resetTurnToolDuration,
  setMainLoopBusy,
  snapshotOutputTokensForTurn,
} from '../../bootstrap/state.js'
import { hasCommand, type Command } from '../../commands.js'
import {
  messagesAfterAreOnlySynthetic,
  selectableUserMessagesFilter,
} from '../../components/MessageSelector.js'
import { resolveTurnDurationWithBackgroundWait } from '../../components/messages/SystemTextMessage.js'
import type { SpinnerMode } from '../../components/Spinner.js'
import { getSystemPrompt } from '../../constants/prompts.js'
import { getSystemContext, getUserContext } from '../../context.js'
import type { HostEngine } from '../../engine/hostEngine.js'
import { runHostEngineTurn } from '../../engine/hostEngineTurn.js'
import { removeLastFromHistory } from '../../history.js'
import { preferLiveMcpClients } from '../../hooks/useMergedClients.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { maybeMarkProjectOnboardingComplete } from '../../projectOnboardingState.js'
import type { QueryParams } from '../../query.js'
import { logEvent } from '../../services/analytics/index.js'
import { diagnosticTracker } from '../../services/diagnosticTracking.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { AppStateStore } from '../../state/AppStateStore.js'
import { getAllInProcessTeammateTasks } from '../../tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import type { TaskState } from '../../tasks/types.js'
import type {
  Message as MessageType,
  UserMessage,
} from '../../types/message.js'
import { count } from '../../utils/array.js'
import { getGlobalConfigWriteCount } from '../../utils/config.js'
import { levelSessionEffort, type EffortValue } from '../../utils/effort.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { closeOpenDiffs, getConnectedIdeClient } from '../../utils/ide.js'
import {
  countAbandonableLeftArrow,
  countLeftArrowBlockingQueuedCommands,
  countNewMonitorsSincePress,
} from '../../utils/leftArrowConfirm.js'
import { applyMessageStoreAction } from '../../utils/messageStore.js'
import { pruneDisplayedMessageContent } from '../../utils/messageDisplayTransform.js'
import {
  enqueue,
  getCommandQueue,
  getCommandQueueLength,
  someInFlightDrainCommand,
  type SetAppState,
} from '../../utils/messageQueueManager.js'
import {
  createApiMetricsMessage,
  createSystemMessage,
  createTurnDurationMessage,
  getContentText,
  getMessagesAfterCompactBoundary,
  handleMessageFromStream,
  isCompactBoundaryMessage,
  isMetaVisibleOrigin,
  type StreamingThinking,
  type StreamingToolUse,
} from '../../utils/messages.js'
import { resolveModelFacts } from '../../utils/model/modelFacts.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import { checkAndDisableAutoModeIfNeeded } from '../../utils/permissions/bypassPermissionsKillswitch.js'
import {
  getScratchpadDir,
  isScratchpadEnabled,
} from '../../utils/permissions/filesystem.js'
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js'
import { getQuerySourceForREPL } from '../../utils/promptCategory.js'
import type { QueryGuard } from '../../utils/QueryGuard.js'
import {
  logQueryProfileReport,
  queryCheckpoint,
} from '../../utils/queryProfiler.js'
import {
  isEphemeralToolProgress,
  isLoggableMessage,
  removeTranscriptMessage,
  saveAiGeneratedTitle,
} from '../../utils/sessionStorage.js'
import {
  generateSessionTitle,
  isSyntheticSessionTitleText,
} from '../../utils/sessionTitle.js'
import { startsWithRegisteredSlashCommand } from '../../utils/slashCommandParsing.js'
import type { Stream } from '../../utils/stream.js'
import { setMemberActive } from '../../utils/swarm/teamHelpers.js'
import { buildEffectiveSystemPrompt } from '../../utils/systemPrompt.js'
import { getAgentName, getTeamName } from '../../utils/teammate.js'
import { parseTokenBudget } from '../../utils/tokenBudget.js'
import type { ToolPermissionContext } from '../../Tool.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? (require('../../proactive/index.js') as typeof import('../../proactive/index.js'))
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

function getCoordinatorUserContext(
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
  tools?: ReadonlyArray<{ name: string; searchHint?: string }>,
): { [k: string]: string } {
  if (!feature('COORDINATOR_MODE')) return {}
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod =
    require('../../coordinator/coordinatorMode.js') as typeof import('../../coordinator/coordinatorMode.js')
  if (typeof mod?.getCoordinatorUserContext !== 'function') return {}
  return mod.getCoordinatorUserContext(mcpClients, scratchpadDir, tools)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!
}

export type ApiMetricEntry = {
  ttftMs: number
  firstTokenTime: number
  lastTokenTime: number
  responseLengthBaseline: number
  endResponseLength: number
}

export type LeftArrowDeferState = {
  clearCapTimer: () => void
  carriedAtPress: ReadonlySet<string>
  confirmedInterstitial: boolean
  proceed: () => Promise<string>
}

export type DispatchReplStreamEventDeps = {
  event: Parameters<typeof handleMessageFromStream>[0]
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  messagesRef: { current: MessageType[] }
  setConversationId: (id: UUID) => void
  setAppState: SetAppState
  streamingDisplayStore: {
    getState: () => { salvage: string | null; exact: boolean }
    setSalvage: (salvage: string | null, exact?: boolean) => void
  }
  salvageRef: {
    current: {
      apiMessageId: string
      salvageText: string
      exact: boolean
    } | null
  }
  refusalReplacesUuidsRef: { current: string[] | null }
  clearStreamingText: () => void
  pipeReturnHadErrorRef: { current: boolean }
  relayPipeMessage: (msg: {
    type: 'stream' | 'error' | 'done'
    data: string
  }) => void
  setResponseLength: (f: (prev: number) => number) => void
  setStreamMode: (mode: SpinnerMode) => void
  setStreamingToolUses: React.Dispatch<React.SetStateAction<StreamingToolUse[]>>
  setStreamingThinking: React.Dispatch<
    React.SetStateAction<StreamingThinking | null>
  >
  responseLengthRef: { current: number }
  apiMetricsRef: { current: ApiMetricEntry[] }
  onStreamingText: Parameters<typeof handleMessageFromStream>[8]
  displayTransform: Parameters<typeof handleMessageFromStream>[9]
  setInProgressToolUseIDs: React.Dispatch<React.SetStateAction<Set<string>>>
  addNotification: (n: {
    key: string
    text: string
    priority: 'immediate' | 'high' | 'medium' | 'low'
    timeoutMs?: number
  }) => void
}

/**
 * Dispatches a single stream event from `query()` / `runHostEngineTurn`
 * through `handleMessageFromStream` into REPL transcript and streaming UI state.
 */
export function dispatchReplStreamEvent(
  deps: DispatchReplStreamEventDeps,
): void {
  const {
    event,
    setMessages,
    messagesRef,
    setConversationId,
    setAppState,
    streamingDisplayStore,
    salvageRef,
    refusalReplacesUuidsRef,
    clearStreamingText,
    pipeReturnHadErrorRef,
    relayPipeMessage,
    setResponseLength,
    setStreamMode,
    setStreamingToolUses,
    setStreamingThinking,
    responseLengthRef,
    apiMetricsRef,
    onStreamingText,
    displayTransform,
    setInProgressToolUseIDs,
    addNotification,
  } = deps

  handleMessageFromStream(
    event,
    newMessage => {
      if (isCompactBoundaryMessage(newMessage)) {
        if (isFullscreenEnvEnabled()) {
          setMessages(old => {
            const postBoundary = getMessagesAfterCompactBoundary(old, {
              includeSnipped: true,
            })
            const MAX_FULLSCREEN_SCROLLBACK = 500
            const kept =
              postBoundary.length > MAX_FULLSCREEN_SCROLLBACK
                ? postBoundary.slice(-MAX_FULLSCREEN_SCROLLBACK)
                : postBoundary
            return [...kept, newMessage]
          })
        } else {
          setMessages(() => [newMessage])
        }
        setConversationId(randomUUID())
        setAppState(prev =>
          pruneDisplayedMessageContent(prev, messagesRef.current),
        )
        if (feature('PROACTIVE') || feature('KAIROS')) {
          proactiveModule?.setContextBlocked(false)
        }
      } else if (
        newMessage.type === 'progress' &&
        isEphemeralToolProgress(
          newMessage.data &&
            typeof newMessage.data === 'object' &&
            newMessage.data !== null &&
            'type' in newMessage.data
            ? newMessage.data.type
            : undefined,
        )
      ) {
        setMessages(oldMessages =>
          applyMessageStoreAction(oldMessages, {
            type: 'replace-last-ephemeral-progress',
            message: newMessage,
          }),
        )
      } else {
        if (newMessage.type === 'assistant') {
          const st = streamingDisplayStore.getState()
          if (
            st.salvage !== null &&
            !('isVirtual' in newMessage && newMessage.isVirtual) &&
            !('isApiErrorMessage' in newMessage && newMessage.isApiErrorMessage)
          ) {
            const content = newMessage.message?.content
            const hasText =
              Array.isArray(content) &&
              content.some(
                b =>
                  typeof b !== 'string' &&
                  b.type === 'text' &&
                  typeof b.text === 'string' &&
                  b.text.trim().length > 0,
              )
            if (hasText && newMessage.message?.id) {
              salvageRef.current = {
                apiMessageId: newMessage.message.id,
                salvageText: st.salvage,
                exact: st.exact,
              }
              const replaces = refusalReplacesUuidsRef.current
              if (replaces !== null) {
                refusalReplacesUuidsRef.current = null
                const drop = new Set(replaces)
                setMessages(old => old.filter(m => !drop.has(m.uuid)))
                for (const uuid of replaces) {
                  void removeTranscriptMessage(
                    uuid as `${string}-${string}-${string}-${string}-${string}`,
                  )
                }
              }
              streamingDisplayStore.setSalvage(null)
            }
          }
        }
        if (isFullscreenEnvEnabled()) {
          setMessages(oldMessages =>
            applyMessageStoreAction(oldMessages, {
              type: 'append-or-move-by-uuid',
              message: newMessage,
            }),
          )
        } else {
          setMessages(oldMessages => [...oldMessages, newMessage])
        }
        if (newMessage.type === 'assistant') {
          clearStreamingText()
        }
      }
      if (feature('PROACTIVE') || feature('KAIROS')) {
        if (
          newMessage.type === 'assistant' &&
          'isApiErrorMessage' in newMessage &&
          newMessage.isApiErrorMessage
        ) {
          proactiveModule?.setContextBlocked(true)
        } else if (newMessage.type === 'assistant') {
          proactiveModule?.setContextBlocked(false)
        }
      }
      if (feature('UDS_INBOX') && newMessage.type === 'assistant') {
        const msg = newMessage.message as { content?: unknown } | undefined
        const contentBlocks =
          msg?.content ?? (newMessage as { content?: unknown }).content ?? []
        const textParts: string[] = []
        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (typeof block === 'string') {
              textParts.push(block)
            } else if (
              block &&
              typeof block === 'object' &&
              'type' in block &&
              block.type === 'text' &&
              'text' in block &&
              typeof block.text === 'string' &&
              block.text
            ) {
              textParts.push(block.text)
            }
          }
        } else if (typeof contentBlocks === 'string') {
          textParts.push(contentBlocks)
        }
        const text = textParts.join('\n').trim()
        if ('isApiErrorMessage' in newMessage && newMessage.isApiErrorMessage) {
          pipeReturnHadErrorRef.current = true
          relayPipeMessage({
            type: 'error',
            data: text || 'Slave request failed',
          })
        } else if (text) {
          relayPipeMessage({ type: 'stream', data: text })
        }
      }
    },
    deltaChars => {
      setResponseLength(length => length + deltaChars)
    },
    setStreamMode,
    setStreamingToolUses,
    tombstonedMessage => {
      setMessages(oldMessages =>
        oldMessages.filter(m => m !== tombstonedMessage),
      )
      void removeTranscriptMessage(tombstonedMessage.uuid)
    },
    setStreamingThinking,
    metrics => {
      let ttftMs: number | undefined
      if ('type' in metrics && metrics.type === 'start') {
        ttftMs = metrics.ttftMs
      } else if (
        'ttftMs' in metrics &&
        typeof (metrics as { ttftMs?: unknown }).ttftMs === 'number'
      ) {
        ttftMs = (metrics as { ttftMs: number }).ttftMs
      }
      if (ttftMs === undefined) return
      const now = Date.now()
      const baseline = responseLengthRef.current
      apiMetricsRef.current.push({
        ttftMs,
        firstTokenTime: now,
        lastTokenTime: now,
        responseLengthBaseline: baseline,
        endResponseLength: baseline,
      })
    },
    onStreamingText,
    displayTransform,
    event => {
      if (event.phase === 'begin') {
        salvageRef.current = null
        refusalReplacesUuidsRef.current =
          event.replacesUuids !== undefined && event.replacesUuids.length > 0
            ? event.replacesUuids
            : null
        streamingDisplayStore.setSalvage(
          event.salvageText ?? null,
          event.join === 'exact',
        )
      } else {
        refusalReplacesUuidsRef.current = null
        streamingDisplayStore.setSalvage(null)
      }
    },
    undefined,
    {
      onConversationReset: newConversationId => {
        setConversationId(
          newConversationId as `${string}-${string}-${string}-${string}-${string}`,
        )
      },
      onInProgressToolUseIDs: op => {
        const ids = Array.isArray(op.ids) ? op.ids : []
        const action = op.action ?? 'set'
        const apply = (prev: Set<string>): Set<string> => {
          if (action === 'clear') {
            return prev.size === 0 ? prev : new Set()
          }
          if (action === 'remove') {
            if (ids.length === 0 || prev.size === 0) return prev
            const next = new Set(prev)
            for (const id of ids) next.delete(id)
            return next.size === prev.size ? prev : next
          }
          if (action === 'add') {
            if (ids.length === 0) return prev
            const next = new Set(prev)
            for (const id of ids) next.add(id)
            return next.size === prev.size ? prev : next
          }
          return ids.length === 0 && prev.size === 0 ? prev : new Set(ids)
        }
        setInProgressToolUseIDs(apply)
      },
      onNotification: notification => {
        if (
          notification &&
          typeof notification === 'object' &&
          'text' in (notification as object)
        ) {
          const n = notification as {
            key?: string
            text?: string
            priority?: 'immediate' | 'high' | 'medium' | 'low'
          }
          if (typeof n.text === 'string' && n.text.length > 0) {
            addNotification({
              key: n.key ?? `stream-notification-${Date.now()}`,
              text: n.text,
              priority: n.priority ?? 'medium',
            })
          }
        }
      },
      onExpandedView: expandedView => {
        if (expandedView === 'teammates') {
          setAppState(prev =>
            prev.expandedView === 'none'
              ? prev
              : { ...prev, expandedView: 'none' },
          )
          return
        }
        if (typeof expandedView === 'string' || expandedView === null) {
          setAppState(prev =>
            prev.expandedView === expandedView
              ? prev
              : {
                  ...prev,
                  expandedView: expandedView as typeof prev.expandedView,
                },
          )
        }
      },
      onActiveGoal: value => {
        setAppState(prev => {
          if (value === undefined || value === null) {
            if (prev.activeGoal === undefined) return prev
            return { ...prev, activeGoal: undefined }
          }
          if (typeof value === 'object') {
            return {
              ...prev,
              activeGoal: value as NonNullable<typeof prev.activeGoal>,
            }
          }
          return prev
        })
      },
      onPostTurnSummary: value => {
        void value
      },
      onHintClears: () => {},
      onInterruptibleToolInProgress: () => {},
      onOSNotification: () => {},
      onCommandLifecycle: () => {},
    },
    true, // densable authoringProgressSurface:!0
  )
}

export type RunReplTurnArgs = {
  newMessages: MessageType[]
  abortController: AbortController
  shouldQuery: boolean
  additionalAllowedTools: string[]
  mainLoopModelParam: string
  onBeforeQueryCallback?: (
    input: string,
    newMessages: MessageType[],
  ) => Promise<boolean>
  input?: string
  effort?: EffortValue
  stopHookActive?: boolean
  clientPlatform?: string
  additionalDisallowedTools?: string[]
}

export type RunReplTurnDeps = {
  store: AppStateStore
  queryGuard: QueryGuard
  initialMcpClients?: MCPServerConnection[]
  titleDisabled: boolean
  sessionTitle: string | undefined
  sessionAiTitle: string | undefined
  agentTitle: string | undefined
  haikuTitleAttemptedRef: { current: boolean }
  setHaikuTitle: (title: string) => void
  commands: Command[]
  setConversationId: (id: UUID) => void
  setAppState: SetAppState
  messagesRef: { current: MessageType[] }
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  resetLoadingState: () => void
  setAbortController: (ac: AbortController | null) => void
  getToolUseContext: (
    messages: MessageType[],
    newMessages: MessageType[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext
  toolPermissionContext: ToolPermissionContext
  terminalFocusRef: { current: boolean }
  mainThreadAgentDefinition?: AgentDefinition
  customSystemPrompt?: string
  appendSystemPrompt?: string
  canUseTool: CanUseToolFn
  hostEngine: HostEngine
  hostInputRef: { current: Stream<Record<string, unknown>> | null }
  pendingQueryParamsRef: { current: Record<string, unknown>[] }
  onQueryEvent: (event: Parameters<typeof handleMessageFromStream>[0]) => void
  addNotification: (n: {
    key: string
    text: string
    priority: 'immediate' | 'high' | 'medium' | 'low'
    timeoutMs?: number
  }) => void
  leftArrowDeferRef: { current: LeftArrowDeferState | null }
  inputValueRef: { current: string }
  markIdleForkMidTurn: () => void
  leftArrowToAgentsFired: { current: boolean }
  buddyEnabled: boolean
  pipeReturnHadErrorRef: { current: boolean }
  relayPipeMessage: (msg: {
    type: 'stream' | 'error' | 'done'
    data: string
  }) => void
  apiMetricsRef: { current: ApiMetricEntry[] }
  loadingStartTimeRef: { current: number }
  totalPausedMsRef: { current: number }
  swarmStartTimeRef: { current: number | null }
  swarmBudgetInfoRef: {
    current: { tokens: number; limit: number; nudges: number } | undefined
  }
  backgroundWaitStartTimeRef: { current: number | null }
  onTurnComplete?: (messages: MessageType[]) => Promise<void> | void
  resetTimingRefs: () => void
  responseLengthRef: { current: number }
  setStreamingToolUses: React.Dispatch<React.SetStateAction<StreamingToolUse[]>>
  clearStreamingText: () => void
  displayTransform: { newTurn: () => void }
  mrOnBeforeQuery: (
    input: string,
    messages: MessageType[],
    newCount: number,
  ) => Promise<unknown>
  mrOnTurnComplete: (messages: MessageType[], aborted: boolean) => Promise<void>
  setLastQueryCompletionTime: (time: number) => void
  sendBridgeResultRef: { current: () => void }
  proactiveActive: unknown
  restoreMessageSyncRef: { current: (m: UserMessage) => void }
}

async function executeReplTurnImpl(
  deps: RunReplTurnDeps,
  messagesIncludingNewMessages: MessageType[],
  newMessages: MessageType[],
  abortController: AbortController,
  shouldQuery: boolean,
  additionalAllowedTools: string[],
  mainLoopModelParam: string,
  effort?: EffortValue,
  stopHookActive?: boolean,
  additionalDisallowedTools: string[] = [],
): Promise<void> {
  const {
    store,
    initialMcpClients,
    titleDisabled,
    sessionTitle,
    sessionAiTitle,
    agentTitle,
    haikuTitleAttemptedRef,
    setHaikuTitle,
    commands,
    setConversationId,
    setAppState,
    messagesRef,
    resetLoadingState,
    setAbortController,
    getToolUseContext,
    toolPermissionContext,
    terminalFocusRef,
    mainThreadAgentDefinition,
    customSystemPrompt,
    appendSystemPrompt,
    canUseTool,
    hostEngine,
    hostInputRef,
    pendingQueryParamsRef,
    onQueryEvent,
    addNotification,
    leftArrowDeferRef,
    inputValueRef,
    setMessages,
    markIdleForkMidTurn,
    leftArrowToAgentsFired,
    buddyEnabled,
    pipeReturnHadErrorRef,
    relayPipeMessage,
    apiMetricsRef,
    loadingStartTimeRef,
    onTurnComplete,
  } = deps

  if (shouldQuery) {
    const freshClients = preferLiveMcpClients(
      store.getState().mcp.clients,
      initialMcpClients,
    )
    void diagnosticTracker.handleQueryStart(freshClients)
    const ideClient = getConnectedIdeClient(freshClients)
    if (ideClient) {
      void closeOpenDiffs(ideClient)
    }
  }

  void maybeMarkProjectOnboardingComplete()

  if (
    !titleDisabled &&
    !sessionTitle &&
    !sessionAiTitle &&
    !agentTitle &&
    !haikuTitleAttemptedRef.current
  ) {
    const firstUserMessage = newMessages.find(
      m => m.type === 'user' && !m.isMeta,
    )
    const text =
      firstUserMessage?.type === 'user'
        ? getContentText(
            firstUserMessage.message!.content as string | ContentBlockParam[],
          )
        : null
    const isRegisteredSlash =
      text != null &&
      startsWithRegisteredSlashCommand(text, name => hasCommand(name, commands))
    if (text && !isSyntheticSessionTitleText(text) && !isRegisteredSlash) {
      haikuTitleAttemptedRef.current = true
      const titleSessionId = getSessionId()
      void generateSessionTitle(text, new AbortController().signal).then(
        title => {
          if (titleSessionId !== getSessionId()) return
          if (title) {
            setHaikuTitle(title)
            saveAiGeneratedTitle(titleSessionId as UUID, title)
            getReplBridgeHandle()?.adoptLocalAiTitle?.()
          } else haikuTitleAttemptedRef.current = false
        },
        () => {
          haikuTitleAttemptedRef.current = false
        },
      )
    }
  }

  store.setState(prev => {
    const curAllow = prev.toolPermissionContext.alwaysAllowRules.command
    const allowSame =
      curAllow === additionalAllowedTools ||
      (curAllow?.length === additionalAllowedTools.length &&
        curAllow.every((v, i) => v === additionalAllowedTools[i]))
    const curDeny = prev.toolPermissionContext.alwaysDenyRules.command ?? []
    const nextDeny =
      additionalDisallowedTools.length === 0
        ? curDeny
        : Array.from(new Set([...curDeny, ...additionalDisallowedTools]))
    const denySame =
      curDeny.length === nextDeny.length &&
      curDeny.every((v, i) => v === nextDeny[i])
    if (allowSame && denySame) {
      return prev
    }
    return {
      ...prev,
      toolPermissionContext: {
        ...prev.toolPermissionContext,
        alwaysAllowRules: {
          ...prev.toolPermissionContext.alwaysAllowRules,
          command: additionalAllowedTools,
        },
        alwaysDenyRules: {
          ...prev.toolPermissionContext.alwaysDenyRules,
          command: nextDeny.length > 0 ? nextDeny : undefined,
        },
      },
    }
  })

  if (!shouldQuery) {
    if (newMessages.some(isCompactBoundaryMessage)) {
      setConversationId(randomUUID())
      setAppState(prev =>
        pruneDisplayedMessageContent(prev, messagesRef.current),
      )
      if (feature('PROACTIVE') || feature('KAIROS')) {
        proactiveModule?.setContextBlocked(false)
      }
    }
    resetLoadingState()
    setAbortController(null)
    return
  }

  const toolUseContext = getToolUseContext(
    messagesIncludingNewMessages,
    newMessages,
    abortController,
    mainLoopModelParam,
  )
  const { tools: freshTools, mcpClients: freshMcpClients } =
    toolUseContext.options

  if (effort !== undefined) {
    const previousGetAppState = toolUseContext.getAppState
    toolUseContext.getAppState = () => ({
      ...previousGetAppState(),
      sessionEffort: levelSessionEffort(effort),
    })
    try {
      const { leftoverIhr } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/collapseReadSearch.js') as typeof import('../../utils/collapseReadSearch.js')
      leftoverIhr.main.setTurnEffort(effort)
    } catch {
      // isolation — optional
    }
  }

  const modelFacts = await resolveModelFacts(mainLoopModelParam, {
    credentials: toolUseContext.credentials,
    abortController,
  })
  const promptRenderEpoch = getPromptRenderEpoch()

  queryCheckpoint('query_context_loading_start')
  const [, , defaultSystemPrompt, baseUserContext, systemContext] =
    await Promise.all([
      undefined,
      feature('TRANSCRIPT_CLASSIFIER')
        ? checkAndDisableAutoModeIfNeeded(
            toolPermissionContext,
            setAppState,
            store.getState().fastMode,
          )
        : undefined,
      getSystemPrompt(
        freshTools,
        mainLoopModelParam,
        Array.from(toolPermissionContext.additionalWorkingDirectories.keys()),
        freshMcpClients,
      ),
      getUserContext(),
      getSystemContext(),
    ])
  const userContext = {
    ...baseUserContext,
    ...getCoordinatorUserContext(
      freshMcpClients,
      isScratchpadEnabled() ? getScratchpadDir() : undefined,
      freshTools,
    ),
    ...((feature('PROACTIVE') || feature('KAIROS')) &&
    proactiveModule?.isProactiveActive() &&
    !terminalFocusRef.current
      ? {
          terminalFocus:
            'The terminal is unfocused \u2014 the user is not actively watching.',
        }
      : {}),
  }
  queryCheckpoint('query_context_loading_end')

  const systemPrompt = buildEffectiveSystemPrompt({
    mainThreadAgentDefinition,
    toolUseContext,
    customSystemPrompt,
    defaultSystemPrompt,
    appendSystemPrompt,
  })
  toolUseContext.renderedSystemPrompt = systemPrompt

  queryCheckpoint('query_query_start')
  resetTurnHookDuration()
  resetTurnToolDuration()
  resetTurnClassifierDuration()

  const turnInput: QueryParams = {
    messages: messagesIncludingNewMessages,
    systemPrompt,
    userContext,
    systemContext,
    canUseTool,
    toolUseContext,
    querySource: getQuerySourceForREPL(),
    stopHookActive,
    promptRenderEpoch,
    modelFacts,
  }
  const onAbort = () => {
    void hostEngine.interrupt('user-cancel')
  }
  if (abortController.signal.aborted) {
    onAbort()
  } else {
    abortController.signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    await runHostEngineTurn({
      engine: hostEngine,
      inputRef: hostInputRef,
      pendingQueryParamsRef,
      turnInput,
      newMessages,
      onQueryEvent: event => {
        onQueryEvent(event as Parameters<typeof onQueryEvent>[0])
      },
      addNotification: n => {
        addNotification({
          key: n.key ?? 'engine-notification',
          text: n.text,
          priority:
            n.priority === 'low' ||
            n.priority === 'medium' ||
            n.priority === 'high' ||
            n.priority === 'immediate'
              ? n.priority
              : 'medium',
          timeoutMs: n.timeoutMs,
        })
      },
    })
  } finally {
    abortController.signal.removeEventListener('abort', onAbort)
  }

  {
    // densable _runImpl post-query
    const arm = leftArrowDeferRef.current
    if (arm) {
      arm.clearCapTimer()
      leftArrowDeferRef.current = null
      if (!abortController.signal.aborted) {
        const liveTasks = (store.getState().tasks ?? {}) as Record<
          string,
          TaskState
        >
        const abandon = countAbandonableLeftArrow(liveTasks)
        const newMonitors = countNewMonitorsSincePress(
          liveTasks,
          arm.carriedAtPress,
        )
        const queued = countLeftArrowBlockingQueuedCommands(getCommandQueue())
        const hasUnsent = inputValueRef.current.trim() !== ''
        if (
          queued > 0 ||
          hasUnsent ||
          (!arm.confirmedInterstitial && abandon > 0) ||
          newMonitors > 0
        ) {
          const [why, hint] =
            queued > 0
              ? [
                  `${queued} queued ${queued === 1 ? 'command' : 'commands'} would be lost`,
                  'Press \u2190 again once the queue clears.',
                ]
              : hasUnsent
                ? [
                    'you have unsent text in the input',
                    'Send it or clear it, then press \u2190 again.',
                  ]
                : newMonitors > 0
                  ? [
                      `${newMonitors} Artifact comment ${newMonitors === 1 ? 'monitor' : 'monitors'} started after you pressed \u2190`,
                      'Press \u2190 again to review and confirm.',
                    ]
                  : [
                      `${abandon} background ${abandon === 1 ? 'task' : 'tasks'} would be abandoned`,
                      'Press \u2190 again to confirm.',
                    ]
          // densable post-query refuse: K({append, Ss(...,"warning")}) — not yi
          setMessages(prev => [
            ...prev,
            createSystemMessage(
              `Backgrounding cancelled \u2014 ${why}. ${hint}`,
              'warning',
            ),
          ])
          markIdleForkMidTurn()
        } else {
          // densable: q.current=!0; await K9(W.getSnapshot(),…); $e=await he.proceed();
          // append Ss($e,"warning"); G()
          // tip: recordTranscript (storageV5 5th arg invent-ban)
          leftArrowToAgentsFired.current = true
          try {
            const { recordTranscript } = await import(
              '../../utils/sessionStorage.js'
            )
            await recordTranscript(messagesRef.current as never)
          } catch {
            /* best-effort persist before handoff */
          }
          const $e = await arm.proceed()
          setMessages(prev => [...prev, createSystemMessage($e, 'warning')])
          markIdleForkMidTurn()
        }
      }
    }
  }

  if (
    buddyEnabled &&
    typeof (globalThis as Record<string, unknown>).fireCompanionObserver ===
      'function'
  ) {
    const _fireCompanionObserver = (globalThis as Record<string, unknown>)
      .fireCompanionObserver as (
      msgs: unknown,
      cb: (r: unknown) => void,
    ) => void
    void _fireCompanionObserver(messagesRef.current, reaction =>
      setAppState(prev =>
        prev.companionReaction === (reaction as typeof prev.companionReaction)
          ? prev
          : {
              ...prev,
              companionReaction: reaction as typeof prev.companionReaction,
            },
      ),
    )
  }

  queryCheckpoint('query_end')

  if (feature('UDS_INBOX')) {
    if (abortController.signal.aborted) {
      pipeReturnHadErrorRef.current = true
      relayPipeMessage({
        type: 'error',
        data: 'Slave request was interrupted before completion.',
      })
    }
  }

  if (process.env.USER_TYPE === 'ant' && apiMetricsRef.current.length > 0) {
    const entries = apiMetricsRef.current

    const ttfts = entries.map(e => e.ttftMs)
    const otpsValues = entries.map(e => {
      const delta = Math.round(
        (e.endResponseLength - e.responseLengthBaseline) / 4,
      )
      const samplingMs = e.lastTokenTime - e.firstTokenTime
      return samplingMs > 0 ? Math.round(delta / (samplingMs / 1000)) : 0
    })

    const isMultiRequest = entries.length > 1
    const hookMs = getTurnHookDurationMs()
    const hookCount = getTurnHookCount()
    const toolMs = getTurnToolDurationMs()
    const toolCount = getTurnToolCount()
    const classifierMs = getTurnClassifierDurationMs()
    const classifierCount = getTurnClassifierCount()
    const turnMs = performance.now() - loadingStartTimeRef.current
    setMessages(prev => [
      ...prev,
      createApiMetricsMessage({
        ttftMs: isMultiRequest ? median(ttfts) : ttfts[0]!,
        otps: isMultiRequest ? median(otpsValues) : otpsValues[0]!,
        isP50: isMultiRequest,
        hookDurationMs: hookMs > 0 ? hookMs : undefined,
        hookCount: hookCount > 0 ? hookCount : undefined,
        turnDurationMs: turnMs > 0 ? turnMs : undefined,
        toolDurationMs: toolMs > 0 ? toolMs : undefined,
        toolCount: toolCount > 0 ? toolCount : undefined,
        classifierDurationMs: classifierMs > 0 ? classifierMs : undefined,
        classifierCount: classifierCount > 0 ? classifierCount : undefined,
        configWriteCount: getGlobalConfigWriteCount(),
      }),
    ])
  }

  resetLoadingState()
  logQueryProfileReport()
  await onTurnComplete?.(messagesRef.current)
}

/**
 * Orchestrates a full REPL turn: `queryGuard` concurrency guard & re-queueing,
 * `executeReplTurnImpl` execution, and `finally` cleanup (turn duration,
 * UDS_INBOX completion, bridge notification, and user-cancel auto-restore).
 */
export async function runReplTurn(
  args: RunReplTurnArgs,
  deps: RunReplTurnDeps,
): Promise<boolean> {
  const {
    newMessages,
    abortController,
    shouldQuery,
    additionalAllowedTools,
    mainLoopModelParam,
    onBeforeQueryCallback,
    input,
    effort,
    stopHookActive,
    clientPlatform,
    additionalDisallowedTools = [],
  } = args

  const {
    store,
    queryGuard,
    pipeReturnHadErrorRef,
    relayPipeMessage,
    resetTimingRefs,
    setMessages,
    messagesRef,
    responseLengthRef,
    apiMetricsRef,
    setStreamingToolUses,
    clearStreamingText,
    displayTransform,
    mrOnBeforeQuery,
    mrOnTurnComplete,
    setLastQueryCompletionTime,
    resetLoadingState,
    sendBridgeResultRef,
    setAppState,
    loadingStartTimeRef,
    totalPausedMsRef,
    proactiveActive,
    swarmStartTimeRef,
    swarmBudgetInfoRef,
    backgroundWaitStartTimeRef,
    setAbortController,
    inputValueRef,
    restoreMessageSyncRef,
  } = deps

  if (isAgentSwarmsEnabled()) {
    const teamName = getTeamName()
    const agentName = getAgentName()
    if (teamName && agentName) {
      void setMemberActive(teamName, agentName, true)
    }
  }

  const thisGeneration = queryGuard.tryStart()
  if (thisGeneration === null) {
    logEvent('tengu_concurrent_onquery_detected', {})

    let enqueued = false
    for (const m of newMessages) {
      if (m.type !== 'user') continue
      if (
        m.isMeta &&
        !isMetaVisibleOrigin(
          m.origin as { kind?: string; senderTaskId?: string } | undefined,
        )
      ) {
        continue
      }
      if ((m as { stackedExpansion?: boolean }).stackedExpansion) {
        continue
      }
      const userContent = m.message?.content
      if (userContent === undefined) continue
      const stackedOriginal = (m as { stackedOriginalInput?: string })
        .stackedOriginalInput
      const textContent =
        stackedOriginal ??
        getContentText(userContent as string | ContentBlockParam[])
      if (textContent === null || textContent === undefined) continue
      const queuePriority = (m as { queuePriority?: 'now' | 'next' | 'later' })
        .queuePriority
      const verifiedSlackHumanTurn = (m as { verifiedSlackHumanTurn?: boolean })
        .verifiedSlackHumanTurn
      const promptSource = (m as { promptSource?: string }).promptSource
      enqueue({
        value: textContent,
        mode: 'prompt',
        agentId: getMainThreadAgentId(),
        uuid: m.uuid,
        origin: m.origin,
        isMeta: m.isMeta,
        skipSlashCommands: isMetaVisibleOrigin(
          m.origin as { kind?: string; senderTaskId?: string } | undefined,
        ),
        ...(stopHookActive !== undefined ? { stopHookActive } : {}),
        ...(clientPlatform !== undefined ? { clientPlatform } : {}),
        ...(queuePriority !== undefined ? { priority: queuePriority } : {}),
        ...(verifiedSlackHumanTurn !== undefined
          ? { verifiedSlackHumanTurn }
          : {}),
        ...(promptSource === 'suggestion_accepted'
          ? { inputSource: 'suggestion_accepted' }
          : {}),
        ...(stackedOriginal !== undefined
          ? { preExpansionValue: stackedOriginal }
          : {}),
      })
      if (!enqueued) {
        enqueued = true
        logEvent('tengu_concurrent_onquery_enqueued', {})
      }
    }
    return false
  }

  setMainLoopBusy(true)

  try {
    pipeReturnHadErrorRef.current = false
    resetTimingRefs()
    setMessages(oldMessages => [...oldMessages, ...newMessages])
    responseLengthRef.current = 0
    if (feature('TOKEN_BUDGET')) {
      const parsedBudget = input ? parseTokenBudget(input) : null
      snapshotOutputTokensForTurn(parsedBudget ?? getCurrentTurnTokenBudget())
    }
    apiMetricsRef.current = []
    setStreamingToolUses([])
    clearStreamingText()
    displayTransform.newTurn()

    const latestMessages = messagesRef.current

    if (input) {
      await mrOnBeforeQuery(input, latestMessages, newMessages.length)
    }

    if (onBeforeQueryCallback && input) {
      const shouldProceed = await onBeforeQueryCallback(input, latestMessages)
      if (!shouldProceed) {
        return true
      }
    }

    try {
      await executeReplTurnImpl(
        deps,
        latestMessages,
        newMessages,
        abortController,
        shouldQuery,
        additionalAllowedTools,
        mainLoopModelParam,
        effort,
        stopHookActive,
        additionalDisallowedTools,
      )
    } catch (error) {
      if (feature('UDS_INBOX')) {
        pipeReturnHadErrorRef.current = true
        relayPipeMessage({
          type: 'error',
          data: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  } finally {
    if (queryGuard.end(thisGeneration)) {
      setMainLoopBusy(false)
      setLastQueryCompletionTime(Date.now())
      resetLoadingState()

      await mrOnTurnComplete(
        messagesRef.current,
        abortController.signal.aborted,
      )

      if (feature('UDS_INBOX') && !pipeReturnHadErrorRef.current) {
        relayPipeMessage({
          type: 'done',
          data: '',
        })
      }

      sendBridgeResultRef.current()

      if (process.env.USER_TYPE === 'ant' && !abortController.signal.aborted) {
        setAppState(prev => {
          if (prev.tungstenActiveSession === undefined) return prev
          if (prev.tungstenPanelAutoHidden === true) return prev
          return { ...prev, tungstenPanelAutoHidden: true }
        })
      }

      let budgetInfo:
        | { tokens: number; limit: number; nudges: number }
        | undefined
      if (feature('TOKEN_BUDGET')) {
        if (
          getCurrentTurnTokenBudget() !== null &&
          getCurrentTurnTokenBudget()! > 0 &&
          !abortController.signal.aborted
        ) {
          budgetInfo = {
            tokens: getTurnOutputTokens(),
            limit: getCurrentTurnTokenBudget()!,
            nudges: getBudgetContinuationCount(),
          }
        }
        snapshotOutputTokensForTurn(null)
      }

      const turnDurationMs =
        performance.now() -
        loadingStartTimeRef.current -
        totalPausedMsRef.current
      if (!abortController.signal.aborted && !proactiveActive) {
        const hasRunningSwarmAgents = getAllInProcessTeammateTasks(
          store.getState().tasks,
        ).some(t => t.status === 'running')
        if (hasRunningSwarmAgents) {
          if (swarmStartTimeRef.current === null) {
            swarmStartTimeRef.current = loadingStartTimeRef.current
          }
          if (budgetInfo) {
            swarmBudgetInfoRef.current = budgetInfo
          }
        } else {
          const now = performance.now()
          const resolvedDuration = resolveTurnDurationWithBackgroundWait({
            tasks: store.getState().tasks,
            queuedCommands: getCommandQueue(),
            turnDurationMs,
            turnStartTime: loadingStartTimeRef.current,
            now,
            backgroundWaitStartTime: backgroundWaitStartTimeRef.current,
          })
          backgroundWaitStartTimeRef.current =
            resolvedDuration.backgroundWaitStartTime
          setMessages(prev => [
            ...prev,
            createTurnDurationMessage(
              resolvedDuration.durationMs,
              budgetInfo,
              count(prev, isLoggableMessage),
              resolvedDuration.pendingBackgroundAgentCount,
              resolvedDuration.pendingWorkflowCount,
            ),
          ])
        }
      }
      setAbortController(null)
    }

    if (
      abortController.signal.reason === 'user-cancel' &&
      !queryGuard.isActive &&
      inputValueRef.current === '' &&
      getCommandQueueLength() === 0 &&
      !someInFlightDrainCommand() &&
      !store.getState().viewingAgentTaskId
    ) {
      const msgs = messagesRef.current
      const lastUserMsg = msgs.findLast(selectableUserMessagesFilter)
      if (lastUserMsg) {
        const idx = msgs.lastIndexOf(lastUserMsg)
        if (messagesAfterAreOnlySynthetic(msgs, idx)) {
          removeLastFromHistory()
          restoreMessageSyncRef.current(lastUserMsg)
        }
      }
    }
  }
  return true
}
