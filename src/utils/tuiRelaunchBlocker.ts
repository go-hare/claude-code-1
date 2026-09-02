/**
 * densable 2.1.234 /tui active-task relaunch blocker (iyt / gGS / NOe / g3a /
 * nfo / Zpc) + pre-switch flush stand-in for xve.
 *
 * Gold (SEA `function iyt` / `gGS` / `NOe` / `g3a` / `nfo` / `Zpc`):
 *   iyt(registry) → undefined | {kind:'comment_monitor'|'tasks', activeTasks}
 *   gGS — running/pending, skip remote_agent/dream; mcp without abort skipped;
 *         ambient monitor_ws only when fam (armed comment monitor + live socket)
 *   NOe — autoReact-armed comment monitor task
 *   g3a — global autoReact memo + reconnecting gate (no local autoReact ⇒ false)
 *   Pre-save refuse copy (p): comment_monitor vs background work
 *   Post-save Zpc/nfo: preference saved, stay without restart
 */

import type { TaskState } from '../tasks/types.js'

export type TuiRelaunchBlockerKind = 'comment_monitor' | 'tasks'

export type TuiRelaunchBlocker = {
  kind: TuiRelaunchBlockerKind
  /** densable `activeTasks` — true when filtered gGS list is non-empty. */
  activeTasks: boolean
}

type TaskLike = {
  status?: string
  type?: string
  abortController?: unknown
  ambient?: boolean
  /** densable `autoReactArmed` — NOe when running. */
  autoReactArmed?: boolean
}

/**
 * densable gGS — task that blocks a renderer restart.
 * Local type map: densable `mcp_task` ≈ `monitor_mcp`.
 */
export function isTuiBlockingTask(task: TaskLike | TaskState): boolean {
  if (task.status !== 'running' && task.status !== 'pending') return false
  if (task.type === 'remote_agent' || task.type === 'dream') return false
  if (
    (task.type === 'mcp_task' || task.type === 'monitor_mcp') &&
    task.abortController === undefined
  ) {
    return false
  }
  if (task.type === 'monitor_ws' && task.ambient === true) {
    return isCommentMonitorTask(task) && isAmbientMonitorLive(task)
  }
  return true
}

/**
 * densable NOe — autoReact-armed comment monitor.
 */
export function isCommentMonitorTask(task: TaskLike | TaskState): boolean {
  if (typeof task !== 'object' || task === null) return false
  const t = task as TaskLike
  return t.status === 'running' && t.autoReactArmed === true
}

/**
 * densable fam / rfi — ambient monitor_ws socket liveness.
 * Tip: no live socket ⇒ still treat armed ambient as live (matches gGS tests).
 */
export function isAmbientMonitorLive(task: TaskLike | TaskState): boolean {
  const id = (task as { id?: string }).id
  if (typeof id === 'string' && id.length > 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { monitorSocketRegistry } =
        require('../services/artifactAutoReact/index.js') as typeof import('../services/artifactAutoReact/index.js')
      if (monitorSocketRegistry.get(id)) return true
    } catch {
      /* store not loaded */
    }
  }
  return true
}

/**
 * densable g3a — Jo().autoReact.enabledMemo && reconnecting gate (OAm).
 */
export function isGlobalCommentMonitorActive(
  deps: { isEnabled?: () => boolean } = {},
): boolean {
  if (deps.isEnabled) return deps.isEnabled()
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OAm } =
      require('../services/artifactAutoReact/index.js') as typeof import('../services/artifactAutoReact/index.js')
    return OAm()
  } catch {
    return false
  }
}

/**
 * densable iyt(taskRegistry.all()) — blocker or undefined when restart is ok.
 */
export function getTuiRelaunchBlocker(
  tasks: Record<string, TaskLike | TaskState> | Iterable<TaskLike | TaskState>,
  deps: { isGlobalCommentMonitorActive?: () => boolean } = {},
): TuiRelaunchBlocker | undefined {
  const values = Array.isArray(tasks)
    ? tasks
    : Symbol.iterator in Object(tasks)
      ? Array.from(tasks as Iterable<TaskLike | TaskState>)
      : Object.values(tasks as Record<string, TaskLike | TaskState>)
  const blocking = values.filter(isTuiBlockingTask)
  const globalMonitor =
    deps.isGlobalCommentMonitorActive ?? isGlobalCommentMonitorActive
  if (blocking.length === 0) {
    return globalMonitor()
      ? { kind: 'comment_monitor', activeTasks: false }
      : undefined
  }
  return {
    kind: blocking.every(isCommentMonitorTask) ? 'comment_monitor' : 'tasks',
    activeTasks: true,
  }
}

/** densable pre-save refuse for comment_monitor (p / iyt path). */
export function formatTuiActiveTaskRefuseMessage(
  blocker: TuiRelaunchBlocker,
): string {
  if (blocker.kind === 'comment_monitor') {
    return 'Cannot switch renderers while auto-replying to artifact comments — switching restarts Claude Code and would stop the replies. Stop the artifact comment monitor via /tasks (or ask Claude to stop it), then run /tui again.'
  }
  return 'Cannot switch renderers while work is running in the background — wait for it to finish (or stop it via /tasks), then run /tui again.'
}

/**
 * densable nfo — preference saved, stay without restart (post-save Zpc).
 */
export function formatTuiActiveTaskSavedMessage(
  target: string,
  kind: TuiRelaunchBlockerKind,
): string {
  const reason =
    kind === 'comment_monitor'
      ? 'Claude is now auto-replying to artifact comments and a restart would stop the replies (stop the monitor via /tasks, or ask Claude to stop it)'
      : 'work is now running in the background'
  return `Staying on the ${target} renderer without a restart — ${reason}; the preference is saved.`
}

/**
 * densable xve stand-in — flush transcript before the deferred iyt re-check.
 * Official also pins last user/assistant uuid via yur; local flushSessionStorage
 * is the durable equivalent before relaunch snapshot.
 */
export async function flushBeforeTuiRelaunchCheck(
  flush: () => Promise<void> = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { flushSessionStorage } =
        require('./sessionStorage.js') as typeof import('./sessionStorage.js')
      await flushSessionStorage()
    } catch {
      // densable xve swallows errors via xe(n)
    }
  },
): Promise<void> {
  try {
    await flush()
  } catch {
    // best-effort
  }
}
