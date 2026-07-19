import { logEvent } from '../services/analytics/index.js'
import { isTerminalTaskStatus } from '../Task.js'
import type { LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js'
import type { InProcessTeammateTaskState } from '../tasks/InProcessTeammateTask/types.js'

// Inlined from framework.ts — importing creates a cycle through
// BackgroundTasksDialog. Keep in sync with PANEL_GRACE_MS there.
const PANEL_GRACE_MS = 30_000

import type { AppState } from './AppState.js'

// Inline type checks instead of importing isLocalAgentTask / isInProcessTeammate
// — breaks the teammateViewHelpers → task module runtime edge that creates a
// cycle through BackgroundTasksDialog.
function isLocalAgent(task: unknown): task is LocalAgentTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'local_agent'
  )
}

function isInProcessTeammate(
  task: unknown,
): task is InProcessTeammateTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'in_process_teammate'
  )
}

/** densable wba — viewable agent: local_agent | in_process_teammate */
function isViewableAgent(
  task: unknown,
): task is LocalAgentTaskState | InProcessTeammateTaskState {
  return isLocalAgent(task) || isInProcessTeammate(task)
}

/**
 * densable Aba portable — release a viewable agent when leaving its transcript.
 * - local_agent: retain:false, diskLoaded:false, messages cleared, evictAfter if terminal
 * - in_process_teammate: only set evictAfter when isIdle (no retain/diskLoaded)
 */
function releaseViewable<
  T extends LocalAgentTaskState | InProcessTeammateTaskState,
>(task: T): T {
  if (isInProcessTeammate(task)) {
    return {
      ...task,
      evictAfter: task.isIdle ? Date.now() + PANEL_GRACE_MS : undefined,
    }
  }
  // local_agent densable Aba (+ clear messages for stub form)
  return {
    ...task,
    retain: false,
    messages: undefined,
    diskLoaded: false,
    evictAfter: isTerminalTaskStatus(task.status)
      ? Date.now() + PANEL_GRACE_MS
      : undefined,
  }
}

/**
 * Transitions the UI to view a teammate's transcript.
 * densable gze:
 *   s = switching from another wba view
 *   a = wba(n) && (Cba(n)&&!retain || evictAfter!==void 0)
 *   retain only on Cba (local_agent); teammate only clears evictAfter
 */
export function enterTeammateView(
  taskId: string,
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void {
  logEvent('tengu_transcript_view_enter', {})
  setAppState(prev => {
    const task = prev.tasks[taskId]
    const prevId = prev.viewingAgentTaskId
    const prevTask = prevId !== undefined ? prev.tasks[prevId] : undefined
    // densable s: o!==void 0&&o!==e&&wba(i) — no retain gate on prev
    const switching =
      prevId !== undefined && prevId !== taskId && isViewableAgent(prevTask)
    // densable a: wba(n)&&(Cba(n)&&!n.retain||n.evictAfter!==void 0)
    const needsRetain =
      isViewableAgent(task) &&
      ((isLocalAgent(task) && !task.retain) ||
        (task as { evictAfter?: number }).evictAfter !== undefined)
    const needsView =
      prev.viewingAgentTaskId !== taskId ||
      prev.viewSelectionMode !== 'viewing-agent'
    if (!needsRetain && !needsView && !switching) return prev
    let tasks = prev.tasks
    if (switching || needsRetain) {
      tasks = { ...prev.tasks }
      if (switching && prevId !== undefined && isViewableAgent(prevTask)) {
        tasks[prevId] = releaseViewable(prevTask)
      }
      if (needsRetain && isViewableAgent(task)) {
        // densable: Cba(n)?{...n,retain:!0,evictAfter:void 0}:{...n,evictAfter:void 0}
        if (isLocalAgent(task)) {
          tasks[taskId] = { ...task, retain: true, evictAfter: undefined }
        } else if (isInProcessTeammate(task)) {
          tasks[taskId] = { ...task, evictAfter: undefined }
        }
      }
    }
    return {
      ...prev,
      viewingAgentTaskId: taskId,
      viewSelectionMode: 'viewing-agent',
      tasks,
    }
  })
}

/**
 * Exit teammate transcript view and return to leader's view.
 * densable nie: if !wba return cleared view; else Aba(viewed).
 */
export function exitTeammateView(
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void {
  logEvent('tengu_transcript_view_exit', {})
  setAppState(prev => {
    const id = prev.viewingAgentTaskId
    const cleared = {
      ...prev,
      viewingAgentTaskId: undefined,
      viewSelectionMode: 'none' as const,
    }
    if (id === undefined) {
      return prev.viewSelectionMode === 'none' ? prev : cleared
    }
    const task = prev.tasks[id]
    if (!isViewableAgent(task)) return cleared
    return {
      ...cleared,
      tasks: { ...prev.tasks, [id]: releaseViewable(task) },
    }
  })
}

/**
 * Context-sensitive x: running → abort, terminal → dismiss.
 * densable Rba is Cba-only (local_agent) — force-dismiss panel with evictAfter=0.
 * If viewing the dismissed agent, also exits to leader.
 */
export function stopOrDismissAgent(
  taskId: string,
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void {
  setAppState(prev => {
    const task = prev.tasks[taskId]
    if (!isLocalAgent(task)) return prev
    if (task.status === 'running') {
      task.abortController?.abort()
      return prev
    }
    if (task.evictAfter === 0) return prev
    const viewingThis = prev.viewingAgentTaskId === taskId
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: { ...releaseViewable(task), evictAfter: 0 },
      },
      ...(viewingThis && {
        viewingAgentTaskId: undefined,
        viewSelectionMode: 'none' as const,
      }),
    }
  })
}
