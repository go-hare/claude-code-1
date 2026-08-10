/**
 * densable 2.1.222 streaming text buffer + display store (UNf / BNf / WNf / Qci).
 *
 * Atomic clear on assistant land + throttled flush prevents dual-● when tools
 * keep isLoading true. MessageDisplay transform hooks write `transformed`;
 * without them Qci falls back to raw with hideTrailingLine.
 *
 * densable clear vs salvage (do not "fix" by clearing salvage on pH.clear):
 * - UNf.clear / setRaw(null) clears raw only; salvage may remain.
 * - Qci: displayed = salvage ? r7o(salvage, base??"", exact) : base
 *   → salvage-only preview is intentional during refusal_continuation.
 * - setSalvage(null) only at land / esc / refusal end / !isLoading+j2a.
 */

/** densable MLp — max streaming preview chars */
export const STREAMING_TEXT_MAX_CHARS = 1e6

/** densable flush interval for UNf (ms) */
export const STREAMING_TEXT_FLUSH_MS = 100

// densable flag bits (F2a/U2a/B2a/j2a)
export const STREAM_FLAG_RAW = 1
export const STREAM_FLAG_DISPLAYED = 2
export const STREAM_FLAG_HIDE_TRAILING = 4
export const STREAM_FLAG_SALVAGE = 8

export type StreamingDisplayState = {
  raw: string | null
  transformed: string | null
  salvage: string | null
  exact: boolean
}

export type StreamingDisplayResolved = {
  displayed: string | null
  hideTrailingLine: boolean
  displayedHasNewline: boolean
}

export type StreamingDisplayStore = {
  setRaw: (raw: string | null) => void
  setTransformed: (transformed: string | null) => void
  setSalvage: (salvage: string | null, exact?: boolean) => void
  getState: () => StreamingDisplayState
  getFlags: () => number
  subscribe: (listener: () => void) => () => void
}

/** densable aUp — soft-join base window (chars) */
export const SALVAGE_SOFT_JOIN_WINDOW = 1e4

/**
 * densable yUp — last aUp chars of salvage prefix for soft join match.
 * Surrogate-pair safe (drops leading low surrogate if window mid-pair).
 */
export function salvageJoinBase(prefix: string): string {
  if (prefix.length <= SALVAGE_SOFT_JOIN_WINDOW) return prefix
  const t = prefix.slice(-SALVAGE_SOFT_JOIN_WINDOW)
  const r = t.charCodeAt(0)
  // low surrogate alone at start of window → drop it
  return r >= 0xdc00 && r <= 0xdfff ? t.slice(1) : t
}

/**
 * densable r7o / Cjs — salvage prefix merge (exact concat or soft join).
 * Used when MessageDisplay salvage is active; kept for 1:1 store API.
 */
export function mergeSalvagePrefix(
  salvage: string,
  next: string,
  exact: boolean,
): string {
  if (exact) return salvage + next
  return softJoinSalvage(salvage, next)
}

/** densable Cjs */
function softJoinSalvage(prefix: string, next: string): string {
  const base = salvageJoinBase(prefix)
  const trimmed = next.trimStart().replace(/^…\s*/, '')
  // densable: if startsWith(base) strip base, else keep original `t` (not trimmed)
  const body = trimmed.startsWith(base) ? trimmed.slice(base.length) : next
  if (body.trim().length === 0) return prefix
  const looksListOrFence = /^([-*+>#]|\d{1,3}[.)]\s|```)/.test(body)
  const endsNl = /\n\s*$/.test(prefix)
  let sep = ''
  if (looksListOrFence && !endsNl) sep = '\n'
  else if (
    (/[.!?…。！？]["')\]]?$/.test(prefix) || /[\w,;:]$/.test(prefix)) &&
    /^\w/.test(body)
  ) {
    sep = ' '
  }
  return `${prefix}${sep}${body}`
}

const resolveCache = new WeakMap<object, StreamingDisplayResolved>()

/** densable Qci */
export function resolveStreamingDisplay(
  state: StreamingDisplayState,
): StreamingDisplayResolved {
  const cached = resolveCache.get(state)
  if (cached) return cached
  const { raw, transformed, salvage, exact } = state
  const base = transformed ?? (raw || null)
  const displayed =
    (salvage !== null
      ? mergeSalvagePrefix(salvage, base ?? '', exact)
      : base) || null
  const resolved: StreamingDisplayResolved = {
    displayed,
    hideTrailingLine: transformed === null && !!raw,
    displayedHasNewline: displayed !== null && displayed.includes('\n'),
  }
  resolveCache.set(state, resolved)
  return resolved
}

/** densable WNf */
export function createStreamingDisplayStore(): StreamingDisplayStore {
  let state: StreamingDisplayState = {
    raw: null,
    transformed: null,
    salvage: null,
    exact: false,
  }
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const l of listeners) l()
  }

  function setField<K extends keyof StreamingDisplayState>(
    key: K,
    value: StreamingDisplayState[K],
  ): void {
    if (state[key] === value) return
    state = { ...state, [key]: value }
    notify()
  }

  return {
    setRaw: raw => setField('raw', raw),
    setTransformed: transformed => setField('transformed', transformed),
    setSalvage: (salvage, exact) => {
      const nextExact = exact ?? state.exact
      if (state.salvage === salvage && state.exact === nextExact) return
      state = { ...state, salvage, exact: nextExact }
      notify()
    },
    getState: () => state,
    getFlags() {
      const { displayed, hideTrailingLine, displayedHasNewline } =
        resolveStreamingDisplay(state)
      return (
        (state.raw !== null ? STREAM_FLAG_RAW : 0) |
        (displayed !== null ? STREAM_FLAG_DISPLAYED : 0) |
        (displayed !== null && hideTrailingLine && !displayedHasNewline
          ? STREAM_FLAG_HIDE_TRAILING
          : 0) |
        (state.salvage !== null ? STREAM_FLAG_SALVAGE : 0)
      )
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** densable UNf */
export class StreamingTextFlushBuffer {
  pending: string | null = null
  private cancelScheduledFlush: (() => void) | null = null
  private readonly scheduleTimeout: (fn: () => void, ms: number) => () => void
  private readonly onFlush: (value: string | null) => void
  private readonly flushIntervalMs: number
  private readonly boundFlush: () => void

  constructor(opts: {
    scheduleTimeout: (fn: () => void, ms: number) => () => void
    onFlush: (value: string | null) => void
    flushIntervalMs?: number
  }) {
    this.scheduleTimeout = opts.scheduleTimeout
    this.onFlush = opts.onFlush
    this.flushIntervalMs = opts.flushIntervalMs ?? STREAMING_TEXT_FLUSH_MS
    this.boundFlush = this.flush.bind(this)
  }

  apply(updater: (current: string | null) => string | null): void {
    const next = updater(this.pending)
    if (next === null) {
      this.clear()
      return
    }
    this.pending = next
    if (this.cancelScheduledFlush === null) {
      this.cancelScheduledFlush = this.scheduleTimeout(
        this.boundFlush,
        this.flushIntervalMs,
      )
    }
  }

  clear(): void {
    this.pending = null
    this.dispose()
    this.onFlush(null)
  }

  peek(): string | null {
    return this.pending
  }

  dispose(): void {
    if (this.cancelScheduledFlush !== null) {
      this.cancelScheduledFlush()
      this.cancelScheduledFlush = null
    }
  }

  flush(): void {
    this.cancelScheduledFlush = null
    this.onFlush(this.pending)
  }
}

/** densable BNf */
export function createStreamingTextFlushBuffer(opts: {
  scheduleTimeout: (fn: () => void, ms: number) => () => void
  onFlush: (value: string | null) => void
  flushIntervalMs?: number
}): StreamingTextFlushBuffer {
  return new StreamingTextFlushBuffer(opts)
}

/**
 * densable text_delta append with MLp cap.
 */
export function appendStreamingTextDelta(
  current: string | null,
  delta: string,
  maxChars: number = STREAMING_TEXT_MAX_CHARS,
): string {
  const len = current?.length ?? 0
  if (len >= maxChars) return current ?? ''
  return (current ?? '') + delta.slice(0, maxChars - len)
}
