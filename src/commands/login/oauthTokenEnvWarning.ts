/**
 * densable 2.1.229 #27 — `/login` OAuth env-token override warnings.
 *
 * densable symbols:
 * - `n9m` — shared trailing clause about shell profile / settings
 * - `o9m` — pre-login startingMessage when CLAUDE_CODE_OAUTH_TOKEN is set
 * - `i9m` — post-success note when env token was set at /login start
 * - `s9m` — final onDone message composition
 */

/** densable n9m */
export const OAUTH_TOKEN_ENV_PROFILE_NOTE =
  'but if that variable is set in your shell profile or a Claude Code settings file, new `claude` sessions will keep using the old token until you remove it there.'

/** densable MPe */
export const REMOTE_CONTROL_DISCONNECTED_NOTE = 'Remote Control disconnected.'

/**
 * densable o9m — pre-login banner when CLAUDE_CODE_OAUTH_TOKEN is in the env.
 * Returns undefined when the env var is unset (no startingMessage).
 */
export function getOauthTokenEnvStartingMessage(
  envToken: string | undefined = process.env.CLAUDE_CODE_OAUTH_TOKEN,
): string | undefined {
  if (!envToken) return undefined
  return `Warning: CLAUDE_CODE_OAUTH_TOKEN is set in your environment. This session will switch to your new credentials after logging in, ${OAUTH_TOKEN_ENV_PROFILE_NOTE}`
}

/**
 * densable i9m — post-success note (only when env token was set at login start
 * and gateway is not active).
 */
export function getOauthTokenEnvSuccessNote(): string {
  return `Note: CLAUDE_CODE_OAUTH_TOKEN was set in your environment when /login started. This session will use your new credentials, ${OAUTH_TOKEN_ENV_PROFILE_NOTE}`
}

export type LoginDoneFlags = {
  /** densable bridgeDisconnected from post-login bridge reconcile */
  bridgeDisconnected?: boolean
  /**
   * densable envTokenWasSet — whether o9m fired at login start (env token present).
   * Snapshot at start; do not re-read env after success.
   */
  envTokenWasSet?: boolean
  /**
   * densable gatewayActive (`Jn()==="gateway"`). When true, post-success note
   * is suppressed even if envTokenWasSet.
   */
  gatewayActive?: boolean
}

/**
 * densable s9m(success, flags) — final /login onDone message.
 */
export function formatLoginDoneMessage(
  success: boolean,
  flags: LoginDoneFlags = {},
): string {
  if (!success) return 'Login interrupted'
  const base = flags.bridgeDisconnected
    ? `Login successful. ${REMOTE_CONTROL_DISCONNECTED_NOTE}`
    : 'Login successful'
  if (flags.envTokenWasSet && !flags.gatewayActive) {
    return `${base}\n\n${getOauthTokenEnvSuccessNote()}`
  }
  return base
}

/**
 * densable o9m snapshot: whether env token is set at call time.
 * Used as envTokenWasSet for s9m after success (must not re-check env).
 */
export function isOauthTokenEnvSetAtStart(
  envToken: string | undefined = process.env.CLAUDE_CODE_OAUTH_TOKEN,
): boolean {
  return Boolean(envToken)
}
