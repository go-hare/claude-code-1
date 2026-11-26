import { createHash, createPrivateKey, X509Certificate } from 'crypto'
import type * as https from 'https'
import { Agent as HttpsAgent } from 'https'
import * as net from 'net'
import * as tls from 'tls'
import type * as undici from 'undici'
import { clearCACertsCache, getCACertificates } from './caCerts.js'
import { logForDebugging } from './debug.js'
import { getFsImplementation } from './fsOperations.js'
import { isEnvTruthy } from './envUtils.js'
import { isEssentialTrafficOnly } from './privacyLevel.js'
import { getBootstrapSessionHost, HostSlot } from './sessionRoot.js'

export type MTLSConfig = {
  cert?: string
  key?: string
  passphrase?: string
}

export type TLSConfig = MTLSConfig & {
  ca?: string | string[] | Buffer
}

/** Official WKe/GKe densable — cached cert/key file entry. */
export type MtlsCertFileCacheEntry = {
  path: string
  content: string
}

/** densable XEt reload result — used by y3b stale-TLS rotation path. */
export type MtlsClientMaterialReloadResult = {
  changed: boolean
  /** densable `readFailed` — load failed and/or cert/key mid-rotation mismatch. */
  readFailed: boolean
  mismatched: boolean
}

/** densable y3b return — whether a reload was attempted / failure already reported. */
export type MtlsStaleConnectionReloadResult = {
  reportedFailure: boolean
  attempted: boolean
}

/** densable QQc — max cert/key file size (1 MiB). */
export const MTLS_CERT_MAX_BYTES = 1_048_576

/** densable $0o — PEM certificate blocks for pair check. */
const PEM_CERTIFICATE_BLOCK_RE =
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g

type MtlsHttpsAgentFactory = (options: https.AgentOptions) => HttpsAgent

export type DroppedCrossCertificatePair = {
  cross: X509Certificate
  root: X509Certificate
}

type MtlsHostState = {
  // Official WKe / GKe file caches (path + content)
  cachedClientCert: MtlsCertFileCacheEntry | null
  cachedClientKey: MtlsCertFileCacheEntry | null
  // Official _4t agent cache (config+ca identity)
  cachedAgentBundle: {
    config: MTLSConfig | undefined
    ca: string | string[] | Buffer | undefined
    agent: HttpsAgent | undefined
  } | null
  mtlsErrorClosingAgentFactory: MtlsHttpsAgentFactory | null
  mtlsClosesAfterServerError: boolean
  getMTLSConfigCache: Map<unknown, MTLSConfig | undefined>
  getMTLSAgentCache: Map<unknown, HttpsAgent | undefined>
  lastSyncedDefaultCACertList: string[] | undefined
  droppedCrossCertificates: DroppedCrossCertificatePair[]
  servedCertificates: X509Certificate[]
  servedCrossCertificateSignerMissing: boolean
  caCertsFromHost: boolean
}

// Official 2.1.331 [W-051/052]: per-host mTLS & cross-certificate state on SessionHost.
const mtlsHostSlot = new HostSlot<MtlsHostState>(() => ({
  cachedClientCert: null,
  cachedClientKey: null,
  cachedAgentBundle: null,
  mtlsErrorClosingAgentFactory: null,
  mtlsClosesAfterServerError: false,
  getMTLSConfigCache: new Map(),
  getMTLSAgentCache: new Map(),
  lastSyncedDefaultCACertList: undefined,
  droppedCrossCertificates: [],
  servedCertificates: [],
  servedCrossCertificateSignerMissing: false,
  caCertsFromHost: false,
}))

function getMtlsHostState(): MtlsHostState {
  return mtlsHostSlot.of(getBootstrapSessionHost())
}

/**
 * Wire `KeepAliveErrorClosingAgent` construction into `getMTLSAgent()` when
 * `enableClosesAfterServerError()` is active without introducing an ESM cycle
 * between `mtls.ts` and `proxy.ts`.
 */
export function setMtlsErrorClosingAgentFactory(
  factory: MtlsHttpsAgentFactory | null,
  enabled: boolean,
): void {
  const state = getMtlsHostState()
  state.mtlsErrorClosingAgentFactory = factory
  state.mtlsClosesAfterServerError = enabled
  if (state.cachedAgentBundle?.agent) {
    state.cachedAgentBundle.agent.maxFreeSockets = 0
    for (const sockets of Object.values(
      state.cachedAgentBundle.agent.freeSockets,
    )) {
      for (const sock of [...(sockets ?? [])]) {
        sock.destroy()
      }
    }
  }
  getMTLSAgent.cache.clear?.()
  state.cachedAgentBundle = null
}

/**
 * Official densable — detect whether cert/key file cache entries changed.
 */
export function didMtlsCertCacheChange(input: {
  prevCert: MtlsCertFileCacheEntry | null
  prevKey: MtlsCertFileCacheEntry | null
  nextCert: MtlsCertFileCacheEntry | null
  nextKey: MtlsCertFileCacheEntry | null
}): boolean {
  return (
    input.prevCert?.path !== input.nextCert?.path ||
    input.prevCert?.content !== input.nextCert?.content ||
    input.prevKey?.path !== input.nextKey?.path ||
    input.prevKey?.content !== input.nextKey?.content
  )
}

/**
 * densable neu — PEM has a complete BEGIN/END pair (not truncated mid-write).
 */
export function isCompletePemMaterial(content: string): boolean {
  const begin = '-----BEGIN '
  const start = content.lastIndexOf(begin)
  if (start === -1) return false
  const afterBegin = start + begin.length
  const dash = content.indexOf('-----', afterBegin)
  if (dash === -1) return false
  const label = content.slice(afterBegin, dash)
  return content.includes(`-----END ${label}-----`, dash)
}

/**
 * densable oeu — regular file and under size cap.
 */
export function isValidMtlsCertFileStat(
  stat: { isFile(): boolean; size: number },
  label: string,
  maxBytes: number = MTLS_CERT_MAX_BYTES,
  log?: (msg: string, level?: 'error' | 'debug') => void,
): boolean {
  const write =
    log ??
    ((msg: string, level?: 'error' | 'debug') => {
      if (level) logForDebugging(msg, { level })
      else logForDebugging(msg)
    })
  if (!stat.isFile() || stat.size > maxBytes) {
    write(
      `mTLS: Ignoring ${label} — not a regular file or over ${maxBytes} bytes`,
      'error',
    )
    return false
  }
  return true
}

/**
 * densable DDy — true when cert PEM and private key do not form a pair
 * (mid-rotation read). Returns false on key parse failure or matched pair.
 */
export function isMtlsCertKeyMismatched(
  certPem: string,
  keyPem: string,
  passphrase?: string,
): boolean {
  let privateKey: ReturnType<typeof createPrivateKey>
  try {
    privateKey = createPrivateKey({
      key: keyPem,
      ...(passphrase ? { passphrase } : {}),
    })
  } catch {
    return false
  }
  let sawParsedCert = false
  let sawParseError = false
  for (const block of certPem.match(PEM_CERTIFICATE_BLOCK_RE) ?? []) {
    try {
      const cert = new X509Certificate(block)
      if (cert.checkPrivateKey(privateKey)) {
        return false
      }
      sawParsedCert = true
    } catch {
      sawParseError = true
    }
  }
  return sawParsedCert && !sawParseError
}

/**
 * Official zsl densable — sync load cert/key file into cache entry.
 * densable eeu: reject non-file / oversize / incomplete PEM.
 */
export function loadMtlsCertFileSync(
  path: string,
  label: string,
  deps?: {
    readFileSync?: (p: string, opts: { encoding: 'utf8' }) => string
    statSync?: (p: string) => { isFile(): boolean; size: number }
    log?: (msg: string, level?: 'error' | 'debug') => void
  },
): MtlsCertFileCacheEntry | null {
  const read =
    deps?.readFileSync ??
    ((p, opts) => getFsImplementation().readFileSync(p, opts))
  const stat =
    deps?.statSync ??
    ((p: string) =>
      getFsImplementation().statSync(p) as { isFile(): boolean; size: number })
  const log =
    deps?.log ??
    ((msg: string, level?: 'error' | 'debug') => {
      if (level) logForDebugging(msg, { level })
      else logForDebugging(msg)
    })
  try {
    if (!isValidMtlsCertFileStat(stat(path), label, MTLS_CERT_MAX_BYTES, log)) {
      return null
    }
    const content = read(path, { encoding: 'utf8' })
    if (!isCompletePemMaterial(content)) {
      log(`mTLS: Ignoring incomplete ${label} — no PEM block`, 'error')
      return null
    }
    log(`mTLS: Loaded ${label}`)
    return { path, content }
  } catch (error) {
    log(`mTLS: Failed to load ${label}: ${error}`, 'error')
    return null
  }
}

/**
 * Official Ksl densable — async load cert/key file into cache entry.
 * densable teu: reject non-file / oversize / incomplete PEM.
 */
export async function loadMtlsCertFileAsync(
  path: string,
  label: string,
  deps?: {
    readFile?: (p: string, opts: { encoding: 'utf8' }) => Promise<string>
    stat?: (p: string) => Promise<{ isFile(): boolean; size: number }>
    log?: (msg: string, level?: 'error' | 'debug') => void
  },
): Promise<MtlsCertFileCacheEntry | null> {
  const read =
    deps?.readFile ??
    (async (p, opts) => {
      const fs = getFsImplementation()
      if (typeof fs.readFile === 'function') {
        return (await fs.readFile(p, opts)) as string
      }
      return fs.readFileSync(p, opts)
    })
  const stat =
    deps?.stat ??
    (async (p: string) => {
      const fs = getFsImplementation()
      if (typeof fs.stat === 'function') {
        return (await fs.stat(p)) as { isFile(): boolean; size: number }
      }
      return fs.statSync(p) as { isFile(): boolean; size: number }
    })
  const log =
    deps?.log ??
    ((msg: string, level?: 'error' | 'debug') => {
      if (level) logForDebugging(msg, { level })
      else logForDebugging(msg)
    })
  try {
    if (
      !isValidMtlsCertFileStat(
        await stat(path),
        label,
        MTLS_CERT_MAX_BYTES,
        log,
      )
    ) {
      return null
    }
    const content = await read(path, { encoding: 'utf8' })
    if (!isCompletePemMaterial(content)) {
      log(`mTLS: Ignoring incomplete ${label} — no PEM block`, 'error')
      return null
    }
    log(`mTLS: Loaded ${label}`)
    return { path, content }
  } catch (error) {
    log(`mTLS: Failed to load ${label}: ${error}`, 'error')
    return null
  }
}

/**
 * Official Yoi densable — currently loaded cert/key paths from file cache.
 */
export function getLoadedMtlsCertPaths(): {
  certPath: string | undefined
  keyPath: string | undefined
} {
  const state = getMtlsHostState()
  return {
    certPath: state.cachedClientCert?.path,
    keyPath: state.cachedClientKey?.path,
  }
}

/**
 * Official k5 densable pure resolve — uses WKe/GKe file cache when path
 * matches env; otherwise reloads sync and caches.
 */
export function resolveMTLSConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MTLSConfig | undefined {
  const state = getMtlsHostState()
  const config: MTLSConfig = {}

  const certPath = env.CLAUDE_CODE_CLIENT_CERT
  if (certPath) {
    if (state.cachedClientCert?.path !== certPath) {
      state.cachedClientCert = loadMtlsCertFileSync(
        certPath,
        'client certificate from CLAUDE_CODE_CLIENT_CERT',
      )
    }
    if (state.cachedClientCert?.path === certPath) {
      config.cert = state.cachedClientCert.content
    }
  }

  const keyPath = env.CLAUDE_CODE_CLIENT_KEY
  if (keyPath) {
    if (state.cachedClientKey?.path !== keyPath) {
      state.cachedClientKey = loadMtlsCertFileSync(
        keyPath,
        'client key from CLAUDE_CODE_CLIENT_KEY',
      )
    }
    if (state.cachedClientKey?.path === keyPath) {
      config.key = state.cachedClientKey.content
    }
  }

  if (env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE) {
    config.passphrase = env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE
    logForDebugging('mTLS: Using client key passphrase')
  }

  if (Object.keys(config).length === 0) {
    return undefined
  }

  return config
}

function getMTLSConfigImpl(): MTLSConfig | undefined {
  const cache = getMtlsHostState().getMTLSConfigCache
  if (cache.has(undefined)) {
    return cache.get(undefined)
  }
  const result = resolveMTLSConfigFromEnv(process.env)
  cache.set(undefined, result)
  return result
}

Object.defineProperty(getMTLSConfigImpl, 'cache', {
  get: () => getMtlsHostState().getMTLSConfigCache,
  set: (next: Map<unknown, MTLSConfig | undefined>) => {
    getMtlsHostState().getMTLSConfigCache = next
  },
  configurable: true,
  enumerable: true,
})

/**
 * Get mTLS configuration from process.env (memoized per SessionHost).
 */
export const getMTLSConfig = getMTLSConfigImpl as unknown as (() =>
  | MTLSConfig
  | undefined) & {
  cache: Map<unknown, MTLSConfig | undefined>
}

/**
 * densable XEt — async reload client cert/key from env with mid-rotation
 * safety: on load failure or cert/key mismatch keep previous material.
 */
export async function reloadMtlsClientMaterialFromEnvAsync(input?: {
  env?: NodeJS.ProcessEnv
  loadFile?: (
    path: string,
    label: string,
  ) => Promise<MtlsCertFileCacheEntry | null>
  onChanged?: () => void
}): Promise<MtlsClientMaterialReloadResult> {
  const state = getMtlsHostState()
  const env = input?.env ?? process.env
  const load =
    input?.loadFile ?? ((path, label) => loadMtlsCertFileAsync(path, label))
  const certPath = env.CLAUDE_CODE_CLIENT_CERT
  const keyPath = env.CLAUDE_CODE_CLIENT_KEY
  const [nextCert, nextKey] = await Promise.all([
    certPath
      ? load(certPath, 'client certificate from CLAUDE_CODE_CLIENT_CERT')
      : Promise.resolve(null),
    keyPath
      ? load(keyPath, 'client key from CLAUDE_CODE_CLIENT_KEY')
      : Promise.resolve(null),
  ])
  const loadFailed = Boolean((certPath && !nextCert) || (keyPath && !nextKey))
  const mismatched = Boolean(
    !loadFailed &&
      nextCert &&
      nextKey &&
      isMtlsCertKeyMismatched(
        nextCert.content,
        nextKey.content,
        env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE,
      ),
  )
  if (mismatched) {
    logForDebugging(
      'mTLS: Ignoring mismatched client cert/key pair — mid-rotation read',
      { level: 'error' },
    )
  }
  const readFailed = loadFailed || mismatched
  // densable: on fail keep prior cache (lqe/cqe); on success take new material
  const appliedCert = certPath
    ? readFailed
      ? state.cachedClientCert
      : nextCert
    : null
  const appliedKey = keyPath
    ? readFailed
      ? state.cachedClientKey
      : nextKey
    : null
  const changed = didMtlsCertCacheChange({
    prevCert: state.cachedClientCert,
    prevKey: state.cachedClientKey,
    nextCert: appliedCert,
    nextKey: appliedKey,
  })
  state.cachedClientCert = appliedCert
  state.cachedClientKey = appliedKey
  if (changed) {
    clearMTLSCache()
    input?.onChanged?.()
  }
  return { changed, readFailed, mismatched }
}

/**
 * Official b4t densable — async reload cert/key from env; returns whether
 * content/path changed. Prefer `reloadMtlsClientMaterialFromEnvAsync` when
 * mid-rotation mismatch must keep previous material (232 XEt).
 */
export async function reloadMtlsCertsFromEnvAsync(input?: {
  env?: NodeJS.ProcessEnv
  loadFile?: (
    path: string,
    label: string,
  ) => Promise<MtlsCertFileCacheEntry | null>
  onChanged?: () => void
}): Promise<boolean> {
  const result = await reloadMtlsClientMaterialFromEnvAsync(input)
  return result.changed
}

/**
 * densable g3b — TLS/connection errors that may indicate rotated client certs.
 * Extends stale keep-alive codes with EPROTO / FailedToOpenSocket / ERR_OSSL_* / ERR_SSL_*.
 */
export function isMtlsTlsConnectionError(
  error: unknown,
  extractCode: (error: unknown) => string | null,
): boolean {
  const code = extractCode(error)
  if (!code) return false
  if (
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ConnectionClosed' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    code === 'ERR_SOCKET_CLOSED' ||
    code === 'StreamSuspended' ||
    code === 'EPROTO' ||
    code === 'FailedToOpenSocket'
  ) {
    return true
  }
  return code.startsWith('ERR_OSSL_') || code.startsWith('ERR_SSL_')
}

/**
 * densable y3b — on stale TLS connection, reload rotated mTLS client material.
 * Gate: CLAUDE_CODE_CLIENT_CERT set and not CLAUDE_CODE_DISABLE_MTLS_RELOAD_ON_STALE_CONNECTION.
 */
export async function tryReloadMtlsOnStaleTlsConnection(input?: {
  /** densable `e` — report material failure analytics once. */
  reportFailure?: boolean
  env?: NodeJS.ProcessEnv
  reload?: () => Promise<MtlsClientMaterialReloadResult>
  onMaterialChanged?: () => void
  logEventOk?: () => void
  logEventBad?: (code: string) => void
}): Promise<MtlsStaleConnectionReloadResult> {
  const env = input?.env ?? process.env
  if (
    !env.CLAUDE_CODE_CLIENT_CERT ||
    isEnvTruthy(env.CLAUDE_CODE_DISABLE_MTLS_RELOAD_ON_STALE_CONNECTION)
  ) {
    return { reportedFailure: false, attempted: false }
  }
  const reportFailure = input?.reportFailure === true
  try {
    const reload =
      input?.reload ?? (() => reloadMtlsClientMaterialFromEnvAsync({ env }))
    const { changed, readFailed, mismatched } = await reload()
    if (changed) {
      input?.onMaterialChanged?.()
    }
    if (readFailed) {
      if (reportFailure) {
        input?.logEventBad?.(
          mismatched ? 'material_mismatched' : 'material_read_failed',
        )
      }
      return { reportedFailure: reportFailure, attempted: true }
    }
    if (changed) {
      logForDebugging(
        'Stale connection — reloaded rotated mTLS client material',
      )
      input?.logEventOk?.()
    }
    return { reportedFailure: false, attempted: true }
  } catch (err) {
    logForDebugging(
      `mTLS stale-connection reload failed: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'error' },
    )
    if (reportFailure) {
      input?.logEventBad?.('reload_failed')
    }
    return { reportedFailure: reportFailure, attempted: true }
  }
}

function getMTLSAgentImpl(): HttpsAgent | undefined {
  const state = getMtlsHostState()
  const cache = state.getMTLSAgentCache
  if (cache.has(undefined)) {
    return cache.get(undefined)
  }
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  if (
    state.cachedAgentBundle &&
    state.cachedAgentBundle.config === mtlsConfig &&
    state.cachedAgentBundle.ca === caCerts
  ) {
    cache.set(undefined, state.cachedAgentBundle.agent)
    return state.cachedAgentBundle.agent
  }

  if (!mtlsConfig && !caCerts) {
    state.cachedAgentBundle = {
      config: mtlsConfig,
      ca: caCerts,
      agent: undefined,
    }
    cache.set(undefined, undefined)
    return undefined
  }

  const agentOptions: https.AgentOptions = {
    ...mtlsConfig,
    ...(caCerts && { ca: caCerts }),
    keepAlive: true,
  }

  logForDebugging('mTLS: Creating HTTPS agent with custom certificates')
  const agent =
    state.mtlsClosesAfterServerError && state.mtlsErrorClosingAgentFactory
      ? state.mtlsErrorClosingAgentFactory(agentOptions)
      : new HttpsAgent(agentOptions)
  state.cachedAgentBundle = { config: mtlsConfig, ca: caCerts, agent }
  cache.set(undefined, agent)
  return agent
}

Object.defineProperty(getMTLSAgentImpl, 'cache', {
  get: () => getMtlsHostState().getMTLSAgentCache,
  set: (next: Map<unknown, HttpsAgent | undefined>) => {
    getMtlsHostState().getMTLSAgentCache = next
  },
  configurable: true,
  enumerable: true,
})

/**
 * Create an HTTPS agent with mTLS configuration (official Joi densable).
 * Reuses agent when config+ca identity unchanged.
 */
export const getMTLSAgent = getMTLSAgentImpl as unknown as (() =>
  | HttpsAgent
  | undefined) & {
  cache: Map<unknown, HttpsAgent | undefined>
}

/**
 * Get TLS options for WebSocket connections
 */
export function getWebSocketTLSOptions(): tls.ConnectionOptions | undefined {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  if (!mtlsConfig && !caCerts) {
    return undefined
  }

  return {
    ...mtlsConfig,
    ...(caCerts && { ca: caCerts }),
  }
}

/**
 * Get fetch options with TLS configuration (mTLS + CA certs) for undici
 */
export function getTLSFetchOptions(): {
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
} {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  if (!mtlsConfig && !caCerts) {
    return {}
  }

  const tlsConfig: TLSConfig = {
    ...mtlsConfig,
    ...(caCerts && { ca: caCerts }),
  }

  if (typeof Bun !== 'undefined') {
    return { tls: tlsConfig }
  }
  logForDebugging('TLS: Created undici agent with custom certificates')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undiciMod = require('undici') as typeof undici
  const agent = new undiciMod.Agent({
    connect: {
      cert: tlsConfig.cert,
      key: tlsConfig.key,
      passphrase: tlsConfig.passphrase,
      ...(tlsConfig.ca && { ca: tlsConfig.ca }),
    },
    pipelining: 1,
  })

  return { dispatcher: agent }
}

/**
 * Official m0n densable — clear mTLS memo + agent bundle (+ optional file cache).
 */
export function clearMTLSCache(opts?: { clearFileCache?: boolean }): void {
  const state = getMtlsHostState()
  getMTLSConfig.cache.clear?.()
  getMTLSAgent.cache.clear?.()
  state.cachedAgentBundle = null
  if (opts?.clearFileCache) {
    state.cachedClientCert = null
    state.cachedClientKey = null
  }
  logForDebugging('Cleared mTLS configuration cache')
}

/**
 * Test-only densable — reset file + agent caches fully.
 */
export function resetMtlsCachesForTests(): void {
  clearMTLSCache({ clearFileCache: true })
}

/**
 * Configure global Node.js TLS settings
 */
export function configureGlobalMTLS(): void {
  syncDefaultCACertificates()

  const mtlsConfig = getMTLSConfig()

  if (!mtlsConfig) {
    return
  }

  // NODE_EXTRA_CA_CERTS is automatically handled by Node.js at runtime
  if (process.env.NODE_EXTRA_CA_CERTS) {
    logForDebugging(
      'NODE_EXTRA_CA_CERTS detected - Node.js will automatically append to built-in CAs',
    )
  }
}

// ---------------------------------------------------------------------------
// Official 2.1.325 (#1363 & #1368): setDefaultCACertificates & droppedCrossCertificates
// ---------------------------------------------------------------------------

type TlsWithSetDefaultCACertificates = typeof tls & {
  setDefaultCACertificates?: (certs: readonly string[]) => void
}

function trySetDefaultCACertificates(
  certs: readonly string[],
  setter?: (certs: readonly string[]) => void,
): boolean {
  const fn =
    setter ?? (tls as TlsWithSetDefaultCACertificates).setDefaultCACertificates
  if (typeof fn !== 'function') return false
  try {
    fn(certs)
    return true
  } catch {
    return false
  }
}

function splitPemCertificateBlocks(
  pemOrArray: string | readonly string[],
): string[] {
  const items = Array.isArray(pemOrArray) ? pemOrArray : [pemOrArray]
  const blocks: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') continue
    const matches = item.match(PEM_CERTIFICATE_BLOCK_RE)
    if (matches) {
      blocks.push(...matches)
    }
  }
  return blocks
}

/**
 * Gold `ar` @280021524 (#1363) — sync default CA certificates with
 * `tls.setDefaultCACertificates`, filtering out damaged/unparseable blocks
 * individually when the batch call throws.
 */
export function syncDefaultCACertificates(opts?: {
  caCerts?: string | string[]
  setDefaultCACertificates?: (certs: readonly string[]) => void
  env?: NodeJS.ProcessEnv
}): boolean {
  const caCerts = opts?.caCerts ?? getCACertificates()
  if (caCerts === undefined) return false
  const setter =
    opts?.setDefaultCACertificates ??
    (tls as TlsWithSetDefaultCACertificates).setDefaultCACertificates
  if (typeof setter !== 'function') return false

  const blocks = splitPemCertificateBlocks(caCerts)
  if (blocks.length === 0) return false

  // Official `P0` (`chunk@284851610.js @193668`): probe cross-signed root pairs
  // during CA bundle initialization so `droppedCrossCertificates` is populated
  // in production, and omit unmatched conflicting cross-certs until a server
  // chain selects them via `noteServerServedCertificates`.
  const parsedEntries: Array<{ pem: string; cert?: X509Certificate }> =
    blocks.map(pem => {
      try {
        return { pem, cert: new X509Certificate(pem) }
      } catch {
        return { pem }
      }
    })
  const parsedCerts = parsedEntries
    .map(e => e.cert)
    .filter((c): c is X509Certificate => c !== undefined)
  const state = getMtlsHostState()
  const env = opts?.env ?? process.env
  const allCrossPairs = probeCrossSignedRootPairs(parsedCerts, env)
  if (allCrossPairs.length > 0) {
    state.servedCertificates = state.servedCertificates.filter(s =>
      allCrossPairs.some(({ cross, root }) =>
        matchesCrossRootPair(s, cross, root),
      ),
    )
    const unmatchedPairs = allCrossPairs.filter(
      ({ cross, root }) =>
        !state.servedCertificates.some(s =>
          matchesCrossRootPair(s, cross, root),
        ),
    )
    state.droppedCrossCertificates = unmatchedPairs
    const unsignedPairs = allCrossPairs.filter(
      ({ cross }) =>
        !parsedCerts.some(c => c !== cross && c.subject === cross.issuer),
    )
    state.servedCrossCertificateSignerMissing = state.servedCertificates.some(
      s =>
        unsignedPairs.some(({ cross, root }) =>
          matchesCrossRootPair(s, cross, root),
        ),
    )
    if (state.servedCrossCertificateSignerMissing) {
      logForDebugging(
        'CA certs: A certificate that a server sent names a cross-certificate this list cut, and no certificate in the store issued that cross-certificate: a certificate error will say that its root is missing',
      )
    }
  } else {
    state.droppedCrossCertificates = []
    state.servedCrossCertificateSignerMissing = false
  }

  const droppedCrossCertSet = new Set(
    state.droppedCrossCertificates.map(p => p.cross),
  )
  const effectiveBlocks =
    droppedCrossCertSet.size > 0
      ? parsedEntries
          .filter(e => !e.cert || !droppedCrossCertSet.has(e.cert))
          .map(e => e.pem)
      : blocks

  if (effectiveBlocks.length === 0) return false

  if (trySetDefaultCACertificates(effectiveBlocks, setter)) {
    state.lastSyncedDefaultCACertList = effectiveBlocks
    return true
  }

  const valid = effectiveBlocks.filter(block =>
    trySetDefaultCACertificates([block], setter),
  )
  const skipped = effectiveBlocks.length - valid.length
  if (skipped > 0) {
    logForDebugging(
      `CA certs: ${skipped} certificate(s) in the CA list could not be read and are skipped for connections that pass no CA. Check the NODE_EXTRA_CA_CERTS file, or the OS certificate store, for a damaged or cut-off certificate.`,
      { level: 'warn' },
    )
  }
  if (valid.length > 0 && trySetDefaultCACertificates(valid, setter)) {
    state.lastSyncedDefaultCACertList = valid
    return true
  }
  return false
}

export function getLastSyncedDefaultCACertListForTesting():
  | readonly string[]
  | undefined {
  return getMtlsHostState().lastSyncedDefaultCACertList
}

export const MAX_HELD_SERVED_CERTIFICATES = 8

function matchesCrossRootPair(
  cert: X509Certificate,
  cross: X509Certificate,
  root: X509Certificate,
): boolean {
  // Official `Bt(e, r, n)` (`chunk@284851610.js`): server-served cert issued by
  // `cross` (distinct from self-signed `root`) and verified by `cross.publicKey`.
  try {
    if (
      cert.issuer === cross.subject &&
      cert.checkIssued(cross) &&
      !cert.checkIssued(root) &&
      cert.verify(cross.publicKey)
    ) {
      return true
    }
  } catch {
    // Fall through to direct cross-certificate match.
  }
  return (
    cert.subject === cross.subject &&
    (cert.issuer === cross.issuer || cert.issuer === root.subject) &&
    cert.publicKey.equals(cross.publicKey)
  )
}

/**
 * Gold `gai` @280016750 (#1368) — record server-sent certificates so they can
 * select among dropped cross-certificates without being added to the CA list.
 */
export function noteServerServedCertificates(
  certs: readonly X509Certificate[],
  nowMs: number = Date.now(),
): boolean {
  const state = getMtlsHostState()
  if (state.caCertsFromHost) return false
  const seen = new Set(state.servedCertificates.map(c => c.fingerprint256))
  const unmatched = state.droppedCrossCertificates.filter(
    ({ cross, root }) =>
      !state.servedCertificates.some(s => matchesCrossRootPair(s, cross, root)),
  )
  const accepted: X509Certificate[] = []
  let ignored = 0
  for (const cert of certs) {
    const idx = unmatched.findIndex(
      ({ cross, root }) =>
        !seen.has(cert.fingerprint256) &&
        !(new Date(cert.validFrom).getTime() > nowMs) &&
        new Date(cert.validTo).getTime() > nowMs &&
        matchesCrossRootPair(cert, cross, root),
    )
    if (idx === -1) continue
    if (
      state.servedCertificates.length + accepted.length >=
      MAX_HELD_SERVED_CERTIFICATES
    ) {
      ignored++
      continue
    }
    unmatched.splice(idx, 1)
    seen.add(cert.fingerprint256)
    accepted.push(cert)
  }
  if (ignored > 0) {
    logForDebugging(
      `CA certs: Ignored ${ignored} more certificate(s) that a server sent: ${MAX_HELD_SERVED_CERTIFICATES} are already held to choose among the system store's cross-certificates`,
    )
  }
  if (accepted.length === 0) return false
  state.servedCertificates = [...state.servedCertificates, ...accepted]
  logForDebugging(
    `CA certs: Noted ${accepted.length} certificate(s) that a server sent; they only choose which system cross-certificates stay and are not added to the CA list`,
  )
  // Official `RFi` -> `Hr(r)` (`chunk@284851610.js @195050`): clear CA certs
  // cache immediately when a dropped cross-certificate is restored.
  clearCACertsCache()
  return true
}

/** Gold `_ai` @280017478 (#1368). */
export function hasUnmatchedDroppedCrossCertificate(): boolean {
  const state = getMtlsHostState()
  return (
    !state.caCertsFromHost &&
    state.droppedCrossCertificates.some(
      ({ cross, root }) =>
        !state.servedCertificates.some(s =>
          matchesCrossRootPair(s, cross, root),
        ),
    )
  )
}

/** Gold `F4o` @280017599 (#1368). */
export function getDroppedCrossCertificatesCount(): number {
  return getMtlsHostState().droppedCrossCertificates.length
}

/** Gold `yai` @280017630 (#1368). */
export function isServedCrossCertificateSignerMissing(): boolean {
  const state = getMtlsHostState()
  return !state.caCertsFromHost && state.servedCrossCertificateSignerMissing
}

export function setDroppedCrossCertificatesStateForTesting(state: {
  dropped?: DroppedCrossCertificatePair[]
  served?: X509Certificate[]
  signerMissing?: boolean
  fromHost?: boolean
}): void {
  const hostState = getMtlsHostState()
  hostState.droppedCrossCertificates = state.dropped ?? []
  hostState.servedCertificates = state.served ?? []
  hostState.servedCrossCertificateSignerMissing = state.signerMissing ?? false
  hostState.caCertsFromHost = state.fromHost ?? false
}

/**
 * Extract the peer X509 certificate chain from a TLS socket.
 */
export function extractPeerCertificateChain(
  socket: Pick<tls.TLSSocket, 'getPeerCertificate'>,
): X509Certificate[] {
  const chain: X509Certificate[] = []
  const seen = new Set<string>()
  let current = socket.getPeerCertificate(true) as
    | (tls.DetailedPeerCertificate & { raw?: Buffer })
    | undefined
  while (current && current.raw && Buffer.isBuffer(current.raw)) {
    const key = current.fingerprint256 || current.raw.toString('hex')
    if (seen.has(key)) break
    seen.add(key)
    try {
      chain.push(new X509Certificate(current.raw))
    } catch {
      // Ignore malformed certificate entries
    }
    const next = current.issuerCertificate as
      | (tls.DetailedPeerCertificate & { raw?: Buffer })
      | undefined
    if (!next || next === current) break
    current = next
  }
  return chain
}

/**
 * TLS handshake callback (#1368): note server-served certificates so matching
 * dropped cross-certificates can be re-enabled and default CA certs re-synced.
 */
export function handleTlsHandshakeServerCertificates(
  socket: Pick<tls.TLSSocket, 'getPeerCertificate'>,
  nowMs: number = Date.now(),
): boolean {
  const chain = extractPeerCertificateChain(socket)
  if (chain.length === 0) return false
  const noted = noteServerServedCertificates(chain, nowMs)
  if (noted) {
    clearMTLSCache()
    syncDefaultCACertificates()
  }
  return noted
}

/**
 * Attach a `secureConnect` listener to a TLS socket to record server-served
 * certificates for cross-signed root disambiguation.
 */
export function attachTlsHandshakeCrossCertHook(socket: tls.TLSSocket): void {
  socket.once('secureConnect', () => {
    handleTlsHandshakeServerCertificates(socket)
  })
}

/**
 * Probe a list of CA certificates for self-named / cross-signed root pairs
 * (respecting `CLAUDE_CODE_DISABLE_LOOPED_CROSS_CERT_DROP` and
 * `CLAUDE_CODE_DISABLE_SELF_NAMED_CERT_DROP`).
 */
export function probeCrossSignedRootPairs(
  certs: readonly X509Certificate[],
  env: NodeJS.ProcessEnv = process.env,
): DroppedCrossCertificatePair[] {
  if (
    isEnvTruthy(env.CLAUDE_CODE_DISABLE_LOOPED_CROSS_CERT_DROP) ||
    isEnvTruthy(env.CLAUDE_CODE_DISABLE_SELF_NAMED_CERT_DROP)
  ) {
    return []
  }
  const bySubject = new Map<string, X509Certificate[]>()
  for (const cert of certs) {
    const list = bySubject.get(cert.subject) ?? []
    list.push(cert)
    bySubject.set(cert.subject, list)
  }
  const pairs: DroppedCrossCertificatePair[] = []
  for (const cert of certs) {
    if (cert.subject === cert.issuer) continue
    const sameSubjectRoots = bySubject.get(cert.subject) ?? []
    for (const root of sameSubjectRoots) {
      if (
        root !== cert &&
        root.subject === root.issuer &&
        cert.publicKey.equals(root.publicKey)
      ) {
        pairs.push({ cross: cert, root })
      }
    }
  }
  return pairs
}

// ---------------------------------------------------------------------------
// Official 2.1.321 (#1931): precomputed root cert SHA-256 table (`knownHashes` / `knownRootOf`)
// Skips per-cert X509Certificate parsing for known bundled/system root PEMs.
// ---------------------------------------------------------------------------

const PEM_CERT_BODY_RE =
  /^-----BEGIN CERTIFICATE-----\r?\n([\s\S]+?)\r?\n-----END CERTIFICATE-----\r?\n?$/

export type KnownRootCertEntry = {
  hashes: {
    certificate: string
    key: string
    keyReadThrew: boolean
  }
  expires: number
}

export class KnownRootCertTable {
  readonly ofBlock = new Map<string, KnownRootCertEntry | undefined>()
  readonly ofBundledRoot = new Map<string, string>()
  private readonly byPem = new Map<string, KnownRootCertEntry | undefined>()
  private readonly knownBySha256 = new Map<
    string,
    { key: string; expires: number }
  >()

  registerKnownRoots(pems: readonly string[]): void {
    for (const pem of pems) {
      if (this.byPem.has(pem)) continue
      this.byPem.set(pem, undefined)
      if (pem.length > 65536) continue
      const b64 = PEM_CERT_BODY_RE.exec(pem)?.[1]?.replace(/[\r\n]/g, '')
      if (!b64) continue
      const der = Buffer.from(b64, 'base64')
      if (der.toString('base64') !== b64) continue
      try {
        const certHash = createHash('sha256').update(der).digest('hex')
        let known = this.knownBySha256.get(certHash)
        if (!known) {
          const parsed = new X509Certificate(der)
          const keyDer = parsed.publicKey.export({
            type: 'spki',
            format: 'der',
          })
          const keyHash = createHash('sha256').update(keyDer).digest('hex')
          const expires = new Date(parsed.validTo).getTime()
          known = {
            key: keyHash,
            expires: Number.isNaN(expires) ? Number.POSITIVE_INFINITY : expires,
          }
          this.knownBySha256.set(certHash, known)
        }
        this.byPem.set(pem, {
          hashes: {
            certificate: certHash,
            key: known.key,
            keyReadThrew: false,
          },
          expires: known.expires,
        })
      } catch {
        // Leave undefined so caller falls back to direct X509Certificate parsing
      }
    }
  }

  /**
   * Look up a PEM certificate in the precomputed SHA-256 table.
   * For certificates not yet indexed by exact PEM string, hashes raw DER
   * bytes directly without constructing `X509Certificate`.
   */
  knownRootOf(pem: string): KnownRootCertEntry | undefined {
    if (this.byPem.has(pem)) {
      return this.byPem.get(pem)
    }
    if (pem.length > 65536) {
      this.byPem.set(pem, undefined)
      return undefined
    }
    const b64 = PEM_CERT_BODY_RE.exec(pem)?.[1]?.replace(/[\r\n]/g, '')
    if (!b64) {
      this.byPem.set(pem, undefined)
      return undefined
    }
    const der = Buffer.from(b64, 'base64')
    if (der.toString('base64') !== b64) {
      this.byPem.set(pem, undefined)
      return undefined
    }
    const certHash = createHash('sha256').update(der).digest('hex')
    const known = this.knownBySha256.get(certHash)
    if (!known) {
      this.byPem.set(pem, undefined)
      return undefined
    }
    const entry: KnownRootCertEntry = {
      hashes: { certificate: certHash, key: known.key, keyReadThrew: false },
      expires: known.expires,
    }
    this.byPem.set(pem, entry)
    return entry
  }

  readBundledRoots(): readonly string[] {
    const roots = tls.rootCertificates
    this.registerKnownRoots(roots)
    return roots
  }

  readSystemStore(): string[] | undefined {
    const getCACerts = (
      tls as typeof tls & { getCACertificates?: (type: string) => string[] }
    ).getCACertificates
    const system = getCACerts?.('system')
    if (system) {
      for (const pem of system) {
        this.knownRootOf(pem)
      }
    }
    return system
  }

  clear(): void {
    this.byPem.clear()
    this.ofBlock.clear()
    this.ofBundledRoot.clear()
    this.knownBySha256.clear()
  }
}

const knownHashesByHost = new HostSlot<KnownRootCertTable>(
  () => new KnownRootCertTable(),
)

function getKnownHashesTable(): KnownRootCertTable {
  return knownHashesByHost.of(getBootstrapSessionHost())
}

export const knownHashes: KnownRootCertTable = new Proxy(
  new KnownRootCertTable(),
  {
    get(_target, prop) {
      const table = getKnownHashesTable()
      const value = Reflect.get(table, prop, table)
      return typeof value === 'function' ? value.bind(table) : value
    },
    set(_target, prop, value) {
      const table = getKnownHashesTable()
      return Reflect.set(table, prop, value, table)
    },
  },
)

export function knownRootOf(pem: string): KnownRootCertEntry | undefined {
  return getKnownHashesTable().knownRootOf(pem)
}

// ---------------------------------------------------------------------------
// Official 2.1.319 (#1784 & #1817): `api_served_chain_read` TLS handshake
// automatic certificate repair (even when CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
// is set after a model request failure; skips when only ALL_PROXY is set).
// ---------------------------------------------------------------------------

export type ApiServedChainReadOutcome =
  | 'restored'
  | 'nothing'
  | 'unread'
  | 'proxy_variable_unusable'
  | 'proxy_not_supported'
  | 'skipped'

const API_SERVED_CHAIN_READ_TIMEOUT_MS = 5_000
const TLS_CERT_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_UNTRUSTED',
])

export function isTlsCertificateVerificationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as {
    code?: unknown
    cause?: { code?: unknown }
    message?: unknown
  }
  const code =
    typeof err.code === 'string'
      ? err.code
      : typeof err.cause?.code === 'string'
        ? err.cause.code
        : undefined
  if (code && TLS_CERT_ERROR_CODES.has(code)) return true
  const msg = typeof err.message === 'string' ? err.message : ''
  return /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|SELF_SIGNED_CERT_IN_CHAIN|CERT_UNTRUSTED|unable to verify the first certificate|unable to get local issuer certificate/i.test(
    msg,
  )
}

/**
 * Official 2.1.319 (#1817): check proxy env vars for `api_served_chain_read`.
 * Only `HTTPS_PROXY` / `https_proxy` is usable for automatic cert repair;
 * when `ALL_PROXY` / `all_proxy` (or `HTTP_PROXY` only) is the only proxy var
 * set, skip auto-repair and instruct the user to set `HTTPS_PROXY`.
 */
export function resolveCertRepairProxyUrl(
  targetUrl: string,
  env: NodeJS.ProcessEnv = process.env,
):
  | { kind: 'direct' }
  | { kind: 'proxy'; url: URL }
  | { kind: 'unusable' }
  | { kind: 'unsupported' } {
  const httpsProxy = env.https_proxy || env.HTTPS_PROXY
  const anyOtherProxy = Boolean(
    env.http_proxy || env.HTTP_PROXY || env.ALL_PROXY || env.all_proxy,
  )
  if (!httpsProxy) {
    if (anyOtherProxy) {
      return { kind: 'unusable' }
    }
    return { kind: 'direct' }
  }
  try {
    // Respect NO_PROXY if set
    const { shouldBypassProxy } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./proxy.js') as typeof import('./proxy.js')
    if (shouldBypassProxy(targetUrl)) {
      return { kind: 'direct' }
    }
  } catch {
    // ignore proxy bypass lookup errors
  }
  let parsed: URL
  try {
    parsed = new URL(httpsProxy)
  } catch {
    return { kind: 'unusable' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'unsupported' }
  }
  return { kind: 'proxy', url: parsed }
}

const MAX_PROXY_CONNECT_HEADER_BYTES = 16_384

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function openProxyConnectTunnel(
  proxyUrl: URL,
  targetHost: string,
  targetPort: number,
  signal: AbortSignal,
): Promise<net.Socket | null> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve(null)
      return
    }
    const proxyHost = proxyUrl.hostname.replace(/^\[|\]$/g, '')
    const isHttpsProxy = proxyUrl.protocol === 'https:'
    const proxyPort = Number(proxyUrl.port) || (isHttpsProxy ? 443 : 80)
    const authority = targetHost.includes(':')
      ? `[${targetHost}]:${targetPort}`
      : `${targetHost}:${targetPort}`

    const socket: net.Socket = isHttpsProxy
      ? tls.connect({
          host: proxyHost,
          port: proxyPort,
          servername: proxyHost,
        })
      : net.connect({ host: proxyHost, port: proxyPort })
    if (isHttpsProxy) {
      attachTlsHandshakeCrossCertHook(socket as tls.TLSSocket)
    }

    let settled = false
    let buffered = Buffer.alloc(0)

    const detachListeners = () => {
      signal.removeEventListener('abort', onAbort)
      socket.removeListener('connect', onConnect)
      socket.removeListener('secureConnect', onConnect)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.removeListener('close', onClose)
      socket.removeListener('end', onClose)
    }

    const fail = () => {
      if (settled) return
      settled = true
      detachListeners()
      try {
        socket.destroy()
      } catch {
        // ignore
      }
      resolve(null)
    }

    const onAbort = () => fail()
    const onError = () => fail()
    const onClose = () => fail()

    const onConnect = () => {
      const headers = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`]
      if (proxyUrl.username || proxyUrl.password) {
        const user = safeDecodeUriComponent(proxyUrl.username)
        const pass = safeDecodeUriComponent(proxyUrl.password)
        const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')
        headers.push(`Proxy-Authorization: Basic ${token}`)
      }
      // Official 2.1.331 CONNECT request injection guard: reject whitespace in
      // target or CR/LF/NUL in target or any CONNECT header.
      if (/\s/.test(authority) || headers.some(line => /[\0\r\n]/.test(line))) {
        fail()
        return
      }
      headers.push('', '')
      socket.write(headers.join('\r\n'))
    }

    const onData = (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      buffered = Buffer.concat([buffered, buf])
      const headerEnd = buffered.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        if (buffered.length - 3 > MAX_PROXY_CONNECT_HEADER_BYTES) {
          fail()
        }
        return
      }
      if (headerEnd > MAX_PROXY_CONNECT_HEADER_BYTES) {
        fail()
        return
      }
      const [statusLine = '', ...headerLines] = buffered
        .subarray(0, headerEnd)
        .toString('ascii')
        .split('\r\n')
      if (
        !/^HTTP\/1\.[01]\s+200(?:\s|$)/i.test(statusLine) ||
        headerLines.filter(Boolean).some(line => line.indexOf(':') < 0)
      ) {
        fail()
        return
      }
      if (settled) return
      settled = true
      detachListeners()
      const remainder = buffered.subarray(headerEnd + 4)
      if (remainder.length > 0) {
        socket.unshift(remainder)
      }
      resolve(socket)
    }

    signal.addEventListener('abort', onAbort, { once: true })
    if (isHttpsProxy) {
      socket.once('secureConnect', onConnect)
    } else {
      socket.once('connect', onConnect)
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
    socket.once('end', onClose)
  })
}

export async function readPeerChainViaTlsHandshake(
  host: string,
  port: number,
  signal: AbortSignal,
  proxyUrl?: URL,
): Promise<X509Certificate[] | null> {
  if (signal.aborted) {
    return null
  }
  let tunnelSocket: net.Socket | undefined
  if (proxyUrl) {
    const opened = await openProxyConnectTunnel(proxyUrl, host, port, signal)
    if (!opened || signal.aborted) {
      try {
        opened?.destroy()
      } catch {
        // ignore
      }
      return null
    }
    tunnelSocket = opened
  }

  return new Promise(resolve => {
    if (signal.aborted) {
      try {
        tunnelSocket?.destroy()
      } catch {
        // ignore
      }
      resolve(null)
      return
    }
    let settled = false
    const sniOpt = net.isIP(host) === 0 ? { servername: host } : {}
    const socket = tunnelSocket
      ? tls.connect({
          socket: tunnelSocket,
          ...sniOpt,
          rejectUnauthorized: false,
        })
      : tls.connect({
          host,
          port,
          ...sniOpt,
          rejectUnauthorized: false,
        })

    const finish = (val: X509Certificate[] | null) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      try {
        socket.destroy()
      } catch {
        // ignore
      }
      try {
        tunnelSocket?.destroy()
      } catch {
        // ignore
      }
      resolve(val)
    }

    const onAbort = () => finish(null)
    signal.addEventListener('abort', onAbort, { once: true })
    socket.once('secureConnect', () => {
      finish(extractPeerCertificateChain(socket))
    })
    socket.once('error', () => finish(null))
    socket.once('close', () => finish(null))
    tunnelSocket?.once('error', () => finish(null))
  })
}

/**
 * Official 2.1.319 `DBo` / `QL` (#1784 & #1817):
 * Perform a TLS handshake (no HTTP/API request) to the configured API host
 * after a certificate error to capture the server-presented chain and restore
 * any dropped cross-certificate. Runs even when
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set if `afterModelRequest`
 * is true; skips when only `ALL_PROXY` is set.
 */
export async function readApiServedCertificateChain(
  targetUrl: string | undefined,
  opts: {
    signal?: AbortSignal
    afterModelRequest?: boolean
    env?: NodeJS.ProcessEnv
    handshakeFn?: (
      host: string,
      port: number,
      signal: AbortSignal,
      proxyUrl?: URL,
    ) => Promise<X509Certificate[] | null>
  } = {},
): Promise<ApiServedChainReadOutcome> {
  const env = opts.env ?? process.env
  if (
    !targetUrl ||
    opts.signal?.aborted ||
    (isEssentialTrafficOnly() && !opts.afterModelRequest) ||
    env.ANTHROPIC_UNIX_SOCKET
  ) {
    return 'skipped'
  }
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return 'skipped'
  }
  if (parsed.protocol !== 'https:') {
    return 'skipped'
  }

  const proxyCheck = resolveCertRepairProxyUrl(targetUrl, env)
  if (proxyCheck.kind === 'unusable') {
    logForDebugging(
      "CA certs: Not reading the server's certificates: a proxy variable is set, but none that the read can use. Set https_proxy, which is read first, to a complete http:// or https:// URL, or try adding the cross-certificate to the NODE_EXTRA_CA_CERTS file",
    )
    return 'proxy_variable_unusable'
  }
  if (proxyCheck.kind === 'unsupported') {
    logForDebugging(
      "CA certs: Not reading the server's certificates through a proxy that is neither http:// nor https://. Try adding the cross-certificate to the NODE_EXTRA_CA_CERTS file",
    )
    return 'proxy_not_supported'
  }

  const timeoutSignal = AbortSignal.timeout(API_SERVED_CHAIN_READ_TIMEOUT_MS)
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, timeoutSignal])
    : timeoutSignal
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  const port = Number(parsed.port) || 443
  const proxyUrl = proxyCheck.kind === 'proxy' ? proxyCheck.url : undefined
  const handshake = opts.handshakeFn ?? readPeerChainViaTlsHandshake
  const certs = await handshake(host, port, signal, proxyUrl)
  if (!certs || signal.aborted) {
    return 'unread'
  }
  if (certs.length === 0) {
    return 'nothing'
  }
  const noted = noteServerServedCertificates(certs)
  if (!noted) {
    return 'nothing'
  }
  clearCACertsCache()
  clearMTLSCache()
  syncDefaultCACertificates()
  return 'restored'
}
