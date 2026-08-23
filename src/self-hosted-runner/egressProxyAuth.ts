/**
 * densable 2.1.238 F4y graph — loopback egress proxy that mints
 * Proxy-Authorization for every CONNECT / absolute-form HTTP request.
 *
 * Aliases (SEA → local):
 *   F4y  enableEgressProxyAuth
 *   VtC  createProxyAuthorizationMinter
 *   ZtC  startEgressProxyListener
 *   P4y  parseProxyAuthorizationValue
 *   erC  rewriteProcessProxyEnv
 *   trC  commandEnvWithOriginalProxy
 *   H4y  sessionChildProxyEnvOverlay
 *   $4y  assertOrchestratorProxyAuthUnset
 *   hv   redactEgressProxyText
 *   WAt  ProxyAuthorizationMintError
 *   cMo  ClientGoneError
 *
 * Do not restore process.env on close (SEA only clears GAt/opu).
 * Do not reuse CCR `src/upstreamproxy/` or session `proxyAuthHelper.ts`.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { open as fsOpen } from 'node:fs/promises'
import { connect as netConnect, type Socket } from 'node:net'
import { execa } from 'execa'
import { getCACertificates } from 'src/utils/caCerts.js'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/utils/errors.js'
import { getMTLSConfig } from 'src/utils/mtls.js'
import { configureGlobalAgents } from 'src/utils/proxy.js'
import type {
  ProxyAuthorizationConfig,
  ProxyAuthorizationSource,
} from './rootRunner.js'

// ── densable gMs constants ────────────────────────────────────────────────────

/** densable `NtC` */
export const PROXY_AUTH_COMMAND_TIMEOUT_MS = 30_000
/** densable `ipu` */
export const PROXY_AUTH_VALUE_MAX_BYTES = 16_384
/** densable `FtC` */
const CLIENT_HEAD_TIMEOUT_MS = 30_000
/** densable `$tC` */
const UPSTREAM_CONNECT_TIMEOUT_MS = 30_000
/** densable `tpu` */
const UPSTREAM_HEAD_TIMEOUT_MS = 60_000
/** densable `BtC` */
const SOCKET_DESTROY_DELAY_MS = 2_000
/** densable `I4y` */
const MAX_INTERIM_RESPONSES = 8
/** densable `UtC` */
const CLIENT_HEAD_MAX_BYTES = 8192
/** densable `rpu` */
const UPSTREAM_HEAD_MAX_BYTES = 16_384
/** densable `jtC` */
const MAX_PENDING_CLIENTS = 256
/** densable `ztC` */
const BUFFERED_BODY_MAX_BYTES = 65_536
/** densable `qtC` */
const PROXY_AUTHENTICATE_MAX_BYTES = 4096
/** densable `KtC` */
const TOKEN_REST_MIN = 16
/** densable `HtC` */
export const LOOPBACK_REALM = 'claude-self-hosted-runner'
/** densable `uMo` */
export const PROXY_AUTH_COMMAND_ENV =
  'SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_COMMAND'
/** densable `dMo` */
export const PROXY_AUTH_FILE_ENV = 'SELF_HOSTED_RUNNER_PROXY_AUTHORIZATION_FILE'
/** densable `spu` */
export const PROXY_ENV_KEYS = [
  'https_proxy',
  'HTTPS_PROXY',
  'http_proxy',
  'HTTP_PROXY',
] as const

/** densable `dMs` */
const HOP_PROXY_AUTH_HEADERS = [
  'proxy-authenticate',
  'proxy-authentication-info',
] as const

/** densable `WtC` — RFC 7230 token + colon */
const HEADER_LINE_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+:/

type ProxyEnvKey = (typeof PROXY_ENV_KEYS)[number]

type RewriteState = {
  url: string
  rewritten: string[]
  original: Partial<Record<ProxyEnvKey, string>>
}

type HttpHead = {
  startLine: string
  headerLines: string[]
  rest: Buffer
}

type BufferedClient = {
  gone: () => boolean
  release: () => Buffer
}

export type ProxyAuthorizationMinter = {
  source: ProxyAuthorizationSource['kind']
  mint: (opts?: { challenge?: string }) => Promise<string>
}

export type EgressProxyListener = {
  url: string
  port: number
  openConnections: () => number
  close: () => Promise<void>
}

export type EgressProxyHandle = EgressProxyListener

export type EgressProxyCallbacks = {
  onStatus: (msg: string) => void
  onDebug?: (msg: string) => void
}

/** densable `GAt` */
let rewriteState: RewriteState | undefined
/** densable `opu` */
let activeHandle: EgressProxyHandle | undefined

/** densable `WAt` */
export class ProxyAuthorizationMintError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProxyAuthorizationMintError'
  }
}

/** densable `cMo` */
export class ClientGoneError extends Error {
  constructor() {
    super('client closed before the upstream connection was ready')
    this.name = 'ClientGoneError'
  }
}

/** densable `ce` */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * densable `x0` — promise timeout (same contract as rootRunner.withTimeoutMs).
 * Duplicated here to avoid a runtime cycle with rootRunner.
 */
async function withTimeoutMs<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        reject(new Error(`${label} timed out after ${ms}ms`))
      },
      Math.min(ms, 2_147_483_647),
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    promise.catch(() => {})
  }
}

/** densable `fMs` without a control-char regex (Biome noControlCharactersInRegex). */
function hasAuthControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c <= 8 || (c >= 0x0a && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)) {
      return true
    }
  }
  return false
}

/** densable `cTu` */
function roundtripUtf16(s: string): string {
  return Buffer.from(s, 'utf16le').toString('utf16le')
}

/** densable `wo` */
function truncateChars(s: string, max: number): string {
  if (max <= 0) return ''
  if (s.length <= max) return s
  const sliced = s.slice(0, max)
  const last = sliced.charCodeAt(max - 1)
  return roundtripUtf16(
    last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced,
  )
}

/**
 * densable `hv` — full redactor used by F4y status (rootRunner.redactLogText
 * is a subset: URL userinfo + secret/key/token only).
 */
export function redactEgressProxyText(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]{0,31}:\/\/)[^@/\s]+@/gi, '$1***:***@')
    .replace(
      /((?:secret|key|token|password|credential)[^=:\s]*\s*[=:]\s*)\S+/gi,
      '$1[REDACTED]',
    )
    .replace(/sk-ant-[A-Za-z0-9_.-]+/g, '[REDACTED]')
    .replace(/(Bearer )\S+/gi, '$1[REDACTED]')
    .replace(
      /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
      '[REDACTED-JWT]',
    )
    .replace(
      /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{82,}|gl(?:pat|dt|rt|ft|soat|oas|agent|ptt|cbt|imt|ffct)-[A-Za-z0-9_=-]{20,}(?:\.[0-9a-z]{9})?|xox[a-z]-[A-Za-z0-9+/=%_-]{10,}|xapp-[A-Za-z0-9_-]{10,}|xwfp-[A-Za-z0-9_-]{10,}|[Hh][Oo][Oo][Kk][Ss]\.[Ss][Ll][Aa][Cc][Kk]\.[Cc][Oo][Mm]\/(?:services|workflows|triggers)\/[A-Za-z0-9+/_-]{20,}|sq0(?:atp|csp)-[A-Za-z0-9_-]{22,}|EAAA[A-Za-z0-9+/=%_-]{56,})/g,
      '[REDACTED-PAT]',
    )
    .replace(/(Authorization:\s*Basic\s+)\S+/gi, '$1[REDACTED]')
}

/** densable `qAt` */
function stripCcAndSlice(s: string, max = 200): string {
  return s.replace(/\p{Cc}/gu, '').slice(0, max)
}

/** densable `z7t` */
function latin1Buf(s: string): Buffer {
  return Buffer.from(s, 'latin1')
}

/** densable `P4y` */
export function parseProxyAuthorizationValue(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new ProxyAuthorizationMintError(
      'proxy authorization source returned an empty value',
    )
  }
  if (Buffer.byteLength(trimmed) > PROXY_AUTH_VALUE_MAX_BYTES) {
    throw new ProxyAuthorizationMintError(
      `proxy authorization value exceeds ${PROXY_AUTH_VALUE_MAX_BYTES} bytes`,
    )
  }
  if (hasAuthControlChars(trimmed)) {
    throw new ProxyAuthorizationMintError(
      'proxy authorization value must be a single header line (control characters such as CR/LF are not allowed)',
    )
  }
  return trimmed
}

/** densable `jOe` */
function httpError(status: number, reason: string, body: string): string {
  return (
    `HTTP/1.1 ${status} ${reason}\r\n` +
    'Content-Type: text/plain\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    'Connection: close\r\n' +
    '\r\n' +
    body
  )
}

/** densable `JtC` */
function loopback407(): string {
  return (
    'HTTP/1.1 407 Proxy Authentication Required\r\n' +
    `Proxy-Authenticate: Basic realm="${LOOPBACK_REALM}"\r\n` +
    'Content-Length: 0\r\n' +
    'Connection: close\r\n' +
    '\r\n'
  )
}

/** densable `QtC` — IP/IPv6 literal → no SNI */
function isIpLiteral(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(':')
}

/** densable `GtC` */
function sanitizeProxyAuthenticate(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === '') return undefined
  if (Buffer.byteLength(value, 'latin1') > PROXY_AUTHENTICATE_MAX_BYTES) {
    return undefined
  }
  return hasAuthControlChars(value) ? undefined : value
}

/** densable `uMs` */
function headerValue(lines: string[], name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon > 0 && line.slice(0, colon).trim().toLowerCase() === lower) {
      return line.slice(colon + 1).trim()
    }
  }
  return undefined
}

/** densable `O4y` */
function keepHeaders(lines: string[], names: string[]): string[] {
  const want = new Set(names.map(n => n.toLowerCase()))
  return lines.filter(line => {
    const colon = line.indexOf(':')
    return colon > 0 && want.has(line.slice(0, colon).trim().toLowerCase())
  })
}

/** densable `lMo` */
function dropHeaders(lines: string[], names: string[]): string[] {
  const drop = new Set(names.map(n => n.toLowerCase()))
  return lines.filter(line => {
    const colon = line.indexOf(':')
    return !(colon > 0 && drop.has(line.slice(0, colon).trim().toLowerCase()))
  })
}

/** densable `npu` — minted value reflected in upstream head? */
function headReflectsMinted(head: HttpHead, minted: string): boolean {
  const latin1 = Buffer.from(minted, 'utf8').toString('latin1')
  const needles = [latin1]
  const space = latin1.search(/[ \t]/)
  if (space > 0) {
    const rest = latin1.slice(space).trim()
    if (rest.length >= TOKEN_REST_MIN) needles.push(rest)
  }
  return [head.startLine, ...head.headerLines].some(line =>
    needles.some(n => line.includes(n)),
  )
}

/** densable `TX` */
function endThenDestroy(socket: Socket, payload: string): void {
  if (socket.destroyed) return
  socket.resume()
  if (socket.writable) socket.end(payload)
  setTimeout(s => s.destroy(), SOCKET_DESTROY_DELAY_MS, socket).unref()
}

/** densable `XtC` */
function bufferClient(socket: Socket, initial: Buffer): BufferedClient {
  let gone = false
  const chunks: Buffer[] = initial.length > 0 ? [initial] : []
  let size = initial.length
  const onData = (chunk: Buffer) => {
    chunks.push(chunk)
    size += chunk.length
    if (size > BUFFERED_BODY_MAX_BYTES) socket.pause()
  }
  const onGone = () => {
    gone = true
  }
  socket.on('data', onData)
  socket.once('end', onGone)
  socket.once('close', onGone)
  socket.resume()
  return {
    gone: () => gone || socket.destroyed,
    release: () => {
      socket.removeListener('data', onData)
      const out = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks)
      chunks.length = 0
      size = 0
      return out
    },
  }
}

/** densable `YtC` — forward up to Content-Length bytes; returns unsub */
function forwardContentLength(
  from: Socket,
  to: Socket,
  length: number,
  initial: Buffer,
  onOverrun: () => void,
): () => void {
  let remaining = length
  let warned = false
  const onData = (chunk: Buffer) => {
    if (to.destroyed || !to.writable) return
    if (chunk.length > remaining && !warned) {
      warned = true
      onOverrun()
    }
    if (remaining === 0 || chunk.length === 0) return
    const slice =
      chunk.length <= remaining ? chunk : chunk.subarray(0, remaining)
    remaining -= slice.length
    if (!to.write(slice) && remaining > 0) {
      from.pause()
      to.once('drain', () => from.resume())
    }
  }
  onData(initial)
  from.on('data', onData)
  from.resume()
  return () => {
    from.removeListener('data', onData)
  }
}

/** densable `pMs` */
function readHttpHead(
  socket: Socket,
  maxBytes: number,
  timeoutMs: number,
  initial: Buffer = Buffer.alloc(0),
): Promise<HttpHead> {
  return new Promise((resolve, reject) => {
    let buf = initial
    let settled = false
    let settle: (err: Error | null, head?: HttpHead) => void = () => {}
    const timer = setTimeout(
      (cb: (err: Error) => void) =>
        cb(new Error('timed out waiting for the request/response head')),
      timeoutMs,
      (err: Error) => settle(err),
    )
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      const idx = buf.indexOf('\r\n\r\n')
      if (idx === -1) {
        if (buf.length > maxBytes) {
          settle(new Error('request/response head exceeded the size limit'))
        }
        return
      }
      if (idx > maxBytes) {
        settle(new Error('request/response head exceeded the size limit'))
        return
      }
      const text = buf.subarray(0, idx).toString('latin1')
      const [startLine = '', ...headerLines] = text.split('\r\n')
      settle(null, {
        startLine,
        headerLines,
        rest: buf.subarray(idx + 4),
      })
    }
    const onClose = () =>
      settle(new Error('connection closed before the head was complete'))
    const onError = (err: Error) => settle(err)
    settle = (err, head) => {
      settled = true
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('close', onClose)
      socket.removeListener('error', onError)
      socket.pause()
      if (err) reject(err)
      else resolve(head!)
    }
    socket.on('data', onData)
    socket.once('close', onClose)
    socket.once('error', onError)
    if (buf.length > 0) onData(Buffer.alloc(0))
    if (!settled) socket.resume()
  })
}

type MinterOpts = {
  source: ProxyAuthorizationSource
  upstreamProxyUrl: string
  commandEnv?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv)
  commandTimeoutMs?: number
}

/** densable `VtC` */
export function createProxyAuthorizationMinter(
  opts: MinterOpts,
): ProxyAuthorizationMinter {
  const { source } = opts
  const timeoutMs = opts.commandTimeoutMs ?? PROXY_AUTH_COMMAND_TIMEOUT_MS
  let proxyHost: string | undefined
  try {
    proxyHost = new URL(opts.upstreamProxyUrl).hostname
  } catch {
    proxyHost = undefined
  }
  let stalledRead: Promise<string> | undefined
  const mintOnce = async (challenge?: string): Promise<string> => {
    if (source.kind === 'file') {
      if (stalledRead) {
        throw new ProxyAuthorizationMintError(
          'proxy authorization file could not be read: an earlier read has not returned yet (stalled mount?); not issuing another',
        )
      }
      let settled = false
      const readP = (async () => {
        const fh = await fsOpen(source.path, 'r')
        try {
          const buf = Buffer.alloc(PROXY_AUTH_VALUE_MAX_BYTES + 1)
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
          return buf.subarray(0, bytesRead).toString('utf8')
        } finally {
          await fh.close()
        }
      })()
      const clearIfCurrent = () => {
        settled = true
        if (stalledRead === readP) stalledRead = undefined
      }
      readP.then(clearIfCurrent, clearIfCurrent)
      let raw: string
      try {
        raw = await withTimeoutMs(readP, timeoutMs, 'read')
      } catch (err) {
        if (!settled) stalledRead = readP
        throw new ProxyAuthorizationMintError(
          `proxy authorization file could not be read: ${redactEgressProxyText(errMsg(err))}`,
        )
      }
      return parseProxyAuthorizationValue(raw)
    }
    const env: NodeJS.ProcessEnv = {
      ...(typeof opts.commandEnv === 'function'
        ? opts.commandEnv()
        : (opts.commandEnv ?? process.env)),
      CLAUDE_CODE_PROXY_URL: opts.upstreamProxyUrl,
      ...(proxyHost ? { CLAUDE_CODE_PROXY_HOST: proxyHost } : {}),
      ...(challenge ? { CLAUDE_CODE_PROXY_AUTHENTICATE: challenge } : {}),
    }
    const result = await execa(source.command, {
      timeout: timeoutMs,
      reject: false,
      stdin: 'ignore',
      extendEnv: false,
      env,
      shell: true,
    })
    if (result.failed) {
      const why = result.timedOut
        ? `timed out after ${timeoutMs}ms`
        : `exited ${result.exitCode ?? result.signal ?? 'abnormally'}`
      const stderr = result.stderr?.trim()
      throw new ProxyAuthorizationMintError(
        `proxy authorization command ${why}${
          stderr ? `: ${truncateChars(redactEgressProxyText(stderr), 500)}` : ''
        }`,
      )
    }
    return parseProxyAuthorizationValue(result.stdout ?? '')
  }
  const inFlight = new Map<string, Promise<string>>()
  return {
    source: source.kind,
    mint(remint) {
      const key =
        remint === undefined ? 'plain' : `remint:${remint.challenge ?? ''}`
      let p = inFlight.get(key)
      if (!p) {
        p = mintOnce(remint?.challenge).finally(() => {
          inFlight.delete(key)
        })
        inFlight.set(key, p)
      }
      return p
    },
  }
}

type ListenerOpts = {
  upstreamProxyUrl: string
  minter: ProxyAuthorizationMinter
  upstreamTls?: {
    cert?: string
    key?: string
    passphrase?: string
    ca?: string | string[] | Buffer
  }
  onStatus: (msg: string) => void
  onDebug?: (msg: string) => void
  maxPendingClients?: number
}

/** densable `ZtC` */
export async function startEgressProxyListener(
  opts: ListenerOpts,
): Promise<EgressProxyListener> {
  const upstream = new URL(opts.upstreamProxyUrl)
  const isHttps = upstream.protocol === 'https:'
  if (upstream.protocol !== 'http:' && !isHttps) {
    throw new Error('the upstream proxy URL must be http:// or https://')
  }
  const host = upstream.hostname.replace(/^\[(.*)\]$/, '$1')
  const port = upstream.port ? Number(upstream.port) : isHttps ? 443 : 80
  if (upstream.username || upstream.password) {
    opts.onStatus(
      '[runner:egress-proxy] note: the upstream proxy URL carries user:password credentials; they are replaced by the minted Proxy-Authorization value on every request to the upstream proxy',
    )
  }
  const loopbackSecret = randomBytes(24).toString('base64url')
  const expectedAuth = Buffer.from(
    'Basic ' + Buffer.from(`runner:${loopbackSecret}`).toString('base64'),
  )
  const hasLoopbackCreds = (headerLines: string[]): boolean => {
    const value = headerValue(headerLines, 'proxy-authorization')
    if (value === undefined) return false
    const got = Buffer.from(value)
    return (
      got.length === expectedAuth.length && timingSafeEqual(got, expectedAuth)
    )
  }
  const debug = (msg: string) => opts.onDebug?.(`[runner:egress-proxy] ${msg}`)
  const status = (msg: string) => opts.onStatus(`[runner:egress-proxy] ${msg}`)
  const sockets = new Set<Socket>()
  const track = (socket: Socket) => {
    sockets.add(socket)
    socket.on('error', err => debug(`socket: ${errMsg(err)}`))
    socket.once('close', () => sockets.delete(socket))
  }
  const connectUpstream = (): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const socket: Socket = isHttps
        ? tlsConnect({
            host,
            port,
            servername: isIpLiteral(host) ? undefined : host,
            ...opts.upstreamTls,
          })
        : netConnect({ host, port })
      track(socket)
      const readyEvent = isHttps ? 'secureConnect' : 'connect'
      let settle: (err: Error | null) => void = () => {}
      const timer = setTimeout(
        (cb: (err: Error) => void) =>
          cb(new Error('timed out connecting to the upstream proxy')),
        UPSTREAM_CONNECT_TIMEOUT_MS,
        (err: Error) => settle(err),
      )
      const onReady = () => settle(null)
      const onError = (err: Error) => settle(err)
      const onClose = () =>
        settle(new Error('upstream proxy closed the connection during connect'))
      settle = err => {
        clearTimeout(timer)
        socket.removeListener(readyEvent, onReady)
        socket.removeListener('error', onError)
        socket.removeListener('close', onClose)
        if (err) {
          socket.destroy()
          reject(err)
        } else {
          resolve(socket)
        }
      }
      socket.once(readyEvent, onReady)
      socket.once('error', onError)
      socket.once('close', onClose)
    })
  const pipeBoth = (a: Socket, b: Socket) => {
    a.pipe(b)
    b.pipe(a)
    const boom = () => {
      a.destroy()
      b.destroy()
    }
    a.on('error', boom)
    b.on('error', boom)
    a.on('close', () => endThenDestroy(b, ''))
    b.on('close', () => endThenDestroy(a, ''))
    a.resume()
    b.resume()
  }
  const mintAndConnect = async (
    target: string,
    extraHeaders: string[],
    remint: { challenge?: string } | undefined,
    gone: () => boolean,
  ): Promise<{ up: Socket; head: HttpHead; value: string }> => {
    const value = await opts.minter.mint(remint)
    if (gone()) throw new ClientGoneError()
    const up = await connectUpstream()
    if (gone()) {
      up.destroy()
      throw new ClientGoneError()
    }
    try {
      up.write(
        Buffer.concat([
          latin1Buf(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n`),
          Buffer.from(`Proxy-Authorization: ${value}\r\n`),
          latin1Buf(extraHeaders.map(h => h + '\r\n').join('') + '\r\n'),
        ]),
      )
      const head = await readHttpHead(
        up,
        UPSTREAM_HEAD_MAX_BYTES,
        UPSTREAM_HEAD_TIMEOUT_MS,
      )
      if (gone()) throw new ClientGoneError()
      return { up, head, value }
    } catch (err) {
      up.destroy()
      throw err
    }
  }
  const statusCode = (head: HttpHead): number => {
    const m = head.startLine.match(/^HTTP\/1\.[01]\s+(\d{3})(?=\s|$)/)
    return m ? Number(m[1]) : 0
  }
  const failConnect = (client: Socket, err: unknown, what: string) => {
    if (err instanceof ClientGoneError || client.destroyed) {
      client.destroy()
      return
    }
    const detail =
      err instanceof ProxyAuthorizationMintError
        ? err.message
        : `upstream proxy connection failed: ${redactEgressProxyText(errMsg(err))}`
    status(`${detail} (${stripCcAndSlice(what)} answered 502)`)
    endThenDestroy(
      client,
      httpError(
        502,
        'Bad Gateway',
        err instanceof ProxyAuthorizationMintError
          ? 'proxy authorization could not be obtained (see the runner log)\r\n'
          : 'upstream proxy connection failed (see the runner log)\r\n',
      ),
    )
  }
  const rejectMinted407 = (
    client: Socket,
    up: Socket,
    what: string,
    startLine: string,
  ) => {
    up.destroy()
    status(
      `upstream proxy rejected the minted Proxy-Authorization for ${stripCcAndSlice(what)} (${stripCcAndSlice(startLine)}); answering the client 502`,
    )
    endThenDestroy(
      client,
      httpError(
        502,
        'Bad Gateway',
        'upstream proxy rejected the runner-minted Proxy-Authorization (407); see the runner log\r\n',
      ),
    )
  }
  const withholdReflected = (
    client: Socket,
    up: Socket,
    what: string,
    code: number,
  ) => {
    up.destroy()
    status(
      `upstream response to ${stripCcAndSlice(what)} (status ${code}) reflected the minted Proxy-Authorization in its head; withheld, answering the client 502`,
    )
    endThenDestroy(
      client,
      httpError(
        502,
        'Bad Gateway',
        'upstream proxy response withheld: its head reflected the runner-minted Proxy-Authorization (see the runner log)\r\n',
      ),
    )
  }
  const handleConnect = async (
    client: Socket,
    target: string,
    head: HttpHead,
    buffered: BufferedClient,
  ) => {
    const ua = keepHeaders(head.headerLines, ['user-agent'])
    const gone = () => buffered.gone()
    try {
      let tunnel = await mintAndConnect(target, ua, undefined, gone)
      let code = statusCode(tunnel.head)
      if (code === 407) {
        const challenge = sanitizeProxyAuthenticate(
          headerValue(tunnel.head.headerLines, 'proxy-authenticate'),
        )
        tunnel.up.destroy()
        debug(`upstream answered 407 for CONNECT ${target}; re-minting once`)
        tunnel = await mintAndConnect(target, ua, { challenge }, gone)
        code = statusCode(tunnel.head)
      }
      const { up, head: upHead, value } = tunnel
      if (code !== 200 && headReflectsMinted(upHead, value)) {
        withholdReflected(client, up, `CONNECT ${target}`, code)
        return
      }
      if (code === 407) {
        rejectMinted407(client, up, `CONNECT ${target}`, upHead.startLine)
        return
      }
      if (code < 100) {
        up.destroy()
        status(
          `upstream proxy sent an unparseable reply to CONNECT ${stripCcAndSlice(target)}; answering the client 502`,
        )
        endThenDestroy(
          client,
          httpError(
            502,
            'Bad Gateway',
            'unparseable reply from upstream proxy\r\n',
          ),
        )
        return
      }
      if (code === 200) {
        debug(`tunnel established: CONNECT ${target}`)
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (upHead.rest.length > 0) client.write(upHead.rest)
        const leftover = buffered.release()
        if (leftover.length > 0) up.write(leftover)
        pipeBoth(client, up)
        return
      }
      up.destroy()
      status(
        `upstream proxy refused CONNECT ${stripCcAndSlice(target)}: ${stripCcAndSlice(upHead.startLine)}`,
      )
      const forwarded = dropHeaders(upHead.headerLines, [
        'connection',
        'proxy-connection',
        'keep-alive',
        'transfer-encoding',
        'content-length',
        ...HOP_PROXY_AUTH_HEADERS,
      ])
      endThenDestroy(
        client,
        latin1Buf(
          upHead.startLine +
            '\r\n' +
            forwarded.map(h => h + '\r\n').join('') +
            'Content-Length: 0\r\nConnection: close\r\n\r\n',
        ).toString('latin1'),
      )
    } catch (err) {
      failConnect(client, err, `CONNECT ${target}`)
    }
  }
  const handlePlainHttp = async (
    client: Socket,
    head: HttpHead,
    buffered: BufferedClient,
  ) => {
    const forwardedHeaders = dropHeaders(head.headerLines, [
      'proxy-authorization',
      'proxy-connection',
      'connection',
      'keep-alive',
      'upgrade',
      'te',
      'trailer',
      'max-forwards',
    ])
    const contentLength = Number(
      headerValue(head.headerLines, 'content-length') ?? '0',
    )
    let up: Socket | undefined
    let stopForward: () => void = () => {}
    const abort = () => {
      stopForward()
      up?.destroy()
      client.destroy()
    }
    try {
      {
        const minted = await opts.minter.mint()
        if (buffered.gone()) {
          abort()
          return
        }
        up = await connectUpstream()
        if (buffered.gone()) {
          abort()
          return
        }
        up.write(
          Buffer.concat([
            latin1Buf(
              head.startLine +
                '\r\n' +
                forwardedHeaders.map(h => h + '\r\n').join(''),
            ),
            Buffer.from(`Proxy-Authorization: ${minted}\r\n`),
            latin1Buf('Connection: close\r\n\r\n'),
          ]),
        )
        if (contentLength > 0) {
          stopForward = forwardContentLength(
            client,
            up,
            contentLength,
            buffered.release(),
            () =>
              debug(
                'client sent bytes past its declared Content-Length on a plain HTTP request; not forwarded',
              ),
          )
        }
        let upHead = await readHttpHead(
          up,
          UPSTREAM_HEAD_MAX_BYTES,
          UPSTREAM_HEAD_TIMEOUT_MS,
        )
        let code = statusCode(upHead)
        let interims = 0
        while (code >= 100 && code < 200 && code !== 101) {
          if (buffered.gone()) {
            abort()
            return
          }
          if (headReflectsMinted(upHead, minted)) {
            stopForward()
            withholdReflected(client, up, 'a plain HTTP request', code)
            return
          }
          if (++interims > MAX_INTERIM_RESPONSES) {
            up.destroy()
            stopForward()
            status(
              `upstream sent more than ${MAX_INTERIM_RESPONSES} interim responses to a plain HTTP request; answering the client 502`,
            )
            endThenDestroy(
              client,
              httpError(
                502,
                'Bad Gateway',
                'too many interim responses from upstream\r\n',
              ),
            )
            return
          }
          client.write(
            latin1Buf(
              upHead.startLine +
                '\r\n' +
                dropHeaders(upHead.headerLines, [...HOP_PROXY_AUTH_HEADERS])
                  .map(h => h + '\r\n')
                  .join('') +
                '\r\n',
            ),
          )
          upHead = await readHttpHead(
            up,
            UPSTREAM_HEAD_MAX_BYTES,
            UPSTREAM_HEAD_TIMEOUT_MS,
            upHead.rest,
          )
          code = statusCode(upHead)
        }
        if (buffered.gone()) {
          abort()
          return
        }
        if (headReflectsMinted(upHead, minted)) {
          stopForward()
          withholdReflected(client, up, 'a plain HTTP request', code)
          return
        }
        if (code === 407) {
          stopForward()
          up.destroy()
          status(
            `upstream answered 407 to a plain HTTP request (${stripCcAndSlice(upHead.startLine)}); it may have come from the destination site rather than the proxy, and re-mint is only attempted for CONNECT tunnels; answering the client 502`,
          )
          endThenDestroy(
            client,
            httpError(
              502,
              'Bad Gateway',
              'upstream answered 407 (Proxy Authentication Required) to a plain HTTP request; it may have come from the destination site rather than the proxy; see the runner log\r\n',
            ),
          )
          return
        }
        if (code < 100) {
          up.destroy()
          stopForward()
          status(
            'upstream proxy sent an unparseable reply to a plain HTTP request; answering the client 502',
          )
          endThenDestroy(
            client,
            httpError(
              502,
              'Bad Gateway',
              'unparseable reply from upstream proxy\r\n',
            ),
          )
          return
        }
        if (code >= 400) {
          up.destroy()
          stopForward()
          status(
            `upstream answered ${stripCcAndSlice(upHead.startLine)} to a plain HTTP request; error body withheld from the client`,
          )
          endThenDestroy(
            client,
            latin1Buf(
              upHead.startLine +
                '\r\n' +
                dropHeaders(upHead.headerLines, [
                  'connection',
                  'proxy-connection',
                  'keep-alive',
                  'transfer-encoding',
                  'content-length',
                  ...HOP_PROXY_AUTH_HEADERS,
                ])
                  .map(h => h + '\r\n')
                  .join('') +
                'Content-Length: 0\r\nConnection: close\r\n\r\n',
            ).toString('latin1'),
          )
          return
        }
        client.write(
          latin1Buf(
            upHead.startLine +
              '\r\n' +
              dropHeaders(upHead.headerLines, [
                'connection',
                'proxy-connection',
                'keep-alive',
                ...HOP_PROXY_AUTH_HEADERS,
              ])
                .map(h => h + '\r\n')
                .join('') +
              'Connection: close\r\n\r\n',
          ),
        )
        if (upHead.rest.length > 0) client.write(upHead.rest)
        const upSocket = up
        upSocket.pipe(client)
        upSocket.on('error', () => client.destroy())
        client.on('error', () => upSocket.destroy())
        upSocket.on('close', () => endThenDestroy(client, ''))
        client.on('close', () => upSocket.destroy())
        upSocket.resume()
        client.resume()
      }
    } catch (err) {
      stopForward()
      up?.destroy()
      failConnect(client, err, 'plain HTTP request')
    }
  }

  let pendingHeads = 0
  const maxPending = opts.maxPendingClients ?? MAX_PENDING_CLIENTS
  const server = createServer({ pauseOnConnect: true }, client => {
    track(client)
    client.on('error', () => client.destroy())
    if (pendingHeads >= maxPending) {
      debug('too many connections still sending a request head; refusing one')
      client.destroy()
      return
    }
    pendingHeads++
    void (async () => {
      let head: HttpHead
      try {
        head = await readHttpHead(
          client,
          CLIENT_HEAD_MAX_BYTES,
          CLIENT_HEAD_TIMEOUT_MS,
        )
      } catch (err) {
        debug(`client: ${errMsg(err)}`)
        if (!client.destroyed && client.writable && client.bytesRead > 0) {
          endThenDestroy(
            client,
            httpError(400, 'Bad Request', 'malformed proxy request\r\n'),
          )
        } else {
          client.destroy()
        }
        return
      } finally {
        pendingHeads--
      }
      if (
        hasAuthControlChars(head.startLine) ||
        head.headerLines.some(
          line => hasAuthControlChars(line) || !HEADER_LINE_RE.test(line),
        )
      ) {
        endThenDestroy(
          client,
          httpError(400, 'Bad Request', 'malformed header line\r\n'),
        )
        return
      }
      const connectMatch = head.startLine.match(
        /^CONNECT\s+(\S+)\s+HTTP\/1\.[01]$/i,
      )
      const isAbsoluteForm =
        !connectMatch &&
        /^[A-Z]+\s+http:\/\/\S+\s+HTTP\/1\.[01]$/i.test(head.startLine)
      if (!connectMatch && !isAbsoluteForm) {
        endThenDestroy(
          client,
          httpError(
            400,
            'Bad Request',
            'this is a forward proxy: expected CONNECT host:port or an absolute-form http:// request\r\n',
          ),
        )
        return
      }
      if (!hasLoopbackCreds(head.headerLines)) {
        debug(
          `client ${connectMatch ? 'CONNECT' : 'request'} without valid loopback credentials → 407 challenge`,
        )
        endThenDestroy(client, loopback407())
        return
      }
      if (isAbsoluteForm && /^TRACE\s/i.test(head.startLine)) {
        endThenDestroy(
          client,
          httpError(
            405,
            'Method Not Allowed',
            'TRACE is not forwarded by this proxy\r\n',
          ),
        )
        return
      }
      if (isAbsoluteForm) {
        const cl = keepHeaders(head.headerLines, ['content-length'])
        if (headerValue(head.headerLines, 'transfer-encoding') !== undefined) {
          endThenDestroy(
            client,
            httpError(
              501,
              'Not Implemented',
              'request bodies with Transfer-Encoding are not forwarded by this proxy; send a Content-Length\r\n',
            ),
          )
          return
        }
        if (
          cl.length > 1 ||
          (cl.length === 1 &&
            !/^content-length:[ \t]*\d{1,15}[ \t]*$/i.test(cl[0]!))
        ) {
          endThenDestroy(
            client,
            httpError(
              400,
              'Bad Request',
              'a forwarded request may carry at most one numeric Content-Length\r\n',
            ),
          )
          return
        }
      }
      const buffered = bufferClient(client, head.rest)
      if (connectMatch)
        await handleConnect(client, connectMatch[1]!, head, buffered)
      else await handlePlainHttp(client, head, buffered)
    })().catch(err => {
      status(
        `internal error handling a proxied connection: ${redactEgressProxyText(errMsg(err))}`,
      )
      client.destroy()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  server.on('error', err => status(`listener error: ${errMsg(err)}`))
  const addr = server.address()
  const listenPort = addr && typeof addr === 'object' ? addr.port : 0
  return {
    url: `http://runner:${loopbackSecret}@127.0.0.1:${listenPort}`,
    port: listenPort,
    openConnections: () => sockets.size,
    close: () =>
      new Promise<void>(resolve => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
}

/** densable `erC` */
export function rewriteProcessProxyEnv(
  listenerUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): RewriteState {
  const pairs = PROXY_ENV_KEYS.map(k => [k, env[k]] as const)
  const original: Partial<Record<ProxyEnvKey, string>> = {}
  const rewritten: string[] = []
  for (const [key, value] of pairs) {
    if (value !== undefined) original[key] = value
    if (value) {
      env[key] = listenerUrl
      rewritten.push(key)
    }
  }
  rewriteState = { url: listenerUrl, rewritten, original }
  return rewriteState
}

/** densable `trC` */
export function commandEnvWithOriginalProxy(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!rewriteState) return { ...env }
  const out = { ...env }
  for (const key of PROXY_ENV_KEYS) {
    if (key in rewriteState.original) {
      out[key] = rewriteState.original[key]
    }
  }
  return out
}

/** densable `H4y` */
export function sessionChildProxyEnvOverlay(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!rewriteState) return {}
  const overlay: NodeJS.ProcessEnv = {
    [PROXY_AUTH_COMMAND_ENV]: undefined,
    [PROXY_AUTH_FILE_ENV]: undefined,
    NO_PROXY: env.NO_PROXY,
    no_proxy: env.no_proxy,
    CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER: undefined,
    ALL_PROXY: undefined,
    all_proxy: undefined,
  }
  for (const key of PROXY_ENV_KEYS) {
    overlay[key] = rewriteState.rewritten.includes(key)
      ? rewriteState.url
      : undefined
  }
  return overlay
}

/**
 * densable `$4y` — orchestrator refuses the knob (exit 2 via caller).
 */
export function assertOrchestratorProxyAuthUnset(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const flag =
    argv.find(
      a =>
        a === '--proxy-authorization-command' ||
        a === '--proxy-authorization-file',
    ) ?? [PROXY_AUTH_COMMAND_ENV, PROXY_AUTH_FILE_ENV].find(k => env[k]?.trim())
  if (flag !== undefined) {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      `${flag} is not yet supported with the orchestrator subcommand (only worker runners mint Proxy-Authorization for their egress proxy today). Unset it for the orchestrator process; the runners it spawns can still use it.`,
      'proxy-authorization knob given to the orchestrator subcommand',
    )
  }
}

/** densable `F4y` */
export async function enableEgressProxyAuth(
  config: ProxyAuthorizationConfig,
  callbacks: EgressProxyCallbacks,
): Promise<EgressProxyHandle> {
  const mtls = getMTLSConfig()
  const ca = getCACertificates()
  const minter = createProxyAuthorizationMinter({
    source: config.source,
    upstreamProxyUrl: config.upstreamProxyUrl,
    commandEnv: () => ({
      ...commandEnvWithOriginalProxy(),
      SELF_HOSTED_RUNNER_POOL_SECRET: undefined,
      SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET: undefined,
    }),
  })
  const listener = await startEgressProxyListener({
    upstreamProxyUrl: config.upstreamProxyUrl,
    minter,
    upstreamTls: {
      ...(mtls
        ? { cert: mtls.cert, key: mtls.key, passphrase: mtls.passphrase }
        : {}),
      ...(ca ? { ca } : {}),
    },
    onStatus: callbacks.onStatus,
    onDebug: callbacks.onDebug,
  })
  const rewritten = rewriteProcessProxyEnv(listener.url)
  if (
    new Set(rewritten.rewritten.map(k => rewritten.original[k as ProxyEnvKey]))
      .size > 1
  ) {
    callbacks.onStatus(
      `[runner:egress-proxy] note: ${rewritten.rewritten.join('/')} named different proxies; all of them now go through the listener to ${redactEgressProxyText(config.upstreamProxyUrl)} (the one this runner resolves for its own traffic)`,
    )
  }
  configureGlobalAgents()
  if (process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER) {
    callbacks.onStatus(
      '[runner:egress-proxy] note: CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER is set on the runner; it is cleared for sessions while --proxy-authorization-* is active (the runner now mints Proxy-Authorization for all proxied traffic, and a session-side proxyAuthHelper header would be refused by the loopback listener)',
    )
  }
  callbacks.onStatus(
    `[runner:egress-proxy] enabled: minting Proxy-Authorization from the configured ${config.source.kind} for every CONNECT to the upstream proxy ${redactEgressProxyText(config.upstreamProxyUrl)}; this runner and its sessions now use the loopback listener 127.0.0.1:${listener.port} (rewrote ${rewritten.rewritten.join(', ')})`,
  )
  activeHandle = {
    ...listener,
    close: async () => {
      await listener.close()
      rewriteState = undefined
      activeHandle = undefined
    },
  }
  return activeHandle
}

/** Test helper — does not close a live listener. */
export function _resetEgressProxyAuthForTesting(): void {
  rewriteState = undefined
  activeHandle = undefined
}
