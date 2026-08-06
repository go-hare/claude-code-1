/**
 * densable 2.1.212 #31 — OTLP HTTP exports with Content-Length (no chunked TE).
 *
 * densable symbols:
 * - `Lvd` — coerce write/end chunks to Buffer
 * - `YAo` — wrap Agent.addRequest so piped bodies buffer and set Content-Length
 * - `Mvd` — HttpAgentFactory: proxy / http / https agents, always YAo-wrapped
 * - `d1y` — localhost endpoint detection (skip proxy)
 *
 * Azure Monitor and similar collectors reject chunked transfer (HTTP 411/400).
 * The stock OTEL `sendWithHttp` pipes a Readable without Content-Length, which
 * forces chunked encoding. Intercepting write/end on the ClientRequest lets us
 * set Content-Length before headers are sent.
 */

import http from 'http'
import https from 'https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getCACertificates } from '../caCerts.js'
import { getMTLSConfig } from '../mtls.js'
import { getProxyUrl, shouldBypassProxy } from '../proxy.js'

/** densable d1y */
export function isLocalhostOtelEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false
  try {
    const host = new URL(endpoint).hostname.toLowerCase()
    return (
      host === 'localhost' ||
      host === '::1' ||
      host === '[::1]' ||
      /^127(\.\d{1,3}){3}$/.test(host)
    )
  } catch {
    return false
  }
}

/** densable Lvd */
export function toOtlpBodyChunk(chunk: unknown, encoding?: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === 'string') {
    return typeof encoding === 'string'
      ? Buffer.from(chunk, encoding as BufferEncoding)
      : Buffer.from(chunk)
  }
  if (chunk instanceof Uint8Array) return Buffer.from(chunk)
  throw new TypeError('OTLP request body chunk is not string or Uint8Array')
}

type AgentLike = http.Agent | https.Agent

// Node http.Agent has addRequest at runtime; @types/node may omit it on Agent.
type AgentWithAddRequest = AgentLike & {
  addRequest: (req: http.ClientRequest, ...rest: unknown[]) => void
}

/**
 * densable YAo — when a request has neither content-length nor transfer-encoding,
 * buffer write()/end() chunks and set Content-Length before the real end().
 */
export function wrapAgentWithContentLength<T extends AgentLike>(agent: T): T {
  const agentWith = agent as T & AgentWithAddRequest
  const originalAddRequest = agentWith.addRequest.bind(agentWith)
  agentWith.addRequest = function (
    req: http.ClientRequest,
    ...rest: unknown[]
  ): void {
    if (
      !req.getHeader('content-length') &&
      !req.getHeader('transfer-encoding')
    ) {
      const restore = (): void => {
        req.write = originalWrite
        req.end = originalEnd
      }
      const fail = (err: unknown): void => {
        restore()
        req.destroy(
          err instanceof Error
            ? err
            : new TypeError('OTLP request body chunk conversion failed'),
        )
      }
      const chunks: Buffer[] = []
      const originalWrite = req.write.bind(req)
      const originalEnd = req.end.bind(req)

      req.write = function (
        chunk?: unknown,
        encoding?: unknown,
        cb?: unknown,
      ): boolean {
        try {
          chunks.push(toOtlpBodyChunk(chunk, encoding))
        } catch (err) {
          fail(err)
          return false
        }
        const done =
          typeof encoding === 'function'
            ? encoding
            : typeof cb === 'function'
              ? cb
              : undefined
        if (done) process.nextTick(done, null)
        return true
      } as typeof req.write

      req.end = function (
        chunk?: unknown,
        encoding?: unknown,
        cb?: unknown,
      ): http.ClientRequest {
        if (chunk != null && typeof chunk !== 'function') {
          try {
            chunks.push(toOtlpBodyChunk(chunk, encoding))
          } catch (err) {
            fail(err)
            return req
          }
        }
        const done =
          typeof chunk === 'function'
            ? chunk
            : typeof encoding === 'function'
              ? encoding
              : typeof cb === 'function'
                ? cb
                : undefined
        const body = Buffer.concat(chunks)
        if (!req.headersSent) {
          req.setHeader('Content-Length', String(body.byteLength))
        }
        restore()
        return originalEnd(body, done as (() => void) | undefined)
      } as typeof req.end
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalAddRequest as any)(req, ...rest)
  }
  return agent
}

export type OtlpHttpAgentFactory = (protocol: string) => AgentLike

/**
 * densable Mvd — factory always returns YAo-wrapped agents (proxy or direct).
 */
export function createOtlpHttpAgentFactory(
  otelEndpoint?: string,
): OtlpHttpAgentFactory {
  const proxyUrl = getProxyUrl()
  const useProxy = !!(
    proxyUrl &&
    !isLocalhostOtelEndpoint(otelEndpoint) &&
    !(otelEndpoint && shouldBypassProxy(otelEndpoint))
  )

  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()
  const tlsExtras = {
    ...(mtlsConfig && {
      cert: mtlsConfig.cert,
      key: mtlsConfig.key,
      passphrase: mtlsConfig.passphrase,
    }),
    ...(caCerts && { ca: caCerts }),
  }

  let httpAgent: http.Agent | undefined
  let httpsAgent: https.Agent | undefined
  let proxyAgent: HttpsProxyAgent<string> | undefined

  return (protocol: string) => {
    if (useProxy && proxyUrl) {
      if (!proxyAgent) {
        proxyAgent = wrapAgentWithContentLength(
          new HttpsProxyAgent(proxyUrl, {
            ...tlsExtras,
            keepAlive: true,
            maxSockets: 1,
          }),
        ) as HttpsProxyAgent<string>
        // densable: c.options = { ...c.options, ...s } for TLS on tunnel
        Object.assign(proxyAgent, {
          options: {
            ...(proxyAgent as unknown as { options?: Record<string, unknown> })
              .options,
            ...tlsExtras,
          },
        })
      }
      return proxyAgent
    }
    if (protocol === 'http:') {
      if (!httpAgent) {
        httpAgent = wrapAgentWithContentLength(
          new http.Agent({ keepAlive: true, maxSockets: 1 }),
        )
      }
      return httpAgent
    }
    if (!httpsAgent) {
      httpsAgent = wrapAgentWithContentLength(
        new https.Agent({
          ...tlsExtras,
          keepAlive: true,
          maxSockets: 1,
        }),
      )
    }
    return httpsAgent
  }
}
