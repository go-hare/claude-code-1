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
import type net from 'net'
import { getCACertificates } from '../caCerts.js'
import { getMTLSConfig } from '../mtls.js'
import { getProxyUrl, shouldBypassProxy } from '../proxy.js'
import {
  type HardenedHttpsProxyAgentOptions,
  type ProxyConnectEndpointOptions,
  SecureHttpsProxyAgent,
} from '../proxyConnectAgent.js'

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

const MAX_OTLP_PROXY_TUNNEL_MS = 25_000

/**
 * Parse a positive finite timeout in milliseconds from an env var string.
 */
export function parseOtlpTimeoutMs(
  value: string | undefined,
): number | undefined {
  const parsed = value?.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Compute the effective proxy tunnel open timeout (capped at 25s).
 */
export function getOtlpProxyTunnelTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const base =
    parseOtlpTimeoutMs(env.OTEL_EXPORTER_OTLP_TIMEOUT) ??
    MAX_OTLP_PROXY_TUNNEL_MS
  return Math.min(
    MAX_OTLP_PROXY_TUNNEL_MS,
    Math.max(
      parseOtlpTimeoutMs(env.OTEL_EXPORTER_OTLP_LOGS_TIMEOUT) ?? base,
      parseOtlpTimeoutMs(env.OTEL_EXPORTER_OTLP_METRICS_TIMEOUT) ?? base,
      parseOtlpTimeoutMs(env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT) ?? base,
    ),
  )
}

function createTunnelTimeoutError(timeoutMs: number): Error & { code: string } {
  return Object.assign(
    new Error(
      `Could not connect to the OpenTelemetry collector through the proxy within ${timeoutMs / 1000} seconds, so this export was not sent. Check that both can be reached.`,
    ),
    { code: 'ETIMEDOUT' },
  )
}

function abortController(controller: AbortController): void {
  controller.abort()
}

/**
 * Official 2.1.331 `class Yt extends IUo`:
 * Hardened `SecureHttpsProxyAgent` subclass with explicit `isSecureEndpoint`,
 * TLS servername preservation, hardened CONNECT parsing, and bounded proxy
 * tunnel open timeout.
 */
export class OtlpProxyAgent<
  _Uri extends string = string,
> extends SecureHttpsProxyAgent {
  readonly #isSecure: boolean
  readonly #tunnelOpensWithinMs: number

  constructor(
    opts: { isSecure: boolean; tunnelOpensWithinMs: number },
    proxy: string | URL,
    agentOpts?: HardenedHttpsProxyAgentOptions,
  ) {
    super(proxy, agentOpts)
    this.#isSecure = opts.isSecure
    this.#tunnelOpensWithinMs = opts.tunnelOpensWithinMs
  }

  override isSecureEndpoint(): boolean {
    return this.#isSecure
  }

  override async connect(
    req: http.ClientRequest,
    opts: ProxyConnectEndpointOptions,
  ): Promise<net.Socket> {
    const controller = new AbortController()
    const timer = setTimeout(
      abortController,
      this.#tunnelOpensWithinMs,
      controller,
    )
    this.connectOpts = {
      ...this.connectOpts,
      signal: controller.signal,
    }
    try {
      const socket = await super.connect(req, opts)
      if (this.#isSecure) {
        socket.once('secureConnect', () => clearTimeout(timer))
        socket.once('close', () => clearTimeout(timer))
        controller.signal.addEventListener('abort', () =>
          socket.destroy(createTunnelTimeoutError(this.#tunnelOpensWithinMs)),
        )
      } else {
        clearTimeout(timer)
      }
      return socket
    } catch (err) {
      clearTimeout(timer)
      if (controller.signal.aborted) {
        throw createTunnelTimeoutError(this.#tunnelOpensWithinMs)
      }
      throw err
    }
  }
}

/** Official 2.1.323 (#2122, `ee` @311267200): default OTLP/HTTP endpoint. */
export const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318'

/**
 * densable Mvd — factory always returns YAo-wrapped agents (proxy or direct).
 *
 * Official 2.1.323 (#2122): When `otelEndpoint` is unset, OTel SDK defaults
 * export to `http://localhost:4318`. Treat the effective endpoint as localhost
 * so proxy env vars (`HTTP_PROXY`/`HTTPS_PROXY`) are bypassed for default
 * local collectors.
 */
export function createOtlpHttpAgentFactory(
  otelEndpoint?: string,
): OtlpHttpAgentFactory {
  const proxyUrl = getProxyUrl()
  const effectiveEndpoint = otelEndpoint?.trim() || DEFAULT_OTLP_ENDPOINT
  const useProxy = !!(
    proxyUrl &&
    !isLocalhostOtelEndpoint(effectiveEndpoint) &&
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

  const tunnelOpensWithinMs = getOtlpProxyTunnelTimeoutMs()
  let httpAgent: http.Agent | undefined
  let httpsAgent: https.Agent | undefined
  const proxyAgents = new Map<boolean, OtlpProxyAgent<string>>()

  return (protocol: string) => {
    if (useProxy && proxyUrl) {
      const isSecure = protocol !== 'http:'
      let proxyAgent = proxyAgents.get(isSecure)
      if (!proxyAgent) {
        proxyAgent = wrapAgentWithContentLength(
          new OtlpProxyAgent({ isSecure, tunnelOpensWithinMs }, proxyUrl, {
            ...tlsExtras,
            keepAlive: true,
            maxFreeSockets: 1,
          }),
        )
        proxyAgents.set(isSecure, proxyAgent)
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
