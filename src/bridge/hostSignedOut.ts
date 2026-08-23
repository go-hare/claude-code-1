/**
 * densable 2.1.238 #26 — host signed_out / identity_changed RC copy.
 *
 * Do not invent Config UI. Do not rewrite the Failed-to-reconnect resume path.
 */

import { getClaudeAIOAuthTokens } from '../utils/auth.js'

/** densable ipl — host hint when the machine signed out. */
export const HOST_SIGNED_OUT_HINT =
  'Remote Control stopped — the app running this session is signed out of Claude. Sign in there, then turn Remote Control back on'

/** densable spl — host hint when the machine switched Claude accounts. */
export const HOST_ACCOUNT_CHANGED_HINT =
  'Remote Control stopped — the app running this session is now signed in to a different Claude account'

/** densable wr — CLI failed-state copy for signed_out. */
export const SIGNED_OUT_CLI_HINT =
  'Signed out of Claude — run /login, then /remote-control'

export type MissingOAuthClassification = 'signed_out' | 'identity_changed'

/** densable sd */
export function teardownReasonForMissingOAuth(
  classified: MissingOAuthClassification,
): 'host_signed_out' | 'host_account_changed' {
  return classified === 'signed_out'
    ? 'host_signed_out'
    : 'host_account_changed'
}

/** densable _u */
export function hostHintForTeardownReason(reason: string): string {
  return reason === 'host_signed_out'
    ? HOST_SIGNED_OUT_HINT
    : HOST_ACCOUNT_CHANGED_HINT
}

/**
 * densable remint classifier: missing Claude.ai OAuth tokens → signed_out.
 * Tokens present but getAccessToken() empty is a different failure (leave
 * the existing "no OAuth token" remint copy).
 *
 * `identity_changed` remains on the type / sd/_u copy surface for SEA host
 * account-switch, but this classifier does **not** emit it yet (no portable
 * host identity check). Do not invent leftover #3 marketplace owner-pin here.
 */
export function classifyMissingOAuthToken():
  | MissingOAuthClassification
  | undefined {
  return getClaudeAIOAuthTokens() === null ? 'signed_out' : undefined
}

export function formatSignedOutStoppingLog(
  envKind: string,
  teardownReason: string,
): string {
  return `[remote-bridge] Signed out on this machine under ${envKind} (${teardownReason}) — stopping`
}
