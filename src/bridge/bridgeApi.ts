import {
  request as httpRequest,
  type ClientRequest,
  type RequestOptions,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'

import {
  isBridgeEnrollableUntrustedRefusal,
  parseUntrustedDeviceRefusal,
  type UntrustedDeviceRefusal,
} from '../remote/SessionsV2Client.js'
import { getAnthropicClientPlatform } from '../utils/teleport/api.js'
import { getClaudeCodeUserAgent } from '../utils/userAgent.js'
import { UNTRUSTED_DEVICE_HINT } from './codeSessionApi.js'
import { debugBody, extractErrorDetail } from './debugUtils.js'
import { rcLog } from './rcDebugLog.js'
import { toCompatSessionId, toInfraSessionId } from './sessionIdCompat.js'
import {
  isTrustedDeviceGateEnabled,
  recoverTrustedDeviceTokenAfterUntrusted,
} from './trustedDevice.js'
import {
  BRIDGE_LOGIN_INSTRUCTION,
  type BridgeApiClient,
  type BridgeConfig,
  type PermissionResponseEvent,
  type WorkResponse,
} from './types.js'

/** Official 2.1.328 `wIn` (`chunk@292186245.js @579`). */
export const BRIDGE_FOLDER_ALREADY_SERVED = 'bridge_folder_already_served'

/** Official 2.1.328 `vwt` (`chunk@283708551.js @29783`) — redact credentials in git URLs. */
export function stripGitUrlCredentials(url: string | null): string | null {
  return url == null ? url : url.replace(/:\/\/[^/]*@/, '://***@')
}

/** Official 2.1.328 `Kge` (`chunk@290117572.js @190`) — v1 session endpoints retired. */
export function isSessionsV1RetiredResponse(res: {
  status: number
  data: unknown
}): boolean {
  const { status, data } = res
  return (
    status >= 400 &&
    status < 500 &&
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'object' &&
    data.error !== null &&
    'reason' in data.error &&
    (data.error as { reason?: unknown }).reason === 'sessions_v1_retired'
  )
}

export type ToolHostAdvertState =
  | { kind: 'advertise'; advert: { cliVersion: string; platform: string } }
  | { kind: 'withdraw' }
  | { kind: 'unknown' }

export type BridgeRegisterConfig = BridgeConfig & {
  machineId?: string | null
  getDeviceUuid?: () => string | undefined | Promise<string | undefined>
  getToolHostAdvert?: () => ToolHostAdvertState
  getDirectoryBrowseAdvert?: () => boolean
  hostProfile?: { tools: unknown[]; mcp_servers?: unknown[] }
}

export type BridgeSessionsWatchApi = {
  mintResumeToken(
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<{
    status: number
    retryAfterMs?: number
    resumeToken?: string
  }>
  open(
    accessToken: string,
    lastEventId: string,
    signal?: AbortSignal,
  ): Promise<{
    status: number
    body?: NodeJS.ReadableStream & { destroy: () => void }
    retryAfterMs?: number
  }>
}

export type BridgeApiClientV2 = BridgeApiClient & {
  registerBridgeEnvironment(
    config: BridgeRegisterConfig,
    signal?: AbortSignal,
  ): Promise<{
    environment_id: string
    environment_secret: string
    environment_secret_expires_in?: number
  }>
  pollForWork(
    environmentId: string,
    environmentSecret: string,
    signal?: AbortSignal,
    reclaimOlderThanMs?: number,
    pollIntervalMs?: number,
  ): Promise<WorkResponse | null>
  /** Official 2.1.328 `POST /v1/environments/bridge/{id}/offline`. */
  markEnvironmentOffline(
    environmentId: string,
    environmentSecret: string,
  ): Promise<void>
  /** Official 2.1.328 `[bridge:watch]` resume-token SSE watch client. */
  sessionsWatch: BridgeSessionsWatchApi
}

export type BridgeUntrustedDeviceHandler = {
  recover: (previousToken?: string) => Promise<string | undefined>
  hint?: (
    refusal: UntrustedDeviceRefusal,
    opts: { justEnrolled: boolean },
  ) => string
}

type BridgeApiDeps = {
  baseUrl: string
  getAccessToken: () => string | undefined
  runnerVersion: string
  onDebug?: (msg: string) => void
  /**
   * Called on 401 to attempt OAuth token refresh. Returns true if refreshed,
   * in which case the request is retried once. Injected because
   * handleOAuth401Error from utils/auth.ts transitively pulls in config.ts →
   * file.ts → permissions/filesystem.ts → sessionStorage.ts → commands.ts
   * (~1300 modules). Daemon callers using env-var tokens omit this — their
   * tokens don't refresh, so 401 goes straight to BridgeFatalError.
   */
  onAuth401?: (staleAccessToken: string) => Promise<boolean>
  /**
   * Returns the trusted device token to send as X-Trusted-Device-Token on
   * bridge API calls. Bridge sessions have SecurityTier=ELEVATED on the
   * server (CCR v2); when the server's enforcement flag is on,
   * ConnectBridgeWorker requires a trusted device at JWT-issuance.
   * Optional — when absent or returning undefined, the header is omitted
   * and the server falls through to its flag-off/no-op path. The CLI-side
   * gate is tengu_sessions_elevated_auth_enforcement (see trustedDevice.ts).
   */
  getTrustedDeviceToken?: () => string | undefined | Promise<string | undefined>
  /**
   * Official 2.1.328 `enroll_and_retry` handler for 403 `untrusted_device`
   * responses on registration/reconnect.
   */
  untrustedDevice?: BridgeUntrustedDeviceHandler
  /** Optional toggle for archiveSession endpoint preference (defaults to CCR v2 first). */
  useCcrV2SessionCrud?: () => boolean
}

const BETA_HEADER = 'environments-2025-11-01'

export const DEFAULT_TLS_HANDSHAKE_TIMEOUT_MS = 15_000
export const ERR_TLS_HANDSHAKE_STALLED = 'ERR_TLS_HANDSHAKE_STALLED'
export const BRIDGE_PROXY_CONNECT_TIMEOUT_MS = 25_000

function isNoProxyMatch(targetUrl: string, noProxyRaw: string): boolean {
  if (!noProxyRaw.trim()) return false
  let host: string
  let port: string
  try {
    const parsed = new URL(targetUrl)
    host = parsed.hostname.toLowerCase()
    port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  } catch {
    return false
  }
  for (const rawEntry of noProxyRaw.split(',')) {
    const entry = rawEntry.trim().toLowerCase()
    if (!entry) continue
    if (entry === '*') return true
    const [entryHostRaw, entryPort] = entry.includes(':')
      ? entry.split(':', 2)
      : [entry, undefined]
    if (entryPort && entryPort !== port) continue
    const entryHost = (entryHostRaw ?? '').replace(/^\./, '')
    if (!entryHost) continue
    if (host === entryHost || host.endsWith(`.${entryHost}`)) {
      return true
    }
  }
  return false
}

/**
 * Official 2.1.326 #337 (`qf`): inspect proxy environment variables for an
 * `https:` Remote Control request.
 */
export function resolveBridgeProxySetting(
  targetUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): { proxyUrl: string; isSkipped: boolean } | undefined {
  let protocol: string | undefined
  try {
    protocol = new URL(targetUrl).protocol
  } catch {
    return undefined
  }
  if (protocol !== 'https:') return undefined
  const rawProxy =
    env.https_proxy || env.HTTPS_PROXY || env.all_proxy || env.ALL_PROXY
  if (!rawProxy || !rawProxy.trim()) return undefined
  const trimmed = rawProxy.trim()
  return {
    proxyUrl: trimmed.includes('://') ? trimmed : `https://${trimmed}`,
    isSkipped: isNoProxyMatch(targetUrl, env.no_proxy || env.NO_PROXY || ''),
  }
}

/**
 * Official 2.1.326 #337 (`Cm`): wrap `HttpsProxyAgent.connect` with a 25s
 * connect timeout so a proxy that stalls CONNECT fails with `ETIMEDOUT`.
 */
export function attachBridgeProxyConnectTimeout(
  agent: HttpsProxyAgent<string>,
  timeoutMs: number = BRIDGE_PROXY_CONNECT_TIMEOUT_MS,
): HttpsProxyAgent<string> {
  const origConnect = agent.connect.bind(agent)
  agent.connect = async (req, opts) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    const connectOpts = (
      agent as unknown as { connectOpts?: Record<string, unknown> }
    ).connectOpts
    if (connectOpts) {
      connectOpts.signal = controller.signal
    }
    try {
      return await origConnect(req, opts)
    } catch (err) {
      if (controller.signal.aborted) {
        throw Object.assign(
          new Error(
            'Timed out connecting through the proxy set in HTTPS_PROXY or ALL_PROXY. Check that the proxy is running and can reach the destination server. You can also add that server to NO_PROXY.',
          ),
          { code: 'ETIMEDOUT' },
        )
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
  return agent
}

export type BridgeProxyAxiosOptions = {
  proxy?: false
  httpsAgent?: HttpsProxyAgent<string>
  httpAgent?: HttpsProxyAgent<string>
}

/**
 * Official 2.1.326 #337 (`eBt`): force Remote Control HTTPS requests through
 * an HTTP `CONNECT` tunnel (`HttpsProxyAgent` + `proxy: false`) when a proxy
 * is configured, so a proxy that refuses `CONNECT` stops Remote Control with
 * an error instead of falling back to plain HTTP proxying.
 */
export function buildBridgeProxyAxiosOptions(
  targetUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs: number = BRIDGE_PROXY_CONNECT_TIMEOUT_MS,
): BridgeProxyAxiosOptions {
  const setting = resolveBridgeProxySetting(targetUrl, env)
  if (!setting) return {}
  if (setting.isSkipped) return { proxy: false }
  let proxyProtocol: string | undefined
  try {
    proxyProtocol = new URL(setting.proxyUrl).protocol
  } catch {
    proxyProtocol = undefined
  }
  if (proxyProtocol !== 'http:' && proxyProtocol !== 'https:') {
    throw new Error(
      'The proxy setting (HTTPS_PROXY or ALL_PROXY) is not an http or https URL, so this request was not sent.',
    )
  }
  const agent = attachBridgeProxyConnectTimeout(
    new HttpsProxyAgent(setting.proxyUrl),
    timeoutMs,
  )
  return {
    proxy: false,
    httpsAgent: agent,
    httpAgent: agent,
  }
}

function failStalledTlsHandshake(req: ClientRequest): void {
  const err = Object.assign(
    new Error(
      'The TLS handshake with the server did not finish in the time allowed, normally 120 seconds. Check the network or proxy.',
    ),
    { code: ERR_TLS_HANDSHAKE_STALLED },
  )
  req.destroy(err)
}

/**
 * densable `si(handshakeBoundMs)` — bound the TLS handshake on `https:` requests
 * so a proxy blocking or stalling a Remote Control startup request does not
 * leave the session on "Connecting" for ~2 minutes.
 */
export function createTlsHandshakeTimeoutTransport(
  handshakeBoundMs: number = DEFAULT_TLS_HANDSHAKE_TIMEOUT_MS,
): {
  request: (
    options: RequestOptions,
    callback?: (res: import('node:http').IncomingMessage) => void,
  ) => ClientRequest
} {
  return {
    request(options, callback) {
      if (options.protocol !== 'https:') {
        return httpRequest(options, callback)
      }
      const req = httpsRequest(options, callback)
      const origSetTimeout = req.setTimeout.bind(req)
      let deferredTimeoutArgs:
        | Parameters<ClientRequest['setTimeout']>
        | undefined
      let handshakeDone = false
      req.setTimeout = ((
        ...args: Parameters<ClientRequest['setTimeout']>
      ): ClientRequest => {
        if (handshakeDone) return origSetTimeout(...args)
        deferredTimeoutArgs = args
        return req
      }) as ClientRequest['setTimeout']
      let timer: ReturnType<typeof setTimeout> | undefined
      let startedAt: number | undefined
      const startTimer = (): void => {
        if (handshakeDone || timer !== undefined) return
        startedAt = performance.now()
        timer = setTimeout(failStalledTlsHandshake, handshakeBoundMs, req)
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
      }
      const finishHandshake = (): void => {
        handshakeDone = true
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
        if (deferredTimeoutArgs) {
          const [timeoutMs, ...rest] = deferredTimeoutArgs
          const elapsed =
            startedAt === undefined ? 0 : performance.now() - startedAt
          origSetTimeout(
            timeoutMs &&
              Math.max(timeoutMs, Math.min(elapsed, handshakeBoundMs / 2)),
            ...rest,
          )
        }
      }
      // Start bound immediately as well so runtimes that defer 'socket' until
      // after TLS (e.g. Bun) still abort stalled handshakes within handshakeBoundMs.
      startTimer()
      req.once('socket', socket => {
        if (
          req.reusedSocket ||
          (!socket.connecting &&
            'secureConnecting' in socket &&
            (socket as { secureConnecting?: boolean }).secureConnecting ===
              false)
        ) {
          finishHandshake()
          return
        }
        socket.once('secureConnect', finishHandshake)
        if (socket.connecting) {
          socket.once('connect', startTimer)
        } else {
          startTimer()
        }
      })
      req.once('response', finishHandshake)
      req.once('close', () => {
        if (timer !== undefined) clearTimeout(timer)
      })
      return req
    },
  }
}

/** Allowlist pattern for server-provided IDs used in URL path segments. */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * Validate that a server-provided ID is safe to interpolate into a URL path.
 * Prevents path traversal (e.g. `../../admin`) and injection via IDs that
 * contain slashes, dots, or other special characters.
 */
export function validateBridgeId(id: string, label: string): string {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: contains unsafe characters`)
  }
  return id
}

/** Fatal bridge errors that should not be retried (e.g. auth failures). */
export class BridgeFatalError extends Error {
  readonly status: number
  /** Server-provided error type, e.g. "environment_expired". */
  readonly errorType: string | undefined
  constructor(message: string, status: number, errorType?: string) {
    super(message)
    this.name = 'BridgeFatalError'
    this.status = status
    this.errorType = errorType
  }
}

/** Official 2.1.328 `WPr` (`chunk@315278370.js`) — 403 `untrusted_device` fatal error. */
export class UntrustedDeviceBridgeError extends BridgeFatalError {
  readonly hint: string
  constructor(context: string, hint: string) {
    super(`${context}: ${hint}`, 403, 'untrusted_device')
    this.hint = hint
  }
}

function parseRetryAfterMs(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  const seconds = Number(raw.trim())
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000)
  }
  const dateMs = Date.parse(raw)
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now())
  }
  return undefined
}

function extractErrorReasonFromData(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    if (
      'error' in data &&
      data.error &&
      typeof data.error === 'object' &&
      'reason' in data.error &&
      typeof (data.error as { reason?: unknown }).reason === 'string'
    ) {
      return (data.error as { reason: string }).reason
    }
  }
  return undefined
}

async function handleUntrustedDevice403<T>(
  handler: BridgeUntrustedDeviceHandler,
  resolveAuth: () => string,
  debug: (msg: string) => void,
  response: { status: number; data: T },
  sentDeviceToken: string | undefined,
  retryFn: (
    accessToken: string,
    deviceToken?: string,
  ) => Promise<{ status: number; data: T }>,
  context: string,
): Promise<{ status: number; data: T }> {
  let refusal = parseUntrustedDeviceRefusal(response.data)
  if (refusal === undefined) {
    return response
  }
  let justEnrolled = false
  if (isBridgeEnrollableUntrustedRefusal(refusal)) {
    debug(
      `[bridge:api] ${context}: 403 untrusted_device, enrolling this computer and retrying`,
    )
    const renewedToken = await handler.recover(sentDeviceToken)
    if (renewedToken) {
      const retryResponse = await retryFn(resolveAuth(), renewedToken)
      const retryRefusal =
        retryResponse.status === 403
          ? parseUntrustedDeviceRefusal(retryResponse.data)
          : undefined
      if (retryRefusal === undefined) {
        return retryResponse
      }
      refusal = retryRefusal
      justEnrolled = true
      debug(
        `[bridge:api] ${context}: retry after enrollment also got untrusted_device`,
      )
    }
  }
  const hint =
    handler.hint?.(refusal, { justEnrolled }) ?? UNTRUSTED_DEVICE_HINT
  throw new UntrustedDeviceBridgeError(context, hint)
}

function safeBridgeUserAgent(runnerVersion: string): string {
  try {
    return getClaudeCodeUserAgent()
  } catch {
    return `claude-code/${runnerVersion}`
  }
}

/**
 * Official 2.1.328 `POST /v1/environments/bridge/{environmentId}/offline`.
 * Marks a preserved bridge environment offline without deregistering/deleting it.
 */
export async function markEnvironmentOffline(opts: {
  baseUrl: string
  environmentId: string
  environmentSecret: string
  runnerVersion: string
  getTrustedDeviceToken?: () => string | undefined | Promise<string | undefined>
  onDebug?: (msg: string) => void
}): Promise<void> {
  validateBridgeId(opts.environmentId, 'environmentId')
  const path = `/v1/environments/bridge/${opts.environmentId}/offline`
  opts.onDebug?.(`[bridge:api] POST ${path}`)
  const url = `${opts.baseUrl}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.environmentSecret}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': BETA_HEADER,
    'anthropic-client-platform': getAnthropicClientPlatform(),
    'x-environment-runner-version': opts.runnerVersion,
    'User-Agent': safeBridgeUserAgent(opts.runnerVersion),
  }
  const deviceToken = await opts.getTrustedDeviceToken?.()
  if (deviceToken) {
    headers['X-Trusted-Device-Token'] = deviceToken
  }
  const response = await axios.post(url, undefined, {
    ...buildBridgeProxyAxiosOptions(url),
    headers,
    timeout: 5_000,
    validateStatus: s => s < 500,
  })
  handleErrorStatus(response.status, response.data, 'MarkOffline')
  opts.onDebug?.(`[bridge:api] POST ${path} -> ${response.status}`)
}

export function createBridgeApiClient(deps: BridgeApiDeps): BridgeApiClientV2 {
  function debug(msg: string): void {
    deps.onDebug?.(msg)
  }

  let consecutiveEmptyPolls = 0
  const EMPTY_POLL_LOG_INTERVAL = 100

  async function getHeaders(
    accessToken: string,
    overrideDeviceToken?: string,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
      'anthropic-client-platform': getAnthropicClientPlatform(),
      'x-environment-runner-version': deps.runnerVersion,
      'User-Agent': safeBridgeUserAgent(deps.runnerVersion),
    }
    const deviceToken =
      overrideDeviceToken ?? (await deps.getTrustedDeviceToken?.())
    if (deviceToken) {
      headers['X-Trusted-Device-Token'] = deviceToken
    }
    return headers
  }

  function resolveAuth(): string {
    const accessToken = deps.getAccessToken()
    if (!accessToken) {
      throw new Error(BRIDGE_LOGIN_INSTRUCTION)
    }
    return accessToken
  }

  function resolveUntrustedDeviceHandler():
    | BridgeUntrustedDeviceHandler
    | undefined {
    if (deps.untrustedDevice) {
      return deps.untrustedDevice
    }
    if (deps.getTrustedDeviceToken && isTrustedDeviceGateEnabled()) {
      return {
        recover: previousToken =>
          recoverTrustedDeviceTokenAfterUntrusted(previousToken),
      }
    }
    return undefined
  }

  /**
   * Execute an OAuth-authenticated request with a single retry on 401 and
   * optional official 2.1.328 `enroll_and_retry` recovery on 403 `untrusted_device`.
   */
  async function withOAuthRetry<T>(
    fn: (
      accessToken: string,
      deviceToken?: string,
    ) => Promise<{ status: number; data: T }>,
    context: string,
    untrustedMode: 'enroll_and_retry' | 'pass_through' = 'pass_through',
  ): Promise<{ status: number; data: T }> {
    const untrustedHandler =
      untrustedMode === 'enroll_and_retry'
        ? resolveUntrustedDeviceHandler()
        : undefined
    const sentDeviceToken = untrustedHandler
      ? await deps.getTrustedDeviceToken?.()
      : undefined
    const accessToken = resolveAuth()
    const response = await fn(accessToken, sentDeviceToken)

    if (response.status === 403 && untrustedHandler) {
      return handleUntrustedDevice403(
        untrustedHandler,
        resolveAuth,
        debug,
        response,
        sentDeviceToken,
        fn,
        context,
      )
    }

    if (response.status !== 401) {
      return response
    }

    if (!deps.onAuth401) {
      debug(`[bridge:api] ${context}: 401 received, no refresh handler`)
      return response
    }

    // Attempt token refresh — matches the pattern in withRetry.ts
    debug(`[bridge:api] ${context}: 401 received, attempting token refresh`)
    const refreshed = await deps.onAuth401(accessToken)
    if (refreshed) {
      debug(`[bridge:api] ${context}: Token refreshed, retrying request`)
      const newToken = resolveAuth()
      const retryResponse = await fn(newToken, sentDeviceToken)
      if (retryResponse.status === 403 && untrustedHandler) {
        return handleUntrustedDevice403(
          untrustedHandler,
          resolveAuth,
          debug,
          retryResponse,
          sentDeviceToken,
          fn,
          context,
        )
      }
      if (retryResponse.status !== 401) {
        return retryResponse
      }
      debug(`[bridge:api] ${context}: Retry after refresh also got 401`)
    } else {
      debug(`[bridge:api] ${context}: Token refresh failed`)
    }

    // Refresh failed — return 401 for handleErrorStatus to throw
    return response
  }

  function proxyOpts(url: string): BridgeProxyAxiosOptions {
    return buildBridgeProxyAxiosOptions(url)
  }

  async function watchHeaders(
    accessToken: string,
  ): Promise<Record<string, string>> {
    const { 'anthropic-beta': _beta, ...rest } = await getHeaders(accessToken)
    return {
      ...rest,
      'anthropic-client-platform': getAnthropicClientPlatform(),
      'anthropic-client-version': deps.runnerVersion,
    }
  }

  return {
    async registerBridgeEnvironment(
      config: BridgeRegisterConfig,
      signal?: AbortSignal,
    ): Promise<{
      environment_id: string
      environment_secret: string
      environment_secret_expires_in?: number
    }> {
      debug(
        `[bridge:api] POST /v1/environments/bridge bridgeId=${config.bridgeId}`,
      )

      // Official 2.1.328 ToolHost capability advert (chunk@315278370.js @3118)
      let toolHostMeta: Record<string, string> | undefined
      const advert = config.getToolHostAdvert?.() ?? { kind: 'withdraw' }
      switch (advert.kind) {
        case 'advertise':
          toolHostMeta = {
            tool_host: '2',
            tool_host_cc_version: advert.advert.cliVersion,
            tool_host_platform: advert.advert.platform,
          }
          break
        case 'withdraw':
          if (config.reuseEnvironmentId) {
            toolHostMeta = {
              tool_host: '',
              tool_host_cc_version: '',
              tool_host_platform: '',
              tool_host_blocker: '',
            }
          }
          break
        case 'unknown':
          break
      }

      let dirBrowseMeta: Record<string, string> | undefined
      const dirBrowse = config.getDirectoryBrowseAdvert
        ? config.getDirectoryBrowseAdvert()
        : false
      if (dirBrowse === true) {
        dirBrowseMeta = { dir_browse: '1' }
      } else if (dirBrowse === false && config.reuseEnvironmentId) {
        dirBrowseMeta = { dir_browse: '' }
      }

      const deviceUuid = await Promise.resolve()
        .then(() => config.getDeviceUuid?.())
        .catch(() => undefined)

      const sanitizedGitRepoUrl = stripGitUrlCredentials(config.gitRepoUrl)

      const body = {
        machine_name: config.machineName,
        ...(config.machineId != null && { machine_id: config.machineId }),
        directory: config.dir,
        branch: config.branch,
        git_repo_url: sanitizedGitRepoUrl,
        max_sessions: config.maxSessions,
        metadata: {
          worker_type: config.workerType,
          ...(config.machineId != null && { machine_id: config.machineId }),
          ...(deviceUuid !== undefined && { device_uuid: deviceUuid }),
          ...toolHostMeta,
          ...dirBrowseMeta,
        },
        ...(config.hostProfile && { host: config.hostProfile }),
        ...(config.reuseEnvironmentId && {
          environment_id: config.reuseEnvironmentId,
        }),
      }

      const url = `${deps.baseUrl}/v1/environments/bridge`
      const response = await withOAuthRetry(
        async (token: string, deviceToken?: string) =>
          axios.post<{
            environment_id: string
            environment_secret: string
            environment_secret_expires_in?: number
          }>(url, body, {
            ...proxyOpts(url),
            headers: await getHeaders(token, deviceToken),
            timeout: 15_000,
            ...(deps.baseUrl.startsWith('https:') && {
              transport: createTlsHandshakeTimeoutTransport(15_000),
            }),
            validateStatus: status => status < 500,
            signal,
          }),
        'Registration',
        'enroll_and_retry',
      )

      // Official 2.1.328 409 conflict: folder already served by another instance
      if (
        response.status === 409 &&
        (extractErrorReasonFromData(response.data) ===
          BRIDGE_FOLDER_ALREADY_SERVED ||
          extractErrorTypeFromData(response.data) ===
            BRIDGE_FOLDER_ALREADY_SERVED)
      ) {
        throw new BridgeFatalError(
          extractErrorDetail(response.data) ??
            'This folder is already served by another Claude Code on this device. Stop it first.',
          409,
          BRIDGE_FOLDER_ALREADY_SERVED,
        )
      }

      handleErrorStatus(response.status, response.data, 'Registration')
      debug(
        `[bridge:api] POST /v1/environments/bridge -> ${response.status} environment_id=${response.data.environment_id}`,
      )
      debug(
        `[bridge:api] >>> ${debugBody({
          ...body,
          ...(body.host && {
            host: {
              tools: body.host.tools.length,
              mcp: body.host.mcp_servers?.length ?? 0,
            },
          }),
        })}`,
      )
      debug(`[bridge:api] <<< ${debugBody(response.data)}`)
      return response.data
    },

    async pollForWork(
      environmentId: string,
      environmentSecret: string,
      signal?: AbortSignal,
      reclaimOlderThanMs?: number,
      pollIntervalMs?: number,
    ): Promise<WorkResponse | null> {
      validateBridgeId(environmentId, 'environmentId')

      // Save and reset so errors break the "consecutive empty" streak.
      // Restored below when the response is truly empty.
      const prevEmptyPolls = consecutiveEmptyPolls
      consecutiveEmptyPolls = 0

      const params: Record<string, number> = {}
      if (reclaimOlderThanMs !== undefined) {
        params.reclaim_older_than_ms = reclaimOlderThanMs
      }
      if (pollIntervalMs !== undefined) {
        params.poll_interval_ms = pollIntervalMs
      }

      const url = `${deps.baseUrl}/v1/environments/${environmentId}/work/poll`
      const response = await axios.get<WorkResponse | null>(url, {
        ...proxyOpts(url),
        headers: await getHeaders(environmentSecret),
        params: Object.keys(params).length > 0 ? params : undefined,
        timeout: 10_000,
        signal,
        validateStatus: status => status < 500,
      })

      handleErrorStatus(response.status, response.data, 'Poll')
      rcLog(
        `poll response: status=${response.status} hasData=${!!response.data} url=${deps.baseUrl}`,
      )

      // Empty body or null = no work available
      if (!response.data) {
        consecutiveEmptyPolls = prevEmptyPolls + 1
        if (
          consecutiveEmptyPolls === 1 ||
          consecutiveEmptyPolls % EMPTY_POLL_LOG_INTERVAL === 0
        ) {
          debug(
            `[bridge:api] GET .../work/poll -> ${response.status} (no work, ${consecutiveEmptyPolls} consecutive empty polls)`,
          )
        }
        return null
      }

      const workData = response.data.data as WorkResponse['data'] & {
        mode?: string
      }
      if (workData?.mode != null) {
        debug(
          `[bridge:api] GET .../work/poll -> ${response.status} workId=${response.data.id} type=${workData.type} mode=${workData.mode} sessionId=${workData.id}`,
        )
        return response.data
      }

      debug(
        `[bridge:api] GET .../work/poll -> ${response.status} workId=${response.data.id} type=${response.data.data?.type}${response.data.data?.id ? ` sessionId=${response.data.data.id}` : ''}`,
      )
      debug(`[bridge:api] <<< ${debugBody(response.data)}`)
      return response.data
    },

    async acknowledgeWork(
      environmentId: string,
      workId: string,
      sessionToken: string,
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId')
      validateBridgeId(workId, 'workId')

      debug(`[bridge:api] POST .../work/${workId}/ack`)

      const url = `${deps.baseUrl}/v1/environments/${environmentId}/work/${workId}/ack`
      const response = await axios.post(
        url,
        {},
        {
          ...proxyOpts(url),
          headers: await getHeaders(sessionToken),
          timeout: 10_000,
          validateStatus: s => s < 500,
        },
      )

      handleErrorStatus(response.status, response.data, 'Acknowledge')
      debug(`[bridge:api] POST .../work/${workId}/ack -> ${response.status}`)
    },

    async stopWork(
      environmentId: string,
      workId: string,
      force: boolean,
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId')
      validateBridgeId(workId, 'workId')

      debug(`[bridge:api] POST .../work/${workId}/stop force=${force}`)

      const url = `${deps.baseUrl}/v1/environments/${environmentId}/work/${workId}/stop`
      const response = await withOAuthRetry(
        async (token: string, deviceToken?: string) =>
          axios.post(
            url,
            { force },
            {
              ...proxyOpts(url),
              headers: await getHeaders(token, deviceToken),
              timeout: 10_000,
              validateStatus: s => s < 500,
            },
          ),
        'StopWork',
      )

      handleErrorStatus(response.status, response.data, 'StopWork')
      debug(`[bridge:api] POST .../work/${workId}/stop -> ${response.status}`)
    },

    async deregisterEnvironment(environmentId: string): Promise<void> {
      validateBridgeId(environmentId, 'environmentId')

      debug(`[bridge:api] DELETE /v1/environments/bridge/${environmentId}`)

      const url = `${deps.baseUrl}/v1/environments/bridge/${environmentId}`
      const response = await withOAuthRetry(
        async (token: string, deviceToken?: string) =>
          axios.delete(url, {
            ...proxyOpts(url),
            headers: await getHeaders(token, deviceToken),
            timeout: 10_000,
            validateStatus: s => s < 500,
          }),
        'Deregister',
      )

      handleErrorStatus(response.status, response.data, 'Deregister')
      debug(
        `[bridge:api] DELETE /v1/environments/bridge/${environmentId} -> ${response.status}`,
      )
    },

    async markEnvironmentOffline(
      environmentId: string,
      environmentSecret: string,
    ): Promise<void> {
      await markEnvironmentOffline({
        baseUrl: deps.baseUrl,
        environmentId,
        environmentSecret,
        runnerVersion: deps.runnerVersion,
        getTrustedDeviceToken: deps.getTrustedDeviceToken,
        onDebug: deps.onDebug,
      })
    },

    async archiveSession(sessionId: string): Promise<void> {
      validateBridgeId(sessionId, 'sessionId')

      const v2Path = `/v1/code/sessions/${toInfraSessionId(sessionId)}/archive`
      const v1Path = `/v1/sessions/${toCompatSessionId(sessionId)}/archive`
      const paths =
        deps.useCcrV2SessionCrud?.() === false
          ? [v1Path, v2Path]
          : [v2Path, v1Path]

      for (let i = 0; i < paths.length; i++) {
        const path = paths[i]!
        const hasFallback = i + 1 < paths.length
        debug(`[bridge:api] POST ${path}`)

        const url = `${deps.baseUrl}${path}`
        const response = await withOAuthRetry(
          async (token: string, deviceToken?: string) =>
            axios.post(
              url,
              {},
              {
                ...proxyOpts(url),
                headers: await getHeaders(token, deviceToken),
                timeout: 10_000,
                validateStatus: s => s < 500,
              },
            ),
          'ArchiveSession',
          'pass_through',
        )

        // Clean fallback between CCR v2 and v1 archive routes:
        // - v2 -> v1 fallback on 404/405/501 (legacy / self-hosted servers)
        // - v1 -> v2 fallback on `sessions_v1_retired` (official `Kge`)
        if (hasFallback) {
          if (
            path === v2Path &&
            (response.status === 404 ||
              response.status === 405 ||
              response.status === 501)
          ) {
            debug(
              `[bridge:api] POST ${path} -> ${response.status}, falling back to ${v1Path}`,
            )
            continue
          }
          if (path === v1Path && isSessionsV1RetiredResponse(response)) {
            debug(
              `[bridge:api] POST ${path} -> ${response.status} (sessions_v1_retired), falling back to ${v2Path}`,
            )
            continue
          }
        }

        // 409 = already archived (idempotent, not an error)
        if (response.status === 409) {
          debug(`[bridge:api] POST ${path} -> 409 (already archived)`)
          return
        }

        handleErrorStatus(response.status, response.data, 'ArchiveSession')
        debug(`[bridge:api] POST ${path} -> ${response.status}`)
        return
      }
    },

    async reconnectSession(
      environmentId: string,
      sessionId: string,
      signal?: AbortSignal,
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId')
      validateBridgeId(sessionId, 'sessionId')

      debug(
        `[bridge:api] POST /v1/environments/${environmentId}/bridge/reconnect session_id=${sessionId}`,
      )

      const url = `${deps.baseUrl}/v1/environments/${environmentId}/bridge/reconnect`
      const response = await withOAuthRetry(
        async (token: string, deviceToken?: string) =>
          axios.post(
            url,
            { session_id: sessionId },
            {
              ...proxyOpts(url),
              headers: await getHeaders(token, deviceToken),
              timeout: 10_000,
              validateStatus: s => s < 500,
              signal,
            },
          ),
        'ReconnectSession',
        'enroll_and_retry',
      )

      handleErrorStatus(response.status, response.data, 'ReconnectSession')
      debug(`[bridge:api] POST .../bridge/reconnect -> ${response.status}`)
    },

    async heartbeatWork(
      environmentId: string,
      workId: string,
      sessionToken: string,
    ): Promise<{ lease_extended: boolean; state: string }> {
      validateBridgeId(environmentId, 'environmentId')
      validateBridgeId(workId, 'workId')

      debug(`[bridge:api] POST .../work/${workId}/heartbeat`)

      const url = `${deps.baseUrl}/v1/environments/${environmentId}/work/${workId}/heartbeat`
      const response = await axios.post<{
        lease_extended: boolean
        state: string
        last_heartbeat: string
        ttl_seconds: number
      }>(
        url,
        {},
        {
          ...proxyOpts(url),
          headers: await getHeaders(sessionToken),
          timeout: 10_000,
          validateStatus: s => s < 500,
        },
      )

      handleErrorStatus(response.status, response.data, 'Heartbeat')
      debug(
        `[bridge:api] POST .../work/${workId}/heartbeat -> ${response.status} lease_extended=${response.data.lease_extended} state=${response.data.state}`,
      )
      return response.data
    },

    async sendPermissionResponseEvent(
      sessionId: string,
      event: PermissionResponseEvent,
      sessionToken: string,
    ): Promise<void> {
      validateBridgeId(sessionId, 'sessionId')

      debug(
        `[bridge:api] POST /v1/sessions/${sessionId}/events type=${event.type}`,
      )

      const url = `${deps.baseUrl}/v1/sessions/${sessionId}/events`
      const response = await axios.post(
        url,
        { events: [event] },
        {
          ...proxyOpts(url),
          headers: await getHeaders(sessionToken),
          timeout: 10_000,
          validateStatus: s => s < 500,
        },
      )

      handleErrorStatus(
        response.status,
        response.data,
        'SendPermissionResponseEvent',
      )
      debug(
        `[bridge:api] POST /v1/sessions/${sessionId}/events -> ${response.status}`,
      )
      debug(`[bridge:api] >>> ${debugBody({ events: [event] })}`)
      debug(`[bridge:api] <<< ${debugBody(response.data)}`)
    },

    sessionsWatch: {
      async mintResumeToken(accessToken: string, signal?: AbortSignal) {
        const url = `${deps.baseUrl}/v1/code/sessions?limit=1`
        const { status, data, headers } = await axios.get<unknown>(url, {
          ...proxyOpts(url),
          headers: await watchHeaders(accessToken),
          timeout: 10_000,
          signal,
          maxRedirects: 0,
          validateStatus: () => true,
        })
        debug(`[bridge:api] GET /v1/code/sessions?limit=1 -> ${status}`)
        const resumeToken =
          data !== null && typeof data === 'object' && 'resume_token' in data
            ? (data as { resume_token?: unknown }).resume_token
            : undefined
        return {
          status,
          retryAfterMs: parseRetryAfterMs(headers?.['retry-after']),
          ...(typeof resumeToken === 'string' && { resumeToken }),
        }
      },

      async open(
        accessToken: string,
        lastEventId: string,
        signal?: AbortSignal,
      ) {
        const url = `${deps.baseUrl}/v1/code/sessions/watch?include_trigger_sessions=true&exclude_tags=-`
        const { status, data, headers } = await axios.get<
          NodeJS.ReadableStream & { destroy: () => void }
        >(url, {
          ...proxyOpts(url),
          headers: {
            ...(await watchHeaders(accessToken)),
            Accept: 'text/event-stream',
            'Last-Event-ID': lastEventId,
          },
          responseType: 'stream',
          timeout: 0,
          signal,
          maxRedirects: 0,
          validateStatus: () => true,
        })
        debug(`[bridge:api] GET /v1/code/sessions/watch -> ${status}`)
        const contentType = headers?.['content-type']
        if (
          status === 200 &&
          typeof contentType === 'string' &&
          contentType.includes('text/event-stream')
        ) {
          return { status, body: data }
        }
        data?.destroy?.()
        return {
          status,
          retryAfterMs: parseRetryAfterMs(headers?.['retry-after']),
        }
      },
    },
  }
}

function handleErrorStatus(
  status: number,
  data: unknown,
  context: string,
): void {
  if (status === 200 || status === 204) {
    return
  }
  const detail = extractErrorDetail(data)
  const errorType = extractErrorTypeFromData(data)
  switch (status) {
    case 401:
      throw new BridgeFatalError(
        `${context}: Authentication failed (401)${detail ? `: ${detail}` : ''}. ${BRIDGE_LOGIN_INSTRUCTION}`,
        401,
        errorType,
      )
    case 403:
      throw new BridgeFatalError(
        isExpiredErrorType(errorType)
          ? 'Remote Control session has expired. Please restart with `claude remote-control` or /remote-control.'
          : `${context}: Access denied (403)${detail ? `: ${detail}` : ''}. Check your organization permissions.`,
        403,
        errorType,
      )
    case 404:
      throw new BridgeFatalError(
        detail ??
          `${context}: Not found (404). Remote Control may not be available for this organization.`,
        404,
        errorType,
      )
    case 410:
      throw new BridgeFatalError(
        detail ??
          'Remote Control session has expired. Please restart with `claude remote-control` or /remote-control.',
        410,
        errorType ?? 'environment_expired',
      )
    case 429:
      throw new Error(`${context}: Rate limited (429). Polling too frequently.`)
    default:
      throw new Error(
        `${context}: Failed with status ${status}${detail ? `: ${detail}` : ''}`,
      )
  }
}

/** Check whether an error type string indicates a session/environment expiry. */
export function isExpiredErrorType(errorType: string | undefined): boolean {
  if (!errorType) {
    return false
  }
  return errorType.includes('expired') || errorType.includes('lifetime')
}

/**
 * Check whether a BridgeFatalError is a suppressible 403 permission error.
 * These are 403 errors for scopes like 'external_poll_sessions' or operations
 * like StopWork that fail because the user's role lacks 'environments:manage'.
 * They don't affect core functionality and shouldn't be shown to users.
 */
export function isSuppressible403(err: BridgeFatalError): boolean {
  if (err.status !== 403) {
    return false
  }
  return (
    err.message.includes('external_poll_sessions') ||
    err.message.includes('environments:manage')
  )
}

function extractErrorTypeFromData(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    if (
      'error' in data &&
      data.error &&
      typeof data.error === 'object' &&
      'type' in data.error &&
      typeof data.error.type === 'string'
    ) {
      return data.error.type
    }
  }
  return undefined
}
