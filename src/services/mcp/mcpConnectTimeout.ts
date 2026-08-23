/**
 * densable 2.1.232 #16 — MCP connect timeout helpers (y0 / Obf / IiS / oMf / k5a)
 * + auto-probe → pinned-legacy (classify / remaining budget / preserve
 * CONNECT_TIMEOUT). Product reconnect orchestration lives in `client.ts`.
 * v2 `@modelcontextprotocol/client@2` emits `SdkErrorCode.EraNegotiationFailed`
 * (`ERA_NEGOTIATION_FAILED`) and probe-timeout `REQUEST_TIMEOUT` with a
 * "Version negotiation probe timed out" message (no densable
 * `_anthropicProbeTimedOut` stamp required).
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { logForDebugging } from '../../utils/debug.js'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../utils/errors.js'

/** densable y0 default when MCP_TIMEOUT unset / non-positive. */
export const DEFAULT_MCP_TIMEOUT_MS = 30_000
/** densable Obf default when MCP_CONNECT_TIMEOUT_MS unset / non-positive. */
export const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 5_000
/** densable RiS — reserved ms when computing auto initialize timeout (IiS). */
export const MCP_INIT_BUDGET_RESERVE_MS = 5_000
/** densable CiS — http/auto probe cap. */
export const MCP_PROTOCOL_PROBE_HTTP_CAP_MS = 5_000
/** densable xiS — stdio/auto probe cap. */
export const MCP_PROTOCOL_PROBE_STDIO_CAP_MS = 3_000
/** densable Math.min floor for env timeout. */
const MCP_TIMEOUT_HARD_CAP_MS = 2_147_483_647

export type McpProtocolNegotiationMode = 'legacy' | 'auto'

/**
 * densable BVa versionNegotiation plan shape:
 * `{mode:'legacy'} | {mode:'auto', probe:{timeoutMs}}`.
 */
export type McpProtocolNegotiationPlan =
  | { mode: 'legacy' }
  | { mode: 'auto'; probe: { timeoutMs: number } }

/** densable probeFellBack reason: closed | probe_timeout | probe_failed. */
export type McpProbeFallbackReason = 'closed' | 'probe_timeout' | 'probe_failed'

/**
 * densable transport probe marker (SEA residual). When present on a transport
 * after auto connect, RequestTimeout is treated as probe_timeout not outer hang.
 * Public client@2 does not stamp this — see message/code arms below.
 */
export type McpProbeTimedOutTransport = {
  _anthropicProbeTimedOut?: boolean
}

/**
 * densable `Mu.EraNegotiationFailed` named surface (SEA / older bags).
 * Public client@2 uses `SdkErrorCode.EraNegotiationFailed === 'ERA_NEGOTIATION_FAILED'`.
 */
export const MCP_ERA_NEGOTIATION_FAILED_CODE = 'EraNegotiationFailed'
/** v2 `@modelcontextprotocol/client` SdkErrorCode.EraNegotiationFailed wire value. */
export const MCP_ERA_NEGOTIATION_FAILED_SDK_CODE = 'ERA_NEGOTIATION_FAILED'

/** densable floor for pinned-legacy remaining budget. */
export const MCP_PINNED_LEGACY_RETRY_MIN_MS = 1_000

/**
 * densable env positive-int parser for y0/Obf:
 * `e && e > 0 ? Math.min(e, 2147483647) : default`.
 */
export function parseMcpPositiveTimeoutMs(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), MCP_TIMEOUT_HARD_CAP_MS)
}

/** densable `y0` — outer connection race budget (MCP_TIMEOUT, default 30s). */
export function getMcpTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseMcpPositiveTimeoutMs(env.MCP_TIMEOUT, DEFAULT_MCP_TIMEOUT_MS)
}

/**
 * densable `Obf` — dial / connect-phase budget (MCP_CONNECT_TIMEOUT_MS, default 5s).
 * Used by lazy dial latch paths; outer connect race still uses y0.
 */
export function getMcpConnectTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseMcpPositiveTimeoutMs(
    env.MCP_CONNECT_TIMEOUT_MS,
    DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  )
}

/**
 * densable `IiS` — SDK initialize timeout when protocol negotiation is auto:
 * `max(y0 - RiS, floor(y0 / 3))` with RiS=5000.
 */
export function getMcpInitializeTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const outer = getMcpTimeoutMs(env)
  return Math.max(outer - MCP_INIT_BUDGET_RESERVE_MS, Math.floor(outer / 3))
}

/**
 * densable outer-race initialize options: auto → IiS, legacy → y0.
 * Outer Promise.race always uses y0 regardless.
 */
export function getMcpClientConnectTimeoutMs(
  mode: McpProtocolNegotiationMode,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return mode === 'auto' ? getMcpInitializeTimeoutMs(env) : getMcpTimeoutMs(env)
}

/** densable `rt("tengu_mcp_connect_timeout_retry", true)`. */
export function isMcpConnectTimeoutRetryEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_mcp_connect_timeout_retry',
    true,
  )
}

/**
 * densable `oMf` — outer connection timeout error with optional CONNECT_TIMEOUT.
 */
export function createMcpConnectionTimeoutError(
  message: string,
  options?: { tagConnectTimeout?: boolean },
): TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS & {
  code?: string
} {
  const err = new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    message,
    'MCP connection timeout',
  ) as TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS & {
    code?: string
  }
  const tag = options?.tagConnectTimeout ?? isMcpConnectTimeoutRetryEnabled()
  if (tag) {
    err.code = 'CONNECT_TIMEOUT'
  }
  return err
}

/**
 * densable `ocv` — transports that may auto-probe when env
 * `MCP_PROTOCOL_NEGOTIATION=auto`. 238 dropped the stdio GB flag
 * (`tengu_mcp_protocol_negotiation_stdio` 0 hits); stdio stays legacy
 * unless the env forces auto. Do **not** wrap stdio with N_f (claudeai-proxy
 * send-intercept only).
 */
const MCP_ERA_AUTO_CAPABLE = new Set([
  'http',
  'claudeai-proxy',
  'ccr-proxy',
  'stdio',
])

/**
 * densable `Gia` — CCR/session-ingress MCP path markers for `Cke`.
 * Dedup `unwrapCcrProxyUrl` uses a subset; negotiation kind needs the full list.
 */
export const MCP_CCR_PROXY_PATH_MARKERS = [
  '/v2/session_ingress/shttp/mcp/',
  '/v2/session_ingress/mcp/ws/',
  '/v2/ccr-sessions/',
  '/v1/code/',
] as const

/**
 * densable `qxd`/`zxd` — capture ingress origin at module init
 * (`SESSION_INGRESS_URL ?? ANTHROPIC_BASE_URL`). `reset()` recaptures.
 */
let capturedCcrIngressBase =
  process.env.SESSION_INGRESS_URL ?? process.env.ANTHROPIC_BASE_URL

/** densable `qxd.reset` — tests only. */
export function resetMcpCcrIngressCapture(
  env: NodeJS.ProcessEnv = process.env,
): void {
  capturedCcrIngressBase = env.SESSION_INGRESS_URL ?? env.ANTHROPIC_BASE_URL
}

function originForCcrCompare(url: URL): string {
  if (url.protocol === 'wss:') return `https://${url.host}`
  if (url.protocol === 'ws:') return `http://${url.host}`
  return url.origin
}

/**
 * densable `Cke` — URL is CCR/session-ingress iff same origin as captured
 * ingress base and pathname contains a `Gia` marker.
 */
export function isMcpCcrProxyUrl(url: string): boolean {
  const base = capturedCcrIngressBase
  if (!base) return false
  let parsed: URL
  let ingress: URL
  try {
    parsed = new URL(url)
    ingress = new URL(base)
  } catch {
    return false
  }
  if (originForCcrCompare(parsed) !== ingress.origin) return false
  return MCP_CCR_PROXY_PATH_MARKERS.some(marker =>
    parsed.pathname.includes(marker),
  )
}

/**
 * densable `pMn` URL arm: `"url"in e && typeof e.url==="string" && Cke(e.url)`.
 * SEA `vbe` (`cliOwnedConfigs` WeakSet) has no local equivalent — **do not invent**.
 */
export function isMcpCcrProxyServerConfig(
  serverConfig: object | undefined,
): boolean {
  if (
    serverConfig !== undefined &&
    'url' in serverConfig &&
    typeof serverConfig.url === 'string' &&
    isMcpCcrProxyUrl(serverConfig.url)
  ) {
    return true
  }
  return false
}

/**
 * densable `n_f(e, {inProcess, ccrProxy})` — Pwi transport kind.
 * `http` + ccrProxy → `ccr-proxy` (GB `tengu_mcp_protocol_negotiation_ccr`).
 */
export function resolveMcpNegotiationTransportKind(
  serverType: string | undefined,
  opts: { inProcess?: boolean; ccrProxy?: boolean } = {},
): string | undefined {
  if (opts.inProcess) return 'in-process'
  switch (serverType) {
    case 'http':
      return opts.ccrProxy ? 'ccr-proxy' : 'http'
    case 'sse':
      return 'sse'
    case 'ws':
      return 'ws'
    case 'sse-ide':
    case 'ws-ide':
      return 'ide'
    case 'claudeai-proxy':
      return 'claudeai-proxy'
    case 'sdk':
      return 'sdk-control'
    case 'stdio':
    case undefined:
      return 'stdio'
  }
  return undefined
}

/**
 * densable `xwi`/`Pwi` `t` — full MCP server config. Only `url` is read
 * when present; stdio (no url) is a valid denylist target (`*` / url-less).
 */
export type McpDenylistServerConfig = object

/**
 * densable `xwi` body after `it(e,[])`: empty/non-array → false; `"*"` → true;
 * else hostname exact or subdomain-suffix match.
 */
export function matchMcpServerDenylist(
  entries: unknown,
  serverConfig: McpDenylistServerConfig | undefined,
): boolean {
  if (!Array.isArray(entries) || entries.length === 0) return false
  if (entries.includes('*')) return true
  if (
    serverConfig === undefined ||
    !('url' in serverConfig) ||
    typeof serverConfig.url !== 'string'
  ) {
    return false
  }
  try {
    const hostname = new URL(serverConfig.url).hostname.toLowerCase()
    return entries.some(entry => {
      if (typeof entry !== 'string' || entry === '') return false
      const needle = entry.toLowerCase()
      return hostname === needle || hostname.endsWith(`.${needle}`)
    })
  } catch {
    return false
  }
}

/**
 * densable `LGa` — `xwi("tengu_mcp_negotiation_server_denylist", server)`.
 */
export function isMcpNegotiationServerDenylisted(
  serverConfig: McpDenylistServerConfig | undefined,
  readFeature: (key: string, def: unknown[]) => unknown = (key, def) =>
    getFeatureValue_CACHED_MAY_BE_STALE(key, def),
): boolean {
  if (serverConfig === undefined) return false
  return matchMcpServerDenylist(
    readFeature('tengu_mcp_negotiation_server_denylist', []),
    serverConfig,
  )
}

/**
 * densable `Pwi` / k5a — resolve negotiation mode + probe budget.
 * Full auto probe/retry transport is not implemented; callers use `mode` to
 * choose initialize timeout (y0 vs IiS). GB keys default false → legacy unless
 * env MCP_PROTOCOL_NEGOTIATION=auto (and transport is auto-capable).
 *
 * densable `Pwi(e,t,r)`: invalid env warns then falls through; env auto
 * early-returns (no denylist); GB-derived auto + `t!==void 0` + `(r??LGa(t))`
 * forces legacy. Do **not** wrap stdio with N_f.
 */
export function resolveMcpProtocolNegotiationPlan(
  transportKind: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  isFeatureEnabled: (key: string, defaultValue: boolean) => boolean = (
    key,
    def,
  ) => getFeatureValue_CACHED_MAY_BE_STALE(key, def),
  serverConfig?: McpDenylistServerConfig,
  precomputedDenylist?: boolean,
): McpProtocolNegotiationPlan {
  const raw = env.MCP_PROTOCOL_NEGOTIATION
  const envMode =
    raw === 'legacy' || raw === 'auto'
      ? (raw as McpProtocolNegotiationMode)
      : undefined
  if (raw !== undefined && envMode === undefined) {
    logForDebugging(
      `MCP_PROTOCOL_NEGOTIATION=${raw} is invalid; expected 'legacy' or 'auto' — ignoring`,
      { level: 'warn' },
    )
  }

  if (envMode === 'legacy') return { mode: 'legacy' }

  const kind = transportKind ?? 'stdio'
  const outer = getMcpTimeoutMs(env)
  const httpProbe = Math.min(
    MCP_PROTOCOL_PROBE_HTTP_CAP_MS,
    Math.floor(outer / 3),
  )
  const stdioProbe = Math.min(
    MCP_PROTOCOL_PROBE_STDIO_CAP_MS,
    Math.floor(outer / 3),
  )

  if (envMode === 'auto') {
    // densable ocv.has(e) — http/claudeai-proxy/ccr-proxy/stdio; else legacy.
    // Env auto early-returns — denylist is GB-path only (`s` after the switch).
    if (!MCP_ERA_AUTO_CAPABLE.has(kind)) return { mode: 'legacy' }
    return {
      mode: 'auto',
      probe: { timeoutMs: kind === 'stdio' ? stdioProbe : httpProbe },
    }
  }

  let plan: McpProtocolNegotiationPlan
  switch (kind) {
    case 'http':
      plan = isFeatureEnabled('tengu_mcp_protocol_negotiation_http', false)
        ? { mode: 'auto', probe: { timeoutMs: httpProbe } }
        : { mode: 'legacy' }
      break
    case 'claudeai-proxy':
      plan = isFeatureEnabled('tengu_mcp_protocol_negotiation_claudeai', false)
        ? { mode: 'auto', probe: { timeoutMs: httpProbe } }
        : { mode: 'legacy' }
      break
    case 'stdio':
      // densable 2.1.238: `case"stdio":return{mode:"legacy"}` — no GB.
      plan = { mode: 'legacy' }
      break
    case 'ccr-proxy':
      plan = isFeatureEnabled('tengu_mcp_protocol_negotiation_ccr', false)
        ? { mode: 'auto', probe: { timeoutMs: httpProbe } }
        : { mode: 'legacy' }
      break
    default:
      // sse / ws / ide / in-process / sdk-control → legacy
      plan = { mode: 'legacy' }
      break
  }

  if (
    plan.mode === 'auto' &&
    serverConfig !== undefined &&
    (precomputedDenylist ?? isMcpNegotiationServerDenylisted(serverConfig))
  ) {
    let label = "a url-less server (the '*' entry)"
    if ('url' in serverConfig && typeof serverConfig.url === 'string') {
      try {
        label = new URL(serverConfig.url).hostname
      } catch {
        label = 'a server with an unparseable url'
      }
    }
    logForDebugging(
      `MCP era negotiation denylist matched ${label}; the legacy handshake applies`,
    )
    return { mode: 'legacy' }
  }
  return plan
}

function readErrorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: string | number }).code
  return code
}

function readErrorCause(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined
  const data = (error as { data?: unknown }).data
  if (typeof data === 'object' && data !== null && 'cause' in data) {
    return (data as { cause?: unknown }).cause
  }
  return (error as { cause?: unknown }).cause
}

/**
 * densable: `ee instanceof rd && ee.code === Mu.EraNegotiationFailed`.
 * v2 client: `SdkError` / `SdkHttpError` with `code === 'ERA_NEGOTIATION_FAILED'`.
 */
export function isMcpEraNegotiationFailedError(error: unknown): boolean {
  const code = readErrorCode(error)
  if (
    code === MCP_ERA_NEGOTIATION_FAILED_CODE ||
    code === MCP_ERA_NEGOTIATION_FAILED_SDK_CODE
  ) {
    return true
  }
  if (typeof code === 'string' && /era.?negotiation.?failed/i.test(code)) {
    return true
  }
  if (
    error instanceof Error &&
    /era.?negotiation.?failed/i.test(error.message)
  ) {
    return true
  }
  // v2 SdkError name + era code already covered; also message from SdkHttpError.
  if (
    error &&
    typeof error === 'object' &&
    (error as { name?: string }).name === 'SdkError' &&
    typeof code === 'string' &&
    code.includes('ERA_NEGOTIATION')
  ) {
    return true
  }
  return false
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message
    return typeof m === 'string' ? m : ''
  }
  return ''
}

/**
 * densable: auto + RequestTimeout + `l?._anthropicProbeTimedOut === true`.
 * v2 client@2: probe timeout is `SdkErrorCode.RequestTimeout` (`REQUEST_TIMEOUT`)
 * with message `Version negotiation probe timed out after …ms` (no stamp).
 * Also treat explicit CONNECT_TIMEOUT / -32001 when the densable stamp is set.
 */
export function isMcpProtocolProbeTimeoutError(
  error: unknown,
  transport?: McpProbeTimedOutTransport | null,
): boolean {
  const code = readErrorCode(error)
  const msg = readErrorMessage(error)
  // Public v2 probe classifier — message is authoritative without SEA stamp.
  if (/version negotiation probe timed out/i.test(msg)) {
    return true
  }
  if (
    (code === 'REQUEST_TIMEOUT' || code === 'RequestTimeout') &&
    /version negotiation probe/i.test(msg)
  ) {
    return true
  }
  if (transport?._anthropicProbeTimedOut !== true) return false
  if (code === 'CONNECT_TIMEOUT' || code === -32001 || code === '-32001') {
    return true
  }
  if (code === 'RequestTimeout' || code === 'REQUEST_TIMEOUT') return true
  // McpError RequestTimeout enum value
  if (typeof code === 'number' && code === -32001) return true
  return false
}

/**
 * densable auth-like failures that must NOT preserve the original probe timeout
 * when pinned-legacy retry fails (`Re` in SEA): UnauthorizedError / 401 / 403 /
 * explicit auth challenge.
 */
export function isMcpPinnedLegacyAuthLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as {
    name?: string
    status?: number
    code?: string | number
    message?: string
  }
  if (err.name === 'UnauthorizedError') return true
  if (error instanceof Error && error.name === 'UnauthorizedError') return true
  if (err.status === 401 || err.status === 403) return true
  if (
    err.code === 401 ||
    err.code === 403 ||
    err.code === '401' ||
    err.code === '403'
  ) {
    return true
  }
  return false
}

export type McpAutoProbeFallbackDecision =
  | { shouldFallback: false }
  | { shouldFallback: true; reason: McpProbeFallbackReason }

/**
 * densable auto-mode catch branch:
 * - EraNegotiationFailed on stdio → reason `closed` (rmcp hard-close respawn)
 * - EraNegotiationFailed or probe timeout on recreatable transport →
 *   `probe_failed` / `probe_timeout`
 * - EraNegotiationFailed whose cause is a hard-throw class → no fallback
 *   (caller may pass `hardThrowCause: true` when cause is that class)
 */
export function classifyMcpAutoProbeFallback(
  plan: McpProtocolNegotiationPlan | undefined,
  error: unknown,
  opts: {
    transportType?: string | undefined
    transport?: McpProbeTimedOutTransport | null
    /** densable `u !== void 0` / stdio spawn available. */
    canRecreateTransport: boolean
    /**
     * densable: if EraNegotiationFailed and cause is tX-class, rethrow without
     * fallback. Default false (unknown cause → allow fallback).
     */
    hardThrowCause?: boolean
  },
): McpAutoProbeFallbackDecision {
  if (!plan || plan.mode !== 'auto') return { shouldFallback: false }
  if (!opts.canRecreateTransport) return { shouldFallback: false }

  const eraFailed = isMcpEraNegotiationFailedError(error)
  const probeTimedOut = isMcpProtocolProbeTimeoutError(error, opts.transport)

  if (eraFailed && opts.hardThrowCause) {
    return { shouldFallback: false }
  }
  // densable also hard-throws when cause is tX even without hardThrowCause flag
  // when detected; leave to caller.

  const kind = opts.transportType ?? 'stdio'
  const isStdio = kind === 'stdio' || kind === undefined || kind === ''

  if (eraFailed && isStdio) {
    return { shouldFallback: true, reason: 'closed' }
  }
  if (eraFailed || probeTimedOut) {
    return {
      shouldFallback: true,
      reason: probeTimedOut ? 'probe_timeout' : 'probe_failed',
    }
  }
  return { shouldFallback: false }
}

/** densable `Math.max(1000, y0() - (Date.now() - n))`. */
export function getMcpPinnedLegacyRetryTimeoutMs(
  connectStartedAtMs: number,
  nowMs: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): number {
  return Math.max(
    MCP_PINNED_LEGACY_RETRY_MIN_MS,
    getMcpTimeoutMs(env) - (nowMs - connectStartedAtMs),
  )
}

/** densable At() strings for probe → pinned-legacy. */
export function formatMcpProbeFallbackDebugMessage(
  reason: McpProbeFallbackReason,
  transportType: string | undefined,
): string {
  const kind = transportType ?? 'http'
  switch (reason) {
    case 'closed':
      return 'version negotiation probe closed the stdio server (rmcp-class pre-init hard close); respawning pinned legacy'
    case 'probe_timeout':
      return `version negotiation probe timed out on the ${kind} transport; reconnecting pinned legacy within the remaining budget`
    case 'probe_failed':
      return `version negotiation probe failed on the ${kind} transport; reconnecting pinned legacy`
  }
}

/**
 * densable: `ge && !Re && !be` → rethrow original probe timeout so ladder keeps
 * CONNECT_TIMEOUT classification.
 */
export function shouldPreserveConnectTimeoutAfterPinnedLegacyRetry(
  probeReason: McpProbeFallbackReason | undefined,
  retryError: unknown,
  opts?: { outerTimedOut?: boolean },
): boolean {
  if (probeReason !== 'probe_timeout') return false
  if (opts?.outerTimedOut) return false
  if (isMcpPinnedLegacyAuthLikeError(retryError)) return false
  return true
}

/** densable preserve-timeout log (snippet already truncated by caller). */
export function formatPinnedLegacyRetryPreserveTimeoutLog(
  typedSnippet: string,
): string {
  return `pinned-legacy retry after the probe timeout failed typed (${typedSnippet}); preserving the timeout classification so the connect stays ladder-retryable`
}

/** densable `hi(…, 200)`-style short snippet for the preserve log. */
export function truncateMcpErrorSnippet(raw: string, max = 200): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return collapsed.slice(0, max)
}

/** Expose cause reader for client hard-throw checks. */
export function getMcpErrorCause(error: unknown): unknown {
  return readErrorCause(error)
}
