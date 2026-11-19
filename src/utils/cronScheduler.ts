// Non-React scheduler core for .claude/scheduled_tasks.json.
// Shared by REPL (via useScheduledTasks) and SDK/-p mode (print.ts).
//
// Lifecycle: poll getScheduledTasksEnabled() until true (flag flips when
// CronCreate runs or a skill on: trigger fires) → load tasks + watch the
// file + start a 1s check timer → on fire, call onFire(prompt). stop()
// tears everything down.

import type { FSWatcher } from 'chokidar'
import { lstat } from 'fs/promises'
import { join } from 'path'
import {
  getProjectRoot,
  getScheduledTasksEnabled,
  getSessionCronTasks,
  getSessionId,
  onSessionSwitch,
  removeSessionCronTasks,
  setScheduledTasksEnabled,
} from '../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { cronToHuman } from './cron.js'
import {
  type CronJitterConfig,
  type CronTask,
  DEFAULT_CRON_JITTER_CONFIG,
  findMissedTasks,
  getCronFilePath,
  getOwnProcStartToken,
  hasCronTasksSync,
  jitteredNextCronRunMs,
  markCronTasksFired,
  oneShotJitteredNextCronRunMs,
  peekOwnProcStartToken,
  readCronTasks,
  removeCronTasks,
  writeCronTasks,
} from './cronTasks.js'
import {
  releaseSchedulerLock,
  tryAcquireSchedulerLock,
} from './cronTasksLock.js'
import { logForDebugging } from './debug.js'
import { getErrnoCode } from './errors.js'
import { getProcessStartTime, isProcessRunning } from './genericProcessUtils.js'
import { getProjectDir } from './sessionStoragePortable.js'
import { validateUuid } from './uuid.js'

const CHECK_INTERVAL_MS = 1000
const FILE_STABILITY_MS = 300
// How often a non-owning session re-probes the scheduler lock. Coarse
// because takeover only matters when the owning session has crashed.
const LOCK_PROBE_INTERVAL_MS = 5000
const PID_TOKEN_CACHE_TTL_MS = 60_000

function canonicalizeProjectPath(p: string): string {
  const normalized = p.replaceAll('\\', '/')
  return process.platform === 'win32' || process.platform === 'darwin'
    ? normalized.toLowerCase()
    : normalized
}

async function findTranscriptSessions(
  tasks: CronTask[],
  currentSessionId: string | undefined,
  projectRoot: string,
): Promise<Set<string>> {
  const projectDir = getProjectDir(projectRoot)
  const found = new Set<string>()
  const toCheck = new Set<string>()
  for (const { createdBySessionId } of tasks) {
    if (
      createdBySessionId !== undefined &&
      createdBySessionId !== currentSessionId
    ) {
      toCheck.add(createdBySessionId)
    }
  }
  await Promise.all(
    Array.from(toCheck, async sid => {
      if (validateUuid(sid) === null) return
      const exists = await lstat(join(projectDir, `${sid}.jsonl`)).then(
        stat => stat.isFile(),
        err => {
          const code = getErrnoCode(err)
          if (code !== 'ENOENT' && code !== 'ENOTDIR') {
            logForDebugging(
              `[ScheduledTasks] could not look for a transcript of task creator ${sid} (${code}); treating it as not found`,
            )
          }
          return false
        },
      )
      if (exists) found.add(sid)
    }),
  )
  if (found.size < toCheck.size) {
    logForDebugging(
      `[ScheduledTasks] found no transcript in ${projectDir} for ${toCheck.size - found.size} other session(s) named in scheduled_tasks.json (a file copied from another checkout looks like this); this session will not run their tasks`,
    )
  }
  return found
}
/**
 * True when a recurring task was created more than `maxAgeMs` ago and should
 * be deleted on its next fire. Permanent tasks never age. `maxAgeMs === 0`
 * means unlimited (never ages out). Sourced from
 * {@link CronJitterConfig.recurringMaxAgeMs} at call time.
 * Extracted for testability — the scheduler's check() is buried under
 * setInterval/chokidar/lock machinery.
 */
export function isRecurringTaskAged(
  t: CronTask,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  if (maxAgeMs === 0) return false
  return Boolean(t.recurring && !t.permanent && nowMs - t.createdAt >= maxAgeMs)
}

/**
 * Official 2.1.325 #2356: scheduled / `/loop` turn marker passed alongside
 * cron fire callbacks so SkillTool (`isScheduledOrLoopSkillExecution`) can
 * require confirmation for skills declaring `allowed-tools` or `hooks`.
 */
export type CronFireMetadata = {
  isCron: true
  isScheduledTask: true
  isLoop: boolean
  taskId?: string
  kind?: CronTask['kind']
  querySource: 'cron_loop' | 'cron_scheduled'
}

export function buildCronFireMetadata(
  task?: Pick<CronTask, 'id' | 'kind'>,
): CronFireMetadata {
  const isLoop = task?.kind === 'loop'
  return {
    isCron: true,
    isScheduledTask: true,
    isLoop,
    ...(task?.id !== undefined ? { taskId: task.id } : {}),
    ...(task?.kind !== undefined ? { kind: task.kind } : {}),
    querySource: isLoop ? 'cron_loop' : 'cron_scheduled',
  }
}

type CronSchedulerOptions = {
  /** Called when a task fires (regular or missed-on-startup). */
  onFire: (prompt: string, meta?: CronFireMetadata) => void
  /** While true, firing is deferred to the next tick. */
  isLoading: () => boolean
  /**
   * When true, bypasses the isLoading gate in check() and auto-enables the
   * scheduler without waiting for setScheduledTasksEnabled(). The
   * auto-enable is the load-bearing part — assistant mode has tasks in
   * scheduled_tasks.json at install time and shouldn't wait on a loader
   * skill to flip the flag. The isLoading bypass is minor post-#20425
   * (assistant mode now idles between turns like a normal REPL).
   */
  assistantMode?: boolean
  /**
   * When provided, receives the full CronTask on normal fires (and onFire is
   * NOT called for that fire). Lets daemon callers see the task id/cron/etc
   * instead of just the prompt string. Returning `true` defers deletion of
   * one-shot tasks until the passed `remove()` callback is invoked.
   */
  onFireTask?: (
    task: CronTask,
    remove?: () => void,
    meta?: CronFireMetadata,
  ) => boolean | undefined
  /**
   * When provided, receives the missed one-shot tasks on initial load (and
   * onFire is NOT called with the pre-formatted notification). Daemon decides
   * how to surface them. Returning an array of task IDs keeps those tasks
   * from being immediately removed from disk.
   */
  onMissed?: (
    tasks: CronTask[],
    remove?: (toRemove: CronTask[]) => void,
  ) => string[] | undefined
  /**
   * Directory containing .claude/scheduled_tasks.json. When provided, the
   * scheduler never touches bootstrap state: getProjectRoot/getSessionId are
   * not read, and the getScheduledTasksEnabled() poll is skipped (enable()
   * runs immediately on start). Required for Agent SDK daemon callers.
   */
  dir?: string
  /**
   * Owner key written into the lock file. Defaults to getSessionId().
   * Daemon callers must pass a stable per-process UUID since they have no
   * session. PID remains the liveness probe regardless.
   */
  lockIdentity?: string
  /**
   * Returns the cron jitter config to use for this tick. Called once per
   * check() cycle. REPL callers pass a GrowthBook-backed implementation
   * (see cronJitterConfig.ts) for live tuning — ops can widen the jitter
   * window mid-session during a :00 load spike without restarting clients.
   * Agent SDK daemon callers omit this and get DEFAULT_CRON_JITTER_CONFIG,
   * which is safe since daemons restart on config change anyway, and the
   * growthbook.ts → config.ts → commands.ts → REPL chain stays out of
   * sdk.mjs.
   */
  getJitterConfig?: () => CronJitterConfig
  /**
   * Killswitch: polled once per check() tick. When true, check() bails
   * before firing anything — existing crons stop dead mid-session. CLI
   * callers inject `() => !isKairosCronEnabled()` so flipping the
   * tengu_kairos_cron gate off stops already-running schedulers (not just
   * new ones). Daemon callers omit this, same rationale as getJitterConfig.
   */
  isKilled?: () => boolean
  /**
   * Per-task gate applied before any side effect. Tasks returning false are
   * invisible to this scheduler: never fired, never stamped with
   * `lastFiredAt`, never deleted, never surfaced as missed, absent from
   * `getNextFireTime()`. The daemon cron worker uses `t => t.permanent` so
   * non-permanent tasks in the same scheduled_tasks.json are untouched.
   */
  filter?: (t: CronTask) => boolean
}

export type CronScheduler = {
  start: () => void
  stop: () => void
  /**
   * densable `checkNow` — run a check tick immediately (e.g. after a turn
   * ends so a just-armed keepalive can fire without waiting for the 1s poll).
   */
  checkNow: () => void
  /**
   * Epoch ms of the soonest scheduled fire across all loaded tasks, or null
   * if nothing is scheduled (no tasks, or all tasks already in-flight).
   * Daemon callers use this to decide whether to tear down an idle agent
   * subprocess or keep it warm for an imminent fire.
   */
  getNextFireTime: () => number | null
  /** True when any eligible task is currently due to fire. */
  isFireDue: () => boolean
}

export function createCronScheduler(
  options: CronSchedulerOptions,
): CronScheduler {
  const {
    onFire,
    isLoading,
    assistantMode = false,
    onFireTask,
    onMissed,
    dir,
    lockIdentity,
    getJitterConfig,
    isKilled,
    filter,
  } = options
  const lockOpts = dir || lockIdentity ? { dir, lockIdentity } : undefined

  // File-backed tasks only. Session tasks (durable: false) are NOT loaded
  // here — they can be added/removed mid-session with no file event, so
  // check() reads them fresh from bootstrap state on every tick instead.
  let tasks: CronTask[] = []
  // Per-task next-fire times (epoch ms).
  const nextFireAt = new Map<string, number>()
  // Ids we've already enqueued a "missed task" prompt for — prevents
  // re-asking on every file change before the user answers.
  const missedAsked = new Set<string>()
  // Tasks currently enqueued but not yet removed from the file. Prevents
  // double-fire if the interval ticks again before removeCronTasks lands.
  const inFlight = new Set<string>()

  let enablePoll: ReturnType<typeof setInterval> | null = null
  let checkTimer: ReturnType<typeof setInterval> | null = null
  let lockProbeTimer: ReturnType<typeof setInterval> | null = null
  let watcher: FSWatcher | null = null
  let stopped = false
  let isOwner = false

  // Gold N8o (#212 & #2139): capture a stable lockIdentity at scheduler creation
  // and pass it explicitly in lockOpts so /clear, /resume, or /branch changing
  // getSessionId() never leaves a mismatched lock owner key behind, preventing
  // another session or this session from taking over ended-session tasks.
  const lockSessionId = dir !== undefined ? lockIdentity : getSessionId()
  const effectiveLockOpts =
    dir !== undefined || lockSessionId !== undefined
      ? { dir, lockIdentity: lockSessionId }
      : lockOpts
  const sessionIds = new Set<string>()
  let unsubscribeSessionSwitch: (() => void) | null = null
  let transcriptSessions = new Set<string>()
  let canonicalProjectRoot = ''
  const pidTokenCache = new Map<
    number,
    { at: number; token: string | undefined }
  >()

  function isPidDeadOrRecycled(
    pid: number,
    expectedProcStart: string | undefined,
  ): boolean {
    if (!isProcessRunning(pid)) {
      pidTokenCache.delete(pid)
      return true
    }
    if (expectedProcStart === undefined) return false
    const now = Date.now()
    let cached = pidTokenCache.get(pid)
    if (!cached || now - cached.at >= PID_TOKEN_CACHE_TTL_MS) {
      cached = { at: now, token: getProcessStartTime(pid) }
      pidTokenCache.set(pid, cached)
    }
    return cached.token !== undefined && cached.token !== expectedProcStart
  }

  function isSameProject(t: CronTask): boolean {
    if (t.createdInProject !== undefined) {
      return (
        canonicalizeProjectPath(t.createdInProject) === canonicalProjectRoot
      )
    }
    return (
      t.createdBySessionId !== undefined &&
      transcriptSessions.has(t.createdBySessionId)
    )
  }

  function canRunTask(t: CronTask): boolean {
    if (t.createdBySessionId === undefined) return isOwner
    if (t.createdBySessionId === lockSessionId) return true
    if (
      sessionIds.has(t.createdBySessionId) &&
      t.createdByPid === process.pid &&
      (t.createdByProcStart === undefined
        ? t.createdAt >= performance.timeOrigin
        : t.createdByProcStart === peekOwnProcStartToken())
    ) {
      return true
    }
    return (
      isOwner &&
      isSameProject(t) &&
      (t.createdByPid === undefined ||
        isPidDeadOrRecycled(t.createdByPid, t.createdByProcStart))
    )
  }

  function removeFileTasks(toRemove: CronTask[]): void {
    if (toRemove.length === 0) return
    void removeCronTasks(
      toRemove.map(t => t.id),
      dir,
    ).catch(e =>
      logForDebugging(`[ScheduledTasks] failed to remove tasks: ${e}`, {
        level: 'error',
      }),
    )
  }

  async function load(initial: boolean) {
    const next = await readCronTasks(dir)
    const projectRoot = dir ?? getProjectRoot()
    const foundSessions = await findTranscriptSessions(
      next.filter(t => t.createdInProject === undefined),
      lockSessionId,
      projectRoot,
    )
    if (stopped) return
    tasks = next
    transcriptSessions = foundSessions
    canonicalProjectRoot = canonicalizeProjectPath(projectRoot)

    // Only surface missed tasks on initial load. Chokidar-triggered
    // reloads leave overdue tasks to check() (which anchors from createdAt
    // and fires immediately). This avoids a misleading "missed while Claude
    // was not running" prompt for tasks that became overdue mid-session.
    //
    // Recurring tasks are NOT surfaced or deleted — check() handles them
    // correctly (fires on first tick, reschedules forward). Only one-shot
    // missed tasks need user input (run once now, or discard forever).
    if (!initial) return

    let refreshedPids = false
    for (const t of next) {
      if (
        lockSessionId !== undefined &&
        t.createdBySessionId === lockSessionId &&
        t.createdByPid !== process.pid
      ) {
        t.createdByPid = process.pid
        t.createdByProcStart = getOwnProcStartToken()
        refreshedPids = true
      }
    }
    if (refreshedPids) {
      await writeCronTasks(next, dir).catch(e =>
        logForDebugging(`[ScheduledTasks] failed to refresh task pids: ${e}`),
      )
    }

    const now = Date.now()
    const missed = findMissedTasks(next, now).filter(
      t =>
        !t.recurring &&
        !missedAsked.has(t.id) &&
        (!filter || filter(t)) &&
        canRunTask(t),
    )
    if (missed.length > 0) {
      for (const t of missed) {
        missedAsked.add(t.id)
        // Prevent check() from re-firing the raw prompt while the async
        // removeCronTasks + chokidar reload chain is in progress.
        nextFireAt.set(t.id, Infinity)
      }
      logEvent('tengu_scheduled_task_missed', {
        count: missed.length,
        taskIds: missed
          .map(t => t.id)
          .join(
            ',',
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      let keptBack = new Set<string>()
      if (onMissed) {
        keptBack = new Set(onMissed(missed, removeFileTasks) ?? [])
        for (const id of keptBack) missedAsked.add(id)
      } else {
        onFire(buildMissedTaskNotification(missed), buildCronFireMetadata())
      }
      removeFileTasks(missed.filter(t => !keptBack.has(t.id)))
      logForDebugging(
        `[ScheduledTasks] surfaced ${missed.length - keptBack.size} missed one-shot task(s), kept back ${keptBack.size}`,
      )
    }
  }

  function check() {
    if (isKilled?.()) return
    if (isLoading() && !assistantMode) return
    const now = Date.now()
    const seen = new Set<string>()
    // File-backed recurring tasks that fired this tick. Batched into one
    // markCronTasksFired call after the loop so N fires = one write. Session
    // tasks excluded — they die with the process, no point persisting.
    const firedFileRecurring: string[] = []
    // Read once per tick. REPL callers pass getJitterConfig backed by
    // GrowthBook so a config push takes effect without restart. Daemon and
    // SDK callers omit it and get DEFAULT_CRON_JITTER_CONFIG (safe — jitter
    // is an ops lever for REPL fleet load-shedding, not a daemon concern).
    const jitterCfg = getJitterConfig?.() ?? DEFAULT_CRON_JITTER_CONFIG

    // Shared loop body. `isSession` routes the one-shot cleanup path:
    // session tasks are removed synchronously from memory, file tasks go
    // through the async removeCronTasks + chokidar reload.
    function process(t: CronTask, isSession: boolean) {
      if (filter && !filter(t)) return
      seen.add(t.id)
      if (inFlight.has(t.id)) return
      // densable mGa enabled flip — disabled tasks stay on disk but do not fire
      if (t.enabled === false) return

      let next = nextFireAt.get(t.id)
      if (next === undefined) {
        // First sight — anchor from lastFiredAt (recurring) or createdAt.
        // Never-fired recurring tasks use createdAt: if isLoading delayed
        // this tick past the fire time, anchoring from `now` would compute
        // next-year for pinned crons (`30 14 27 2 *`). Fired-before tasks
        // use lastFiredAt: the reschedule below writes `now` back to disk,
        // so on next process spawn first-sight computes the SAME newNext we
        // set in-memory here. Without this, a daemon child despawning on
        // idle loses nextFireAt and the next spawn re-anchors from 10-day-
        // old createdAt → fires every task every cycle.
        next = t.recurring
          ? (jitteredNextCronRunMs(
              t.cron,
              t.lastFiredAt ?? t.createdAt,
              t.id,
              jitterCfg,
            ) ?? Infinity)
          : (oneShotJitteredNextCronRunMs(
              t.cron,
              t.createdAt,
              t.id,
              jitterCfg,
            ) ?? Infinity)
        nextFireAt.set(t.id, next)
        logForDebugging(
          `[ScheduledTasks] scheduled ${t.id} for ${next === Infinity ? 'never' : new Date(next).toISOString()}`,
        )
      }

      if (now < next) return

      logForDebugging(
        `[ScheduledTasks] firing ${t.id}${t.recurring ? ' (recurring)' : ''}`,
      )
      logEvent('tengu_scheduled_task_fire', {
        recurring: t.recurring ?? false,
        taskId:
          t.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      let deferDelete = false
      const fireMeta = buildCronFireMetadata(t)
      if (onFireTask) {
        deferDelete =
          onFireTask(t, () => removeFileTasks([t]), fireMeta) === true
      } else {
        onFire(t.prompt, fireMeta)
      }

      // Aged-out recurring tasks fall through to the one-shot delete paths
      // below (session tasks get synchronous removal; file tasks get the
      // async inFlight/chokidar path). Fires one last time, then is removed.
      const aged = isRecurringTaskAged(t, now, jitterCfg.recurringMaxAgeMs)
      if (aged) {
        const ageHours = Math.floor((now - t.createdAt) / 1000 / 60 / 60)
        logForDebugging(
          `[ScheduledTasks] recurring task ${t.id} aged out (${ageHours}h since creation), deleting after final fire`,
        )
        logEvent('tengu_scheduled_task_expired', {
          taskId:
            t.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ageHours,
        })
      }

      if (t.recurring && !aged) {
        // Recurring: reschedule from now (not from next) to avoid rapid
        // catch-up if the session was blocked. Jitter keeps us off the
        // exact :00 wall-clock boundary every cycle.
        const newNext =
          jitteredNextCronRunMs(t.cron, now, t.id, jitterCfg) ?? Infinity
        nextFireAt.set(t.id, newNext)
        // Persist lastFiredAt=now so next process spawn reconstructs this
        // same newNext on first-sight. Session tasks skip — process-local.
        if (!isSession) firedFileRecurring.push(t.id)
      } else if (isSession) {
        // One-shot (or aged-out recurring) session task: synchronous memory
        // removal. No inFlight window — the next tick will read a session
        // store without this id.
        removeSessionCronTasks([t.id])
        nextFireAt.delete(t.id)
      } else if (deferDelete) {
        missedAsked.add(t.id)
        nextFireAt.set(t.id, Infinity)
      } else {
        // One-shot (or aged-out recurring) file task: delete from disk.
        // inFlight guards against double-fire during the async
        // removeCronTasks + chokidar reload.
        inFlight.add(t.id)
        nextFireAt.set(t.id, Infinity)
        void removeCronTasks([t.id], dir)
          .catch(e =>
            logForDebugging(
              `[ScheduledTasks] failed to remove task ${t.id}: ${e}`,
            ),
          )
          .finally(() => inFlight.delete(t.id))
      }
    }

    // File-backed tasks: filtered per-task by canRunTask(t) so tasks owned
    // by this session/process (including across /resume, /branch, /clear)
    // run even if another session holds the lock, while legacy/dead-PID
    // same-project tasks run when isOwner is true.
    for (const t of tasks) {
      if (canRunTask(t)) process(t, false)
    }
    // Batched lastFiredAt write. inFlight guards against double-fire
    // during the chokidar-triggered reload (same pattern as removeCronTasks
    // below) — the reload re-seeds `tasks` with the just-written
    // lastFiredAt, and first-sight on that yields the same newNext we
    // already set in-memory, so it's idempotent even without inFlight.
    // Guarding anyway keeps the semantics obvious.
    if (firedFileRecurring.length > 0) {
      for (const id of firedFileRecurring) inFlight.add(id)
      void markCronTasksFired(firedFileRecurring, now, dir)
        .catch(e =>
          logForDebugging(
            `[ScheduledTasks] failed to persist lastFiredAt: ${e}`,
          ),
        )
        .finally(() => {
          for (const id of firedFileRecurring) inFlight.delete(id)
        })
    }
    // Session-only tasks: process-private, the lock does not apply — the
    // other session cannot see them and there is no double-fire risk. Read
    // fresh from bootstrap state every tick (no chokidar, no load()). This
    // is skipped on the daemon path (`dir !== undefined`) which never
    // touches bootstrap state.
    if (dir === undefined) {
      for (const t of getSessionCronTasks()) process(t, true)
    }

    if (seen.size === 0) {
      // No live tasks this tick — clear the whole schedule so
      // getNextFireTime() returns null. The eviction loop below is
      // unreachable here (seen is empty), so stale entries would
      // otherwise survive indefinitely and keep the daemon agent warm.
      nextFireAt.clear()
      return
    }
    // Evict schedule entries for tasks no longer present. When !isOwner,
    // file-task ids aren't in `seen` and get evicted — harmless: they
    // re-anchor from createdAt on the first owned tick.
    for (const id of nextFireAt.keys()) {
      if (!seen.has(id)) nextFireAt.delete(id)
    }
  }

  async function enable() {
    if (stopped) return
    if (enablePoll) {
      clearInterval(enablePoll)
      enablePoll = null
    }

    const { default: chokidar } = await import('chokidar')
    if (stopped) return

    // Acquire the per-project scheduler lock. Only the owning session runs
    // check(). Other sessions probe periodically to take over if the owner
    // dies. Prevents double-firing when multiple Claudes share a cwd.
    isOwner = await tryAcquireSchedulerLock(effectiveLockOpts).catch(
      () => false,
    )
    if (stopped) {
      if (isOwner) {
        isOwner = false
        void releaseSchedulerLock(effectiveLockOpts)
      }
      return
    }
    if (!isOwner) {
      lockProbeTimer = setInterval(() => {
        void tryAcquireSchedulerLock(effectiveLockOpts)
          .then(owned => {
            if (stopped) {
              if (owned) void releaseSchedulerLock(effectiveLockOpts)
              return
            }
            if (owned) {
              isOwner = true
              if (lockProbeTimer) {
                clearInterval(lockProbeTimer)
                lockProbeTimer = null
              }
              // Official 2.1.323 (#2139): refresh tasks & check immediately upon
              // taking over ownership so ended-session tasks run without delay.
              void load(false).then(() => {
                if (!stopped) check()
              })
            }
          })
          .catch(e => logForDebugging(String(e), { level: 'error' }))
      }, LOCK_PROBE_INTERVAL_MS)
      lockProbeTimer.unref?.()
    }

    void load(true)

    const path = getCronFilePath(dir)
    const attachWatcher = (create: () => FSWatcher): FSWatcher => {
      const w = create()
      // densable #14: unhandled chokidar 'error' can crash process
      w.on('error', (err: unknown) => {
        logForDebugging(`[ScheduledTasks] watcher error: ${err}`, {
          level: 'warn',
        })
      })
      const onChangeOrAdd = () => {
        if (stopped || watcher !== w) return
        watcher = attachWatcher(create)
        watcher.once('ready', () => void load(false))
        w.close().catch(err =>
          logForDebugging(`[ScheduledTasks] watcher close failed: ${err}`, {
            level: 'warn',
          }),
        )
      }
      w.on('add', onChangeOrAdd)
      w.on('change', onChangeOrAdd)
      w.on('unlink', () => {
        if (!stopped) {
          tasks = []
          // Only evict file-backed tasks; preserve session tasks' nextFireAt.
          const keep = new Set<string>()
          if (dir === undefined) {
            for (const t of getSessionCronTasks()) keep.add(t.id)
          }
          for (const id of nextFireAt.keys()) {
            if (!keep.has(id)) nextFireAt.delete(id)
          }
        }
      })
      return w
    }
    watcher = attachWatcher(() =>
      chokidar.watch(path, {
        persistent: false,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: FILE_STABILITY_MS },
        ignorePermissionErrors: true,
      }),
    )

    checkTimer = setInterval(check, CHECK_INTERVAL_MS)
    // Don't keep the process alive for the scheduler alone — in -p text mode
    // the process should exit after the single turn even if a cron was created.
    checkTimer.unref?.()
  }

  return {
    start() {
      stopped = false
      // Daemon path (dir explicitly given): don't touch bootstrap state —
      // getScheduledTasksEnabled() would read a never-initialized flag. The
      // daemon is asking to schedule; just enable.
      if (dir !== undefined) {
        logForDebugging(
          `[ScheduledTasks] scheduler start() — dir=${dir}, hasTasks=${hasCronTasksSync(dir)}`,
        )
        void enable()
        return
      }
      logForDebugging(
        `[ScheduledTasks] scheduler start() — enabled=${getScheduledTasksEnabled()}, hasTasks=${hasCronTasksSync()}`,
      )
      sessionIds.add(getSessionId())
      unsubscribeSessionSwitch ??= onSessionSwitch(newId => {
        sessionIds.add(newId)
        if (!stopped && checkTimer !== null) {
          void load(false)
        }
      })
      // Auto-enable when scheduled_tasks.json has entries. CronCreateTool
      // also sets this when a task is created mid-session.
      if (
        !getScheduledTasksEnabled() &&
        (assistantMode || hasCronTasksSync())
      ) {
        setScheduledTasksEnabled(true)
      }
      if (getScheduledTasksEnabled()) {
        void enable()
        return
      }
      enablePoll = setInterval(
        en => {
          if (getScheduledTasksEnabled()) void en()
        },
        CHECK_INTERVAL_MS,
        enable,
      )
      enablePoll.unref?.()
    },
    stop() {
      stopped = true
      unsubscribeSessionSwitch?.()
      unsubscribeSessionSwitch = null
      if (enablePoll) {
        clearInterval(enablePoll)
        enablePoll = null
      }
      if (checkTimer) {
        clearInterval(checkTimer)
        checkTimer = null
      }
      if (lockProbeTimer) {
        clearInterval(lockProbeTimer)
        lockProbeTimer = null
      }
      void watcher?.close()
      watcher = null
      if (isOwner) {
        isOwner = false
        void releaseSchedulerLock(effectiveLockOpts)
      }
    },
    checkNow() {
      if (stopped) return
      check()
    },
    getNextFireTime() {
      // nextFireAt uses Infinity for "never" (in-flight one-shots, bad cron
      // strings). Filter those out so callers can distinguish "soon" from
      // "nothing pending".
      let min = Infinity
      for (const t of nextFireAt.values()) {
        if (t < min) min = t
      }
      return min === Infinity ? null : min
    },
    isFireDue() {
      if (isKilled?.()) return false
      const now = Date.now()
      const jitterCfg = getJitterConfig?.() ?? DEFAULT_CRON_JITTER_CONFIG
      const due = (t: CronTask, isSession: boolean): boolean => {
        if (t.enabled === false) return false
        const scheduled =
          nextFireAt.get(t.id) ??
          (t.recurring
            ? jitteredNextCronRunMs(
                t.cron,
                t.lastFiredAt ?? t.createdAt,
                t.id,
                jitterCfg,
              )
            : oneShotJitteredNextCronRunMs(
                t.cron,
                t.createdAt,
                t.id,
                jitterCfg,
              ))
        return (
          scheduled !== null &&
          now >= scheduled &&
          t.agentId === undefined &&
          (!filter || filter(t)) &&
          !inFlight.has(t.id) &&
          (isSession || !missedAsked.has(t.id))
        )
      }
      return (
        tasks.some(t => due(t, false) && canRunTask(t)) ||
        (dir === undefined && getSessionCronTasks().some(t => due(t, true)))
      )
    },
  }
}

/**
 * Build the missed-task notification text. Guidance precedes the task list
 * and the list is wrapped in a code fence so a multi-line imperative prompt
 * is not interpreted as immediate instructions to avoid self-inflicted
 * prompt injection. The full prompt body is preserved — this path DOES
 * need the model to execute the prompt after user
 * confirmation, and tasks are already deleted from JSON before the model
 * sees this notification.
 */
export function buildMissedTaskNotification(missed: CronTask[]): string {
  const plural = missed.length > 1
  const header =
    `The following one-shot scheduled task${plural ? 's were' : ' was'} missed while Claude was not running. ` +
    `${plural ? 'They have' : 'It has'} already been removed from .claude/scheduled_tasks.json.\n\n` +
    `Do NOT execute ${plural ? 'these prompts' : 'this prompt'} yet. ` +
    `First use the AskUserQuestion tool to ask whether to run ${plural ? 'each one' : 'it'} now. ` +
    `Only execute if the user confirms.`

  const blocks = missed.map(t => {
    const meta = `[${cronToHuman(t.cron)}, created ${new Date(t.createdAt).toLocaleString()}]`
    // Use a fence one longer than any backtick run in the prompt so a
    // prompt containing ``` cannot close the fence early and un-wrap the
    // trailing text (CommonMark fence-matching rule).
    const longestRun = (t.prompt.match(/`+/g) ?? ([] as string[])).reduce(
      (max: number, run: string) => Math.max(max, run.length),
      0,
    )
    const fence = '`'.repeat(Math.max(3, longestRun + 1))
    return `${meta}\n${fence}\n${t.prompt}\n${fence}`
  })

  return `${header}\n\n${blocks.join('\n\n')}`
}
