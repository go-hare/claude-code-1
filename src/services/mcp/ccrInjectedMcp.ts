/**
 * densable 2.1.289 `mpn` / `NSn` / `ENn` — CLAUDE_CODE_REMOTE --mcp-config
 * ownership preserve + ccrInjected + bare-elicitation pin for hearthbot.
 *
 * Do **not** export minify names.
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  isCliOwnedConfig,
  markCcrInjectedConfig,
  markCliOwnedConfig,
} from './cliOwnedConfigs.js'
import { getCapturedCcrIngressBase } from './mcpConnectTimeout.js'
import {
  HEARTHBOT_LEGACY_MCP_PATH,
  HEARTHBOT_MCP_PATH_RE,
  HEARTHBOT_MCP_SERVER_NAME,
} from '../../bridge/hearthbotMcp.js'

/** densable `TNn` — keys allowed on CCR-injected owned configs. */
const CCR_INJECTED_CONFIG_KEYS = new Set([
  'type',
  'url',
  'headers',
  'tools',
  'toolPermissions',
  'request_timeout_ms',
  'timeout',
  'role',
  'alwaysLoad',
  'scope',
  'bareElicitationCapability',
])

/** densable `vNn` — known CCR-injected server pathname patterns. */
const CCR_INJECTED_SERVER_PATHS = new Map<string, RegExp>([
  ['slackbot', /^\/v2\/ccr-sessions\/[A-Za-z0-9_-]+\/slackbot\/mcp$/],
  [
    'slackbot_read',
    /^\/v2\/ccr-sessions\/[A-Za-z0-9_-]+\/slackbot\/mcp\/read$/,
  ],
  [
    'ccr-slack-thread',
    /^\/v2\/ccr-sessions\/[A-Za-z0-9_-]+\/slack-thread\/mcp$/,
  ],
  ['teamsbot', /^\/v2\/ccr-sessions\/[A-Za-z0-9_-]+\/teamsbot\/mcp$/],
  [HEARTHBOT_MCP_SERVER_NAME, HEARTHBOT_MCP_PATH_RE],
  [
    'claude-code-remote',
    /^\/v2\/ccr-sessions\/(?:-|[A-Za-z0-9_-]+)\/meta\/mcp$/,
  ],
])

/**
 * densable `ENn(name, config)` — https same-origin CCR pathname for known names.
 */
export function isCcrInjectedRemoteMcpShape(
  name: string,
  config: object,
): boolean {
  const pathRe = CCR_INJECTED_SERVER_PATHS.get(name)
  const base = getCapturedCcrIngressBase()
  if (!pathRe || !base) return false
  if (Object.keys(config).some(k => !CCR_INJECTED_CONFIG_KEYS.has(k))) {
    return false
  }
  if (!('type' in config) || (config as { type?: string }).type !== 'http') {
    return false
  }
  if (
    !('url' in config) ||
    typeof (config as { url: unknown }).url !== 'string'
  ) {
    return false
  }
  let parsed: URL
  let ingress: URL
  try {
    parsed = new URL((config as { url: string }).url)
    ingress = new URL(base)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.origin === ingress.origin &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.search === '' &&
    parsed.hash === '' &&
    pathRe.test(parsed.pathname)
  )
}

/** densable `Jkn` — hearthbot CCR URL for bare-elicitation pin. */
export function isHearthbotCcrProxyUrl(url: string): boolean {
  const base = getCapturedCcrIngressBase()
  if (!base) return false
  let parsed: URL
  let ingress: URL
  try {
    parsed = new URL(url)
    ingress = new URL(base)
  } catch {
    return false
  }
  if (parsed.origin !== ingress.origin) return false
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== '' ||
    parsed.search !== ''
  ) {
    return false
  }
  return (
    parsed.pathname === HEARTHBOT_LEGACY_MCP_PATH ||
    HEARTHBOT_MCP_PATH_RE.test(parsed.pathname)
  )
}

/**
 * densable `mpn` — stamp ccrInjected when REMOTE + ENn.
 */
export function maybeMarkCcrInjectedConfig(name: string, config: object): void {
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
    isCcrInjectedRemoteMcpShape(name, config)
  ) {
    markCcrInjectedConfig(config)
  }
}

/**
 * densable `NSn` — pin bare elicitation for hearthbot URL when not already owned.
 * Gold `Is(el).value=!0` is a session latch; we also stamp
 * `bareElicitationCapability: true` on the dynamic clone when requested.
 */
let bareElicitationPinned = false

export function maybePinHearthbotBareElicitation(
  name: string,
  sourceConfig: object,
  targetConfig?: { bareElicitationCapability?: boolean },
): boolean {
  if (
    name === HEARTHBOT_MCP_SERVER_NAME &&
    !isCliOwnedConfig(sourceConfig) &&
    'url' in sourceConfig &&
    typeof (sourceConfig as { url: unknown }).url === 'string' &&
    isHearthbotCcrProxyUrl((sourceConfig as { url: string }).url)
  ) {
    bareElicitationPinned = true
    if (targetConfig) {
      targetConfig.bareElicitationCapability = true
    }
    return true
  }
  return false
}

export function isHearthbotBareElicitationPinned(): boolean {
  return bareElicitationPinned
}

export function resetHearthbotBareElicitationPinForTests(): void {
  bareElicitationPinned = false
}

/**
 * densable REMOTE --mcp-config mapValues body:
 *   ar={...fo,scope:"dynamic"}; mpn/NSn; return nf(fo)?OEe(ar):ar
 */
export function rewriteRemoteDynamicMcpConfig<T extends object>(
  name: string,
  source: T,
): T & { scope: 'dynamic' } {
  const ar = { ...source, scope: 'dynamic' as const }
  if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    maybeMarkCcrInjectedConfig(name, ar)
    maybePinHearthbotBareElicitation(name, source, ar)
  }
  if (isCliOwnedConfig(source)) {
    return markCliOwnedConfig(ar)
  }
  return ar
}
