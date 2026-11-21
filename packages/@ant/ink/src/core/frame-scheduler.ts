import {
  FRAME_INTERVAL_MS,
  INPUT_PRIORITY_FRAME_MS,
  STDOUT_BACKLOG_BYTES,
  STDOUT_BACKLOG_RETRY_MS,
} from './constants.js'

/**
 * Official 2.1.328 `xm` — frame scheduler handling paced 16ms/4ms rendering,
 * stdout backpressure hold/retry, extra scroll-drain frames, and cancel/epoch
 * invalidation.
 */
export class FrameScheduler {
  private readonly onFrame: () => void
  private readonly queuedBytes: () => number
  private readonly nowFn: () => number
  private frameTimer: ReturnType<typeof setTimeout> | null = null
  private frameTimerDueAt = 0
  private drainTimer: ReturnType<typeof setTimeout> | null = null
  private frameMicrotaskQueued = false
  private frameHeldForBacklog = false
  private lastPacedFrameAt = -Infinity
  private inputPriorityUntil = 0
  private epoch = 0

  constructor(
    onFrame: () => void,
    queuedBytes: () => number,
    nowFn: () => number = () => performance.now(),
  ) {
    this.onFrame = onFrame
    this.queuedBytes = queuedBytes
    this.nowFn = nowFn
  }

  get isHeldForBacklog(): boolean {
    return this.frameHeldForBacklog
  }

  prioritizeInput(untilMs: number): void {
    this.inputPriorityUntil = Math.max(this.inputPriorityUntil, untilMs)
  }

  invalidatePendingMicrotask(): void {
    this.epoch++
  }

  scheduleFrame(): void {
    if (this.frameMicrotaskQueued) return
    const now = this.nowFn()
    const elapsed = now - this.lastPacedFrameAt
    const interval =
      now < this.inputPriorityUntil
        ? INPUT_PRIORITY_FRAME_MS
        : FRAME_INTERVAL_MS
    if (elapsed >= interval) {
      this.queuePacedFrame()
      return
    }
    const due = this.lastPacedFrameAt + interval
    if (this.frameTimer === null || due < this.frameTimerDueAt) {
      this.cancelScheduledFrame()
      this.frameTimerDueAt = due
      this.frameTimer = setTimeout(
        () => {
          this.frameTimer = null
          this.queuePacedFrame()
        },
        Math.max(0, due - now),
      )
    }
  }

  private queuePacedFrame(): void {
    this.cancelScheduledFrame()
    if (this.queuedBytes() > STDOUT_BACKLOG_BYTES) {
      this.frameHeldForBacklog = true
      this.frameTimerDueAt = this.nowFn() + STDOUT_BACKLOG_RETRY_MS
      this.frameTimer = setTimeout(() => {
        this.frameTimer = null
        this.queuePacedFrame()
      }, STDOUT_BACKLOG_RETRY_MS)
      return
    }
    this.frameHeldForBacklog = false
    this.frameMicrotaskQueued = true
    this.inputPriorityUntil = 0
    this.lastPacedFrameAt = this.nowFn()
    const myEpoch = this.epoch
    queueMicrotask(() => {
      this.frameMicrotaskQueued = false
      if (myEpoch !== this.epoch) return
      this.onFrame()
    })
  }

  promoteToMicrotask(): void {
    if (!this.frameMicrotaskQueued) {
      this.queuePacedFrame()
    }
  }

  scheduleExtraFrame(): void {
    this.cancelDrainFrame()
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null
      this.onFrame()
    }, FRAME_INTERVAL_MS >> 2)
  }

  resumeFromBacklog(): void {
    if (!this.frameHeldForBacklog) return
    this.frameHeldForBacklog = false
    this.scheduleFrame()
  }

  cancelScheduledFrame(): void {
    if (this.frameTimer !== null) {
      clearTimeout(this.frameTimer)
      this.frameTimer = null
    }
  }

  cancelDrainFrame(): void {
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer)
      this.drainTimer = null
    }
  }

  cancelAll(): void {
    this.epoch++
    this.cancelScheduledFrame()
    this.cancelDrainFrame()
    this.frameHeldForBacklog = false
  }
}
