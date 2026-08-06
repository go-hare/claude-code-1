/**
 * densable 2.1.212 JFa / VFa / qFa / zFa / W6e / Akd — full inFlight producer.
 *
 * extract: docs/upstream-extraction/v2.1.212/xSe_JFa.extract.md
 *
 * JFa React mounts in REPL and shs()'s a complete snapshot. Outside React the
 * framework stamp path calls `buildJFaInFlightSnapshot` with live tasks (+ optional
 * todos / tasksV2). Budget uses bootstrap turn counters (vWt/AWt).
 */

import {
  getCurrentTurnTokenBudget,
  getSessionCronTasks,
  getTurnOutputTokens,
} from '../../bootstrap/state.js'
import type { TaskState } from '../../tasks/types.js'
import { isBackgroundTask } from '../../tasks/types.js'
import type { TodoItem } from '../todo/types.js'
import type { Task } from '../tasks.js'
import type { BgInFlightSnapshot } from '../bgNeedsInputBridge.js'

/** densable Vjb=200 — fan item label cap (PYe). */
export const FAN_LABEL_MAX = 200

/** densable qjb — terminal/fail statuses for fan.failed */
const FAN_FAILED = new Set(['failed', 'cancelled', 'killed', 'error'])

export type FanItem = {
  id: string
  kind: string
  label?: string
  group?: string
  startedAt?: number
  doneAt?: number
  failed?: true
}

/** densable PYe — collapse whitespace + Kh(…, Vjb). */
export function formatFanLabel(text: string | undefined | null): string {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length <= FAN_LABEL_MAX) return s
  return s.slice(0, FAN_LABEL_MAX)
}

/** densable rJe — 32-bit string hash for todo: id. */
export function hashString32(s: string): number {
  let t = 0
  for (let r = 0; r < s.length; r++) {
    t = (t << 5) - t + s.charCodeAt(r)
    t |= 0
  }
  return t
}

/**
 * densable c0 — running|pending and not explicitly foreground
 * (`isBackgrounded === false`).
 */
export function isAkdCandidate(task: TaskState): boolean {
  return isBackgroundTask(task)
}

/**
 * densable Akd — background tasks excluding remote_agent / dream / ambient monitor_ws.
 */
export function filterAkdTasks(tasks: Record<string, TaskState>): TaskState[] {
  return Object.values(tasks)
    .filter(isAkdCandidate)
    .filter(t => t.type !== 'remote_agent' && t.type !== 'dream')
    .filter(t => {
      // densable monitor_ws ambient skip (type may not be on TaskState union yet)
      const rt = t as unknown as { type: string; ambient?: boolean }
      if (rt.type === 'monitor_ws' && rt.ambient) return false
      return true
    })
}

/** densable Tkd — kind for W6e kinds list. */
export function taskKindForInFlight(task: TaskState): string {
  if (
    task.type === 'local_bash' &&
    (task as { kind?: string }).kind === 'monitor'
  ) {
    return 'monitor'
  }
  return String(task.type)
}

/**
 * densable W6e — count = Akd + session_cron; kinds unique + session_cron when loops.
 */
export function computeW6e(tasks: Record<string, TaskState>): {
  count: number
  kinds: string[]
  restartableCount: number
} {
  const akd = filterAkdTasks(tasks)
  let cronLen = 0
  try {
    cronLen = getSessionCronTasks().length
  } catch {
    cronLen = 0
  }
  const kinds = [...new Set(akd.map(taskKindForInFlight))]
  if (cronLen > 0) kinds.push('session_cron')
  const restartableCount = Object.values(tasks).filter(
    i =>
      i.type === 'local_agent' &&
      i.status === 'running' &&
      (i as { isBackgrounded?: boolean }).isBackgrounded !== false &&
      (i as { parentAgentId?: string }).parentAgentId === undefined,
  ).length
  return {
    count: akd.length + cronLen,
    kinds,
    restartableCount,
  }
}

function isFailedStatus(status: string): boolean {
  return FAN_FAILED.has(status)
}

/**
 * densable VFa — map AppState.tasks → fan items.
 * Uses string type checks (not exhaustive switch) so densable monitor_ws /
 * mcp_task paths stay portable without widening TaskState.
 */
export function mapTasksToFanItems(
  tasks: Record<string, TaskState>,
): FanItem[] {
  const out: FanItem[] = []
  for (const task of Object.values(tasks)) {
    const r = task as unknown as {
      id: string
      type: string
      status: string
      description: string
      startTime: number
      endTime?: number
      isIdle?: boolean
      kind?: string
      command?: string
      result?: { code?: number }
      server?: string
      tool?: string
      ambient?: boolean
      url?: string
      statusMessage?: string
      serverName?: string
      toolName?: string
      mcpStatus?: string
      title?: string
      workflowName?: string
      workflowProgress?: Array<Record<string, unknown>>
    }
    const failed = isFailedStatus(String(r.status)) || undefined
    if (r.type === 'local_agent' || r.type === 'in_process_teammate') {
      const idleTeammate = r.type === 'in_process_teammate' && Boolean(r.isIdle)
      out.push({
        id: r.id,
        kind: 'agent',
        label: formatFanLabel(r.description),
        startedAt: r.startTime,
        doneAt: r.endTime ?? (idleTeammate ? 0 : undefined),
        failed: failed ? true : undefined,
      })
      continue
    }
    if (r.type === 'local_workflow') {
      const progress = (r.workflowProgress ?? []).filter(
        p => p.type === 'workflow_agent',
      )
      if (progress.length === 0) {
        out.push({
          id: r.id,
          kind: 'workflow',
          label: formatFanLabel(r.title ?? r.workflowName ?? r.description),
          startedAt: r.startTime,
          doneAt: r.endTime,
          failed: failed ? true : undefined,
        })
        continue
      }
      for (const i of progress) {
        const state = String(i.state ?? '')
        const startedAt =
          (typeof i.startedAt === 'number' ? i.startedAt : undefined) ??
          (typeof i.queuedAt === 'number' ? i.queuedAt : undefined) ??
          r.startTime
        let doneAt: number | undefined
        if (state === 'done' || state === 'error') {
          if (typeof i.lastProgressAt === 'number') {
            doneAt = i.lastProgressAt
          } else if (
            typeof i.startedAt === 'number' &&
            typeof i.durationMs === 'number'
          ) {
            doneAt = i.startedAt + i.durationMs
          }
        }
        out.push({
          id: String(i.agentId ?? `${r.id}:${i.index}`),
          kind: 'workflow',
          label: formatFanLabel(String(i.label ?? '')),
          group: typeof i.phaseTitle === 'string' ? i.phaseTitle : undefined,
          startedAt,
          doneAt,
          failed: state === 'error' ? true : undefined,
        })
      }
      continue
    }
    if (r.type === 'local_bash') {
      const kind = r.kind === 'monitor' ? 'monitor' : 'shell'
      const label =
        kind === 'monitor' ? r.description : (r.command ?? r.description)
      const bashFailed =
        failed || (r.result !== undefined && r.result.code !== 0) || undefined
      out.push({
        id: r.id,
        kind,
        label: formatFanLabel(label),
        startedAt: r.startTime,
        doneAt: r.endTime,
        failed: bashFailed ? true : undefined,
      })
      continue
    }
    if (r.type === 'monitor_mcp') {
      out.push({
        id: r.id,
        kind: 'monitor',
        label: formatFanLabel(
          r.description || `${r.server ?? ''} · ${r.tool ?? ''}`,
        ),
        startedAt: r.startTime,
        doneAt: r.endTime,
        failed: failed ? true : undefined,
      })
      continue
    }
    if (r.type === 'monitor_ws') {
      if (r.ambient) continue
      out.push({
        id: r.id,
        kind: 'monitor',
        label: formatFanLabel(r.description || r.url || ''),
        startedAt: r.startTime,
        doneAt: r.endTime,
        failed: failed ? true : undefined,
      })
      continue
    }
    if (r.type === 'mcp_task') {
      out.push({
        id: r.id,
        kind: 'mcp',
        label: formatFanLabel(
          r.statusMessage ?? `${r.serverName ?? ''} · ${r.toolName ?? ''}`,
        ),
        startedAt: r.startTime,
        doneAt: r.endTime,
        failed: failed || r.mcpStatus === 'failed' ? true : undefined,
      })
    }
    // remote_agent / dream / auto_mode_scan — densable skip
  }
  return out
}

/** densable qFa — AppState.todos[session] → fan todos. */
export function mapTodosToFanItems(
  todos: TodoItem[] | undefined | null,
): FanItem[] {
  if (!todos || todos.length === 0) return []
  return todos.map(t => ({
    id: `todo:${hashString32(t.content).toString(36)}`,
    kind: 'todo',
    label: formatFanLabel(
      t.status === 'in_progress' ? t.activeForm : t.content,
    ),
    startedAt: t.status === 'pending' ? undefined : 0,
    doneAt: t.status === 'completed' ? 0 : undefined,
  }))
}

/** densable zFa — TaskCreate list (tasksV2) → fan todos. */
export function mapTaskListToFanItems(
  tasks: Task[] | undefined | null,
): FanItem[] {
  if (!tasks || tasks.length === 0) return []
  return tasks.map(t => ({
    id: `todo:${t.id}`,
    kind: 'todo',
    label: formatFanLabel(
      t.status === 'in_progress' ? (t.activeForm ?? t.subject) : t.subject,
    ),
    startedAt: t.status === 'pending' ? undefined : 0,
    doneAt: t.status === 'completed' ? 0 : undefined,
  }))
}

/** densable AWt/vWt → budget blob or undefined when no target. */
export function snapshotTurnBudget():
  | { spent: number; target: number }
  | undefined {
  const target = getCurrentTurnTokenBudget()
  if (target === null || target === undefined) return undefined
  return { spent: getTurnOutputTokens(), target }
}

export type JFaStampInput = {
  tasks: Record<string, TaskState>
  /** densable Abf — session todos */
  todos?: TodoItem[] | null
  /** densable Tbf — TaskCreate / tasksV2 */
  tasksV2?: Task[] | null
  /** densable PCt — override queue length (tests) */
  queued?: number
}

/**
 * densable JFa body (non-React) — complete shs snapshot.
 * Must pass full snapshot so shs full-replace does not sticky-clear fan/budget
 * incorrectly when budget is intentionally void.
 */
export function buildJFaInFlightSnapshot(
  input: JFaStampInput,
): BgInFlightSnapshot {
  const w6e = computeW6e(input.tasks)
  let queued = input.queued
  if (queued === undefined) {
    try {
      // densable PCt() — full command queue length
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getCommandQueueLength } =
        require('../messageQueueManager.js') as {
          getCommandQueueLength: () => number
        }
      queued = getCommandQueueLength()
    } catch {
      queued = 0
    }
  }
  const items: FanItem[] = [
    ...mapTasksToFanItems(input.tasks),
    ...mapTodosToFanItems(input.todos),
    ...mapTaskListToFanItems(input.tasksV2),
  ]
  const budget = snapshotTurnBudget()
  return {
    tasks: w6e.count,
    queued,
    kinds: w6e.kinds,
    items: items as unknown as Array<Record<string, unknown>>,
    budget,
  }
}

/**
 * densable JFa reads AppState.todos[wt()] via React selector.
 * Non-React stamp path (framework task updates) uses this reader when set by
 * AppStateProvider / JFaInFlightProducer.
 */
export type JFaAppStateSlice = {
  todos?: Record<string, TodoItem[] | undefined>
  tasks?: Record<string, TaskState>
}

let jfaAppStateReader: (() => JFaAppStateSlice | null | undefined) | null = null

/** densable JFa store bridge — set from React tree; clear on unmount. */
export function setJFaAppStateReader(
  reader: (() => JFaAppStateSlice | null | undefined) | null,
): void {
  jfaAppStateReader = reader
}

export function getJFaAppStateReader(): typeof jfaAppStateReader {
  return jfaAppStateReader
}

/** densable Abf — session todos from reader or explicit opts. */
export function resolveSessionTodos(
  explicit?: TodoItem[] | null,
): TodoItem[] | null {
  if (explicit !== undefined) return explicit
  try {
    const slice = jfaAppStateReader?.()
    if (!slice?.todos) return null
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSessionId } = require('../../bootstrap/state.js') as {
      getSessionId: () => string
    }
    const sid = getSessionId()
    return slice.todos[sid] ?? null
  } catch {
    return null
  }
}

/**
 * densable JFa effect — stamp shs when bg job session.
 * Loads tasksV2 from disk; todos from opts or AppState reader (Zjb).
 */
export async function stampJFaInFlightFromLiveState(
  tasks: Record<string, TaskState>,
  opts?: { todos?: TodoItem[] | null },
): Promise<void> {
  try {
    const { isBgJobSession, setBgInFlightRegistry } = await import(
      '../bgNeedsInputBridge.js'
    )
    if (!isBgJobSession()) return

    let tasksV2: Task[] | null = null
    try {
      const { listTasks, getTaskListId } = await import('../tasks.js')
      tasksV2 = await listTasks(getTaskListId())
    } catch {
      tasksV2 = null
    }

    const snap = buildJFaInFlightSnapshot({
      tasks,
      todos: resolveSessionTodos(opts?.todos),
      tasksV2,
    })
    setBgInFlightRegistry(snap)
  } catch {
    // never throw into task path
  }
}
