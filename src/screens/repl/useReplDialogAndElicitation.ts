import type * as React from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { useClaudeCodeHintRecommendation } from 'src/hooks/useClaudeCodeHintRecommendation.js'
import type { useLspPluginRecommendation } from 'src/hooks/useLspPluginRecommendation.js'
import type { useSearchExtraToolsHint } from 'src/hooks/useSearchExtraToolsHint.js'
import type { Notification } from '../../context/notifications.js'
import {
  getHostDialogVisibility,
  getHostParkMode,
  hostParkToSuppressReason,
  pickNextHostOffer,
} from '../../dialog/hostPark.js'
import {
  legacyFocusForUqc,
  setLegacyDialogFocus,
} from '../../dialog/legacyDialogFocus.js'
import {
  type ElicitationRequestEvent,
  getElicitationCueBehindDraft,
  isBackgroundMcpTaskElicitation,
} from '../../services/mcp/elicitationHandler.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Store } from '../../state/store.js'
import {
  isMcpTask,
  McpTaskQuestionController,
  McpTaskQuestionNoticeTracker,
  setMcpTaskQuestionState,
} from '../../tasks/McpTask/McpTask.js'
import { isBgSession } from '../../utils/concurrentSessions.js'
import type { LeftArrowConfirmState } from '../../utils/leftArrowConfirm.js'
import type {
  MessageQueueInstance,
  SetAppState,
} from '../../utils/messageQueueManager.js'
import type {
  FocusedInputDialog,
  PkeState,
  PromptQueueItem,
  TipNonGoldOverlay,
  ToolJSXState,
} from './types.js'

/**
 * Coordinates MCP background-task elicitation deferral/reopen state,
 * interrupt-dialog holdback while typing, focused input dialog priority,
 * host dialog parking/visibility, and legacy dialog focus registration.
 */
export function useReplDialogAndElicitation(params: {
  store: Store<AppState>
  setAppState: SetAppState
  messageQueue: MessageQueueInstance
  addNotification: (notif: Notification) => void
  elicitation: AppState['elicitation']
  workerSandboxPermissions: AppState['workerSandboxPermissions']
  ultraplanPendingChoice: AppState['ultraplanPendingChoice']
  ultraplanLaunchPending: AppState['ultraplanLaunchPending']
  showRemoteCallout: boolean
  viewingAgentTaskId: string | undefined
  hasDraft: boolean
  isPromptInputActive: boolean
  isLoading: boolean
  toolJSX: ToolJSXState | null
  isShowingLocalJSXCommand: boolean
  pke: PkeState
  isMessageSelectorVisible: boolean
  leftArrowConfirm: LeftArrowConfirmState | null
  hasOpenDialogs: boolean
  hasBlockingOpenDialogs: boolean
  rawHidePromptForHardNms: boolean
  promptQueue: PromptQueueItem[]
  showModelSwitchCallout: boolean
  showUndercoverCallout: boolean
  showEffortCallout: boolean
  showDesktopUpsellStartup: boolean
  showFullscreenUpsell: boolean
  lspRecommendation: ReturnType<
    typeof useLspPluginRecommendation
  >['recommendation']
  hintRecommendation: ReturnType<
    typeof useClaudeCodeHintRecommendation
  >['recommendation']
  searchExtraToolsHint: ReturnType<typeof useSearchExtraToolsHint>
  focusedInputDialogRef: React.RefObject<FocusedInputDialog>
}): {
  setReopenedElicitationKey: React.Dispatch<React.SetStateAction<string | null>>
  elicitationCueBehindDraft: ReturnType<typeof getElicitationCueBehindDraft>
  resolveMcpElicitationTaskId: (
    event: ElicitationRequestEvent | undefined,
  ) => string | undefined
  mcpTaskQuestionHarnessesRef: React.RefObject<
    Map<
      string,
      {
        controller: McpTaskQuestionController
        tracker: McpTaskQuestionNoticeTracker
      }
    >
  >
  deferredMcpElicitationsRef: React.RefObject<
    Map<string, ElicitationRequestEvent>
  >
  deferredMcpAbortCleanupsRef: React.RefObject<Map<string, () => void>>
  clearDeferredMcpElicitation: (taskId: string) => void
  getOrCreateMcpTaskQuestionHarness: (taskId: string) => {
    controller: McpTaskQuestionController
    tracker: McpTaskQuestionNoticeTracker
  }
  focusedInputDialog: FocusedInputDialog
  hostParkMode: ReturnType<typeof getHostParkMode>
  hidePromptForHardNms: boolean
  hostDialogVisibility: ReturnType<typeof getHostDialogVisibility>
  tipOverlay: TipNonGoldOverlay
  anyInputOverlay: FocusedInputDialog | TipNonGoldOverlay
  hasSuppressedDialogs: boolean
  modalChrome: ReturnType<typeof getHostDialogVisibility>
  isDialogChromeVisible: boolean
  dialogSuppressReason: ReturnType<typeof hostParkToSuppressReason>
} {
  const {
    store,
    setAppState,
    messageQueue,
    addNotification,
    elicitation,
    workerSandboxPermissions,
    ultraplanPendingChoice,
    ultraplanLaunchPending,
    showRemoteCallout,
    viewingAgentTaskId,
    hasDraft,
    isPromptInputActive,
    isLoading,
    toolJSX,
    isShowingLocalJSXCommand,
    pke,
    isMessageSelectorVisible,
    leftArrowConfirm,
    hasOpenDialogs,
    hasBlockingOpenDialogs,
    rawHidePromptForHardNms,
    promptQueue,
    showModelSwitchCallout,
    showUndercoverCallout,
    showEffortCallout,
    showDesktopUpsellStartup,
    showFullscreenUpsell,
    lspRecommendation,
    hintRecommendation,
    searchExtraToolsHint,
    focusedInputDialogRef,
  } = params

  const [reopenedElicitationKey, setReopenedElicitationKey] = useState<
    string | null
  >(null)
  const queuedElicitation = elicitation.queue[0]
  const queuedElicitationKey = queuedElicitation
    ? `${queuedElicitation.serverName}:${String(queuedElicitation.requestId)}`
    : null
  const isReopenedElicitation =
    queuedElicitationKey !== null &&
    reopenedElicitationKey === queuedElicitationKey
  const elicitationCueBehindDraft =
    queuedElicitation &&
    !isReopenedElicitation &&
    (hasDraft || isPromptInputActive)
      ? getElicitationCueBehindDraft({
          serverName: queuedElicitation.serverName,
          params: queuedElicitation.params,
        })
      : undefined

  const resolveMcpElicitationTaskId = useCallback(
    (event: ElicitationRequestEvent | undefined): string | undefined => {
      if (!event || !isBackgroundMcpTaskElicitation(event.params))
        return undefined
      const meta = (event.params as { _meta?: Record<string, unknown> })._meta
      const related =
        meta?.['io.modelcontextprotocol/related-task'] ?? meta?.relatedTask
      const relatedTaskId =
        typeof related === 'object' &&
        related !== null &&
        typeof (related as { taskId?: unknown }).taskId === 'string'
          ? (related as { taskId: string }).taskId
          : undefined
      const liveTasks = store.getState().tasks ?? {}
      if (relatedTaskId) {
        if (relatedTaskId in liveTasks) return relatedTaskId
        for (const task of Object.values(liveTasks)) {
          if (
            isMcpTask(task) &&
            task.status === 'running' &&
            task.mcpTaskId === relatedTaskId
          ) {
            return task.id
          }
        }
        return relatedTaskId
      }
      for (const task of Object.values(liveTasks)) {
        if (
          isMcpTask(task) &&
          task.status === 'running' &&
          task.serverName === event.serverName
        ) {
          return task.id
        }
      }
      return undefined
    },
    [store],
  )

  const mcpTaskQuestionHarnessesRef = useRef(
    new Map<
      string,
      {
        controller: McpTaskQuestionController
        tracker: McpTaskQuestionNoticeTracker
      }
    >(),
  )
  const deferredMcpElicitationsRef = useRef(
    new Map<string, ElicitationRequestEvent>(),
  )
  const deferredMcpAbortCleanupsRef = useRef(new Map<string, () => void>())

  const clearDeferredMcpElicitation = useCallback((taskId: string) => {
    const cleanup = deferredMcpAbortCleanupsRef.current.get(taskId)
    if (cleanup) {
      deferredMcpAbortCleanupsRef.current.delete(taskId)
      cleanup()
    }
    deferredMcpElicitationsRef.current.delete(taskId)
  }, [])

  useEffect(() => {
    return () => {
      for (const cleanup of deferredMcpAbortCleanupsRef.current.values()) {
        cleanup()
      }
      deferredMcpAbortCleanupsRef.current.clear()
      deferredMcpElicitationsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (reopenedElicitationKey === null) return
    const stillQueued = elicitation.queue.some(
      item =>
        `${item.serverName}:${String(item.requestId)}` ===
        reopenedElicitationKey,
    )
    if (
      !stillQueued ||
      (queuedElicitationKey !== null &&
        queuedElicitationKey !== reopenedElicitationKey)
    ) {
      setReopenedElicitationKey(null)
    }
  }, [elicitation.queue, queuedElicitationKey, reopenedElicitationKey])

  const getOrCreateMcpTaskQuestionHarness = useCallback(
    (taskId: string) => {
      let existing = mcpTaskQuestionHarnessesRef.current.get(taskId)
      if (!existing) {
        const tracker = new McpTaskQuestionNoticeTracker(taskId, {
          enqueueNotice: notice => {
            messageQueue.enqueuePendingNotification(notice)
          },
          removeQueuedNotices: predicate =>
            messageQueue.removeByFilter(
              cmd =>
                cmd.mode === 'task-notification' &&
                typeof cmd.value === 'string' &&
                predicate(cmd.value),
            ).length,
        })
        const controller = new McpTaskQuestionController((openFn, state) => {
          const reopenFromTasks = openFn
            ? () => {
                openFn()
                const deferred = deferredMcpElicitationsRef.current.get(taskId)
                if (deferred) {
                  clearDeferredMcpElicitation(taskId)
                  const reopenedKey = `${deferred.serverName}:${String(deferred.requestId)}`
                  setAppState(prev => {
                    const rest = prev.elicitation.queue.filter(
                      item =>
                        !(
                          item.serverName === deferred.serverName &&
                          item.requestId === deferred.requestId
                        ),
                    )
                    return {
                      ...prev,
                      elicitation: {
                        queue: [deferred, ...rest],
                      },
                    }
                  })
                  setReopenedElicitationKey(reopenedKey)
                } else {
                  const queuedMatch = store
                    .getState()
                    .elicitation.queue.find(
                      item => resolveMcpElicitationTaskId(item) === taskId,
                    )
                  if (queuedMatch) {
                    const reopenedKey = `${queuedMatch.serverName}:${String(queuedMatch.requestId)}`
                    setAppState(prev => {
                      const idx = prev.elicitation.queue.findIndex(
                        item =>
                          item.serverName === queuedMatch.serverName &&
                          item.requestId === queuedMatch.requestId,
                      )
                      if (idx <= 0) return prev
                      const rest = prev.elicitation.queue.filter(
                        (_, i) => i !== idx,
                      )
                      return {
                        ...prev,
                        elicitation: {
                          queue: [prev.elicitation.queue[idx]!, ...rest],
                        },
                      }
                    })
                    setReopenedElicitationKey(reopenedKey)
                  }
                }
                controller.takeOpen()
              }
            : undefined
          setMcpTaskQuestionState(taskId, setAppState, reopenFromTasks, state)
          tracker.update(state)
        })
        existing = { controller, tracker }
        mcpTaskQuestionHarnessesRef.current.set(taskId, existing)
      }
      return existing
    },
    [
      clearDeferredMcpElicitation,
      messageQueue,
      resolveMcpElicitationTaskId,
      setAppState,
      store,
    ],
  )

  useEffect(() => {
    if (!elicitationCueBehindDraft) return
    addNotification({
      key: 'mcp-elicitation-behind-draft',
      text: elicitationCueBehindDraft.text,
      color: 'warning',
      priority: 'high',
    })
  }, [elicitationCueBehindDraft?.text, addNotification])

  // #655: keep interrupt dialog held back one macrotask after draft clears
  const hasQueuedInterruptDialog = Boolean(
    hasBlockingOpenDialogs ||
      workerSandboxPermissions.queue[0] ||
      elicitation.queue[0],
  )
  const prevSuppressedDialogsRef = useRef(false)
  const [, setHeldBackReleaseTick] = useState(0)
  const heldBackReleasePending =
    prevSuppressedDialogsRef.current &&
    !isPromptInputActive &&
    hasQueuedInterruptDialog
  const isDialogHeldBack = isPromptInputActive || heldBackReleasePending

  useEffect(() => {
    if (heldBackReleasePending) {
      const timer = setTimeout(() => {
        prevSuppressedDialogsRef.current = false
        setHeldBackReleaseTick(t => t + 1)
      }, 0)
      return () => clearTimeout(timer)
    }
    prevSuppressedDialogsRef.current =
      isPromptInputActive && hasQueuedInterruptDialog
    return undefined
  }, [heldBackReleasePending, isPromptInputActive, hasQueuedInterruptDialog])

  function getFocusedInputDialog(): FocusedInputDialog {
    if (pke.kind !== 'none') return undefined
    if (isMessageSelectorVisible) return 'message-selector'
    if (leftArrowConfirm) return 'left-arrow-confirm'
    if (isDialogHeldBack && !isReopenedElicitation) return undefined

    const allowDialogsWithAnimation =
      !toolJSX || toolJSX.shouldContinueAnimation
    if (allowDialogsWithAnimation && workerSandboxPermissions.queue[0]) {
      return 'worker-sandbox-permission'
    }
    if (
      allowDialogsWithAnimation &&
      elicitation.queue[0] &&
      (!elicitationCueBehindDraft || isReopenedElicitation)
    ) {
      return 'elicitation'
    }
    if (allowDialogsWithAnimation && !isLoading && ultraplanPendingChoice) {
      return 'ultraplan-choice'
    }
    if (allowDialogsWithAnimation && !isLoading && ultraplanLaunchPending) {
      return 'ultraplan-launch'
    }

    const viewingAgent = viewingAgentTaskId != null
    if (isBgSession()) {
      if (allowDialogsWithAnimation && showRemoteCallout)
        return 'remote-callout'
      return undefined
    }
    if (allowDialogsWithAnimation && showFullscreenUpsell) {
      return 'fullscreen-upsell'
    }
    if (allowDialogsWithAnimation && showRemoteCallout) {
      return 'remote-callout'
    }
    if (hasDraft) return undefined
    if (allowDialogsWithAnimation && lspRecommendation && !viewingAgent) {
      return 'lsp-recommendation'
    }
    if (allowDialogsWithAnimation && hintRecommendation && !viewingAgent) {
      return 'plugin-hint'
    }

    return undefined
  }

  const focusedInputDialog = getFocusedInputDialog()

  // Drive McpTaskQuestionController between 'asking' and 'off_screen'
  const prevQueuedMcpTaskIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const taskId = resolveMcpElicitationTaskId(queuedElicitation)
    const prevTaskId = prevQueuedMcpTaskIdRef.current
    prevQueuedMcpTaskIdRef.current = taskId
    if (
      prevTaskId &&
      prevTaskId !== taskId &&
      !deferredMcpElicitationsRef.current.has(prevTaskId) &&
      !elicitation.queue.some(
        item => resolveMcpElicitationTaskId(item) === prevTaskId,
      )
    ) {
      const prevHarness = mcpTaskQuestionHarnessesRef.current.get(prevTaskId)
      if (prevHarness) {
        prevHarness.controller.set(undefined)
      }
    }
    if (!taskId) return
    const { controller } = getOrCreateMcpTaskQuestionHarness(taskId)
    if (focusedInputDialog === 'elicitation') {
      controller.set('asking')
    } else if (elicitationCueBehindDraft) {
      controller.set('off_screen')
    }
  }, [
    elicitation.queue,
    queuedElicitation,
    focusedInputDialog,
    elicitationCueBehindDraft,
    resolveMcpElicitationTaskId,
    getOrCreateMcpTaskQuestionHarness,
  ])

  const hostParkMode = getHostParkMode({
    hasLegacyDialog: legacyFocusForUqc(focusedInputDialog) != null,
    hasBlockingToolProgress: Boolean(
      toolJSX && !toolJSX.shouldContinueAnimation,
    ),
    hasLocalJsxPanel: isShowingLocalJSXCommand,
    hasDraft: hasDraft || heldBackReleasePending,
    isPromptInputActive: isDialogHeldBack,
  })
  const hidePromptForHardNms = rawHidePromptForHardNms && hostParkMode === null
  const hostDialogVisibility = getHostDialogVisibility({
    hasOpenDialogs,
    focusedOverlay: focusedInputDialog,
    parkMode: hostParkMode,
  })
  const nextHostOffer = pickNextHostOffer({
    exitFlowActive: pke.kind !== 'none',
    isPromptInputActive: isDialogHeldBack,
    hasBlockingToolProgress: Boolean(
      toolJSX && !toolJSX.shouldContinueAnimation,
    ),
    hasLocalJsxPanel: isShowingLocalJSXCommand,
    hasElicitationRequest: Boolean(elicitation.queue[0]),
    leftArrowConfirmOpen: Boolean(leftArrowConfirm),
    isLoading,
    isBgSession: isBgSession(),
    hasEffortMediumNudge: Boolean(showEffortCallout),
    hasOpenDialog: hasOpenDialogs || hasBlockingOpenDialogs,
  })

  function getTipNonGoldOverlay(): TipNonGoldOverlay {
    if (focusedInputDialog != null) return undefined
    if (hasOpenDialogs || hasBlockingOpenDialogs) return undefined
    if (pke.kind !== 'none' || isPromptInputActive) return undefined
    const allowDialogsWithAnimation =
      !toolJSX || toolJSX.shouldContinueAnimation
    if (!allowDialogsWithAnimation) return undefined
    if (promptQueue[0]) return 'prompt'
    if (isBgSession()) return undefined
    if (process.env.USER_TYPE === 'ant' && showModelSwitchCallout) {
      return 'model-switch'
    }
    if (process.env.USER_TYPE === 'ant' && showUndercoverCallout) {
      return 'undercover-callout'
    }
    if (nextHostOffer === 'effort-medium-nudge') return 'effort-callout'
    if (searchExtraToolsHint.visible) return 'search-extra-tools-hint'
    if (showDesktopUpsellStartup) return 'desktop-upsell'
    return undefined
  }
  const tipOverlay = getTipNonGoldOverlay()
  const anyInputOverlay = focusedInputDialog ?? tipOverlay

  const hasSuppressedDialogs = Boolean(
    isPromptInputActive &&
      (hasBlockingOpenDialogs ||
        workerSandboxPermissions.queue[0] ||
        elicitation.queue[0]),
  )

  const modalChrome = hostDialogVisibility
  const isDialogChromeVisible = modalChrome === 'visible'
  const dialogSuppressReason = hostParkToSuppressReason(hostParkMode)

  useLayoutEffect(() => {
    setLegacyDialogFocus(legacyFocusForUqc(focusedInputDialog))
    return () => setLegacyDialogFocus(null)
  }, [focusedInputDialog])

  focusedInputDialogRef.current = focusedInputDialog

  return {
    setReopenedElicitationKey,
    elicitationCueBehindDraft,
    resolveMcpElicitationTaskId,
    mcpTaskQuestionHarnessesRef,
    deferredMcpElicitationsRef,
    deferredMcpAbortCleanupsRef,
    clearDeferredMcpElicitation,
    getOrCreateMcpTaskQuestionHarness,
    focusedInputDialog,
    hostParkMode,
    hidePromptForHardNms,
    hostDialogVisibility,
    tipOverlay,
    anyInputOverlay,
    hasSuppressedDialogs,
    modalChrome,
    isDialogChromeVisible,
    dialogSuppressReason,
  }
}
