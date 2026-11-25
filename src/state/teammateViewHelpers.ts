import { logEvent } from '../services/analytics/index.js'
import { isTerminalTaskStatus } from '../Task.js'
import type { InProcessTeammateTaskState } from '../tasks/InProcessTeammateTask/types.js'
import type { LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js'

// Inlined from framework.ts — importing creates a cycle through
// BackgroundTasksDialog. Keep in sync with PANEL_GRACE_MS there.
const PANEL_GRACE_MS = 30_000

import type { AppState } from './AppState.js'

// Inline type checks instead of importing isLocalAgentTask — breaks the
// teammateViewHelpers → LocalAgentTask runtime edge that creates a cycle
// through BackgroundTasksDialog.
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

/** Official 2.1.331 `f$t` (@319894709): viewable agent task (local_agent or in_process_teammate). */
function isViewableAgent(
  task: unknown,
): task is LocalAgentTaskState | InProcessTeammateTaskState {
  return isLocalAgent(task) || isInProcessTeammate(task)
}

/**
 * Official 2.1.331 `p$t` (@319894709): return the task released back to
 * unretained form.
 * - in_process_teammate: schedule PANEL_GRACE_MS evictAfter if idle or terminal.
 * - local_agent: drop retain + reset diskLoaded + schedule PANEL_GRACE_MS
 *   evictAfter if terminal and not protected by keepalive/chatEngaged.
 * Leaves `AppState.transcripts[taskId]` intact until terminal eviction / `/clear`.
 */
function release(
  task: LocalAgentTaskState | InProcessTeammateTaskState,
): LocalAgentTaskState | InProcessTeammateTaskState {
  if (isInProcessTeammate(task)) {
    return {
      ...task,
      evictAfter:
        task.isIdle || isTerminalTaskStatus(task.status)
          ? Date.now() + PANEL_GRACE_MS
          : undefined,
    }
  }
  const heldByKeepaliveOrChat =
    (task.keepaliveReasons !== undefined && task.keepaliveReasons.size > 0) ||
    (task.chatEngaged === true && task.chatPinForfeited !== true)
  return {
    ...task,
    retain: false,
    messages: undefined,
    diskLoaded: false,
    evictAfter:
      isTerminalTaskStatus(task.status) && !heldByKeepaliveOrChat
        ? Date.now() + PANEL_GRACE_MS
        : undefined,
  }
}

/**
 * Official 2.1.331 `K4` (@319894709): transition the UI to view a teammate or
 * local_agent transcript. Sets viewingAgentTaskId, clears evictAfter for any
 * viewable agent, and sets retain: true on local_agent. Releases any previously
 * viewed agent back to unretained form.
 */
export function enterTeammateView(
  taskId: string,
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void {
  logEvent('tengu_transcript_view_enter', {})
  setAppState(prev => {
    const task = prev.tasks[taskId]
    // Unknown id: do not set viewingAgentTaskId — auto-exit would bounce
    // (flash) back to the leader on the next effect.
    if (task === undefined) return prev
    const prevId = prev.viewingAgentTaskId
    const prevTask = prevId !== undefined ? prev.tasks[prevId] : undefined
    const switching =
      prevId !== undefined && prevId !== taskId && isViewableAgent(prevTask)
    const needsRetain =
      isViewableAgent(task) &&
      ((isLocalAgent(task) && !task.retain) || task.evictAfter !== undefined)
    const needsView =
      prev.viewingAgentTaskId !== taskId ||
      prev.viewSelectionMode !== 'viewing-agent'
    if (!needsRetain && !needsView && !switching) return prev
    let tasks = prev.tasks
    if (switching || needsRetain) {
      tasks = { ...prev.tasks }
      if (switching) tasks[prevId] = release(prevTask)
      if (needsRetain) {
        tasks[taskId] = isLocalAgent(task)
          ? { ...task, retain: true, evictAfter: undefined }
          : { ...task, evictAfter: undefined }
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
 * Official 2.1.331 `q4` (@319895250): exit teammate/subagent transcript view
 * and return to leader's view. Releases both local_agent and in_process_teammate
 * via `release()` so terminal/idle tasks schedule eviction grace cleanly.
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
    if (isLocalAgent(task) && !task.retain) return cleared
    return {
      ...cleared,
      tasks: { ...prev.tasks, [id]: release(task) },
    }
  })
}

/**
 * Context-sensitive x: running → abort, terminal → dismiss.
 * Dismiss sets evictAfter=0 so the filter hides immediately.
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
        [taskId]: { ...release(task), evictAfter: 0 },
      },
      ...(viewingThis && {
        viewingAgentTaskId: undefined,
        viewSelectionMode: 'none',
      }),
    }
  })
}
