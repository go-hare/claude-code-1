import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, unlinkSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import { getClaudeAIOAuthTokens } from 'src/utils/auth.js'
import { getOauthConfig } from 'src/constants/oauth.js'
import { logForDebugging } from 'src/utils/debug.js'

export const MAX_PROXY_REQUEST_BODY_BYTES = 32 * 1024 * 1024

export interface SSHAuthProxy {
  stop(): void
}

export interface AuthProxyInfo {
  proxy: SSHAuthProxy
  /** Unix socket path or 127.0.0.1:<port> */
  localAddress: string
  /** Environment variables to inject into the remote/child CLI process */
  authEnv: Record<string, string>
}

const isWindows = process.platform === 'win32'

function resolveAuthHeaders(): Record<string, string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    return { 'x-api-key': apiKey }
  }

  const oauthTokens = getClaudeAIOAuthTokens()
  if (oauthTokens?.accessToken) {
    return { Authorization: `Bearer ${oauthTokens.accessToken}` }
  }

  return {}
}

function resolveUpstreamBaseUrl(): string {
  return process.env.ANTHROPIC_BASE_URL || getOauthConfig().BASE_API_URL
}

function timingSafeNonceMatches(
  provided: string | null | undefined,
  expected: string,
): boolean {
  if (typeof provided !== 'string' || provided.length === 0) {
    return false
  }
  const actualDigest = createHash('sha256').update(provided, 'utf8').digest()
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}

function rejectPayloadTooLarge(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (res.writableEnded) {
    req.destroy()
    return
  }
  res.once('finish', () => {
    req.destroy()
    req.socket?.destroy()
  })
  res.writeHead(413, {
    'content-type': 'text/plain',
    connection: 'close',
  })
  res.end('Payload Too Large')
}

async function readRequestBodyCapped(
  req: IncomingMessage,
  maxBytes: number,
): Promise<
  { tooLarge: true } | { tooLarge: false; body?: Uint8Array<ArrayBuffer> }
> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let finished = false

    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('close', onClose)
    }

    const onData = (chunk: Buffer | string) => {
      if (finished) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buf.byteLength
      if (totalBytes > maxBytes) {
        finished = true
        cleanup()
        req.pause()
        resolve({ tooLarge: true })
        return
      }
      chunks.push(buf)
    }

    const onEnd = () => {
      if (finished) return
      finished = true
      cleanup()
      if (chunks.length === 0) {
        resolve({ tooLarge: false, body: undefined })
        return
      }
      const merged = Buffer.concat(chunks)
      resolve({
        tooLarge: false,
        body: new Uint8Array(
          merged.buffer.slice(
            merged.byteOffset,
            merged.byteOffset + merged.byteLength,
          ),
        ),
      })
    }

    const onError = (err: Error) => {
      if (finished) return
      finished = true
      cleanup()
      reject(err)
    }

    const onClose = () => {
      if (finished) return
      finished = true
      cleanup()
      reject(new Error('Request aborted before body completed'))
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('close', onClose)
  })
}

async function proxyFetch(
  req: Request,
  nonce: string | null,
): Promise<Response> {
  if (
    nonce &&
    !timingSafeNonceMatches(req.headers.get('x-auth-nonce'), nonce)
  ) {
    return new Response('Forbidden', { status: 403 })
  }

  const upstreamBase = resolveUpstreamBaseUrl()
  const url = new URL(req.url)
  const upstreamUrl = `${upstreamBase}${url.pathname}${url.search}`

  const authHeaders = resolveAuthHeaders()
  if (Object.keys(authHeaders).length === 0) {
    return new Response(
      JSON.stringify({
        error: 'No API credentials available on local machine',
      }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )
  }

  const forwardHeaders = new Headers(req.headers)
  for (const [k, v] of Object.entries(authHeaders)) {
    forwardHeaders.set(k, v)
  }
  forwardHeaders.delete('host')
  forwardHeaders.delete('x-auth-nonce')
  forwardHeaders.delete('transfer-encoding')

  logForDebugging(
    `[SSHAuthProxy] ${req.method} ${url.pathname} -> ${upstreamUrl}`,
  )

  try {
    const body =
      req.method !== 'GET' && req.method !== 'HEAD' && req.body
        ? await req.arrayBuffer()
        : undefined
    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: forwardHeaders,
      body,
    })

    const responseHeaders = new Headers(upstreamRes.headers)
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: responseHeaders,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logForDebugging(`[SSHAuthProxy] upstream error: ${message}`)
    return new Response(
      JSON.stringify({ error: `Proxy upstream error: ${message}` }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )
  }
}

async function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  nonce: string | null,
): Promise<void> {
  const method = req.method ?? 'GET'
  const rawUrl = req.url ?? '/'
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }

  // Validate nonce BEFORE reading or buffering any request body bytes.
  if (nonce && !timingSafeNonceMatches(headers.get('x-auth-nonce'), nonce)) {
    res.once('finish', () => {
      req.destroy()
      req.socket?.destroy()
    })
    res.writeHead(403, {
      'content-type': 'text/plain',
      connection: 'close',
    })
    res.end('Forbidden')
    return
  }

  let body: Uint8Array<ArrayBuffer> | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const rawContentLength = req.headers['content-length']
    const contentLengthStr = Array.isArray(rawContentLength)
      ? rawContentLength[0]
      : rawContentLength
    const contentLength =
      contentLengthStr !== undefined ? Number(contentLengthStr) : Number.NaN
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_PROXY_REQUEST_BODY_BYTES
    ) {
      rejectPayloadTooLarge(req, res)
      return
    }

    const bodyResult = await readRequestBodyCapped(
      req,
      MAX_PROXY_REQUEST_BODY_BYTES,
    )
    if (bodyResult.tooLarge) {
      rejectPayloadTooLarge(req, res)
      return
    }
    body = bodyResult.body
  }

  const webReq = new Request(`http://127.0.0.1${rawUrl}`, {
    method,
    headers,
    body,
  })
  const webRes = await proxyFetch(webReq, nonce)

  const resHeaders: Record<string, string | string[]> = {}
  webRes.headers.forEach((value, key) => {
    const existing = resHeaders[key]
    if (existing === undefined) {
      resHeaders[key] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      resHeaders[key] = [existing, value]
    }
  })

  res.writeHead(webRes.status, webRes.statusText, resHeaders)

  if (!webRes.body) {
    res.end()
    return
  }

  const reader = webRes.body.getReader()
  const onResClose = () => {
    if (!res.writableEnded) {
      void reader.cancel().catch(() => {})
    }
  }
  res.once('close', onResClose)
  try {
    while (true) {
      if (res.destroyed) {
        await reader.cancel().catch(() => {})
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      if (res.destroyed) {
        await reader.cancel().catch(() => {})
        break
      }
      res.write(value)
    }
  } finally {
    res.off('close', onResClose)
    reader.releaseLock()
    if (!res.writableEnded) {
      res.end()
    }
  }
}

function createProxyHttpServer(nonce: string | null): HttpServer {
  return createServer((req, res) => {
    void handleProxyRequest(req, res, nonce).catch(err => {
      const message = err instanceof Error ? err.message : String(err)
      logForDebugging(`[SSHAuthProxy] request handler error: ${message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: message }))
      } else if (!res.writableEnded) {
        res.end()
      }
    })
  })
}

function listenServer(server: HttpServer, listenFn: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      server.on('error', (err: Error) => {
        logForDebugging(`[SSHAuthProxy] server error: ${err.message}`)
      })
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    listenFn()
  })
}

export async function createAuthProxy(): Promise<AuthProxyInfo> {
  const id = randomUUID()

  if (isWindows) {
    return createTcpAuthProxy(id)
  }
  return createUnixSocketAuthProxy(id)
}

async function createUnixSocketAuthProxy(id: string): Promise<AuthProxyInfo> {
  const socketPath = `/tmp/claude-ssh-auth-${id}.sock`

  const server = createProxyHttpServer(null)
  await listenServer(server, () => {
    server.listen(socketPath)
  })
  try {
    chmodSync(socketPath, 0o600)
  } catch (err) {
    server.close()
    try {
      unlinkSync(socketPath)
    } catch {
      // Socket file may already be cleaned up
    }
    throw err
  }

  logForDebugging(`[SSHAuthProxy] listening on unix:${socketPath}`)

  const proxy: SSHAuthProxy = {
    stop() {
      server.closeAllConnections?.()
      server.close()
      try {
        unlinkSync(socketPath)
      } catch {
        // Socket file may already be cleaned up
      }
    },
  }

  return {
    proxy,
    localAddress: socketPath,
    // Must be ANTHROPIC_UNIX_SOCKET — that is the name the remote's API client
    // reads (getFetchOptions, forAnthropicAPI branch) and the name upstream
    // uses. Under any other name the remote gets no route to this proxy and no
    // ANTHROPIC_BASE_URL override either, so it silently calls the API direct
    // with whatever credentials happen to exist on that host.
    authEnv: { ANTHROPIC_UNIX_SOCKET: socketPath },
  }
}

export async function createTcpAuthProxy(
  _id: string = randomUUID(),
): Promise<AuthProxyInfo> {
  const nonce = randomUUID()

  const server = createProxyHttpServer(nonce)
  await listenServer(server, () => {
    server.listen(0, '127.0.0.1')
  })

  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    server.close()
    throw new Error('Failed to resolve TCP auth proxy listening port')
  }
  const port = addr.port
  logForDebugging(
    `[SSHAuthProxy] listening on TCP 127.0.0.1:${port} (nonce-protected)`,
  )

  const proxy: SSHAuthProxy = {
    stop() {
      server.closeAllConnections?.()
      server.close()
    },
  }

  return {
    proxy,
    localAddress: `127.0.0.1:${port}`,
    authEnv: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_AUTH_NONCE: nonce,
    },
  }
}
