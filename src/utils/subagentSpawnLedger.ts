/**
 * densable 2.1.289 spawn-handle (`QLe` / class `r`) + web-fetch saved-files
 * bag (`moe`) + worker-checkin (`$Ve` / `HVe` / `UVe` / `jVe` / `Pwr`).
 *
 * Semantic names only — never export minify
 * `QLe|$Ve|HVe|UVe|jVe|Pwr|Fpn|FVe|WLt|BVe|I5|O5|Mv|moe`.
 * `QLe` is a session-object WeakMap bag (`Ct.of(session)`), not `session.root`.
 */
import { getMainThreadAgentId } from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'
import {
  escapeGoalCheckinXml,
  truncateGoalCheckinLine,
} from '../services/goal/goalCheckin.js'
import { getCwd, getCwdOverride } from './cwd.js'
import { logError } from './log.js'
import {
  enqueuePendingNotification,
  peek,
  removeByFilter,
  someInFlightDrainCommand,
} from './messageQueueManager.js'
import { wrapInSystemReminder } from './messages.js'
import { getBootstrapSession } from './sessionRoot.js'
import type { WorkerCheckinBag } from './sessionSlots.js'
import { plural } from './stringUtils.js'
import { isParkedKeepaliveAgent } from './task/framework.js'
import { isTerminalTaskStatus, type TaskStatus } from '../Task.js'

const WEB_FETCH_AGENT_TYPE = 'web-fetch'

/**
 * densable `Ct` — WeakMap keyed on the owner object itself.
 * Copied from settingsCache (`!== undefined` check); not `Ln` (`session.root`).
 */
class WeakOwnerCache<T> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  of(e: object): T {
    const t = this.#t.get(e)
    if (t !== undefined) return t
    const o = this.#e()
    this.#t.set(e, o)
    return o
  }
}

function isBuiltInWebFetchAgent(agent: {
  source?: string
  agentType: string
}): boolean {
  return agent.source === 'built-in' && agent.agentType === WEB_FETCH_AGENT_TYPE
}

export type SpawnedSubagentHandle = {
  completed: () => void
  failed: () => void
  killed: (by?: 'user' | 'parent' | 'system') => void
  cancelledAfterCompletion: () => void
}

export type WebFetchSavedFiles = {
  dirs: string[]
  paths: string[]
}

type SpawnCounts = {
  spawned: number
  started_in_background: number
  spawned_by_subagents: number
  max_depth: number
  completed: number
  failed: number
  requested: { unset: number; background: number; foreground: number }
  killed: { user: number; parent: number; system: number }
  refused: Record<string, number>
}

function emptyCounts(): SpawnCounts {
  return {
    spawned: 0,
    started_in_background: 0,
    spawned_by_subagents: 0,
    max_depth: 0,
    completed: 0,
    failed: 0,
    requested: { unset: 0, background: 0, foreground: 0 },
    killed: { user: 0, parent: 0, system: 0 },
    refused: {},
  }
}

class SpawnHandle implements SpawnedSubagentHandle {
  #counts: SpawnCounts
  #terminal: 'completed' | 'failed' | 'killed' | undefined
  constructor(counts: SpawnCounts) {
    this.#counts = counts
  }
  completed(): void {
    if (this.#stamp('completed')) this.#counts.completed += 1
  }
  failed(): void {
    if (this.#stamp('failed')) this.#counts.failed += 1
  }
  killed(by?: 'user' | 'parent' | 'system'): void {
    if (this.#stamp('killed')) this.#counts.killed[by ?? 'user'] += 1
  }
  cancelledAfterCompletion(): void {
    if (this.#terminal === 'completed') {
      this.#counts.completed -= 1
      this.#terminal = undefined
    }
    this.killed('user')
  }
  #stamp(kind: 'completed' | 'failed' | 'killed'): boolean {
    if (this.#terminal !== undefined) return false
    this.#terminal = kind
    return true
  }
}

class SubagentSpawnLedger {
  #counts = emptyCounts()
  #byType = new Map<string, number>()
  recordSpawn(input: {
    agentType: string
    runInBackground?: boolean
    runsInBackground?: boolean
    depth: number
  }): SpawnedSubagentHandle {
    const counts = this.#counts
    counts.spawned += 1
    const requestedKey =
      input.runInBackground === undefined
        ? 'unset'
        : input.runInBackground
          ? 'background'
          : 'foreground'
    counts.requested[requestedKey] += 1
    if (input.runsInBackground) counts.started_in_background += 1
    this.#byType.set(
      input.agentType,
      (this.#byType.get(input.agentType) ?? 0) + 1,
    )
    counts.max_depth = Math.max(counts.max_depth, input.depth)
    if (input.depth > 1) counts.spawned_by_subagents += 1
    return new SpawnHandle(counts)
  }
  recordRefused(reason: string): void {
    this.#counts.refused[reason] = (this.#counts.refused[reason] ?? 0) + 1
  }
  snapshot(): SpawnCounts & { by_type: Record<string, number> } {
    const e = this.#counts
    return {
      ...e,
      requested: { ...e.requested },
      killed: { ...e.killed },
      refused: { ...e.refused },
      by_type: Object.fromEntries(this.#byType),
    }
  }
  reset(): void {
    Object.assign(this.#counts, emptyCounts())
    this.#byType.clear()
  }
}

const spawnLedgers = new WeakOwnerCache(() => new SubagentSpawnLedger())

export function subagentSpawnLedgerOf(session: object): SubagentSpawnLedger {
  return spawnLedgers.of(session)
}

export function recordSubagentSpawn(
  input: {
    agentType: string
    runInBackground?: boolean
    runsInBackground?: boolean
    depth: number
  },
  session: object = getBootstrapSession(),
): SpawnedSubagentHandle {
  return subagentSpawnLedgerOf(session).recordSpawn(input)
}

export function recordSubagentSpawnRefused(
  reason: string,
  session: object = getBootstrapSession(),
): void {
  subagentSpawnLedgerOf(session).recordRefused(reason)
}

export function snapshotSubagentSpawnLedger(
  session: object = getBootstrapSession(),
): ReturnType<SubagentSpawnLedger['snapshot']> {
  return subagentSpawnLedgerOf(session).snapshot()
}

export function resetSubagentSpawnLedgerForTests(): void {
  subagentSpawnLedgerOf(getBootstrapSession()).reset()
}

/**
 * densable `moe` — built-in web-fetch saved-files bag. Empty when a cwd
 * override ALS is active (worktree / explicit cwd); otherwise `{dirs:[cwd]}`.
 */
export function defaultWebFetchSavedFiles(
  cwdOverride?: string,
): WebFetchSavedFiles {
  if (cwdOverride !== undefined) return { dirs: [], paths: [] }
  try {
    return { dirs: [getCwd()], paths: [] }
  } catch {
    return { dirs: [], paths: [] }
  }
}

export function webFetchSavedFilesForAgent(agent: {
  source?: string
  agentType: string
}): WebFetchSavedFiles | undefined {
  if (!isBuiltInWebFetchAgent(agent)) return undefined
  // densable moe — eS() ALS, not the spawn cwd argument.
  return defaultWebFetchSavedFiles(getCwdOverride())
}

/** densable `vwr` — poll floor 60s. */
export const WORKER_CHECKIN_POLL_FLOOR_MS = 60_000

const WORKER_CHECKIN_PARKED_REASON_PREFIXES = [
  'bash:',
  'agent:',
  'workflow:',
] as const

const WORKER_CHECKIN_SUMMARY_MAX = 80
const WORKER_CHECKIN_ACTIVITY_MAX = 60
const WORKER_CHECKIN_LIST_MAX = 10

const WORKER_CHECKIN_ORIGIN = {
  kind: 'task-notification',
  source: 'worker-checkin',
} as const

export type WorkerCheckinTaskRegistry = {
  all(): Record<string, unknown>
}

type WorkerCheckinTaskLike = {
  id: string
  type?: string
  status?: TaskStatus | string
  agentType?: string
  isObserver?: boolean
  isIdle?: boolean
  description?: string
  startTime?: number
  keepaliveReasons?: Set<string>
  progress?: {
    toolUseCount?: number
    lastActivity?: {
      toolName?: string
      activityDescription?: string
      recordedAtMs?: number
    }
  }
}

type SessionScratchLike = {
  workerCheckin(): WorkerCheckinBag | undefined
  replaceWorkerCheckin(bag: WorkerCheckinBag | undefined): void
}

/**
 * densable `Fpn` — parse `CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE` (comma seconds
 * 1..86400 → ms). Undefined when coordinator/auto-bg gate is off or schedule
 * malformed. Does not invent a default schedule.
 */
export function parseWorkerCheckinScheduleMs(
  env: NodeJS.ProcessEnv = process.env,
): number[] | undefined {
  const coordinator =
    env.CLAUDE_CODE_COORDINATOR_MODE === '1' ||
    env.CLAUDE_CODE_COORDINATOR_MODE === 'true'
  const autoBg =
    env.CLAUDE_AUTO_BACKGROUND_TASKS === '1' ||
    env.CLAUDE_AUTO_BACKGROUND_TASKS === 'true'
  if (!coordinator && !autoBg) return undefined
  const raw = env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
  if (raw === undefined || raw.trim() === '') return undefined
  const parts = raw.split(',').map(s => s.trim())
  if (
    !parts.every(p => /^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= 86400)
  ) {
    return undefined
  }
  return parts.map(p => Number(p) * 1000)
}

/** densable `FVe(checkinCount, scheduleMs, pollMs)` → ticks until next fire. */
export function workerCheckinTicksUntil(
  checkinCount: number,
  scheduleMs: number[],
  pollMs: number,
): number {
  if (scheduleMs.length === 0 || pollMs <= 0) return 0
  const slot = scheduleMs[Math.min(checkinCount, scheduleMs.length - 1)]!
  return Math.ceil(slot / pollMs)
}

export function resetWorkerCheckinForTests(): void {
  try {
    const scratch = getBootstrapSession().sessionScratch
    clearWorkerCheckinTimer(scratch)
  } catch {
    // bootstrap session optional in unit tests
  }
}

/** densable `I5` — running non-observer, non-main-session local_agent. */
function isLiveDispatchedWorker(task: WorkerCheckinTaskLike): boolean {
  return (
    task.type === 'local_agent' &&
    task.isObserver !== true &&
    task.agentType !== 'main-session' &&
    !isTerminalTaskStatus((task.status ?? 'running') as never)
  )
}

/**
 * densable `O5` — parked keepalive holding bash:/agent:/workflow: reasons.
 */
function isParkedBackgroundWorker(task: WorkerCheckinTaskLike): boolean {
  if (
    task.type !== 'local_agent' ||
    task.isObserver === true ||
    task.agentType === 'main-session' ||
    !isParkedKeepaliveAgent({
      type: task.type,
      status: task.status as TaskStatus | undefined,
      keepaliveReasons: task.keepaliveReasons,
    })
  ) {
    return false
  }
  const reasons = task.keepaliveReasons ?? new Set<string>()
  return [...reasons].some(reason =>
    WORKER_CHECKIN_PARKED_REASON_PREFIXES.some(prefix =>
      reason.startsWith(prefix),
    ),
  )
}

function isWorkerCheckinNotification(cmd: {
  origin?: { kind?: string; source?: unknown }
}): boolean {
  return (
    cmd.origin?.kind === 'task-notification' &&
    cmd.origin.source === 'worker-checkin'
  )
}

function collapseWorkerCheckinText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function formatWorkerCheckinLine(text: string, max: number): string {
  return truncateGoalCheckinLine(collapseWorkerCheckinText(text), max)
}

function minutesAgoLabel(ageMs: number): string {
  return `~${Math.floor(ageMs / 60_000)} minutes ago`
}

function formatWorkerStillRunningLine(
  task: WorkerCheckinTaskLike,
  nowMs: number,
): string {
  const parts: string[] = []
  const toolUseCount = task.progress?.toolUseCount ?? 0
  if (toolUseCount === 0) {
    parts.push('no tool calls yet')
  } else {
    parts.push(`${toolUseCount} ${plural(toolUseCount, 'tool call')}`)
    const last = task.progress?.lastActivity
    const activity = last?.activityDescription ?? last?.toolName
    if (activity) {
      const clipped = formatWorkerCheckinLine(
        activity,
        WORKER_CHECKIN_ACTIVITY_MAX,
      )
      parts.push(
        last?.recordedAtMs !== undefined
          ? `last tool call ${minutesAgoLabel(nowMs - last.recordedAtMs)}: ${clipped}`
          : `last tool call: ${clipped}`,
      )
    }
  }
  if (task.isIdle) parts.push('waiting on a subagent')
  if (isParkedBackgroundWorker(task)) {
    parts.push('agent finished; parked on pending background work')
  }
  return `- ${formatWorkerCheckinLine(task.description ?? task.id, WORKER_CHECKIN_SUMMARY_MAX)} (${parts.join(', ')})`
}

function formatStillRunningWorkersBody(
  workers: WorkerCheckinTaskLike[],
  nowMs: number,
): string {
  const sorted = workers.toSorted(
    (a, b) => (a.startTime ?? 0) - (b.startTime ?? 0),
  )
  const live = sorted.filter(task => !isParkedBackgroundWorker(task))
  const parked = sorted.filter(task => isParkedBackgroundWorker(task))
  const lines = [...live, ...parked]
    .slice(0, WORKER_CHECKIN_LIST_MAX)
    .map(task => formatWorkerStillRunningLine(task, nowMs))
  const overflow = sorted.length - WORKER_CHECKIN_LIST_MAX
  if (overflow > 0) lines.push(`- …and ${overflow} more`)
  return `Still running:\n${lines.join('\n')}`
}

function formatWorkerCheckinNotification(
  summary: string,
  body: string,
): string {
  return `<task-notification>
<summary>${escapeGoalCheckinXml(summary)}</summary>
</task-notification>
${wrapInSystemReminder(body)}`
}

function registryHasOtherLiveWorkers(
  registry: WorkerCheckinTaskRegistry,
  excludeId: string,
): boolean {
  return Object.values(registry.all()).some(raw => {
    const task = raw as WorkerCheckinTaskLike
    return (
      (isLiveDispatchedWorker(task) || isParkedBackgroundWorker(task)) &&
      task.id !== excludeId
    )
  })
}

function resetSoleLiveWorkerTicks(
  bag: WorkerCheckinBag,
  registry: WorkerCheckinTaskRegistry,
  task: WorkerCheckinTaskLike,
): void {
  if (!isLiveDispatchedWorker(task)) return
  const hasOtherLive = Object.values(registry.all()).some(raw => {
    const other = raw as WorkerCheckinTaskLike
    return isLiveDispatchedWorker(other) && other.id !== task.id
  })
  if (!hasOtherLive) {
    bag.checkinCount = 0
    bag.ticksUntilCheckin = workerCheckinTicksUntil(
      0,
      bag.scheduleMs,
      bag.pollMs,
    )
  }
}

function clearWorkerCheckinTimer(scratch: SessionScratchLike): void {
  const bag = scratch.workerCheckin()
  if (bag === undefined) return
  clearInterval(bag.timer)
  scratch.replaceWorkerCheckin(undefined)
  removeByFilter(isWorkerCheckinNotification)
}

function armWorkerCheckinTimer(
  scratch: SessionScratchLike,
  registry: WorkerCheckinTaskRegistry,
  knownWorkerIds: Set<string>,
  armedAtMs: number,
): void {
  const scheduleMs = parseWorkerCheckinScheduleMs()
  if (scheduleMs === undefined) return
  const pollMs = Math.min(WORKER_CHECKIN_POLL_FLOOR_MS, ...scheduleMs)
  const ticksUntilCheckin = workerCheckinTicksUntil(0, scheduleMs, pollMs)
  const timer = setInterval(() => {
    tickWorkerCheckin(scratch)
  }, pollMs)
  timer.unref()
  scratch.replaceWorkerCheckin({
    timer,
    scheduleMs,
    pollMs,
    armedAtMs,
    taskRegistry: registry,
    knownWorkerIds,
    checkinCount: 0,
    ticksUntilCheckin,
  })
}

function rearmWorkerCheckinPreservingKnown(
  scratch: SessionScratchLike,
  registry: WorkerCheckinTaskRegistry,
  taskId: string,
  nowMs: number,
): void {
  const bag = scratch.workerCheckin()
  if (bag === undefined) return
  const known = new Set(bag.knownWorkerIds)
  known.add(taskId)
  clearWorkerCheckinTimer(scratch)
  armWorkerCheckinTimer(scratch, registry, known, nowMs)
}

function tickWorkerCheckin(scratch: SessionScratchLike): void {
  const bag = scratch.workerCheckin()
  if (bag === undefined) return
  try {
    const scheduleMs = parseWorkerCheckinScheduleMs()
    if (scheduleMs === undefined) {
      clearWorkerCheckinTimer(scratch)
      return
    }
    if (scheduleMs.join() !== bag.scheduleMs.join()) {
      const known = new Set(bag.knownWorkerIds)
      const { taskRegistry, armedAtMs } = bag
      clearWorkerCheckinTimer(scratch)
      armWorkerCheckinTimer(scratch, taskRegistry, known, armedAtMs)
      return
    }
    const workers = Object.values(bag.taskRegistry.all())
      .map(raw => raw as WorkerCheckinTaskLike)
      .filter(
        task => isLiveDispatchedWorker(task) || isParkedBackgroundWorker(task),
      )
    if (workers.length === 0) {
      clearWorkerCheckinTimer(scratch)
      return
    }
    if (
      peek(isWorkerCheckinNotification) !== undefined ||
      someInFlightDrainCommand(isWorkerCheckinNotification)
    ) {
      return
    }
    bag.ticksUntilCheckin -= 1
    if (bag.ticksUntilCheckin > 0) return
    const nowMs = Date.now()
    const minutes = Math.floor((nowMs - bag.armedAtMs) / 60_000)
    const summary = 'Worker check-in: dispatched work still running'
    const body = `Check-in: it has been ~${minutes} minutes since you dispatched work that is still running. Check your dispatched workers. If the task is taking longer than expected, change approach and tell the user how much longer you expect the work to take; if the work is on track, keep going — no update needed. If no response is needed, ignore this check-in.
${formatStillRunningWorkersBody(workers, nowMs)}`
    enqueuePendingNotification({
      value: formatWorkerCheckinNotification(summary, body),
      mode: 'task-notification',
      agentId: getMainThreadAgentId(),
      origin: WORKER_CHECKIN_ORIGIN,
      skipAttachments: true,
    })
    bag.checkinCount += 1
    bag.ticksUntilCheckin = workerCheckinTicksUntil(
      bag.checkinCount,
      bag.scheduleMs,
      bag.pollMs,
    )
    logEvent('coordinator_worker_checkin', {})
  } catch (err) {
    logError(err)
    try {
      logEvent('coordinator_worker_checkin', {})
    } catch (inner) {
      logError(inner)
    }
  }
}

/**
 * densable `$Ve` / `HVe` / `UVe` / `jVe` / `Pwr` — post-register worker checkin.
 * Requires taskRegistry host (`{ all: () => tasks }`, typically AppState.tasks).
 * Never export minify `$Ve|HVe|UVe|jVe|Pwr|Fpn|FVe|WLt|BVe|I5|O5`.
 */
export function noteWorkerCheckin(
  task: WorkerCheckinTaskLike,
  taskRegistry?: WorkerCheckinTaskRegistry,
  nowMs: number = Date.now(),
): void {
  try {
    if (!isLiveDispatchedWorker(task)) return
    if (taskRegistry === undefined) return

    let scratch: SessionScratchLike
    try {
      scratch = getBootstrapSession().sessionScratch
    } catch {
      return
    }

    const existing = scratch.workerCheckin()
    if (existing !== undefined) {
      existing.taskRegistry = taskRegistry
      if (existing.knownWorkerIds.has(task.id)) return
      existing.knownWorkerIds.add(task.id)
      if (!registryHasOtherLiveWorkers(taskRegistry, task.id)) {
        rearmWorkerCheckinPreservingKnown(scratch, taskRegistry, task.id, nowMs)
      } else {
        resetSoleLiveWorkerTicks(existing, taskRegistry, task)
      }
      return
    }

    armWorkerCheckinTimer(scratch, taskRegistry, new Set([task.id]), nowMs)
  } catch (err) {
    logError(err)
  }
}
