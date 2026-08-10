/**
 * densable 2.1.222 stream residual H:
 * - #9 Tfb — synthetic keep-alive `ping` when byte body still advances
 * - #5 close-after-complete — message_delta stop_reason set + no open block
 *
 * SEA (win32 2.1.222):
 *   async function*Tfb(e,t,r=vfb,n=Afb){
 *     if(!t){yield*e;return}
 *     let o=e[Symbol.asyncIterator](), i=performance.now(), s=0, a=null, l,
 *         c=Symbol("heartbeat");
 *     try{while(!0){
 *       a??=o.next();
 *       let u=new Promise((p)=>{l=setTimeout((f,m)=>f(m),r,p,c); l.unref?.()}),
 *           d=await Promise.race([a,u]);
 *       if(clearTimeout(l), l=void 0, d===c){
 *         if(t.lastAt>i && s<n){ i=performance.now(); s++; yield{type:"ping"} }
 *         continue
 *       }
 *       if(a=null, d.done) return;
 *       i=performance.now(); s=0; yield d.value
 *     }} finally { ... }
 *   }
 *   vfb=1e4, Afb=30
 *
 *   close gate: La=Br!==null; if(La&&To&&at===null) {
 *     log "response already complete, no truncation"
 *     N("tengu_streaming_close_after_complete", ...)
 *     break e  // success, no mid-response banner
 *   }
 */

import type { BodyChunkTimes } from './bodyIdleWatchdog.js'

/** densable vfb — heartbeat race interval (ms) */
export const STREAM_KEEPALIVE_HEARTBEAT_MS = 10_000
/** densable Afb — max consecutive synthetic pings between real events */
export const STREAM_KEEPALIVE_MAX_PINGS = 30

export type StreamPingEvent = { type: 'ping' }

/** densable _0r */
export function isStreamPingEvent(event: unknown): event is StreamPingEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    (event as { type?: unknown }).type === 'ping'
  )
}

/**
 * densable Tfb — wrap an async iterable of stream parts.
 * When `chunkTimes` is missing, yields the source unchanged.
 * When present: if no SSE event arrives within `heartbeatMs` but
 * `chunkTimes.lastAt` advanced (gateway keep-alive / body bytes),
 * yield synthetic `{type:"ping"}` so the consumer's idle timer resets.
 */
export async function* withStreamKeepAlivePings<T>(
  source: AsyncIterable<T>,
  chunkTimes: BodyChunkTimes | undefined,
  options?: {
    heartbeatMs?: number
    maxConsecutivePings?: number
    now?: () => number
  },
): AsyncGenerator<T | StreamPingEvent, void, undefined> {
  if (!chunkTimes) {
    yield* source
    return
  }
  const heartbeatMs = options?.heartbeatMs ?? STREAM_KEEPALIVE_HEARTBEAT_MS
  const maxPings = options?.maxConsecutivePings ?? STREAM_KEEPALIVE_MAX_PINGS
  const now = options?.now ?? (() => performance.now())

  const iterator = source[Symbol.asyncIterator]()
  let anchorAt = now()
  let consecutivePings = 0
  let pendingNext: Promise<IteratorResult<T>> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    while (true) {
      pendingNext ??= iterator.next()
      const raced = await Promise.race([
        pendingNext.then(result => ({ kind: 'next' as const, result })),
        new Promise<{ kind: 'heartbeat' }>(resolve => {
          timer = setTimeout(() => resolve({ kind: 'heartbeat' }), heartbeatMs)
          timer.unref?.()
        }),
      ])
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }

      if (raced.kind === 'heartbeat') {
        // densable: if(t.lastAt>i && s<n) yield ping
        if (chunkTimes.lastAt > anchorAt && consecutivePings < maxPings) {
          anchorAt = now()
          consecutivePings++
          yield { type: 'ping' }
        }
        continue
      }

      pendingNext = null
      const { result } = raced
      if (result.done) return
      anchorAt = now()
      consecutivePings = 0
      yield result.value
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    try {
      void Promise.resolve(iterator.return?.(undefined)).catch(() => {})
    } catch {
      // ignore
    }
  }
}

/**
 * densable state for #5 close-after-complete gate.
 * Br = stopReason, To = messageDeltaCompleted, at = openContentBlockIndex
 */
export type StreamCompletionState = {
  stopReason: string | null | undefined
  /** densable To — set true when message_delta carries non-null stop_reason */
  messageDeltaCompleted: boolean
  /** densable at — content block index while a block is open; null when closed */
  openContentBlockIndex: number | null
}

/** densable La&&To&&at===null */
export function isStreamResponseAlreadyComplete(
  state: StreamCompletionState,
): boolean {
  return (
    state.stopReason != null &&
    state.messageDeltaCompleted === true &&
    state.openContentBlockIndex === null
  )
}

export type StreamCloseAfterCompletePlan =
  | {
      alreadyComplete: true
      event: 'tengu_streaming_close_after_complete'
    }
  | { alreadyComplete: false }

/**
 * densable partial-finalize pre-check: if response already complete after
 * message_delta, do not emit Connection-closed mid-response banner.
 */
export function planStreamCloseAfterComplete(
  state: StreamCompletionState,
): StreamCloseAfterCompletePlan {
  if (isStreamResponseAlreadyComplete(state)) {
    return {
      alreadyComplete: true,
      event: 'tengu_streaming_close_after_complete',
    }
  }
  return { alreadyComplete: false }
}

/** densable content_block_start: To=!1; at=index */
export function applyContentBlockStartCompletionState(
  state: StreamCompletionState,
  index: number,
): StreamCompletionState {
  return {
    ...state,
    messageDeltaCompleted: false,
    openContentBlockIndex: index,
  }
}

/** densable content_block_stop: To=!1; at=null */
export function applyContentBlockStopCompletionState(
  state: StreamCompletionState,
): StreamCompletionState {
  return {
    ...state,
    messageDeltaCompleted: false,
    openContentBlockIndex: null,
  }
}

/**
 * densable message_delta: Br=stop_reason; if(Br!==null) To=!0
 */
export function applyMessageDeltaCompletionState(
  state: StreamCompletionState,
  stopReason: string | null | undefined,
): StreamCompletionState {
  return {
    ...state,
    stopReason: stopReason ?? null,
    messageDeltaCompleted:
      stopReason != null ? true : state.messageDeltaCompleted,
  }
}
