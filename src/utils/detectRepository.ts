import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getRemoteUrl, gitExe } from './git.js'

export type ParsedRepository = {
  host: string
  owner: string
  name: string
}

const repositoryWithHostCache = new Map<string, ParsedRepository | null>()

export function clearRepositoryCaches(): void {
  repositoryWithHostCache.clear()
}

export async function detectCurrentRepository(): Promise<string | null> {
  const result = await detectCurrentRepositoryWithHost()
  if (!result) return null
  // Only return results for github.com to avoid breaking downstream consumers
  // that assume the result is a github.com repository.
  // Use detectCurrentRepositoryWithHost() for GHE support.
  if (result.host !== 'github.com') return null
  return `${result.owner}/${result.name}`
}

/**
 * Like detectCurrentRepository, but also returns the host (e.g. "github.com"
 * or a GHE hostname). Callers that need to construct URLs against a specific
 * GitHub host should use this variant.
 *
 * densable k$(cwd): optional `cwd` overrides process CWD (teleport Qre `e.cwd`).
 */
export async function detectCurrentRepositoryWithHost(
  cwd: string = getCwd(),
): Promise<ParsedRepository | null> {
  if (repositoryWithHostCache.has(cwd)) {
    return repositoryWithHostCache.get(cwd) ?? null
  }

  try {
    // Process-CWD path uses the shared git watcher cache; arbitrary cwd queries
    // git directly so teleport/cwd overrides do not pollute the session cache.
    let remoteUrl: string | null
    if (cwd === getCwd()) {
      remoteUrl = await getRemoteUrl()
    } else {
      const result = await execFileNoThrowWithCwd(
        gitExe(),
        ['remote', 'get-url', 'origin'],
        { cwd, preserveOutputOnError: false },
      )
      remoteUrl = result.code === 0 ? result.stdout.trim() || null : null
    }
    logForDebugging(`Git remote URL: ${remoteUrl}`)
    if (!remoteUrl) {
      logForDebugging('No git remote URL found')
      repositoryWithHostCache.set(cwd, null)
      return null
    }

    const parsed = parseGitRemote(remoteUrl)
    logForDebugging(
      `Parsed repository: ${parsed ? `${parsed.host}/${parsed.owner}/${parsed.name}` : null} from URL: ${remoteUrl}`,
    )
    repositoryWithHostCache.set(cwd, parsed)
    return parsed
  } catch (error) {
    logForDebugging(`Error detecting repository: ${error}`)
    repositoryWithHostCache.set(cwd, null)
    return null
  }
}

/**
 * Synchronously returns the cached github.com repository for the current cwd
 * as "owner/name", or null if it hasn't been resolved yet or the host is not
 * github.com. Call detectCurrentRepository() first to populate the cache.
 *
 * Callers construct github.com URLs, so GHE hosts are filtered out here.
 */
export function getCachedRepository(): string | null {
  const parsed = repositoryWithHostCache.get(getCwd())
  if (!parsed || parsed.host !== 'github.com') return null
  return `${parsed.owner}/${parsed.name}`
}

/** densable SEA `f8y` / `fTt` — owner/repo path segment. */
const REPO_SLUG_SEGMENT_RE = /^[A-Za-z0-9._-]+$/

function isValidRepoSlugSegment(segment: string): boolean {
  return (
    REPO_SLUG_SEGMENT_RE.test(segment) &&
    !segment.startsWith('-') &&
    segment !== '.' &&
    segment !== '..'
  )
}

/**
 * Parses a git remote URL into host, owner, and name components.
 * Accepts any host (github.com, GHE instances, etc.).
 *
 * densable 2.1.234 #12 / SEA `Aoe`:
 * - SSH host class `[^:/@]+` (no `@`/`/` in host)
 * - URL userinfo `[^@/?#]*@` + host `[^/:?#@]+` so unusual userinfo cannot
 *   leak into the host capture
 * - `fTt` owner/name validation
 *
 * Supports:
 *   https://host/owner/repo.git
 *   git@host:owner/repo.git
 *   ssh://git@host/owner/repo.git
 *   git://host/owner/repo.git
 *   https://host/owner/repo (no .git)
 *
 * Note: repo names can contain dots (e.g., cc.kurs.web)
 */
export function parseGitRemote(input: string): ParsedRepository | null {
  const trimmed = input.trim()

  // SSH format: git@host:owner/repo.git — densable `[^:/@]+` host
  const sshMatch = trimmed.match(/^git@([^:/@]+):([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (sshMatch?.[1] && sshMatch[2] && sshMatch[3]) {
    if (!looksLikeRealHostname(sshMatch[1])) return null
    if (
      !isValidRepoSlugSegment(sshMatch[2]) ||
      !isValidRepoSlugSegment(sshMatch[3])
    ) {
      return null
    }
    return {
      host: sshMatch[1],
      owner: sshMatch[2],
      name: sshMatch[3],
    }
  }

  // URL format — densable userinfo `(?:[^@/?#]*@)?` + host `[^/:?#@]+(?::\d+)?`
  const urlMatch = trimmed.match(
    /^(https?|ssh|git):\/\/(?:[^@/?#]*@)?([^/:?#@]+(?::\d+)?)\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  )
  if (urlMatch?.[1] && urlMatch[2] && urlMatch[3] && urlMatch[4]) {
    const protocol = urlMatch[1]
    const hostWithPort = urlMatch[2]
    const hostWithoutPort = hostWithPort.split(':')[0] ?? ''
    if (!looksLikeRealHostname(hostWithoutPort)) return null
    if (
      !isValidRepoSlugSegment(urlMatch[3]) ||
      !isValidRepoSlugSegment(urlMatch[4])
    ) {
      return null
    }
    // Only preserve port for HTTPS — SSH/git ports are not usable for constructing
    // web URLs (e.g. ssh://git@ghe.corp.com:2222 → port 2222 is SSH, not HTTPS).
    const host =
      protocol === 'https' || protocol === 'http'
        ? hostWithPort
        : hostWithoutPort
    return {
      host,
      owner: urlMatch[3],
      name: urlMatch[4],
    }
  }

  return null
}

/**
 * Parses a git remote URL or "owner/repo" string and returns "owner/repo".
 * Only returns results for github.com hosts — GHE URLs return null.
 * Use parseGitRemote() for GHE support.
 * Also accepts plain "owner/repo" strings for backward compatibility.
 */
export function parseGitHubRepository(input: string): string | null {
  const trimmed = input.trim()

  // Try parsing as a full remote URL first.
  // Only return results for github.com hosts — existing callers (VS Code extension,
  // bridge) assume this function is GitHub.com-specific. Use parseGitRemote() directly
  // for GHE support.
  const parsed = parseGitRemote(trimmed)
  if (parsed) {
    if (parsed.host !== 'github.com') return null
    return `${parsed.owner}/${parsed.name}`
  }

  // If no URL pattern matched, check if it's already in owner/repo format.
  // densable SEA `x8t`: plain path also requires `fTt` on both segments.
  if (
    !trimmed.includes('://') &&
    !trimmed.includes('@') &&
    trimmed.includes('/')
  ) {
    const parts = trimmed.split('/')
    if (parts.length === 2 && parts[0] && parts[1]) {
      // Remove .git extension if present
      const repo = parts[1].replace(/\.git$/, '')
      if (!isValidRepoSlugSegment(parts[0]) || !isValidRepoSlugSegment(repo)) {
        return null
      }
      return `${parts[0]}/${repo}`
    }
  }

  logForDebugging(`Could not parse repository from: ${trimmed}`)
  return null
}

/**
 * densable SEA `Fdu` — real hostname (not SSH config alias).
 * Requires `[A-Za-z0-9.-]+`, no leading `-`, contains `.`, alphabetic TLD.
 * Aliases like `github.com-work` fail the TLD check (`com-work`).
 */
function looksLikeRealHostname(host: string): boolean {
  if (
    !/^[A-Za-z0-9.-]+$/.test(host) ||
    host.startsWith('-') ||
    !host.includes('.')
  ) {
    return false
  }
  const lastSegment = host.split('.').pop()
  if (!lastSegment) return false
  return /^[a-zA-Z]+$/.test(lastSegment)
}
