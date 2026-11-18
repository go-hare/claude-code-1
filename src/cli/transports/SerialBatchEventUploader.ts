import { isDisklessLaunch } from '../../utils/sessionHost.js'
import { jsonStringify } from '../../utils/slowOperations.js'

/**
 * Serial ordered event uploader with batching, retry, and backpressure.
 *
 * - enqueue() adds events to a pending buffer (or urgent lane)
 * - At most 1 POST in-flight at a time
 * - Drains up to maxBatchSize / maxBatchBytes items per POST
 * - New events accumulate while in-flight
 * - Supports hold/release batching, gather timers, together-tied items,
 *   resend-in-two splitting, payload-too-large halving, and undelivered retention
 * - On failure: exponential backoff (clamped), retries indefinitely
 *   until success or close() — unless maxConsecutiveFailures is set,
 *   in which case the failing batch is dropped and drain advances
 * - flush() blocks until pending is empty and kicks drain if needed
 * - Backpressure: enqueue() blocks when maxQueueSize is reached
 */

/**
 * Throw from config.send() to make the uploader wait a server-supplied
 * duration before retrying (e.g. 429 with Retry-After). When retryAfterMs
 * is set, it overrides exponential backoff for that attempt — clamped to
 * [baseDelayMs, maxDelayMs] and jittered so a misbehaving server can
 * neither hot-loop nor stall the client, and many sessions sharing a rate
 * limit don't all pounce at the same instant. Without retryAfterMs, behaves
 * like any other thrown error (exponential backoff).
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

/**
 * Throw when a batch partially failed / was not sent and only items that
 * were previously attempted should retain their sent-before tracking.
 */
export class PartialRetryableError extends RetryableError {}

/**
 * Throw when the server refuses a cuttable batch and wants it split in two.
 */
export class ResendInTwoError extends Error {
  constructor() {
    super('batch refused: resend it in two')
  }
}

/**
 * Throw when a batch was too large; halves the effective byte limit down to
 * at least `minBytes`.
 */
export class PayloadTooLargeError extends Error {
  constructor(
    message: string,
    readonly minBytes: number,
  ) {
    super(message)
  }
}

const INT32_MAX = 2147483647
const MAX_URGENT_STREAK = 4

export type HoldReleaseReason =
  | 'max_age'
  | 'max_events'
  | 'max_bytes'
  | 'cap'
  | 'flush'
  | (string & {})

export type HoldSpec<T> = {
  rule: string
  maxAgeMs: number
  maxItems?: number
  maxBytes?: number
  passes?: (item: T) => boolean
}

export type SendAttemptKind = 'first' | 'resend_with_new' | 'resend'

export type SendMeta = {
  held: boolean
  reason: HoldReleaseReason | 'none'
  heldCount: number
  holdAgeMs: number
  rule: string
  postIndex: number
  retryCount: number
  attempt: SendAttemptKind
  urgent: boolean
  followsUrgent: boolean
  bytes: number
  cuttable: boolean
  mayResendInTwo: () => boolean
}

export type DrainedStats = {
  trigger: HoldReleaseReason | 'close'
  rule: string
  heldEvents: number
  heldMs: number
  posts: number
  rows: number
  maxRowsPost: number
  failedPosts: number
  droppedRows: number
  otherPosts: number
  otherRows: number
  drainMs: number
}

export type EnqueueOptions = {
  urgent?: boolean
  together?: boolean
  release?: HoldReleaseReason
  releasedBy?: string
  since?: number
  waitForMoreMs?: number
}

type DrainCounts = {
  posts: number
  rows: number
  maxRowsPost: number
  failedPosts: number
  droppedRows: number
  otherPosts: number
  otherRows: number
}

const EMPTY_COUNTS: DrainCounts = {
  posts: 0,
  rows: 0,
  maxRowsPost: 0,
  failedPosts: 0,
  droppedRows: 0,
  otherPosts: 0,
  otherRows: 0,
}

type SerialBatchEventUploaderConfig<T> = {
  /** Max items per POST (1 = no batching) */
  maxBatchSize: number
  /**
   * Max serialized bytes per POST. First item always goes in regardless of
   * size; subsequent items only if cumulative JSON bytes stay under this.
   * Undefined = no byte limit (count-only batching).
   */
  maxBatchBytes?: number | (() => number)
  /** Max pending items before enqueue() blocks */
  maxQueueSize: number
  /** The actual HTTP call — caller controls payload format */
  send: (batch: T[], meta: SendMeta) => Promise<void>
  /** Base delay for exponential backoff (ms) */
  baseDelayMs: number
  /** Max delay cap (ms) */
  maxDelayMs: number
  /** Random jitter range added to retry delay (ms) */
  jitterMs: number
  /**
   * After this many consecutive send() failures, drop the failing batch
   * and move on to the next pending item with a fresh failure budget.
   * Undefined = retry indefinitely (default).
   */
  maxConsecutiveFailures?: number
  /** Called when a batch is dropped for hitting maxConsecutiveFailures. */
  onBatchDropped?: (batchSize: number, failures: number) => void
  /** Coalesce synchronous bursts via setImmediate before draining. */
  gatherTick?: boolean
  /** Override max held items before releasing with 'cap'. */
  holdMaxItems?: number
  /** Report when enqueue() waits longer than `afterMs` for queue room. */
  longWaitForRoom?: {
    afterMs: number
    report: (waitedMs: number, resolved: boolean) => void
  }
  onHoldRelease?: (
    reason: HoldReleaseReason,
    count: number,
    ageMs: number,
    rule: string,
    releasedBy?: string,
  ) => void
  onDrained?: (stats: DrainedStats) => void
  onIdle?: () => void
}

function itemJsonBytes<T>(item: T): number | undefined {
  try {
    return Buffer.byteLength(jsonStringify(item))
  } catch {
    return undefined
  }
}

export class SerialBatchEventUploader<T> {
  private pending: T[] = []
  private urgent: T[] = []
  private pendingAtClose = 0
  private handedOverAfterClose = 0
  private inFlight: T[] | undefined
  private inFlightSince = 0
  private undelivered: T[] = []
  private retaining = false
  private draining = false
  private gathering = false
  private gatherTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private backpressureResolvers: Array<() => void> = []
  private waitForRoom:
    | { sinceMs: number; timer: ReturnType<typeof setTimeout> | undefined }
    | undefined
  private backoff: {
    end: () => void
    until: number | undefined
    timer?: ReturnType<typeof setTimeout>
  } | null = null
  private retryNowOwed = false
  private cutsNextBackoff = false
  private backoffOwedUntil = 0
  private flushResolvers: Array<() => void> = []
  private droppedBatches = 0
  private holdSpec: HoldSpec<T> | undefined
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  private heldSince = 0
  private holdDeadline = 0
  private heldRule = 'no_subscriber_flag'
  private heldCount = 0
  private heldBytes = 0
  private owed = 0
  private sentBefore = new Set<T>()
  private resendSizes: number[] = []
  private flushing = false
  private released:
    | {
        reason: HoldReleaseReason
        rule: string
        count: number
        ageMs: number
        at: number
        unsent: number
      }
    | undefined
  private counts: DrainCounts = { ...EMPTY_COUNTS }
  private tiedToNext = new WeakSet<object>()
  private readonly config: SerialBatchEventUploaderConfig<T>

  constructor(config: SerialBatchEventUploaderConfig<T>) {
    this.config = config
  }

  /**
   * Monotonic count of batches dropped via maxConsecutiveFailures. Callers
   * can snapshot before flush() and compare after to detect silent drops
   * (flush() resolves normally even when batches were dropped).
   */
  get droppedBatchCount(): number {
    return this.droppedBatches
  }

  /**
   * Pending queue depth. After close(), returns the count at close time —
   * close() clears the queue but shutdown diagnostics may read this after.
   */
  get pendingCount(): number {
    return this.closed
      ? this.pendingAtClose
      : this.urgent.length + this.pending.length
  }

  get handedOverAfterCloseCount(): number {
    return this.handedOverAfterClose
  }

  hasRoomFor(count: number): boolean {
    return (
      !this.closed && this.pending.length + count <= this.config.maxQueueSize
    )
  }

  setHold(spec?: HoldSpec<T>, releasedBy?: string): void {
    const prev = this.holdSpec
    if (
      spec?.rule === prev?.rule &&
      spec?.maxAgeMs === prev?.maxAgeMs &&
      spec?.maxItems === prev?.maxItems &&
      spec?.maxBytes === prev?.maxBytes &&
      spec?.passes === prev?.passes
    ) {
      return
    }
    if (this.gathering) void this.drain()
    this.holdSpec = spec
    if (!spec) {
      this.release('cap', releasedBy)
      return
    }
    if (this.closed || this.flushing) return
    if (!prev) this.owed = this.pending.length
    this.rejudgeHeld()
  }

  private rejudgeHeld(): void {
    const since = this.holdTimer ? this.heldSince : Date.now()
    this.cancelHold()
    this.countHeld()
    this.applyHoldLimits(since)
    void this.drain()
  }

  cutBackoff(): void {
    if (this.backoff?.until !== undefined) {
      this.endBackoff()
    } else if (this.inFlight) {
      this.cutsNextBackoff = true
    }
  }

  release(reason: HoldReleaseReason, releasedBy?: string): void {
    this.endHold(reason, releasedBy)
    this.owed = this.pending.length
    void this.drain()
  }

  takeUndelivered(): T[] {
    const items = this.undelivered
    this.undelivered = []
    return items
  }

  peekUndelivered(): readonly T[] {
    return this.undelivered
  }

  discardUndelivered(): number {
    const count = this.undelivered.length
    this.undelivered = []
    this.retaining = false
    return count
  }

  /**
   * Add events to the pending buffer. Returns immediately if space is
   * available. Blocks (awaits) if the buffer is full — caller pauses
   * until drain frees space.
   */
  async enqueue(events: T | T[], options?: EnqueueOptions): Promise<void> {
    const items = Array.isArray(events) ? events : [events]
    if (items.length === 0) return
    if (this.closed) {
      this.retainUndelivered(items)
      return
    }
    if (options?.urgent) {
      this.urgent.push(...items)
      if (this.backoff?.until !== undefined) {
        this.backoffOwedUntil = this.backoff.until
        this.endBackoff()
      }
      void this.drain()
      return
    }
    if (items.length > this.config.maxQueueSize && !options?.together) {
      for (let i = 0; i < items.length; i += this.config.maxQueueSize) {
        await this.enqueue(
          items.slice(i, i + this.config.maxQueueSize),
          options,
        )
      }
      return
    }
    const needed = options?.together ? 1 : items.length
    if (
      this.holdTimer &&
      this.pending.length + needed > this.config.maxQueueSize
    ) {
      this.release('cap')
    }

    // Backpressure: wait until there's space
    while (
      this.pending.length + needed > this.config.maxQueueSize &&
      !this.closed
    ) {
      if (this.gathering) {
        void this.drain()
        continue
      }
      const { longWaitForRoom } = this.config
      if (longWaitForRoom && this.waitForRoom === undefined) {
        const state: {
          sinceMs: number
          timer: ReturnType<typeof setTimeout> | undefined
        } = { sinceMs: Date.now(), timer: undefined }
        state.timer = setTimeout(
          (st, { report }) => {
            st.timer = undefined
            report(Date.now() - st.sinceMs, false)
          },
          longWaitForRoom.afterMs,
          state,
          longWaitForRoom,
        )
        this.waitForRoom = state
      }
      await new Promise<void>(resolve => {
        this.backpressureResolvers.push(resolve)
      })
    }

    if (this.closed) {
      this.retainUndelivered(items)
      return
    }
    if (options?.together) {
      for (const item of items.slice(0, -1)) {
        if (typeof item === 'object' && item !== null) {
          this.tiedToNext.add(item)
        }
      }
    }
    this.pending.push(...items)
    if (options?.release) {
      this.release(options.release, options.releasedBy)
      return
    }
    const hold = this.holdOnArrivals()
    if (hold && this.countInto(hold, items) > 0) {
      this.applyHoldLimits(options?.since ?? Date.now())
    }
    if (options?.waitForMoreMs !== undefined && options.waitForMoreMs > 0) {
      if (!this.draining && !this.gathering) {
        this.gathering = true
        this.gatherTimer = setTimeout(
          () => void this.drain(),
          options.waitForMoreMs,
        )
      }
    } else if (!this.config.gatherTick || this.gatherTimer) {
      void this.drain()
    } else if (!this.draining && !this.gathering) {
      this.gathering = true
      setImmediate(self => {
        if (self.gathering) void self.drain()
      }, this)
    }
  }

  private countInto(hold: HoldSpec<T>, items: T[]): number {
    let added = 0
    for (const item of items) {
      if (!hold.passes?.(item)) {
        added++
        if (hold.maxBytes !== undefined) {
          this.heldBytes += itemJsonBytes(item) ?? 0
        }
      }
    }
    this.heldCount += added
    return added
  }

  private holdOnArrivals(): HoldSpec<T> | undefined {
    const spec = this.holdSpec
    return spec && !this.flushing && (spec.passes || !this.draining)
      ? spec
      : undefined
  }

  private sendableCount(): number {
    const spec = this.holdSpec
    if (!spec || this.flushing) return this.pending.length
    if (!spec.passes) return this.holdTimer ? 0 : this.pending.length
    let idx = this.owed
    while (idx < this.pending.length && spec.passes(this.pending[idx]!)) {
      idx++
    }
    return idx
  }

  private takePassing(
    passes: (item: T) => boolean,
    byteCap: number | undefined,
  ): { items: T[]; bytes: number } {
    const { maxBatchSize } = this.config
    const limit = this.byteLimit(byteCap)
    const items: T[] = []
    const remaining: T[] = []
    let bytes = 0
    let full = false
    for (const item of this.pending) {
      if (full || !passes(item)) {
        remaining.push(item)
        continue
      }
      const itemBytes = limit === undefined ? 0 : itemJsonBytes(item)
      if (itemBytes === undefined) {
        this.sentBefore.delete(item)
        continue
      }
      if (items.length > 0 && bytes + itemBytes > (limit ?? 0)) {
        full = true
        remaining.push(item)
        continue
      }
      bytes += itemBytes
      items.push(item)
      full = items.length >= maxBatchSize
    }
    this.pending = remaining
    return { items, bytes }
  }

  private jsonBytesOf(items: T[]): number {
    if (this.config.maxBatchBytes === undefined) return 0
    let total = 0
    for (const item of items) {
      total += itemJsonBytes(item) ?? 0
    }
    return total
  }

  private byteLimit(cap: number | undefined): number | undefined {
    const configured =
      typeof this.config.maxBatchBytes === 'function'
        ? this.config.maxBatchBytes()
        : this.config.maxBatchBytes
    return configured === undefined || cap === undefined
      ? configured
      : Math.min(configured, cap)
  }

  private countHeld(): void {
    this.heldCount = 0
    this.heldBytes = 0
    const hold = this.holdOnArrivals()
    if (hold) {
      this.countInto(hold, this.pending.slice(this.owed))
    }
  }

  private applyHoldLimits(since: number): void {
    const spec = this.holdSpec
    if (!spec || this.heldCount === 0) {
      this.cancelHold()
      return
    }
    const reason: HoldReleaseReason | undefined =
      spec.maxItems !== undefined && this.heldCount >= spec.maxItems
        ? 'max_events'
        : spec.maxBytes !== undefined && this.heldBytes >= spec.maxBytes
          ? 'max_bytes'
          : this.pending.length - this.owed >=
              (this.config.holdMaxItems === undefined
                ? this.config.maxBatchSize
                : Math.max(
                    this.config.holdMaxItems,
                    Math.min(spec.maxItems ?? 0, this.config.maxBatchSize),
                  ))
            ? 'cap'
            : undefined
    this.hold(since)
    if (reason) this.release(reason)
  }

  private hold(since: number): void {
    const spec = this.holdSpec
    if (!spec) return
    if (this.holdTimer) {
      if (since >= this.heldSince) return
      clearTimeout(this.holdTimer)
    }
    this.heldSince = since
    this.heldRule = spec.rule
    const now = Date.now()
    const delay = Math.min(
      spec.maxAgeMs,
      Math.max(0, since + spec.maxAgeMs - now),
    )
    this.holdDeadline = now + delay
    this.holdTimer = setTimeout(() => this.release('max_age'), delay)
  }

  private cancelHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer)
      this.holdTimer = null
    }
    this.heldCount = 0
    this.heldBytes = 0
  }

  private endHold(reason: HoldReleaseReason, releasedBy?: string): void {
    const wasHeld = this.holdTimer !== null
    this.cancelHold()
    if (!wasHeld) return
    const now = Date.now()
    const endAt =
      reason === 'max_age' && isDisklessLaunch() ? this.holdDeadline : now
    const ageMs = Math.min(
      Math.max(0, Math.round(endAt - this.heldSince)),
      INT32_MAX,
    )
    const count = this.pending.length
    const rule = this.heldRule
    if (this.released) this.reportDrained()
    this.released = {
      reason,
      rule,
      count,
      ageMs,
      at: now,
      unsent: count,
    }
    this.config.onHoldRelease?.(reason, count, ageMs, rule, releasedBy)
  }

  private retainUndelivered(items: T[]): void {
    this.handedOverAfterClose += items.length
    if (!this.retaining) return
    const room = this.config.maxQueueSize - this.undelivered.length
    if (room <= 0) return
    this.undelivered.push(
      ...(items.length > room ? items.slice(0, room) : items),
    )
  }

  /**
   * Block until all pending events have been sent.
   * Used at turn boundaries and graceful shutdown.
   */
  flush(options?: { retryNow?: boolean }): Promise<void> {
    if (
      this.pending.length === 0 &&
      this.urgent.length === 0 &&
      !this.draining
    ) {
      return Promise.resolve()
    }
    this.endHold('flush')
    this.flushing = true
    if (options?.retryNow) {
      this.retryNowOwed = this.backoff === null
      this.endBackoff()
    }
    void this.drain()
    return new Promise<void>(resolve => {
      this.flushResolvers.push(resolve)
    })
  }

  withdraw(predicate: (item: T) => boolean): number {
    if (this.closed) return 0
    const nextUrgent = this.urgent.filter(item => {
      const keep = !predicate(item)
      if (!keep) this.sentBefore.delete(item)
      return keep
    })
    const removedUrgent = this.urgent.length - nextUrgent.length
    this.urgent = nextUrgent

    let nextOwed = this.owed
    const nextPending = this.pending.filter((item, idx) => {
      if (!predicate(item)) return true
      if (idx < this.owed) nextOwed--
      this.sentBefore.delete(item)
      return false
    })
    const removedPending = this.pending.length - nextPending.length
    if (removedPending === 0) return removedUrgent

    this.pending = nextPending
    this.owed = nextOwed
    this.resendSizes = []
    this.rejudgeHeld()
    this.releaseBackpressure()
    return removedPending + removedUrgent
  }

  /**
   * Drop pending events and stop processing.
   * Resolves any blocked enqueue() and flush() callers.
   */
  close(options?: { retainUndelivered?: boolean }): number {
    if (this.closed) return 0
    if (this.gathering) void this.drain()
    this.closed = true
    this.pendingAtClose = this.urgent.length + this.pending.length
    this.retaining = options?.retainUndelivered === true
    this.cancelHold()
    this.owed = 0
    this.sentBefore.clear()
    this.flushing = false
    const leftover = (this.inFlight ?? []).concat(this.urgent, this.pending)
    this.undelivered = this.retaining ? leftover : []
    this.inFlight = undefined
    this.urgent = []
    this.pending = []
    this.endBackoff()
    this.releaseBackpressure()
    for (const resolve of this.flushResolvers) resolve()
    this.flushResolvers = []
    if (this.released) this.reportDrained(true)
    return leftover.length
  }

  /**
   * Drain loop. At most one instance runs at a time (guarded by this.draining).
   * Sends batches serially. On failure, backs off and retries indefinitely.
   */
  private async drain(): Promise<void> {
    if (this.draining || this.closed) return
    this.gathering = false
    if (this.gatherTimer) {
      clearTimeout(this.gatherTimer)
      this.gatherTimer = null
    }
    this.draining = true
    let failures = 0
    let byteCap: number | undefined
    let urgentFailures = 0
    let followsUrgent = false
    let urgentStreak = 0

    try {
      while (!this.closed) {
        const hasUrgent = this.urgent.length > 0
        const owedWaitMs = this.backoffOwedUntil - Date.now()
        if (owedWaitMs <= 0 || !hasUrgent) this.backoffOwedUntil = 0
        if (owedWaitMs > 0 && !hasUrgent) {
          await this.backOff(owedWaitMs, true)
          continue
        }

        const passes = this.holdSpec?.passes
        let batchResult: { items: T[]; bytes: number }
        let isResendSplit = false
        const yieldUrgent =
          hasUrgent && urgentStreak >= MAX_URGENT_STREAK && owedWaitMs <= 0
        const sendUrgent = hasUrgent && !yieldUrgent

        if (sendUrgent) {
          batchResult = this.takeUrgent()
          if (batchResult.items.length === 0) continue
        } else if (passes && this.owed === 0 && !this.flushing) {
          batchResult = this.takePassing(passes, byteCap)
          if (batchResult.items.length === 0) {
            if (yieldUrgent) {
              urgentStreak = 0
              continue
            }
            break
          }
        } else {
          const count = this.sendableCount()
          if (count === 0) {
            if (yieldUrgent) {
              urgentStreak = 0
              continue
            }
            break
          }
          isResendSplit = this.resendSizes.length > 0
          batchResult = this.takeBatch(count, byteCap)
          if (batchResult.items.length === 0) continue
        }

        const { items: batch, bytes } = batchResult
        this.inFlight = batch
        this.inFlightSince = Date.now()
        const released = sendUrgent ? undefined : this.released
        const held = released !== undefined && released.unsent > 0
        const batchLen = batch.length
        const cutAt =
          batch.findIndex((_, idx) => !this.sharesPostWithNext(idx, batch)) + 1
        const cuttableSize =
          sendUrgent || isResendSplit || cutAt >= batch.length ? 0 : cutAt
        const { attempt, again } = this.takeAttemptOf(batch)

        try {
          await this.config.send(batch, {
            held,
            reason: held ? released.reason : 'none',
            heldCount: held ? released.count : 0,
            holdAgeMs: held ? released.ageMs : 0,
            rule: held ? released.rule : 'none',
            postIndex: this.counts.posts,
            retryCount: sendUrgent ? urgentFailures : failures,
            attempt,
            urgent: sendUrgent,
            followsUrgent: !sendUrgent && followsUrgent,
            bytes,
            cuttable: cuttableSize > 0,
            mayResendInTwo: () => cuttableSize > 0 && !this.closed,
          })
          if (sendUrgent) {
            urgentFailures = 0
            urgentStreak++
          } else {
            failures = 0
            urgentStreak = 0
          }
          followsUrgent = sendUrgent
          this.counts.posts++
          this.counts.rows += batchLen
          this.counts.maxRowsPost = Math.max(this.counts.maxRowsPost, batchLen)
          if (released) released.unsent -= batchLen
        } catch (err) {
          if (
            err instanceof ResendInTwoError &&
            cuttableSize > 0 &&
            batch.length === batchLen &&
            !this.closed
          ) {
            failures = 0
            this.counts.failedPosts++
            this.noteSentBefore(batch)
            this.pending = batch.concat(this.pending)
            this.owed += batch.length
            this.resendSizes = [cuttableSize, batch.length - cuttableSize]
            continue
          }

          const attemptFailures = sendUrgent ? ++urgentFailures : ++failures
          this.counts.failedPosts++
          if (this.closed) break
          if (
            err instanceof ResendInTwoError ||
            (this.config.maxConsecutiveFailures !== undefined &&
              attemptFailures >= this.config.maxConsecutiveFailures)
          ) {
            this.droppedBatches++
            this.counts.droppedRows += batchLen
            if (released) released.unsent -= batchLen
            this.config.onBatchDropped?.(batch.length, attemptFailures)
            if (sendUrgent) {
              urgentFailures = 0
            } else {
              failures = 0
              byteCap = undefined
            }
            this.releaseBackpressure()
            continue
          }

          this.inFlight = undefined
          this.noteSentBefore(
            err instanceof PartialRetryableError
              ? again.filter(item => batch.includes(item))
              : batch,
          )
          if (sendUrgent) {
            this.urgent = batch.concat(this.urgent)
          } else {
            this.pending = batch.concat(this.pending)
            this.owed += batch.length
            if (isResendSplit) {
              this.resendSizes.unshift(batch.length)
            } else if (err instanceof PayloadTooLargeError) {
              const curBytes =
                batch.length === batchLen ? bytes : this.jsonBytesOf(batch)
              if (curBytes >= err.minBytes) {
                const halved = Math.max(err.minBytes, Math.floor(curBytes / 2))
                byteCap = Math.min(halved, byteCap ?? halved)
              }
            }
          }

          const retryAfterMs =
            err instanceof RetryableError ? err.retryAfterMs : undefined
          const delay = this.retryDelay(attemptFailures, retryAfterMs)
          const cuttable = !sendUrgent && retryAfterMs === undefined
          if (!cuttable) this.cutsNextBackoff = false
          if (cuttable && this.urgent.length > 0) {
            this.backoffOwedUntil = Date.now() + delay
            continue
          }
          await this.backOff(delay, cuttable)
          continue
        } finally {
          this.inFlight = undefined
        }

        // Release backpressure waiters if space opened up
        this.releaseBackpressure()
      }
    } finally {
      this.draining = false
      this.retryNowOwed = false
      this.cutsNextBackoff = false
      this.backoffOwedUntil = 0
      // Notify flush waiters if queue is empty
      if (this.pending.length === 0 && this.urgent.length === 0) {
        this.flushing = false
        for (const resolve of this.flushResolvers) resolve()
        this.flushResolvers = []
        if (!this.closed) this.reportDrained()
      }
      this.config.onIdle?.()
    }
  }

  private reportDrained(fromClose = false): void {
    const { released, counts } = this
    if (!released) {
      this.counts = {
        ...EMPTY_COUNTS,
        otherPosts: counts.otherPosts + counts.posts,
        otherRows: counts.otherRows + counts.rows,
      }
      return
    }
    this.released = undefined
    this.counts = { ...EMPTY_COUNTS }
    this.config.onDrained?.({
      trigger: fromClose ? 'close' : released.reason,
      rule: released.rule,
      heldEvents: released.count,
      heldMs: released.ageMs,
      ...counts,
      drainMs: Date.now() - released.at,
    })
  }

  /**
   * Pull the next batch from pending. Respects maxBatchSize, maxBatchBytes,
   * together-tied items, and resendSizes.
   *
   * Un-serializable items (BigInt, circular refs, throwing toJSON) are
   * dropped in place — they can never be sent and leaving them at
   * pending[0] would poison the queue and hang flush() forever.
   */
  private takeBatch(
    maxCount: number,
    byteCap: number | undefined,
  ): { items: T[]; bytes: number } {
    const splitSize = this.resendSizes.shift()
    if (splitSize !== undefined) {
      this.owed = Math.max(0, this.owed - splitSize)
      const items = this.pending.splice(0, splitSize)
      return { items, bytes: this.jsonBytesOf(items) }
    }
    const { maxBatchSize } = this.config
    const limit = this.byteLimit(byteCap)
    let bytes = 0
    let count = 0
    const itemByteSizes: number[] = []
    while (count < maxCount && count < maxBatchSize) {
      let itemBytes = 0
      if (limit !== undefined) {
        const measured = itemJsonBytes(this.pending[count]!)
        if (measured === undefined) {
          this.forget(this.pending.splice(count, 1))
          maxCount--
          if (count < this.owed) this.owed--
          continue
        }
        if (count > 0 && bytes + measured > limit) break
        itemBytes = measured
      }
      bytes += itemBytes
      itemByteSizes.push(itemBytes)
      count++
    }
    const initialCount = count
    const initialBytes = bytes
    while (count > 0 && this.sharesPostWithNext(count - 1)) {
      count--
      bytes -= itemByteSizes[count] ?? 0
    }
    if (count === 0) {
      count = initialCount
      bytes = initialBytes
      while (count > 0 && this.sharesPostWithNext(count - 1)) {
        const measured =
          limit === undefined ? 0 : itemJsonBytes(this.pending[count]!)
        if (measured === undefined) {
          this.forget(this.pending.splice(count, 1))
          if (count < this.owed) this.owed--
        } else {
          bytes += measured
          count++
        }
      }
    }
    this.owed = Math.max(0, this.owed - count)
    return { items: this.pending.splice(0, count), bytes }
  }

  private sharesPostWithNext(idx: number, list: T[] = this.pending): boolean {
    const item = list[idx]
    return (
      idx + 1 < list.length &&
      typeof item === 'object' &&
      item !== null &&
      this.tiedToNext.has(item)
    )
  }

  private takeUrgent(): { items: T[]; bytes: number } {
    const { maxBatchSize } = this.config
    const limit = this.byteLimit(undefined)
    let bytes = 0
    let count = 0
    while (count < this.urgent.length && count < maxBatchSize) {
      if (limit !== undefined) {
        const measured = itemJsonBytes(this.urgent[count]!)
        if (measured === undefined) {
          this.forget(this.urgent.splice(count, 1))
          continue
        }
        if (count > 0 && bytes + measured > limit) break
        bytes += measured
      }
      count++
    }
    return { items: this.urgent.splice(0, count), bytes }
  }

  private noteSentBefore(items: T[]): void {
    for (const item of items) this.sentBefore.add(item)
  }

  private forget(items: T[]): void {
    for (const item of items) this.sentBefore.delete(item)
  }

  private takeAttemptOf(batch: T[]): {
    attempt: SendAttemptKind
    again: T[]
  } {
    if (this.sentBefore.size === 0) return { attempt: 'first', again: [] }
    const again = batch.filter(item => this.sentBefore.delete(item))
    const attempt: SendAttemptKind =
      again.length === 0
        ? 'first'
        : again.length < batch.length
          ? 'resend_with_new'
          : 'resend'
    return { attempt, again }
  }

  private retryDelay(failures: number, retryAfterMs?: number): number {
    const jitter = Math.random() * this.config.jitterMs
    if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) {
      // Jitter on top of the server's hint prevents thundering herd when
      // many sessions share a rate limit and all receive the same
      // Retry-After. Clamp first, then spread — same shape as the
      // exponential path (effective ceiling is maxDelayMs + jitterMs).
      const clamped = Math.max(
        this.config.baseDelayMs,
        Math.min(retryAfterMs, this.config.maxDelayMs),
      )
      return clamped + jitter
    }
    const exponential = Math.min(
      this.config.baseDelayMs * 2 ** (failures - 1),
      this.config.maxDelayMs,
    )
    return exponential + jitter
  }

  private releaseBackpressure(): void {
    const resolvers = this.backpressureResolvers
    this.backpressureResolvers = []
    for (const resolve of resolvers) resolve()
    const wait = this.waitForRoom
    this.waitForRoom = undefined
    if (wait?.timer !== undefined) {
      clearTimeout(wait.timer)
    } else if (wait !== undefined) {
      this.config.longWaitForRoom?.report(Date.now() - wait.sinceMs, true)
    }
  }

  inFlightBatch(): T[] | undefined {
    return this.inFlight
  }

  busy(): boolean {
    return (this.draining || this.gathering) && !this.closed
  }

  waitsForMore(): boolean {
    return this.gatherTimer !== null
  }

  hasHeld(predicate: (item: T) => boolean): boolean {
    return !this.closed && this.pending.slice(this.owed).some(predicate)
  }

  holdsOnArrival(item: T): boolean {
    const hold = this.holdOnArrivals()
    return !this.closed && hold !== undefined && !hold.passes?.(item)
  }

  held(): { count: number; ageMs: number } {
    return {
      count: this.heldCount,
      ageMs: this.holdTimer ? Date.now() - this.heldSince : 0,
    }
  }

  backlog(): {
    unsent: number
    inFlightMs: number | undefined
    backingOff: boolean
  } {
    return {
      unsent:
        (this.inFlight?.length ?? 0) + this.urgent.length + this.pending.length,
      inFlightMs: this.inFlight ? Date.now() - this.inFlightSince : undefined,
      backingOff: this.backoff !== null,
    }
  }

  private backOff(ms: number, cuttable: boolean): Promise<void> {
    this.config.onIdle?.()
    if (this.retryNowOwed || (cuttable && this.cutsNextBackoff)) {
      this.retryNowOwed = false
      this.cutsNextBackoff = false
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      const state: {
        end: () => void
        until: number | undefined
        timer?: ReturnType<typeof setTimeout>
      } = {
        end: resolve,
        until: cuttable ? Date.now() + ms : undefined,
      }
      this.backoff = state
      state.timer = setTimeout(self => self.endBackoff(), ms, this)
    })
  }

  private endBackoff(): void {
    const state = this.backoff
    if (state) {
      this.backoff = null
      clearTimeout(state.timer)
      state.end()
    }
  }
}
