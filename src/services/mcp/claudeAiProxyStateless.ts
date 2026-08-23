/**
 * densable 2.1.238 #16 — claudeai-proxy stateless skip-init (N_f / F_f / oGn / L_f / H_f).
 *
 * Gold: `/tmp/official-238/plat/package/claude`
 *   - `oGn`/`S9r`: type==="claudeai-proxy" && stateless===true && fqn()
 *   - `fqn`: GB `tengu_mcp_stateless_skip_init` default true
 *   - `L_f`/`Iff`: cachedInitResponse InitializeResult + SUPPORTED_PROTOCOL_VERSIONS
 *   - `H_f`/`Pff`: discoverSupport legacy → method-not-found; supported + cachedDiscover
 *   - `N_f`: send-intercept initialize / server/discover; swallow notifications/initialized
 *   - `F_f`: GET to the proxy endpoint → 405 (suppress SSE)
 *
 * **Never** wrap stdio. **Never** invent cliOwnedConfigs / vbe.
 */
import {
  type DiscoverResult,
  type FetchLike,
  type InitializeResult,
  type JSONRPCMessage,
  type Transport,
  isJSONRPCNotification,
  isJSONRPCRequest,
  LATEST_PROTOCOL_VERSION,
  ProtocolErrorCode,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/client'
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { logForDebugging } from '../../utils/debug.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { densableClientCapabilities } from './mcpV2Client.js'

/** densable `FqS` — ascii byte ceiling for the base64 capabilities header. */
export const CLAUDEAI_INIT_PROJECTION_HEADER_MAX_BYTES = 6144

/** densable `Jai` — protocol version stamped on `$Yp` when GB is on. */
export const CLAUDEAI_MCP_PROTOCOL_VERSION_HEADER = LATEST_PROTOCOL_VERSION

export type ClaudeAiDiscoverSupport = 'legacy' | 'supported'

export type ClaudeAiProxyStatelessConfig = {
  type: 'claudeai-proxy'
  id: string
  stateless?: boolean
  cachedInitResponse?: Record<string, unknown> | null
  discoverSupport?: ClaudeAiDiscoverSupport
  cachedDiscoverResponse?: Record<string, unknown> | null
}

export type CachedDiscoverProjection =
  | 'method-not-found'
  | { result: DiscoverResult }

/**
 * densable `Kcv` / `$nv` — DiscoverResult shape for cached_discover_response.
 * SEA: `{supportedVersions: string[], capabilities: {}, serverInfo?: {name, version}}`.
 */
export const cachedDiscoverResultSchema = lazySchema(() =>
  z.object({
    supportedVersions: z.array(z.string()),
    capabilities: z.object({}).passthrough(),
    serverInfo: z
      .object({
        name: z.string(),
        version: z.string(),
      })
      .optional(),
  }),
)

/**
 * densable `Jkn` / `Egt` — InitializeResult. SDK type is structural; local
 * schema matches SEA `protocolVersion` + `capabilities` + `serverInfo` + optional
 * `instructions`. Extra keys passthrough so org projections still hydrate.
 */
export const cachedInitializeResultSchema = lazySchema(() =>
  z
    .object({
      protocolVersion: z.string(),
      capabilities: z.object({}).passthrough(),
      serverInfo: z
        .object({
          name: z.string(),
          version: z.string(),
        })
        .passthrough(),
      instructions: z.string().optional(),
    })
    .passthrough(),
)

/**
 * densable `fqn()` — `it("tengu_mcp_stateless_skip_init", !0)`.
 */
export function isClaudeAiStatelessSkipInitEnabled(
  readFeature: (
    key: string,
    def: boolean,
  ) => boolean = getFeatureValue_CACHED_MAY_BE_STALE,
): boolean {
  return readFeature('tengu_mcp_stateless_skip_init', true)
}

/**
 * densable `oGn`/`S9r`: claudeai-proxy + `stateless===true` + skip-init GB.
 */
export function isStatelessClaudeAiProxy(
  server: {
    type?: string
    stateless?: boolean
  },
  readFeature?: (key: string, def: boolean) => boolean,
): boolean {
  return (
    server.type === 'claudeai-proxy' &&
    server.stateless === true &&
    isClaudeAiStatelessSkipInitEnabled(readFeature)
  )
}

/** densable `F1e` — printable ASCII, max 32, for protocolVersion warn. */
export function sanitizeProtocolVersionForLog(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '').slice(0, 32)
}

/**
 * densable `L_f`/`Iff` — cached initialize projection, or undefined to
 * fall through to a real initialize (GET SSE still suppressed when oGn).
 */
export function resolveCachedClaudeAiInitialize(
  server: ClaudeAiProxyStatelessConfig,
  readFeature?: (key: string, def: boolean) => boolean,
): InitializeResult | undefined {
  if (!isStatelessClaudeAiProxy(server, readFeature)) return
  if (server.type !== 'claudeai-proxy') return
  if (server.cachedInitResponse == null) return
  const parsed = cachedInitializeResultSchema().safeParse(
    server.cachedInitResponse,
  )
  if (!parsed.success) {
    logForDebugging(
      `[claudeai-mcp] cached_init_response for ${server.id} failed InitializeResult validation — falling back to real initialize`,
    )
    return
  }
  const protocolVersion = parsed.data.protocolVersion
  if (
    !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(
      protocolVersion,
    )
  ) {
    logForDebugging(
      `[claudeai-mcp] cached_init_response for ${server.id} carries unsupported protocolVersion ${sanitizeProtocolVersionForLog(protocolVersion)} — falling back to real initialize`,
    )
    return
  }
  return parsed.data as InitializeResult
}

/**
 * densable `H_f`/`Pff` — cached discover projection.
 * `legacy` → method-not-found; non-`supported` → undefined (pass through);
 * `supported` + body fails shape → pass through (N_f copy log).
 */
export function resolveCachedClaudeAiDiscover(
  server: ClaudeAiProxyStatelessConfig,
  readFeature?: (key: string, def: boolean) => boolean,
): CachedDiscoverProjection | undefined {
  if (!isStatelessClaudeAiProxy(server, readFeature)) return
  if (server.type !== 'claudeai-proxy') return
  if (server.discoverSupport === 'legacy') return 'method-not-found'
  if (server.discoverSupport !== 'supported') return
  if (server.cachedDiscoverResponse == null) return
  const parsed = cachedDiscoverResultSchema().safeParse(
    server.cachedDiscoverResponse,
  )
  if (!parsed.success) {
    logForDebugging(
      `[claudeai-mcp] cached_discover_response for ${server.id} failed DiscoverResult shape check — passing server/discover through`,
    )
    return
  }
  return { result: parsed.data as DiscoverResult }
}

/**
 * densable `N_f(e,t,r)` — wrap `transport.send` so initialize / server/discover
 * resolve locally from the cached projection. Swallows
 * `notifications/initialized`. **claudeai-proxy only** — never stdio.
 *
 * `cachedDiscover` omitted (reconnect `_9a(u,M)`) leaves discover on the wire.
 */
export function interceptStatelessClaudeAiProxySend(
  transport: Transport,
  cachedInit: InitializeResult | undefined,
  cachedDiscover?: CachedDiscoverProjection,
): void {
  const originalSend = transport.send.bind(transport)
  transport.send = async (message: JSONRPCMessage, options) => {
    if (
      cachedInit !== undefined &&
      isJSONRPCRequest(message) &&
      message.method === 'initialize'
    ) {
      const response = {
        jsonrpc: '2.0' as const,
        id: message.id,
        result: cachedInit,
      }
      queueMicrotask(() => transport.onmessage?.(response))
      return
    }
    if (
      cachedDiscover !== undefined &&
      isJSONRPCRequest(message) &&
      message.method === 'server/discover'
    ) {
      const response =
        cachedDiscover === 'method-not-found'
          ? {
              jsonrpc: '2.0' as const,
              id: message.id,
              error: {
                code: ProtocolErrorCode.MethodNotFound,
                message: 'server/discover resolved locally as unsupported',
              },
            }
          : {
              jsonrpc: '2.0' as const,
              id: message.id,
              result: cachedDiscover.result,
            }
      queueMicrotask(() => transport.onmessage?.(response))
      return
    }
    if (
      isJSONRPCNotification(message) &&
      message.method === 'notifications/initialized'
    ) {
      return
    }
    return originalSend(message, options)
  }
}

/**
 * densable `F_f`/`Off` — GET to the Streamable HTTP endpoint returns 405 so
 * the SDK does not open an SSE stream on a stateless proxy.
 */
export function suppressGetSseOnEndpoint(
  inner: FetchLike,
  endpoint: string,
): FetchLike {
  const canonical = new URL(endpoint).href
  return async (input, init) => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
      return inner(input, init)
    }
    // FetchLike is `string | URL` (MCP SDK). Do not cast to Request — URL also
    // satisfies `'url' in input` under TS and that conversion is TS2352.
    const raw = input instanceof URL ? input.href : String(input)
    if (new URL(raw).href === canonical) {
      return new Response(null, {
        status: 405,
        statusText: 'Method Not Allowed',
      })
    }
    return inner(input, init)
  }
}

/**
 * densable `$Yp` — client-capabilities header on `/v1/mcp_servers` fetch
 * when skip-init GB is on. Oversized base64 omits both headers.
 */
export function claudeAiMcpInitProjectionHeaders(
  readFeature?: (key: string, def: boolean) => boolean,
): Record<string, string> {
  if (!isClaudeAiStatelessSkipInitEnabled(readFeature)) return {}
  const payload = densableClientCapabilities()
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64')
  if (
    Buffer.byteLength(encoded, 'ascii') >
    CLAUDEAI_INIT_PROJECTION_HEADER_MAX_BYTES
  ) {
    logForDebugging(
      '[claudeai-mcp] client capabilities header exceeds size limit — omitting init-projection headers',
    )
    return {}
  }
  return {
    'anthropic-mcp-client-capabilities': encoded,
    'MCP-Protocol-Version': CLAUDEAI_MCP_PROTOCOL_VERSION_HEADER,
  }
}

export type StatelessClaudeAiProxyWrap = {
  cachedInit: InitializeResult | undefined
  cachedDiscover: CachedDiscoverProjection | undefined
}

/**
 * densable connect-site logs + `N_f(u,S,v)`.
 * `includeDiscover: false` matches reconnect `_9a(u,M)` (init only).
 */
export function wrapStatelessClaudeAiProxyTransport(
  transport: Transport,
  server: ClaudeAiProxyStatelessConfig,
  log: (message: string) => void,
  opts?: {
    includeDiscover?: boolean
    readFeature?: (key: string, def: boolean) => boolean
  },
): StatelessClaudeAiProxyWrap | undefined {
  if (!isStatelessClaudeAiProxy(server, opts?.readFeature)) return
  const cachedInit = resolveCachedClaudeAiInitialize(server, opts?.readFeature)
  const cachedDiscover =
    opts?.includeDiscover === false
      ? undefined
      : resolveCachedClaudeAiDiscover(server, opts?.readFeature)
  log(
    cachedInit
      ? 'Stateless claudeai-proxy — resolving MCP initialize from cached projection'
      : 'Stateless claudeai-proxy — no cached projection; real initialize, GET SSE suppressed',
  )
  if (cachedDiscover !== undefined) {
    log(
      cachedDiscover === 'method-not-found'
        ? 'Stateless claudeai-proxy — server/discover resolved locally as legacy (method-not-found)'
        : 'Stateless claudeai-proxy — resolving server/discover from cached projection',
    )
  }
  interceptStatelessClaudeAiProxySend(transport, cachedInit, cachedDiscover)
  return { cachedInit, cachedDiscover }
}
