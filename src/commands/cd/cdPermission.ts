/**
 * densable 2.1.218 Cd permission gate (E7p / uCb / dCb / pVo / cVo + Idn/QOy).
 *
 * Used by validateCdTarget (dVo) for /cd and set_cwd control paths.
 */
import { realpathSync } from 'fs'
import { sep } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import type {
  PermissionRule,
  PermissionRuleSource,
} from '../../types/permissions.js'
import { getPathsForPermissionCheck } from '../../utils/fsOperations.js'
import {
  patternWithRoot,
  relativePath,
} from '../../utils/permissions/filesystem.js'
import {
  getAllowRules,
  getDenyRules,
} from '../../utils/permissions/permissions.js'
import { permissionRuleValueToString } from '../../utils/permissions/permissionRuleParser.js'
import { getSettingSourceDisplayNameLowercase } from '../../utils/settings/constants.js'
import { getCwd } from '../../utils/cwd.js'

/** densable S7p — tool name used in Cd permission rules. */
export const CD_TOOL_NAME = 'Cd'

/**
 * densable cVo — reject control/format/default-ignorable/non-ASCII-space/
 * braille-blank code points so paths cannot smuggle trust UI.
 */
export const UNSAFE_PATH_CHARS =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]|(?!\u0020)\p{Zs}/u

export function hasUnsafePathChars(path: string): boolean {
  return UNSAFE_PATH_CHARS.test(path)
}

/** densable C7p — wire-safe message: substitute fallback when path is unsafe. */
export function safeWireMessage(path: string, fallback: string): string {
  return hasUnsafePathChars(path) ? fallback : path
}

export type CdPermissionCheck =
  | { result: 'allowed' }
  | { result: 'blockedByRule'; rule: PermissionRule }
  | { result: 'outsideAllowedPatterns'; allowedPatterns: string[] }

/**
 * densable dCb — convert a gitignore-ish path glob to a case-insensitive
 * anchored RegExp for Cd path matching.
 */
export function cdPathGlobToRegExp(pattern: string): RegExp {
  let out = '^'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!
    if (i === 0 && ch === '*' && pattern[1] === '*' && pattern[2] === '/') {
      out += '(?:.*/)?'
      i += 2
    } else if (ch === '/' && pattern[i + 1] === '*' && pattern[i + 2] === '*') {
      out += '(/.*)?'
      i += 2
    } else if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*'
        i++
      } else {
        out += '[^/]+'
      }
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      out += `\\${ch}`
    } else {
      out += ch
    }
  }
  return new RegExp(`${out}$`, 'i')
}

/**
 * densable uCb — match a single path candidate against a Cd rule pattern
 * rooted at the rule source.
 */
export function cdPatternMatchesPath(
  pattern: string,
  source: PermissionRuleSource,
  absolutePath: string,
): boolean {
  const { relativePattern, root } = patternWithRoot(pattern, source)
  const rel = relativePath(root ?? getCwd(), absolutePath)
  if (rel === '..' || rel.startsWith('../')) {
    return false
  }
  const normalized = relativePattern
    .replace(/\/{2,}/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '')
  return cdPathGlobToRegExp(normalized).test(rel)
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)]
}

function anyPathMatches(
  pattern: string,
  source: PermissionRuleSource,
  candidates: string[],
): boolean {
  return candidates.some(p => cdPatternMatchesPath(pattern, source, p))
}

/**
 * densable QOy private→public path pairs. Only entries where
 * realpath(public) === private are active (macOS /private/tmp ↔ /tmp, etc.).
 */
const QOY_CANDIDATE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['/private/tmp', '/tmp'],
  ['/private/var', '/var'],
  ['/private/etc', '/etc'],
  ['/usr/bin', '/bin'],
  ['/usr/lib', '/lib'],
  ['/usr/sbin', '/sbin'],
]

let qoyCache: Map<string, string> | null = null

/** densable QOy — realpath-gated private→public rewrite map. */
export function getCdPathRewriteMap(): Map<string, string> {
  if (qoyCache) return qoyCache
  const map = new Map<string, string>()
  for (const [privatePath, publicPath] of QOY_CANDIDATE_PAIRS) {
    try {
      if (realpathSync(publicPath) === privatePath) {
        map.set(privatePath, publicPath)
      }
    } catch {
      // public path missing or unreadable — skip pair
    }
  }
  qoyCache = map
  return map
}

/** Test-only: drop QOy cache so realpath probes re-run. */
export function resetCdPathRewriteMapForTests(): void {
  qoyCache = null
}

/**
 * densable Idn — rewrite private/canonical prefixes to public forms when QOy
 * says the public path realpaths to the private key.
 */
export function rewriteCdAllowPath(path: string): string {
  for (const [privatePrefix, publicPrefix] of getCdPathRewriteMap()) {
    if (path === privatePrefix || path.startsWith(privatePrefix + sep)) {
      return publicPrefix + path.slice(privatePrefix.length)
    }
  }
  return path
}

/**
 * densable E7p — Cd deny-first, then allow-list if any Cd allow rules exist.
 *
 * Deny: requestedPath variants (symlink chain) + canonical (Py).
 * Allow: unique([canonical, Idn(canonical)]) — QOy realpath-gated rewrite.
 */
export function checkCdPermission(
  paths: { requestedPath: string; canonicalPath: string },
  toolPermissionContext: ToolPermissionContext,
): CdPermissionCheck {
  const denyCandidates = uniquePaths([
    ...getPathsForPermissionCheck(paths.requestedPath),
    paths.canonicalPath,
  ])
  // densable n = Mo([canonical, Idn(canonical)])
  const allowCandidates = uniquePaths([
    paths.canonicalPath,
    rewriteCdAllowPath(paths.canonicalPath),
  ])

  for (const rule of getDenyRules(toolPermissionContext)) {
    if (rule.ruleValue.toolName !== CD_TOOL_NAME) continue
    const content = rule.ruleValue.ruleContent
    if (
      content === undefined ||
      anyPathMatches(content, rule.source, denyCandidates)
    ) {
      return { result: 'blockedByRule', rule }
    }
  }

  const allowRules = getAllowRules(toolPermissionContext).filter(
    r => r.ruleValue.toolName === CD_TOOL_NAME,
  )
  if (allowRules.length === 0) {
    return { result: 'allowed' }
  }
  for (const rule of allowRules) {
    const content = rule.ruleValue.ruleContent
    if (
      content === undefined ||
      anyPathMatches(content, rule.source, allowCandidates)
    ) {
      return { result: 'allowed' }
    }
  }
  return {
    result: 'outsideAllowedPatterns',
    allowedPatterns: allowRules
      .map(r => r.ruleValue.ruleContent)
      .filter((p): p is string => p !== undefined),
  }
}

/**
 * densable pVo — human refusal for blocked_by_rule / outside allow list.
 * terminalAffordances defaults true (interactive /cd).
 */
export function cdRuleRefusalMessage(
  directory: string,
  check: Extract<
    CdPermissionCheck,
    { result: 'blockedByRule' } | { result: 'outsideAllowedPatterns' }
  >,
  formatPath: (s: string) => string = s => s,
  opts?: { terminalAffordances?: boolean },
): string {
  const terminal = opts?.terminalAffordances !== false
  if (check.result === 'blockedByRule') {
    const ruleLabel = permissionRuleValueToString(check.rule.ruleValue)
    const sourceLabel = getSettingSourceDisplayNameLowercase(check.rule.source)
    if (check.rule.ruleValue.ruleContent === undefined) {
      return terminal
        ? `Can't move to ${formatPath(directory)} — /cd is turned off by the ${formatPath(ruleLabel)} rule in ${sourceLabel}. Update the rule in /permissions to move between directories again.`
        : `Can't move to ${formatPath(directory)} — directory changes are turned off by the ${formatPath(ruleLabel)} permission rule in ${sourceLabel}.`
    }
    return terminal
      ? `Can't move to ${formatPath(directory)} — it's excluded by the ${formatPath(ruleLabel)} rule in ${sourceLabel}. Pick a directory outside that rule, or update it in /permissions.`
      : `Can't move to ${formatPath(directory)} — it's excluded by the ${formatPath(ruleLabel)} permission rule in ${sourceLabel}. Pick a directory outside that rule.`
  }
  return terminal
    ? `Can't move to ${formatPath(directory)} — /cd is limited to directories matching ${check.allowedPatterns.map(p => formatPath(p)).join(', ')}. Pick a matching directory, or add a Cd rule in /permissions.`
    : `Can't move to ${formatPath(directory)} — directory changes are limited to ${check.allowedPatterns.map(p => formatPath(p)).join(', ')}. Pick a matching directory.`
}
