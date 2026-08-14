import { createPrivateKey, X509Certificate } from 'crypto'
import type * as https from 'https'
import { Agent as HttpsAgent } from 'https'
import memoize from 'lodash-es/memoize.js'
import type * as tls from 'tls'
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
