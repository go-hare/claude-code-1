/**
 * Real cross-process HTTP auth & OTLP telemetry proxy server for
 * `claude gateway --config <path>` (aligned with official 2.1.331 chunk #2247).
 *
 * Uses only Node-standard APIs (`node:http`, `node:crypto`, `fetch`) so it runs
 * identically under both Bun and Node.js.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod/v4'

const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

const RESPONSE_STRIP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
])

const FORWARDED_HEADERS = new Set([
  'forwarded',
  'x-real-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
])

const OTLP_PATHS = new Set(['/v1/logs', '/v1/metrics', '/v1/traces'])

const HEADER_CTL_RE = /[\r\n\0]/

const httpUrlSchema = z
  .string()
  .url()
  .refine(
    value => {
      try {
        const protocol = new URL(value).protocol
        return protocol === 'http:' || protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: 'URL must use http: or https: scheme' },
  )

const safeHeaderKeySchema = z
  .string()
  .min(1)
  .refine(k => !HEADER_CTL_RE.test(k), {
    message: 'Header name must not contain CR, LF, or NUL characters',
  })

const safeHeaderValueSchema = z.string().refine(v => !HEADER_CTL_RE.test(v), {
  message: 'Header value must not contain CR, LF, or NUL characters',
})

const ListenConfigSchema = z.object({
  host: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().min(0).max(65535).default(8080),
  public_url: httpUrlSchema.optional(),
  trusted_proxies: z.array(z.string()).default([]),
})

const AuthConfigSchema = z.object({
  bearer_tokens: z.array(z.string().min(1)).optional(),
  require_auth: z.boolean().default(false),
  upstream_api_key: z.string().optional(),
  upstream_api_key_env: z.string().optional(),
})

const AnthropicUpstreamConfigSchema = z.object({
  url: httpUrlSchema,
  api_key: z.string().optional(),
  api_key_env: z.string().optional(),
  timeout_ms: z.number().int().positive().default(120_000),
})

const UpstreamsConfigSchema = z.object({
  anthropic: AnthropicUpstreamConfigSchema.optional(),
})

const TelemetryConfigSchema = z.object({
  forward_to: httpUrlSchema.optional(),
  headers: z.record(safeHeaderKeySchema, safeHeaderValueSchema).optional(),
  timeout_ms: z.number().int().positive().default(15_000),
})

const ModelEntrySchema = z.object({
  id: z.string().min(1),
  display_name: z.string().optional(),
})

export const GatewayConfigSchema = z.object({
  listen: ListenConfigSchema.default({
    host: '127.0.0.1',
    port: 8080,
    trusted_proxies: [],
  }),
  auth: AuthConfigSchema.optional(),
  upstreams: UpstreamsConfigSchema.optional(),
  telemetry: TelemetryConfigSchema.optional(),
  models: z.array(ModelEntrySchema).optional(),
})

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>

export type GatewayServerStats = {
  requests: number
  inferenceRequests: number
  otlpRequests: number
}

export type GatewayServerHandle = {
  url: string
  host: string
  port: number
  close: () => Promise<void>
  stats: () => GatewayServerStats
}

function parseListenShorthand(value: string): { host: string; port: number } {
  const trimmed = value.trim()
  const bracketMatch = /^\[([^\]]+)\]:(\d+)$/.exec(trimmed)
  if (bracketMatch) {
    const port = Number(bracketMatch[2]!)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`Invalid listen port in "${value}"`)
    }
    return { host: bracketMatch[1]!, port }
  }
  const lastColon = trimmed.lastIndexOf(':')
  if (lastColon <= 0) {
    throw new Error(
      `Invalid listen address "${value}" (expected "host:port" or { host, port })`,
    )
  }
  const host = trimmed.slice(0, lastColon)
  const portStr = trimmed.slice(lastColon + 1)
  if (!/^\d+$/.test(portStr)) {
    throw new Error(`Invalid listen port in "${value}"`)
  }
  const port = Number(portStr)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid listen port in "${value}"`)
  }
  return { host, port }
}

/**
 * Parses a gateway configuration document encoded as JSON or YAML and validates
 * it against `GatewayConfigSchema`.
 */
export function parseGatewayConfig(rawText: string): GatewayConfig {
  const trimmed = rawText.trim()
  if (trimmed.length === 0) {
    throw new Error('Gateway config is empty')
  }

  let raw: unknown
  if (trimmed.startsWith('{')) {
    try {
      raw = JSON.parse(trimmed)
    } catch {
      raw = parseYaml(trimmed)
    }
  } else {
    raw = parseYaml(trimmed)
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Gateway config root must be a YAML/JSON object')
  }

  const normalized: Record<string, unknown> = {
    ...(raw as Record<string, unknown>),
  }
  if (typeof normalized.listen === 'string') {
    normalized.listen = parseListenShorthand(normalized.listen)
  }

  return GatewayConfigSchema.parse(normalized)
}

class PayloadTooLargeError extends Error {
  constructor(message = 'Request body too large') {
    super(message)
    this.name = 'PayloadTooLargeError'
  }
}

function parseIpv4ToBigInt(raw: string): bigint | undefined {
  const parts = raw.split('.')
  if (parts.length !== 4) {
    return undefined
  }
  let acc = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return undefined
    }
    const octet = Number(part)
    if (octet < 0 || octet > 255) {
      return undefined
    }
    acc = (acc << 8n) | BigInt(octet)
  }
  return acc
}

function parseIpv6ToBigInt(raw: string): bigint | undefined {
  let text = raw.trim()
  if (text.startsWith('[') && text.endsWith(']')) {
    text = text.slice(1, -1)
  }
  const zoneIdx = text.indexOf('%')
  if (zoneIdx >= 0) {
    text = text.slice(0, zoneIdx)
  }
  if (text.length === 0) {
    return undefined
  }

  // Handle embedded IPv4 suffix (e.g. ::ffff:127.0.0.1 or 2001:db8::192.0.2.1)
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':')
    if (lastColon < 0) {
      return undefined
    }
    const ipv4 = parseIpv4ToBigInt(text.slice(lastColon + 1))
    if (ipv4 === undefined) {
      return undefined
    }
    const hi = ((ipv4 >> 16n) & 0xffffn).toString(16)
    const lo = (ipv4 & 0xffffn).toString(16)
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`
  }

  const doubleColonParts = text.split('::')
  if (doubleColonParts.length > 2) {
    return undefined
  }

  const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : []
  const right =
    doubleColonParts.length === 2 && doubleColonParts[1]
      ? doubleColonParts[1].split(':')
      : []

  let groups: string[]
  if (doubleColonParts.length === 2) {
    const missing = 8 - (left.length + right.length)
    if (missing < 1) {
      return undefined
    }
    groups = [...left, ...Array<string>(missing).fill('0'), ...right]
  } else {
    if (left.length !== 8) {
      return undefined
    }
    groups = left
  }

  let acc = 0n
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return undefined
    }
    acc = (acc << 16n) | BigInt(Number.parseInt(group, 16))
  }
  return acc
}

type CanonicalIp = {
  family: 4 | 6
  value: bigint
  ipv4MappedFromV6?: boolean
}

function parseCanonicalIp(raw: string): CanonicalIp | undefined {
  let text = raw.trim()
  if (text.startsWith('[') && text.endsWith(']')) {
    text = text.slice(1, -1)
  }
  const v4 = parseIpv4ToBigInt(text)
  if (v4 !== undefined) {
    return { family: 4, value: v4 }
  }
  const v6 = parseIpv6ToBigInt(text)
  if (v6 === undefined) {
    return undefined
  }
  // Normalize IPv4-mapped IPv6 addresses (::ffff:0:0/96) to IPv4.
  if (v6 >> 32n === 0xffffn) {
    return { family: 4, value: v6 & 0xffffffffn, ipv4MappedFromV6: true }
  }
  return { family: 6, value: v6 }
}

function formatCanonicalIpv4(value: bigint): string {
  return [
    Number((value >> 24n) & 0xffn),
    Number((value >> 16n) & 0xffn),
    Number((value >> 8n) & 0xffn),
    Number(value & 0xffn),
  ].join('.')
}

function normalizePeerIp(remoteAddress: string | undefined): string {
  if (!remoteAddress) {
    return ''
  }
  const parsed = parseCanonicalIp(remoteAddress)
  if (parsed?.family === 4) {
    return formatCanonicalIpv4(parsed.value)
  }
  const trimmed = remoteAddress.trim()
  const zoneIdx = trimmed.indexOf('%')
  return zoneIdx >= 0 ? trimmed.slice(0, zoneIdx) : trimmed
}

function ipMatchesTrustedEntry(peer: CanonicalIp, rawEntry: string): boolean {
  const entry = rawEntry.trim()
  if (entry.length === 0) {
    return false
  }
  const slashIdx = entry.indexOf('/')
  if (slashIdx < 0) {
    const target = parseCanonicalIp(entry)
    return (
      target !== undefined &&
      target.family === peer.family &&
      target.value === peer.value
    )
  }
  if (entry.indexOf('/', slashIdx + 1) >= 0) {
    return false
  }
  const netStr = entry.slice(0, slashIdx)
  const prefixStr = entry.slice(slashIdx + 1)
  if (!/^\d+$/.test(prefixStr)) {
    return false
  }
  const parsedNet = parseCanonicalIp(netStr)
  if (!parsedNet) {
    return false
  }
  let prefix = Number(prefixStr)
  if (parsedNet.ipv4MappedFromV6) {
    if (prefix < 96 || prefix > 128) {
      return false
    }
    prefix -= 96
  }
  const maxBits = parsedNet.family === 4 ? 32 : 128
  if (prefix < 0 || prefix > maxBits) {
    return false
  }
  if (parsedNet.family !== peer.family) {
    return false
  }
  if (prefix === 0) {
    return true
  }
  const shift = BigInt(maxBits - prefix)
  return peer.value >> shift === parsedNet.value >> shift
}

function isTrustedProxy(
  remoteAddress: string | undefined,
  trustedProxies: readonly string[],
): boolean {
  if (!remoteAddress || trustedProxies.length === 0) {
    return false
  }
  const peer = parseCanonicalIp(remoteAddress)
  if (!peer) {
    return false
  }
  for (const entry of trustedProxies) {
    if (ipMatchesTrustedEntry(peer, entry)) {
      return true
    }
  }
  return false
}

function constantTimeTokenMatch(
  candidate: string,
  allowed: readonly string[],
): boolean {
  const candDigest = createHash('sha256').update(candidate, 'utf8').digest()
  let matched = false
  for (const token of allowed) {
    const tokenDigest = createHash('sha256').update(token, 'utf8').digest()
    if (timingSafeEqual(candDigest, tokenDigest)) {
      matched = true
    }
  }
  return matched
}

function extractClientToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization
  if (typeof authHeader === 'string') {
    const match = /^bearer\s+(.+)$/i.exec(authHeader.trim())
    if (match?.[1]) {
      return match[1].trim()
    }
  }
  const apiKeyHeader = req.headers['x-api-key']
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim().length > 0) {
    return apiKeyHeader.trim()
  }
  return undefined
}

function resolveUpstreamApiKey(config: GatewayConfig): string | undefined {
  const anthropic = config.upstreams?.anthropic
  if (anthropic?.api_key && anthropic.api_key.length > 0) {
    return anthropic.api_key
  }
  if (anthropic?.api_key_env) {
    const fromEnv = process.env[anthropic.api_key_env]
    if (fromEnv && fromEnv.length > 0) {
      return fromEnv
    }
  }
  if (
    config.auth?.upstream_api_key &&
    config.auth.upstream_api_key.length > 0
  ) {
    return config.auth.upstream_api_key
  }
  if (config.auth?.upstream_api_key_env) {
    const fromEnv = process.env[config.auth.upstream_api_key_env]
    if (fromEnv && fromEnv.length > 0) {
      return fromEnv
    }
  }
  return undefined
}

function readRequestBody(
  req: IncomingMessage,
  maxBytes = MAX_REQUEST_BODY_BYTES,
): Promise<Buffer> {
  const contentLengthHeader = req.headers['content-length']
  if (typeof contentLengthHeader === 'string') {
    const declared = Number(contentLengthHeader.trim())
    if (Number.isFinite(declared) && declared > maxBytes) {
      return Promise.reject(new PayloadTooLargeError('Request body too large'))
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let finished = false

    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }

    const onData = (chunk: Buffer | string) => {
      if (finished) return
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      total += buf.length
      if (total > maxBytes) {
        finished = true
        chunks.length = 0
        cleanup()
        req.pause()
        reject(new PayloadTooLargeError('Request body too large'))
        return
      }
      chunks.push(buf)
    }

    const onEnd = () => {
      if (finished) return
      finished = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }

    const onError = (err: Error) => {
      if (finished) return
      finished = true
      cleanup()
      reject(err)
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

function buildSafeForwardHeaders(
  req: IncomingMessage,
  opts: {
    trustedProxies: readonly string[]
    stripAuthHeaders: boolean
    extraHeaders?: Record<string, string>
  },
): Headers {
  const connectionTokens = new Set<string>()
  const connectionHeader = req.headers.connection
  if (typeof connectionHeader === 'string') {
    for (const part of connectionHeader.split(',')) {
      const trimmed = part.trim().toLowerCase()
      if (trimmed.length > 0) {
        connectionTokens.add(trimmed)
      }
    }
  }

  const peerIp = normalizePeerIp(req.socket.remoteAddress)
  const peerTrusted = isTrustedProxy(
    req.socket.remoteAddress,
    opts.trustedProxies,
  )

  const out = new Headers()
  for (const [rawKey, rawValue] of Object.entries(req.headers)) {
    if (rawValue === undefined) continue
    const key = rawKey.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(key) || connectionTokens.has(key)) {
      continue
    }
    if (
      opts.stripAuthHeaders &&
      (key === 'authorization' || key === 'x-api-key')
    ) {
      continue
    }
    if (FORWARDED_HEADERS.has(key)) {
      if (!peerTrusted) {
        continue
      }
      if (key === 'x-forwarded-for') {
        const existing = Array.isArray(rawValue)
          ? rawValue.join(', ')
          : rawValue
        out.set('x-forwarded-for', `${existing}, ${peerIp}`)
        continue
      }
    }
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        out.append(key, item)
      }
    } else {
      out.set(key, rawValue)
    }
  }

  if (opts.extraHeaders) {
    for (const [k, v] of Object.entries(opts.extraHeaders)) {
      out.set(k, v)
    }
  }

  return out
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload, 'utf8'),
    ...(extraHeaders ?? {}),
  })
  res.end(payload)
}

function hasUnsafeRequestPath(rawUrl: string): boolean {
  const hashIdx = rawUrl.indexOf('#')
  const withoutHash = hashIdx >= 0 ? rawUrl.slice(0, hashIdx) : rawUrl
  const queryIdx = withoutHash.indexOf('?')
  const rawPath = queryIdx >= 0 ? withoutHash.slice(0, queryIdx) : withoutHash

  if (
    /%2e/i.test(rawPath) ||
    /%2f/i.test(rawPath) ||
    /%5c/i.test(rawPath) ||
    /\\/.test(rawPath) ||
    rawPath.includes('\0')
  ) {
    return true
  }

  for (const segment of rawPath.split('/')) {
    if (segment === '..') {
      return true
    }
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return true
  }
  if (/\\/.test(decoded) || decoded.includes('\0')) {
    return true
  }
  for (const segment of decoded.split('/')) {
    if (segment === '..') {
      return true
    }
  }
  return false
}

function createUpstreamSignal(
  res: ServerResponse,
  timeoutMs: number,
): {
  signal: AbortSignal
  clientAborted: () => boolean
  cleanup: () => void
} {
  const clientAbort = new AbortController()
  const onClose = () => {
    if (!res.writableEnded) {
      clientAbort.abort(new Error('Client disconnected'))
    }
  }
  const socket = res.socket
  res.once('close', onClose)
  socket?.once('close', onClose)

  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  let signal: AbortSignal
  let onTimeoutAbort: (() => void) | undefined
  let onClientAbort: (() => void) | undefined

  if (typeof AbortSignal.any === 'function') {
    signal = AbortSignal.any([clientAbort.signal, timeoutSignal])
  } else {
    const combined = new AbortController()
    onTimeoutAbort = () => combined.abort(timeoutSignal.reason)
    onClientAbort = () => combined.abort(clientAbort.signal.reason)
    timeoutSignal.addEventListener('abort', onTimeoutAbort, { once: true })
    clientAbort.signal.addEventListener('abort', onClientAbort, { once: true })
    signal = combined.signal
  }

  return {
    signal,
    clientAborted: () => clientAbort.signal.aborted,
    cleanup: () => {
      res.off('close', onClose)
      socket?.off('close', onClose)
      if (onTimeoutAbort) {
        timeoutSignal.removeEventListener('abort', onTimeoutAbort)
      }
      if (onClientAbort) {
        clientAbort.signal.removeEventListener('abort', onClientAbort)
      }
    },
  }
}

async function writeFetchResponse(
  res: ServerResponse,
  upstreamRes: Response,
): Promise<void> {
  const headers: Record<string, string> = {}
  upstreamRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (!RESPONSE_STRIP_HEADERS.has(lower)) {
      headers[lower] = value
    }
  })

  res.writeHead(upstreamRes.status, headers)

  if (!upstreamRes.body) {
    res.end()
    return
  }

  const reader = upstreamRes.body.getReader()
  try {
    for (;;) {
      if (res.writableEnded || res.destroyed) {
        await reader.cancel().catch(() => {})
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      if (
        value &&
        value.byteLength > 0 &&
        !res.writableEnded &&
        !res.destroyed
      ) {
        res.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
      }
    }
  } finally {
    reader.releaseLock()
    if (!res.writableEnded) {
      res.end()
    }
  }
}

function joinUrlPath(
  baseUrl: string,
  pathname: string,
  search: string,
): string {
  const target = new URL(baseUrl)
  const basePath = target.pathname.replace(/\/+$/, '')
  const normalizedIncoming = pathname.startsWith('/')
    ? pathname
    : `/${pathname}`

  if (
    normalizedIncoming !== '/' &&
    (basePath === normalizedIncoming || basePath.endsWith(normalizedIncoming))
  ) {
    target.pathname = basePath
  } else if (
    (basePath === '/v1' || basePath.endsWith('/v1')) &&
    normalizedIncoming.startsWith('/v1/')
  ) {
    target.pathname = `${basePath}${normalizedIncoming.slice('/v1'.length)}`
  } else {
    target.pathname = `${basePath}${normalizedIncoming}`
  }

  if (search) {
    const incomingParams = new URLSearchParams(search)
    for (const [key, value] of incomingParams.entries()) {
      target.searchParams.append(key, value)
    }
  }

  return target.toString()
}

export type GatewayFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export async function startGatewayServer(
  config: GatewayConfig,
  opts?: { fetchImpl?: GatewayFetchImpl; maxRequestBodyBytes?: number },
): Promise<GatewayServerHandle> {
  const fetchImpl = opts?.fetchImpl ?? fetch
  const maxRequestBodyBytes =
    opts?.maxRequestBodyBytes ?? MAX_REQUEST_BODY_BYTES
  const startedAt = Date.now()
  let requests = 0
  let inferenceRequests = 0
  let otlpRequests = 0

  const authRequired =
    config.auth?.require_auth === true ||
    (config.auth?.bearer_tokens !== undefined &&
      config.auth.bearer_tokens.length > 0)
  const allowedTokens = config.auth?.bearer_tokens ?? []
  const trustedProxies = config.listen.trusted_proxies ?? []

  const server: Server = createServer(async (req, res) => {
    requests += 1
    try {
      const method = (req.method ?? 'GET').toUpperCase()
      const rawUrl = req.url ?? '/'
      if (hasUnsafeRequestPath(rawUrl)) {
        sendJson(res, 400, {
          error: {
            type: 'invalid_request_error',
            message: 'Invalid request path',
          },
        })
        return
      }
      const parsedUrl = new URL(rawUrl, 'http://localhost')
      const pathname = parsedUrl.pathname
      if (pathname.split('/').includes('..')) {
        sendJson(res, 400, {
          error: {
            type: 'invalid_request_error',
            message: 'Invalid request path',
          },
        })
        return
      }

      // Health & readiness probes are always exempted from authentication.
      if (
        method === 'GET' &&
        (pathname === '/healthz' || pathname === '/readyz')
      ) {
        sendJson(res, 200, {
          ok: true,
          status: 'ready',
          uptime_ms: Date.now() - startedAt,
        })
        return
      }

      // Auth middleware for all non-health routes.
      if (authRequired) {
        const candidate = extractClientToken(req)
        if (
          !candidate ||
          allowedTokens.length === 0 ||
          !constantTimeTokenMatch(candidate, allowedTokens)
        ) {
          sendJson(res, 401, {
            error: {
              type: 'authentication_error',
              message: 'Invalid or missing gateway bearer token',
            },
          })
          return
        }
      }

      // Static model catalog when configured.
      if (method === 'GET' && pathname === '/v1/models' && config.models) {
        sendJson(res, 200, { data: config.models })
        return
      }

      // OTLP telemetry relay (/v1/logs, /v1/metrics, /v1/traces).
      if (method === 'POST' && OTLP_PATHS.has(pathname)) {
        otlpRequests += 1
        const forwardTo = config.telemetry?.forward_to
        const body = await readRequestBody(req, maxRequestBodyBytes)
        if (!forwardTo) {
          res.writeHead(204)
          res.end()
          return
        }

        const targetUrl = joinUrlPath(forwardTo, pathname, parsedUrl.search)
        const forwardHeaders = buildSafeForwardHeaders(req, {
          trustedProxies,
          stripAuthHeaders: true,
          extraHeaders: config.telemetry?.headers,
        })
        const timeoutMs = config.telemetry?.timeout_ms ?? 15_000
        const upstreamSignal = createUpstreamSignal(res, timeoutMs)
        try {
          const upstreamRes = await fetchImpl(targetUrl, {
            method: 'POST',
            headers: forwardHeaders,
            body: body.byteLength > 0 ? new Uint8Array(body) : undefined,
            signal: upstreamSignal.signal,
          })
          await writeFetchResponse(res, upstreamRes)
        } catch (err) {
          if (!res.headersSent && !upstreamSignal.clientAborted()) {
            sendJson(res, 502, {
              error: {
                type: 'bad_gateway',
                message: `OTLP collector relay failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            })
          } else if (!res.writableEnded) {
            res.end()
          }
        } finally {
          upstreamSignal.cleanup()
        }
        return
      }

      // Anthropic inference proxy (/v1/messages & /v1/*).
      if (pathname.startsWith('/v1/')) {
        inferenceRequests += 1
        const upstream = config.upstreams?.anthropic
        if (!upstream?.url) {
          sendJson(res, 503, {
            error: {
              type: 'service_unavailable',
              message: 'No Anthropic inference upstream configured',
            },
          })
          return
        }

        const upstreamApiKey = resolveUpstreamApiKey(config)
        const stripAuthHeaders = authRequired || upstreamApiKey !== undefined
        const forwardHeaders = buildSafeForwardHeaders(req, {
          trustedProxies,
          stripAuthHeaders,
          ...(upstreamApiKey !== undefined
            ? { extraHeaders: { 'x-api-key': upstreamApiKey } }
            : {}),
        })

        const hasBody = method !== 'GET' && method !== 'HEAD'
        const body = hasBody
          ? await readRequestBody(req, maxRequestBodyBytes)
          : undefined
        const targetUrl = joinUrlPath(upstream.url, pathname, parsedUrl.search)
        const upstreamSignal = createUpstreamSignal(res, upstream.timeout_ms)

        try {
          const upstreamRes = await fetchImpl(targetUrl, {
            method,
            headers: forwardHeaders,
            ...(body && body.byteLength > 0
              ? { body: new Uint8Array(body) }
              : {}),
            signal: upstreamSignal.signal,
          })
          await writeFetchResponse(res, upstreamRes)
        } catch (err) {
          if (!res.headersSent && !upstreamSignal.clientAborted()) {
            sendJson(res, 502, {
              error: {
                type: 'bad_gateway',
                message: `Anthropic upstream proxy failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            })
          } else if (!res.writableEnded) {
            res.end()
          }
        } finally {
          upstreamSignal.cleanup()
        }
        return
      }

      sendJson(res, 404, {
        error: {
          type: 'not_found',
          message: `Route not found: ${method} ${pathname}`,
        },
      })
    } catch (err) {
      if (!res.headersSent) {
        const message = err instanceof Error ? err.message : String(err)
        const isTooLarge = err instanceof PayloadTooLargeError
        sendJson(
          res,
          isTooLarge ? 413 : 500,
          {
            error: {
              type: isTooLarge ? 'request_too_large' : 'internal_error',
              message,
            },
          },
          isTooLarge ? { connection: 'close' } : undefined,
        )
      } else if (!res.writableEnded) {
        res.end()
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.listen.port, config.listen.host, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const addr = server.address() as AddressInfo | null
  const boundHost = addr?.address ?? config.listen.host
  const boundPort = addr?.port ?? config.listen.port
  const displayHost = boundHost.includes(':') ? `[${boundHost}]` : boundHost
  const url = config.listen.public_url ?? `http://${displayHost}:${boundPort}`

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await new Promise<void>((resolve, reject) => {
      server.close(err => {
        if (err) reject(err)
        else resolve()
      })
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections()
      }
    })
  }

  return {
    url,
    host: boundHost,
    port: boundPort,
    close,
    stats: () => ({
      requests,
      inferenceRequests,
      otlpRequests,
    }),
  }
}
