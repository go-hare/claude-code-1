import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AgentDefinitionsResult } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { Tools } from '../Tool.js'
import {
  type InProcessHttpRequest,
  type InProcessHttpResponse,
  ToolServerPortTakenError,
} from '../services/mcp/sessionTunnel.js'
import {
  createMcpServeDispatcher,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpServeResultFormat,
} from './mcp.js'

/**
 * Official 2.1.331 chunk `#3518`: `claude mcp serve --transport http`
 * Loopback-only Streamable HTTP JSON-RPC 2.0 server with DNS rebinding / CSRF
 * protection, timing-safe Bearer auth, 32 MiB payload cap, and in-process
 * `answer()` dispatch for `--session-tunnel` (`answerInProcess`).
 */

export const MCP_HTTP_MAX_BODY_BYTES = 32 * 1024 * 1024

export type StartMCPServerHttpOptions = {
  port?: number
  debug?: boolean
  verbose?: boolean
  storageV5?: unknown
  resultFormat?: McpServeResultFormat
  authToken?: string
  announceOnStdout?: boolean
  authAnnounceMode?: 'stdout-reader' | 'silent'
  progressHeartbeatIntervalMs?: number
  getToolsOverride?: () => Tools
  loadAgentDefinitions?: (cwd: string) => Promise<AgentDefinitionsResult>
}

export type McpHttpServerHandle = {
  url: string
  boundPort: number
  authToken: string
  answer: (req: InProcessHttpRequest) => Promise<InProcessHttpResponse>
  close: () => Promise<void>
}

const UNSAFE_HOST_RE = /[\s@/?#\\]/
const ALLOWED_LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
])
const MCP_SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/
const MAX_TRACKED_SESSIONS = 256

function isValidPortString(portPart: string): boolean {
  if (!/^\d{1,5}$/.test(portPart)) {
    return false
  }
  const portNum = Number(portPart)
  return Number.isInteger(portNum) && portNum >= 0 && portNum <= 65535
}

function touchLruSet(
  set: Set<string>,
  id: string,
  maxSize: number = MAX_TRACKED_SESSIONS,
): void {
  if (set.has(id)) {
    set.delete(id)
  }
  set.add(id)
  while (set.size > maxSize) {
    const oldest = set.values().next().value
    if (oldest === undefined) break
    set.delete(oldest)
  }
}

function isAllowedLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) {
    return false
  }
  if (UNSAFE_HOST_RE.test(hostHeader)) {
    return false
  }

  const lower = hostHeader.toLowerCase()
  if (lower.startsWith('[')) {
    const closeIdx = lower.indexOf(']')
    if (closeIdx < 0) return false
    const bracketHost = lower.slice(0, closeIdx + 1)
    if (!ALLOWED_LOOPBACK_HOSTS.has(bracketHost)) return false
    const rest = lower.slice(closeIdx + 1)
    if (rest === '') return true
    if (!rest.startsWith(':')) return false
    return isValidPortString(rest.slice(1))
  }

  if (lower === '::1') {
    return true
  }

  const colonIdx = lower.indexOf(':')
  if (colonIdx < 0) {
    return ALLOWED_LOOPBACK_HOSTS.has(lower)
  }
  const hostname = lower.slice(0, colonIdx)
  const portPart = lower.slice(colonIdx + 1)
  if (!ALLOWED_LOOPBACK_HOSTS.has(hostname)) {
    return false
  }
  return isValidPortString(portPart)
}

function timingSafeBearerMatches(
  authHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (typeof authHeader !== 'string') {
    return false
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader)
  if (!match) {
    return false
  }
  const actualDigest = createHash('sha256').update(match[1]!, 'utf8').digest()
  const expectedDigest = createHash('sha256')
    .update(expectedToken, 'utf8')
    .digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}

function normalizeHeaders(
  headers: Record<string, string> | IncomingHttpHeaders | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {}
  if (!headers) return normalized
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key.toLowerCase()] = value
    } else if (Array.isArray(value) && value.length > 0) {
      normalized[key.toLowerCase()] = value.join(', ')
    }
  }
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonRpcRequestLike(value: unknown): value is JsonRpcRequest {
  return (
    isRecord(value) &&
    value.jsonrpc === '2.0' &&
    typeof value.method === 'string'
  )
}

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): InProcessHttpResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  }
}

/**
 * Official chunk `#3518` `B(req, authToken)` security check:
 * - Rejects `Origin` header (CSRF/browser cross-origin protection) -> 403
 * - Rejects missing, malformed, or non-loopback `Host` header (DNS rebinding) -> 403
 * - Allows unauthenticated `GET /health`
 * - Requires timing-safe `Authorization: Bearer <authToken>` for all other routes -> 401
 */
export function checkMcpHttpRequestSecurity(
  headers: Record<string, string>,
  method: string,
  pathname: string,
  authToken: string,
): InProcessHttpResponse | null {
  if ('origin' in headers) {
    return jsonResponse(403, {
      error: 'Forbidden: Origin header is not allowed',
    })
  }
  if (!isAllowedLoopbackHostHeader(headers.host)) {
    return jsonResponse(403, {
      error: 'Forbidden: Host header must be loopback',
    })
  }
  if (method === 'GET' && pathname === '/health') {
    return null
  }
  if (!timingSafeBearerMatches(headers.authorization, authToken)) {
    return jsonResponse(401, { error: 'Unauthorized' })
  }
  return null
}

async function readNodeRequestBodyCapped(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ tooLarge: true } | { tooLarge: false; body: string }> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let finished = false

    req.on('data', (chunk: Buffer | string) => {
      if (finished) return
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      total += buf.byteLength
      if (total > maxBytes) {
        finished = true
        req.pause()
        resolve({ tooLarge: true })
        return
      }
      chunks.push(buf)
    })

    req.on('end', () => {
      if (finished) return
      finished = true
      resolve({
        tooLarge: false,
        body: Buffer.concat(chunks).toString('utf8'),
      })
    })

    req.on('error', err => {
      if (finished) return
      finished = true
      reject(err)
    })
  })
}

export async function startMCPServerHttp(
  cwd: string,
  options: StartMCPServerHttpOptions = {},
): Promise<McpHttpServerHandle> {
  const port = options.port ?? 0
  const resultFormat: McpServeResultFormat = options.resultFormat ?? 'raw'
  const authToken = options.authToken ?? randomBytes(32).toString('hex')

  const server = createServer()

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening)
        if (err.code === 'EADDRINUSE') {
          reject(new ToolServerPortTakenError(port))
          return
        }
        reject(err)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })
  } catch (err) {
    try {
      server.close()
    } catch {
      // ignore close error
    }
    throw err
  }

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Failed to determine bound MCP HTTP server address')
  }

  let dispatcher: ReturnType<typeof createMcpServeDispatcher>
  try {
    dispatcher = createMcpServeDispatcher({
      cwd,
      debug: options.debug ?? false,
      verbose: options.verbose ?? false,
      storageV5: options.storageV5 ?? 'raw',
      resultFormat,
      progressHeartbeatIntervalMs: options.progressHeartbeatIntervalMs,
      getToolsOverride: options.getToolsOverride,
      loadAgentDefinitions: options.loadAgentDefinitions,
    })
  } catch (err) {
    server.close()
    throw err
  }

  const sessions = new Set<string>()
  const terminatedSessions = new Set<string>()

  const handleCoreRequest = async (
    method: string,
    rawPath: string,
    normalizedHeaders: Record<string, string>,
    body: string,
    signal?: AbortSignal,
  ): Promise<InProcessHttpResponse> => {
    const upperMethod = method.toUpperCase()
    const pathname = (rawPath.split('?')[0] ?? '/') || '/'

    const securityFailure = checkMcpHttpRequestSecurity(
      normalizedHeaders,
      upperMethod,
      pathname,
      authToken,
    )
    if (securityFailure !== null) {
      return securityFailure
    }

    if (upperMethod === 'GET' && pathname === '/health') {
      return jsonResponse(200, {
        ok: true,
        status: 'ok',
        transport: 'http',
        resultFormat,
      })
    }

    if (pathname !== '/mcp' && pathname !== '/') {
      return jsonResponse(404, { error: 'Not Found' })
    }

    const hasSessionHeader = 'mcp-session-id' in normalizedHeaders
    const clientSessionId = hasSessionHeader
      ? normalizedHeaders['mcp-session-id']!
      : undefined
    if (
      hasSessionHeader &&
      (!clientSessionId || !MCP_SESSION_ID_RE.test(clientSessionId))
    ) {
      return jsonResponse(400, { error: 'Invalid Mcp-Session-Id' })
    }

    if (upperMethod === 'DELETE') {
      if (clientSessionId !== undefined) {
        sessions.delete(clientSessionId)
        touchLruSet(terminatedSessions, clientSessionId)
      }
      return {
        status: 204,
        headers: {},
        body: '',
      }
    }

    if (upperMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method Not Allowed' })
    }

    if (
      clientSessionId !== undefined &&
      terminatedSessions.has(clientSessionId)
    ) {
      return jsonResponse(404, { error: 'Session terminated' })
    }

    if (Buffer.byteLength(body, 'utf8') > MCP_HTTP_MAX_BODY_BYTES) {
      return jsonResponse(
        413,
        { error: 'Payload Too Large' },
        { connection: 'close' },
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return jsonResponse(400, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      })
    }

    const isInitializePayload = Array.isArray(parsed)
      ? parsed.some(
          item => isJsonRpcRequestLike(item) && item.method === 'initialize',
        )
      : isJsonRpcRequestLike(parsed) && parsed.method === 'initialize'

    let sessionHeaders: Record<string, string>
    if (clientSessionId !== undefined) {
      if (sessions.has(clientSessionId)) {
        touchLruSet(sessions, clientSessionId)
        sessionHeaders = { 'mcp-session-id': clientSessionId }
      } else if (isInitializePayload) {
        touchLruSet(sessions, clientSessionId)
        sessionHeaders = { 'mcp-session-id': clientSessionId }
      } else {
        return jsonResponse(404, { error: 'Session not found' })
      }
    } else if (isInitializePayload) {
      const minted = randomUUID()
      touchLruSet(sessions, minted)
      sessionHeaders = { 'mcp-session-id': minted }
    } else {
      // Stateless single-shot clients (e.g. remoteNativeToolBridge) omit Mcp-Session-Id.
      sessionHeaders = {}
    }

    const dispatchSingle = async (
      item: unknown,
    ): Promise<JsonRpcResponse | null> => {
      if (!isJsonRpcRequestLike(item)) {
        const rawId =
          isRecord(item) &&
          (typeof item.id === 'string' || typeof item.id === 'number')
            ? item.id
            : null
        return {
          jsonrpc: '2.0',
          id: rawId,
          error: {
            code: -32600,
            message: 'Invalid Request',
          },
        }
      }
      return await dispatcher.handleJsonRpc(item, { signal })
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return jsonResponse(
          400,
          {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32600,
              message: 'Invalid Request',
            },
          },
          sessionHeaders,
        )
      }
      const results = await Promise.all(parsed.map(dispatchSingle))
      const responses = results.filter(
        (res): res is JsonRpcResponse => res !== null,
      )
      if (responses.length === 0) {
        return {
          status: 202,
          headers: sessionHeaders,
          body: '',
        }
      }
      return jsonResponse(200, responses, sessionHeaders)
    }

    const singleResponse = await dispatchSingle(parsed)
    if (singleResponse === null) {
      return {
        status: 202,
        headers: sessionHeaders,
        body: '',
      }
    }
    return jsonResponse(200, singleResponse, sessionHeaders)
  }

  const writeNodeResponse = (
    res: ServerResponse,
    response: InProcessHttpResponse,
  ): void => {
    if (res.writableEnded) return
    res.writeHead(response.status, response.headers)
    res.end(response.body)
  }

  const rejectPayloadTooLarge = (
    req: IncomingMessage,
    res: ServerResponse,
  ): void => {
    if (res.writableEnded) return
    const payload = jsonResponse(
      413,
      { error: 'Payload Too Large' },
      { connection: 'close' },
    )
    res.once('finish', () => {
      req.socket?.destroy()
    })
    res.writeHead(payload.status, payload.headers)
    res.end(payload.body)
  }

  server.on('request', (req, res) => {
    void (async () => {
      const normalizedHeaders = normalizeHeaders(req.headers)
      const method = req.method ?? 'GET'
      const rawPath = req.url ?? '/'

      // Check security (Host/Origin 403 & Bearer Auth 401) BEFORE Content-Length 413
      const pathname = (rawPath.split('?')[0] ?? '/') || '/'
      const earlySecurity = checkMcpHttpRequestSecurity(
        normalizedHeaders,
        method.toUpperCase(),
        pathname,
        authToken,
      )
      if (earlySecurity !== null) {
        writeNodeResponse(res, earlySecurity)
        return
      }

      // Fast-reject oversize Content-Length before buffering
      const contentLength = Number(normalizedHeaders['content-length'])
      if (
        Number.isFinite(contentLength) &&
        contentLength > MCP_HTTP_MAX_BODY_BYTES
      ) {
        rejectPayloadTooLarge(req, res)
        return
      }

      const bodyResult = await readNodeRequestBodyCapped(
        req,
        MCP_HTTP_MAX_BODY_BYTES,
      )
      if (bodyResult.tooLarge) {
        rejectPayloadTooLarge(req, res)
        return
      }

      const abortController = new AbortController()
      res.once('close', () => {
        if (!res.writableFinished) {
          abortController.abort()
        }
      })

      const response = await handleCoreRequest(
        method,
        rawPath,
        normalizedHeaders,
        bodyResult.body,
        abortController.signal,
      )
      writeNodeResponse(res, response)
    })().catch(() => {
      writeNodeResponse(
        res,
        jsonResponse(500, { error: 'Internal Server Error' }),
      )
    })
  })

  const boundPort = address.port
  const url = `http://127.0.0.1:${boundPort}/mcp`

  if (options.announceOnStdout !== false) {
    process.stdout.write(`MCP server listening on ${url}\n`)
    if ((options.authAnnounceMode ?? 'stdout-reader') === 'stdout-reader') {
      process.stdout.write(`MCP server auth token: ${authToken}\n`)
    }
  }

  const answer = async (
    req: InProcessHttpRequest,
  ): Promise<InProcessHttpResponse> => {
    const normalizedHeaders = normalizeHeaders(req.headers)
    return await handleCoreRequest(
      req.method,
      req.path,
      normalizedHeaders,
      req.body ?? '',
    )
  }

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    dispatcher.dispose()
    sessions.clear()
    terminatedSessions.clear()
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
  }

  return {
    url,
    boundPort,
    authToken,
    answer,
    close,
  }
}
