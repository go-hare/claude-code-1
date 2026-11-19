import { createPrivateKey, X509Certificate } from 'crypto'
import type * as https from 'https'
import { Agent as HttpsAgent } from 'https'
import memoize from 'lodash-es/memoize.js'
import * as tls from 'tls'
import type * as undici from 'undici'
import { getCACertificates } from './caCerts.js'
import { logForDebugging } from './debug.js'
import { getFsImplementation } from './fsOperations.js'
import { isEnvTruthy } from './envUtils.js'

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

// Official WKe / GKe file caches (path + content)
let cachedClientCert: MtlsCertFileCacheEntry | null = null
let cachedClientKey: MtlsCertFileCacheEntry | null = null
// Official _4t agent cache (config+ca identity)
let cachedAgentBundle: {
  config: MTLSConfig | undefined
  ca: string | string[] | Buffer | undefined
  agent: HttpsAgent | undefined
} | null = null

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
  return {
    certPath: cachedClientCert?.path,
    keyPath: cachedClientKey?.path,
  }
}

/**
 * Official k5 densable pure resolve — uses WKe/GKe file cache when path
 * matches env; otherwise reloads sync and caches.
 */
export function resolveMTLSConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MTLSConfig | undefined {
  const config: MTLSConfig = {}

  const certPath = env.CLAUDE_CODE_CLIENT_CERT
  if (certPath) {
    if (cachedClientCert?.path !== certPath) {
      cachedClientCert = loadMtlsCertFileSync(
        certPath,
        'client certificate from CLAUDE_CODE_CLIENT_CERT',
      )
    }
    if (cachedClientCert?.path === certPath) {
      config.cert = cachedClientCert.content
    }
  }

  const keyPath = env.CLAUDE_CODE_CLIENT_KEY
  if (keyPath) {
    if (cachedClientKey?.path !== keyPath) {
      cachedClientKey = loadMtlsCertFileSync(
        keyPath,
        'client key from CLAUDE_CODE_CLIENT_KEY',
      )
    }
    if (cachedClientKey?.path === keyPath) {
      config.key = cachedClientKey.content
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

/**
 * Get mTLS configuration from process.env (memoized).
 */
export const getMTLSConfig = memoize((): MTLSConfig | undefined => {
  return resolveMTLSConfigFromEnv(process.env)
})

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
      ? cachedClientCert
      : nextCert
    : null
  const appliedKey = keyPath ? (readFailed ? cachedClientKey : nextKey) : null
  const changed = didMtlsCertCacheChange({
    prevCert: cachedClientCert,
    prevKey: cachedClientKey,
    nextCert: appliedCert,
    nextKey: appliedKey,
  })
  cachedClientCert = appliedCert
  cachedClientKey = appliedKey
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

/**
 * Create an HTTPS agent with mTLS configuration (official Joi densable).
 * Reuses agent when config+ca identity unchanged.
 */
export const getMTLSAgent = memoize((): HttpsAgent | undefined => {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  if (
    cachedAgentBundle &&
    cachedAgentBundle.config === mtlsConfig &&
    cachedAgentBundle.ca === caCerts
  ) {
    return cachedAgentBundle.agent
  }

  if (!mtlsConfig && !caCerts) {
    cachedAgentBundle = { config: mtlsConfig, ca: caCerts, agent: undefined }
    return undefined
  }

  const agentOptions: https.AgentOptions = {
    ...mtlsConfig,
    ...(caCerts && { ca: caCerts }),
    keepAlive: true,
  }

  logForDebugging('mTLS: Creating HTTPS agent with custom certificates')
  const agent = new HttpsAgent(agentOptions)
  cachedAgentBundle = { config: mtlsConfig, ca: caCerts, agent }
  return agent
})

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
  getMTLSConfig.cache.clear?.()
  getMTLSAgent.cache.clear?.()
  cachedAgentBundle = null
  if (opts?.clearFileCache) {
    cachedClientCert = null
    cachedClientKey = null
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

let lastSyncedDefaultCACertList: string[] | undefined

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
}): boolean {
  const caCerts = opts?.caCerts ?? getCACertificates()
  if (caCerts === undefined) return false
  const setter =
    opts?.setDefaultCACertificates ??
    (tls as TlsWithSetDefaultCACertificates).setDefaultCACertificates
  if (typeof setter !== 'function') return false

  const blocks = splitPemCertificateBlocks(caCerts)
  if (blocks.length === 0) return false

  if (trySetDefaultCACertificates(blocks, setter)) {
    lastSyncedDefaultCACertList = blocks
    return true
  }

  const valid = blocks.filter(block =>
    trySetDefaultCACertificates([block], setter),
  )
  const skipped = blocks.length - valid.length
  if (skipped > 0) {
    logForDebugging(
      `CA certs: ${skipped} certificate(s) in the CA list could not be read and are skipped for connections that pass no CA. Check the NODE_EXTRA_CA_CERTS file, or the OS certificate store, for a damaged or cut-off certificate.`,
      { level: 'warn' },
    )
  }
  if (valid.length > 0 && trySetDefaultCACertificates(valid, setter)) {
    lastSyncedDefaultCACertList = valid
    return true
  }
  return false
}

export function getLastSyncedDefaultCACertListForTesting():
  | readonly string[]
  | undefined {
  return lastSyncedDefaultCACertList
}

export const MAX_HELD_SERVED_CERTIFICATES = 8

export type DroppedCrossCertificatePair = {
  cross: X509Certificate
  root: X509Certificate
}

let droppedCrossCertificates: DroppedCrossCertificatePair[] = []
let servedCertificates: X509Certificate[] = []
let servedCrossCertificateSignerMissing = false
let caCertsFromHost = false

function matchesCrossRootPair(
  cert: X509Certificate,
  cross: X509Certificate,
  root: X509Certificate,
): boolean {
  return (
    cert.subject === cross.subject &&
    cert.issuer === root.subject &&
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
  if (caCertsFromHost) return false
  const seen = new Set(servedCertificates.map(c => c.fingerprint256))
  const unmatched = droppedCrossCertificates.filter(
    ({ cross, root }) =>
      !servedCertificates.some(s => matchesCrossRootPair(s, cross, root)),
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
      servedCertificates.length + accepted.length >=
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
  servedCertificates = [...servedCertificates, ...accepted]
  logForDebugging(
    `CA certs: Noted ${accepted.length} certificate(s) that a server sent; they only choose which system cross-certificates stay and are not added to the CA list`,
  )
  return true
}

/** Gold `_ai` @280017478 (#1368). */
export function hasUnmatchedDroppedCrossCertificate(): boolean {
  return (
    !caCertsFromHost &&
    droppedCrossCertificates.some(
      ({ cross, root }) =>
        !servedCertificates.some(s => matchesCrossRootPair(s, cross, root)),
    )
  )
}

/** Gold `F4o` @280017599 (#1368). */
export function getDroppedCrossCertificatesCount(): number {
  return droppedCrossCertificates.length
}

/** Gold `yai` @280017630 (#1368). */
export function isServedCrossCertificateSignerMissing(): boolean {
  return !caCertsFromHost && servedCrossCertificateSignerMissing
}

export function setDroppedCrossCertificatesStateForTesting(state: {
  dropped?: DroppedCrossCertificatePair[]
  served?: X509Certificate[]
  signerMissing?: boolean
  fromHost?: boolean
}): void {
  droppedCrossCertificates = state.dropped ?? []
  servedCertificates = state.served ?? []
  servedCrossCertificateSignerMissing = state.signerMissing ?? false
  caCertsFromHost = state.fromHost ?? false
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
