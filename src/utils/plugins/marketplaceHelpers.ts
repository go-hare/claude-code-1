import isEqual from 'lodash-es/isEqual.js'
import { logForDebugging } from '../debug.js'
import { toError } from '../errors.js'
import { logError } from '../log.js'
import { getSettingsForSource } from '../settings/settings.js'
import { plural } from '../stringUtils.js'
import { checkGitAvailable } from './gitAvailability.js'
import { getMarketplace } from './marketplaceManager.js'
import type { KnownMarketplace, MarketplaceSource } from './schemas.js'

/**
 * densable F4u — GitHub owner/repo name segment (policy owner/* + concrete repo).
 */
const GITHUB_NAME_SEGMENT = /^[A-Za-z0-9._-]+$/

/**
 * densable MEo — valid single path segment for owner/repo names.
 */
export function isValidGithubNameSegment(name: string): boolean {
  return (
    GITHUB_NAME_SEGMENT.test(name) &&
    !name.startsWith('-') &&
    name !== '.' &&
    name !== '..'
  )
}

/**
 * densable B4u — parse policy `owner/*` → owner, or null if not a valid wildcard.
 */
export function parseOwnerWildcardRepo(repo: string): string | null {
  if (!repo.endsWith('/*')) return null
  const owner = repo.slice(0, -2)
  return isValidGithubNameSegment(owner) ? owner : null
}

/**
 * densable U4u / qOd — collapse `.` / `..` path segments (no leading slash).
 */
export function collapseUrlPathSegments(path: string): string {
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  return parts.join('/')
}

/**
 * densable KOd — repeatedly strip trailing `/` and trailing `.git` suffix.
 */
export function stripTrailingSlashesAndGitSuffix(path: string): string {
  let t = path.length
  for (;;) {
    let r = t
    while (r > 0 && path.charCodeAt(r - 1) === 47 /* / */) r--
    if (r >= 4 && path.startsWith('.git', r - 4)) r -= 4
    if (r === t) return t === path.length ? path : path.slice(0, t)
    t = r
  }
}

/**
 * densable U4u — normalize a github-form repo path (decode, collapse . / .., strip .git).
 */
export function normalizeGithubRepoPath(repo: string): string {
  let decoded = repo
  try {
    decoded = decodeURIComponent(repo)
  } catch {
    // keep raw
  }
  return stripTrailingSlashesAndGitSuffix(collapseUrlPathSegments(decoded))
}

/** densable BJs / Ly — fold ssh.github.com + www into github.com for policy compare. */
const GITHUB_COM = 'github.com'
const SSH_GITHUB_COM = 'ssh.github.com'

/**
 * densable gEt + LWo + $Od — hostname for marketplace policy URL compare.
 * Lowercase / strip www; map github hosts (incl. ssh.github.com) to github.com.
 */
export function normalizeMarketplacePolicyHostname(hostname: string): string {
  let h = hostname.replace(/[\t\n\r]/g, '').toLowerCase()
  while (h.startsWith('www.')) {
    h = h.slice(4)
  }
  // trailing dots (DNS absolute)
  h = h.replace(/\.+$/, '')
  if (h === GITHUB_COM || h === SSH_GITHUB_COM) {
    return GITHUB_COM
  }
  return h
}

/**
 * densable CWo — normalize a marketplace URL for blocklist equivalence.
 * Clears credentials / search / hash; folds github host aliases; collapses path;
 * optionally strips trailing `.git` (used when comparing git clone URL ↔ url block).
 */
export function normalizeMarketplaceUrlForBlocklist(
  url: string,
  options?: { stripDotGit?: boolean },
): string {
  if (url.includes('://')) {
    try {
      const n = new URL(url)
      n.hostname = normalizeMarketplacePolicyHostname(n.hostname)
      n.username = ''
      n.password = ''
      n.search = ''
      n.hash = ''
      try {
        n.pathname = decodeURIComponent(n.pathname)
      } catch {
        // keep pathname
      }
      const collapsed = collapseUrlPathSegments(n.pathname)
      // URL.pathname must start with /
      const pathBody = options?.stripDotGit
        ? stripTrailingSlashesAndGitSuffix(collapsed)
        : collapsed
      n.pathname = pathBody ? `/${pathBody}` : '/'
      return n.toString()
    } catch {
      return url
    }
  }
  // densable SSH form without :// → host + path tail (no user@)
  const ssh = url.match(/^[^@]+@([^:]+)(:.*)$/s)
  if (ssh) {
    return `${normalizeMarketplacePolicyHostname(ssh[1] ?? '')}${ssh[2] ?? ''}`
  }
  return url
}

/**
 * densable HWo — lighter hostname-only normalize for same-type url block entries.
 */
export function normalizeMarketplaceUrlHostnameOnly(url: string): string {
  try {
    const t = new URL(url)
    t.hostname = normalizeMarketplacePolicyHostname(t.hostname)
    return t.toString()
  } catch {
    return url
  }
}

/**
 * densable DEo — does a policy github `repo` field match a concrete source repo?
 * Supports managed-settings-only owner wildcard `"owner/*"` (case-insensitive owner).
 * Invalid wildcards (e.g. star-slash-star, foo*) log and fall back to literal equality.
 *
 * @param policyRepo - entry from strictKnownMarketplaces / blockedMarketplaces
 * @param sourceRepo - concrete owner/repo from the marketplace being added
 */
export function githubRepoPolicyMatches(
  policyRepo: string,
  sourceRepo: string,
  listLabel:
    | 'strictKnownMarketplaces'
    | 'blockedMarketplaces' = 'blockedMarketplaces',
): boolean {
  const normalizedSource = normalizeGithubRepoPath(sourceRepo)
  const owner = parseOwnerWildcardRepo(policyRepo)
  if (owner === null) {
    if (policyRepo.includes('*')) {
      logForDebugging(
        `Invalid owner-wildcard repo in policy settings ${listLabel}: ${policyRepo} (only "<owner>/*" is supported); entry only matches a literally identical repo string`,
        { level: 'error' },
      )
    }
    return normalizedSource === policyRepo || sourceRepo === policyRepo
  }
  const segs = normalizedSource.split('/')
  if (segs.length !== 2) return false
  const [srcOwner, srcName] = segs
  if (
    srcOwner === undefined ||
    srcName === undefined ||
    !isValidGithubNameSegment(srcOwner) ||
    !GITHUB_NAME_SEGMENT.test(srcName)
  ) {
    return false
  }
  return srcOwner.toLowerCase() === owner.toLowerCase()
}

/**
 * Format plugin failure details for user display
 * @param failures - Array of failures with names and reasons
 * @param includeReasons - Whether to include failure reasons (true for full errors, false for summaries)
 * @returns Formatted string like "plugin-a (reason); plugin-b (reason)" or "plugin-a, plugin-b"
 */
export function formatFailureDetails(
  failures: Array<{ name: string; reason?: string; error?: string }>,
  includeReasons: boolean,
): string {
  const maxShow = 2
  const details = failures
    .slice(0, maxShow)
    .map(f => {
      const reason = f.reason || f.error || 'unknown error'
      return includeReasons ? `${f.name} (${reason})` : f.name
    })
    .join(includeReasons ? '; ' : ', ')

  const remaining = failures.length - maxShow
  const moreText = remaining > 0 ? ` and ${remaining} more` : ''

  return `${details}${moreText}`
}

/**
 * Extract source display string from marketplace configuration
 */
export function getMarketplaceSourceDisplay(source: MarketplaceSource): string {
  switch (source.source) {
    case 'github':
      return source.repo
    case 'url':
      return source.url
    case 'git':
      return source.url
    case 'directory':
      return source.path
    case 'file':
      return source.path
    case 'settings':
      return `settings:${source.name}`
    default:
      return 'Unknown source'
  }
}

/**
 * Create a plugin ID from plugin name and marketplace name
 */
export function createPluginId(
  pluginName: string,
  marketplaceName: string,
): string {
  return `${pluginName}@${marketplaceName}`
}

/**
 * Load marketplaces with graceful degradation for individual failures.
 * Blocked marketplaces (per enterprise policy) are excluded from the results.
 */
export async function loadMarketplacesWithGracefulDegradation(
  config: Record<string, KnownMarketplace>,
): Promise<{
  marketplaces: Array<{
    name: string
    config: KnownMarketplace
    data: Awaited<ReturnType<typeof getMarketplace>> | null
  }>
  failures: Array<{ name: string; error: string }>
}> {
  const marketplaces: Array<{
    name: string
    config: KnownMarketplace
    data: Awaited<ReturnType<typeof getMarketplace>> | null
  }> = []
  const failures: Array<{ name: string; error: string }> = []

  for (const [name, marketplaceConfig] of Object.entries(config)) {
    // Skip marketplaces blocked by enterprise policy
    if (!isSourceAllowedByPolicy(marketplaceConfig.source)) {
      continue
    }

    let data = null
    try {
      data = await getMarketplace(name)
    } catch (err) {
      // Track individual marketplace failures but continue loading others
      const errorMessage = err instanceof Error ? err.message : String(err)
      failures.push({ name, error: errorMessage })

      // Log for monitoring
      logError(toError(err))
    }

    marketplaces.push({
      name,
      config: marketplaceConfig,
      data,
    })
  }

  return { marketplaces, failures }
}

/**
 * Format marketplace loading failures into appropriate user messages
 */
export function formatMarketplaceLoadingErrors(
  failures: Array<{ name: string; error: string }>,
  successCount: number,
): { type: 'warning' | 'error'; message: string } | null {
  if (failures.length === 0) {
    return null
  }

  // If some marketplaces succeeded, show warning
  if (successCount > 0) {
    const message =
      failures.length === 1
        ? `Warning: Failed to load marketplace '${failures[0]!.name}': ${failures[0]!.error}`
        : `Warning: Failed to load ${failures.length} marketplaces: ${formatFailureNames(failures)}`
    return { type: 'warning', message }
  }

  // All marketplaces failed - this is a critical error
  return {
    type: 'error',
    message: `Failed to load all marketplaces. Errors: ${formatFailureErrors(failures)}`,
  }
}

function formatFailureNames(
  failures: Array<{ name: string; error: string }>,
): string {
  return failures.map(f => f.name).join(', ')
}

function formatFailureErrors(
  failures: Array<{ name: string; error: string }>,
): string {
  return failures.map(f => `${f.name}: ${f.error}`).join('; ')
}

/**
 * Get the strict marketplace source allowlist from policy settings.
 * Returns null if no restriction is in place, or an array of allowed sources.
 */
export function getStrictKnownMarketplaces(): MarketplaceSource[] | null {
  const policySettings = getSettingsForSource('policySettings')
  if (!policySettings?.strictKnownMarketplaces) {
    return null // No restrictions
  }
  return policySettings.strictKnownMarketplaces
}

/**
 * Get the marketplace source blocklist from policy settings.
 * Returns null if no blocklist is in place, or an array of blocked sources.
 */
export function getBlockedMarketplaces(): MarketplaceSource[] | null {
  const policySettings = getSettingsForSource('policySettings')
  if (!policySettings?.blockedMarketplaces) {
    return null // No blocklist
  }
  return policySettings.blockedMarketplaces
}

/**
 * Get the custom plugin trust message from policy settings.
 * Returns undefined if not configured.
 */
export function getPluginTrustMessage(): string | undefined {
  return getSettingsForSource('policySettings')?.pluginTrustMessage
}

/**
 * Official 2.1.x: managed allowlist for contextual plugin install tips.
 * Empty/undefined → no marketplace-declared tips surface (built-in first-party
 * tips like frontend-design remain unaffected).
 * Only honored from policySettings.
 */
export function getPluginSuggestionMarketplaces(): string[] {
  return (
    getSettingsForSource('policySettings')?.pluginSuggestionMarketplaces ?? []
  )
}

/**
 * Whether a marketplace may contribute contextual plugin suggestion tips.
 * Built-in first-party tips do not call this (they are always eligible).
 */
export function isPluginSuggestionMarketplaceAllowed(
  marketplaceName: string,
): boolean {
  const allowlist = getPluginSuggestionMarketplaces()
  if (allowlist.length === 0) return false
  return allowlist.includes(marketplaceName)
}

/**
 * Official n3r: a marketplace tip only applies when the marketplace is
 * registered AND its registered source is declared in managed settings
 * (extraKnownMarketplaces entry for that name, or strictKnownMarketplaces).
 * The official marketplace is exempt (checked by caller).
 */
export function isMarketplaceSourceDeclaredInManagedSettings(
  marketplaceName: string,
  source: MarketplaceSource,
): boolean {
  const policy = getSettingsForSource('policySettings')
  if (!policy) return false

  const extra = policy.extraKnownMarketplaces?.[marketplaceName]?.source
  if (extra && areSourcesEqual(source, extra as MarketplaceSource)) {
    return true
  }

  const strict = policy.strictKnownMarketplaces
  if (!strict || strict.length === 0) return false

  return strict.some(allowed => {
    if (allowed.source === 'hostPattern') {
      return doesSourceMatchHostPattern(source, allowed)
    }
    if (allowed.source === 'pathPattern') {
      return doesSourceMatchPathPattern(source, allowed)
    }
    return areSourcesEqual(source, allowed as MarketplaceSource)
  })
}

/**
 * Compare two MarketplaceSource objects for equality.
 * Sources are equal if they have the same type and all relevant fields match.
 */
function areSourcesEqual(a: MarketplaceSource, b: MarketplaceSource): boolean {
  if (a.source !== b.source) return false

  switch (a.source) {
    case 'url':
      return a.url === (b as typeof a).url
    case 'github': {
      // densable x1_/DEo: (source=a, policy=b) — policy may be owner/*
      const policy = b as typeof a
      return (
        githubRepoPolicyMatches(
          policy.repo,
          a.repo,
          'strictKnownMarketplaces',
        ) &&
        (a.ref || undefined) === (policy.ref || undefined) &&
        (a.path || undefined) === (policy.path || undefined)
      )
    }
    case 'git': {
      // Prefer owner/* against extracted github owner/repo when both sides are GH URLs
      const policy = b as typeof a
      const policyRepo = extractGitHubRepoFromGitUrl(policy.url)
      const sourceRepo = extractGitHubRepoFromGitUrl(a.url)
      if (policyRepo !== null && sourceRepo !== null) {
        return (
          githubRepoPolicyMatches(
            policyRepo,
            sourceRepo,
            'strictKnownMarketplaces',
          ) &&
          (a.ref || undefined) === (policy.ref || undefined) &&
          (a.path || undefined) === (policy.path || undefined)
        )
      }
      return (
        a.url === policy.url &&
        (a.ref || undefined) === (policy.ref || undefined) &&
        (a.path || undefined) === (policy.path || undefined)
      )
    }
    case 'npm':
      return a.package === (b as typeof a).package
    case 'file':
      return a.path === (b as typeof a).path
    case 'directory':
      return a.path === (b as typeof a).path
    case 'settings':
      return (
        a.name === (b as typeof a).name &&
        isEqual(a.plugins, (b as typeof a).plugins)
      )
    default:
      return false
  }
}

/**
 * Extract the host/domain from a marketplace source.
 * Used for hostPattern matching in strictKnownMarketplaces.
 *
 * Currently only supports github, git, and url sources.
 * npm, file, and directory sources are not supported for hostPattern matching.
 *
 * @param source - The marketplace source to extract host from
 * @returns The hostname string, or null if extraction fails or source type not supported
 */
export function extractHostFromSource(
  source: MarketplaceSource,
): string | null {
  switch (source.source) {
    case 'github':
      // GitHub shorthand always means github.com
      return 'github.com'

    case 'git': {
      // SSH format: user@HOST:path (e.g., git@github.com:owner/repo.git)
      const sshMatch = source.url.match(/^[^@]+@([^:]+):/)
      if (sshMatch?.[1]) {
        return sshMatch[1]
      }
      // HTTPS format: extract hostname from URL
      try {
        return new URL(source.url).hostname
      } catch {
        return null
      }
    }

    case 'url':
      try {
        return new URL(source.url).hostname
      } catch {
        return null
      }

    // npm, file, directory, hostPattern, pathPattern sources are not supported for hostPattern matching
    default:
      return null
  }
}

/**
 * Check if a source matches a hostPattern entry.
 * Extracts the host from the source and tests it against the regex pattern.
 *
 * @param source - The marketplace source to check
 * @param pattern - The hostPattern entry from strictKnownMarketplaces
 * @returns true if the source's host matches the pattern
 */
function doesSourceMatchHostPattern(
  source: MarketplaceSource,
  pattern: MarketplaceSource & { source: 'hostPattern' },
): boolean {
  const host = extractHostFromSource(source)
  if (!host) {
    return false
  }

  try {
    const regex = new RegExp(pattern.hostPattern)
    return regex.test(host)
  } catch {
    // Invalid regex - log and return false
    logError(new Error(`Invalid hostPattern regex: ${pattern.hostPattern}`))
    return false
  }
}

/**
 * Check if a source matches a pathPattern entry.
 * Tests the source's .path (file and directory sources only) against the regex pattern.
 *
 * @param source - The marketplace source to check
 * @param pattern - The pathPattern entry from strictKnownMarketplaces
 * @returns true if the source's path matches the pattern
 */
function doesSourceMatchPathPattern(
  source: MarketplaceSource,
  pattern: MarketplaceSource & { source: 'pathPattern' },
): boolean {
  // Only file and directory sources have a .path to match against
  if (source.source !== 'file' && source.source !== 'directory') {
    return false
  }

  try {
    const regex = new RegExp(pattern.pathPattern)
    return regex.test(source.path)
  } catch {
    logError(new Error(`Invalid pathPattern regex: ${pattern.pathPattern}`))
    return false
  }
}

/**
 * Get hosts from hostPattern entries in the allowlist.
 * Used to provide helpful error messages.
 */
export function getHostPatternsFromAllowlist(): string[] {
  const allowlist = getStrictKnownMarketplaces()
  if (!allowlist) return []

  return allowlist
    .filter(
      (entry): entry is MarketplaceSource & { source: 'hostPattern' } =>
        entry.source === 'hostPattern',
    )
    .map(entry => entry.hostPattern)
}

/**
 * Extract GitHub owner/repo from a git URL if it's a GitHub URL.
 * Returns null if not a GitHub URL.
 *
 * Handles:
 * - git@github.com:owner/repo.git
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo
 */
function extractGitHubRepoFromGitUrl(url: string): string | null {
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/)
  if (sshMatch && sshMatch[1]) {
    return sshMatch[1]
  }

  // HTTPS format: https://github.com/owner/repo.git or https://github.com/owner/repo
  const httpsMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
  )
  if (httpsMatch && httpsMatch[1]) {
    return httpsMatch[1]
  }

  return null
}

/**
 * Check if a blocked ref/path constraint matches a source.
 * If the blocklist entry has no ref/path, it matches ALL refs/paths (wildcard).
 * If the blocklist entry has a specific ref/path, it only matches that exact value.
 */
function blockedConstraintMatches(
  blockedValue: string | undefined,
  sourceValue: string | undefined,
): boolean {
  // If blocklist doesn't specify a constraint, it's a wildcard - matches anything
  if (!blockedValue) {
    return true
  }
  // If blocklist specifies a constraint, source must match exactly
  return (blockedValue || undefined) === (sourceValue || undefined)
}

/**
 * Check if two sources refer to the same GitHub repository, even if using
 * different source types (github vs git with GitHub URL).
 *
 * Blocklist matching is asymmetric:
 * - If blocklist entry has no ref/path, it blocks ALL refs/paths (wildcard)
 * - If blocklist entry has a specific ref/path, only that exact value is blocked
 */
/**
 * densable `Qob` — pure blocklist entry equivalence (no settings I/O).
 * Exported for unit tests; production uses `isSourceInBlocklist`.
 */
export function areSourcesEquivalentForBlocklist(
  source: MarketplaceSource,
  blocked: MarketplaceSource,
): boolean {
  // Check exact same source type
  if (source.source === blocked.source) {
    switch (source.source) {
      case 'github': {
        const b = blocked as typeof source
        // densable DEo(policy.repo, source.repo) — owner/* on blocked entry
        if (
          !githubRepoPolicyMatches(b.repo, source.repo, 'blockedMarketplaces')
        ) {
          return false
        }
        return (
          blockedConstraintMatches(b.ref, source.ref) &&
          blockedConstraintMatches(b.path, source.path)
        )
      }
      case 'git': {
        const b = blocked as typeof source
        // densable NOd on policy url (reject owner/* in git form) + FJs extract
        const blockedRepo = extractGitHubRepoFromGitUrl(b.url)
        const sourceRepo =
          blockedRepo === null ? null : extractGitHubRepoFromGitUrl(source.url)
        if (blockedRepo !== null && sourceRepo !== null) {
          if (
            !githubRepoPolicyMatches(
              blockedRepo,
              sourceRepo,
              'blockedMarketplaces',
            )
          ) {
            return false
          }
        } else if (
          // densable CWo equality when either side is not a plain github.com repo
          normalizeMarketplaceUrlForBlocklist(source.url) !==
          normalizeMarketplaceUrlForBlocklist(b.url)
        ) {
          return false
        }
        return (
          blockedConstraintMatches(b.ref, source.ref) &&
          blockedConstraintMatches(b.path, source.path)
        )
      }
      case 'url':
        // densable HWo — hostname-normalized equality (www / case)
        return (
          normalizeMarketplaceUrlHostnameOnly(source.url) ===
          normalizeMarketplaceUrlHostnameOnly((blocked as typeof source).url)
        )
      case 'npm':
        return source.package === (blocked as typeof source).package
      case 'file':
        return source.path === (blocked as typeof source).path
      case 'directory':
        return source.path === (blocked as typeof source).path
      case 'settings':
        return source.name === (blocked as typeof source).name
      default:
        return false
    }
  }

  // Check if a git source matches a github blocklist entry (incl. owner/*)
  if (source.source === 'git' && blocked.source === 'github') {
    const extractedRepo = extractGitHubRepoFromGitUrl(source.url)
    if (
      extractedRepo !== null &&
      githubRepoPolicyMatches(
        blocked.repo,
        extractedRepo,
        'blockedMarketplaces',
      )
    ) {
      return (
        blockedConstraintMatches(blocked.ref, source.ref) &&
        blockedConstraintMatches(blocked.path, source.path)
      )
    }
  }

  // Check if a github source matches a git blocklist entry (GitHub URL / owner/*)
  if (source.source === 'github' && blocked.source === 'git') {
    const extractedRepo = extractGitHubRepoFromGitUrl(blocked.url)
    if (
      extractedRepo !== null &&
      githubRepoPolicyMatches(extractedRepo, source.repo, 'blockedMarketplaces')
    ) {
      return (
        blockedConstraintMatches(blocked.ref, source.ref) &&
        blockedConstraintMatches(blocked.path, source.path)
      )
    }
  }

  // densable 2.1.232 #9 Qob: git clone URL vs blockedMarketplaces url entry.
  // Bare github/gitlab HTTPS clones become source:'git' (+ optional .git);
  // enterprise may still list them as source:'url'. Compare with stripDotGit.
  if (source.source === 'git' && blocked.source === 'url') {
    if (!source.url.includes('://')) return false
    const opts = { stripDotGit: true as const }
    return (
      normalizeMarketplaceUrlForBlocklist(source.url, opts) ===
      normalizeMarketplaceUrlForBlocklist(blocked.url, opts)
    )
  }

  return false
}

/**
 * Check if a marketplace source is explicitly in the blocklist.
 * Used for error message differentiation.
 *
 * This also catches attempts to bypass a github blocklist entry by using
 * git URLs (e.g., git@github.com:owner/repo.git or https://github.com/owner/repo.git).
 */
export function isSourceInBlocklist(source: MarketplaceSource): boolean {
  const blocklist = getBlockedMarketplaces()
  if (blocklist === null) {
    return false
  }
  return blocklist.some(blocked =>
    areSourcesEquivalentForBlocklist(source, blocked),
  )
}

/**
 * Check if a marketplace source is allowed by enterprise policy.
 * Returns true if allowed (or no policy), false if blocked.
 * This check happens BEFORE downloading, so blocked sources never touch the filesystem.
 *
 * Policy precedence:
 * 1. blockedMarketplaces (blocklist) - if source matches, it's blocked
 * 2. strictKnownMarketplaces (allowlist) - if set, source must be in the list
 */
export function isSourceAllowedByPolicy(source: MarketplaceSource): boolean {
  // Check blocklist first (takes precedence)
  if (isSourceInBlocklist(source)) {
    return false
  }

  // Then check allowlist
  const allowlist = getStrictKnownMarketplaces()
  if (allowlist === null) {
    return true // No restrictions
  }

  // Check each entry in the allowlist
  return allowlist.some(allowed => {
    // Handle hostPattern entries - match by extracted host
    if (allowed.source === 'hostPattern') {
      return doesSourceMatchHostPattern(source, allowed)
    }
    // Handle pathPattern entries - match file/directory .path by regex
    if (allowed.source === 'pathPattern') {
      return doesSourceMatchPathPattern(source, allowed)
    }
    // Handle regular source entries - exact match
    return areSourcesEqual(source, allowed)
  })
}

/**
 * Format a MarketplaceSource for display in error messages
 */
export function formatSourceForDisplay(source: MarketplaceSource): string {
  switch (source.source) {
    case 'github':
      return `github:${source.repo}${source.ref ? `@${source.ref}` : ''}`
    case 'url':
      return source.url
    case 'git':
      return `git:${source.url}${source.ref ? `@${source.ref}` : ''}`
    case 'npm':
      return `npm:${source.package}`
    case 'file':
      return `file:${source.path}`
    case 'directory':
      return `dir:${source.path}`
    case 'hostPattern':
      return `hostPattern:${source.hostPattern}`
    case 'pathPattern':
      return `pathPattern:${source.pathPattern}`
    case 'settings':
      return `settings:${source.name} (${source.plugins.length} ${plural(source.plugins.length, 'plugin')})`
    default:
      return 'unknown source'
  }
}

/**
 * Reasons why no marketplaces are available in the Discover screen
 */
export type EmptyMarketplaceReason =
  | 'git-not-installed'
  | 'all-blocked-by-policy'
  | 'policy-restricts-sources'
  | 'all-marketplaces-failed'
  | 'no-marketplaces-configured'
  | 'all-plugins-installed'

/**
 * Detect why no marketplaces are available.
 * Checks in order of priority: git availability → policy restrictions → config state → failures
 */
export async function detectEmptyMarketplaceReason({
  configuredMarketplaceCount,
  failedMarketplaceCount,
}: {
  configuredMarketplaceCount: number
  failedMarketplaceCount: number
}): Promise<EmptyMarketplaceReason> {
  // Check if git is installed (required for most marketplace sources)
  const gitAvailable = await checkGitAvailable()
  if (!gitAvailable) {
    return 'git-not-installed'
  }

  // Check policy restrictions
  const allowlist = getStrictKnownMarketplaces()
  if (allowlist !== null) {
    if (allowlist.length === 0) {
      // Policy explicitly blocks all marketplaces
      return 'all-blocked-by-policy'
    }
    // Policy restricts which sources can be used
    if (configuredMarketplaceCount === 0) {
      return 'policy-restricts-sources'
    }
  }

  // Check if any marketplaces are configured
  if (configuredMarketplaceCount === 0) {
    return 'no-marketplaces-configured'
  }

  // Check if all configured marketplaces failed to load
  if (
    failedMarketplaceCount > 0 &&
    failedMarketplaceCount === configuredMarketplaceCount
  ) {
    return 'all-marketplaces-failed'
  }

  // Marketplaces are configured and loaded, but no plugins available
  // This typically means all plugins are already installed
  return 'all-plugins-installed'
}
