import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages.mjs'
import { clearSpeculativeChecks } from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import { SLEEP_TOOL_NAME } from '@claude-code/builtin-tools/tools/SleepTool/prompt.js'
import type * as React from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useIdleUpsellNotification } from 'src/hooks/notifs/useIdleUpsellNotification.js'
import { usePluginMonitors } from 'src/hooks/usePluginMonitors.js'
import {
  evaluateTipContent,
  getSpinnerTipPluginSeat,
  getTipToShowOnSpinner,
  recordShownTip,
} from 'src/services/tips/tipScheduler.js'
import { isBareMode } from 'src/utils/envUtils.js'
import type { Theme } from 'src/utils/theme.js'
import { getLastInteractionTime } from '../../bootstrap/state.js'
import { countPendingTurnDurationWork } from '../../components/messages/SystemTextMessage.js'
import type { Notification } from '../../context/notifications.js'
import type { DialogStore } from '../../dialog/index.js'
import { isTipsModLoaded } from '../../plugins/bundled/tips.js'
import type { RemoteSessionConfig } from '../../remote/RemoteSessionManager.js'
import type { getElicitationCueBehindDraft } from '../../services/mcp/elicitationHandler.js'
import { sendNotification } from '../../services/notifier.js'
import { isQuotaAutoResumeArmed } from '../../services/quotaAutoResume.js'
import type { AppState } from '../../state/AppStateStore.js'
import {
  leftoverIhrSlice,
  leftoverIhrSubscribe,
} from '../../state/leftoverIhrStore.js'
import type { Store } from '../../state/store.js'
import { getAllInProcessTeammateTasks } from '../../tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import { isInProcessTeammateTask } from '../../tasks/InProcessTeammateTask/types.js'
import { isLocalAgentTask } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { Message as MessageType } from '../../types/message.js'
import type { RetryStatus } from '../../utils/advisorNetworkStall.js'
import { count } from '../../utils/array.js'
import { getGlobalConfig } from '../../utils/config.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import {
  createIdleReturnClock,
  createIdleReturnTurnSource,
  IdleReturnController,
} from '../../utils/idleReturnController.js'
import { hasPendingLoopWakeups } from '../../utils/loopDynamic.js'
import { createMessageDisplayTransform } from '../../utils/messageDisplayTransform.js'
import type {
  MessageQueueInstance,
  SetAppState,
} from '../../utils/messageQueueManager.js'
import {
  createTurnDurationMessage,
  type StreamingToolUse,
} from '../../utils/messages.js'
import {
  extractBashHostsFromMessages,
  extractBashToolsFromMessages,
} from '../../utils/queryHelpers.js'
import { getReplDiffHost } from '../../utils/sessionHost.js'
import { isLoggableMessage } from '../../utils/sessionStorage.js'
import type { StorageV5 } from '../../utils/storageV5/index.js'
import {
  createStreamingDisplayStore,
  createStreamingTextFlushBuffer,
  mergeSalvagePrefix,
  STREAM_FLAG_DISPLAYED,
  STREAM_FLAG_HIDE_TRAILING,
  type StreamingDisplayStore,
} from '../../utils/streamingTextStore.js'
import { resolveFocusFoldHoldsPreview } from '../../utils/streamingUiGate.js'
import { endInteractionSpan } from '../../utils/telemetry/sessionTracing.js'
import { computeStopHookSpinnerSuffix } from './replHelpers.js'
import type { TurnController } from './TurnController.js'
import type {
  ApiMetricsEntry,
  FocusedInputDialog,
  PromptQueueItem,
  SalvageState,
  Screen,
  ToolJSXState,
} from './types.js'

/**
 * Owns streaming text preview store/flush buffer/displayTransform, idle-return
 * controller, spinner overrides/tips/visibility, focused subagent spinner refs,
 * `resetLoadingState`, and deferred swarm turn duration reporting.
 */
export function useReplStreamingAndSpinner(params: {
  store: Store<AppState>
  setAppState: SetAppState
  turnController: TurnController
  messageQueue: MessageQueueInstance
  dialogStore: DialogStore
  messages: MessageType[]
  messagesRef: React.RefObject<MessageType[]>
  setMessages: (action: React.SetStateAction<MessageType[]>) => void
  reducedMotion: boolean
  isLoading: boolean
  briefTranscript: boolean | undefined
  isBriefOnly: boolean
  screen: Screen
  streamingToolUses: StreamingToolUse[]
  setStreamingToolUses: TurnController['setStreamingToolUses']
  submitCount: number
  toolJSX: ToolJSXState | null
  focusedInputDialogRef: React.RefObject<FocusedInputDialog>
  terminal: ReturnType<typeof import('@anthropic/ink').useTerminalNotification>
  addNotification: (notif: Notification) => void
  removeNotification: (key: string) => void
  remoteSessionConfig: RemoteSessionConfig | undefined
  theme: ReturnType<typeof import('@anthropic/ink').useTheme>[0]
  storageV5: ReturnType<
    typeof import('../../context/sessionServices.js').useSessionServices
  >['storageV5']
  readFileState: React.RefObject<FileStateCache>
  bashTools: React.RefObject<Set<string>>
  bashHosts: React.RefObject<Set<string>>
  bashToolsProcessedIdx: React.RefObject<number>
  tipPickedThisTurnRef: React.RefObject<boolean>
  setIsExternalLoading: (value: boolean) => void
  setUserInputOnProcessing: (input: string | undefined) => void
  userInputOnProcessing: string | undefined
  setOutputLimitRecovery: React.Dispatch<
    React.SetStateAction<
      | import('../../components/Spinner/statusKind.js').OutputLimitRecovery
      | null
    >
  >
  tasks: AppState['tasks']
  inProgressToolUseIDs: Set<string>
  viewingAgentTaskId: string | undefined
  hasBlockingOpenDialogs: boolean
  promptQueue: PromptQueueItem[]
  elicitation: AppState['elicitation']
  elicitationCueBehindDraft: ReturnType<typeof getElicitationCueBehindDraft>
  workerSandboxPermissions: AppState['workerSandboxPermissions']
  pendingWorkerRequest: AppState['pendingWorkerRequest']
  swarmStartTimeRef: React.RefObject<number | null>
  swarmBudgetInfoRef: React.RefObject<
    { tokens: number; limit: number; nudges: number } | undefined
  >
}): {
  responseLengthRef: React.RefObject<number>
  compactProgressActiveRef: React.RefObject<boolean>
  compactingHint: string | null
  setCompactingHint: React.Dispatch<React.SetStateAction<string | null>>
  compactingStartTime: number | null
  setCompactingStartTime: React.Dispatch<React.SetStateAction<number | null>>
  apiMetricsRef: React.RefObject<ApiMetricsEntry[]>
  setResponseLength: (f: (prev: number) => number) => void
  showStreamingText: boolean
  streamingDisplayStore: StreamingDisplayStore
  onStreamingText: (f: (current: string | null) => string | null) => void
  hasStreamingText: boolean
  focusFoldHoldsPreview: boolean
  clearStreamingText: () => void
  salvageRef: React.RefObject<SalvageState | null>
  refusalReplacesUuidsRef: React.RefObject<string[] | null>
  displayTransform: ReturnType<typeof createMessageDisplayTransform>
  getStreamingTextRaw: () => string | null
  setLastQueryCompletionTime: React.Dispatch<React.SetStateAction<number>>
  setLastTurnStopTime: React.Dispatch<React.SetStateAction<number>>
  idleReturnController: IdleReturnController
  spinnerMessage: string | null
  setSpinnerMessage: React.Dispatch<React.SetStateAction<string | null>>
  spinnerColor: keyof Theme | null
  setSpinnerColor: (color: keyof Theme | null) => void
  spinnerShimmerColor: keyof Theme | null
  setSpinnerShimmerColor: (shimmer: keyof Theme | null) => void
  retryStatus: RetryStatus | null
  setRetryStatus: (status: RetryStatus | null) => void
  resetLoadingState: () => void
  showSpinner: boolean
  focusedSpinnerRefs: {
    loadingStartTimeRef: { readonly current: number }
    responseLengthRef: { readonly current: number }
    totalPausedMsRef: { readonly current: number }
    pauseStartTimeRef: { current: number | null }
  } | null
  afterReplyText: boolean
  stopHookSpinnerSuffix: string | null
} {
  const {
    store,
    setAppState,
    turnController,
    messageQueue,
    dialogStore,
    messages,
    messagesRef,
    setMessages,
    reducedMotion,
    isLoading,
    briefTranscript,
    isBriefOnly,
    screen,
    streamingToolUses,
    setStreamingToolUses,
    submitCount,
    toolJSX,
    focusedInputDialogRef,
    terminal,
    addNotification,
    removeNotification,
    remoteSessionConfig,
    theme,
    storageV5,
    readFileState,
    bashTools,
    bashHosts,
    bashToolsProcessedIdx,
    tipPickedThisTurnRef,
    setIsExternalLoading,
    setUserInputOnProcessing,
    userInputOnProcessing,
    setOutputLimitRecovery,
    tasks,
    inProgressToolUseIDs,
    viewingAgentTaskId,
    hasBlockingOpenDialogs,
    promptQueue,
    elicitation,
    elicitationCueBehindDraft,
    workerSandboxPermissions,
    pendingWorkerRequest,
    swarmStartTimeRef,
    swarmBudgetInfoRef,
  } = params

  const responseLengthRef = useRef(0)
  turnController.bindResponseLengthRef(responseLengthRef)
  const compactProgressActiveRef = useRef(false)
  const [compactingHint, setCompactingHint] = useState<string | null>(null)
  const [compactingStartTime, setCompactingStartTime] = useState<number | null>(
    null,
  )
  const apiMetricsRef = useRef<ApiMetricsEntry[]>([])
  const setResponseLength = useCallback((f: (prev: number) => number) => {
    const prev = responseLengthRef.current
    responseLengthRef.current = f(prev)
    if (responseLengthRef.current > prev) {
      const entries = apiMetricsRef.current
      if (entries.length > 0) {
        const lastEntry = entries.at(-1)!
        lastEntry.lastTokenTime = Date.now()
        lastEntry.endResponseLength = responseLengthRef.current
      }
    }
  }, [])

  const showStreamingText = !reducedMotion && !process.env.WT_SESSION
  const showStreamingTextRef = useRef(showStreamingText)
  showStreamingTextRef.current = showStreamingText
  const streamingDisplayStore = useMemo(() => createStreamingDisplayStore(), [])
  const streamingFlushBuffer = useMemo(
    () =>
      createStreamingTextFlushBuffer({
        scheduleTimeout: (fn, ms) => {
          const id = setTimeout(fn, ms)
          return () => clearTimeout(id)
        },
        onFlush: raw => {
          streamingDisplayStore.setRaw(raw)
        },
      }),
    [streamingDisplayStore],
  )
  useEffect(() => () => streamingFlushBuffer.dispose(), [streamingFlushBuffer])

  const onStreamingText = useCallback(
    (f: (current: string | null) => string | null) => {
      if (!showStreamingTextRef.current) {
        if (f(streamingFlushBuffer.peek()) === null) {
          streamingFlushBuffer.clear()
        }
        return
      }
      streamingFlushBuffer.apply(f)
    },
    [streamingFlushBuffer],
  )
  const streamingFlags = useSyncExternalStore(
    streamingDisplayStore.subscribe,
    streamingDisplayStore.getFlags,
  )
  const hasStreamingText =
    showStreamingText && (streamingFlags & STREAM_FLAG_DISPLAYED) !== 0
  const focusFoldHoldsPreview = resolveFocusFoldHoldsPreview({
    isLoading,
    briefTranscript: Boolean(briefTranscript),
    screen,
    fullscreen: isFullscreenEnvEnabled(),
    tailBlank: (streamingFlags & STREAM_FLAG_HIDE_TRAILING) !== 0,
    streamingToolUseCount: streamingToolUses.length,
    messages,
  })
  const clearStreamingText = useCallback(() => {
    streamingFlushBuffer.clear()
    streamingDisplayStore.setTransformed(null)
    streamingDisplayStore.setRewrite(null)
  }, [streamingFlushBuffer, streamingDisplayStore])

  const salvageRef = useRef<SalvageState | null>(null)
  const refusalReplacesUuidsRef = useRef<string[] | null>(null)
  const showStreamingTextForTransformRef = useRef(showStreamingText)
  showStreamingTextForTransformRef.current = showStreamingText
  const displayTransform = useMemo(
    () =>
      createMessageDisplayTransform({
        getAppState: () => store.getState(),
        onStreamingDisplay: content => {
          if (!showStreamingTextForTransformRef.current) return
          streamingDisplayStore.setTransformed(content)
        },
        onStreamingRewrite: rewrite => {
          if (!showStreamingTextForTransformRef.current) return
          streamingDisplayStore.setRewrite(rewrite)
        },
        onMessageDisplay: (apiMessageId, content) => {
          const salvage = salvageRef.current
          const merged =
            salvage !== null && salvage.apiMessageId === apiMessageId
              ? mergeSalvagePrefix(salvage.salvageText, content, salvage.exact)
              : content
          if (salvage !== null && salvage.apiMessageId === apiMessageId) {
            salvageRef.current = null
          }
          setAppState(prev => {
            const map = prev.displayedMessageContent ?? {}
            if (map[apiMessageId] === merged) return prev
            return {
              ...prev,
              displayedMessageContent: {
                ...map,
                [apiMessageId]: merged,
              },
            }
          })
        },
      }),
    [store, setAppState, streamingDisplayStore],
  )
  useEffect(() => {
    if (!isLoading && streamingDisplayStore.getState().salvage !== null) {
      streamingDisplayStore.setSalvage(null)
    }
  }, [isLoading, streamingFlags, streamingDisplayStore])

  const getStreamingTextRaw = useCallback(
    () => streamingDisplayStore.getState().raw,
    [streamingDisplayStore],
  )

  const [lastQueryCompletionTime, setLastQueryCompletionTime] = useState(0)
  const [lastTurnStopTime, setLastTurnStopTime] = useState(0)
  const idleReturnTurnSourceRef = useRef<ReturnType<
    typeof createIdleReturnTurnSource
  > | null>(null)
  const [idleReturnController] = useState(() => {
    const source = createIdleReturnTurnSource({
      isLoading,
      lastQueryCompletionTime,
      submitCount,
    })
    idleReturnTurnSourceRef.current = source
    return new IdleReturnController({
      turn: source.turn,
      getMessages: () => messagesRef.current,
      clock: createIdleReturnClock(),
      now: Date.now,
      getLastInteractionTime,
      isDialogOnScreen: () =>
        focusedInputDialogRef.current != null ||
        dialogStore.getState().open.length > 0,
      hasPendingLoopWakeup: hasPendingLoopWakeups,
      hasArmedQuotaAutoResume: isQuotaAutoResumeArmed,
      backgroundAgents: {
        subscribe: store.subscribe,
        getSnapshot: () =>
          Object.values(store.getState().tasks).some(
            t =>
              (t.type === 'local_agent' ||
                t.type === 'remote_agent' ||
                t.type === 'in_process_teammate' ||
                t.type === 'local_workflow') &&
              t.status !== 'completed' &&
              t.status !== 'failed' &&
              t.status !== 'killed' &&
              t.status !== 'paused' &&
              !(
                t.type === 'in_process_teammate' &&
                (t.isIdle || t.identity?.agentId === undefined)
              ) &&
              !(
                t.type === 'remote_agent' &&
                (t.isLongRunning ||
                  t.ultraplanPhase === 'needs_input' ||
                  t.ultraplanPhase === 'plan_ready' ||
                  (t.isUltraplan &&
                    (t as { restoredOnResume?: boolean }).restoredOnResume))
              ),
          ),
      },
      getIdleNotifThresholdMs: () =>
        getGlobalConfig().messageIdleNotifThresholdMs,
      sendIdleNotification: () => {
        void sendNotification(
          {
            message: 'Claude is waiting for your input',
            notificationType: 'idle_prompt',
          },
          terminal,
        )
      },
      addNotification,
      removeNotification,
      hasSeededRemotePrompt:
        remoteSessionConfig?.initialPromptUuid !== undefined,
    })
  })
  useEffect(() => {
    idleReturnController.setLocalOverlayShowing(toolJSX != null)
  }, [idleReturnController, toolJSX])
  useEffect(() => {
    idleReturnTurnSourceRef.current?.publish({
      isLoading,
      lastQueryCompletionTime,
      lastTurnStopTime,
      submitCount,
    })
  }, [isLoading, lastQueryCompletionTime, lastTurnStopTime, submitCount])
  useEffect(() => () => idleReturnController.dispose(), [idleReturnController])
  useIdleUpsellNotification(isLoading, lastQueryCompletionTime)
  usePluginMonitors({ enabled: !isBareMode() })

  const [spinnerMessage, setSpinnerMessage] = useState<string | null>(null)
  const [spinnerColor, setSpinnerColorState] = useState<keyof Theme | null>(
    null,
  )
  const [spinnerShimmerColor, setSpinnerShimmerColorState] = useState<
    keyof Theme | null
  >(null)
  const spinnerColorRef = useRef(spinnerColor)
  spinnerColorRef.current = spinnerColor
  const spinnerShimmerColorRef = useRef(spinnerShimmerColor)
  spinnerShimmerColorRef.current = spinnerShimmerColor
  const setSpinnerColor = useCallback((color: keyof Theme | null) => {
    setSpinnerColorState(color)
    spinnerColorRef.current = color
    try {
      const { leftoverIhrUxe } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/collapseReadSearch.js') as typeof import('../../utils/collapseReadSearch.js')
      leftoverIhrUxe.setSpinnerColors(color, spinnerShimmerColorRef.current)
    } catch {
      // isolation — optional
    }
  }, [])
  const setSpinnerShimmerColor = useCallback((shimmer: keyof Theme | null) => {
    setSpinnerShimmerColorState(shimmer)
    spinnerShimmerColorRef.current = shimmer
    try {
      const { leftoverIhrUxe } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/collapseReadSearch.js') as typeof import('../../utils/collapseReadSearch.js')
      leftoverIhrUxe.setSpinnerColors(spinnerColorRef.current, shimmer)
    } catch {
      // isolation — optional
    }
  }, [])
  const [retryStatus, setRetryStatusState] = useState<RetryStatus | null>(null)
  const setRetryStatus = useCallback((status: RetryStatus | null) => {
    setRetryStatusState(status)
    try {
      const { leftoverIhr } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/collapseReadSearch.js') as typeof import('../../utils/collapseReadSearch.js')
      leftoverIhr.main.setRetryStatus(status)
    } catch {
      // isolation — optional
    }
  }, [])

  const explanationRequestIds = useRef(new Set<string>())
  const absorbExplanationRequests = useCallback(
    (msgs: readonly MessageType[]) => {
      const EXPLANATION_REQUEST_RE =
        /^(?:(?:ok|okay|please|pls|can you|could you|would you),? )*(?:explain|walk me through|help me understand|teach me)\b|^(?:why (?:does|do|is|are|was|were|would|should) (?!you\b|u\b)(?![^.?!]*\b(?:still|again)\b)|how (?:come|does|do (?:these|those)) |what (?:does|do) (?!you\b|u\b|we\b|i\b)|what(?:'s| is) (?:this|that)\b|i (?:don'?t|do not) (?:understand\b|get (?:this|it|why|how|what)\b))/
      for (const msg of msgs) {
        let raw: string | undefined
        if (
          msg.type === 'user' &&
          !msg.isMeta &&
          msg.promptSource !== 'suggestion_accepted' &&
          msg.message
        ) {
          const c = msg.message.content
          raw =
            typeof c === 'string'
              ? c
              : Array.isArray(c)
                ? c
                    .filter(
                      (b): b is { type: 'text'; text: string } =>
                        b.type === 'text',
                    )
                    .map(b => b.text)
                    .join(' ')
                : undefined
        } else if (
          msg.type === 'attachment' &&
          msg.attachment?.type === 'queued_command' &&
          msg.attachment.commandMode === 'prompt' &&
          msg.attachment.isMeta !== true &&
          msg.attachment.inputSource !== 'suggestion_accepted'
        ) {
          const p = msg.attachment.prompt
          raw = typeof p === 'string' ? p : undefined
        }
        if (raw !== undefined) {
          const normalized = raw
            .toLowerCase()
            .replace(/\u2019/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
          if (EXPLANATION_REQUEST_RE.test(normalized)) {
            explanationRequestIds.current.add(msg.uuid)
          }
        }
      }
    },
    [],
  )
  const spinnerTipInputsRef = useRef({ theme, storageV5 })
  spinnerTipInputsRef.current = { theme, storageV5 }
  useEffect(() => {
    const host = getReplDiffHost()
    const slot = {
      context: () => {
        const newMessages = messagesRef.current.slice(
          bashToolsProcessedIdx.current,
        )
        for (const tool of extractBashToolsFromMessages(newMessages)) {
          bashTools.current.add(tool)
        }
        for (const bashHost of extractBashHostsFromMessages(newMessages)) {
          bashHosts.current.add(bashHost)
        }
        absorbExplanationRequests(newMessages)
        bashToolsProcessedIdx.current = messagesRef.current.length
        return {
          theme: spinnerTipInputsRef.current.theme,
          readFileState: readFileState.current,
          bashTools: bashTools.current,
          bashHosts: bashHosts.current,
          explanationRequestCount: explanationRequestIds.current.size,
          session: { host },
          storageV5: spinnerTipInputsRef.current.storageV5,
        }
      },
      storageV5: () => spinnerTipInputsRef.current.storageV5,
      show: (payload: { text: string; label?: string } | undefined) => {
        setAppState(prev =>
          payload === undefined
            ? prev.spinnerTip === undefined
              ? prev
              : { ...prev, spinnerTip: undefined, spinnerTipLabel: undefined }
            : prev.spinnerTip === payload.text &&
                prev.spinnerTipLabel === payload.label
              ? prev
              : {
                  ...prev,
                  spinnerTip: payload.text,
                  spinnerTipLabel: payload.label,
                },
        )
      },
    }
    getSpinnerTipPluginSeat(host).seat(slot)
    return () => {
      getSpinnerTipPluginSeat(host).vacate(slot)
    }
  }, [
    setAppState,
    messagesRef,
    readFileState,
    bashTools,
    bashHosts,
    bashToolsProcessedIdx,
    absorbExplanationRequests,
  ])

  const pickNewSpinnerTip = useCallback(() => {
    if (tipPickedThisTurnRef.current) return
    tipPickedThisTurnRef.current = true
    const newMessages = messagesRef.current.slice(bashToolsProcessedIdx.current)
    for (const tool of extractBashToolsFromMessages(newMessages)) {
      bashTools.current.add(tool)
    }
    for (const host of extractBashHostsFromMessages(newMessages)) {
      bashHosts.current.add(host)
    }
    absorbExplanationRequests(newMessages)
    bashToolsProcessedIdx.current = messagesRef.current.length
    const tipContext = {
      theme,
      readFileState: readFileState.current,
      bashTools: bashTools.current,
      bashHosts: bashHosts.current,
      explanationRequestCount: explanationRequestIds.current.size,
      session: { host: getReplDiffHost() },
      storageV5,
    }
    if (
      isTipsModLoaded() &&
      getSpinnerTipPluginSeat(tipContext.session.host).pickDue()
    ) {
      return
    }
    void getTipToShowOnSpinner(tipContext).then(async tip => {
      const content = tip ? await evaluateTipContent(tip, tipContext) : ''
      if (!content) {
        setAppState(prev => {
          if (prev.spinnerTip === undefined) return prev
          return { ...prev, spinnerTip: undefined, spinnerTipLabel: undefined }
        })
        return
      }
      setAppState(prev => ({
        ...prev,
        spinnerTip: content,
        spinnerTipLabel: tip?.label,
      }))
      if (tip) recordShownTip(tip)
    })
  }, [
    setAppState,
    storageV5,
    theme,
    tipPickedThisTurnRef,
    messagesRef,
    readFileState,
    bashTools,
    bashHosts,
    bashToolsProcessedIdx,
    absorbExplanationRequests,
  ])

  const resetLoadingState = useCallback(() => {
    setIsExternalLoading(false)
    turnController.resetRequestState()
    setUserInputOnProcessing(undefined)
    responseLengthRef.current = 0
    apiMetricsRef.current = []
    clearStreamingText()
    setStreamingToolUses([])
    setSpinnerMessage(null)
    setSpinnerColor(null)
    setSpinnerShimmerColor(null)
    setRetryStatus(null)
    setOutputLimitRecovery(null)
    pickNewSpinnerTip()
    endInteractionSpan()
    try {
      const { leftoverIhr } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/collapseReadSearch.js') as typeof import('../../utils/collapseReadSearch.js')
      leftoverIhr.main.resetOverrides()
      leftoverIhr.main.setMode('responding')
    } catch {
      // isolation — optional
    }
    clearSpeculativeChecks()
  }, [
    turnController,
    pickNewSpinnerTip,
    clearStreamingText,
    setIsExternalLoading,
    setUserInputOnProcessing,
    setStreamingToolUses,
    setSpinnerColor,
    setSpinnerShimmerColor,
    setRetryStatus,
    setOutputLimitRecovery,
  ])

  const hasRunningTeammates = useMemo(
    () => getAllInProcessTeammateTasks(tasks).some(t => t.status === 'running'),
    [tasks],
  )

  useEffect(() => {
    if (!hasRunningTeammates && swarmStartTimeRef.current !== null) {
      const totalMs = performance.now() - swarmStartTimeRef.current
      const deferredBudget = swarmBudgetInfoRef.current
      swarmStartTimeRef.current = null
      swarmBudgetInfoRef.current = undefined
      const pendingWork = countPendingTurnDurationWork({
        tasks: store.getState().tasks,
        queuedCommands: messageQueue.getCommands(),
      })
      setMessages(prev => {
        const lastNonSystem = [...prev]
          .reverse()
          .find(m => m.type !== 'system' && m.type !== 'progress')
        if (
          lastNonSystem?.type === 'assistant' &&
          (lastNonSystem as { isApiErrorMessage?: boolean })
            .isApiErrorMessage === true
        ) {
          return prev
        }
        return [
          ...prev,
          createTurnDurationMessage(
            totalMs,
            deferredBudget,
            count(prev, isLoggableMessage),
            pendingWork.pendingAgents > 0
              ? pendingWork.pendingAgents
              : undefined,
            pendingWork.pendingWorkflows > 0
              ? pendingWork.pendingWorkflows
              : undefined,
          ),
        ]
      })
    }
  }, [
    hasRunningTeammates,
    setMessages,
    store,
    messageQueue,
    swarmStartTimeRef,
    swarmBudgetInfoRef,
  ])

  const onlySleepToolActive = useMemo(() => {
    const lastAssistant = messages.findLast(m => m.type === 'assistant')
    if (lastAssistant?.type !== 'assistant') return false
    const content = lastAssistant.message?.content
    const contentArray = Array.isArray(content) ? content : []
    const inProgressToolUses = contentArray.filter(
      (b): b is ContentBlock & { type: 'tool_use'; id: string } =>
        b.type === 'tool_use' &&
        inProgressToolUseIDs.has((b as { id: string }).id),
    )
    return (
      inProgressToolUses.length > 0 &&
      inProgressToolUses.every(
        b => b.type === 'tool_use' && b.name === SLEEP_TOOL_NAME,
      )
    )
  }, [messages, inProgressToolUseIDs])

  const viewedAgentRetryStatus = useSyncExternalStore(
    leftoverIhrSubscribe,
    () =>
      viewingAgentTaskId
        ? leftoverIhrSlice(viewingAgentTaskId).retryStatus
        : null,
    () => null,
  )
  const activeRetryStatus = viewingAgentTaskId
    ? viewedAgentRetryStatus
    : retryStatus

  const viewedTaskForSpinner = viewingAgentTaskId
    ? tasks[viewingAgentTaskId]
    : undefined
  const viewedTeammateForSpinner =
    viewedTaskForSpinner && isInProcessTeammateTask(viewedTaskForSpinner)
      ? viewedTaskForSpinner
      : undefined
  const viewedLocalAgentForSpinner =
    !viewedTeammateForSpinner &&
    viewedTaskForSpinner &&
    isLocalAgentTask(viewedTaskForSpinner)
      ? viewedTaskForSpinner
      : undefined
  const isViewingSubagentForSpinner = Boolean(
    viewedTeammateForSpinner || viewedLocalAgentForSpinner,
  )
  const focusedSpinnerActive = viewedTeammateForSpinner
    ? viewedTeammateForSpinner.status === 'running'
    : viewedLocalAgentForSpinner
      ? viewedLocalAgentForSpinner.status === 'running' &&
        !viewedLocalAgentForSpinner.isIdle
      : isLoading ||
        Boolean(userInputOnProcessing) ||
        hasRunningTeammates ||
        messageQueue.getMainThreadLength() > 0

  const showSpinner =
    (!toolJSX || toolJSX.showSpinner === true) &&
    !hasBlockingOpenDialogs &&
    promptQueue.length === 0 &&
    (elicitation.queue.length === 0 ||
      Boolean(elicitationCueBehindDraft?.keepSpinnerRunning)) &&
    workerSandboxPermissions.queue.length === 0 &&
    focusedSpinnerActive &&
    !pendingWorkerRequest &&
    (isViewingSubagentForSpinner || !onlySleepToolActive) &&
    (isViewingSubagentForSpinner ||
      !hasStreamingText ||
      activeRetryStatus !== null ||
      (streamingFlags & STREAM_FLAG_HIDE_TRAILING) !== 0 ||
      isBriefOnly ||
      focusFoldHoldsPreview)

  const focusedSpinnerRefs = useMemo(() => {
    if (!viewingAgentTaskId) return null
    const id = viewingAgentTaskId
    return {
      loadingStartTimeRef: {
        get current(): number {
          const st = store.getState()
          const wallStart =
            st.transcripts?.[id]?.turnStartTime ??
            st.tasks[id]?.startTime ??
            Date.now()
          return performance.now() - Math.max(0, Date.now() - wallStart)
        },
      },
      responseLengthRef: {
        get current(): number {
          const st = store.getState()
          const t = st.tasks[id]
          const tokens =
            t && 'progress' in t ? (t.progress?.tokenCount ?? 0) : 0
          return tokens * 4
        },
      },
      totalPausedMsRef: {
        get current(): number {
          return store.getState().transcripts?.[id]?.totalPausedMs ?? 0
        },
      },
      pauseStartTimeRef: { current: null as number | null },
    }
  }, [store, viewingAgentTaskId])

  const afterReplyText = useMemo(() => {
    if (isViewingSubagentForSpinner) return false
    if (hasStreamingText) return true
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (!m) continue
      if (m.type === 'user') return false
      if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
        if (
          m.message.content.some(
            b => b.type === 'text' && b.text.trim().length > 0,
          )
        ) {
          return true
        }
      }
    }
    return false
  }, [isViewingSubagentForSpinner, hasStreamingText, messages])

  const stopHookSpinnerSuffix = useMemo(
    () => computeStopHookSpinnerSuffix(messages, isLoading),
    [messages, isLoading],
  )

  return {
    responseLengthRef,
    compactProgressActiveRef,
    compactingHint,
    setCompactingHint,
    compactingStartTime,
    setCompactingStartTime,
    apiMetricsRef,
    setResponseLength,
    showStreamingText,
    streamingDisplayStore,
    onStreamingText,
    hasStreamingText,
    focusFoldHoldsPreview,
    clearStreamingText,
    salvageRef,
    refusalReplacesUuidsRef,
    displayTransform,
    getStreamingTextRaw,
    setLastQueryCompletionTime,
    setLastTurnStopTime,
    idleReturnController,
    spinnerMessage,
    setSpinnerMessage,
    spinnerColor,
    setSpinnerColor,
    spinnerShimmerColor,
    setSpinnerShimmerColor,
    retryStatus,
    setRetryStatus,
    resetLoadingState,
    showSpinner,
    focusedSpinnerRefs,
    afterReplyText,
    stopHookSpinnerSuffix,
  }
}
