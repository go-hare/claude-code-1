/**
 * densable 2.1.238 #33 — non-origin 403 streak for SSE remote-bridge.
 *
 * `$pl=180000` window / `eJv=90000` gap. Origin 403 is `request-id` matching
 * densable `qnv` `/^req_[A-Za-z0-9_-]{1,36}$/` (`u2t`) — NOT UUID,
 * NOT `x-request-id`. Cloudflare / other non-origin 403 retries while the
 * streak is inside the window. ≠ isSuppressible403 (cosmetic poll). ≠ F4y.
 * 403 is NOT in CLOSE_CODE_RECOVERY — expired streak / origin fails the bridge.
 */

export const NON_ORIGIN_403_WINDOW_MS = 180_000
export const NON_ORIGIN_403_GAP_MS = 90_000

/** densable `qnv` */
const ORIGIN_REQUEST_ID = /^req_[A-Za-z0-9_-]{1,36}$/

/** densable `ikv` */
const CLOUDFLARE_SERVER = /cloudflare/i

/** densable `u2t` */
export function isOriginRequestId(value: string): boolean {
  return typeof value === 'string' && ORIGIN_REQUEST_ID.test(value)
}

export type NonOrigin403Source = 'origin' | 'nonorigin_cf' | 'nonorigin_other'

export type NonOrigin403Streak = {
  source: Exclude<NonOrigin403Source, 'origin'>
  startedAtMs: number
  lastAtMs: number
  attempts: number
}

export type NonOrigin403CloseCause =
  | 'transport_closed_403'
  | 'transport_closed_403_nonorigin_cf'
  | 'transport_closed_403_nonorigin_other'

function headerGet(
  headers: Headers | Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined
  }
  const rec = headers as Record<string, string>
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(rec)) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

/**
 * densable f8r — classify a 403 rejector.
 * `request-id` matching `u2t`/`qnv` → origin; nonempty `cf-ray` or Server
 * ~cloudflare → nonorigin_cf; else nonorigin_other. No `x-request-id`.
 */
export function classify403RejectSource(
  headers: Headers | Record<string, string> | undefined,
): NonOrigin403Source {
  const requestId = headerGet(headers, 'request-id')
  if (typeof requestId === 'string' && isOriginRequestId(requestId.trim())) {
    return 'origin'
  }
  const cfRay = headerGet(headers, 'cf-ray')
  const server = headerGet(headers, 'server')
  if (
    (typeof cfRay === 'string' && cfRay !== '') ||
    (typeof server === 'string' && CLOUDFLARE_SERVER.test(server))
  ) {
    return 'nonorigin_cf'
  }
  return 'nonorigin_other'
}

export function advanceNonOriginStreak(
  streak: NonOrigin403Streak | null,
  source: NonOrigin403Source | undefined,
  now: number,
  gapMs: number = NON_ORIGIN_403_GAP_MS,
): NonOrigin403Streak | null {
  if (source === undefined || source === 'origin') return null
  if (streak && streak.source === source && now - streak.lastAtMs < gapMs) {
    return {
      ...streak,
      lastAtMs: now,
      attempts: streak.attempts + 1,
    }
  }
  return {
    source,
    startedAtMs: now,
    lastAtMs: now,
    attempts: 1,
  }
}

export function isNonOrigin403Retryable(
  streak: NonOrigin403Streak | null,
  now: number,
  windowMs: number = NON_ORIGIN_403_WINDOW_MS,
): boolean {
  return streak !== null && now - streak.startedAtMs < windowMs
}

export function formatNonOrigin403RecoverLog(
  streak: NonOrigin403Streak,
): string {
  const streakS = Math.round((streak.lastAtMs - streak.startedAtMs) / 1000)
  return (
    `[remote-bridge] SSE stream live again after ${streak.attempts}` +
    ` non-origin 403(s) over ${streakS}s (source=${streak.source})`
  )
}

export function recovered403EventName(
  source: Exclude<NonOrigin403Source, 'origin'>,
): 'recovered_403_nonorigin_cf' | 'recovered_403_nonorigin_other' {
  return source === 'nonorigin_cf'
    ? 'recovered_403_nonorigin_cf'
    : 'recovered_403_nonorigin_other'
}

/** densable `zs` — episode-scoped latch shared by recover (Ta) and fail (fl). */
export type FirstInEpisodeLatch = { seen: boolean }

/**
 * densable `zs?0:1` then `zs=!0`.
 * `first_in_episode` is a 0/1 flag, not attempt count.
 */
export function takeFirstInEpisodeFlag(latch: FirstInEpisodeLatch): 0 | 1 {
  const flag = latch.seen ? 0 : 1
  latch.seen = true
  return flag
}

export function closedCauseFor403(
  source: NonOrigin403Source | undefined,
  streak: NonOrigin403Streak | null,
): NonOrigin403CloseCause {
  const resolved = source === 'origin' ? 'origin' : (streak?.source ?? source)
  if (resolved === 'nonorigin_cf') return 'transport_closed_403_nonorigin_cf'
  if (resolved === 'nonorigin_other') {
    return 'transport_closed_403_nonorigin_other'
  }
  return 'transport_closed_403'
}
