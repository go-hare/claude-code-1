import { randomBytes } from 'crypto'
import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'fs/promises'
import { basename, join } from 'path'
import isEqual from 'lodash-es/isEqual.js'
import { logForDebugging } from '../debug.js'
import { isENOENT, toError } from '../errors.js'
import { execFileNoThrow, execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { logError } from '../log.js'
import { getPlatform } from '../platform.js'
import { getSecureStorage } from '../secureStorage/index.js'
import {
  getSettingsForSource,
  persistSettingsForSource,
} from '../settings/settings.js'
import { plural } from '../stringUtils.js'
import { which } from '../which.js'
import { re } from './escapeSafeText.js'
import { checkGitAvailable } from './gitAvailability.js'
import { getMarketplace } from './marketplaceManager.js'
import { getPluginsDirectory } from './pluginDirectories.js'
import type {
  KnownMarketplace,
  MarketplaceSource,
  PluginMarketplace,
} from './schemas.js'
import type { LoadedPlugin } from '../../types/plugin.js'

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

/** densable u8y — schemes whose authority is slash-delimited (pTt backslash check). */
const URL_SCHEMES_WITH_AUTHORITY = new Set([
  'http',
  'https',
  'ws',
  'wss',
  'ftp',
])

/** densable c8y — chars that mean the hostname string is not a plain DNS label. */
const HOSTNAME_META_CHARS = /[:/\\?#@\s]/

/**
 * densable Ldu — hostname contains % / C0 / DEL / non-ASCII (unverifiable).
 */
function hostnameHasUnsafeChars(hostname: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: densable Ldu C0/DEL scan
  return /[%\x00-\x1f\x7f-\u{10FFFF}]/u.test(hostname)
}

/**
 * densable Ndu — strip trailing DNS absolute dots.
 */
function stripTrailingDnsDots(hostname: string): string {
  let end = hostname.length
  while (end > 0 && hostname[end - 1] === '.') end--
  return end === hostname.length ? hostname : hostname.slice(0, end)
}

/**
 * densable H8e — lowercase / strip controls / trailing dots; if the string is a
 * clean hostname, re-parse via `https://` to normalize IDNA / empty userinfo.
 */
function normalizeHostnameForHostPattern(hostname: string): string {
  const cleaned = stripTrailingDnsDots(
    hostname.replace(/[\t\n\r]/g, '').toLowerCase(),
  )
  if (cleaned === '' || HOSTNAME_META_CHARS.test(cleaned)) {
    return cleaned
  }
  try {
    const parsed = new URL(`https://${cleaned}`)
    if (
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.port !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return cleaned
    }
    return stripTrailingDnsDots(parsed.hostname)
  } catch {
    return cleaned
  }
}

/**
 * densable NPs / om — true when hostname is github.com after H8e + www strip.
 * Note: does **not** fold ssh.github.com (WAd blocklistDirection handles that).
 */
function isGithubComHostForPattern(hostname: string): boolean {
  let h = normalizeHostnameForHostPattern(hostname)
  while (h.startsWith('www.')) {
    h = h.slice(4)
  }
  return h === GITHUB_COM
}

/**
 * densable SCn — H8e then map plain github.com (+www) → `github.com`.
 * Leaves `ssh.github.com` intact for allowlist hostPattern; blocklist WAd dual-tests.
 */
export function canonicalizeHostForHostPattern(hostname: string): string {
  const normalized = normalizeHostnameForHostPattern(hostname)
  return isGithubComHostForPattern(normalized) ? GITHUB_COM : normalized
}

/**
 * densable pTt / x5o (`isGitUrlHostAmbiguous`) — URL authority contains `\`
 * (or scheme-relative `\\`), so WHATWG host ≠ what some git clients resolve.
 */
export function isGitUrlHostAmbiguous(url: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: densable pTt trim C0/space
  const trimmed = url.replace(/^[\x00-\x20]+/, '')
  const schemeSep = trimmed.indexOf('://')
  if (schemeSep === -1) return false
  let authorityAndPath = trimmed.slice(schemeSep + 3)
  const scheme = trimmed.slice(0, schemeSep).toLowerCase()
  if (URL_SCHEMES_WITH_AUTHORITY.has(scheme)) {
    const leadingSlashes = authorityAndPath.match(/^[/\\]+/)?.[0] ?? ''
    if (leadingSlashes.includes('\\')) return true
    authorityAndPath = authorityAndPath.slice(leadingSlashes.length)
  }
  const end = authorityAndPath.search(/[/?#]/)
  const authority =
    end === -1 ? authorityAndPath : authorityAndPath.slice(0, end)
  return authority.includes('\\')
}

/**
 * densable I8s — strict SCP `user@host:path` (no `@`/`:`/`/`/`[`/`]` in user/host).
 * Returns null when the naive `[^@]+@([^:]+):` extractor would accept a
 * host that git would not connect to under SCP rules.
 */
export function parseScpGitUrl(
  url: string,
): { user: string; host: string; path: string } | null {
  const match = /^([^@:/[\]]+)@([^@:/[\]]+):(.*)$/s.exec(url)
  if (!match) return null
  return { user: match[1]!, host: match[2]!, path: match[3]! }
}

/**
 * densable BAd — marketplace.json `path` must be relative, no drive/UNC, no `..`.
 */
export function isSafeRelativeMarketplacePath(path: string): boolean {
  if (
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[A-Za-z]:/.test(path)
  ) {
    return false
  }
  return !path.split(/[\\/]/).some(seg => seg === '..')
}

/**
 * densable Obn — git URL is unverifiable for allowlist matching (ambiguous
 * authority, non-http(s) with unsafe host chars, or `:` before `@` in SCP form).
 */
export function isUnverifiableGitMarketplaceUrl(url: string): boolean {
  if (url.includes('://')) {
    if (isGitUrlHostAmbiguous(url)) return true
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return false
      }
      return hostnameHasUnsafeChars(parsed.hostname)
    } catch {
      return true
    }
  }
  const colon = url.indexOf(':')
  const at = url.indexOf('@')
  if (colon >= 0 && at > colon) return true
  const host = url.match(/^(?:[^@]+@)?([^:]+):/)?.[1]
  return host ? hostnameHasUnsafeChars(host) : false
}

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
      return includeReasons ? `${re(f.name)} (${re(reason)})` : re(f.name)
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
 * densable `$u` zip-stem note — catalog entries whose source is claudeai
 * with a non-empty version that does not match the installed zip stem.
 * Does not add MarketplaceSourceSchema `claudeai` (hosted control plane).
 */
export function countClaudeAiZipStemMismatches(
  catalog: PluginMarketplace | null | undefined,
  installed: ReadonlyArray<Pick<LoadedPlugin, 'name' | 'path'>>,
): number {
  if (!catalog) return 0
  let n = 0
  for (const plugin of installed) {
    const entry = catalog.plugins.find(p => p.name === plugin.name)
    if (!entry || typeof entry.source !== 'object' || entry.source === null) {
      continue
    }
    const src = entry.source as {
      source?: string
      version?: string
    }
    if (
      src.source !== 'claudeai' ||
      src.version === undefined ||
      src.version === ''
    ) {
      continue
    }
    // densable Of(oe.path) — basename, then strip trailing .zip
    const base = plugin.path.split(/[/\\]/).pop() ?? plugin.path
    const stem = base.replace(/\.zip$/i, '')
    if (stem !== src.version) n++
  }
  return n
}

/**
 * densable `$u` note: failure copy, else zip-stem updates.
 * `N plugin update(s) available · update the marketplace to apply`
 */
export function formatClaudeAiMarketplaceNote(
  mismatchCount: number,
  loadError?: string,
): string | undefined {
  if (loadError) return loadError
  if (mismatchCount <= 0) return undefined
  return `${mismatchCount} plugin ${plural(mismatchCount, 'update')} available · update the marketplace to apply`
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

  // densable vCn → JAd allowlist match (same gates as isSourceAllowedByPolicy)
  return strict.some(allowed => doesSourceMatchAllowlistEntry(source, allowed))
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
 * densable Utb — raw host extraction before SCn canonicalize.
 * Git SCP form still uses the naive `[^@]+@([^:]+):` capture (blocklist O7t);
 * allowlist uses {@link extractHostFromSourceForAllowlist} / I8s instead.
 */
function extractRawHostFromSource(source: MarketplaceSource): string | null {
  switch (source.source) {
    case 'github':
      return GITHUB_COM

    case 'git': {
      if (source.url.includes('://')) {
        if (isGitUrlHostAmbiguous(source.url)) return null
        try {
          return new URL(source.url).hostname || null
        } catch {
          return null
        }
      }
      // densable Utb naive SCP (intentionally NOT I8s — that is allowlist-only)
      return source.url.match(/^[^@]+@([^:]+):/)?.[1] ?? null
    }

    case 'url':
      try {
        return new URL(source.url).hostname
      } catch {
        return null
      }

    default:
      return null
  }
}

/**
 * densable O7t — host for blocklist hostPattern (Utb → SCn).
 * Also the shared fallback for non-SCP sources on the allowlist path.
 */
export function extractHostFromSource(
  source: MarketplaceSource,
): string | null {
  const raw = extractRawHostFromSource(source)
  return raw === null ? null : canonicalizeHostForHostPattern(raw)
}

/**
 * densable zAd — host for allowlist hostPattern.
 * SCP-without-`://` must parse via I8s; ambiguous / non-SCP forms fail closed.
 */
export function extractHostFromSourceForAllowlist(
  source: MarketplaceSource,
): string | null {
  if (source.source === 'git' && !source.url.includes('://')) {
    const scp = parseScpGitUrl(source.url)
    return scp ? canonicalizeHostForHostPattern(scp.host) : null
  }
  return extractHostFromSource(source)
}

/**
 * densable WAd — hostPattern match.
 * Allowlist uses zAd; blocklistDirection uses O7t and dual-tests ssh.github.com
 * against github.com (q7s → i_).
 */
export function doesSourceMatchHostPattern(
  source: MarketplaceSource,
  pattern: MarketplaceSource & { source: 'hostPattern' },
  options?: { blocklistDirection?: boolean },
): boolean {
  const host = options?.blocklistDirection
    ? extractHostFromSource(source)
    : extractHostFromSourceForAllowlist(source)
  if (!host) {
    return false
  }

  const hostsToTest =
    options?.blocklistDirection && host === SSH_GITHUB_COM
      ? [host, GITHUB_COM]
      : [host]

  try {
    const regex = new RegExp(pattern.hostPattern)
    return hostsToTest.some(candidate => regex.test(candidate))
  } catch {
    logForDebugging(
      `Invalid hostPattern regex in policy settings: ${pattern.hostPattern}`,
      { level: 'error' },
    )
    return false
  }
}

/**
 * densable GAd — pathPattern match (file / directory `.path` only).
 */
function doesSourceMatchPathPattern(
  source: MarketplaceSource,
  pattern: MarketplaceSource & { source: 'pathPattern' },
): boolean {
  if (source.source !== 'file' && source.source !== 'directory') {
    return false
  }

  try {
    return new RegExp(pattern.pathPattern).test(source.path)
  } catch {
    logForDebugging(
      `Invalid pathPattern regex in policy settings strictKnownMarketplaces: ${pattern.pathPattern}`,
      { level: 'error' },
    )
    return false
  }
}

/**
 * densable JAd — does `source` match one allowlist entry?
 * Fail-closed on unverifiable git URLs; hostPattern rejects unsafe relative paths.
 * Exported for unit tests; production uses `isSourceAllowedByPolicy`.
 */
export function doesSourceMatchAllowlistEntry(
  source: MarketplaceSource,
  allowed: MarketplaceSource,
): boolean {
  if (source.source === 'git' && isUnverifiableGitMarketplaceUrl(source.url)) {
    return false
  }

  if (allowed.source === 'hostPattern') {
    if (
      (source.source === 'github' || source.source === 'git') &&
      source.path &&
      !isSafeRelativeMarketplacePath(source.path)
    ) {
      return false
    }
    return doesSourceMatchHostPattern(source, allowed)
  }

  if (allowed.source === 'pathPattern') {
    return doesSourceMatchPathPattern(source, allowed)
  }

  // densable JAd github+github owner/* branch (ztb case-sensitive; path absent → BAd).
  if (source.source === 'github' && allowed.source === 'github') {
    const owner = parseOwnerWildcardRepo(allowed.repo)
    if (owner === null && allowed.repo.includes('*')) {
      logForDebugging(
        `Invalid owner-wildcard repo in policy settings strictKnownMarketplaces: ${allowed.repo} (only "<owner>/*" is supported); entry only matches a literally identical repo string`,
        { level: 'error' },
      )
    }
    if (owner !== null) {
      const segs = source.repo.split('/')
      if (segs.length !== 2) return false
      const [srcOwner, srcName] = segs
      if (
        srcOwner === undefined ||
        srcName === undefined ||
        !isValidGithubNameSegment(srcOwner) ||
        !isValidGithubNameSegment(srcName)
      ) {
        return false
      }
      // densable ztb — case-sensitive owner equality (not githubRepoPolicyMatches)
      if (srcOwner !== owner) return false
      if ((allowed.ref || undefined) !== (source.ref || undefined)) return false
      if (allowed.path) {
        return allowed.path === (source.path || undefined)
      }
      return !source.path || isSafeRelativeMarketplacePath(source.path)
    }
  }

  // densable skills-dir allowlist entries never match network marketplace sources.
  // Local MarketplaceSourceSchema may not yet include skills-dir; compare as string.
  if ((allowed as { source: string }).source === 'skills-dir') {
    return false
  }

  return areSourcesEqual(source, allowed)
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
/**
 * densable jDr — blocklist match (hostPattern via WAd blocklistDirection).
 */
export function isSourceInBlocklist(source: MarketplaceSource): boolean {
  const blocklist = getBlockedMarketplaces()
  if (blocklist === null) {
    return false
  }
  return blocklist.some(blocked => {
    if (blocked.source === 'hostPattern') {
      return doesSourceMatchHostPattern(source, blocked, {
        blocklistDirection: true,
      })
    }
    if (blocked.source === 'pathPattern') {
      return doesSourceMatchPathPattern(source, blocked)
    }
    return areSourcesEquivalentForBlocklist(source, blocked)
  })
}

/**
 * densable pL — enterprise policy allow check.
 * Ambiguous git URLs (`x5o`/`pTt`) fail closed before allowlist matching.
 *
 * Policy precedence:
 * 1. blockedMarketplaces (blocklist) - if source matches, it's blocked
 * 2. strictKnownMarketplaces (allowlist) - if set, source must be in the list
 */
export function isSourceAllowedByPolicy(source: MarketplaceSource): boolean {
  // densable pL: git + x5o → deny before blocklist/allowlist
  if (source.source === 'git' && isGitUrlHostAmbiguous(source.url)) {
    return false
  }

  if (isSourceInBlocklist(source)) {
    return false
  }

  const allowlist = getStrictKnownMarketplaces()
  if (allowlist === null) {
    return true
  }

  return allowlist.some(allowed =>
    doesSourceMatchAllowlistEntry(source, allowed),
  )
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

export type SshProbeResult = 'configured' | 'not-configured' | 'unknown'

export type SshProbeHandle = {
  probeSsh: () => Promise<SshProbeResult>
}

/**
 * Official `z8e` — true when an SSH failure message indicates missing/rejected
 * SSH keys or unknown host key rather than a transient network error.
 */
export function isSshAuthError(message: string): boolean {
  return (
    message.includes('Permission denied (publickey') ||
    message.includes('Host key verification failed')
  )
}

/**
 * Official `eQt` — parse `ssh -G` output and confirm `git@github.com` connects
 * directly to `github.com` without ProxyCommand or ProxyJump.
 */
export function isDirectGithubSshConfig(sshGOutput: string): boolean {
  const lines = sshGOutput.split('\n').map(line => line.trim().toLowerCase())
  return (
    lines.includes('hostname github.com') &&
    !lines.some(line => /^proxy(command|jump)(?! none$)/.test(line))
  )
}

/**
 * Official `nQt` — probe `ssh -T ... git@github.com` to see if GitHub SSH is configured.
 */
export async function probeSsh(
  cwd?: string,
  execFn = execFileNoThrowWithCwd,
  whichFn = which,
): Promise<SshProbeResult> {
  try {
    const result = await execFn(
      'ssh',
      [
        '-T',
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=2',
        '-o',
        'StrictHostKeyChecking=yes',
        'git@github.com',
      ],
      { cwd, timeout: 3000 },
    )
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    const configured =
      result.code === 1 && combined.includes('successfully authenticated')
    logForDebugging(
      `SSH config check: code=${result.code} configured=${configured}`,
    )
    if (configured) return 'configured'
    if (result.error?.includes('timed out')) return 'unknown'
    if (result.code === 255 && isSshAuthError(combined)) {
      return 'not-configured'
    }
    return (await whichFn('ssh')) === null ? 'not-configured' : 'unknown'
  } catch (err) {
    logForDebugging(`SSH configuration check failed: ${toError(err).message}`, {
      level: 'warn',
    })
    return 'unknown'
  }
}

export function createSshProbe(cwd?: string): SshProbeHandle {
  let cached: Promise<SshProbeResult> | undefined
  return {
    probeSsh: () => (cached ??= probeSsh(cwd)),
  }
}

/**
 * Official `G8e` — decide whether a GitHub `owner/repo` clone should use HTTPS
 * instead of SSH. On Windows (`onWindows = true`), this runs after an SSH
 * `Permission denied` / host-key failure to check `git ls-remote` with `-G`.
 * On non-Windows (`onWindows = false`), this runs pre-clone.
 */
export async function shouldUseHttpsInsteadOfSsh(
  sshProbe: SshProbeHandle,
  sshUrl: string,
  onWindows: boolean,
  deps: {
    platform?: string
    env?: NodeJS.ProcessEnv
    cwd?: string
    execFn?: typeof execFileNoThrowWithCwd
    whichFn?: typeof which
  } = {},
): Promise<boolean> {
  const platform = deps.platform ?? getPlatform()
  const isWin = platform === 'windows'
  if (isWin !== onWindows) return false

  const env = deps.env ?? process.env
  if (env.GIT_SSH_COMMAND !== undefined || env.GIT_SSH !== undefined) {
    return false
  }

  const execFn = deps.execFn ?? execFileNoThrowWithCwd
  const whichFn = deps.whichFn ?? which

  const getUrlRes = await execFn(
    'git',
    ['ls-remote', '--get-url', '--', sshUrl],
    { cwd: deps.cwd, env, stdin: 'ignore', timeout: 5000 },
  )
  if (getUrlRes.code !== 0 || getUrlRes.stdout.trim() !== sshUrl) {
    logForDebugging(
      `GitHub SSH URL is rewritten by git config, or git could not say (code=${getUrlRes.code}): staying on SSH`,
    )
    return false
  }

  if (isWin) {
    const baseSshCmd = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'
    const lsRemoteRes = await execFn('git', ['ls-remote', '--', sshUrl], {
      cwd: deps.cwd,
      env: { ...env, GIT_SSH_COMMAND: `${baseSshCmd} -G >&2` },
      stdin: 'ignore',
      timeout: 5000,
    })
    return (
      !lsRemoteRes.error?.includes('timed out') &&
      isDirectGithubSshConfig(lsRemoteRes.stderr)
    )
  }

  if ((await sshProbe.probeSsh()) !== 'not-configured') return false
  if ((await whichFn('ssh')) === null) return true

  const sshGRes = await execFn('ssh', ['-G', 'git@github.com'], {
    cwd: deps.cwd,
    env,
    timeout: 5000,
  })
  if (sshGRes.code === 0 && isDirectGithubSshConfig(sshGRes.stdout)) {
    return true
  }
  logForDebugging(
    `ssh -G does not show git@github.com going straight to github.com (code=${sshGRes.code}): staying on SSH`,
  )
  return false
}

// ============================================================================
// #1948 & #1960 (2.1.321): Managed extraKnownMarketplaces takeover & set-aside
// ============================================================================

export const SET_ASIDE_KEY_PREFIX = '.set-aside/'
const LEFT_BEHIND_MARKER_RE = /^left-behind\.([a-zA-Z0-9_-]+)\.txt$/
const SET_ASIDE_HOLDER_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.[0-9a-f]{12}$/

/**
 * #1948: Read `extraKnownMarketplaces` declared in managed (`policySettings`)
 * settings.
 */
export function getManagedExtraKnownMarketplaces(): Record<
  string,
  { source: MarketplaceSource }
> {
  const policy = getSettingsForSource('policySettings')
  const extras = policy?.extraKnownMarketplaces
  if (!extras || typeof extras !== 'object') {
    return {}
  }
  const out: Record<string, { source: MarketplaceSource }> = {}
  for (const [name, entry] of Object.entries(extras)) {
    if (
      entry &&
      typeof entry === 'object' &&
      'source' in entry &&
      entry.source
    ) {
      out[name] = { source: entry.source as MarketplaceSource }
    }
  }
  return out
}

/**
 * #1948: Look up a managed `extraKnownMarketplaces` declaration by marketplace
 * name (case-insensitive).
 */
export function getManagedExtraKnownMarketplaceSource(
  marketplaceName: string,
): MarketplaceSource | undefined {
  const managed = getManagedExtraKnownMarketplaces()
  const lower = marketplaceName.toLowerCase()
  for (const [name, entry] of Object.entries(managed)) {
    if (name.toLowerCase() === lower) {
      return entry.source
    }
  }
  return undefined
}

/**
 * #1948: Returns true when `marketplaceName` is declared in managed
 * `extraKnownMarketplaces` with a DIFFERENT source than `candidateSource`.
 * A declared name cannot be added from another source.
 */
export function isMarketplaceNameBlockedByManagedDeclaration(
  marketplaceName: string,
  candidateSource: MarketplaceSource,
): boolean {
  const managedSource = getManagedExtraKnownMarketplaceSource(marketplaceName)
  if (managedSource === undefined) {
    return false
  }
  return !areSourcesEquivalentForBlocklist(candidateSource, managedSource)
}

/**
 * #1948: Filter a `known_marketplaces.json` map so entries whose name is
 * declared in managed `extraKnownMarketplaces` from a different source are
 * hidden rather than served to plugin discovery/loading.
 */
export function filterKnownMarketplacesForManagedTakeover<
  T extends { source: MarketplaceSource },
>(
  known: Record<string, T>,
): { visible: Record<string, T>; hidden: Record<string, T> } {
  const visible: Record<string, T> = {}
  const hidden: Record<string, T> = {}
  for (const [name, entry] of Object.entries(known)) {
    if (isMarketplaceNameBlockedByManagedDeclaration(name, entry.source)) {
      hidden[name] = entry
      logForDebugging(
        `Hiding marketplace "${name}" from undeclared source (${formatSourceForDisplay(entry.source)}): managed extraKnownMarketplaces declares this name from another source`,
      )
    } else {
      visible[name] = entry
    }
  }
  return { visible, hidden }
}

/**
 * #1960: Root folder holding set-aside plugin data directories
 * (`<pluginsDir>/data/.set-aside`).
 */
export function getPluginSetAsideRootDir(
  pluginsDir: string = getPluginsDirectory(),
): string {
  return join(pluginsDir, 'data', '.set-aside')
}

/**
 * #1960: Generate a timestamped holder token (`YYYY-MM-DDTHH-MM-SSZ.<hex12>`).
 */
export function makeSetAsideToken(now: Date = new Date()): string {
  return `${now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-')}.${randomBytes(6).toString('hex')}`
}

/**
 * #1960: Parse a holder directory name back to epoch ms (undefined if invalid).
 */
export function parseSetAsideHolderTimestamp(name: string): number | undefined {
  const match = SET_ASIDE_HOLDER_RE.exec(name)
  if (!match) return undefined
  const ts = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`)
  return Number.isNaN(ts) ? undefined : ts
}

/**
 * #1960: Build a `.set-aside/<token>/<key>` storage key for options/secrets.
 */
export function makeSetAsideStorageKey(token: string, key: string): string {
  return `${SET_ASIDE_KEY_PREFIX}${token}/${key}`
}

/**
 * #1960: Parse a `.set-aside/<token>/<rest>` key into `{ token, innerKey }`.
 */
export function parseSetAsideStorageKey(
  storageKey: string,
): { token: string; innerKey: string } | undefined {
  if (!storageKey.startsWith(SET_ASIDE_KEY_PREFIX)) return undefined
  const slash = storageKey.indexOf('/', SET_ASIDE_KEY_PREFIX.length)
  if (slash === -1) return undefined
  return {
    token: storageKey.slice(SET_ASIDE_KEY_PREFIX.length, slash),
    innerKey: storageKey.slice(slash + 1),
  }
}

async function moveDirectoryEntryByEntry(
  srcDir: string,
  destDir: string,
): Promise<boolean> {
  let entries: string[]
  try {
    entries = await readdir(srcDir)
    await mkdir(destDir, { recursive: true })
  } catch (err) {
    logForDebugging(
      `Plugin data folder ${srcDir} could not be set aside entry by entry: ${toError(err).message}`,
      { level: 'warn' },
    )
    return false
  }
  let allMoved = true
  for (const entry of entries) {
    const srcPath = join(srcDir, entry)
    const destPath = join(destDir, entry)
    try {
      await rename(srcPath, destPath)
    } catch (err) {
      if (!isENOENT(err)) {
        const st = await lstat(srcPath).catch(() => undefined)
        if (st?.isDirectory() && !st.isSymbolicLink()) {
          allMoved =
            (await moveDirectoryEntryByEntry(srcPath, destPath)) && allMoved
        } else {
          allMoved = false
        }
      }
    }
  }
  if (!allMoved) {
    await rmdir(destDir).catch(() => {})
    return false
  }
  try {
    await rmdir(srcDir)
    return true
  } catch {
    return false
  }
}

/**
 * #1960: Move a plugin's saved data folder into `<pluginsDir>/data/.set-aside/<token>/<name>`
 * so a managed-marketplace takeover does not expose old saved data to the replacement plugin
 * while still preserving it for `cleanupPeriodDays`.
 */
export async function setAsidePluginDataDir(
  dataDir: string,
  opts?: { pluginsDir?: string; token?: string },
): Promise<'moved' | 'absent' | 'failed'> {
  const st = await lstat(dataDir).catch(() => undefined)
  if (!st) {
    return 'absent'
  }
  if (st.isDirectory() && !st.isSymbolicLink()) {
    const entries = await readdir(dataDir).catch(() => [])
    if (entries.length === 0) {
      await rmdir(dataDir).catch(() => {})
      return 'absent'
    }
  }
  const token = opts?.token ?? makeSetAsideToken()
  const holderDir = join(getPluginSetAsideRootDir(opts?.pluginsDir), token)
  const targetDir = join(holderDir, basename(dataDir))
  try {
    await mkdir(holderDir, { recursive: true })
  } catch (err) {
    logForDebugging(
      `Plugin data folder ${dataDir} stays: ${holderDir} could not be made: ${toError(err).message}`,
      { level: 'warn' },
    )
    return 'failed'
  }
  try {
    await rename(dataDir, targetDir)
    return 'moved'
  } catch (err) {
    logForDebugging(
      `Plugin data folder ${dataDir} did not move to ${targetDir} as a whole: ${toError(err).message}`,
      { level: 'warn' },
    )
  }
  const stillThere = await lstat(dataDir).catch(() => undefined)
  if (!stillThere) {
    await rmdir(holderDir).catch(() => {})
    return 'absent'
  }
  if (
    stillThere.isDirectory() &&
    !stillThere.isSymbolicLink() &&
    (await moveDirectoryEntryByEntry(dataDir, targetDir))
  ) {
    return 'moved'
  }
  await writeFile(
    join(holderDir, `left-behind.${basename(dataDir)}.txt`),
    '',
  ).catch(() => {})
  return 'failed'
}

/**
 * #1960: List set-aside data holder directories and any `left-behind` data dirs.
 */
export async function listSetAsidePluginData(opts?: {
  pluginsDir?: string
}): Promise<{ holders: string[]; leftBehind: string[] }> {
  const pluginsDir = opts?.pluginsDir ?? getPluginsDirectory()
  const root = getPluginSetAsideRootDir(pluginsDir)
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return { holders: [], leftBehind: [] }
  }
  const holders: string[] = []
  const leftBehind = new Set<string>()
  for (const name of entries.sort()) {
    if (parseSetAsideHolderTimestamp(name) === undefined) continue
    const holderDir = join(root, name)
    const children = await readdir(holderDir).catch(() => [])
    if (children.some(c => !LEFT_BEHIND_MARKER_RE.test(c))) {
      holders.push(holderDir)
    }
    for (const c of children) {
      const m = LEFT_BEHIND_MARKER_RE.exec(c)
      if (m?.[1]) {
        const origDir = join(pluginsDir, 'data', m[1])
        const origChildren = await readdir(origDir).catch(() => [])
        if (origChildren.length > 0) {
          leftBehind.add(origDir)
        }
      }
    }
  }
  return { holders, leftBehind: [...leftBehind] }
}

/**
 * #1960: Remove set-aside data folders older than `cleanupPeriodDays`.
 */
export async function pruneExpiredSetAsideData(
  cleanupPeriodDays: number,
  opts?: { pluginsDir?: string; nowMs?: number },
): Promise<string[]> {
  if (!Number.isFinite(cleanupPeriodDays) || cleanupPeriodDays <= 0) {
    return []
  }
  const root = getPluginSetAsideRootDir(opts?.pluginsDir)
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const cutoffMs =
    (opts?.nowMs ?? Date.now()) - cleanupPeriodDays * 24 * 60 * 60 * 1000
  const removed: string[] = []
  for (const name of entries) {
    const ts = parseSetAsideHolderTimestamp(name)
    if (ts === undefined || ts >= cutoffMs) continue
    const holderDir = join(root, name)
    try {
      await rm(holderDir, { recursive: true, force: true })
      removed.push(holderDir)
    } catch {
      // best-effort cleanup
    }
  }
  return removed
}

export type SetAsideRestoreResult = {
  options: number
  secrets: number
  failed?: 'settings' | 'secrets'
}

type SetAsideStorageSeams = {
  readUserPluginConfigs?: () => Record<string, unknown> | undefined
  writeUserPluginConfigs?: (
    patch: Record<string, unknown>,
  ) => Promise<{ error?: Error | null }>
  readSecrets?: () => Promise<Record<string, unknown> | undefined>
  writeSecrets?: (
    nextPluginSecrets: Record<string, unknown>,
  ) => Promise<boolean>
}

function defaultReadUserPluginConfigs(): Record<string, unknown> | undefined {
  return getSettingsForSource('userSettings')?.pluginConfigs as
    | Record<string, unknown>
    | undefined
}

async function defaultWriteUserPluginConfigs(
  patch: Record<string, unknown>,
): Promise<{ error?: Error | null }> {
  type UserPluginConfigs = NonNullable<
    NonNullable<ReturnType<typeof getSettingsForSource>>['pluginConfigs']
  >
  return persistSettingsForSource('userSettings', {
    pluginConfigs: patch as UserPluginConfigs,
  })
}

/**
 * #1960: Set aside a plugin's options (`userSettings.pluginConfigs[pluginId]`)
 * and secrets (`secureStorage.pluginSecrets[pluginId*]`) under `.set-aside/<token>/...`.
 */
export async function setAsidePluginOptionsAndSecrets(
  pluginId: string,
  opts?: { token?: string; seams?: SetAsideStorageSeams },
): Promise<{ optionsMoved: number; secretsMoved: number }> {
  const token = opts?.token ?? makeSetAsideToken()
  let optionsMoved = 0
  let secretsMoved = 0

  const readConfigs =
    opts?.seams?.readUserPluginConfigs ?? defaultReadUserPluginConfigs
  const writeConfigs =
    opts?.seams?.writeUserPluginConfigs ?? defaultWriteUserPluginConfigs

  const configs = readConfigs()
  if (
    configs &&
    Object.hasOwn(configs, pluginId) &&
    configs[pluginId] !== undefined
  ) {
    const patch: Record<string, unknown> = {
      [pluginId]: undefined,
      [makeSetAsideStorageKey(token, pluginId)]: configs[pluginId],
    }
    const { error } = await writeConfigs(patch)
    if (!error) {
      optionsMoved = 1
    } else {
      logForDebugging(
        `setAsidePluginOptionsAndSecrets: failed to move pluginConfigs[${pluginId}]: ${error.message}`,
        { level: 'warn' },
      )
    }
  }

  try {
    if (opts?.seams?.readSecrets && opts?.seams?.writeSecrets) {
      const secrets = (await opts.seams.readSecrets()) ?? {}
      const prefix = `${pluginId}/`
      const next: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(secrets)) {
        if (k === pluginId || k.startsWith(prefix)) {
          next[makeSetAsideStorageKey(token, k)] = v
          secretsMoved++
        } else {
          next[k] = v
        }
      }
      if (secretsMoved > 0) {
        const ok = await opts.seams.writeSecrets(next)
        if (!ok) secretsMoved = 0
      }
    } else {
      const storage = getSecureStorage()
      const current = (await storage.readAsync?.()) ?? storage.read()
      const existingSecrets = (current?.pluginSecrets ?? {}) as Record<
        string,
        unknown
      >
      const prefix = `${pluginId}/`
      const matchingKeys = Object.keys(existingSecrets).filter(
        k => k === pluginId || k.startsWith(prefix),
      )
      if (matchingKeys.length > 0 && current) {
        const nextSecrets: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(existingSecrets)) {
          if (k === pluginId || k.startsWith(prefix)) {
            nextSecrets[makeSetAsideStorageKey(token, k)] = v
            secretsMoved++
          } else {
            nextSecrets[k] = v
          }
        }
        storage.update({
          ...current,
          pluginSecrets: nextSecrets as typeof current.pluginSecrets,
        })
      }
    }
  } catch (err) {
    logForDebugging(
      `setAsidePluginOptionsAndSecrets: failed to move secrets for ${pluginId}: ${toError(err).message}`,
      { level: 'warn' },
    )
    secretsMoved = 0
  }

  return { optionsMoved, secretsMoved }
}

/**
 * #1960: List plugin IDs that currently have set-aside options or secrets.
 */
export async function listSetAsidePluginIds(
  seams?: SetAsideStorageSeams,
): Promise<string[]> {
  const ids = new Set<string>()
  const configs = (
    seams?.readUserPluginConfigs ?? defaultReadUserPluginConfigs
  )()
  for (const key of Object.keys(configs ?? {})) {
    const parsed = parseSetAsideStorageKey(key)
    if (parsed) {
      ids.add(parsed.innerKey)
    }
  }
  try {
    let secrets: Record<string, unknown> | undefined
    if (seams?.readSecrets) {
      secrets = await seams.readSecrets()
    } else {
      const storage = getSecureStorage()
      const current = (await storage.readAsync?.()) ?? storage.read()
      secrets = current?.pluginSecrets as Record<string, unknown> | undefined
    }
    for (const key of Object.keys(secrets ?? {})) {
      const parsed = parseSetAsideStorageKey(key)
      if (parsed) {
        const slash = parsed.innerKey.indexOf('/')
        ids.add(
          slash === -1 ? parsed.innerKey : parsed.innerKey.slice(0, slash),
        )
      }
    }
  } catch {
    // best-effort listing
  }
  return [...ids].sort()
}

/**
 * #1960: Restore (or `--discard`) options and secrets set aside for `pluginId`.
 */
export async function restoreSetAsidePluginOptionsAndSecrets(
  pluginId: string,
  opts?: { discard?: boolean; seams?: SetAsideStorageSeams },
): Promise<SetAsideRestoreResult> {
  const discard = opts?.discard === true
  const readConfigs =
    opts?.seams?.readUserPluginConfigs ?? defaultReadUserPluginConfigs
  const writeConfigs =
    opts?.seams?.writeUserPluginConfigs ?? defaultWriteUserPluginConfigs

  let optionsCount = 0
  let secretsCount = 0

  // 1. Options in userSettings.pluginConfigs
  const configs = readConfigs() ?? {}
  const matchingOptionKeys = Object.keys(configs)
    .filter(k => parseSetAsideStorageKey(k)?.innerKey === pluginId)
    .sort()
  if (matchingOptionKeys.length > 0) {
    const patch: Record<string, unknown> = {}
    for (const k of matchingOptionKeys) {
      patch[k] = undefined
    }
    if (!discard) {
      const latestKey = matchingOptionKeys[matchingOptionKeys.length - 1]!
      patch[pluginId] = configs[latestKey]
    }
    const { error } = await writeConfigs(patch)
    if (error) {
      return { options: 0, secrets: 0, failed: 'settings' }
    }
    optionsCount = matchingOptionKeys.length
  }

  // 2. Secrets in secureStorage.pluginSecrets
  const prefix = `${pluginId}/`
  const matchesSecretInner = (inner: string): boolean =>
    inner === pluginId || inner.startsWith(prefix)

  try {
    if (opts?.seams?.readSecrets && opts?.seams?.writeSecrets) {
      const secrets = (await opts.seams.readSecrets()) ?? {}
      const matchingKeys = Object.keys(secrets)
        .filter(k => {
          const parsed = parseSetAsideStorageKey(k)
          return parsed !== undefined && matchesSecretInner(parsed.innerKey)
        })
        .sort()
      if (matchingKeys.length > 0) {
        const next: Record<string, unknown> = {}
        const matchSet = new Set(matchingKeys)
        for (const [k, v] of Object.entries(secrets)) {
          if (!matchSet.has(k)) {
            next[k] = v
          }
        }
        if (!discard) {
          for (const k of matchingKeys) {
            const parsed = parseSetAsideStorageKey(k)!
            next[parsed.innerKey] = secrets[k]
          }
        }
        const ok = await opts.seams.writeSecrets(next)
        if (!ok) {
          return { options: optionsCount, secrets: 0, failed: 'secrets' }
        }
        secretsCount = matchingKeys.length
      }
    } else {
      const storage = getSecureStorage()
      const current = (await storage.readAsync?.()) ?? storage.read()
      const secrets = (current?.pluginSecrets ?? {}) as Record<string, unknown>
      const matchingKeys = Object.keys(secrets)
        .filter(k => {
          const parsed = parseSetAsideStorageKey(k)
          return parsed !== undefined && matchesSecretInner(parsed.innerKey)
        })
        .sort()
      if (matchingKeys.length > 0 && current) {
        const next: Record<string, unknown> = {}
        const matchSet = new Set(matchingKeys)
        for (const [k, v] of Object.entries(secrets)) {
          if (!matchSet.has(k)) {
            next[k] = v
          }
        }
        if (!discard) {
          for (const k of matchingKeys) {
            const parsed = parseSetAsideStorageKey(k)!
            next[parsed.innerKey] = secrets[k]
          }
        }
        const writeRes = storage.update({
          ...current,
          pluginSecrets: next as typeof current.pluginSecrets,
        })
        if (!writeRes.success) {
          return { options: optionsCount, secrets: 0, failed: 'secrets' }
        }
        secretsCount = matchingKeys.length
      }
    }
  } catch {
    return { options: optionsCount, secrets: 0, failed: 'secrets' }
  }

  return { options: optionsCount, secrets: secretsCount }
}

/**
 * #1948 & #1960: Reconcile a managed `extraKnownMarketplaces` takeover of a
 * marketplace previously registered from an undeclared source:
 * 1. Sets aside each previously installed plugin's data dir, options, and secrets.
 * 2. Reinstalls plugins that the newly declared managed marketplace lists.
 */
export async function reconcileManagedMarketplaceTakeover(opts: {
  marketplaceName: string
  previousSource: MarketplaceSource
  managedSource: MarketplaceSource
  installedPluginIds: readonly string[]
  declaredMarketplacePluginNames: readonly string[]
  getDataDir: (pluginId: string) => string
  reinstallPlugin?: (pluginId: string) => Promise<boolean>
  pluginsDir?: string
  seams?: SetAsideStorageSeams
}): Promise<{
  takenOver: boolean
  setAsidePluginIds: string[]
  reinstalledPluginIds: string[]
}> {
  if (
    areSourcesEquivalentForBlocklist(opts.previousSource, opts.managedSource)
  ) {
    return {
      takenOver: false,
      setAsidePluginIds: [],
      reinstalledPluginIds: [],
    }
  }

  const suffix = `@${opts.marketplaceName.toLowerCase()}`
  const affected = opts.installedPluginIds.filter(id =>
    id.toLowerCase().endsWith(suffix),
  )
  const token = makeSetAsideToken()
  const setAsidePluginIds: string[] = []
  for (const pluginId of affected) {
    await setAsidePluginDataDir(opts.getDataDir(pluginId), {
      pluginsDir: opts.pluginsDir,
      token,
    })
    await setAsidePluginOptionsAndSecrets(pluginId, {
      token,
      seams: opts.seams,
    })
    setAsidePluginIds.push(pluginId)
  }

  const declaredNamesLower = new Set(
    opts.declaredMarketplacePluginNames.map(n => n.toLowerCase()),
  )
  const reinstalledPluginIds: string[] = []
  for (const pluginId of affected) {
    const atIdx = pluginId.lastIndexOf('@')
    const pluginName = atIdx === -1 ? pluginId : pluginId.slice(0, atIdx)
    if (!declaredNamesLower.has(pluginName.toLowerCase())) {
      continue
    }
    if (opts.reinstallPlugin) {
      const ok = await opts.reinstallPlugin(pluginId)
      if (ok) reinstalledPluginIds.push(pluginId)
    } else {
      reinstalledPluginIds.push(pluginId)
    }
  }

  return {
    takenOver: true,
    setAsidePluginIds,
    reinstalledPluginIds,
  }
}
