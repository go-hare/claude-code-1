/**
 * Official Claude Code 2.1.331 hardened HTTP Proxy CONNECT agent + IdP SSRF proxy agent
 * (`Oe`, `so`, `Ft`, `OUo`, `IUo`, `Une`, `y$`, `Bd`, `Hd` from 03_idp_ssrf.js & 03b_proxy_connect.js).
 *
 * Hardens HTTP Proxy `CONNECT` against:
 * - Target / header injection (space in target, or CR/LF/NUL in target or any header)
 * - Oversized CONNECT response headers (> 64 KiB)
 * - Malformed CONNECT response headers (empty status line or header without `:`)
 * - Non-200 non-error CONNECT response smuggling on HTTPS targets
 * - Prototype pollution when merging repeated proxy response headers
 *
 * And blocks `http://` IdP endpoints and loopback/metadata hosts routed via proxy
 * with `ECONNREFUSED_SSRF`.
 */

import dns from 'dns'
import { Agent as HttpAgent, type AgentOptions as HttpAgentOptions } from 'http'
import type http from 'http'
import { Agent as HttpsAgent } from 'https'
import net, { isIP, isIPv4, isIPv6, Socket } from 'net'
import tls, { checkServerIdentity } from 'tls'
import { isEnvTruthy } from './envUtils.js'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from './errors.js'

/** Official `ro`: maximum proxy CONNECT response header block size (64 KiB). */
export const MAX_PROXY_CONNECT_HEADER_BYTES = 65536

/** Official `qt`: error code attached to proxy tunnel failures. */
export const ERR_PROXY_TUNNEL_CODE = 'ERR_PROXY_TUNNEL' as const

/** Official `oo`: valid 4xx/5xx HTTP/1.x status line prefix allowed on non-200 HTTPS CONNECT responses. */
export const PROXY_CONNECT_ERROR_STATUS_RE = /^HTTP\/1\.[01] [45]\d\d[ \r]/

export type ProxyConnectHeaderValue = string | string[] | number | undefined
export type ProxyConnectHeadersInput =
  | Record<string, ProxyConnectHeaderValue>
  | (() => Record<string, ProxyConnectHeaderValue>)

export type HardenedHttpsProxyAgentOptions = HttpAgentOptions &
  Partial<tls.ConnectionOptions> &
  Partial<net.TcpNetConnectOpts> & {
    headers?: ProxyConnectHeadersInput
    timeout?: number
  }

export type ProxyConnectEndpointOptions = {
  host?: string
  port?: number | string
  path?: string
  protocol?: string
  secureEndpoint?: boolean
  servername?: string
  checkServerIdentity?: typeof checkServerIdentity
  [key: string]: unknown
}

export type ParsedProxyConnectResponse = {
  statusCode: number
  headers: Record<string, string | string[]>
  received: Buffer
}

function attachTlsServername<T extends { servername?: string; host?: string }>(
  opts: T,
): T {
  return opts.servername === undefined && opts.host && !isIP(opts.host)
    ? { ...opts, servername: opts.host }
    : opts
}

/**
 * Official `Oe.connect` request line + header validation:
 * Rejects whitespace in `target` (`host:port`) or CR/LF/NUL in target or any header.
 */
export function buildConnectRequestLines(
  target: string,
  headers: Record<string, ProxyConnectHeaderValue>,
): string[] {
  const lines = [
    `CONNECT ${target} HTTP/1.1`,
    ...Object.entries(headers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) =>
        Array.isArray(value)
          ? `${key}: ${value.join(', ')}`
          : `${key}: ${value}`,
      ),
  ]
  if (/\s/.test(target) || lines.some(line => /[\0\r\n]/.test(line))) {
    throw new TypeError(
      'Space in the target, or line break or NUL in the target or a header, of a CONNECT request',
    )
  }
  return lines
}

/**
 * Official `so(e)`: strictly parse an HTTP Proxy `CONNECT` response header block
 * from a readable stream/socket.
 */
export async function parseProxyConnectResponse(
  socket: Pick<Socket, 'read' | 'on' | 'off' | 'removeAllListeners'>,
): Promise<ParsedProxyConnectResponse> {
  let resolveHeaderEnd!: (index: number) => void
  let rejectHeaderEnd!: (err: Error) => void
  const headerEndPromise = new Promise<number>((res, rej) => {
    resolveHeaderEnd = res
    rejectHeaderEnd = rej
  })

  let received = Buffer.alloc(0)
  const onReadable = (): void => {
    for (
      let chunk: Buffer | null;
      (chunk = socket.read() as Buffer | null) !== null;
    ) {
      const searchFrom = Math.max(0, received.length - 3)
      received = Buffer.concat([received, chunk])
      const crlfIdx = received.indexOf('\r\n\r\n', searchFrom)
      if (
        (crlfIdx < 0 ? received.length - 3 : crlfIdx) >
        MAX_PROXY_CONNECT_HEADER_BYTES
      ) {
        rejectHeaderEnd(
          Object.assign(
            new Error('Proxy CONNECT response header is too large'),
            { code: ERR_PROXY_TUNNEL_CODE },
          ),
        )
        return
      }
      if (crlfIdx >= 0) {
        socket.removeAllListeners('readable')
        resolveHeaderEnd(crlfIdx)
        return
      }
    }
  }
  const onEnd = (): void => {
    rejectHeaderEnd(
      new Error('Proxy connection ended before receiving CONNECT response'),
    )
  }
  const onError = (err: Error): void => {
    rejectHeaderEnd(err)
  }

  socket.on('readable', onReadable)
  socket.on('end', onEnd)
  socket.on('error', onError)

  let headerEndIdx: number
  try {
    headerEndIdx = await headerEndPromise
  } finally {
    socket.off('readable', onReadable)
    socket.off('end', onEnd)
    socket.off('error', onError)
  }

  const [statusLine, ...headerLines] = received
    .toString('ascii', 0, headerEndIdx)
    .split('\r\n')
  if (!statusLine) {
    throw new Error('No header received from proxy CONNECT response')
  }

  const headers = Object.create(null) as Record<string, string | string[]>
  for (const line of headerLines.filter(Boolean)) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) {
      throw new Error('Invalid header from proxy CONNECT response')
    }
    const name = line.slice(0, colonIdx).toLowerCase()
    const value = line.slice(colonIdx + 1).trimStart()
    const existing = Object.hasOwn(headers, name) ? headers[name] : undefined
    if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      headers[name] = existing === undefined ? value : [existing, value]
    }
  }

  return {
    statusCode: Number(statusLine.split(' ')[1]),
    headers,
    received,
  }
}

/**
 * Official 2.1.331 `Oe extends http.Agent`:
 * Hardened HTTP/HTTPS CONNECT proxy agent replacing unhardened `https-proxy-agent`.
 */
export class HardenedHttpsProxyAgent extends HttpAgent {
  options: HardenedHttpsProxyAgentOptions & { path?: string }
  proxy: URL
  proxyHeaders: ProxyConnectHeadersInput
  connectOpts: net.TcpNetConnectOpts &
    Partial<tls.ConnectionOptions> & { signal?: AbortSignal }
  #overrides: { protocol?: string; defaultPort?: number } = {}

  constructor(proxy: string | URL, opts?: HardenedHttpsProxyAgentOptions) {
    super(opts)
    this.options = { path: undefined, ...opts }
    const { headers: _headers, ...rest } = opts ?? {}
    this.proxy = typeof proxy === 'string' ? new URL(proxy) : proxy
    this.proxyHeaders = opts?.headers ?? {}
    this.connectOpts = {
      ALPNProtocols: ['http/1.1'],
      ...rest,
      host: this.proxy.hostname.replace(/^\[|\]$/g, ''),
      port: Number(
        this.proxy.port || (this.proxy.protocol === 'https:' ? 443 : 80),
      ),
    }
  }

  get protocol(): string {
    return (
      (#overrides in this ? this.#overrides.protocol : undefined) ??
      (this.isSecureEndpoint() ? 'https:' : 'http:')
    )
  }

  set protocol(value: string) {
    if (#overrides in this) {
      this.#overrides.protocol = value
    }
  }

  get defaultPort(): number {
    return (
      (#overrides in this ? this.#overrides.defaultPort : undefined) ??
      (this.protocol === 'https:' ? 443 : 80)
    )
  }

  set defaultPort(value: number) {
    if (#overrides in this) {
      this.#overrides.defaultPort = value
    }
  }

  isSecureEndpoint(opts?: ProxyConnectEndpointOptions): boolean {
    if (typeof opts?.secureEndpoint === 'boolean') {
      return opts.secureEndpoint
    }
    if (typeof opts?.protocol === 'string') {
      return opts.protocol === 'https:'
    }
    return /node:https:|\(https\.js:/.test(new Error().stack ?? '')
  }

  override getName(opts: http.RequestOptions = {}): string {
    if (this.isSecureEndpoint(opts as ProxyConnectEndpointOptions)) {
      return HttpsAgent.prototype.getName.call(
        this,
        opts as Parameters<HttpsAgent['getName']>[0],
      )
    }
    return super.getName(opts)
  }

  createSocket(
    req: http.ClientRequest,
    opts: ProxyConnectEndpointOptions,
    cb: (err: Error | null, socket?: Socket) => void,
  ): void {
    const endpointOpts: ProxyConnectEndpointOptions = {
      ...opts,
      secureEndpoint: this.isSecureEndpoint(opts),
    }
    const baseCreateSocket = Reflect.get(
      HttpAgent.prototype,
      'createSocket',
    ) as (
      this: HttpAgent,
      r: http.ClientRequest,
      o: Record<string, unknown>,
      c: (err: Error | null, s?: Socket) => void,
    ) => void
    Promise.resolve()
      .then(() => this.connect(req, endpointOpts))
      .then(socket =>
        Reflect.apply(baseCreateSocket, this, [
          req,
          { ...opts, tunnel: socket },
          cb,
        ]),
      )
      .catch(err => cb(err instanceof Error ? err : new Error(String(err))))
  }

  override createConnection(
    opts: http.ClientRequestArgs & { tunnel?: Socket },
  ): Socket {
    if (!opts.tunnel) {
      throw new Error('connect() gave no socket')
    }
    return opts.tunnel
  }

  async connect(
    req: http.ClientRequest,
    opts: ProxyConnectEndpointOptions,
  ): Promise<Socket> {
    if (!opts.host) {
      throw new TypeError('No "host" provided')
    }
    const target = `${isIPv6(opts.host) ? `[${opts.host}]` : opts.host}:${opts.port}`
    const { username, password, protocol } = this.proxy
    const headers: Record<string, ProxyConnectHeaderValue> = {
      ...(typeof this.proxyHeaders === 'function'
        ? this.proxyHeaders()
        : this.proxyHeaders),
    }
    if (username || password) {
      headers['Proxy-Authorization'] =
        'Basic ' +
        Buffer.from(
          `${decodeURIComponent(username)}:${decodeURIComponent(password)}`,
        ).toString('base64')
    }
    headers.Host = target
    const isKeepAlive = Boolean(
      (this as HttpAgent & { keepAlive?: boolean }).keepAlive ??
        this.options.keepAlive,
    )
    headers['Proxy-Connection'] ||= isKeepAlive ? 'Keep-Alive' : 'close'

    const lines = buildConnectRequestLines(target, headers)
    const socket: Socket =
      protocol === 'https:'
        ? tls.connect(attachTlsServername(this.connectOpts))
        : net.connect(this.connectOpts)

    try {
      const responsePromise = parseProxyConnectResponse(socket)
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      const { received, ...connectMeta } = await responsePromise
      req.emit('proxyConnect', connectMeta)

      if (connectMeta.statusCode !== 200) {
        socket.destroy()
        const dummySocket = new Socket({ writable: false })
        req.once('socket', s => {
          if (
            opts.secureEndpoint &&
            !PROXY_CONNECT_ERROR_STATUS_RE.test(
              received.toString('latin1', 0, 13),
            )
          ) {
            req.destroy(
              Object.assign(
                new Error(
                  'Proxy answered CONNECT with neither 200 nor an error',
                ),
                { code: ERR_PROXY_TUNNEL_CODE },
              ),
            )
            return
          }
          s.push(received)
          s.push(null)
        })
        return dummySocket
      }

      req.once('socket', s => s.resume())
      if (!opts.secureEndpoint) {
        return socket
      }
      const {
        host: _host,
        path: _path,
        port: _port,
        ...tlsOpts
      } = attachTlsServername(opts)
      return tls.connect({
        ...(tlsOpts as tls.ConnectionOptions),
        socket,
      })
    } catch (err) {
      socket.destroy()
      throw err
    }
  }
}

/** Official `OUo(e)`: TLS servername / checkServerIdentity options for DNS vs IP hosts. */
export function buildTlsIdentityOptions(host: string): {
  servername: string
  checkServerIdentity?: typeof checkServerIdentity
} {
  if (!host || isIP(host)) {
    return {
      servername: '',
      checkServerIdentity: (_servername, cert) =>
        checkServerIdentity(host, cert),
    }
  }
  return { servername: host }
}

/**
 * Official 2.1.331 `IUo extends Oe`:
 * Preserves target `servername` and `checkServerIdentity` across CONNECT tunnels
 * (and passes empty SNI + explicit IP verification for IP literal targets).
 */
export class SecureHttpsProxyAgent extends HardenedHttpsProxyAgent {
  override connect(
    req: http.ClientRequest,
    opts: ProxyConnectEndpointOptions,
  ): Promise<Socket> {
    if (!opts.secureEndpoint) {
      return super.connect(req, opts)
    }
    const servername = opts.servername || opts.host || ''
    const customCheck = opts.checkServerIdentity
    return super.connect(req, {
      ...opts,
      ...(customCheck
        ? {
            checkServerIdentity: (
              _host: string,
              cert: Parameters<typeof checkServerIdentity>[1],
            ) => customCheck(servername, cert),
          }
        : buildTlsIdentityOptions(servername)),
    })
  }
}

// ============================================================================
// SSRF Host/IP Classification (`Une`, `y$`) & IdP Proxy Agent (`Bd`, `Hd`)
// ============================================================================

const IPV4_OCTET_RE = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const IPV6_HEXTET_RE = /^[0-9a-f]{1,4}$/i
const IPV6_ZONE_RE = /%[0-9a-z.:-]+$/i

/** Official `Une(e)`: parse IPv4 (4 bytes) or IPv6 (16 bytes) into byte array. */
export function parseIpBytes(address: string): number[] | undefined {
  if (!address.includes(':')) {
    const octets = address.split('.')
    return octets.length === 4 && octets.every(o => IPV4_OCTET_RE.test(o))
      ? octets.map(Number)
      : undefined
  }
  const stripped = address.replace(IPV6_ZONE_RE, '')
  const lastColon = stripped.lastIndexOf(':') + 1
  const embeddedV4 = parseIpBytes(stripped.slice(lastColon))
  const halves = (embeddedV4 ? `${stripped.slice(0, lastColon)}0:0` : stripped)
    .split('::')
    .map(part => (part ? part.split(':') : []))
  const [left = [], right] = halves
  const missing = 8 - halves.flat().length
  if (
    halves.length > 2 ||
    (right ? missing < 1 : missing !== 0) ||
    !halves.flat().every(part => IPV6_HEXTET_RE.test(part))
  ) {
    return undefined
  }
  const bytes = [
    ...left,
    ...Array<string>(missing).fill('0'),
    ...(right ?? []),
  ].flatMap(hex => {
    const val = parseInt(hex, 16)
    return [val >> 8, val & 255]
  })
  return embeddedV4 ? [...bytes.slice(0, 12), ...embeddedV4] : bytes
}

const BLOCKED_METADATA_AND_LOOPBACK_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  'instance-data.ec2.internal',
  'ip6-localhost',
  'ip6-loopback',
  'localhost.localdomain',
  'localhost4',
  'localhost4.localdomain4',
  'localhost6',
  'localhost6.localdomain6',
])

const BLOCKED_METADATA_IPV4 = new Set([
  '100.100.100.200',
  '168.63.129.16',
  '192.0.0.192',
])

const BLOCKED_METADATA_IPV6 = new Set(
  [
    'fd00:ec2::254',
    'fd00:ec2::23',
    'fd20:ce::254',
    'fd00:c1::a9fe:a9fe',
    'fd00:a9fe:a9fe::1',
  ]
    .map(addr => parseIpBytes(addr))
    .filter((b): b is number[] => b !== undefined)
    .map(b => String(b)),
)

function isBlockedIpv4Octets(a: number, b: number): boolean {
  return a === 127 || (a === 169 && b === 254) || a === 0
}

function isWellKnownNat64Prefix(bytes: number[]): boolean {
  return (
    bytes[0] === 0 && bytes[1] === 100 && bytes[2] === 255 && bytes[3] === 155
  )
}

function isLocalUseNat64(bytes: number[]): boolean {
  return isWellKnownNat64Prefix(bytes) && bytes[4] === 0 && bytes[5] === 1
}

function extractEmbeddedIpv4FromIpv6(bytes: number[]): number[][] {
  const out: number[][] = []
  if (bytes[0] === 32 && bytes[1] === 2) {
    out.push(bytes.slice(2, 6))
  }
  const zeros0to9 = bytes.slice(0, 10).every(v => v === 0)
  const isV4Mapped = zeros0to9 && bytes[10] === 255 && bytes[11] === 255
  const isV4Compat = zeros0to9 && bytes[10] === 0 && bytes[11] === 0
  const isWellKnownNat64 =
    isWellKnownNat64Prefix(bytes) && bytes.slice(4, 12).every(v => v === 0)
  const isIsatap =
    (bytes[8] === 0 || bytes[8] === 2) &&
    bytes[9] === 0 &&
    bytes[10] === 94 &&
    bytes[11] === 254
  if (isV4Mapped || isV4Compat || isWellKnownNat64 || isIsatap) {
    out.push(bytes.slice(12, 16))
  }
  return out
}

/**
 * Official 2.1.331 `y$(e)`: returns true if `host` is a loopback, unspecified,
 * link-local, NAT64 local-use, or cloud metadata hostname/IPv4/IPv6 address.
 */
export function isBlockedLoopbackOrMetadataHost(host: string): boolean {
  let normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1)
  }
  if (
    normalized === '' ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost')
  ) {
    return true
  }
  if (BLOCKED_METADATA_AND_LOOPBACK_HOSTS.has(normalized)) {
    return true
  }
  if (
    normalized.startsWith('instance-data.') &&
    normalized.endsWith('.compute.internal')
  ) {
    return true
  }
  if (isIPv4(normalized)) {
    if (BLOCKED_METADATA_IPV4.has(normalized)) return true
    const [a = 0, b = 0] = normalized.split('.').map(Number)
    return isBlockedIpv4Octets(a, b)
  }
  if (!isIPv6(normalized)) {
    return false
  }
  const bytes = parseIpBytes(normalized)
  if (bytes === undefined) return true
  if (isLocalUseNat64(bytes)) return true
  if (bytes.every(v => v === 0)) return true
  if (bytes.slice(0, 15).every(v => v === 0) && bytes[15] === 1) return true
  if (BLOCKED_METADATA_IPV6.has(String(bytes))) return true
  if (bytes[0] === 254 && (bytes[1] ?? 0) >= 128 && (bytes[1] ?? 0) <= 191) {
    return true
  }
  return extractEmbeddedIpv4FromIpv6(bytes).some(octets => {
    const [a = 0, b = 0, c = 0, d = 0] = octets
    return (
      isBlockedIpv4Octets(a, b) ||
      BLOCKED_METADATA_IPV4.has(`${a}.${b}.${c}.${d}`)
    )
  })
}

export type SsrfBlockedError = Error & { code: 'ECONNREFUSED_SSRF' }

export function createIdpHttpViaProxyBlockedError(
  host: string,
  port: number | string | undefined,
): TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS & {
  code: 'ECONNREFUSED_SSRF'
} {
  return Object.assign(
    new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      `ECONNREFUSED_SSRF: blocked http://${host}:${port ?? 80} via proxy. With CLAUDE_GATEWAY_IDP_CONNECT_BY_HOSTNAME on, IdP URLs that go through the proxy (issuer, discovery_url, JWKS, token, userinfo) must be https. Use https, or list the host in NO_PROXY if the gateway can reach it without the proxy`,
      'ECONNREFUSED_SSRF: blocked http:// IdP endpoint via proxy',
    ),
    { code: 'ECONNREFUSED_SSRF' as const },
  )
}

export function createLoopbackMetadataViaProxyBlockedError(): SsrfBlockedError {
  return Object.assign(
    new Error('ECONNREFUSED_SSRF: blocked loopback/metadata host via proxy'),
    { code: 'ECONNREFUSED_SSRF' as const },
  )
}

function isLoopbackOrUnspecifiedIp(address: string): boolean {
  const bytes = parseIpBytes(address.replace(/^\[|\]$/g, ''))
  if (!bytes) return false
  if (bytes.length === 4) {
    return bytes[0] === 127 || bytes[0] === 0
  }
  if (bytes.length === 16) {
    if (bytes.slice(0, 15).every(v => v === 0) && (bytes[15] ?? 0) <= 1) {
      return true
    }
    if (
      bytes.slice(0, 10).every(v => v === 0) &&
      bytes[10] === 255 &&
      bytes[11] === 255
    ) {
      return bytes[12] === 127 || bytes[12] === 0
    }
  }
  return false
}

export type IdpDnsLookup = (
  hostname: string,
  options: { all: true },
  callback: (
    err: NodeJS.ErrnoException | null,
    addresses: dns.LookupAddress[],
  ) => void,
) => void

/**
 * Resolve `hostname` and reject if any returned IP is a blocked loopback /
 * link-local / cloud metadata address (official `Wn`).
 */
export function resolveSafeIdpHostname(
  hostname: string,
  opts?: {
    allowLoopback?: boolean
    lookup?: IdpDnsLookup
  },
): Promise<string> {
  const allowLoopback =
    opts?.allowLoopback ??
    isEnvTruthy(process.env.CLAUDE_GATEWAY_ALLOW_LOOPBACK)
  const lookupFn: IdpDnsLookup =
    opts?.lookup ??
    ((h, o, cb) => {
      dns.lookup(h, o, cb)
    })

  return new Promise((resolve, reject) => {
    lookupFn(hostname, { all: true }, (err, records) => {
      if (err) {
        reject(err)
        return
      }
      if (!records || records.length === 0) {
        reject(
          Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
            code: 'ENOTFOUND',
          }),
        )
        return
      }
      for (const { address } of records) {
        const loopback = isLoopbackOrUnspecifiedIp(address)
        if (loopback && allowLoopback) continue
        if (isBlockedLoopbackOrMetadataHost(address)) {
          const reason = loopback
            ? 'ECONNREFUSED_SSRF: blocked (loopback; set CLAUDE_GATEWAY_ALLOW_LOOPBACK=1 in the gateway environment to allow it)'
            : 'ECONNREFUSED_SSRF: blocked (cloud metadata / link-local)'
          reject(
            Object.assign(new Error(`${reason}: ${hostname} → ${address}`), {
              code: 'ECONNREFUSED_SSRF',
            }),
          )
          return
        }
      }
      const chosen = records.find(r => r.family === 4) ?? records[0]!
      resolve(chosen.address)
    })
  })
}

export type IdpProxyAgentOptions = HardenedHttpsProxyAgentOptions & {
  /** Official `zt()`: true when proxy is configured as egress boundary. */
  proxyIsEgressBoundary?: boolean
  /** Override `CLAUDE_GATEWAY_IDP_CONNECT_BY_HOSTNAME` env check. */
  connectByHostname?: boolean
  /** Override `CLAUDE_GATEWAY_ALLOW_LOOPBACK` env check. */
  allowLoopback?: boolean
  /** Injectable DNS lookup for SSRF-checked resolution when not connecting by hostname. */
  ssrfLookup?: IdpDnsLookup
}

/**
 * Official 2.1.331 `Bd extends IUo`:
 * Proxy agent for OIDC / IdP outbound requests.
 * - Blocks loopback and cloud metadata hosts via proxy (`ECONNREFUSED_SSRF`).
 * - Blocks `http://` IdP endpoints via proxy when `CLAUDE_GATEWAY_IDP_CONNECT_BY_HOSTNAME`
 *   is enabled (`ECONNREFUSED_SSRF: blocked http:// IdP endpoint via proxy`).
 * - Performs SSRF-checked DNS resolution when connecting by IP (connectByHostname off).
 */
export class IdpProxyAgent extends SecureHttpsProxyAgent {
  readonly #proxyIsEgressBoundary: boolean
  readonly #connectByHostnameOverride: boolean | undefined
  readonly #allowLoopbackOverride: boolean | undefined
  readonly #ssrfLookup: IdpDnsLookup | undefined

  constructor(proxy: string | URL, opts?: IdpProxyAgentOptions) {
    const {
      proxyIsEgressBoundary,
      connectByHostname,
      allowLoopback,
      ssrfLookup,
      ...agentOpts
    } = opts ?? {}
    super(proxy, agentOpts)
    this.#proxyIsEgressBoundary = proxyIsEgressBoundary ?? false
    this.#connectByHostnameOverride = connectByHostname
    this.#allowLoopbackOverride = allowLoopback
    this.#ssrfLookup = ssrfLookup
  }

  override async connect(
    req: http.ClientRequest,
    opts: ProxyConnectEndpointOptions,
  ): Promise<Socket> {
    const host = opts.host
    let nextOpts = opts
    const connectByHostname =
      this.#connectByHostnameOverride ??
      isEnvTruthy(process.env.CLAUDE_GATEWAY_IDP_CONNECT_BY_HOSTNAME)

    if (host && (this.#proxyIsEgressBoundary || connectByHostname)) {
      const normalized = host.toLowerCase().replace(/\.$/, '')
      if (isBlockedLoopbackOrMetadataHost(normalized)) {
        throw createLoopbackMetadataViaProxyBlockedError()
      }
      if (!opts.secureEndpoint && connectByHostname) {
        throw createIdpHttpViaProxyBlockedError(normalized, opts.port)
      }
      if (!isIP(host)) {
        nextOpts = { ...nextOpts, host: normalized, servername: normalized }
      }
    } else if (host && !isIP(host)) {
      const resolvedIp = await resolveSafeIdpHostname(host, {
        allowLoopback: this.#allowLoopbackOverride,
        lookup: this.#ssrfLookup,
      })
      nextOpts = { ...nextOpts, host: resolvedIp, servername: host }
    }

    return super.connect(req, nextOpts)
  }
}

/** Official 2.1.331 `Hd(e, t)`: create an `IdpProxyAgent` with optional CA cert(s). */
export function createIdpProxyAgent(
  proxyUrl: string | URL,
  ca?: string | string[] | Buffer,
  opts?: IdpProxyAgentOptions,
): IdpProxyAgent {
  const agent = new IdpProxyAgent(proxyUrl, opts)
  if (ca !== undefined) {
    agent.options = { ...agent.options, ca }
  }
  return agent
}

/**
 * URL-level validation helper enforcing the exact same `ECONNREFUSED_SSRF` rules
 * as `IdpProxyAgent.connect` before routing an IdP URL through a proxy.
 */
export function assertSafeIdpProxyTarget(
  rawUrl: string | URL,
  opts?: {
    proxyIsEgressBoundary?: boolean
    connectByHostname?: boolean
    env?: NodeJS.ProcessEnv
  },
): void {
  const parsed = typeof rawUrl === 'string' ? new URL(rawUrl) : rawUrl
  const env = opts?.env ?? process.env
  const connectByHostname =
    opts?.connectByHostname ??
    isEnvTruthy(env.CLAUDE_GATEWAY_IDP_CONNECT_BY_HOSTNAME)
  const egressBoundary = opts?.proxyIsEgressBoundary ?? false
  const normalized = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')

  if (isBlockedLoopbackOrMetadataHost(normalized)) {
    throw createLoopbackMetadataViaProxyBlockedError()
  }
  if (parsed.protocol === 'http:' && (connectByHostname || !egressBoundary)) {
    const port = parsed.port || '80'
    throw createIdpHttpViaProxyBlockedError(normalized, port)
  }
}
