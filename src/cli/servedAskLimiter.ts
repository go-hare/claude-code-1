/**
 * densable 2.1.283 leftover gold `Rt` @202303237 — served-ask in-flight bag.
 *
 * Gold factory is wired as
 * `Rt({now:Date.now,maxAskMs:()=>x.servedHost()?.limits.max_ask_ms})`.
 * Wrap the limiter + host limit read only. No WS / announce / serve channel.
 *
 * Gold nearby: `var xn=20,Un=64` · `KMe.max_ask_ms:120000`
 * Gold `workerGone` drops `state==="asked"` only; `clear` empties the map;
 * `report` is undefined until a mutation (`h`) or live size > 0.
 */

/** gold `xn` — recent ended-call ring */
export const SERVED_ASK_RECENT_CAP = 20
/** gold `Un` — in-flight map ceiling */
export const SERVED_ASK_INFLIGHT_CAP = 64
/** gold `KMe.max_ask_ms` fallback when `maxAskMs()` is nullish */
export const SERVED_ASK_DEFAULT_MAX_MS = 120_000

export type ServedHostAskLimits = {
  limits?: { max_ask_ms?: number }
}

export type ServedAskLive = {
  call_id: string
  tool?: string
  state: 'running' | 'asked'
  since: number
  ask_id?: string
  lapses_at?: number
}

export type ServedAskEnded = {
  call_id: string
  tool?: string
  ended: string
  code?: string
  at: number
}

export type ServedAskReport = {
  live: ServedAskLive[]
  recent: ServedAskEnded[]
}

export type ServedAskLimiter = {
  inflight: Map<string, ServedAskLive>
  noteRunning: (callId: string, tool?: string) => void
  noteAsked: (callId: string, tool?: string, askId?: string) => void
  noteEnded: (
    callId: string,
    tool: string,
    ended: string,
    code?: string,
  ) => void
  workerGone: () => void
  clear: () => void
  report: () => ServedAskReport | undefined
}

/**
 * gold `x.servedHost()?.limits.max_ask_ms` — undefined when host/limits absent.
 */
export function servedHostMaxAskMs(
  host?: ServedHostAskLimits,
): number | undefined {
  return host?.limits?.max_ask_ms
}

/**
 * gold `Rt` @202303237 — thin in-flight / recent / workerGone / report bag.
 */
export function createServedAskLimiter(
  opts: {
    now?: () => number
    maxAskMs?: () => number | undefined
    onChanged?: () => void
  } = {},
): ServedAskLimiter {
  const inflight = new Map<string, ServedAskLive>()
  const recent: ServedAskEnded[] = []
  let dirty = false
  const now = opts.now ?? Date.now

  const emit = (): void => {
    opts.onChanged?.()
  }

  const maxAskMs = (): number => opts.maxAskMs?.() ?? SERVED_ASK_DEFAULT_MAX_MS

  const noteEnded = (
    callId: string,
    tool: string,
    ended: string,
    code?: string,
  ): void => {
    inflight.delete(callId)
    recent.push({
      call_id: callId,
      tool,
      ended,
      ...(code !== undefined && { code }),
      at: now(),
    })
    if (recent.length > SERVED_ASK_RECENT_CAP) {
      recent.splice(0, recent.length - SERVED_ASK_RECENT_CAP)
    }
    dirty = true
    emit()
  }

  return {
    inflight,
    noteRunning(callId, tool) {
      if (!inflight.has(callId) && inflight.size >= SERVED_ASK_INFLIGHT_CAP) {
        return
      }
      inflight.set(callId, {
        call_id: callId,
        ...(tool !== undefined && { tool }),
        state: 'running',
        since: now(),
      })
      emit()
    },
    noteAsked(callId, tool, askId) {
      const t = now()
      inflight.set(callId, {
        call_id: callId,
        ...(tool !== undefined && { tool }),
        state: 'asked',
        since: t,
        ...(askId !== undefined && { ask_id: askId }),
        lapses_at: t + maxAskMs(),
      })
      emit()
    },
    noteEnded,
    workerGone() {
      const asked = [...inflight.values()].filter(row => row.state === 'asked')
      if (asked.length === 0) return
      for (const row of asked) inflight.delete(row.call_id)
      emit()
    },
    clear() {
      if (inflight.size === 0) return
      inflight.clear()
      emit()
    },
    report() {
      if (!dirty && inflight.size === 0) return undefined
      return { live: [...inflight.values()], recent: [...recent] }
    },
  }
}
