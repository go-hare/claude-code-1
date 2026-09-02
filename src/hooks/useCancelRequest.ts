/**
 * CancelRequestHandler component for handling cancel/escape keybinding.
 *
 * Must be rendered inside KeybindingSetup to have access to the keybinding context.
 * This component renders nothing - it just registers the cancel keybinding handler.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import {
  useAppState,
  useAppStateStore,
  useSetAppState,
} from 'src/state/AppState.js'
import { isVimModeEnabled } from '../components/PromptInput/utils.js'
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import type { SpinnerMode } from '../components/Spinner/types.js'
import { useNotifications } from '../context/notifications.js'
import { useIsOverlayActive } from '../context/overlayContext.js'
import { useDialogStore } from '../dialog/DialogStoreContext.js'
import { useCommandQueue } from '../hooks/useCommandQueue.js'
import { clearPermissionConfirmQueue } from '../hooks/toolPermission/PermissionContext.js'
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import type { Screen } from '../screens/REPL.js'
import { exitTeammateView } from '../state/teammateViewHelpers.js'
import {
  killAllRunningAgentTasks,
  markAgentsNotified,
} from '../tasks/LocalAgentTask/LocalAgentTask.js'
import type { PromptInputMode, VimMode } from '../types/textInputTypes.js'
import {
  clearCommandQueue,
  enqueuePendingNotification,
  isPoppableEditableCommand,
} from '../utils/messageQueueManager.js'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'

/** Time window in ms during which a second press kills all background agents. */
const KILL_AGENTS_CONFIRM_WINDOW_MS = 3000

type CancelRequestHandlerProps = {
  setToolUseConfirmQueue: (
    f: (toolUseConfirmQueue: ToolUseConfirm[]) => ToolUseConfirm[],
  ) => void
  onCancel: () => void
  onAgentsKilled: () => void
  isMessageSelectorVisible: boolean
  screen: Screen
  abortSignal?: AbortSignal
  popCommandFromQueue?: () => void
  vimMode?: VimMode
  isLocalJSXCommand?: boolean
  isSearchingHistory?: boolean
  isHelpOpen?: boolean
  inputMode?: PromptInputMode
  inputValue?: string
  streamMode?: SpinnerMode
  /**
   * densable mQc `Z=RPs()==="visible"` — when modal chrome is painted,
   * Select owns Esc (`isActive: re = te && !Z && …`).
   */
  isDialogChromeVisible?: boolean
}

/**
 * Component that handles cancel requests via keybinding.
 * Renders null but registers the 'chat:cancel' keybinding handler.
 */
export function CancelRequestHandler(props: CancelRequestHandlerProps): null {
  const {
    setToolUseConfirmQueue,
    onCancel,
    onAgentsKilled,
    isMessageSelectorVisible,
    screen,
    abortSignal,
    popCommandFromQueue,
    vimMode,
    isLocalJSXCommand,
    isSearchingHistory,
    isHelpOpen,
    inputMode,
    inputValue,
    streamMode,
    isDialogChromeVisible = false,
  } = props
  const store = useAppStateStore()
  const dialogStore = useDialogStore()
  const setAppState = useSetAppState()
  // Subscribe so isActive re-evaluates when the queue mutates (useSyncExternalStore).
  const queuedCommands = useCommandQueue()
  const { addNotification, removeNotification } = useNotifications()
  const lastKillAgentsPressRef = useRef<number>(0)
  const viewSelectionMode = useAppState(s => s.viewSelectionMode)
  // densable Fxe().phase — keep Esc active while quota auto-resume waits
  const isQuotaAutoResumeEscTarget = useSyncExternalStore(
    onStoreChange => {
      try {
        const { subscribeQuotaAutoResumeChanged } =
          require('../services/quotaAutoResume.js') as typeof import('../services/quotaAutoResume.js')
        return subscribeQuotaAutoResumeChanged(onStoreChange)
      } catch {
        return () => {}
      }
    },
    () => {
      try {
        const { isQuotaAutoResumeWaiting } =
          require('../services/quotaAutoResume.js') as typeof import('../services/quotaAutoResume.js')
        return isQuotaAutoResumeWaiting()
      } catch {
        return false
      }
    },
    () => false,
  )

  const handleCancel = useCallback(() => {
    const cancelProps = {
      source:
        'escape' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      streamMode:
        streamMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }

    // densable Vwo — cancel pending dynamic /loop wakeups on user abort.
    // Official: if(Vwo()>0) bump cancel-count; still proceed with tengu_cancel.
    try {
      const { cancelLoopWakeupsOnUserAbort } =
        require('../utils/loopDynamic.js') as typeof import('../utils/loopDynamic.js')
      cancelLoopWakeupsOnUserAbort()
    } catch {
      // loopDynamic may be unavailable in partial test mocks
    }

    // densable $l / #20: Esc while selecting a queued message clears selection
    // only — must NOT Gis auto-continue and must NOT interrupt the turn.
    if (store.getState().queueEditIndex !== null) {
      setAppState(prev =>
        prev.queueEditIndex === null ? prev : { ...prev, queueEditIndex: null },
      )
      return
    }

    // densable Gis(w, gesture) — cancel quota auto-resume wait on Esc (Pwc/We).
    // When only waiting on usage-limit auto-continue, Esc cancels that wait and
    // returns without aborting a turn (ke=true early return).
    let cancelledQuotaWait = false
    try {
      const { isQuotaAutoResumeWaiting, cancelQuotaAutoResumeWithNotice } =
        require('../services/quotaAutoResume.js') as typeof import('../services/quotaAutoResume.js')
      if (isQuotaAutoResumeWaiting()) {
        const notice = cancelQuotaAutoResumeWithNotice('escape')
        if (notice) {
          addNotification({
            key: 'quota-auto-resume-cancelled',
            text: notice,
            priority: 'immediate',
            timeoutMs: 8000,
          })
          cancelledQuotaWait = true
        }
      }
    } catch {
      // quotaAutoResume may be unavailable in partial test mocks
    }

    // Priority 1: If there's an active task running, cancel it first
    // This takes precedence over queue management so users can always interrupt Claude
    if (abortSignal !== undefined && !abortSignal.aborted) {
      logEvent('tengu_cancel', cancelProps)
      // leftover Host doo: onCancel must see queue[0] so onAbort can
      // dismissPermissionDoo + abort. Clear after, not before.
      onCancel()
      clearPermissionConfirmQueue(setToolUseConfirmQueue, dialogStore)
      return
    }

    // Priority 2: Pop NMt-poppable queue when Claude is idle (densable Opu/NMt).
    // Bash entries only count when input is empty — otherwise Esc must not steal
    // the draft / interrupt via queue pop (#19/#20).
    if (
      queuedCommands.some(cmd => isPoppableEditableCommand(cmd, !inputValue))
    ) {
      if (popCommandFromQueue) {
        popCommandFromQueue()
        return
      }
    }

    // densable: if(ke)return — Esc only cancelled the wait; do not tengu_cancel.
    if (cancelledQuotaWait) {
      return
    }

    // Fallback: nothing to cancel or pop (shouldn't reach here if isActive is correct)
    logEvent('tengu_cancel', cancelProps)
    onCancel()
    clearPermissionConfirmQueue(setToolUseConfirmQueue, dialogStore)
  }, [
    abortSignal,
    popCommandFromQueue,
    setToolUseConfirmQueue,
    onCancel,
    streamMode,
    addNotification,
    queuedCommands,
    inputValue,
    store,
    dialogStore,
    setAppState,
  ])

  // Determine if this handler should be active
  // Other contexts (Transcript, HistorySearch, Help) have their own escape handlers
  // Overlays (ModelPicker, ThinkingToggle, etc.) register themselves via useRegisterOverlay
  // Local JSX commands (like /model, /btw) handle their own input
  const isOverlayActive = useIsOverlayActive()
  const canCancelRunningTask = abortSignal !== undefined && !abortSignal.aborted
  // densable 2.1.234: q = S.some(NMt(re, p)) — NMt excludes bash unless input empty.
  // Using plain isQueuedCommandEditable would pop/steal Esc for bang entries while
  // the user still has draft text (#19/#20).
  const hasEditableQueuedCommands = queuedCommands.some(cmd =>
    isPoppableEditableCommand(cmd, !inputValue),
  )
  // When in bash/background mode with empty input, escape should exit the mode
  // rather than cancel the request. Let PromptInput handle mode exit.
  // This only applies to Escape, not Ctrl+C which should always cancel.
  const isInSpecialModeWithEmptyInput =
    inputMode !== undefined && inputMode !== 'prompt' && !inputValue
  // When viewing a teammate's transcript, let useBackgroundTaskNavigation handle Escape
  const isViewingTeammate = viewSelectionMode === 'viewing-agent'
  // Context guards: other screens/overlays handle their own cancel
  const isContextActive =
    screen !== 'transcript' &&
    !isSearchingHistory &&
    !isMessageSelectorVisible &&
    !isLocalJSXCommand &&
    !isHelpOpen &&
    !isOverlayActive &&
    !(isVimModeEnabled() && vimMode === 'INSERT')

  // Escape (chat:cancel) defers to mode-exit when in special mode with empty
  // input, and to useBackgroundTaskNavigation when viewing a teammate.
  // densable `Z=RPs()==="visible"` → `!Z` so Select owns Esc while chrome shows.
  const isEscapeActive =
    isContextActive &&
    !isDialogChromeVisible &&
    (canCancelRunningTask ||
      hasEditableQueuedCommands ||
      isQuotaAutoResumeEscTarget) &&
    !isInSpecialModeWithEmptyInput &&
    !isViewingTeammate

  // Ctrl+C (app:interrupt): when viewing a teammate, stops everything and
  // returns to main thread. Otherwise just handleCancel. Must NOT claim
  // ctrl+c when main is idle at the prompt — that blocks the copy-selection
  // handler and double-press-to-exit from ever seeing the keypress.
  const isCtrlCActive =
    isContextActive &&
    (canCancelRunningTask ||
      hasEditableQueuedCommands ||
      isViewingTeammate ||
      isQuotaAutoResumeEscTarget)

  useKeybinding('chat:cancel', handleCancel, {
    context: 'Chat',
    isActive: isEscapeActive,
  })

  // Shared kill path: stop all agents, suppress per-agent notifications,
  // emit SDK events, enqueue a single aggregate model-facing notification.
  // Returns true if anything was killed.
  const killAllAgentsAndNotify = useCallback((): boolean => {
    const tasks = store.getState().tasks
    const running = Object.entries(tasks).filter(
      ([, t]) => t.type === 'local_agent' && t.status === 'running',
    )
    if (running.length === 0) return false
    killAllRunningAgentTasks(tasks, setAppState)
    const descriptions: string[] = []
    for (const [taskId, task] of running) {
      markAgentsNotified(taskId, setAppState)
      descriptions.push(task.description)
      emitTaskTerminatedSdk(taskId, 'stopped', {
        toolUseId: task.toolUseId,
        summary: task.description,
      })
    }
    const summary =
      descriptions.length === 1
        ? `Background agent "${descriptions[0]}" was stopped by the user.`
        : `${descriptions.length} background agents were stopped by the user: ${descriptions.map(d => `"${d}"`).join(', ')}.`
    enqueuePendingNotification({ value: summary, mode: 'task-notification' })
    onAgentsKilled()
    return true
  }, [store, setAppState, onAgentsKilled])

  // Ctrl+C (app:interrupt). Scoped to teammate-view: killing agents from the
  // main prompt stays a deliberate gesture (chat:killAgents), not a
  // side-effect of cancelling a turn.
  const handleInterrupt = useCallback(() => {
    if (isViewingTeammate) {
      killAllAgentsAndNotify()
      exitTeammateView(setAppState)
    }
    if (canCancelRunningTask || hasEditableQueuedCommands) {
      handleCancel()
    }
  }, [
    isViewingTeammate,
    killAllAgentsAndNotify,
    setAppState,
    canCancelRunningTask,
    hasEditableQueuedCommands,
    handleCancel,
  ])

  useKeybinding('app:interrupt', handleInterrupt, {
    context: 'Global',
    isActive: isCtrlCActive,
  })

  // chat:killAgents uses a two-press pattern: first press shows a
  // confirmation hint, second press within the window actually kills all
  // agents. Reads tasks from the store directly to avoid stale closures.
  const handleKillAgents = useCallback(() => {
    const tasks = store.getState().tasks
    const hasRunningAgents = Object.values(tasks).some(
      t => t.type === 'local_agent' && t.status === 'running',
    )
    if (!hasRunningAgents) {
      addNotification({
        key: 'kill-agents-none',
        text: 'No background agents running',
        priority: 'immediate',
        timeoutMs: 2000,
      })
      return
    }
    const now = Date.now()
    const elapsed = now - lastKillAgentsPressRef.current
    if (elapsed <= KILL_AGENTS_CONFIRM_WINDOW_MS) {
      // Second press within window -- kill all background agents
      lastKillAgentsPressRef.current = 0
      removeNotification('kill-agents-confirm')
      logEvent('tengu_cancel', {
        source:
          'kill_agents' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      // densable: if(Klr()) Gis(w,"kill_agents_chord")
      // Klr ≡ WXa — only pending continuation in queue, not armed/stale wait.
      try {
        const {
          isQuotaAutoResumeArmedOrPending,
          cancelQuotaAutoResumeWithNotice,
        } =
          require('../services/quotaAutoResume.js') as typeof import('../services/quotaAutoResume.js')
        if (isQuotaAutoResumeArmedOrPending()) {
          const notice = cancelQuotaAutoResumeWithNotice('kill_agents_chord')
          if (notice) {
            addNotification({
              key: 'quota-auto-resume-cancelled',
              text: notice,
              priority: 'immediate',
              timeoutMs: 8000,
            })
          }
        }
      } catch {
        // ignore
      }
      clearCommandQueue()
      killAllAgentsAndNotify()
      return
    }
    // First press -- show confirmation hint in status bar
    lastKillAgentsPressRef.current = now
    const shortcut = getShortcutDisplay(
      'chat:killAgents',
      'Chat',
      'ctrl+x ctrl+k',
    )
    addNotification({
      key: 'kill-agents-confirm',
      text: `Press ${shortcut} again to stop background agents`,
      priority: 'immediate',
      timeoutMs: KILL_AGENTS_CONFIRM_WINDOW_MS,
    })
  }, [store, addNotification, removeNotification, killAllAgentsAndNotify])

  // Must stay always-active: ctrl+x is consumed as a chord prefix regardless
  // of isActive (because ctrl+x ctrl+e is always live), so an inactive handler
  // here would leak ctrl+k to readline kill-line. Handler gates internally.
  useKeybinding('chat:killAgents', handleKillAgents, {
    context: 'Chat',
  })

  return null
}
