/**
 * Fleet needs-input nudge store — official `_zp` / `S3o` densable (2.1.208).
 *
 * Polls daemon job state and exposes `{ needsInput, done, succeeded }` for the
 * REPL footer FFe ("← N agent(s)") when GrowthBook
 * `tengu_fleet_needs_input_nudge` is on.
 *
 * Timing (official):
 *   - sweepMs (Zdb) = 10_000 — poll while focused and fleet has active jobs
 *   - flash window after needsInput increases: 2_500ms (Hzp, in UI)
 *   - open-via-left attribution window (Xdb) = 120_000ms
 *   - ignored-after timer (Qdb) = 1_800_000ms (30m)
 */

import { feature } from 'bun:bundle'
import { getSessionId } from '../bootstrap/state.js'
import { listAllJobs, type BgJobState } from '../daemon/jobState.js'
import { logEvent } from '../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getIsRemoteMode } from '../bootstrap/state.js'

export type FleetNudgeSnapshot = {
  needsInput: number
  done: number
  succeeded: number
}

export type FleetNudgeFlash = 'none' | 'awaiting' | 'done'

const SWEEP_MS = 10_000
const OPEN_VIA_LEFT_WINDOW_MS = 120_000
const IGNORED_AFTER_MS = 1_800_000

export function isFleetNeedsInputNudgeEnabled(): boolean {
  if (!feature('BG_SESSIONS')) return false
  if (getIsRemoteMode()) return false
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_fleet_needs_input_nudge',
    false,
  )
}

/**
 * Official yzp: terminal job, excluding "success + open PR needing review"
 * (those stay in the review band, not done).
 * Local: terminal states; review exclusion when children include open PRs and
 * state is done (best-effort without gh).
 */
export function isTerminalFleetJob(job: BgJobState): boolean {
  if (
    job.state !== 'done' &&
    job.state !== 'failed' &&
    job.state !== 'stopped' &&
    job.state !== 'crashed'
  ) {
    return false
  }
  // Success + open PR children → treat as non-terminal for done-count (review).
  if (job.state === 'done' && hasOpenPrChild(job)) {
    return false
  }
  return true
}

function hasOpenPrChild(job: BgJobState): boolean {
  const children = job.children ?? []
  return children.some(c => c.kind !== 'frame' && c.href?.includes('/pull/'))
}

/**
 * Official epb: non-terminal + tempo blocked + needs !== empty-sentinel.
 * Local: blocked tempo with needs text or permission block questions.
 */
export function jobNeedsInput(job: BgJobState): boolean {
  if (isTerminalFleetJob(job)) return false
  if (job.tempo !== 'blocked') return false
  if (job.needs && job.needs.trim().length > 0) return true
  if (job.block?.questions && job.block.questions.length > 0) return true
  return false
}

export function jobSucceeded(job: BgJobState): boolean {
  return job.state === 'done' && !hasOpenPrChild(job)
}

export function classifyFleetJobs(
  jobs: Array<{ short: string; state: BgJobState }>,
  currentSessionId?: string | null,
): FleetNudgeSnapshot & { active: number } {
  let needsInput = 0
  let done = 0
  let succeeded = 0
  let active = 0
  for (const { state: job } of jobs) {
    if (
      currentSessionId &&
      (job.sessionId === currentSessionId ||
        job.resumeSessionId === currentSessionId)
    ) {
      continue
    }
    if (isTerminalFleetJob(job)) {
      done++
      if (jobSucceeded(job)) succeeded++
      continue
    }
    active++
    if (jobNeedsInput(job)) needsInput++
  }
  return { needsInput, done, succeeded, active }
}

type Listener = () => void

class FleetNeedsInputNudgeStore {
  private snapshot: FleetNudgeSnapshot | undefined
  private listeners = new Set<Listener>()
  private subCount = 0
  private started = false
  private focused = true
  private sweepTimer: ReturnType<typeof setTimeout> | null = null
  private ignoreTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private rerun = false
  /** Timestamp when needsInput last increased (for open-via-left attribution). */
  private increasedAt = 0
  private readonly sweepMs: number
  private readonly ignoredAfterMs: number

  constructor(opts?: { sweepMs?: number; ignoredAfterMs?: number }) {
    this.sweepMs = opts?.sweepMs ?? SWEEP_MS
    this.ignoredAfterMs = opts?.ignoredAfterMs ?? IGNORED_AFTER_MS
  }

  getSnapshot = (): FleetNudgeSnapshot | undefined => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    this.subCount++
    if (!this.started) {
      this.started = true
      if (this.snapshot === undefined) {
        void this.refetch()
      } else {
        this.scheduleSweep()
      }
    }
    let closed = false
    return () => {
      if (closed) return
      closed = true
      this.listeners.delete(listener)
      this.subCount--
      if (this.subCount === 0) this.stop()
    }
  }

  setFocused(focused: boolean): void {
    if (focused === this.focused) return
    this.focused = focused
    if (!this.started) return
    if (focused) void this.refetch()
    else this.clearSweep()
  }

  /**
   * Official Szp / recordOpenViaLeft — call when user opens fleet via ←.
   * Emits tengu event if within attribution window of a needsInput increase.
   */
  recordOpenViaLeft(): FleetNudgeSnapshot | undefined {
    this.clearIgnore()
    if (
      this.increasedAt > 0 &&
      Date.now() - this.increasedAt <= OPEN_VIA_LEFT_WINDOW_MS
    ) {
      logEvent('tengu_fleet_needs_input_nudge', {
        opened: true,
      })
      this.increasedAt = 0
    }
    return this.snapshot
  }

  refetch = (): Promise<void> => this.poll()

  /** Test-only: inject snapshot without disk I/O. */
  _setSnapshotForTests(s: FleetNudgeSnapshot | undefined): void {
    this.snapshot = s
    this.emit()
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  private async poll(): Promise<void> {
    this.clearSweep()
    if (this.inFlight) {
      this.rerun = true
      return this.inFlight
    }
    this.inFlight = this.sweep().finally(() => {
      this.inFlight = null
      if (this.rerun) {
        this.rerun = false
        void this.poll()
      }
    })
    return this.inFlight
  }

  private async sweep(): Promise<void> {
    let jobs: Array<{ short: string; state: BgJobState }> = []
    try {
      jobs = await listAllJobs()
    } catch {
      jobs = []
    }
    if (!this.started) return

    let currentSessionId: string | null = null
    try {
      currentSessionId = getSessionId()
    } catch {
      currentSessionId = null
    }

    const next = classifyFleetJobs(jobs, currentSessionId)
    if (next.needsInput === 0) {
      this.clearIgnore()
      this.increasedAt = 0
    }

    const prev = this.snapshot
    if (
      prev?.needsInput !== next.needsInput ||
      prev?.done !== next.done ||
      prev?.succeeded !== next.succeeded
    ) {
      const increased = prev !== undefined && next.needsInput > prev.needsInput
      this.snapshot = {
        needsInput: next.needsInput,
        done: next.done,
        succeeded: next.succeeded,
      }
      logEvent('tengu_fleet_nudge_state', {
        needs_input_count: next.needsInput,
        done_count: next.done,
        succeeded_count: next.succeeded,
        increased,
      })
      if (increased) {
        this.increasedAt = Date.now()
        this.armIgnore()
      }
      this.emit()
    } else if (this.snapshot === undefined) {
      this.snapshot = {
        needsInput: next.needsInput,
        done: next.done,
        succeeded: next.succeeded,
      }
      this.emit()
    }

    if (next.active > 0 && this.focused) {
      this.scheduleSweep()
    }
  }

  private scheduleSweep(): void {
    this.clearSweep()
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null
      void this.poll()
    }, this.sweepMs)
    this.sweepTimer.unref?.()
  }

  private clearSweep(): void {
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  private armIgnore(): void {
    this.clearIgnore()
    this.ignoreTimer = setTimeout(() => {
      this.ignoreTimer = null
      logEvent('tengu_fleet_needs_input_nudge', {
        ignored: true,
      })
      this.increasedAt = 0
    }, this.ignoredAfterMs)
    this.ignoreTimer.unref?.()
  }

  private clearIgnore(): void {
    if (this.ignoreTimer) {
      clearTimeout(this.ignoreTimer)
      this.ignoreTimer = null
    }
  }

  private stop(): void {
    this.clearSweep()
    this.rerun = false
    this.started = false
  }
}

let singleton: FleetNeedsInputNudgeStore | null = null

export function getFleetNeedsInputNudgeStore(): FleetNeedsInputNudgeStore {
  return (singleton ??= new FleetNeedsInputNudgeStore())
}

/** Test helper — reset singleton. */
export function _resetFleetNeedsInputNudgeStoreForTests(): void {
  singleton = null
}

export function subscribeFleetNeedsInputNudge(listener: Listener): () => void {
  return getFleetNeedsInputNudgeStore().subscribe(listener)
}

export function getFleetNeedsInputNudgeSnapshot():
  | FleetNudgeSnapshot
  | undefined {
  return getFleetNeedsInputNudgeStore().getSnapshot()
}

export function setFleetNeedsInputNudgeFocused(focused: boolean): void {
  getFleetNeedsInputNudgeStore().setFocused(focused)
}

export function recordFleetOpenViaLeft(): FleetNudgeSnapshot | undefined {
  return getFleetNeedsInputNudgeStore().recordOpenViaLeft()
}

const NOOP_SUBSCRIBE = (_cb: () => void) => () => {}
const EMPTY_SNAPSHOT = (): FleetNudgeSnapshot | undefined => undefined

/**
 * useSyncExternalStore pair — when disabled, no polling subscription.
 */
export function getFleetNudgeExternalStore(enabled: boolean): {
  subscribe: (onStoreChange: () => void) => () => void
  getSnapshot: () => FleetNudgeSnapshot | undefined
} {
  if (!enabled) {
    return { subscribe: NOOP_SUBSCRIBE, getSnapshot: EMPTY_SNAPSHOT }
  }
  return {
    subscribe: subscribeFleetNeedsInputNudge,
    getSnapshot: getFleetNeedsInputNudgeSnapshot,
  }
}
