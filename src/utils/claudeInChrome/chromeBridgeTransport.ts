import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getClaudeAIOAuthTokens } from '../auth.js'
import { isEnvTruthy } from '../envUtils.js'

export type ChromeBridgeTransportInputs = {
  forceNative: boolean
  /** ant or GB tengu_copper_bridge */
  flagOn: boolean
  /** USE_LOCAL_OAUTH / LOCAL_BRIDGE */
  localBridge: boolean
  hasAccessToken: boolean
}

/**
 * Pure gate — unit-test without mock.module pollution.
 *
 * densable: copper bridge when ant or GB `tengu_copper_bridge`.
 * Fork local: no OAuth token required — without token (or FORCE_NATIVE) use
 * native Unix socket. Official bridge/Reconnect still works when flag is on
 * **and** the user has a claude.ai access token (or LOCAL_BRIDGE for ant dev).
 */
export function resolveChromeBridgeTransportEnabled(
  inputs: ChromeBridgeTransportInputs,
): boolean {
  if (inputs.forceNative) {
    return false
  }
  if (!inputs.flagOn) {
    return false
  }
  if (inputs.localBridge) {
    return true
  }
  return inputs.hasAccessToken
}

function envTruthy(
  env: Record<string, string> | undefined,
  key: string,
): boolean {
  return isEnvTruthy(env?.[key]) || isEnvTruthy(process.env[key])
}

/**
 * Runtime wrapper. Shared by mcpServer (createChromeContext) and setup
 * (ListTools allowlist).
 *
 * `env` is the MCP server config env (in-process path passes it into
 * createChromeContext). Connect local sets CLAUDE_CHROME_FORCE_NATIVE=1 there
 * so local never needs a token and never steals the official bridge path.
 */
export function isChromeBridgeTransportEnabled(
  env?: Record<string, string>,
): boolean {
  return resolveChromeBridgeTransportEnabled({
    forceNative:
      envTruthy(env, 'CLAUDE_CHROME_FORCE_NATIVE') ||
      envTruthy(env, 'CLAUDE_CHROME_USE_NATIVE'),
    flagOn:
      process.env.USER_TYPE === 'ant' ||
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_copper_bridge', false),
    localBridge:
      envTruthy(env, 'USE_LOCAL_OAUTH') || envTruthy(env, 'LOCAL_BRIDGE'),
    hasAccessToken: Boolean(getClaudeAIOAuthTokens()?.accessToken),
  })
}
