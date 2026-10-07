/**
 * densable 2.1.289 bridge MCP carrier-child helpers — `oFn` / `Ykn` / `W` / carrier env.
 *
 * Gold: `/tmp/gold289-extract/oee_bridgeCarrierChild_dynamic_mcp.txt`
 * Do **not** export minify `oFn` / `Ykn` / `W` / `M_`.
 */

import { isEnvTruthy } from '../utils/envUtils.js'
import { getCapturedCcrIngressBase } from '../services/mcp/mcpConnectTimeout.js'
import {
  CLAUDE_CODE_REMOTE_MCP_SERVER_ID,
  CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
  CLAUDE_CODE_REMOTE_META_MCP_PATH,
} from './hearthbotMcp.js'

/** densable env stamped for carrier-child MCP rewrite. */
export const CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV =
  'CLAUDE_CODE_BRIDGE_MCP_CARRIER'

/** densable `FWe` — session MCP path (carrier rewrite target). */
const CCR_SESSION_MCP_PATH_RE = /^\/v2\/ccr-sessions\/([A-Za-z0-9_-]+)\/mcp$/

/** densable `m` — allowed query keys for carrier rewrite. */
const CARRIER_QUERY_KEYS = [
  'mcp_url',
  'mcp_server_id',
  'toolbox_mcp_server_id',
] as const

/** densable `rsr` — mcp_server_id UUID. */
const MCP_SERVER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type BridgeCarrierDropReason =
  | 'bridge_carrier_foreign_entry'
  | 'bridge_carrier_not_http'
  | 'bridge_carrier_no_ingress_origin'
  | 'bridge_carrier_no_session_id'
  | 'bridge_carrier_url_mismatch'

export const BRIDGE_CARRIER_DROP_MESSAGES: Record<
  BridgeCarrierDropReason,
  string
> = {
  bridge_carrier_foreign_entry:
    'is reserved for the bridge carrier meta MCP entry and was not loaded',
  bridge_carrier_not_http:
    'must be type "http" on a bridge carrier child and was not loaded',
  bridge_carrier_no_ingress_origin:
    'could not resolve an approved ingress origin and was not loaded',
  bridge_carrier_no_session_id:
    'needs a bridge session id on a carrier child and was not loaded',
  bridge_carrier_url_mismatch:
    'url is not this session MCP path on the ingress origin and was not loaded',
}

/** densable `M_.isBridgeCarrierChild` — env or explicit hostCarrier. */
export function isBridgeCarrierChild(
  opts: { hostCarrier?: boolean; env?: NodeJS.ProcessEnv } = {},
): boolean {
  if (opts.hostCarrier) return true
  const env = opts.env ?? process.env
  return isEnvTruthy(env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV])
}

/** densable `l(url, origin)` — same-origin URL with empty user/pass/hash. */
function sameOriginUrl(url: string, origin: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (
    parsed.origin !== origin ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== ''
  ) {
    return null
  }
  return parsed
}

/**
 * densable `W(url, origin)` — validate + normalize carrier query string.
 * Requires `toolbox_mcp_server_id === iqt`; optional UUID `mcp_server_id`;
 * optional `mcp_url` must resolve to meta path `p`.
 */
export function normalizeCarrierSessionMcpQuery(
  parsed: URL,
  origin: string,
): string | null {
  const keys = [...parsed.searchParams.keys()]
  if (new Set(keys).size !== keys.length) return null
  if (keys.some(k => !(CARRIER_QUERY_KEYS as readonly string[]).includes(k))) {
    return null
  }
  if (
    parsed.searchParams.get('toolbox_mcp_server_id') !==
    CLAUDE_CODE_REMOTE_MCP_SERVER_ID
  ) {
    return null
  }
  const out = new URLSearchParams()
  const mcpUrl = parsed.searchParams.get('mcp_url')
  if (mcpUrl !== null) {
    const resolved = sameOriginUrl(mcpUrl, origin)
    if (
      !resolved ||
      resolved.pathname !== CLAUDE_CODE_REMOTE_META_MCP_PATH ||
      resolved.search !== ''
    ) {
      return null
    }
    out.set('mcp_url', `${origin}${CLAUDE_CODE_REMOTE_META_MCP_PATH}`)
  }
  const mcpServerId = parsed.searchParams.get('mcp_server_id')
  if (mcpServerId !== null) {
    if (!MCP_SERVER_ID_RE.test(mcpServerId)) return null
    out.set('mcp_server_id', mcpServerId)
  }
  out.set('toolbox_mcp_server_id', CLAUDE_CODE_REMOTE_MCP_SERVER_ID)
  return out.toString()
}

/**
 * densable `Ykn(url, origin, sessionId)` — rewrite to session `/mcp` on origin
 * when pathname session segment matches and query passes `W`.
 */
export function rewriteCarrierSessionMcpUrl(
  url: string,
  origin: string,
  sessionId: string,
): string | null {
  const parsed = sameOriginUrl(url, origin)
  if (!parsed) return null
  const match = CCR_SESSION_MCP_PATH_RE.exec(parsed.pathname)
  if (!match || match[1] !== sessionId) return null
  const qs = normalizeCarrierSessionMcpQuery(parsed, origin)
  if (!qs) return null
  return `${origin}/v2/ccr-sessions/${sessionId}/mcp?${qs}`
}

export type BridgeCarrierRewrite =
  | { drop: BridgeCarrierDropReason }
  | { url: string; sessionId: string }

/**
 * densable `oFn(name, config, bridgeSessionId)` — carrier-child entry gate.
 */
export function rewriteBridgeCarrierMcpEntry(
  name: string,
  config: { type?: string; url?: string },
  bridgeSessionId: string | undefined,
  opts: { ingressBase?: string | undefined } = {},
): BridgeCarrierRewrite {
  if (name !== CLAUDE_CODE_REMOTE_MCP_SERVER_NAME) {
    return { drop: 'bridge_carrier_foreign_entry' }
  }
  if (config.type !== 'http') {
    return { drop: 'bridge_carrier_not_http' }
  }
  const base = opts.ingressBase ?? getCapturedCcrIngressBase()
  let origin: string | null = null
  if (base) {
    try {
      origin = new URL(base).origin
    } catch {
      origin = null
    }
  }
  if (!origin) return { drop: 'bridge_carrier_no_ingress_origin' }
  if (!bridgeSessionId) return { drop: 'bridge_carrier_no_session_id' }
  if (typeof config.url !== 'string') {
    return { drop: 'bridge_carrier_url_mismatch' }
  }
  const rewritten = rewriteCarrierSessionMcpUrl(
    config.url,
    origin,
    bridgeSessionId,
  )
  if (!rewritten) return { drop: 'bridge_carrier_url_mismatch' }
  return { url: rewritten, sessionId: bridgeSessionId }
}
