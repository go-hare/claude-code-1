import { feature } from 'bun:bundle'
import type * as React from 'react'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  setMainLoopBusy,
  snapshotOutputTokensForTurn,
} from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import type { SpinnerMode } from '../../components/Spinner.js'
import type { Notification } from '../../context/notifications.js'
import {
  type DialogStore,
  isPermissionPromptDialog,
  setPermissionDenyQueuePop,
} from '../../dialog/index.js'
import type { HostEngine } from '../../engine/hostEngine.js'
import { clearPermissionConfirmQueue } from '../../hooks/toolPermission/PermissionContext.js'
import type { CancelRequestHandler } from '../../hooks/useCancelRequest.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { IDESelection } from '../../hooks/useIdeSelection.js'
import { useQueueProcessor } from '../../hooks/useQueueProcessor.js'
import { isCodeModeEnabled } from '../../services/codeMode/optIn.js'
import type { Store } from '../../state/store.js'
import type { Message as MessageType } from '../../types/message.js'
import type {
  PromptInputMode,
  QueuedCommand,
  VimMode,
} from '../../types/textInputTypes.js'
import type { PastedContent } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  detachedToolCallAbort,
  getDetachedToolCallSnapshot,
  stopRunningDetachedToolCalls,
  subscribeDetachedToolCalls,
} from '../../utils/detachedToolCallStore.js'
import type { EffortValue } from '../../utils/effort.js'
import { LEFT_ARROW_STOPPED_TURN_TOAST } from '../../utils/leftArrowConfirm.js'
import type {
  MessageQueueInstance,
  SetAppState,
} from '../../utils/messageQueueManager.js'
import {
  createAgentsKilledMessage,
  createAssistantMessage,
} from '../../utils/messages.js'
import { applyPollEventDeliveryGuard } from '../../utils/permissions/permissionSetup.js'
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js'
import { getQuerySourceForREPL } from '../../utils/promptCategory.js'
import type { QueryGuard } from '../../utils/QueryGuard.js'
import type { StreamingDisplayStore } from '../../utils/streamingTextStore.js'
import { getIdleCompactionRunner } from './idleCompaction.js'
import type { SubmitController } from './SubmitController.js'
import type { TurnController } from './TurnController.js'
import type { ViewController } from './ViewController.js'
import type {
  FocusedInputDialog,
  LeftArrowDeferArm,
  PromptQueueItem,
  SalvageState,
  Screen,
  SetToolJSXArgs,
  TipNonGoldOverlay,
  ToolJSXState,
} from './types.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../proactive/index.js')
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

const LOCAL_JSX_CLOSE_CANCEL_GRACE_MS = 500

/**
 * Manages cancellation (`onCancel` + stop-wait forceEnd timer), queue pop on
 * cancel, `executeQueuedInput`, `useQueueProcessor`, and `handleIncomingPrompt`.
 */
export function useReplCancelAndQueue(params: {
  setAppState: SetAppState
  messageQueue: MessageQueueInstance
  turnController: TurnController
  submitController: SubmitController
  queryGuard: QueryGuard
  hostEngine: HostEngine
  dialogStore: DialogStore
  handOverInFlight: Store<boolean>
  messagesRef: React.RefObject<MessageType[]>
  setMessages: (action: React.SetStateAction<MessageType[]>) => void
  inputValueRef: React.RefObject<string>
  promptEmpty: boolean
  setInputValue: (value: string) => void
  setInputMode: (next: React.SetStateAction<PromptInputMode>) => void
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  setUserInputOnProcessing: (input: string | undefined) => void
  userInputOnProcessing: string | undefined
  setToolJSX: (args: SetToolJSXArgs) => void
  setAbortController: (ac: AbortController | null) => void
  setAbortControllerForQuery: (ac: AbortController | null) => void
  abortController: AbortController | null
  isLoading: boolean
  streamMode: SpinnerMode
  focusedInputDialog: FocusedInputDialog
  tipOverlay: TipNonGoldOverlay
  topDialogKind: string | undefined
  isDialogChromeVisible: boolean
  toolJSX: ToolJSXState | null
  isShowingLocalJSXCommand: boolean
  isMessageSelectorVisible: boolean
  showBashesDialog: boolean | string
  screen: Screen
  vimMode: VimMode
  isSearchingHistory: boolean
  isHelpOpen: boolean
  inputMode: PromptInputMode
  toolUseConfirmQueue: ToolUseConfirm[]
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>
  promptQueue: PromptQueueItem[]
  setPromptQueue: React.Dispatch<React.SetStateAction<PromptQueueItem[]>>
  activeRemote: { isRemoteMode: boolean; cancelRequest: () => void }
  localJSXClosedAtRef: React.RefObject<number>
  leftArrowDeferRef: React.RefObject<LeftArrowDeferArm | null>
  codeModeInterruptedByEscRef: React.RefObject<boolean>
  setLastTurnStopTime: React.Dispatch<React.SetStateAction<number>>
  resetLoadingState: () => void
  streamingDisplayStore: StreamingDisplayStore
  salvageRef: React.RefObject<SalvageState | null>
  refusalReplacesUuidsRef: React.RefObject<string[] | null>
  sendBridgeResultRef: React.RefObject<() => void>
  mrOnTurnComplete: ReturnType<
    typeof import('../../moreright/useMoreRight.js').useMoreRight
  >['onTurnComplete']
  addNotification: (notif: Notification) => void
  commands: Command[]
  mainLoopModel: string
  ideSelection: IDESelection | undefined
  getToolUseContext: (
    messages: MessageType[],
    newMessages: MessageType[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext
  onQuery: (
    newMessages: MessageType[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModelParam: string,
    onBeforeQueryCallback?: (
      input: string,
      newMessages: MessageType[],
    ) => Promise<boolean>,
    input?: string,
    effort?: EffortValue,
    stopHookActive?: boolean,
    clientPlatform?: string,
    additionalDisallowedTools?: string[],
  ) => Promise<boolean>
  onBeforeQuery:
    | ((input: string, newMessages: MessageType[]) => Promise<boolean>)
    | undefined
  canUseTool: CanUseToolFn
  consumeIdeSelection: ViewController['consumeIdeSelection']
  recordIdeSelectionConsumedBy: ViewController['recordIdeSelectionConsumedBy']
  restoreIdeSelectionConsumedBy: ViewController['restoreIdeSelectionConsumedBy']
  restoreHandedBackPrompt: (text: string) => void
  activeScheduledTurnRef: React.RefObject<{
    isScheduledTask: true
    isLoop: boolean
  } | null>
  abortInFlightCompaction: () => void
}): {
  onCancel: () => void
  handleQueuedCommandOnCancel: () => void
  cancelRequestProps: React.ComponentProps<typeof CancelRequestHandler>
  executeQueuedInput: (queuedCommands: QueuedCommand[]) => Promise<void>
  handleIncomingPrompt: (
    input: string | QueuedCommand,
    options?: { isMeta?: boolean },
  ) => boolean
} {
  const {
    setAppState,
    messageQueue,
    turnController,
    submitController,
    queryGuard,
    hostEngine,
    dialogStore,
    handOverInFlight,
    messagesRef,
    setMessages,
    inputValueRef,
    promptEmpty,
    setInputValue,
    setInputMode,
    setPastedContents,
    setUserInputOnProcessing,
    userInputOnProcessing,
    setToolJSX,
    setAbortController,
    setAbortControllerForQuery,
    abortController,
    isLoading,
    streamMode,
    focusedInputDialog,
    tipOverlay,
    topDialogKind,
    isDialogChromeVisible,
    toolJSX,
    isShowingLocalJSXCommand,
    isMessageSelectorVisible,
    showBashesDialog,
    screen,
    vimMode,
    isSearchingHistory,
    isHelpOpen,
    inputMode,
    toolUseConfirmQueue,
    setToolUseConfirmQueue,
    promptQueue,
    setPromptQueue,
    activeRemote,
    localJSXClosedAtRef,
    leftArrowDeferRef,
    codeModeInterruptedByEscRef,
    setLastTurnStopTime,
    resetLoadingState,
    streamingDisplayStore,
    salvageRef,
    refusalReplacesUuidsRef,
    sendBridgeResultRef,
    mrOnTurnComplete,
    addNotification,
    commands,
    mainLoopModel,
    ideSelection,
    getToolUseContext,
    onQuery,
    onBeforeQuery,
    canUseTool,
    consumeIdeSelection,
    recordIdeSelectionConsumedBy,
    restoreIdeSelectionConsumedBy,
    restoreHandedBackPrompt,
    activeScheduledTurnRef,
    abortInFlightCompaction,
  } = params

  const cancelForceEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const clearCancelForceEndTimer = useCallback(() => {
    if (cancelForceEndTimerRef.current !== null) {
      clearTimeout(cancelForceEndTimerRef.current)
      cancelForceEndTimerRef.current = null
    }
  }, [])
  useEffect(() => {
    const unsub = queryGuard.subscribe(() => {
      if (!queryGuard.isRunning) {
        clearCancelForceEndTimer()
      }
    })
    return () => {
      unsub()
      clearCancelForceEndTimer()
    }
  }, [queryGuard, clearCancelForceEndTimer])

  function onCancel() {
    const currentAc = turnController.abortController
    if (focusedInputDialog === 'elicitation') {
      return
    }

    if (
      localJSXClosedAtRef.current !== 0 &&
      Date.now() - localJSXClosedAtRef.current < LOCAL_JSX_CLOSE_CANCEL_GRACE_MS
    ) {
      localJSXClosedAtRef.current = 0
      logForDebugging('[onCancel] suppressed: local-jsx panel just dismissed')
      return
    }
    localJSXClosedAtRef.current = 0

    const deferArm = leftArrowDeferRef.current
    if (deferArm) {
      deferArm.clearCapTimer()
      leftArrowDeferRef.current = null
      addNotification({
        key: 'left-arrow-defer',
        text: LEFT_ARROW_STOPPED_TURN_TOAST,
        color: 'warning',
        priority: 'immediate',
      })
    }

    logForDebugging(
      `[onCancel] focusedInputDialog=${focusedInputDialog} streamMode=${streamMode}`,
    )
    setLastTurnStopTime(Date.now())
    if (isCodeModeEnabled() && (isLoading || turnController.abortController)) {
      codeModeInterruptedByEscRef.current = true
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { cancelLoopWakeupsOnUserAbort } =
        require('../../utils/loopDynamic.js') as typeof import('../../utils/loopDynamic.js')
      cancelLoopWakeupsOnUserAbort('user_abort')
    } catch {
      // loopDynamic may be unavailable in partial test mocks
    }

    if (feature('PROACTIVE') || feature('KAIROS')) {
      proactiveModule?.pauseProactive()
    }

    abortInFlightCompaction()
    getIdleCompactionRunner().clear()
    const hasLocalRunningTurn = Boolean(
      currentAc && !activeRemote.isRemoteMode && queryGuard.isRunning,
    )
    if (hasLocalRunningTurn) {
      const cancelGeneration = queryGuard.generation
      clearCancelForceEndTimer()
      cancelForceEndTimerRef.current = setTimeout(() => {
        cancelForceEndTimerRef.current = null
        if (
          queryGuard.isRunning &&
          queryGuard.generation === cancelGeneration
        ) {
          logForDebugging(
            '[onCancel] stop-wait timeout reached; forcing queryGuard end',
          )
          queryGuard.forceEnd()
          setMainLoopBusy(
            Boolean(userInputOnProcessing) ||
              messageQueue.getMainThreadLength() > 0,
          )
          sendBridgeResultRef.current()
          void mrOnTurnComplete(messagesRef.current, true)
        }
      }, 10_000)
      cancelForceEndTimerRef.current.unref?.()
    } else {
      clearCancelForceEndTimer()
      queryGuard.forceEnd()
      setMainLoopBusy(
        Boolean(userInputOnProcessing) ||
          messageQueue.getMainThreadLength() > 0,
      )
    }

    const liveTurnSnapshot = turnController.getSnapshot()
    const thinkingPartial = liveTurnSnapshot.streamingThinking?.thinking?.trim()
    if (thinkingPartial && liveTurnSnapshot.streamMode === 'thinking') {
      setMessages(prev => [
        ...prev,
        createAssistantMessage({
          content: [
            {
              type: 'thinking',
              thinking: thinkingPartial,
              signature: '',
            },
          ],
          isVirtual: true,
        }),
      ])
      turnController.setStreamingThinking(null)
    }

    resetLoadingState()

    if (feature('TOKEN_BUDGET')) {
      snapshotOutputTokensForTurn(null)
    }

    if (isPermissionPromptDialog(topDialogKind)) {
      toolUseConfirmQueue[0]?.onAbort()
      if (!currentAc?.signal.aborted) {
        currentAc?.abort('user-cancel')
      }
      clearPermissionConfirmQueue(setToolUseConfirmQueue, dialogStore)
    } else if (tipOverlay === 'prompt' || promptQueue.length > 0) {
      for (const item of promptQueue) {
        item.reject(new Error('Prompt cancelled by user'))
      }
      setPromptQueue([])
      currentAc?.abort('user-cancel')
    } else if (activeRemote.isRemoteMode) {
      activeRemote.cancelRequest()
    } else {
      currentAc?.abort('user-cancel')
    }
    if (!activeRemote.isRemoteMode) {
      void hostEngine.interrupt('user-cancel')
    }
    for (const [id, entry] of getDetachedToolCallSnapshot()) {
      if (entry.status === 'running' && !entry.stopRequested) {
        detachedToolCallAbort(id, 'user-cancel')
      }
    }
    stopRunningDetachedToolCalls()

    {
      const st = streamingDisplayStore.getState()
      const replaces = refusalReplacesUuidsRef.current
      if (!activeRemote.isRemoteMode && st.salvage !== null) {
        const streamedChars = st.raw?.length ?? 0
        streamingDisplayStore.setSalvage(null)
        if (replaces !== null) {
          refusalReplacesUuidsRef.current = null
          logEvent('tengu_rotunda_pennant_esc', {
            action:
              'kept_originals' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            retained_count: replaces.length,
            streamed_chars: streamedChars,
          })
        }
        salvageRef.current = null
      }
    }

    setAbortController(null)

    if (!hasLocalRunningTurn) {
      sendBridgeResultRef.current()
      void mrOnTurnComplete(messagesRef.current, true)
    }
  }

  const handleQueuedCommandOnCancel = useCallback(() => {
    const result = submitController.popAllEditable(inputValueRef.current, 0)
    if (!result) return
    setInputValue(result.text)
    setInputMode(result.mode)
    setAppState(prev =>
      prev.queueEditIndex === null ? prev : { ...prev, queueEditIndex: null },
    )

    if (result.images.length > 0) {
      setPastedContents(prev => {
        const newContents = { ...prev }
        for (const image of result.images) {
          newContents[image.id] = image
        }
        return newContents
      })
    }
  }, [
    submitController,
    inputValueRef,
    setInputValue,
    setInputMode,
    setPastedContents,
    setAppState,
  ])

  useEffect(() => {
    setPermissionDenyQueuePop(handleQueuedCommandOnCancel)
    return () => setPermissionDenyQueuePop(null)
  }, [handleQueuedCommandOnCancel])

  const hasRunningDetachedToolCalls = useSyncExternalStore(
    subscribeDetachedToolCalls,
    () => {
      for (const entry of getDetachedToolCallSnapshot().values()) {
        if (entry.status === 'running' && !entry.stopRequested) return true
      }
      return false
    },
    () => false,
  )
  const idleDetachedAbortSignalRef = useRef<AbortSignal | null>(null)
  if (idleDetachedAbortSignalRef.current === null) {
    idleDetachedAbortSignalRef.current = new AbortController().signal
  }

  const cancelRequestProps: React.ComponentProps<typeof CancelRequestHandler> =
    {
      setToolUseConfirmQueue,
      onCancel,
      onAgentsKilled: () =>
        setMessages(prev => [...prev, createAgentsKilledMessage()]),
      isMessageSelectorVisible: isMessageSelectorVisible || !!showBashesDialog,
      screen,
      abortSignal:
        abortController?.signal ??
        (promptEmpty && hasRunningDetachedToolCalls
          ? idleDetachedAbortSignalRef.current
          : undefined),
      popCommandFromQueue: handleQueuedCommandOnCancel,
      vimMode,
      isLocalJSXCommand: toolJSX?.isLocalJSXCommand,
      isSearchingHistory,
      isHelpOpen,
      inputMode,
      inputValue: promptEmpty ? '' : inputValueRef.current,
      streamMode,
      isDialogChromeVisible,
    }

  const executeQueuedInput = useCallback(
    async (queuedCmds: QueuedCommand[]) => {
      if (queuedCmds.some(cmd => cmd.mode === 'poll-event')) {
        setAppState(prev => {
          const guarded = applyPollEventDeliveryGuard(
            prev.toolPermissionContext,
          )
          const nextCtx =
            guarded.pollEventDeliveryGuard === true
              ? guarded
              : { ...guarded, pollEventDeliveryGuard: true as const }
          return nextCtx === prev.toolPermissionContext
            ? prev
            : { ...prev, toolPermissionContext: nextCtx }
        })
      }
      const isLoopBatch = queuedCmds.some(
        cmd => cmd.wakeupSource === 'loop_wakeup',
      )
      const isScheduledBatch =
        isLoopBatch ||
        queuedCmds.some(
          cmd =>
            cmd.modelScheduledOrigin === true ||
            cmd.wakeupSource === 'schedule_wakeup',
        )
      const prevScheduledTurn = activeScheduledTurnRef.current
      if (isScheduledBatch) {
        activeScheduledTurnRef.current = {
          isScheduledTask: true,
          isLoop: isLoopBatch,
        }
      }
      try {
        await submitController.executeQueuedInput(queuedCmds, {
          commands,
          mainLoopModel,
          ideSelection,
          querySource: isLoopBatch
            ? 'cron_loop'
            : isScheduledBatch
              ? 'cron_scheduled'
              : getQuerySourceForREPL(),
          getCurrentInput: () => inputValueRef.current,
          getMessages: () => messagesRef.current,
          setAppState,
          setMessages,
          setInputValue,
          setPastedContents,
          setUserInputOnProcessing,
          setToolJSX,
          setAbortControllerForQuery,
          addNotification,
          getToolUseContext,
          onQuery,
          onBeforeQuery,
          canUseTool,
          consumeIdeSelection,
          recordIdeSelectionConsumedBy,
          restoreIdeSelectionConsumedBy,
          restoreHandedBackPrompt,
        })
      } finally {
        if (isScheduledBatch) {
          activeScheduledTurnRef.current = prevScheduledTurn
        }
      }
    },
    [
      submitController,
      commands,
      setToolJSX,
      getToolUseContext,
      mainLoopModel,
      ideSelection,
      setUserInputOnProcessing,
      canUseTool,
      setAbortControllerForQuery,
      onQuery,
      addNotification,
      setAppState,
      onBeforeQuery,
      consumeIdeSelection,
      recordIdeSelectionConsumedBy,
      restoreIdeSelectionConsumedBy,
      restoreHandedBackPrompt,
      setInputValue,
      setPastedContents,
      setMessages,
      activeScheduledTurnRef,
      inputValueRef,
      messagesRef,
    ],
  )

  useQueueProcessor({
    executeQueuedInput,
    hasActiveLocalJsxUI: isShowingLocalJSXCommand,
    queryGuard,
    awaitSessionStartHooks: turnController.awaitSessionStartHooks,
    handOverInFlight,
  })

  const handleIncomingPrompt = useCallback(
    (
      input: string | QueuedCommand,
      options?: { isMeta?: boolean },
    ): boolean => {
      if (typeof input !== 'string' && input.mode === 'poll-event') {
        setAppState(prev => {
          const guarded = applyPollEventDeliveryGuard(
            prev.toolPermissionContext,
          )
          const nextCtx =
            guarded.pollEventDeliveryGuard === true
              ? guarded
              : { ...guarded, pollEventDeliveryGuard: true as const }
          return nextCtx === prev.toolPermissionContext
            ? prev
            : { ...prev, toolPermissionContext: nextCtx }
        })
      }
      return submitController.handleIncomingPrompt(
        input,
        {
          mainLoopModel,
          setAbortControllerForQuery,
          onQuery,
        },
        options,
      )
    },
    [
      submitController,
      onQuery,
      mainLoopModel,
      setAbortControllerForQuery,
      setAppState,
    ],
  )

  return {
    onCancel,
    handleQueuedCommandOnCancel,
    cancelRequestProps,
    executeQueuedInput,
    handleIncomingPrompt,
  }
}
