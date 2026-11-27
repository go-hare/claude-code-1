import { z } from 'zod/v4'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js'

/**
 * Official 2.1.331 chunks `#143`, `#903`, `#1528`, `#1647`:
 * Tool-server daemon mode detection, relay token descriptor guard,
 * `--session-tunnel` stdin JSON envelope parsing/validation, and WebSocket
 * relay tunnel client with in-process dispatch (`answerInProcess`).
 */

export const SESSION_TUNNEL_PORT = 28471
export const EX_CONFIG = 69
export const EX_UNAVAILABLE = 77
export const EX_POLICY = 78
export const TUNNEL_HOLD_DEADLINE_MS = 8_000
export const TUNNEL_LIVENESS_DEADLINE_MS = 600_000

const SESSION_TUNNEL_STDIN_MAX_BYTES = 1_048_576

type ToolServerDaemonSlotState = {
  daemonMode: boolean
  relayTokenGuarded: boolean
  relayTokenNonDumpable: boolean
}

const toolServerDaemonSlot = new HostSlot<ToolServerDaemonSlotState>(() => ({
  daemonMode: false,
  relayTokenGuarded: false,
  relayTokenNonDumpable: false,
}))

function getDaemonSlot(): ToolServerDaemonSlotState {
  return toolServerDaemonSlot.of(getBootstrapSessionHost())
}

/**
 * Latch tool-server daemon mode programmatically (e.g. when entering
 * `claude mcp serve --transport http` or in unit tests).
 */
export function setToolServerDaemonMode(enabled: boolean): void {
  getDaemonSlot().daemonMode = enabled
}

const ALLOWED_DAEMON_VALUE_FLAGS = new Set(['--port', '--result-format'])
const ALLOWED_DAEMON_BOOLEAN_FLAGS = new Set([
  '--session-tunnel',
  '--debug',
  '-d',
  '--verbose',
])

function extractMcpServeFlags(
  argv: readonly string[],
): readonly string[] | null {
  // Support both `process.argv.slice(2)` and full `process.argv` ([exec, script, ...]).
  let idx = 0
  if (
    argv.length >= 2 &&
    argv[0] !== 'mcp' &&
    !argv[0]!.startsWith('-') &&
    !argv[1]!.startsWith('-')
  ) {
    idx = 2
  }

  // Skip leading global flags before `mcp serve` (stop at `--` or non-flag).
  while (idx < argv.length) {
    const token = argv[idx]!
    if (token === '--') {
      return null
    }
    if (token === 'mcp' && argv[idx + 1] === 'serve') {
      return argv.slice(idx + 2)
    }
    if (token.startsWith('-')) {
      idx += 1
      continue
    }
    return null
  }
  return null
}

/**
 * Official `tc()` (2.1.331 chunk `#143`): returns true when running as
 * `claude mcp serve --transport http` (or `--transport=http`) with ONLY the
 * allowed tool-server daemon flags (`--port`, `--result-format`,
 * `--session-tunnel`, `--debug`, `-d`, `--verbose`), OR when latched via
 * `setToolServerDaemonMode(true)` (when `argv` is omitted).
 */
export function isToolServerDaemonMode(argv?: readonly string[]): boolean {
  if (argv === undefined && getDaemonSlot().daemonMode) {
    return true
  }

  const rawArgs = argv ?? process.argv.slice(2)
  const flags = extractMcpServeFlags(rawArgs)
  if (flags === null) {
    return false
  }

  let hasHttpTransport = false
  for (let i = 0; i < flags.length; i += 1) {
    const token = flags[i]!
    if (token === '--transport') {
      const next = flags[i + 1]
      if (next !== 'http') {
        return false
      }
      hasHttpTransport = true
      i += 1
      continue
    }
    if (token.startsWith('--transport=')) {
      const value = token.slice('--transport='.length)
      if (value !== 'http') {
        return false
      }
      hasHttpTransport = true
      continue
    }
    if (ALLOWED_DAEMON_BOOLEAN_FLAGS.has(token)) {
      continue
    }
    if (ALLOWED_DAEMON_VALUE_FLAGS.has(token)) {
      if (i + 1 >= flags.length) {
        return false
      }
      const next = flags[i + 1]!
      if (next.length === 0 || next.startsWith('-')) {
        return false
      }
      i += 1
      continue
    }
    if (token.startsWith('--port=')) {
      const val = token.slice('--port='.length)
      if (val.length === 0 || val.startsWith('-')) {
        return false
      }
      continue
    }
    if (token.startsWith('--result-format=')) {
      const val = token.slice('--result-format='.length)
      if (val.length === 0 || val.startsWith('-')) {
        return false
      }
      continue
    }
    return false
  }

  return hasHttpTransport
}

type OptionalNonDumpableProcess = NodeJS.Process & {
  setNonDumpable?: () => boolean
}

/**
 * Official 2.1.331 chunk `#1528`: detects `CCR_AGENT_PROXY_TOKEN_FILE_DESCRIPTOR`
 * or `--session-tunnel` in daemon mode, invokes an optional native non-dumpable
 * hook when available, and records the guard state in `HostSlot`.
 */
export function guardRelayTokenDescriptor(
  env: NodeJS.ProcessEnv = process.env,
  argv?: readonly string[],
): { guarded: boolean; madeNonDumpable: boolean } {
  const hasDescriptorEnv =
    typeof env.CCR_AGENT_PROXY_TOKEN_FILE_DESCRIPTOR === 'string' &&
    env.CCR_AGENT_PROXY_TOKEN_FILE_DESCRIPTOR.trim() !== ''
  const rawArgs = argv ?? process.argv.slice(2)
  const hasSessionTunnelFlag =
    isToolServerDaemonMode(argv) && rawArgs.includes('--session-tunnel')

  if (!hasDescriptorEnv && !hasSessionTunnelFlag) {
    return { guarded: false, madeNonDumpable: false }
  }

  let madeNonDumpable = false
  try {
    const proc = process as OptionalNonDumpableProcess
    if (typeof proc.setNonDumpable === 'function') {
      madeNonDumpable = Boolean(proc.setNonDumpable())
    }
  } catch (error) {
    logForDebugging(
      `sessionTunnel: non-dumpable hook failed: ${errorMessage(error)}`,
      { level: 'warn' },
    )
  }

  const slot = getDaemonSlot()
  slot.relayTokenGuarded = true
  slot.relayTokenNonDumpable = madeNonDumpable
  return { guarded: true, madeNonDumpable }
}

/**
 * Inspect the recorded relay token guard state on the current host slot.
 */
export function getRelayTokenGuardState(): {
  guarded: boolean
  madeNonDumpable: boolean
} {
  const slot = getDaemonSlot()
  return {
    guarded: slot.relayTokenGuarded,
    madeNonDumpable: slot.relayTokenNonDumpable,
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function validateOrigin(raw: string, ctx: z.RefinementCtx): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'api_base_url must be a valid URL origin',
    })
    return z.NEVER
  }

  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'api_base_url must not contain userinfo, query, or fragment',
    })
    return z.NEVER
  }

  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    ctx.addIssue({
      code: 'custom',
      message: 'api_base_url must not contain a path',
    })
    return z.NEVER
  }

  if (parsed.protocol === 'https:') {
    return parsed.origin
  }

  if (
    parsed.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
  ) {
    return parsed.origin
  }

  ctx.addIssue({
    code: 'custom',
    message:
      'api_base_url must use https:// or loopback http:// (127.0.0.1, localhost, [::1])',
  })
  return z.NEVER
}

const SessionTunnelEnvelopeSchema = z.object({
  v: z.literal(1),
  session_id: z.string().min(1),
  session_token: z.string().min(1),
  api_base_url: z.string().transform(validateOrigin),
  session_token_expires_at: z
    .number()
    .int()
    .min(1e9)
    .optional()
    .catch(undefined),
  file_upload_path: z
    .string()
    .regex(/^\/(?!\/)/)
    .optional()
    .catch(undefined),
  tool_host: z.unknown().optional(),
  git_token: z.string().min(1).optional().catch(undefined),
})

export type SessionTunnelEnvelope = z.infer<typeof SessionTunnelEnvelopeSchema>

/**
 * Parse and validate a single JSON line describing the `--session-tunnel`
 * startup envelope. Returns `undefined` if missing, malformed JSON, or schema
 * validation fails.
 */
export function parseSessionTunnelEnvelope(
  line: string | undefined,
): SessionTunnelEnvelope | undefined {
  if (typeof line !== 'string') {
    return undefined
  }
  const trimmed = line.trim()
  if (trimmed === '') {
    return undefined
  }
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  const result = SessionTunnelEnvelopeSchema.safeParse(parsedJson)
  return result.success ? result.data : undefined
}

export type ValidateSessionTunnelLaunchOptions = {
  transport: 'stdio' | 'http'
  port: number
  envelope: SessionTunnelEnvelope | null | undefined
  isAnthropicProvider?: boolean
  nonessentialTrafficDisabled?: boolean
  allowCustomPort?: boolean
}

/**
 * Validate launch preconditions for `--session-tunnel`.
 * Returns an exact error message string when invalid, or `undefined` when valid.
 */
export function validateSessionTunnelLaunch(
  opts: ValidateSessionTunnelLaunchOptions,
): string | undefined {
  if (opts.transport !== 'http') {
    return 'Error: --session-tunnel requires --transport http'
  }
  if (!opts.allowCustomPort && opts.port !== SESSION_TUNNEL_PORT) {
    return `Error: --session-tunnel requires --transport http --port ${SESSION_TUNNEL_PORT}`
  }
  if (opts.nonessentialTrafficDisabled === true) {
    return 'Error: --session-tunnel cannot be used when CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set'
  }
  if (opts.isAnthropicProvider === false) {
    return 'Error: --session-tunnel requires an Anthropic API provider'
  }
  if (!opts.envelope) {
    return 'Error: --session-tunnel requires a valid JSON tunnel envelope on stdin, which must be a pipe'
  }
  return undefined
}

/**
 * Thrown when `startMCPServerHttp` cannot bind because the requested port is
 * already in use (`EADDRINUSE`).
 */
export class ToolServerPortTakenError extends Error {
  readonly port: number

  constructor(port: number, message?: string) {
    super(message ?? `MCP HTTP server port ${port} is already in use`)
    this.name = 'ToolServerPortTakenError'
    this.port = port
  }
}

export type InProcessHttpRequest = {
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
}

export type InProcessHttpResponse = {
  status: number
  headers: Record<string, string>
  body: string
}

export type TunnelServerHandle = {
  url: string
  authToken: string
  answer?: (req: InProcessHttpRequest) => Promise<InProcessHttpResponse>
}

export type SessionTunnelState = 'connecting' | 'open' | 'closed'

export type SessionTunnelHandle = {
  updateToken(token: string): void
  expectTokens(expect: boolean): void
  endHold(): Promise<'active' | 'gone'>
  stop(): void
  readonly state: SessionTunnelState
}

export type StartSessionTunnelOptions = {
  relayUrlOverride?: string
  holdDeadlineMs?: number
  livenessDeadlineMs?: number
  onExit?: (code: number, reason: string) => void
  WebSocketImpl?: typeof globalThis.WebSocket
}

/**
 * Derive the WebSocket relay URL from the validated envelope origin and
 * `session_id`: `https:` -> `wss:`, `http:` -> `ws:` +
 * `/v1/sessions/<session_id>/tool_tunnel`.
 */
export function buildSessionTunnelRelayUrl(
  envelope: SessionTunnelEnvelope,
): string {
  const parsed = new URL(envelope.api_base_url)
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  parsed.pathname = `/v1/sessions/${encodeURIComponent(envelope.session_id)}/tool_tunnel`
  return parsed.toString()
}

function isTokenExpired(expiresAt: number | undefined, nowMs: number): boolean {
  if (expiresAt === undefined) {
    return false
  }
  const expiresAtMs = expiresAt >= 1e12 ? expiresAt : expiresAt * 1000
  return nowMs >= expiresAtMs
}

async function decodeWsPayload(data: unknown): Promise<string | null> {
  if (typeof data === 'string') {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data))
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    )
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return await data.text()
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'string') {
      result[key] = val
    }
  }
  return result
}

async function dispatchToServer(
  serverHandle: TunnelServerHandle,
  req: InProcessHttpRequest,
): Promise<InProcessHttpResponse> {
  if (
    typeof req.path !== 'string' ||
    !req.path.startsWith('/') ||
    req.path.startsWith('//')
  ) {
    return {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request path' }),
    }
  }

  let baseUrl: URL
  let targetUrl: URL
  try {
    baseUrl = new URL(serverHandle.url)
    targetUrl = new URL(req.path, serverHandle.url)
  } catch {
    return {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request path' }),
    }
  }

  if (targetUrl.origin !== baseUrl.origin) {
    return {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request path' }),
    }
  }

  // Build a fresh lowercase header map, stripping host/authorization/origin
  // case-insensitively before setting trusted loopback Host & Bearer auth.
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (req.headers) {
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase()
      if (lower === 'host' || lower === 'authorization' || lower === 'origin') {
        continue
      }
      headers[lower] = value
    }
  }
  headers.host = baseUrl.host || '127.0.0.1'
  headers.authorization = `Bearer ${serverHandle.authToken}`

  if (serverHandle.answer) {
    return await serverHandle.answer({
      method: req.method,
      path: req.path,
      headers,
      body: req.body,
    })
  }

  const { host: _omitHost, ...fetchHeaders } = headers
  const response = await fetch(targetUrl, {
    method: req.method,
    headers: fetchHeaders,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
  })
  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  return {
    status: response.status,
    headers: responseHeaders,
    body: await response.text(),
  }
}

/**
 * Dial the hosted WebSocket relay for `--session-tunnel` and bridge incoming
 * HTTP-over-tunnel / JSON-RPC request frames into `serverHandle.answer`
 * (`answerInProcess`, zero loopback hop) or loopback HTTP fallback.
 */
export function startSessionTunnel(
  serverHandle: TunnelServerHandle,
  envelope: SessionTunnelEnvelope,
  opts: StartSessionTunnelOptions = {},
): SessionTunnelHandle {
  const WS = opts.WebSocketImpl ?? globalThis.WebSocket
  if (typeof WS !== 'function') {
    throw new Error('WebSocket implementation is unavailable in this runtime')
  }

  const relayUrl = opts.relayUrlOverride ?? buildSessionTunnelRelayUrl(envelope)
  const holdDeadlineMs = opts.holdDeadlineMs ?? TUNNEL_HOLD_DEADLINE_MS
  const livenessDeadlineMs =
    opts.livenessDeadlineMs ?? TUNNEL_LIVENESS_DEADLINE_MS

  let currentState: SessionTunnelState = 'connecting'
  let currentToken = envelope.session_token
  let tokenExpiresAt = envelope.session_token_expires_at
  let expectingTokens = false
  let exitNotified = false
  let ws: WebSocket | null = null
  let detachSocketListeners: (() => void) | null = null
  let livenessTimer: ReturnType<typeof setTimeout> | null = null
  let holdResolvers: Array<(result: 'active' | 'gone') => void> = []

  const resolveHolds = (outcome: 'active' | 'gone'): void => {
    const pending = holdResolvers
    holdResolvers = []
    for (const resolve of pending) {
      resolve(outcome)
    }
  }

  const clearTimers = (): void => {
    if (livenessTimer !== null) {
      clearTimeout(livenessTimer)
      livenessTimer = null
    }
  }

  const notifyExit = (code: number, reason: string): void => {
    if (exitNotified) return
    exitNotified = true
    opts.onExit?.(code, reason)
  }

  const closeInternal = (exitCode?: number, exitReason?: string): void => {
    if (currentState === 'closed') {
      if (exitCode !== undefined && exitReason !== undefined) {
        notifyExit(exitCode, exitReason)
      }
      return
    }
    currentState = 'closed'
    clearTimers()
    resolveHolds('gone')

    const detach = detachSocketListeners
    detachSocketListeners = null
    if (detach) {
      try {
        detach()
      } catch {
        // ignore listener detach error
      }
    }

    const socket = ws
    ws = null
    if (socket) {
      try {
        if (
          socket.readyState === WS.CONNECTING ||
          socket.readyState === WS.OPEN
        ) {
          socket.close()
        }
      } catch {
        // ignore socket close error
      }
    }

    if (exitCode !== undefined && exitReason !== undefined) {
      notifyExit(exitCode, exitReason)
    }
  }

  const bumpLivenessTimer = (): void => {
    clearTimers()
    if (currentState === 'closed') return
    livenessTimer = setTimeout(() => {
      closeInternal(EX_UNAVAILABLE, 'liveness_timeout')
    }, livenessDeadlineMs)
    livenessTimer.unref?.()
  }

  const sendJson = (payload: unknown): void => {
    if (!ws || ws.readyState !== WS.OPEN) return
    try {
      ws.send(JSON.stringify(payload))
    } catch (error) {
      logForDebugging(
        `sessionTunnel: failed to send frame: ${errorMessage(error)}`,
        { level: 'warn' },
      )
    }
  }

  if (isTokenExpired(tokenExpiresAt, Date.now())) {
    currentState = 'closed'
    queueMicrotask(() => {
      notifyExit(EX_UNAVAILABLE, 'session_token_expired')
    })
  } else {
    bumpLivenessTimer()
    const socket = new WS(relayUrl)
    ws = socket

    const onOpen = () => {
      if (currentState === 'closed') {
        socket.close()
        return
      }
      if (isTokenExpired(tokenExpiresAt, Date.now())) {
        closeInternal(EX_UNAVAILABLE, 'session_token_expired')
        return
      }
      currentState = 'open'
      bumpLivenessTimer()
      sendJson({
        type: 'tunnel_auth',
        v: envelope.v,
        session_id: envelope.session_id,
        token: currentToken,
      })
      resolveHolds('active')
    }

    const onMessage = (event: MessageEvent) => {
      void (async () => {
        if (currentState === 'closed') return
        bumpLivenessTimer()

        if (isTokenExpired(tokenExpiresAt, Date.now()) && !expectingTokens) {
          closeInternal(EX_UNAVAILABLE, 'session_token_expired')
          return
        }

        const rawText = await decodeWsPayload(event.data)
        if (rawText === null) return

        let frame: unknown
        try {
          frame = JSON.parse(rawText)
        } catch {
          return
        }
        if (!isRecord(frame)) return

        // Control frames
        if (frame.type === 'ping') {
          sendJson({
            type: 'pong',
            ...(frame.id !== undefined ? { id: frame.id } : {}),
          })
          return
        }
        if (frame.type === 'token_update' && typeof frame.token === 'string') {
          currentToken = frame.token
          tokenExpiresAt =
            typeof frame.expires_at === 'number' ? frame.expires_at : undefined
          return
        }
        if (frame.type === 'close') {
          const code = typeof frame.code === 'number' ? frame.code : 0
          const reason =
            typeof frame.reason === 'string' ? frame.reason : 'remote_close'
          closeInternal(code, reason)
          return
        }

        // HTTP-over-tunnel request frame
        if (frame.type === 'http_request') {
          const id = frame.id
          const method =
            typeof frame.method === 'string' ? frame.method : 'POST'
          const path = typeof frame.path === 'string' ? frame.path : '/mcp'
          const headers = normalizeStringRecord(frame.headers)
          const body =
            typeof frame.body === 'string'
              ? frame.body
              : frame.body !== undefined
                ? JSON.stringify(frame.body)
                : undefined

          try {
            const response = await dispatchToServer(serverHandle, {
              method,
              path,
              headers,
              body,
            })
            sendJson({
              type: 'http_response',
              id,
              status: response.status,
              headers: response.headers,
              body: response.body,
            })
          } catch (error) {
            sendJson({
              type: 'http_response',
              id,
              status: 500,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ error: errorMessage(error) }),
            })
          }
          return
        }

        // Wrapped JSON-RPC request frame
        if (frame.type === 'rpc_request') {
          const id = frame.id
          const body =
            typeof frame.payload === 'string'
              ? frame.payload
              : JSON.stringify(frame.payload ?? {})
          try {
            const response = await dispatchToServer(serverHandle, {
              method: 'POST',
              path: '/mcp',
              body,
            })
            sendJson({
              type: 'rpc_response',
              id,
              status: response.status,
              body: response.body,
            })
          } catch (error) {
            sendJson({
              type: 'rpc_response',
              id,
              status: 500,
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32603, message: errorMessage(error) },
              }),
            })
          }
          return
        }

        // Raw JSON-RPC 2.0 request frame
        if (frame.jsonrpc === '2.0' && typeof frame.method === 'string') {
          try {
            const response = await dispatchToServer(serverHandle, {
              method: 'POST',
              path: '/mcp',
              body: rawText,
            })
            if (
              response.body.trim() !== '' &&
              ws &&
              ws.readyState === WS.OPEN
            ) {
              ws.send(response.body)
            }
          } catch (error) {
            sendJson({
              jsonrpc: '2.0',
              id:
                typeof frame.id === 'string' || typeof frame.id === 'number'
                  ? frame.id
                  : null,
              error: { code: -32603, message: errorMessage(error) },
            })
          }
        }
      })()
    }

    const onError = () => {
      logForDebugging('sessionTunnel: WebSocket error', { level: 'warn' })
    }

    const onClose = (event: CloseEvent) => {
      const reason =
        typeof event.reason === 'string' && event.reason !== ''
          ? event.reason
          : `ws_close_${event.code}`
      const code = event.code === 1000 ? 0 : EX_UNAVAILABLE
      closeInternal(code, reason)
    }

    socket.addEventListener('open', onOpen)
    socket.addEventListener('message', onMessage)
    socket.addEventListener('error', onError)
    socket.addEventListener('close', onClose)
    detachSocketListeners = () => {
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('error', onError)
      socket.removeEventListener('close', onClose)
    }
  }

  return {
    get state(): SessionTunnelState {
      return currentState
    },
    updateToken(token: string): void {
      currentToken = token
      tokenExpiresAt = undefined
      if (currentState === 'open') {
        sendJson({
          type: 'tunnel_token_update',
          token,
        })
      }
    },
    expectTokens(expect: boolean): void {
      expectingTokens = expect
    },
    endHold(): Promise<'active' | 'gone'> {
      if (currentState === 'open') {
        return Promise.resolve('active')
      }
      if (currentState === 'closed') {
        return Promise.resolve('gone')
      }
      return new Promise<'active' | 'gone'>(resolve => {
        let settled = false
        const finish = (outcome: 'active' | 'gone') => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(outcome)
        }
        const timer = setTimeout(() => {
          finish('gone')
        }, holdDeadlineMs)
        timer.unref?.()
        holdResolvers.push(finish)
      })
    },
    stop(): void {
      closeInternal()
    },
  }
}

type PipeStdinLike =
  | (NodeJS.ReadableStream & { isTTY?: boolean })
  | ReadableStream<Uint8Array>

function isWebReadableStream(
  stream: PipeStdinLike,
): stream is ReadableStream<Uint8Array> {
  return typeof (stream as ReadableStream<Uint8Array>).getReader === 'function'
}

/**
 * Read a single newline-delimited JSON line from piped stdin for
 * `--session-tunnel`. Rejects TTY stdin (`"which must be a pipe"`).
 * Uses standard Node streams / Web ReadableStream (Bun + Node compatible).
 */
export async function readSessionTunnelLineFromStdin(
  stream?: PipeStdinLike,
  opts?: { isTTY?: boolean; maxBytes?: number },
): Promise<string> {
  const maxBytes = opts?.maxBytes ?? SESSION_TUNNEL_STDIN_MAX_BYTES
  const target: PipeStdinLike = stream ?? process.stdin
  const isTTY =
    opts?.isTTY ??
    ('isTTY' in target ? Boolean(target.isTTY) : Boolean(process.stdin.isTTY))

  if (isTTY) {
    throw new Error(
      'Error: --session-tunnel requires a JSON envelope on stdin, which must be a pipe',
    )
  }

  if (isWebReadableStream(target)) {
    const reader = target.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value || value.byteLength === 0) continue
        const newlineIdx = value.indexOf(0x0a)
        const slice = newlineIdx >= 0 ? value.subarray(0, newlineIdx) : value
        total += slice.byteLength
        if (total > maxBytes) {
          throw new Error(
            'Error: --session-tunnel stdin envelope exceeds 1 MiB limit',
          )
        }
        chunks.push(slice)
        if (newlineIdx >= 0) {
          break
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    return new TextDecoder().decode(Buffer.concat(chunks)).replace(/\r$/, '')
  }

  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let done = false

    const cleanup = () => {
      target.removeListener('data', onData)
      target.removeListener('end', onEnd)
      target.removeListener('error', onError)
    }

    const finish = (err?: Error) => {
      if (done) return
      done = true
      cleanup()
      if (err) {
        reject(err)
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8').replace(/\r$/, ''))
    }

    const onData = (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      const newlineIdx = buf.indexOf(0x0a)
      const slice = newlineIdx >= 0 ? buf.subarray(0, newlineIdx) : buf
      total += slice.byteLength
      if (total > maxBytes) {
        finish(
          new Error(
            'Error: --session-tunnel stdin envelope exceeds 1 MiB limit',
          ),
        )
        return
      }
      chunks.push(slice)
      if (newlineIdx >= 0) {
        finish()
      }
    }

    const onEnd = () => finish()
    const onError = (err: Error) => finish(err)

    target.on('data', onData)
    target.on('end', onEnd)
    target.on('error', onError)
  })
}
