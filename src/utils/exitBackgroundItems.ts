/**
 * densable Jeh / Zeh portable — exit-confirm background work list.
 * Gold: skip remote_agent / dream (unless includeDream) / ambient monitor_ws /
 * idle in_process_teammate; append session cron as "scheduled task".
 *
 * wZt (Ctrl+C) uses Jeh(tasks); /exit wO0 uses Zeh() from GJr inFlightSnapshot.
 */
import { getSessionCronTasks } from '../bootstrap/state.js'
import { isBackgroundTask, type TaskState } from '../tasks/types.js'
import type { BgInFlightSnapshot } from './bgNeedsInputBridge.js'
import { getBgInFlightRegistry } from './bgNeedsInputBridge.js'
import {
  buildJFaInFlightSnapshot,
  resolveSessionTodos,
} from './task/jfaInFlightStamp.js'
import type { TodoItem } from './todo/types.js'
import { plural, truncateAtWordBoundary } from './stringUtils.js'

export const EXIT_BG_DETAIL_MAX = 50

export type ExitBackgroundWorkItem = {
  label: string
  detail: string
}

const TASK_TYPE_LABELS: Record<string, string> = {
  local_agent: 'subagent',
  local_workflow: 'workflow',
  local_bash: 'shell',
  monitor_mcp: 'monitor',
  monitor_ws: 'monitor',
  mcp_task: 'MCP task',
  in_process_teammate: 'teammate',
  dream: 'dream',
  auto_mode_scan: 'auto-mode scan',
  local_memory_import: 'memory import',
  post_turn_memory: 'memory save',
  remote_agent: 'cloud session',
}

function isTerminalTaskStatus(status: unknown): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'killed' ||
    status === 'cancelled' ||
    status === 'stopped'
  )
}

function isTaskAborted(task: TaskState): boolean {
  switch (task.type) {
    case 'local_agent':
      return (
        'abortController' in task &&
        (task as { abortController?: AbortController }).abortController?.signal
          .aborted === true
      )
    case 'in_process_teammate':
      return (
        'currentWorkAbortController' in task &&
        (task as { currentWorkAbortController?: AbortController })
          .currentWorkAbortController?.signal.aborted === true
      )
    case 'local_bash':
      return (
        'shellCommand' in task &&
        (task as { shellCommand?: { status?: string } }).shellCommand
          ?.status === 'killed'
      )
    default:
      return false
  }
}

function isMonitorTask(task: TaskState): boolean {
  return (
    (task.type === 'local_bash' &&
      'kind' in task &&
      (task as { kind?: string }).kind === 'monitor') ||
    task.type === 'monitor_mcp' ||
    ((task as { type?: string }).type === 'monitor_ws' &&
      !isAmbientMonitor(task))
  )
}

function isIdleTeammate(task: TaskState): boolean {
  if (task.type !== 'in_process_teammate') return false
  const t = task as {
    isIdle?: boolean
    awaitingPlanApproval?: boolean
    pendingUserMessages?: unknown[]
  }
  return (
    t.isIdle === true &&
    !t.awaitingPlanApproval &&
    !(Array.isArray(t.pendingUserMessages) && t.pendingUserMessages.length > 0)
  )
}

/** densable Jeh ambient skip — only `monitor_ws && ambient` (not monitor_mcp). */
function isAmbientMonitor(task: TaskState): boolean {
  return (
    (task as { type?: string }).type === 'monitor_ws' &&
    'ambient' in task &&
    (task as { ambient?: boolean }).ambient === true
  )
}

/** densable nth — abandon / LAc summary kind label. */
function abandonKindLabel(task: TaskState): string {
  if (
    task.type === 'local_bash' &&
    'kind' in task &&
    (task as { kind?: string }).kind === 'monitor'
  ) {
    return 'monitor'
  }
  return TASK_TYPE_LABELS[task.type] ?? task.type
}

function detailOf(description: string | undefined): string {
  if (!description) return ''
  return truncateAtWordBoundary(description, EXIT_BG_DETAIL_MAX)
}

/** densable XFl — session cron rows for exit / left-arrow lists. */
export function listScheduledTaskItems(
  cronFilter?: (cron: { id: string; prompt: string; cron: string }) => boolean,
): ExitBackgroundWorkItem[] {
  const out: ExitBackgroundWorkItem[] = []
  for (const c of getSessionCronTasks()) {
    if (cronFilter && !cronFilter(c)) continue
    const prompt = typeof c.prompt === 'string' ? c.prompt : ''
    out.push({
      label: 'scheduled task',
      detail: detailOf(prompt),
    })
  }
  return out
}

/**
 * Official 2.1.328 (#620) `sHr(tasks, { backgroundOnly, includeDream })` —
 * unified background work list used by both Ctrl+D (`backgroundOnly: true`)
 * and `/exit` (`backgroundOnly: false`), skipping terminal/stopped/aborted
 * tasks (including stopped workflows).
 */
export function listExitBackgroundItems(
  tasks: Record<string, TaskState> | null | undefined,
  opts: { includeDream?: boolean; backgroundOnly?: boolean } = {},
): ExitBackgroundWorkItem[] {
  const includeDream = opts.includeDream === true
  const backgroundOnly = opts.backgroundOnly ?? true
  const taskList = Object.values(tasks ?? {})
  const deadAgentIds = new Set<string>()
  for (const task of taskList) {
    if (
      task.type === 'local_agent' &&
      'agentType' in task &&
      (task as { agentType?: string }).agentType !== 'main-session' &&
      (isTaskAborted(task) || task.status === 'killed')
    ) {
      const agentId =
        (task as { agentId?: string; id?: string }).agentId ?? task.id
      if (agentId) deadAgentIds.add(agentId)
    }
  }
  const items: ExitBackgroundWorkItem[] = []
  for (const task of taskList) {
    if (isTerminalTaskStatus(task.status)) continue
    if (backgroundOnly && !isBackgroundTask(task)) continue
    if (isTaskAborted(task)) continue
    if (task.type === 'remote_agent') continue
    if (!includeDream && task.type === 'dream') continue
    if ((task as { type?: string }).type === 'post_turn_memory') continue
    if (isAmbientMonitor(task)) continue
    if (isIdleTeammate(task)) continue
    if (task.type === 'local_bash') {
      const agentId = (task as { agentId?: string }).agentId
      if (agentId && deadAgentIds.has(agentId)) continue
      // #1593: Skip tasks marked stopsOnExit (e.g. plugin monitors).
      if (
        'stopsOnExit' in task &&
        (task as { stopsOnExit?: boolean }).stopsOnExit === true
      ) {
        continue
      }
    }
    const label = isMonitorTask(task)
      ? 'monitor'
      : (TASK_TYPE_LABELS[task.type] ?? task.type)
    const description =
      'description' in task && typeof task.description === 'string'
        ? task.description
        : undefined
    items.push({ label, detail: detailOf(description) })
  }
  items.push(...listScheduledTaskItems())
  return items
}

/** densable qfE — fan kind → Lbs label for Zeh. */
const ZEH_KIND_LABELS: Record<string, string> = {
  agent: 'subagent',
  workflow: 'workflow',
  shell: 'shell',
  monitor: 'monitor',
  mcp: 'MCP task',
}

export type ListExitInFlightOpts = {
  /**
   * When provided, uses the unified 2.1.328 `sHr` task listing (`backgroundOnly: false`)
   * so `/exit` and Ctrl+D describe running work identically and ignore stopped workflows.
   */
  tasks?: Record<string, TaskState> | null
  todos?: TodoItem[] | null
  /** Override registry / live build (tests). */
  snapshot?: BgInFlightSnapshot | null
  /** Optional background-only filter (defaults to false for `/exit`). */
  backgroundOnly?: boolean
}

/**
 * Official 2.1.328 (#620): when called with live `tasks` (as `/exit` does),
 * delegates to the unified `listExitBackgroundItems` (`sHr`, `backgroundOnly: false`)
 * so `/exit` and Ctrl+D describe running work identically and stopped workflows
 * are never reported. Keeps snapshot-based fallback for explicit snapshot callers.
 */
export function listExitInFlightItems(
  opts: ListExitInFlightOpts = {},
): ExitBackgroundWorkItem[] {
  if (opts.snapshot === undefined && opts.tasks !== undefined) {
    return listExitBackgroundItems(opts.tasks, {
      backgroundOnly: opts.backgroundOnly ?? false,
    })
  }

  const snap =
    opts.snapshot ??
    (opts.tasks !== undefined
      ? buildJFaInFlightSnapshot({
          tasks: opts.tasks ?? {},
          todos: opts.todos !== undefined ? opts.todos : resolveSessionTodos(),
        })
      : getBgInFlightRegistry())

  const items: ExitBackgroundWorkItem[] = []
  for (const n of snap.items ?? []) {
    const kind = typeof n.kind === 'string' ? n.kind : ''
    if (kind === 'todo') continue
    if (n.doneAt !== undefined) continue
    const label = ZEH_KIND_LABELS[kind] ?? kind
    const rawLabel = typeof n.label === 'string' ? n.label : undefined
    items.push({ label, detail: detailOf(rawLabel) })
  }
  if ((snap.kinds ?? []).includes('auto_mode_scan')) {
    items.push({
      label: TASK_TYPE_LABELS.auto_mode_scan ?? 'auto-mode scan',
      detail: 'environment scan for /auto-mode-setup',
    })
  }
  items.push(...listScheduledTaskItems())
  return items
}

/**
 * densable rAt on abandonable set — subtitle for LAc ("… will be stopped").
 * `isCarried` / `cronFilter` mirror gold omitBy(eligible||frameLive) + !LAt.
 */
export function summarizeAbandonableWork(
  tasks: Record<string, TaskState> | null | undefined,
  isCarried: (task: TaskState) => boolean,
  cronFilter?: (cron: { id: string; prompt: string; cron: string }) => boolean,
): { count: number; kinds: string[]; summary: string } {
  const abandonable: TaskState[] = []
  const kinds: string[] = []
  for (const task of Object.values(tasks ?? {})) {
    if (!isBackgroundTask(task)) continue
    if (task.type === 'remote_agent' || task.type === 'dream') continue
    if (isAmbientMonitor(task)) continue
    if (isCarried(task)) continue
    abandonable.push(task)
    const kind = abandonKindLabel(task)
    if (!kinds.includes(kind)) kinds.push(kind)
  }
  const cronItems = listScheduledTaskItems(cronFilter)
  if (cronItems.length > 0 && !kinds.includes('session_cron')) {
    kinds.push('session_cron')
  }
  // densable Y3t / nth — summary uses same labels as kinds (not raw task.type).
  const typeBits = abandonable.map(abandonKindLabel)
  const uniqueTypes = [...new Set(typeBits)]
  const parts = [
    uniqueTypes.join(', '),
    cronItems.length > 0
      ? `${cronItems.length} ${plural(cronItems.length, 'loop')}`
      : '',
  ].filter(Boolean)
  return {
    count: abandonable.length + cronItems.length,
    kinds,
    summary: parts.join(', '),
  }
}
