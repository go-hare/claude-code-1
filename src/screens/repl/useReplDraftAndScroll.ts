import { type ScrollBoxHandle, useClock } from '@anthropic/ink'
import { feature } from 'bun:bundle'
import type * as React from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useQuotaAutoResume } from 'src/hooks/notifs/useQuotaAutoResume.js'
import { useAwaySummary } from 'src/hooks/useAwaySummary.js'
import { setMainLoopBusy } from '../../bootstrap/state.js'
import { computeUnseenDivider } from '../../components/FullscreenLayout.js'
import type {
  MessageActionsNav,
  MessageActionsState,
} from '../../components/messageActions.js'
import { consumePendingAutoDefaultNudgeDraft } from '../../dialog/dialogs/AutoDefaultNudgeDialog.js'
import {
  AUTO_DEFAULT_NUDGE_KIND,
  type DialogStore,
} from '../../dialog/index.js'
import { useAssistantHistory } from '../../hooks/useAssistantHistory.js'
import { useDeferredHookMessages } from '../../hooks/useDeferredHookMessages.js'
import type { RemoteSessionConfig } from '../../remote/RemoteSessionManager.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Store } from '../../state/store.js'
import type {
  HookResultMessage,
  Message as MessageType,
} from '../../types/message.js'
import type { PromptInputMode } from '../../types/textInputTypes.js'
import { leftoverIhr } from '../../utils/collapseReadSearch.js'
import { consumeEarlyInput } from '../../utils/earlyInput.js'
import { QueuedNowLowLatency } from '../../utils/foregroundToolCalls.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { joinHandedBackPrompt } from '../../utils/handlePromptSubmit.js'
import { isHumanTurn } from '../../utils/messagePredicates.js'
import type {
  MessageQueueInstance,
  SetAppState,
} from '../../utils/messageQueueManager.js'
import {
  createPromptDraftController,
  type PromptDraftController,
} from '../../utils/promptDraftController.js'
import {
  getPromptInputStoreValue,
  setPromptInputStoreValue,
  subscribePromptInputCursorStore,
} from '../../utils/promptInputCursorStore.js'
import type { QueryGuard } from '../../utils/QueryGuard.js'
import { ScrollPin } from '../../utils/scrollPin.js'
import { getBootstrapSession } from '../../utils/sessionHost.js'
import type { TaskRegistry } from '../../utils/taskRegistry.js'
import { HISTORY_STUB, SUGGEST_BG_PR_NOOP } from './replHelpers.js'
import type { TranscriptProjection } from './TranscriptProjection.js'
import type { TurnController } from './TurnController.js'
import type { InsertTextHandle, Screen, StashedPrompt } from './types.js'

/**
 * Owns `ScrollPin`, subscribable transcript projection (`messages`,
 * `messagesRef`, `setMessages`), `QueuedNowLowLatency`, turn-start tracking,
 * `PromptDraftController` (draft value/mode/stash), and message-actions cursor.
 */
export function useReplDraftAndScroll(params: {
  store: Store<AppState>
  setAppState: SetAppState
  transcriptProjection: TranscriptProjection
  turnController: TurnController
  queryGuard: QueryGuard
  messageQueue: MessageQueueInstance
  dialogStore: DialogStore
  taskRegistry: TaskRegistry
  isBriefOnly: boolean
  briefTranscript: boolean | undefined
  screen: Screen
  disableVirtualScroll: boolean
  dumpMode: boolean
  isLoading: boolean
  userInputOnProcessing: string | undefined
  remoteSessionConfig: RemoteSessionConfig | undefined
  buddyEnabled: boolean
  pendingHookMessages: Promise<HookResultMessage[]> | undefined
  topDialogKind: string | undefined
}): {
  scrollPin: ScrollPin
  scrollViewport: ScrollPin['viewport']
  modalScrollViewport: ScrollPin['modalViewport']
  messages: MessageType[]
  messagesRef: React.RefObject<MessageType[]>
  setMessages: (action: React.SetStateAction<MessageType[]>) => void
  queuedNowLowLatencyHost: QueuedNowLowLatency
  turnStartRef: React.RefObject<{ length: number; uuid?: string } | null>
  markIdleForkMidTurn: () => void
  setAbortControllerForQuery: (ac: AbortController | null) => void
  onMessagesRowsDrawn: (drawnMessages: readonly MessageType[]) => void
  unseenDivider: ReturnType<ScrollPin['getSnapshot']>['unseenDivider']
  cursor: MessageActionsState | null
  setCursor: React.Dispatch<React.SetStateAction<MessageActionsState | null>>
  cursorNavRef: React.RefObject<MessageActionsNav | null>
  repinScroll: (force?: boolean, reason?: string) => void
  repinScrollRef: React.RefObject<(force?: boolean, reason?: string) => void>
  composedOnScroll: (sticky: boolean, handle: ScrollBoxHandle) => void
  draftController: PromptDraftController
  inputValueRef: React.RefObject<string>
  promptEmpty: boolean
  hasDraft: boolean
  inputValue: string
  insertTextRef: React.RefObject<InsertTextHandle | null>
  setInputValue: (value: string) => void
  setInputValueRaw: (value: string) => void
  inputMode: PromptInputMode
  inputModeRef: React.RefObject<PromptInputMode>
  setInputMode: (next: React.SetStateAction<PromptInputMode>) => void
  restoreHandedBackPrompt: (text: string) => void
  stashedPrompt: StashedPrompt | undefined
  stashedPromptRef: React.RefObject<StashedPrompt | undefined>
  setStashedPrompt: React.Dispatch<
    React.SetStateAction<StashedPrompt | undefined>
  >
} {
  const {
    store,
    setAppState,
    transcriptProjection,
    turnController,
    queryGuard,
    messageQueue,
    dialogStore,
    taskRegistry,
    isBriefOnly,
    briefTranscript,
    screen,
    disableVirtualScroll,
    dumpMode,
    isLoading,
    userInputOnProcessing,
    remoteSessionConfig,
    buddyEnabled,
    pendingHookMessages,
    topDialogKind,
  } = params

  const isBriefDividerModeRef = useRef(false)
  isBriefDividerModeRef.current = Boolean(isBriefOnly || briefTranscript)

  const scrollPinRef = useRef<ScrollPin | null>(null)
  if (scrollPinRef.current === null) {
    scrollPinRef.current = new ScrollPin({
      transcript: transcriptProjection,
      computeDivider: (msgs, idx) =>
        computeUnseenDivider(
          msgs as MessageType[],
          idx,
          isBriefDividerModeRef.current,
        ),
    })
  }
  const scrollPin = scrollPinRef.current
  useEffect(() => () => scrollPin.dispose(), [scrollPin])
  const scrollViewport = scrollPin.viewport
  const modalScrollViewport = scrollPin.modalViewport

  const subscribeFullTranscript =
    screen === 'transcript' &&
    (!isFullscreenEnvEnabled() || disableVirtualScroll || dumpMode)
  const messages = useSyncExternalStore(
    subscribeFullTranscript
      ? transcriptProjection.subscribe
      : transcriptProjection.subscribeNonProgress,
    subscribeFullTranscript
      ? transcriptProjection.getSnapshot
      : transcriptProjection.getNonProgressSnapshot,
  )
  const messagesRef = useRef(transcriptProjection.getCurrent())
  messagesRef.current = transcriptProjection.getCurrent()
  useEffect(
    () =>
      transcriptProjection.subscribe(() => {
        messagesRef.current = transcriptProjection.getCurrent()
      }),
    [transcriptProjection],
  )
  const setMessages = useCallback(
    (action: React.SetStateAction<MessageType[]>) => {
      transcriptProjection.setMessages(action)
      messagesRef.current = transcriptProjection.getCurrent()
    },
    [transcriptProjection],
  )

  const clock = useClock()
  const queuedNowLowLatencyHost = useMemo(
    () =>
      new QueuedNowLowLatency({
        turn: {
          guard: queryGuard,
          get abortController() {
            return turnController.abortController
          },
          interruptForSubmit: () => {
            const ac = turnController.abortController
            if (!ac || ac.signal.aborted) return false
            ac.abort('interrupt')
            return true
          },
          stream: {
            get isMainRequestAwaitingResponse() {
              return turnController.isMainRequestAwaitingResponse
            },
            get isMainResponseStreaming() {
              return turnController.isMainResponseStreaming
            },
          },
        },
        store,
        session: getBootstrapSession(),
        spinnerStore: leftoverIhr,
        dialogStore,
        messageQueue: {
          getCommandQueueSnapshot: messageQueue.getSnapshot,
          getCommandQueue: () => messageQueue.getCommands(),
          subscribe: messageQueue.subscribe,
          isFoldInFlight: (uuid: string) => messageQueue.isFoldInFlight(uuid),
          isMidTurnFoldSuspended: () => messageQueue.isMidTurnFoldSuspended(),
          promoteToNow: (uuid: string) => messageQueue.promoteToNow(uuid),
          demoteFromNow: (uuid: string, raisedFrom) =>
            messageQueue.demoteFromNow(uuid, raisedFrom),
        },
        transcript: { getSnapshot: () => messagesRef.current },
        clock,
        taskRegistry,
        getAppState: () => store.getState(),
        setAppState,
      }),
    [
      store,
      setAppState,
      taskRegistry,
      queryGuard,
      dialogStore,
      clock,
      messageQueue,
      turnController,
    ],
  )
  useEffect(
    () => () => queuedNowLowLatencyHost.dispose(),
    [queuedNowLowLatencyHost],
  )

  const turnStartRef = useRef<{ length: number; uuid?: string } | null>(null)
  const markTurnStart = useCallback(() => {
    const msgs = messagesRef.current
    const last = msgs[msgs.length - 1] as { uuid?: string } | undefined
    turnStartRef.current = last
      ? { length: msgs.length, uuid: last.uuid }
      : null
  }, [])
  const markIdleForkMidTurn = markTurnStart
  const setAbortController = turnController.setAbortController
  const setAbortControllerForQuery = useCallback(
    (ac: AbortController | null) => {
      if (ac) markTurnStart()
      setAbortController(ac)
    },
    [markTurnStart, setAbortController],
  )

  const mainThreadQueueLengthForBusy = useSyncExternalStore(
    messageQueue.subscribe,
    () => messageQueue.getMainThreadLength(),
  )
  useEffect(() => {
    setMainLoopBusy(
      isLoading ||
        Boolean(userInputOnProcessing) ||
        mainThreadQueueLengthForBusy > 0,
    )
  }, [isLoading, userInputOnProcessing, mainThreadQueueLengthForBusy])

  const onMessagesRowsDrawn = useCallback(
    (drawnMessages: readonly MessageType[]) => {
      scrollPin.setRenderedLength(drawnMessages.length)
    },
    [scrollPin],
  )
  scrollPin.setReplyStreaming(isLoading)
  const scrollPinSnapshot = useSyncExternalStore(
    scrollPin.subscribe,
    scrollPin.getSnapshot,
  )
  const unseenDivider = scrollPinSnapshot.unseenDivider
  if (feature('AWAY_SUMMARY')) {
    useAwaySummary(messages, setMessages, isLoading)
  }
  useQuotaAutoResume({ isLoading, setMessages })

  const [cursor, setCursor] = useState<MessageActionsState | null>(null)
  const cursorNavRef = useRef<MessageActionsNav | null>(null)
  const repinScroll = useCallback(
    (force = false, reason = '?') => {
      scrollPin.repin(force, reason)
      setCursor(null)
    },
    [scrollPin],
  )
  const lastMsg = messages.at(-1)
  const lastMsgIsHuman = lastMsg != null && isHumanTurn(lastMsg)
  useEffect(() => {
    if (!lastMsgIsHuman || !lastMsg) return
    scrollPin.onUserRowLanded(lastMsg)
  }, [lastMsgIsHuman, lastMsg, scrollPin])

  const assistantHistoryResult = useAssistantHistory({
    config: remoteSessionConfig,
    setMessages,
    scrollViewport,
    onPrepend: scrollPin.shiftDivider,
  })
  const { maybeLoadOlder } = feature('KAIROS')
    ? assistantHistoryResult
    : HISTORY_STUB
  const composedOnScroll = useCallback(
    (sticky: boolean, handle: ScrollBoxHandle) => {
      scrollPin.onUserScroll(sticky, handle)
      if (!sticky) {
        if (feature('KAIROS')) maybeLoadOlder(handle)
        if (buddyEnabled) {
          setAppState(prev =>
            prev.companionReaction === undefined
              ? prev
              : { ...prev, companionReaction: undefined },
          )
        }
      }
    },
    [scrollPin, maybeLoadOlder, buddyEnabled, setAppState],
  )

  const awaitPendingHooks = useDeferredHookMessages(
    pendingHookMessages,
    setMessages,
  )
  turnController.bindSessionStartHooks(awaitPendingHooks)

  const trySuggestBgPRIntercept = SUGGEST_BG_PR_NOOP
  const inputValueRef = useRef(getPromptInputStoreValue())
  const draftControllerRef = useRef<PromptDraftController | null>(null)
  const repinScrollRef = useRef(repinScroll)
  repinScrollRef.current = repinScroll
  const trySuggestBgPRInterceptRef = useRef(trySuggestBgPRIntercept)
  trySuggestBgPRInterceptRef.current = trySuggestBgPRIntercept
  if (draftControllerRef.current === null) {
    const early = consumeEarlyInput()
    if (early !== '') {
      setPromptInputStoreValue(early)
      inputValueRef.current = early
    }
    draftControllerRef.current = createPromptDraftController({
      rewriteEdit: (next, prev) => {
        if (trySuggestBgPRInterceptRef.current(prev, next)) return prev
        return next
      },
      onEdit: (next, prev) => {
        scrollPin.onPromptEdit(next, prev)
        inputValueRef.current = next
      },
    })
  }
  const draftController = draftControllerRef.current
  useEffect(() => () => draftController.dispose(), [draftController])
  useEffect(() => {
    inputValueRef.current = draftController.value
    return draftController.subscribe(() => {
      inputValueRef.current = draftController.value
    })
  }, [draftController])

  useEffect(() => {
    if (topDialogKind === AUTO_DEFAULT_NUDGE_KIND) return
    const strayDraft = consumePendingAutoDefaultNudgeDraft()
    if (strayDraft.length > 0) {
      const current = draftController.value
      draftController.setValueRaw(
        current ? `${current}${strayDraft}` : strayDraft,
      )
    }
  }, [topDialogKind, draftController])

  const [promptEmpty, setPromptEmpty] = useState(
    () => getPromptInputStoreValue() === '',
  )
  useEffect(() => {
    return subscribePromptInputCursorStore(() => {
      const empty = getPromptInputStoreValue() === ''
      setPromptEmpty(prev => (prev === empty ? prev : empty))
    })
  }, [])
  const hasDraft = !promptEmpty
  const inputValue = hasDraft ? getPromptInputStoreValue() : ''
  const insertTextRef = useRef<InsertTextHandle | null>(null)
  const setInputValue = useCallback(
    (value: string) => {
      if (trySuggestBgPRIntercept(inputValueRef.current, value)) return
      inputValueRef.current = value
      draftController.setValue(value)
    },
    [draftController, trySuggestBgPRIntercept],
  )
  const setInputValueRaw = useCallback(
    (value: string) => {
      inputValueRef.current = value
      draftController.setValueRaw(value)
    },
    [draftController],
  )

  const [inputMode, setInputModeRaw] = useState<PromptInputMode>('prompt')
  const inputModeRef = useRef<PromptInputMode>('prompt')
  inputModeRef.current = inputMode
  const setInputMode = useCallback(
    (next: React.SetStateAction<PromptInputMode>) => {
      const resolved =
        typeof next === 'function' ? next(inputModeRef.current) : next
      inputModeRef.current = resolved
      draftController.setMode(resolved)
      setInputModeRaw(resolved)
    },
    [draftController],
  )
  const restoreHandedBackPrompt = useCallback(
    (text: string) => {
      setInputMode('prompt')
      setInputValue(joinHandedBackPrompt(inputValueRef.current, text))
    },
    [setInputMode, setInputValue],
  )

  const [stashedPrompt, setStashedPromptRaw] = useState<
    StashedPrompt | undefined
  >()
  const stashedPromptRef = useRef(stashedPrompt)
  stashedPromptRef.current = stashedPrompt
  const setStashedPrompt: React.Dispatch<
    React.SetStateAction<StashedPrompt | undefined>
  > = useCallback(next => {
    const resolved =
      typeof next === 'function' ? next(stashedPromptRef.current) : next
    stashedPromptRef.current = resolved
    setStashedPromptRaw(resolved)
  }, [])

  return {
    scrollPin,
    scrollViewport,
    modalScrollViewport,
    messages,
    messagesRef,
    setMessages,
    queuedNowLowLatencyHost,
    turnStartRef,
    markIdleForkMidTurn,
    setAbortControllerForQuery,
    onMessagesRowsDrawn,
    unseenDivider,
    cursor,
    setCursor,
    cursorNavRef,
    repinScroll,
    repinScrollRef,
    composedOnScroll,
    draftController,
    inputValueRef,
    promptEmpty,
    hasDraft,
    inputValue,
    insertTextRef,
    setInputValue,
    setInputValueRaw,
    inputMode,
    inputModeRef,
    setInputMode,
    restoreHandedBackPrompt,
    stashedPrompt,
    stashedPromptRef,
    setStashedPrompt,
  }
}
