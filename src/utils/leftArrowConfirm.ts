/**
 * densable Swh / Fan / Uan / Tgn / Ban / LAc / Mu defer helpers for left-arrow.
 * Uses tip buildHandoffEligibilityMap as densable KHe.
 */
import { getSessionCronTasks } from '../bootstrap/state.js'
import { type TaskState } from '../tasks/types.js'
import {
  buildHandoffEligibilityMap,
  collectH8eMonitorSlugs,
  isCronHandoffEligible,
  isHandoffEligible,
  isQHeFrameLiveTask,
  type PortableCronLike,
  type PortableTaskLike,
} from './bgCheckpoint.js'
import { summarizeAbandonableWork } from './exitBackgroundItems.js'
import { plural } from './stringUtils.js'
import { filterAkdTasks, taskKindForInFlight } from './task/jfaInFlightStamp.js'

export type LeftArrowInFlight = {
  count: number
  kinds: string[]
  restartableCount?: number
}

export type LeftArrowConfirmState = {
  inFlight: LeftArrowInFlight
  summary: string
  carryOverCount: number
  monitorParkCount: number
  proceed: () => void
}

/** densable Tgn — Artifact comment monitor subtitle. */
export function formatMonitorParkSubtitle(monitorParkCount: number): string {
  if (monitorParkCount === 0) return ''
  if (monitorParkCount === 1) {
    return "Automatic replies to Artifact comments continue in the background session. You'll see a summary of the replies when you return."
  }
  return `Automatic replies to comments on ${monitorParkCount} Artifacts continue in the background session. You'll see a summary of the replies when you return.`
}

function asPortableTasks(
  tasks: Record<string, TaskState> | null | undefined,
): Record<string, PortableTaskLike> {
  return (tasks ?? {}) as unknown as Record<string, PortableTaskLike>
}

/** densable h8e — qHe monitor slugs ∪ Stn() ∪ wtn(). */
export function collectFrameLiveMonitorSlugs(
  tasks: Record<string, TaskState> | null | undefined,
): Set<string> {
  return collectH8eMonitorSlugs(asPortableTasks(tasks))
}

/** densable Fan — carried (handoff-eligible) count + monitors. */
export function countCarriedWork(
  tasks: Record<string, TaskState> | null | undefined,
  eligibility = buildHandoffEligibilityMap(asPortableTasks(tasks)),
  monitorSlugs = collectFrameLiveMonitorSlugs(tasks),
): number {
  let n = 0
  for (const task of Object.values(tasks ?? {})) {
    if (isHandoffEligible(task.id, eligibility)) n++
  }
  for (const cron of getSessionCronTasks()) {
    if (isCronHandoffEligible(cron as PortableCronLike, eligibility)) n++
  }
  return n + monitorSlugs.size
}

/** densable tte.count approximate — Qeh + cron (+ external monitors not in tip).
 * Gold does NOT add frameLive-on-task slugs into count (those stay in Fan/h8e only).
 * Tip previously double-counted frameLive tasks → false-high Uan/Swh.
 */
export function countActiveInFlight(
  tasks: Record<string, TaskState> | null | undefined,
  _monitorSlugs?: Set<string>,
): LeftArrowInFlight {
  void _monitorSlugs
  const akd = filterAkdTasks(tasks ?? {})
  const kinds: string[] = []
  for (const task of akd) {
    const k = taskKindForInFlight(task)
    if (!kinds.includes(k)) kinds.push(k)
  }
  let count = akd.length
  let restartableCount = 0
  for (const task of Object.values(tasks ?? {})) {
    if (
      task.type === 'local_agent' &&
      task.status === 'running' &&
      'isBackgrounded' in task &&
      task.isBackgrounded !== true &&
      !('parentAgentId' in task && task.parentAgentId)
    ) {
      restartableCount++
    }
  }
  const cronLen = getSessionCronTasks().length
  if (cronLen > 0) {
    count += cronLen
    if (!kinds.includes('session_cron')) kinds.push('session_cron')
  }
  // densable i — Stn/wtn park-only monitors (outside task frameLive) stay
  // out of tte.count; Fan/h8e carries them separately.
  return { count, kinds, restartableCount }
}

/** densable Uan — abandonable (active − carried) count. */
export function countAbandonableLeftArrow(
  tasks: Record<string, TaskState> | null | undefined,
): number {
  const eligibility = buildHandoffEligibilityMap(asPortableTasks(tasks))
  const monitors = collectFrameLiveMonitorSlugs(tasks)
  const carried = countCarriedWork(tasks, eligibility, monitors)
  const active = countActiveInFlight(tasks, monitors).count
  return Math.max(0, active - carried)
}

/** densable Ban — monitors that appeared after left-arrow press. */
export function countNewMonitorsSincePress(
  tasks: Record<string, TaskState> | null | undefined,
  carriedAtPress: ReadonlySet<string>,
): number {
  let n = 0
  for (const slug of collectFrameLiveMonitorSlugs(tasks)) {
    if (!carriedAtPress.has(slug)) n++
  }
  return n
}

/**
 * densable CSt — sticky queue cmds excluded from defer-cap refuse count.
 * Only goal-checkin task-notifications are sticky.
 */
export function isLeftArrowDeferStickyQueueCmd(cmd: {
  origin?: { kind?: string; source?: string } | null
}): boolean {
  return (
    cmd.origin?.kind === 'task-notification' &&
    cmd.origin.source === 'goal-checkin'
  )
}

/**
 * densable WWi — queued cmds that would be lost by skipping ahead (post-query
 * Ki.proceed refuse). Skips CSt sticky; counts later/bash/poll-event/slash.
 */
export function countLeftArrowBlockingQueuedCommands(
  queue: ReadonlyArray<{
    priority?: string
    mode?: string
    value?: unknown
    skipSlashCommands?: boolean
    origin?: { kind?: string; source?: string } | null
  }>,
): number {
  let n = 0
  for (const cmd of queue) {
    if (isLeftArrowDeferStickyQueueCmd(cmd)) continue
    if (cmd.priority === 'later') {
      n++
      continue
    }
    if (cmd.mode === 'bash' || cmd.mode === 'poll-event') {
      n++
      continue
    }
    if (
      typeof cmd.value === 'string' &&
      cmd.value.trim().startsWith('/') &&
      !cmd.skipSlashCommands
    ) {
      n++
    }
  }
  return n
}

/** densable iHt persistence toast (before Ki). */
export const LEFT_ARROW_IHT_PERSISTENCE_TOAST =
  'Cannot open agents — session persistence is disabled, so this conversation cannot be backgrounded.'

/** densable iHt endedByModel toast. Cme() is a no-op (Exa() === ""). */
export const LEFT_ARROW_IHT_ENDED_BY_MODEL_TOAST =
  'Claude ended this conversation. Start a new session (or /clear) to continue.'

/** densable iHt draft toast. */
export const LEFT_ARROW_IHT_DRAFT_TOAST =
  'Cannot open agents — you have unsent text in the input. Send it or clear it first (double-tap esc clears).'

/** densable iHt queued-commands toast (WWi / At). */
export function formatLeftArrowIhtQueuedToast(queuedCount: number): string {
  const n = queuedCount
  return `Cannot open agents — ${n} queued ${plural(n, 'command')} would be lost. Run or clear ${n === 1 ? 'it' : 'them'} first.`
}

export type LeftArrowIhtGateReason =
  | 'persistence'
  | 'ended-by-model'
  | 'queued-commands'
  | 'draft'

export type LeftArrowIhtGateResult =
  | { blocked: false }
  | {
      blocked: true
      reason: LeftArrowIhtGateReason
      toast: string
      /** gold: endedByModel does not emit tengu_left_arrow_blocked */
      emitBlockedEvent: boolean
      inflightCount: number
    }

/**
 * densable iHt four gates after jpt/_r and yi, before Ki.
 * Order: OA() persistence → endedByModel → WWi(queue) → Kb draft.
 */
export function evaluateLeftArrowIhtGates(input: {
  persistenceDisabled: boolean
  endedByModel: boolean
  queuedCount: number
  draft: string
  inFlight: LeftArrowInFlight
}): LeftArrowIhtGateResult {
  const { count } = input.inFlight
  if (input.persistenceDisabled) {
    return {
      blocked: true,
      reason: 'persistence',
      toast: LEFT_ARROW_IHT_PERSISTENCE_TOAST,
      emitBlockedEvent: true,
      inflightCount: count,
    }
  }
  if (input.endedByModel) {
    return {
      blocked: true,
      reason: 'ended-by-model',
      toast: LEFT_ARROW_IHT_ENDED_BY_MODEL_TOAST,
      emitBlockedEvent: false,
      inflightCount: count,
    }
  }
  if (input.queuedCount > 0) {
    return {
      blocked: true,
      reason: 'queued-commands',
      toast: formatLeftArrowIhtQueuedToast(input.queuedCount),
      emitBlockedEvent: true,
      // gold: inflight_count is WWi (queued), not tte.count
      inflightCount: input.queuedCount,
    }
  }
  if (input.draft.trim() !== '') {
    return {
      blocked: true,
      reason: 'draft',
      toast: LEFT_ARROW_IHT_DRAFT_TOAST,
      emitBlockedEvent: true,
      inflightCount: count,
    }
  }
  return { blocked: false }
}

/** densable LEm — defer-cap refused for restartable foreground agents. */
export function formatDeferCapRestartableToast(
  restartableCount: number,
): string {
  const n = restartableCount
  return `Still backgrounding after the current tool — waiting for ${n} running ${plural(n, 'subagent')} so the work carries over. Press ← again to skip ahead and restart ${n === 1 ? 'it' : 'them'} from the beginning.`
}

/** densable second-press abandon toast while defer-armed. */
export function formatDeferSkipAbandonToast(abandonCount: number): string {
  const n = abandonCount
  return `Still backgrounding after the current tool — ${n} background ${plural(n, 'task')} would be abandoned by skipping ahead.`
}

/** densable Ban cancel toast after press. */
export function formatDeferMonitorCancelToast(newMonitorCount: number): string {
  const n = newMonitorCount
  return `Backgrounding cancelled — ${n} Artifact comment ${plural(n, 'monitor')} started after you pressed ←. Press ← again to review and confirm.`
}

/**
 * densable Swh — show LAc when abandonable work remains or monitors park.
 */
export function shouldConfirmLeftArrowBackground(
  tasks: Record<string, TaskState> | null | undefined,
): boolean {
  const monitors = collectFrameLiveMonitorSlugs(tasks)
  return countAbandonableLeftArrow(tasks) > 0 || monitors.size > 0
}

/** Build densable Tt payload; proceed() continues left-arrow handoff. */
export function buildLeftArrowConfirmState(
  tasks: Record<string, TaskState> | null | undefined,
  proceed: (hasAbandonSummary: boolean) => void,
): LeftArrowConfirmState | null {
  if (!shouldConfirmLeftArrowBackground(tasks)) return null
  const eligibility = buildHandoffEligibilityMap(asPortableTasks(tasks))
  const monitors = collectFrameLiveMonitorSlugs(tasks)
  const isCarried = (task: TaskState): boolean =>
    isHandoffEligible(task.id, eligibility) ||
    isQHeFrameLiveTask(task as unknown as PortableTaskLike)
  const { summary } = summarizeAbandonableWork(
    tasks,
    isCarried,
    cron => !isCronHandoffEligible(cron as PortableCronLike, eligibility),
  )
  const fan = countCarriedWork(tasks, eligibility, monitors)
  const monitorParkCount = monitors.size
  return {
    inFlight: countActiveInFlight(tasks, monitors),
    summary,
    carryOverCount: Math.max(0, fan - monitorParkCount),
    monitorParkCount,
    proceed: () => proceed(summary !== ''),
  }
}
