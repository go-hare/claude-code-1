/**
 * densable 2.1.224 #2 — plugin `archive` source (HTTPS zip + optional SHA-256).
 *
 * SEA symbols: Lio / Mio / $Xr / sid / Sny / mIo / fty / aid
 * - URL policy: https only; reject loopback / link-local / cloud-metadata hosts
 * - Download: arraybuffer, max 256MB, 120s, maxRedirects 5, redirect re-checks policy
 * - Verify optional sha256 pin; return contentSha256
 * - Extract zip; strip single wrapper dir; require plugin-shaped root
 */

import axios from 'axios'
import { createHash } from 'crypto'
import { readdir, rename, rm, writeFile } from 'fs/promises'
import { isIP } from 'net'
import { basename, dirname, join } from 'path'
import { logForDebugging } from '../debug.js'
import { isPathSafe, unzipFile } from '../dxt/zip.js'
import { errorMessage } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { classifyFetchError, logPluginFetch } from './fetchTelemetry.js'

/** densable Mio */
export const ARCHIVE_URL_POLICY_MESSAGE =
  'Archive URLs must use https:// and must not point at a loopback, link-local, or cloud-metadata host'

/** densable H_t = 256 MiB */
export const PLUGIN_ARCHIVE_MAX_BYTES = 268_435_456

/** densable pty */
export const PLUGIN_ARCHIVE_TIMEOUT_MS = 120_000

/** densable YDs */
export const PLUGIN_ARCHIVE_USER_AGENT = 'Claude-Code-Plugin-Manager'

/**
 * densable $Xr — hostname is loopback, link-local, or known cloud-metadata.
 * (Stricter than HTTP-hook ssrfGuard: loopback is REJECTED here.)
 */
export function isArchiveBlockedHostname(hostname: string): boolean {
  let t = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (t.endsWith('.')) t = t.slice(0, -1)
  if (t === '' || t === 'localhost' || t.endsWith('.localhost')) return true

  if (isIP(t) === 4) {
    const [i = 0, s = 0, a = 0, l = 0] = t.split('.').map(Number)
    // 127.0.0.0/8, 169.254.0.0/16, 0.0.0.0/8, Alibaba metadata 100.100.100.200
    return (
      i === 127 ||
      (i === 169 && s === 254) ||
      i === 0 ||
      (i === 100 && s === 100 && a === 100 && l === 200)
    )
  }

  if (isIP(t) !== 6) return false

  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(t)
  if (mappedDotted?.[1]) return isArchiveBlockedHostname(mappedDotted[1])

  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(t)
  if (mappedHex?.[1] !== undefined && mappedHex[2] !== undefined) {
    const hi = parseInt(mappedHex[1], 16)
    const lo = parseInt(mappedHex[2], 16)
    return isArchiveBlockedHostname(
      `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`,
    )
  }

  // ::1, ::, AWS IMDS IPv6 fd00:ec2::254
  if (t === '::1' || t === '::' || t === 'fd00:ec2::254') return true

  // fe80::/10 link-local — first hextet 0xfe80..0xfebf (65152..65215)
  const first = parseInt(/^([0-9a-f]{1,4}):/.exec(t)?.[1] ?? '0', 16)
  return first >= 65152 && first <= 65215
}

/** densable Lio */
export function isAllowedArchiveUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString)
    return u.protocol === 'https:' && !isArchiveBlockedHostname(u.hostname)
  } catch {
    return false
  }
}

/** densable mIo — same origin (null origin never matches) */
export function isSameOrigin(a: string, b: string): boolean {
  try {
    const oa = new URL(a).origin
    const ob = new URL(b).origin
    return oa !== 'null' && oa === ob
  } catch {
    return false
  }
}

function redactUrlCredentials(urlString: string): string {
  try {
    const u = new URL(urlString)
    if (u.username || u.password) {
      u.username = ''
      u.password = ''
      return u.toString()
    }
    return urlString
  } catch {
    return urlString
  }
}

function redirectHref(redirect: {
  href?: string
  protocol?: string
  host?: string
  hostname?: string
  port?: string
}): string {
  if (redirect.href) return redirect.href
  const host =
    redirect.host ??
    (redirect.hostname
      ? (redirect.hostname.includes(':') && !redirect.hostname.startsWith('[')
          ? `[${redirect.hostname}]`
          : redirect.hostname) + (redirect.port ? `:${redirect.port}` : '')
      : '')
  return redirect.protocol && host ? `${redirect.protocol}//${host}` : ''
}

/**
 * densable fty + aid — every redirect hop must pass Lio; drop inherited
 * marketplace headers when origin changes (except User-Agent).
 */
function createArchiveBeforeRedirect(
  originalUrl: string,
  inheritedHeaderNames: string[],
): (options: {
  href?: string
  protocol?: string
  host?: string
  hostname?: string
  port?: string
  headers?: Record<string, string>
}) => void {
  const drop = new Set(inheritedHeaderNames.map(h => h.toLowerCase()))
  return options => {
    const next = redirectHref(options)
    if (!isAllowedArchiveUrl(next)) {
      throw new Error(
        'Plugin archive redirected to a disallowed URL and was refused — ' +
          `every hop must satisfy the archive URL policy (${ARCHIVE_URL_POLICY_MESSAGE.replace(
            /^Archive URLs must /,
            '',
          )}): ${next ? redactUrlCredentials(next) : '(unparseable redirect target)'}`,
      )
    }
    if (drop.size === 0 || !options.headers) return
    if (next && isSameOrigin(originalUrl, next)) return
    let removed = 0
    for (const key of Object.keys(options.headers)) {
      if (drop.has(key.toLowerCase())) {
        delete options.headers[key]
        removed++
      }
    }
    if (removed > 0) {
      logForDebugging(
        'Fetch of plugin archive redirected to a different origin; dropped inherited marketplace headers',
      )
    }
  }
}

function formatArchiveDownloadError(
  error: unknown,
  url: string,
  redacted: string,
): string {
  const scrub = (msg: string) => msg.replaceAll(url, () => redacted)
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return `Could not connect to ${redacted}. Check your network connection and that the archive URL is correct.\n\nTechnical details: ${scrub(error.message)}`
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return `Timed out downloading plugin archive from ${redacted}. The server may be slow or unreachable.\n\nTechnical details: ${scrub(error.message)}`
    }
    if (error.response) {
      const status = error.response.status
      return `HTTP ${status} while downloading plugin archive from ${redacted}.${
        status === 401 || status === 403
          ? ' The server rejected the request — if it requires authentication, add `headers` to the marketplace source (they are forwarded to plugin archives on the same origin) or configure your proxy.'
          : ''
      }\n\nTechnical details: ${scrub(error.message)}`
    }
  }
  return `Failed to download plugin archive from ${redacted}: ${scrub(errorMessage(error))}`
}

export type DownloadPluginArchiveOptions = {
  sha256?: string
  headers?: Record<string, string>
}

export type DownloadPluginArchiveResult = {
  data: Buffer
  contentSha256: string
}

/**
 * densable sid — policy check → GET arraybuffer → sha256 verify.
 */
export async function downloadPluginArchive(
  url: string,
  options: DownloadPluginArchiveOptions = {},
): Promise<DownloadPluginArchiveResult> {
  if (!isAllowedArchiveUrl(url)) {
    throw new Error(
      `${ARCHIVE_URL_POLICY_MESSAGE}: ${redactUrlCredentials(url)}`,
    )
  }

  const redacted = redactUrlCredentials(url)
  logForDebugging(`Downloading plugin archive from ${redacted}`)

  const customHeaders = options.headers ?? {}
  const headers: Record<string, string> = {
    ...customHeaders,
    'User-Agent': PLUGIN_ARCHIVE_USER_AGENT,
  }
  const inheritedNames = Object.keys(customHeaders).filter(
    k => k.toLowerCase() !== 'user-agent',
  )

  const started = performance.now()
  let data: Buffer
  try {
    const response = await axios.get(url, {
      timeout: PLUGIN_ARCHIVE_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxRedirects: 5,
      maxContentLength: PLUGIN_ARCHIVE_MAX_BYTES,
      headers,
      beforeRedirect: createArchiveBeforeRedirect(url, inheritedNames),
    })
    logPluginFetch(
      'plugin_archive',
      url,
      'success',
      performance.now() - started,
    )
    data = Buffer.from(response.data)
  } catch (error) {
    logPluginFetch(
      'plugin_archive',
      url,
      'failure',
      performance.now() - started,
      classifyFetchError(error),
    )
    // Policy/redirect errors already carry the gold message
    if (
      error instanceof Error &&
      (error.message.includes('plugin archive redirect policy') ||
        error.message.includes('redirected to a disallowed URL'))
    ) {
      throw error
    }
    throw new Error(formatArchiveDownloadError(error, url, redacted))
  }

  const contentSha256 = createHash('sha256').update(data).digest('hex')
  if (
    options.sha256 &&
    options.sha256.toLowerCase() !== contentSha256.toLowerCase()
  ) {
    throw new Error(
      `Plugin archive integrity check failed for ${redacted}: expected sha256 ${options.sha256.toLowerCase()}, got ${contentSha256}. The archive was not installed. Verify the sha256 in the marketplace entry, or that the URL serves the intended file.`,
    )
  }

  return { data, contentSha256 }
}

/** densable Lad — plugin-shaped root markers */
const PLUGIN_ROOT_MARKERS = [
  '.claude-plugin',
  'commands',
  'skills',
  'agents',
  'hooks',
  'themes',
  'output-styles',
  'monitors',
  'workflows',
  'SKILL.md',
  '.mcp.json',
  '.lsp.json',
] as const

export async function hasPluginShapedRoot(dir: string): Promise<boolean> {
  const fs = getFsImplementation()
  for (const name of PLUGIN_ROOT_MARKERS) {
    try {
      await fs.stat(join(dir, name))
      return true
    } catch {
      // continue
    }
  }
  return false
}

/**
 * densable rdn — if extract root has exactly one non-junk directory and no
 * other non-junk files, promote that directory as the plugin root.
 */
export async function promoteSingleWrapperDirectory(
  extractRoot: string,
): Promise<string> {
  const entries = await readdir(extractRoot, { withFileTypes: true })
  const meaningful = entries.filter(
    e => e.name !== '__MACOSX' && e.name !== '.DS_Store',
  )
  if (meaningful.length !== 1 || !meaningful[0]!.isDirectory()) {
    return extractRoot
  }
  const only = join(extractRoot, meaningful[0]!.name)
  // Don't promote if the root itself already looks plugin-shaped
  if (await hasPluginShapedRoot(extractRoot)) {
    return extractRoot
  }
  return only
}

/**
 * Extract zip buffer into targetPath (final plugin directory).
 * densable Sny core: unzip → empty check → promote wrapper → shape check → move.
 */
export async function installPluginArchiveToDirectory(
  data: Buffer,
  targetPath: string,
  sourceUrl: string,
): Promise<void> {
  const redacted = redactUrlCredentials(sourceUrl)
  const fs = getFsImplementation()
  const extractRoot = `${targetPath}_x`

  try {
    await fs.mkdir(extractRoot)
    const files = await unzipFile(data)
    const names = Object.keys(files)
    const realEntries = names.filter(
      p => !p.startsWith('__MACOSX/') && basename(p) !== '.DS_Store',
    )
    if (realEntries.length === 0) {
      throw new Error(
        `Plugin archive from ${redacted} contained no plugin files. The archive was not installed. Verify the URL serves a zip of the plugin contents.`,
      )
    }

    for (const [relPath, content] of Object.entries(files)) {
      // Defense in depth: unzipFile already rejects traversal; re-check here
      // so a future extract path that skips dxt validation cannot write outside.
      if (!isPathSafe(relPath)) {
        throw new Error(
          `Plugin archive from ${redacted} contained an unsafe path (${relPath}). The archive was not installed.`,
        )
      }
      if (relPath.endsWith('/')) {
        await fs.mkdir(join(extractRoot, relPath))
        continue
      }
      const full = join(extractRoot, relPath)
      await fs.mkdir(dirname(full))
      await writeFile(full, Buffer.from(content))
    }

    let pluginRoot = await promoteSingleWrapperDirectory(extractRoot)
    if (pluginRoot !== extractRoot) {
      logForDebugging(
        `Plugin archive had a wrapper directory; using ${basename(pluginRoot)} as the plugin root`,
      )
    }

    if (!(await hasPluginShapedRoot(pluginRoot))) {
      throw new Error(
        `Plugin archive from ${redacted} has no plugin content at its root (expected .claude-plugin/ or a commands/, skills/, agents/, hooks/, themes/, output-styles/, monitors/, workflows/, SKILL.md, .mcp.json, or .lsp.json at the top level, optionally inside a single wrapper directory). The archive was not installed.`,
      )
    }

    // Move pluginRoot → targetPath
    await rm(targetPath, { recursive: true, force: true }).catch(() => {})
    await fs.mkdir(dirname(targetPath))
    if (pluginRoot === extractRoot) {
      await rename(extractRoot, targetPath)
    } else {
      await rename(pluginRoot, targetPath)
      await rm(extractRoot, { recursive: true, force: true }).catch(() => {})
    }
  } catch (error) {
    await rm(extractRoot, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/**
 * Full install path: download (+ optional pin) then extract to targetPath.
 * Returns contentSha256 for version identity.
 */
export async function installFromArchive(
  source: { url: string; sha256?: string },
  targetPath: string,
  marketplaceHeaders?: Record<string, string>,
  marketplaceUrl?: string,
): Promise<string> {
  let headers: Record<string, string> | undefined
  if (marketplaceHeaders && Object.keys(marketplaceHeaders).length > 0) {
    if (marketplaceUrl && isSameOrigin(marketplaceUrl, source.url)) {
      headers = marketplaceHeaders
    } else {
      logForDebugging(
        'Not forwarding marketplace headers to plugin archive on a different origin',
      )
    }
  }

  const { data, contentSha256 } = await downloadPluginArchive(source.url, {
    sha256: source.sha256,
    headers,
  })
  await installPluginArchiveToDirectory(data, targetPath, source.url)
  return contentSha256
}

/** Test helper: size check message (densable). */
export function formatArchiveTooLargeMessage(
  bytes: number,
  max: number,
  redactedUrl: string,
): string {
  return `Plugin archive too large (${bytes} bytes, max ${max}) from ${redactedUrl}`
}
