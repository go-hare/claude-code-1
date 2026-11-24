import {
  FRAME_INTERVAL_MS,
  INPUT_PRIORITY_FRAME_MS,
  STDOUT_BACKLOG_BYTES,
  STDOUT_BACKLOG_RETRY_MS,
} from './constants.js'

/** Official 2.1.328 `W7i` — input-priority pacing window (ms). */
const INPUT_PRIORITY_WINDOW_MS = 50

/**
 * Official 2.1.328 `xm` — frame scheduler handling paced 16ms/4ms rendering,
 * stdout backpressure hold/retry, and extra scroll-drain frames.
 */
export class FrameScheduler {
  private readonly onRender: () => void
  private readonly queuedBytes: () => number
  pacerNow: () => number
  private drainTimer: ReturnType<typeof setTimeout> | null = null
  private lastPacedFrameAt = -Infinity
  private frameTimer: ReturnType<typeof setTimeout> | null = null
  private frameTimerDueAt = 0
  private frameMicrotaskQueued = false
  private inputPriorityUntil = 0
  private frameHeldForBacklog = false

  constructor(
    onRender: () => void,
    queuedBytes: () => number,
    nowFn: () => number = () => performance.now(),
  ) {
    this.onRender = onRender
    this.queuedBytes = queuedBytes
    this.pacerNow = nowFn
  }

  get isHeldForBacklog(): boolean {
    return this.frameHeldForBacklog
  }

  requestInputPriorityFrame(untilMs?: number): void {
    this.inputPriorityUntil =
      untilMs ?? this.pacerNow() + INPUT_PRIORITY_WINDOW_MS
  }

  prioritizeInput(untilMs: number): void {
    this.inputPriorityUntil = Math.max(this.inputPriorityUntil, untilMs)
  }

  scheduleFrame(): void {
    if (this.frameMicrotaskQueued) return
    const now = this.pacerNow()
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
      this.frameTimerDueAt = this.pacerNow() + STDOUT_BACKLOG_RETRY_MS
      this.frameTimer = setTimeout(() => {
        this.frameTimer = null
        this.queuePacedFrame()
      }, STDOUT_BACKLOG_RETRY_MS)
      return
    }
    this.frameHeldForBacklog = false
    this.frameMicrotaskQueued = true
    this.inputPriorityUntil = 0
    this.lastPacedFrameAt = this.pacerNow()
    queueMicrotask(() => {
      this.frameMicrotaskQueued = false
      this.onRender()
    })
  }

  promoteToMicrotask(): void {
    if (!this.frameMicrotaskQueued) {
      this.queuePacedFrame()
    }
  }

  cancelScheduledFrame(): void {
    if (this.frameTimer !== null) {
      clearTimeout(this.frameTimer)
      this.frameTimer = null
    }
  }

  releaseHeldFrame(): void {
    if (this.frameHeldForBacklog) {
      this.frameHeldForBacklog = false
      this.scheduleFrame()
    }
  }

  resumeFromBacklog(): void {
    this.releaseHeldFrame()
  }

  scheduleExtraFrame(): void {
    this.cancelExtraFrame()
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null
      this.onRender()
    }, FRAME_INTERVAL_MS >> 2)
  }

  cancelExtraFrame(): void {
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer)
      this.drainTimer = null
    }
  }

  cancelAll(): void {
    this.cancelScheduledFrame()
    this.cancelExtraFrame()
    this.frameHeldForBacklog = false
  }
}
