/**
 * densable 2.1.217 login-expiry window (`mAr` / `lKp=3*cKp`).
 *
 * Official:
 *   function mAr(){
 *     if (Cn()!=="firstParty"||!xb()) return null;
 *     let e=bs();
 *     if (!e||typeof e.refreshTokenExpiresAt!=="number") return null;
 *     let t=e.refreshTokenExpiresAt;
 *     if (typeof e.expiresAt==="number"&&e.expiresAt>t+lKp) return null;
 *     let r=t-Date.now();
 *     if (r>lKp||r<=0) return null;
 *     return {daysLeft:Math.ceil(r/cKp)}
 *   }
 *   cKp=86400000; lKp=3*cKp
 */
import { getClaudeAIOAuthTokens, isClaudeAISubscriber } from './auth.js'
import { getAPIProvider } from './model/providers.js'

/** densable `cKp` — one day in ms. */
export const LOGIN_EXPIRY_DAY_MS = 86_400_000

/** densable `lKp` — warning window (3 days). Was 5 days pre-2.1.217. */
export const LOGIN_EXPIRY_WARNING_WINDOW_MS = 3 * LOGIN_EXPIRY_DAY_MS

export type LoginExpiryWarning = {
  daysLeft: number
}

/**
 * densable `EXn(e,t)` used when persisting refresh_token_expires_in:
 * number seconds → Date.now()+e*1000; else optional default.
 */
export function resolveRefreshTokenExpiresAt(
  refreshTokenExpiresIn: unknown,
  fallbackWhenMissing?: boolean,
  fallbackMs: number = LOGIN_EXPIRY_WARNING_WINDOW_MS,
): number | undefined {
  if (
    typeof refreshTokenExpiresIn === 'number' &&
    Number.isFinite(refreshTokenExpiresIn)
  ) {
    return Date.now() + refreshTokenExpiresIn * 1000
  }
  if (
    typeof refreshTokenExpiresIn === 'string' &&
    refreshTokenExpiresIn.trim() !== ''
  ) {
    const n = Number.parseInt(refreshTokenExpiresIn, 10)
    if (Number.isFinite(n)) return Date.now() + n * 1000
  }
  return fallbackWhenMissing ? Date.now() + fallbackMs : undefined
}

/**
 * densable `mAr()` — null when not in warning window.
 * Requires firstParty provider + Claude AI subscriber + numeric refreshTokenExpiresAt.
 */
export function getLoginExpiryWarning(
  nowMs: number = Date.now(),
): LoginExpiryWarning | null {
  if (getAPIProvider() !== 'firstParty' || !isClaudeAISubscriber()) {
    return null
  }
  const tokens = getClaudeAIOAuthTokens() as {
    refreshTokenExpiresAt?: number | null
    expiresAt?: number | null
  } | null
  if (!tokens || typeof tokens.refreshTokenExpiresAt !== 'number') {
    return null
  }
  const refreshAt = tokens.refreshTokenExpiresAt
  // densable: if access token outlives refresh+window, skip (refresh path still healthy)
  if (
    typeof tokens.expiresAt === 'number' &&
    tokens.expiresAt > refreshAt + LOGIN_EXPIRY_WARNING_WINDOW_MS
  ) {
    return null
  }
  const remaining = refreshAt - nowMs
  if (remaining > LOGIN_EXPIRY_WARNING_WINDOW_MS || remaining <= 0) {
    return null
  }
  return { daysLeft: Math.ceil(remaining / LOGIN_EXPIRY_DAY_MS) }
}

/** densable UI copy: `Your login expires in N day(s) · run /login to renew` */
export function formatLoginExpiryWarningText(daysLeft: number): string {
  const unit = daysLeft === 1 ? 'day' : 'days'
  return `Your login expires in ${daysLeft} ${unit} · run /login to renew`
}
