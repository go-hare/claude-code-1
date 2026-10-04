/**
 * densable 2.1.283 `trustedNetworkDirectories` bag + path screen.
 *
 * GOLD SEA `/tmp/official-283/package/claude`
 *   unique string @72811096 (count 40)
 *   apply `Ier` flagSettings rewrite @190949411
 *   `g1`/`h1` @190551319 (path screen — skip first `g1` @180171152 ReflectMessage)
 *   `zh` NT @175453178 (skip `zh` @176323822 buffer reader)
 *   `phe`/`ict` @179637331 / @179637398
 *   `act` spelling @179639104 (skip first `act` @77233665 surface dispatcher)
 *   `Le` membership @179637174 (skip `Le` @179056057 grapheme slice)
 *   `txn` mapped-drive aliases @189974365
 *   `R6r` ineligible @175644398
 *   `rxn` @189982468 (`CLAUDE_CODE_SESSION_KIND !== "bg"`)
 */
import { isAbsolute, relative, resolve as resolvePath } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import { getFsImplementation } from '../fsOperations.js'
import { getPlatform } from '../platform.js'
import { containsVulnerableUncPath } from '../shell/readOnlyCommandValidation.js'

export type TrustedNetworkDirectories = Map<string, readonly string[]>

export type PathScreenReason =
  | 'nt_namespace'
  | 'untrusted_unc'
  | 'untrusted_automount'
  | 'unvettable_chain'
  | 'suspicious_windows_spelling'

export type PathScreenResult =
  | { ok: true; pathsToCheck: string[] }
  | {
      ok: false
      reason: PathScreenReason
      spelling?: string
    }

const NT_NAMESPACE = /^[\\/]\?\?[\\/]/
const TRAILING_DOT_OR_WS = /[.\s]+$/
const TILDE_DIGIT = /~\d/
const DOS_DEVICE_SUFFIX = /\.(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i
const DOT_RUN = /(^|\/|\\)\.{3,}(\/|\\|$)/
const PATH_TRAVERSAL = /(^|[\\/])\.\.([\\/]|$)/
const TRAVERSAL_OR_DOTTED = /(^|[\\/])\.{1,2}[. ]*([\\/]|$)/

/** densable `zh` @175453178 */
export function isNtNamespacePath(path: string): boolean {
  return NT_NAMESPACE.test(path)
}

/** densable `xN` @175468211 */
export function isNtDeviceNamespacePath(path: string): boolean {
  if (NT_NAMESPACE.test(path)) return true
  if (path.includes('??') && NT_NAMESPACE.test(normalizeWin32(path))) {
    return true
  }
  return false
}

function normalizeWin32(path: string): string {
  return path.replace(/\//g, '\\')
}

/** densable `Ln` @175453076 */
export function isUncOrNtPath(path: string): boolean {
  return /^[\\/]{2}/.test(path) || isNtDeviceNamespacePath(path)
}

/** densable `Il` @175459996 — WSL UNC is not a network share. */
export function isWslUncPath(path: string): boolean {
  const m = /^[\\/]{2}wsl(?:\$|\.localhost)[\\/]([^\\/]*)/i.exec(path)
  return m !== null && !/^\.{0,2}[. ]*$/.test(m[1] ?? '')
}

/** densable `ns` @1754600xx */
export function isUntrustedUncPath(path: string): boolean {
  return isUncOrNtPath(path) && !isWslUncPath(path)
}

/** densable `H2` @175453200 */
export function uncHost(path: string): string | null {
  if (/^[\\/]{2}[?.][\\/](?!unc[\\/])/i.test(path)) return null
  return (
    path
      .match(/^[\\/]{2}(?:[?.][\\/]unc[\\/])?([^\\/]+)/i)?.[1]
      ?.replace(/[A-Z]/g, ch => ch.toLowerCase()) ?? null
  )
}

/** densable `C` @175454235 — automount map prefix. */
function isAutomountMapSegments(segments: string[]): boolean {
  const fold = (s: string) => s.toLowerCase()
  return (
    (segments.length === 2 && fold(segments[0]!) === 'net') ||
    (segments.length === 3 &&
      fold(segments[0]!) === 'network' &&
      fold(segments[1]!) === 'servers')
  )
}

/** densable `Lt`/`J_e`/`Yi` @175457323 */
export function automountMapPrefix(path: string): string | null {
  if (!path.startsWith('/')) return null
  const segs: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      segs.pop()
      continue
    }
    segs.push(part)
    if (isAutomountMapSegments(segs)) return `/${segs.join('/')}`
  }
  return null
}

export function isAutomountMapPath(path: string): boolean {
  return automountMapPrefix(path) !== null
}

/** densable `rb` @175458007 */
export function isNetRootPath(path: string): boolean {
  if (!path.startsWith('/')) return false
  const segs: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      segs.pop()
      continue
    }
    segs.push(part)
  }
  return segs.length === 1 && segs[0]!.toLowerCase() === 'net'
}

/** densable `TN`/`Uk` @175458546 */
export function isNetworkBrowsePath(path: string): boolean {
  if (!path.startsWith('/')) return false
  const segs: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      segs.pop()
      continue
    }
    segs.push(part)
    if (segs.length === 1 && segs[0]!.toLowerCase() === 'network') return true
  }
  return false
}

/** densable `F_` @175453735 */
export function isKernelRedirectPath(path: string): boolean {
  if (!/\/\.(?:vol|file|nofollow|resolve)(?:\/|$)/i.test(path)) return false
  if (!path.startsWith('/')) return false
  const segs: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      segs.pop()
      continue
    }
    segs.push(part)
    if (segs.length === 1 && /^\.(?:vol|file|nofollow|resolve)$/i.test(part)) {
      return true
    }
  }
  return false
}

/** densable `Vg` @175457323 */
export function isAutomountSurfacePath(path: string): boolean {
  return (
    isAutomountMapPath(path) ||
    isNetworkBrowsePath(path) ||
    isNetRootPath(path) ||
    isKernelRedirectPath(path)
  )
}

/** densable `ol` @175453178 */
function hasTraversalOrDottedSegment(path: string): boolean {
  return TRAVERSAL_OR_DOTTED.test(path)
}

/** densable `Tp` @179643034 — inner is same as / inside outer. */
function isSameOrInside(inner: string, outer: string): boolean {
  try {
    const a = resolvePath(inner)
    const b = resolvePath(outer)
    if (a === b) return true
    const rel = relative(b, a)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  } catch {
    return inner === outer
  }
}

/**
 * densable `Le` @179637174 — path is covered by a trusted-network alias.
 */
export function isTrustedNetworkPath(
  path: string,
  trusted: TrustedNetworkDirectories | undefined,
): boolean {
  if (!trusted || trusted.size === 0) return false
  if (hasTraversalOrDottedSegment(path)) return false
  const pathIsUnc = isUncOrNtPath(path)
  for (const aliases of trusted.values()) {
    for (const alias of aliases) {
      if (pathIsUnc !== isUncOrNtPath(alias)) continue
      if (isSameOrInside(path, alias)) return true
    }
  }
  return false
}

/** densable `phe` @179637331 */
export function isUntrustedUncRelativeToTrust(
  path: string,
  trusted: TrustedNetworkDirectories | undefined,
): boolean {
  if (isNtDeviceNamespacePath(path)) return true
  return (
    isUncOrNtPath(path) &&
    !isWslUncPath(path) &&
    !isTrustedNetworkPath(path, trusted)
  )
}

/** densable `ict` @179637398 */
export function isUntrustedAutomountRelativeToTrust(
  path: string,
  trusted: TrustedNetworkDirectories | undefined,
): boolean {
  return isAutomountSurfacePath(path) && !isTrustedNetworkPath(path, trusted)
}

/**
 * densable `act` @179639104 — skip first minify `act` @77233665 (surface
 * dispatcher) and @183931498 (image 400 helper).
 */
export function suspiciousWindowsSpelling(
  path: string,
  trusted: TrustedNetworkDirectories | undefined,
): string | undefined {
  if (isNtDeviceNamespacePath(path)) return 'nt_device_namespace'
  const platform = getPlatform()
  if (
    (platform === 'windows' || platform === 'wsl') &&
    path.indexOf(':', 2) !== -1
  ) {
    return 'colon_past_drive_position'
  }
  if (TILDE_DIGIT.test(path)) return 'tilde_digit'
  if (
    path.startsWith('\\\\?\\') ||
    path.startsWith('\\\\.\\') ||
    path.startsWith('//?/') ||
    path.startsWith('//./')
  ) {
    return 'device_path_prefix'
  }
  for (const seg of path.split(/[/\\]/)) {
    if (seg === '' || seg === '.' || seg === '..') continue
    if (TRAILING_DOT_OR_WS.test(seg)) return 'trailing_dot_or_whitespace'
  }
  if (DOS_DEVICE_SUFFIX.test(path)) return 'dos_device_suffix'
  if (DOT_RUN.test(path)) return 'dot_run_segment'
  // densable `hE(e,!0)` @179605707 (skip first `hE` @178114714 Bedrock)
  if (
    containsVulnerableUncPath(path, true) &&
    !isWslUncPath(path) &&
    !isTrustedNetworkPath(path, trusted)
  ) {
    return 'unc_or_webdav_form'
  }
  return undefined
}

function screenOne(
  path: string,
  trusted: TrustedNetworkDirectories | undefined,
): PathScreenResult | undefined {
  if (isNtNamespacePath(path)) {
    return { ok: false, reason: 'nt_namespace' }
  }
  if (isUntrustedUncRelativeToTrust(path, trusted)) {
    return { ok: false, reason: 'untrusted_unc' }
  }
  if (isUntrustedAutomountRelativeToTrust(path, trusted)) {
    return { ok: false, reason: 'untrusted_automount' }
  }
  const spelling = suspiciousWindowsSpelling(path, trusted)
  if (spelling !== undefined) {
    return {
      ok: false,
      reason: 'suspicious_windows_spelling',
      spelling,
    }
  }
  return undefined
}

/**
 * densable `j5` @175652082 — symlink spellings, or unvettable.
 * UNC / automount surfaces skip the walk (no DNS/NFS probe).
 */
export function vetPathSpellings(expanded: string): {
  paths: string[]
  vetted: boolean
} {
  if (
    (isUncOrNtPath(expanded) && !isWslUncPath(expanded)) ||
    isAutomountMapPath(expanded) ||
    isNetworkBrowsePath(expanded)
  ) {
    return { paths: [expanded], vetted: true }
  }
  const fs = getFsImplementation()
  const paths = new Set<string>([expanded])
  try {
    let current = expanded
    const visited = new Set<string>()
    for (let depth = 0; depth < 40; depth++) {
      if (visited.has(current)) break
      visited.add(current)
      if (!fs.existsSync(current)) break
      const st = fs.lstatSync(current)
      if (!st.isSymbolicLink()) break
      const target = fs.readlinkSync(current)
      current = isAbsolute(target) ? target : resolvePath(current, '..', target)
      paths.add(current)
    }
    return { paths: [...paths], vetted: true }
  } catch {
    return { paths: [...paths], vetted: false }
  }
}

/**
 * densable `g1` @190551319 — screen raw + expanded, then symlink chain.
 */
export function screenNetworkPathG1(
  raw: string,
  expanded: string,
  trusted: TrustedNetworkDirectories | undefined,
): PathScreenResult {
  const trimmed = raw.trim()
  const candidates = trimmed === expanded ? [expanded] : [trimmed, expanded]
  for (const candidate of candidates) {
    const hit = screenOne(candidate, trusted)
    if (hit !== undefined) return hit
  }
  const { paths, vetted } = vetPathSpellings(expanded)
  if (!vetted) return { ok: false, reason: 'unvettable_chain' }
  for (const spelling of paths) {
    const hit = screenOne(spelling, trusted)
    if (hit !== undefined) return hit
  }
  return { ok: true, pathsToCheck: paths }
}

/**
 * densable `h1` @190551578 — reason for a resolved path, or undefined.
 */
export function resolvedNetworkPathReasonH1(
  resolved: string,
  trusted: TrustedNetworkDirectories | undefined,
): PathScreenReason | string | undefined {
  const hit = screenOne(resolved, trusted)
  return hit !== undefined && hit.ok === false ? hit.reason : undefined
}

/** densable `Gh` — `..` segment. */
function hasPathTraversal(path: string): boolean {
  return PATH_TRAVERSAL.test(path)
}

function hasNetworkSymlinkAncestry(path: string): boolean {
  const { paths, vetted } = vetPathSpellings(path)
  if (!vetted) return true
  return paths.some(
    p => isUntrustedUncPath(p) || isAutomountMapPath(p) || isNetRootPath(p),
  )
}

/**
 * densable `R6r` @175644398 — skip mapping this flag dir into the
 * trusted-network bag (already network / traversal / unverified).
 */
export function isIneligibleForTrustedNetworkMap(path: string): boolean {
  return (
    hasPathTraversal(path) ||
    isUntrustedUncPath(path) ||
    isAutomountMapPath(path) ||
    isNetRootPath(path) ||
    hasNetworkSymlinkAncestry(path)
  )
}

/**
 * densable `txn` @189974365 — Windows mapped drive → `[drivePath, uncRealpath]`
 * when both realpaths are UNC on the same host.
 */
export function mappedNetworkDriveAliases(dir: string): string[] {
  if (!/^[A-Za-z]:[\\/]/.test(dir)) return []
  const fs = getFsImplementation()
  try {
    const driveRoot = fs.realpathSync(dir.slice(0, 3))
    if (!driveRoot || !isUncOrNtPath(driveRoot)) return []
    const full = fs.realpathSync(dir)
    if (!full || !isUncOrNtPath(full)) return []
    const hostA = uncHost(driveRoot)
    const hostB = uncHost(full)
    if (hostA == null || hostB == null || hostA !== hostB) return []
    return [dir, full]
  } catch {
    return []
  }
}

/** densable `rxn` @189982468 */
export function isTrustedNetworkRewriteEnabled(): boolean {
  return process.env.CLAUDE_CODE_SESSION_KIND !== 'bg'
}

export type TrustedNetworkRewriteScratch = {
  toRemove: string[]
  toAdd: string[]
}

/**
 * densable `Ier` flagSettings block @190949411.
 * Mutates scratch toRemove/toAdd the way gold pushes onto `h`/`T`.
 */
export function rewriteFlagSettingsTrustedNetworkDirectories(
  context: Pick<
    ToolPermissionContext,
    'additionalWorkingDirectories' | 'trustedNetworkDirectories'
  >,
  flagAdditionalDirectories: ReadonlySet<string>,
  scratch: TrustedNetworkRewriteScratch,
): { trustedNetworkDirectories: TrustedNetworkDirectories } | undefined {
  const owned = context.additionalWorkingDirectories
  const nextTrusted = new Map(context.trustedNetworkDirectories ?? [])
  let changed = false
  for (const key of [...nextTrusted.keys()]) {
    if (
      !flagAdditionalDirectories.has(key) &&
      owned.get(key)?.source !== 'cliArg'
    ) {
      for (const alias of nextTrusted.get(key) ?? []) {
        if (alias !== key) scratch.toRemove.push(alias)
      }
      nextTrusted.delete(key)
      changed = true
    }
  }
  if (isTrustedNetworkRewriteEnabled()) {
    for (const dir of flagAdditionalDirectories) {
      if (nextTrusted.has(dir)) continue
      if (isIneligibleForTrustedNetworkMap(dir)) continue
      const aliases = mappedNetworkDriveAliases(dir)
      if (aliases.length > 0) {
        nextTrusted.set(dir, aliases)
        for (const alias of aliases) {
          if (alias !== dir) scratch.toAdd.push(alias)
        }
        changed = true
      }
    }
  }
  if (!changed) return undefined
  return { trustedNetworkDirectories: nextTrusted }
}
