import { homedir } from 'os'
import { resolve } from 'path'
import { getErrnoCode } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import type { MarketplaceSource } from './schemas.js'

/** densable `H9S` — bare GitLab host accepted for nested-subgroup clone. */
const GITLAB_COM = 'gitlab.com'

/**
 * densable `gEt` + `Sws` — host equality after lowercase / strip www.
 * Used for github.com and gitlab.com marketplace HTTPS clone classification.
 */
export function isExactMarketplaceHost(
  hostname: string,
  target: string,
): boolean {
  let h = hostname.replace(/[\t\n\r]/g, '').toLowerCase()
  while (h.startsWith('www.')) {
    h = h.slice(4)
  }
  return h === target
}

/**
 * densable `WSr` — reject URLs whose host segment contains a backslash
 * (host/path confusion / SSRF-style tricks).
 */
export function urlHostContainsBackslash(rawUrl: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: densable WSr leading C0/space strip before host parse
  const e = rawUrl.replace(/^[\x00-\x20]+/, '')
  const schemeEnd = e.indexOf('://')
  if (schemeEnd === -1) return false
  let rest = e.slice(schemeEnd + 3)
  const scheme = e.slice(0, schemeEnd).toLowerCase()
  // densable RRy: for schemes that allow authority, strip leading slashes
  if (
    scheme === 'http' ||
    scheme === 'https' ||
    scheme === 'git' ||
    scheme === 'ssh'
  ) {
    const leading = rest.match(/^[/\s\\]+/)?.[0] ?? ''
    if (leading.includes('\\')) return true
    rest = rest.slice(leading.length)
  }
  const cut = rest.search(/[/?#]/)
  const host = cut === -1 ? rest : rest.slice(0, cut)
  return host.includes('\\')
}

/**
 * densable `I9S` — hostname is exactly gitlab.com (www-stripped).
 */
export function isGitlabComHost(hostname: string): boolean {
  return isExactMarketplaceHost(hostname, GITLAB_COM)
}

/**
 * densable GitHub owner/repo shorthand (no nested groups).
 * `owner` must start/end alnum; `repo` alnum + ._- .
 */
const GITHUB_SHORTHAND_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/

/**
 * Parses a marketplace input string and returns the appropriate marketplace source type.
 * Handles various input formats:
 * - Git SSH URLs (user@host:path or user@host:path.git)
 *   - Standard: git@github.com:owner/repo.git
 *   - GitHub Enterprise SSH certificates: org-123456@github.com:owner/repo.git
 *   - Custom usernames: deploy@gitlab.com:group/project.git
 *   - Self-hosted: user@192.168.10.123:path/to/repo
 * - HTTP/HTTPS URLs (github.com + gitlab.com nested subgroups → git clone)
 * - GitHub shorthand (owner/repo)
 * - Local file paths (.json files)
 * - Local directory paths
 *
 * densable 2.1.232 #7 (`QDi` / `I9S`): bare `gitlab.com` repo URLs including
 * nested subgroups clone like `github.com` (source:'git' + `.git` suffix).
 *
 * @param input The marketplace source input string
 * @returns MarketplaceSource object, error object, or null if format is unrecognized
 */
export async function parseMarketplaceInput(
  input: string,
): Promise<MarketplaceSource | { error: string } | null> {
  const trimmed = input.trim()
  const fs = getFsImplementation()

  // Handle git SSH URLs with any valid username (not just 'git')
  // Supports: user@host:path, user@host:path.git, and with #ref suffix
  // Username can contain: alphanumeric, dots, underscores, hyphens
  const sshMatch = trimmed.match(
    /^([a-zA-Z0-9._-]+@[^:]+:.+?(?:\.git)?)(#(.+))?$/,
  )
  if (sshMatch?.[1]) {
    const url = sshMatch[1]
    const ref = sshMatch[3]
    return ref ? { source: 'git', url, ref } : { source: 'git', url }
  }

  // Handle URLs
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    // Extract fragment (ref) from URL if present
    const fragmentMatch = trimmed.match(/^([^#]+)(#(.+))?$/)
    const urlWithoutFragment = fragmentMatch?.[1] || trimmed
    const ref = fragmentMatch?.[3]

    // When user explicitly provides an HTTPS/HTTP URL that looks like a git
    // repo, use the git source type so we clone rather than fetch-as-JSON.
    // The .git suffix is a GitHub/GitLab/Bitbucket convention. Azure DevOps
    // uses /_git/ in the path with NO suffix (appending .git breaks ADO:
    // TF401019 "repo does not exist"). Without this check, an ADO URL falls
    // through to source:'url' below, which tries to fetch it as a raw
    // marketplace.json — the HTML response parses as "expected object,
    // received string". (gh-31256 / CC-299)
    if (
      urlWithoutFragment.endsWith('.git') ||
      urlWithoutFragment.includes('/_git/')
    ) {
      return ref
        ? { source: 'git', url: urlWithoutFragment, ref }
        : { source: 'git', url: urlWithoutFragment }
    }
    // Parse URL to check hostname
    let url: URL
    try {
      url = new URL(urlWithoutFragment)
    } catch (_err) {
      // Not a valid URL for parsing, treat as generic URL
      // new URL() throws TypeError for invalid URLs
      return { source: 'url', url: urlWithoutFragment }
    }

    // densable Em: github.com (www-stripped) → git clone for owner/repo
    if (isExactMarketplaceHost(url.hostname, 'github.com')) {
      const match = url.pathname.match(/^\/([^/]+\/[^/]+?)(\/|\.git|$)/)
      if (match?.[1] && !urlHostContainsBackslash(urlWithoutFragment)) {
        // User explicitly provided HTTPS URL - keep it as HTTPS via 'git' type
        // Add .git suffix if not present for proper git clone
        const gitUrl = urlWithoutFragment.endsWith('.git')
          ? urlWithoutFragment
          : `${urlWithoutFragment}.git`
        return ref
          ? { source: 'git', url: gitUrl, ref }
          : { source: 'git', url: gitUrl }
      }
    }

    // densable I9S / QDi gitlab.com branch — nested subgroups (≥2 path segments)
    if (isGitlabComHost(url.hostname)) {
      const segments = url.pathname.split('/').filter(Boolean)
      const authorityStart = urlWithoutFragment.indexOf(
        '/',
        urlWithoutFragment.indexOf('://') + 3,
      )
      const pathPart =
        authorityStart === -1
          ? ''
          : urlWithoutFragment.slice(authorityStart).replace(/\/+$/, '')
      const decoded = segments.map(seg => {
        try {
          return decodeURIComponent(seg)
        } catch {
          return null
        }
      })
      // densable guards: path reconstructs, no control chars, no backslash host,
      // no leading "api", no bare "-" segment (GitLab reserved)
      if (
        segments.length >= 2 &&
        pathPart === `/${segments.join('/')}` &&
        !/[\t\n\r]/.test(urlWithoutFragment) &&
        !urlHostContainsBackslash(urlWithoutFragment) &&
        decoded.every(s => s !== null) &&
        decoded[0] !== 'api' &&
        !decoded.includes('-')
      ) {
        const cleaned = urlWithoutFragment.replace(/\/+$/, '')
        const gitUrl = cleaned.endsWith('.git') ? cleaned : `${cleaned}.git`
        return ref
          ? { source: 'git', url: gitUrl, ref }
          : { source: 'git', url: gitUrl }
      }
    }

    return { source: 'url', url: urlWithoutFragment }
  }

  // Handle local paths
  // On Windows, also recognize backslash-relative (.\, ..\) and drive letter paths (C:\)
  // These are Windows-only because backslashes are valid filename chars on Unix
  const isWindows = process.platform === 'win32'
  const isWindowsPath =
    isWindows &&
    (trimmed.startsWith('.\\') ||
      trimmed.startsWith('..\\') ||
      /^[a-zA-Z]:[/\\]/.test(trimmed))
  if (
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    isWindowsPath
  ) {
    const resolvedPath = resolve(
      trimmed.startsWith('~') ? trimmed.replace(/^~/, homedir()) : trimmed,
    )

    // Stat the path to determine if it's a file or directory. Swallow all stat
    // errors (ENOENT, EACCES, EPERM, etc.) and return an error result instead
    // of throwing — matches the old existsSync behavior which never threw.
    let stats
    try {
      stats = await fs.stat(resolvedPath)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      return {
        error:
          code === 'ENOENT'
            ? `Path does not exist: ${resolvedPath}`
            : `Cannot access path: ${resolvedPath} (${code ?? e})`,
      }
    }

    if (stats.isFile()) {
      if (resolvedPath.endsWith('.json')) {
        return { source: 'file', path: resolvedPath }
      } else {
        return {
          error: `File path must point to a .json file (marketplace.json), but got: ${resolvedPath}`,
        }
      }
    } else if (stats.isDirectory()) {
      return { source: 'directory', path: resolvedPath }
    } else {
      return {
        error: `Path is neither a file nor a directory: ${resolvedPath}`,
      }
    }
  }

  // Handle GitHub shorthand (owner/repo, owner/repo#ref, or owner/repo@ref)
  // Accept both # and @ as ref separators — the display formatter uses @, so users
  // naturally type @ when copying from error messages or managed settings.
  // densable: invalid multi-segment (e.g. gitlab group/sub/repo bare) errors with
  // guidance to use full https:// clone URL — does not invent github source.
  if (trimmed.includes('/') && !trimmed.startsWith('@')) {
    if (trimmed.includes(':')) {
      return null
    }
    // Extract ref if present (either #ref or @ref)
    const fragmentMatch = trimmed.match(/^([^#@]+)(?:[#@](.+))?$/)
    const repo = fragmentMatch?.[1] || trimmed
    const ref = fragmentMatch?.[2]
    if (!GITHUB_SHORTHAND_RE.test(repo)) {
      return {
        error: `'${trimmed}' is not a valid GitHub owner/repo shorthand. For a git repo, use the full https:// clone URL from your host (typically ending in .git — some hosts like Azure DevOps omit it). For a hosted marketplace.json, use its https:// URL. For a local path, use ./ or an absolute path.`,
      }
    }
    return ref ? { source: 'github', repo, ref } : { source: 'github', repo }
  }

  // NPM packages not yet implemented
  // Returning null for unrecognized input

  return null
}
