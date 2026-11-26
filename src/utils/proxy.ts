// @aws-sdk/credential-provider-node and @smithy/node-http-handler are imported
// dynamically in getAWSClientProxyConfig() to defer ~929KB of AWS SDK.
// undici is lazy-required inside getProxyAgent/configureGlobalAgents to defer
// ~1.5MB when no HTTPS_PROXY/mTLS env vars are set (the common case).
import axios, { type AxiosInstance } from 'axios'
import type { LookupOptions } from 'dns'
import type { Agent } from 'http'
import {
  Agent as HttpsAgent,
  type AgentOptions as HttpsAgentOptions,
} from 'https'
import { type Socket } from 'net'
import memoize from 'lodash-es/memoize.js'
import type * as undici from 'undici'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { getCACertificates } from './caCerts.js'
import { logForDebugging } from './debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import {
  getMTLSAgent,
  getMTLSConfig,
  getTLSFetchOptions,
  setMtlsErrorClosingAgentFactory,
  type TLSConfig,
} from './mtls.js'
import {
  type HardenedHttpsProxyAgentOptions,
  SecureHttpsProxyAgent,
} from './proxyConnectAgent.js'
export {
  assertSafeIdpProxyTarget,
  buildConnectRequestLines,
  buildTlsIdentityOptions,
  createIdpHttpViaProxyBlockedError,
  createIdpProxyAgent,
  createLoopbackMetadataViaProxyBlockedError,
  ERR_PROXY_TUNNEL_CODE,
  HardenedHttpsProxyAgent,
  type HardenedHttpsProxyAgentOptions,
  type IdpDnsLookup,
  IdpProxyAgent,
  type IdpProxyAgentOptions,
  isBlockedLoopbackOrMetadataHost,
  MAX_PROXY_CONNECT_HEADER_BYTES,
  type ParsedProxyConnectResponse,
  parseIpBytes,
  parseProxyConnectResponse,
  PROXY_CONNECT_ERROR_STATUS_RE,
  type ProxyConnectEndpointOptions,
  type ProxyConnectHeadersInput,
  type ProxyConnectHeaderValue,
  resolveSafeIdpHostname,
  SecureHttpsProxyAgent,
  type SsrfBlockedError,
} from './proxyConnectAgent.js'

// Disable fetch keep-alive after a stale-pool ECONNRESET so retries open a
// fresh TCP connection instead of reusing the dead pooled socket. Sticky for
// the process lifetime — once the pool is known-bad, don't trust it again.
// Works under Bun (native fetch respects keepalive:false for pooling).
// Under Node/undici, keepalive is a no-op for pooling, but undici
// naturally evicts dead sockets from the pool on ECONNRESET.
let keepAliveDisabled = false

export function disableKeepAlive(): void {
  keepAliveDisabled = true
}

export function _resetKeepAliveForTesting(): void {
  keepAliveDisabled = false
  closesAfterServerError = false
  trackedHttpsAgents.clear()
  setMtlsErrorClosingAgentFactory(null, false)
}

let closesAfterServerError = false
const trackedHttpsAgents = new Set<HttpsAgent>()

/**
 * Official `r5t(e)` (#1588/#1589/#1590) — 5xx status codes that should drop the
 * keep-alive connection and idle sockets (excludes 501 Not Implemented and 529
 * Overloaded).
 */
export function isServerErrorClosingStatus(statusCode: number): boolean {
  return statusCode >= 500 && statusCode !== 501 && statusCode !== 529
}

/**
 * Official `mr(e)` — destroy all idle sockets currently in `agent.freeSockets`.
 */
export function destroyAgentFreeSockets(
  agent: Pick<HttpsAgent, 'freeSockets'> | undefined,
): void {
  if (!agent?.freeSockets) return
  for (const list of Object.values(agent.freeSockets)) {
    for (const sock of [...(list ?? [])]) {
      sock.destroy()
    }
  }
}

/**
 * Official `at(e)` — prevent future free-socket pooling and destroy existing idle sockets.
 */
export function retireKeepAliveAgent(
  agent:
    | (Pick<HttpsAgent, 'freeSockets'> & { maxFreeSockets?: number })
    | undefined,
): void {
  if (!agent) return
  agent.maxFreeSockets = 0
  destroyAgentFreeSockets(agent)
}

/**
 * Official `class Er extends Agent` (#1588/#1589/#1590) — when a server answers
 * with a 5xx status (other than 501 or 529), close that socket and destroy all
 * idle freeSockets to the same `host:port:` so the next request opens a fresh
 * connection.
 */
export class KeepAliveErrorClosingAgent extends HttpsAgent {
  override keepSocketAlive(socket: Socket): boolean {
    const httpSocket = socket as Socket & {
      _httpMessage?: { res?: { statusCode?: number }; host?: string }
    }
    const req = httpSocket._httpMessage
    const port = httpSocket.remotePort
    const statusCode = req?.res?.statusCode
    if (statusCode === undefined || !isServerErrorClosingStatus(statusCode)) {
      return Boolean(super.keepSocketAlive(socket))
    }
    logForDebugging(
      `HTTPS agent: a server on port ${port} answered ${statusCode}; closing that connection and the idle ones to the same host and port, so the next request opens a new one`,
    )
    const prefix = `${req?.host}:${port}:`
    for (const [key, list] of Object.entries(this.freeSockets)) {
      if (key.startsWith(prefix)) {
        for (const sock of [...(list ?? [])]) {
          sock.destroy()
        }
      }
    }
    return false
  }
}

/**
 * Official `Fxt()` — enable `KeepAliveErrorClosingAgent` for new HTTPS agents
 * and retire/destroy idle sockets on existing tracked agents.
 */
export function enableClosesAfterServerError(): void {
  closesAfterServerError = true
  for (const agent of trackedHttpsAgents) {
    retireKeepAliveAgent(agent)
  }
  trackedHttpsAgents.clear()
  retireKeepAliveAgent(
    axios.defaults.httpsAgent as
      | (Pick<HttpsAgent, 'freeSockets'> & { maxFreeSockets?: number })
      | undefined,
  )
  retireKeepAliveAgent(
    axios.defaults.httpAgent as
      | (Pick<HttpsAgent, 'freeSockets'> & { maxFreeSockets?: number })
      | undefined,
  )
  setMtlsErrorClosingAgentFactory(
    options => createKeepAliveHttpsAgent(options),
    true,
  )
  if (!getProxyUrl()) {
    axios.defaults.httpsAgent = getMTLSAgent() ?? createKeepAliveHttpsAgent()
  }
}

export function shouldCloseAfterServerError(): boolean {
  return closesAfterServerError
}

export function createKeepAliveHttpsAgent(
  options: HttpsAgentOptions = {},
): HttpsAgent {
  const agent = closesAfterServerError
    ? new KeepAliveErrorClosingAgent({ keepAlive: true, ...options })
    : new HttpsAgent({ keepAlive: true, ...options })
  trackedHttpsAgents.add(agent)
  return agent
}

/**
 * Destroy idle keep-alive sockets on an agent for a specific URL (e.g. when a
 * heartbeat or request gets no response).
 */
export function destroyFreeSocketsForUrl(
  agent: Pick<HttpsAgent, 'freeSockets'> | undefined,
  rawUrl: string | undefined,
): void {
  if (!agent?.freeSockets || !rawUrl) return
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return
  }
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  const prefix = `${parsed.hostname.replace(/^\[(.*)\]$/, '$1')}:${port}:`
  for (const [key, list] of Object.entries(agent.freeSockets)) {
    if (key.startsWith(prefix)) {
      for (const sock of [...(list ?? [])]) {
        sock.destroy()
      }
    }
  }
}

/**
 * Official `GNa()` — destroy idle freeSockets across all tracked HTTPS agents
 * and axios default agents.
 */
export function destroyAllFreeSockets(): void {
  for (const agent of trackedHttpsAgents) {
    destroyAgentFreeSockets(agent)
  }
  destroyAgentFreeSockets(
    axios.defaults.httpsAgent as Pick<HttpsAgent, 'freeSockets'> | undefined,
  )
  destroyAgentFreeSockets(
    axios.defaults.httpAgent as Pick<HttpsAgent, 'freeSockets'> | undefined,
  )
}

/**
 * Convert dns.LookupOptions.family to a numeric address family value
 * Handles: 0 | 4 | 6 | 'IPv4' | 'IPv6' | undefined
 */
export function getAddressFamily(options: LookupOptions): 0 | 4 | 6 {
  switch (options.family) {
    case 0:
    case 4:
    case 6:
      return options.family
    case 'IPv6':
      return 6
    case 'IPv4':
    case undefined:
      return 4
    default:
      throw new Error(`Unsupported address family: ${options.family}`)
  }
}

type EnvLike = Record<string, string | undefined>

export const BARE_HOST_PORT_PROXY_RE =
  /^(\[[0-9a-f:.]+\]|[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*):[1-9]\d{0,4}\/?$/i

const PROXY_ENV_KEYS_ORDERED = [
  'https_proxy',
  'HTTPS_PROXY',
  'http_proxy',
  'HTTP_PROXY',
] as const

const REPAIRED_SCHEME_SENSITIVE_PROXY_KEYS = [
  'https_proxy',
  'HTTPS_PROXY',
  'grpc_proxy',
  'GRPC_PROXY',
] as const

let completedBareProxyRepairUrl: string | undefined

export function resetBareProxyRepairStateForTests(): void {
  completedBareProxyRepairUrl = undefined
}

export function getCompletedBareProxyRepairUrl(): string | undefined {
  return completedBareProxyRepairUrl
}

function parseUrlHostname(raw: string): string | undefined {
  try {
    return new URL(raw).hostname || undefined
  } catch {
    return undefined
  }
}

function hasProxyUrlScheme(raw: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim())
}

/**
 * Official 2.1.327 `W(e)` (#400): if `value` is a bare `host:port` (no scheme,
 * valid hostname or IPv6 literal, <= 300 chars), return `http://${value}`;
 * otherwise return `value` unchanged.
 */
export function repairBareHostPortProxyValue(value: string): string {
  const host =
    value.length > 300 ? undefined : BARE_HOST_PORT_PROXY_RE.exec(value)?.[1]
  if (!host || parseUrlHostname(value)) return value
  const candidate = `http://${value}`
  return parseUrlHostname(candidate) === host.toLowerCase() ? candidate : value
}

/**
 * Official 2.1.327 `z(e)` (#400): when neither stdin nor stdout is a TTY
 * (desktop app, SDK, cron) and `https_proxy` or `HTTPS_PROXY` is a bare
 * `host:port`, prepend `http://` to matching proxy env vars so Claude Code
 * starts cleanly instead of failing URL parsing.
 */
export function repairBareProxySchemeAtStartup(opts?: {
  env?: EnvLike
  stdinIsTTY?: boolean
  stdoutIsTTY?: boolean
  isNonInteractiveSession?: boolean
  argv?: string[]
  hasProxyAuthHelper?: boolean
}): { repaired: boolean; repairedKeys: string[]; repairedUrl?: string } {
  const env = opts?.env ?? process.env
  const activeKey = PROXY_ENV_KEYS_ORDERED.find(k => Boolean(env[k]))
  const activeVal = activeKey ? env[activeKey] : undefined
  if (
    !activeKey ||
    !activeVal ||
    (activeKey !== 'https_proxy' && activeKey !== 'HTTPS_PROXY') ||
    isEnvTruthy(env.CLAUDE_CODE_DISABLE_PROXY_SCHEME_REPAIR)
  ) {
    return { repaired: false, repairedKeys: [] }
  }

  const repaired = repairBareHostPortProxyValue(activeVal)
  if (repaired === activeVal) {
    return { repaired: false, repairedKeys: [] }
  }

  const isNonInteractive =
    opts?.isNonInteractiveSession ?? getIsNonInteractiveSession()
  const stdinTTY = opts?.stdinIsTTY ?? process.stdin.isTTY === true
  const stdoutTTY = opts?.stdoutIsTTY ?? process.stdout.isTTY === true
  const argv = opts?.argv ?? process.argv.slice(2)
  if (
    !isNonInteractive ||
    stdinTTY ||
    stdoutTTY ||
    argv.some(arg => /^--(bg|background|routine)(=|$)/.test(arg))
  ) {
    return { repaired: false, repairedKeys: [] }
  }

  const matchingKeys = PROXY_ENV_KEYS_ORDERED.filter(k => env[k] === activeVal)
  const hasOtherSchemeless = REPAIRED_SCHEME_SENSITIVE_PROXY_KEYS.some(k => {
    const val = env[k]
    return (
      !matchingKeys.includes(k as (typeof PROXY_ENV_KEYS_ORDERED)[number]) &&
      Boolean(val) &&
      !hasProxyUrlScheme(val!)
    )
  })
  if (
    !matchingKeys.includes(activeKey) ||
    hasOtherSchemeless ||
    (isEnvTruthy(env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER) &&
      opts?.hasProxyAuthHelper)
  ) {
    return { repaired: false, repairedKeys: [] }
  }

  for (const key of matchingKeys) {
    env[key] = repaired
  }
  completedBareProxyRepairUrl = repaired
  logForDebugging(
    `[proxy] ${matchingKeys.join(', ')} had no scheme: used as an http:// proxy`,
  )
  return {
    repaired: true,
    repairedKeys: [...matchingKeys],
    repairedUrl: repaired,
  }
}

/**
 * Official 2.1.327 `WFi(key, val)` (#400): if startup repaired a bare proxy
 * scheme and a settings file tries to overwrite `https_proxy`/`HTTPS_PROXY`/
 * `grpc_proxy`/`GRPC_PROXY` with another schemeless value, retain the startup
 * repaired URL so requests keep working.
 */
export function preserveRepairedProxyIfBare(
  key: string,
  value: string,
): string {
  const repaired = completedBareProxyRepairUrl
  if (
    repaired === undefined ||
    !REPAIRED_SCHEME_SENSITIVE_PROXY_KEYS.some(
      k => k.toUpperCase() === key.toUpperCase(),
    ) ||
    value === '' ||
    hasProxyUrlScheme(value)
  ) {
    return value
  }
  logForDebugging(
    `[proxy] ${key} from settings has no scheme (${value}); keeping repaired startup proxy until fixed`,
    { level: 'warn' },
  )
  return repaired
}

/**
 * Get the active proxy URL if one is configured
 * Prefers lowercase variants over uppercase (https_proxy > HTTPS_PROXY > http_proxy > HTTP_PROXY)
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getProxyUrl(env: EnvLike = process.env): string | undefined {
  const standard =
    env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY
  if (standard) return standard
  // Official host-injected local HTTP proxy (desktop / sandbox managed).
  const hostPort = env.CLAUDE_CODE_HOST_HTTP_PROXY_PORT
  if (hostPort && /^\d+$/.test(hostPort) && Number(hostPort) > 0) {
    return `http://127.0.0.1:${hostPort}`
  }
  return undefined
}

/**
 * densable 2.1.243 `Ne` — honor both casings when they differ.
 * `NO_PROXY=localhost` + `no_proxy=corp.internal` must both bypass.
 */
function mergeNoProxyCasings(env: EnvLike): string | undefined {
  const { no_proxy: lower, NO_PROXY: upper } = env
  if (lower && upper && lower !== upper) return `${lower},${upper}`
  return lower || upper
}

/**
 * densable 2.1.243 `S` — either casing `*` wins; otherwise merge both lists.
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getNoProxy(env: EnvLike = process.env): string | undefined {
  if (env.no_proxy === '*' || env.NO_PROXY === '*') return '*'
  return mergeNoProxyCasings(env)
}

/**
 * Check if a URL should bypass the proxy based on NO_PROXY environment variable
 * Supports:
 * - Exact hostname matches (e.g., "localhost")
 * - Domain suffix matches with leading dot (e.g., ".example.com")
 * - Wildcard "*" to bypass all
 * - Port-specific matches (e.g., "example.com:8080")
 * - IP addresses (e.g., "127.0.0.1")
 * @param urlString URL to check
 * @param noProxy NO_PROXY value (defaults to getNoProxy() for production use)
 */
export function shouldBypassProxy(
  urlString: string,
  noProxy: string | undefined = getNoProxy(),
): boolean {
  if (!noProxy) return false

  // Handle wildcard
  if (noProxy === '*') return true

  try {
    const url = new URL(urlString)
    const hostname = url.hostname.toLowerCase()
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    const hostWithPort = `${hostname}:${port}`

    // Split by comma or space and trim each entry
    const noProxyList = noProxy.split(/[,\s]+/).filter(Boolean)

    return noProxyList.some(pattern => {
      pattern = pattern.toLowerCase().trim()

      // Check for port-specific match
      if (pattern.includes(':')) {
        return hostWithPort === pattern
      }

      // Check for domain suffix match (with or without leading dot)
      if (pattern.startsWith('.')) {
        // Pattern ".example.com" should match "sub.example.com" and "example.com"
        // but NOT "notexample.com"
        const suffix = pattern
        return hostname === pattern.substring(1) || hostname.endsWith(suffix)
      }

      // Check for exact hostname match or IP address
      return hostname === pattern
    })
  } catch {
    // If URL parsing fails, don't bypass proxy
    return false
  }
}

/**
 * Official 2.1.323 (#2166): Organization settings and policy requests no longer
 * use a proxy configured solely via `ALL_PROXY`. Passing `proxy: false` disables
 * axios's built-in `proxy-from-env` (which reads `ALL_PROXY`) while allowing
 * our global request interceptor (configured from `HTTPS_PROXY`/`HTTP_PROXY`)
 * to still route through `HTTPS_PROXY` when set.
 */
export function getOrgPolicyAxiosProxyConfig(): { proxy: false } {
  return { proxy: false }
}

/**
 * Create a hardened SecureHttpsProxyAgent (`IUo extends Oe`) with optional mTLS
 * configuration. Skips local DNS resolution when `CLAUDE_CODE_PROXY_RESOLVES_HOSTS`
 * is set so the proxy handles DNS.
 */
function createHttpsProxyAgent(
  proxyUrl: string,
  extra: HardenedHttpsProxyAgentOptions = {},
): SecureHttpsProxyAgent {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  // Official densable — inject Proxy-Authorization when proxyAuthHelper cached.
  let authHeaders: Record<string, string> | undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCachedProxyAuthHelperValue, buildHttpsProxyAgentAuthHeaders } =
      require('./proxyAuthHelper.js') as typeof import('./proxyAuthHelper.js')
    authHeaders = buildHttpsProxyAgentAuthHeaders(
      getCachedProxyAuthHelperValue(),
    )
  } catch {
    // densable optional
  }

  const agentOptions: HardenedHttpsProxyAgentOptions = {
    ...(mtlsConfig && {
      cert: mtlsConfig.cert,
      key: mtlsConfig.key,
      passphrase: mtlsConfig.passphrase,
    }),
    ...(caCerts && { ca: caCerts }),
    ...(authHeaders ? { headers: authHeaders } : {}),
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_PROXY_RESOLVES_HOSTS)) {
    // Skip local DNS resolution - let the proxy resolve hostnames
    // This is needed for environments where DNS is not configured locally
    // and instead handled by the proxy (as in sandboxes)
    agentOptions.lookup = (hostname, options, callback) => {
      callback(null, hostname, getAddressFamily(options))
    }
  }

  const mergedOpts = { ...agentOptions, ...extra }
  const agent = new SecureHttpsProxyAgent(proxyUrl, mergedOpts)
  // Official 2.1.323 (#2068) `G4o`: also merge CA / mTLS into `agent.options`
  // so both the `https://` proxy connection and the tunneled target TLS use it.
  agent.options = { ...agent.options, ...mergedOpts }
  return agent
}

/**
 * Axios instance with its own proxy agent. Same NO_PROXY/mTLS/CA
 * resolution as the global interceptor, but agent options stay
 * scoped to this instance.
 */
export function createAxiosInstance(
  extra: HardenedHttpsProxyAgentOptions = {},
): AxiosInstance {
  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()
  const instance = axios.create({ proxy: false })

  if (!proxyUrl) {
    if (mtlsAgent) instance.defaults.httpsAgent = mtlsAgent
    return instance
  }

  const proxyAgent = createHttpsProxyAgent(proxyUrl, extra)
  instance.interceptors.request.use(config => {
    if (config.url && shouldBypassProxy(config.url)) {
      config.httpsAgent = mtlsAgent
      config.httpAgent = mtlsAgent
    } else {
      config.httpsAgent = proxyAgent
      config.httpAgent = proxyAgent
    }
    return config
  })
  return instance
}

/**
 * Get or create a memoized proxy agent for the given URI
 * Now respects NO_PROXY environment variable
 */
export const getProxyAgent = memoize((uri: string): undici.Dispatcher => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undiciMod = require('undici') as typeof undici
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  const tlsOpts =
    mtlsConfig || caCerts
      ? {
          ...(mtlsConfig && {
            cert: mtlsConfig.cert,
            key: mtlsConfig.key,
            passphrase: mtlsConfig.passphrase,
          }),
          ...(caCerts && { ca: caCerts }),
        }
      : undefined

  // Official undici densable — when proxyAuthHelper has a cached value, use
  // ProxyAgent with token (Proxy-Authorization). EnvHttpProxyAgent cannot
  // inject CONNECT auth headers; ProxyAgent can.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCachedProxyAuthHelperValue, buildUndiciProxyAgentAuthOptions } =
      require('./proxyAuthHelper.js') as typeof import('./proxyAuthHelper.js')
    const authOpts = buildUndiciProxyAgentAuthOptions({
      proxyUrl: uri,
      proxyAuthorization: getCachedProxyAuthHelperValue(),
      ...(tlsOpts ? { requestTls: tlsOpts, connect: tlsOpts } : {}),
    })
    if (authOpts && typeof undiciMod.ProxyAgent === 'function') {
      return new undiciMod.ProxyAgent(authOpts)
    }
  } catch {
    // densable optional — fall through to EnvHttpProxyAgent
  }

  // Use EnvHttpProxyAgent to respect NO_PROXY
  // This agent automatically checks NO_PROXY for each request
  const proxyOptions: undici.EnvHttpProxyAgent.Options & {
    requestTls?: {
      cert?: string | Buffer
      key?: string | Buffer
      passphrase?: string
      ca?: string | string[] | Buffer
    }
    proxyTls?: {
      cert?: string | Buffer
      key?: string | Buffer
      passphrase?: string
      ca?: string | string[] | Buffer
    }
  } = {
    // Override both HTTP and HTTPS proxy with the provided URI
    httpProxy: uri,
    httpsProxy: uri,
    noProxy: getNoProxy(),
  }

  // Set connect, requestTls, and proxyTls (#2068) so TLS/CA options apply to:
  // - requestTls: TLS connection through CONNECT tunnels
  // - proxyTls: TLS connection to the proxy itself when proxy URL is https://
  // - connect: direct (no-proxy) connections
  if (tlsOpts) {
    proxyOptions.connect = tlsOpts
    proxyOptions.requestTls = tlsOpts
    proxyOptions.proxyTls = tlsOpts
  }

  return new undiciMod.EnvHttpProxyAgent(proxyOptions)
})

/**
 * Get an HTTP agent configured for WebSocket proxy support
 * Returns undefined if no proxy is configured or URL should bypass proxy
 */
export function getWebSocketProxyAgent(url: string): Agent | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  // Check if URL should bypass proxy
  if (shouldBypassProxy(url)) {
    return undefined
  }

  return createHttpsProxyAgent(proxyUrl)
}

/**
 * Get the proxy URL for WebSocket connections under Bun.
 * Bun's native WebSocket supports a `proxy` string option instead of Node's `agent`.
 * Returns undefined if no proxy is configured or URL should bypass proxy.
 */
export function getWebSocketProxyUrl(url: string): string | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  if (shouldBypassProxy(url)) {
    return undefined
  }

  return proxyUrl
}

/**
 * Official densable J_ / F_ timeout:!1 gate:
 *
 *   forAnthropicAPI && !ut(API_FORCE_IDLE_TIMEOUT)
 *     && (hasBodyIdleWatchdog || Zc(API_FORCE_IDLE_TIMEOUT))
 *
 * Naming: API_FORCE_IDLE_TIMEOUT **forces the undici/Bun whole-request idle
 * timeout to stay ON** (do not set `timeout:false`). Explicit falsy force
 * disables undici timeout even without a body watchdog (J_ Zc branch).
 * Unset + hasBodyIdleWatchdog → timeout:false so the byte-stream idle
 * watchdog owns hang detection.
 */
export function shouldDisableFetchTimeoutForBodyIdle(opts?: {
  forAnthropicAPI?: boolean
  hasBodyIdleWatchdog?: boolean
  env?: NodeJS.ProcessEnv
}): boolean {
  if (!opts?.forAnthropicAPI) return false
  const env = opts.env ?? process.env
  const force = env.API_FORCE_IDLE_TIMEOUT
  // densable: !ut(t) — truthy FORCE keeps undici idle timeout enabled
  if (isEnvTruthy(force)) return false
  // densable: hasBodyIdleWatchdog || Zc(t)
  return Boolean(opts.hasBodyIdleWatchdog) || isEnvDefinedFalsy(force)
}

/**
 * Get fetch options for the Anthropic SDK with proxy and mTLS configuration
 * Returns fetch options with appropriate dispatcher for proxy and/or mTLS
 *
 * Official F_ opts:
 * - forAnthropicAPI — Enables ANTHROPIC_UNIX_SOCKET tunneling. This env var is
 *   set by `claude ssh` on the remote CLI to route API calls through an
 *   ssh -R forwarded unix socket to a local auth proxy. It MUST NOT leak into
 *   non-Anthropic-API fetch paths (MCP HTTP/SSE transports, etc.) or those
 *   requests get misrouted to api.anthropic.com. Only the Anthropic SDK client
 *   should pass `true` here.
 * - hasBodyIdleWatchdog — when true (densable NMh/CAh), disable fetch timeout
 *   so the byte-body idle watchdog owns hang detection, unless
 *   API_FORCE_IDLE_TIMEOUT is truthy (forces undici idle timeout ON).
 *   Explicit falsy FORCE also disables undici timeout (densable Zc branch).
 */
type ProxyFetchOptionsBase = {
  forAnthropicAPI?: boolean
  hasBodyIdleWatchdog?: boolean
  url?: string
  fallbackProxy?: {
    url: string
    noProxy?: string
    ca?: string
  }
}

type ProxyFetchResultBase = {
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
  proxy?: string | { url: string; headers?: Record<string, string> }
  unix?: string
  keepalive?: false
}

export function getProxyFetchOptions(
  opts: ProxyFetchOptionsBase & { raisedBodyIdleTimeoutMs: number | undefined },
): ProxyFetchResultBase & { timeout?: false | number }
export function getProxyFetchOptions(
  opts?: ProxyFetchOptionsBase,
): ProxyFetchResultBase & { timeout?: false }
export function getProxyFetchOptions(
  opts?: ProxyFetchOptionsBase & { raisedBodyIdleTimeoutMs?: number },
): ProxyFetchResultBase & { timeout?: false | number } {
  // Official 2.1.328 `el(e)` (#566): when body idle watchdog disables fetch
  // timeout, pass `timeout: false`; otherwise, if CLAUDE_STREAM_IDLE_TIMEOUT_MS
  // raised the idle limit above 5 minutes (gateways, custom base URLs, cloud
  // providers), pass `timeout: raisedBodyIdleTimeoutMs` so the connection does
  // not time out at 5 minutes.
  const timeoutOpt: false | number | undefined =
    shouldDisableFetchTimeoutForBodyIdle(opts)
      ? false
      : opts?.raisedBodyIdleTimeoutMs
  const base: {
    keepalive?: false
    timeout?: false | number
  } = {
    ...(keepAliveDisabled ? ({ keepalive: false } as const) : {}),
    ...(timeoutOpt !== undefined ? { timeout: timeoutOpt } : {}),
  }

  // ANTHROPIC_UNIX_SOCKET tunnels through the `claude ssh` auth proxy, which
  // hardcodes the upstream to the Anthropic API. Scope to the Anthropic API
  // client so MCP/SSE/other callers don't get their requests misrouted.
  if (opts?.forAnthropicAPI) {
    const unixSocket = process.env.ANTHROPIC_UNIX_SOCKET
    if (unixSocket && typeof Bun !== 'undefined') {
      return { ...base, unix: unixSocket }
    }
  }

  const proxyUrl = getProxyUrl()

  // If we have a proxy, use the proxy agent (which includes mTLS config).
  // Official k_: when proxyAuthHelper cache has a value, Bun path can pass
  // Proxy-Authorization via {url, headers}; Node path uses undici ProxyAgent
  // with token densable (see getProxyAgent).
  if (proxyUrl) {
    if (opts?.url && shouldBypassProxy(opts.url)) {
      return { ...base, ...getTLSFetchOptions() }
    }
    // Lazy require to avoid circular import with proxyAuthHelper → proxy.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCachedProxyAuthHelperValue, buildProxyOptionWithAuth } =
      require('./proxyAuthHelper.js') as typeof import('./proxyAuthHelper.js')
    const proxyAuth = getCachedProxyAuthHelperValue()
    if (typeof Bun !== 'undefined') {
      return {
        ...base,
        proxy: buildProxyOptionWithAuth({
          proxyUrl,
          proxyAuthorization: proxyAuth,
        }),
        ...getTLSFetchOptions(),
      }
    }
    // Auth-aware dispatcher (ProxyAgent when cache hit, else EnvHttpProxyAgent)
    return { ...base, dispatcher: getProxyAgent(proxyUrl) }
  }

  if (opts?.fallbackProxy) {
    if (
      opts.url &&
      (shouldBypassProxy(opts.url, opts.fallbackProxy.noProxy) ||
        shouldBypassProxy(opts.url))
    ) {
      return { ...base, ...getTLSFetchOptions() }
    }
    const tlsOpts = getTLSFetchOptions()
    return {
      ...base,
      proxy: opts.fallbackProxy.url,
      ...(opts.fallbackProxy.ca
        ? { tls: { ...tlsOpts.tls, ca: opts.fallbackProxy.ca } }
        : tlsOpts),
    }
  }

  // Otherwise, use TLS options directly if available
  return { ...base, ...getTLSFetchOptions() }
}

/**
 * Configure global HTTP agents for both axios and undici
 * This ensures all HTTP requests use the proxy and/or mTLS if configured
 */
let proxyInterceptorId: number | undefined

export function configureGlobalAgents(): void {
  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()
  const directKeepAliveAgent =
    !mtlsAgent && shouldCloseAfterServerError()
      ? createKeepAliveHttpsAgent()
      : undefined

  // Eject previous interceptor to avoid stacking on repeated calls
  if (proxyInterceptorId !== undefined) {
    axios.interceptors.request.eject(proxyInterceptorId)
    proxyInterceptorId = undefined
  }

  // Reset proxy-related defaults so reconfiguration is clean
  axios.defaults.proxy = undefined
  axios.defaults.httpAgent = undefined
  axios.defaults.httpsAgent = undefined

  if (proxyUrl) {
    // workaround for https://github.com/axios/axios/issues/4531
    axios.defaults.proxy = false

    // Create proxy agent with mTLS options if available
    const proxyAgent = createHttpsProxyAgent(proxyUrl)

    // Add axios request interceptor to handle NO_PROXY
    proxyInterceptorId = axios.interceptors.request.use(config => {
      // Check if URL should bypass proxy based on NO_PROXY
      if (config.url && shouldBypassProxy(config.url)) {
        // Bypass proxy - use mTLS agent or error-closing keep-alive agent if configured
        if (mtlsAgent) {
          config.httpsAgent = mtlsAgent
          config.httpAgent = mtlsAgent
        } else if (directKeepAliveAgent) {
          config.httpsAgent = directKeepAliveAgent
          delete config.httpAgent
        } else {
          // Remove any proxy agents to use direct connection
          delete config.httpsAgent
          delete config.httpAgent
        }
      } else {
        // Use proxy agent
        config.httpsAgent = proxyAgent
        config.httpAgent = proxyAgent
      }
      return config
    })

    // Set global dispatcher that now respects NO_PROXY via EnvHttpProxyAgent
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ;(require('undici') as typeof undici).setGlobalDispatcher(
      getProxyAgent(proxyUrl),
    )
  } else if (mtlsAgent) {
    // No proxy but mTLS is configured (uses KeepAliveErrorClosingAgent when enabled)
    axios.defaults.httpsAgent = mtlsAgent

    // Set undici global dispatcher with mTLS
    const mtlsOptions = getTLSFetchOptions()
    if (mtlsOptions.dispatcher) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ;(require('undici') as typeof undici).setGlobalDispatcher(
        mtlsOptions.dispatcher,
      )
    }
  } else if (directKeepAliveAgent) {
    // No proxy or mTLS, but server-error closing keep-alive agent is enabled
    axios.defaults.httpsAgent = directKeepAliveAgent
  }
}

/** densable jxt — STS/FetchHttpHandler request timeout (30s) */
export const AWS_SDK_REQUEST_TIMEOUT_MS = 30_000

/**
 * densable fYt({url, requestTimeoutMs}) — proxy-aware NodeHttpHandler.
 * Returns null when no proxy is configured or url is NO_PROXY-bypassed.
 * Fallback callers should use NodeHttpHandler({ requestTimeout }) when null.
 */
export async function getAwsSdkProxyRequestHandler(opts?: {
  url?: string
  requestTimeoutMs?: number
}): Promise<InstanceType<
  typeof import('@smithy/node-http-handler').NodeHttpHandler
> | null> {
  const proxyUrl = getProxyUrl()
  if (!proxyUrl || (opts?.url && shouldBypassProxy(opts.url))) {
    return null
  }
  const { NodeHttpHandler } = await import('@smithy/node-http-handler')
  const agent = createHttpsProxyAgent(proxyUrl)
  return new NodeHttpHandler({
    httpAgent: agent,
    httpsAgent: agent,
    ...(opts?.requestTimeoutMs !== undefined && {
      requestTimeout: opts.requestTimeoutMs,
    }),
  })
}

/**
 * densable NMt/pYt({url, requestTimeoutMs, region}) — AWS client proxy
 * config: requestHandler + defaultProvider with parentClientConfig.region
 * (2.1.239 STS / fromIni SSO through HTTPS_PROXY). Returns {} when no
 * proxy / NO_PROXY.
 */
export async function getAWSClientProxyConfig(opts?: {
  url?: string
  requestTimeoutMs?: number
  region?: string
}): Promise<object> {
  const requestHandler = await getAwsSdkProxyRequestHandler(opts)
  if (!requestHandler) {
    return {}
  }

  const { defaultProvider } = await import('@aws-sdk/credential-provider-node')

  return {
    requestHandler,
    credentials: defaultProvider({
      clientConfig: { requestHandler },
      parentClientConfig: {
        requestHandler,
        ...(opts?.region !== undefined && { region: opts.region }),
      },
    }),
  }
}

/**
 * Clear proxy agent cache.
 */
export function clearProxyCache(): void {
  getProxyAgent.cache.clear?.()
  logForDebugging('Cleared proxy agent cache')
}
