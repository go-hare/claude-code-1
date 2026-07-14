import type * as https from 'https'
import { Agent as HttpsAgent } from 'https'
import memoize from 'lodash-es/memoize.js'
import type * as tls from 'tls'
import type * as undici from 'undici'
import { getCACertificates } from './caCerts.js'
import { logForDebugging } from './debug.js'
import { getFsImplementation } from './fsOperations.js'

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
 * Official zsl densable — sync load cert/key file into cache entry.
 */
export function loadMtlsCertFileSync(
  path: string,
  label: string,
  deps?: {
    readFileSync?: (p: string, opts: { encoding: 'utf8' }) => string
    log?: (msg: string, level?: 'error' | 'debug') => void
  },
): MtlsCertFileCacheEntry | null {
  const read =
    deps?.readFileSync ??
    ((p, opts) => getFsImplementation().readFileSync(p, opts))
  const log =
    deps?.log ??
    ((msg: string, level?: 'error' | 'debug') => {
      if (level) logForDebugging(msg, { level })
      else logForDebugging(msg)
    })
  try {
    const content = read(path, { encoding: 'utf8' })
    log(`mTLS: Loaded ${label}`)
    return { path, content }
  } catch (error) {
    log(`mTLS: Failed to load ${label}: ${error}`, 'error')
    return null
  }
}

/**
 * Official Ksl densable — async load cert/key file into cache entry.
 */
export async function loadMtlsCertFileAsync(
  path: string,
  label: string,
  deps?: {
    readFile?: (p: string, opts: { encoding: 'utf8' }) => Promise<string>
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
  const log =
    deps?.log ??
    ((msg: string, level?: 'error' | 'debug') => {
      if (level) logForDebugging(msg, { level })
      else logForDebugging(msg)
    })
  try {
    const content = await read(path, { encoding: 'utf8' })
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
 * Official b4t densable — async reload cert/key from env; returns whether
 * content/path changed (caller clears agent caches when true).
 */
export async function reloadMtlsCertsFromEnvAsync(input?: {
  env?: NodeJS.ProcessEnv
  loadFile?: (
    path: string,
    label: string,
  ) => Promise<MtlsCertFileCacheEntry | null>
  onChanged?: () => void
}): Promise<boolean> {
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
  const changed = didMtlsCertCacheChange({
    prevCert: cachedClientCert,
    prevKey: cachedClientKey,
    nextCert,
    nextKey,
  })
  cachedClientCert = nextCert
  cachedClientKey = nextKey
  if (changed) {
    clearMTLSCache()
    input?.onChanged?.()
  }
  return changed
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
