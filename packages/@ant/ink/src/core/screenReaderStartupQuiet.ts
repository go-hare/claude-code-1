/**
 * densable 2.1.217 Yqc / qXn / Xqc — screen-reader startup quiet window.
 *
 * First prompt paints are deferred until quiet expires so the initial
 * "Screen Reader Mode" announcement is not cut off by early Ink frames.
 *
 * Constants (densable H4): mug=3000, hug=600000
 * Env: CLAUDE_AX_STARTUP_QUIET_MS (int, min 0; capped at hug)
 */

export const AX_STARTUP_QUIET_ENV_KEY = 'CLAUDE_AX_STARTUP_QUIET_MS'
/** densable mug — default quiet ms */
export const SR_STARTUP_QUIET_DEFAULT_MS = 3000
/** densable hug — hard cap */
export const SR_STARTUP_QUIET_MAX_MS = 600_000

let quietStartedAtMs: number | null = null
let quietEnded = false

/** densable Yqc — mark quiet start once (idempotent). */
export function markScreenReaderStartupQuietStart(
  nowMs: number = Date.now(),
): void {
  if (quietStartedAtMs === null) {
    quietStartedAtMs = nowMs
  }
}

/** densable qXn — end quiet window (subsequent Xqc returns 0). */
export function endScreenReaderStartupQuiet(): void {
  quietEnded = true
}

/**
 * densable Xqc — remaining quiet ms, or 0 when unset/ended/expired.
 * Pure relative to process-level state + env.
 */
export function getScreenReaderStartupQuietRemainingMs(
  nowMs: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (quietStartedAtMs === null || quietEnded) {
    return 0
  }
  const raw = env[AX_STARTUP_QUIET_ENV_KEY]
  let configured: number | undefined
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed >= 0) {
      configured = parsed
    }
  }
  const quietMs = Math.min(
    configured ?? SR_STARTUP_QUIET_DEFAULT_MS,
    SR_STARTUP_QUIET_MAX_MS,
  )
  const remaining = quietStartedAtMs + quietMs - nowMs
  return remaining > 0 ? remaining : 0
}

/** Test / process-reset helper (not densable). */
export function resetScreenReaderStartupQuietForTests(): void {
  quietStartedAtMs = null
  quietEnded = false
}
