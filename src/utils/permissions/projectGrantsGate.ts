/**
 * densable 2.1.246 `Vr` / `ui` / `$d` / `ky`.
 * Gate project/local allow rules until this directory is explicitly trusted.
 */
import { homedir } from 'os'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getProjectPathForConfig, getGlobalConfig } from '../config.js'
import { isEnvTruthy } from '../envUtils.js'
import { logForDebugging } from '../debug.js'
import {
  getEnabledSettingSources,
  type SettingSource,
} from '../settings/constants.js'
import { isLocalSettingsGitTracked } from '../settings/localSettingsGitTracked.js'
import {
  getSettingsForSource,
  projectSettingsAliasesUserSettings,
} from '../settings/settings.js'
import type { PermissionRule } from './PermissionRule.js'

const warned = new Set<string>()

function firstTimeFor(key: string): boolean {
  if (warned.has(key)) {
    return false
  }
  warned.add(key)
  return true
}

/** densable `se` — this project key only (not ancestor walk). */
export function isCurrentProjectTrustLatched(): boolean {
  return (
    getGlobalConfig().projects?.[getProjectPathForConfig()]
      ?.hasTrustDialogAccepted === true
  )
}

/** densable `z`. */
export function isCwdHome(): boolean {
  return getOriginalCwd() === homedir()
}

/** densable `Vr`. */
export function getProjectGrantsGates(): {
  gateProject: boolean
  gateLocal: boolean
} {
  return {
    gateProject: !projectSettingsAliasesUserSettings(),
    gateLocal: isLocalSettingsGitTracked({ onIndeterminate: 'untracked' }),
  }
}

/** densable `ui`. */
export function sourceHasGatedGrants(
  source: 'projectSettings' | 'localSettings',
): boolean {
  if (!getEnabledSettingSources().includes(source)) {
    return false
  }
  const settings = getSettingsForSource(source)
  if (!settings) {
    return false
  }
  const allow = settings.permissions?.allow
  if (Array.isArray(allow) && allow.length > 0) {
    return true
  }
  const dirs = settings.permissions?.additionalDirectories
  return Array.isArray(dirs) && dirs.length > 0
}

/** densable `$d`. */
export function hasGatedProjectOrLocalGrants(): boolean {
  const { gateProject, gateLocal } = getProjectGrantsGates()
  return (
    (gateProject && sourceHasGatedGrants('projectSettings')) ||
    (gateLocal && sourceHasGatedGrants('localSettings'))
  )
}

/**
 * densable `ft` `P`:
 * `!SANDBOXED && !z() && !se() && $d()`.
 */
export function probeProjectGrantsGated(): boolean {
  return (
    !isEnvTruthy(process.env.CLAUDE_CODE_SANDBOXED) &&
    !isCwdHome() &&
    !isCurrentProjectTrustLatched() &&
    hasGatedProjectOrLocalGrants()
  )
}

function dropGatedAllowMessage(
  kind: string,
  dropped: number,
  files: string[],
): void {
  if (!firstTimeFor(kind)) {
    return
  }
  logForDebugging(
    `Dropped ${dropped} project-scoped ${kind} entr${dropped === 1 ? 'y' : 'ies'} — workspace not yet trusted`,
  )
  const from = files.length > 0 ? files.join(' and ') : '.claude/ settings'
  console.error(
    `Ignoring ${dropped} ${kind} ${dropped === 1 ? 'entry' : 'entries'} from ${from}: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog, or set projects[${getProjectPathForConfig()}].hasTrustDialogAccepted: true.`,
  )
}

/**
 * densable `ky` — drop untrusted project/local *allow* rules.
 * Deny/ask always stay.
 */
export function filterGatedAllowRules(
  rules: PermissionRule[],
): PermissionRule[] {
  if (isCurrentProjectTrustLatched()) {
    return rules
  }
  const { gateProject, gateLocal } = getProjectGrantsGates()
  const droppedFiles = new Set<string>()
  const kept = rules.filter(rule => {
    if (rule.ruleBehavior !== 'allow') {
      return true
    }
    if (rule.source === 'projectSettings' && gateProject) {
      droppedFiles.add('.claude/settings.json')
      return false
    }
    if (rule.source === 'localSettings' && gateLocal) {
      droppedFiles.add('.claude/settings.local.json')
      return false
    }
    return true
  })
  const dropped = rules.length - kept.length
  if (dropped > 0) {
    dropGatedAllowMessage('permissions.allow', dropped, [...droppedFiles])
  }
  return kept
}

/**
 * Whether this source's *grants* (allow rules, additionalDirectories, allowed
 * domains) are withheld pending trust. Same predicate `filterGatedAllowRules`
 * applies per rule, hoisted so callers holding a source rather than a parsed
 * rule can gate too.
 */
export function isSourceGrantsGated(source: SettingSource): boolean {
  if (isCurrentProjectTrustLatched()) {
    return false
  }
  const { gateProject, gateLocal } = getProjectGrantsGates()
  return (
    (source === 'projectSettings' && gateProject) ||
    (source === 'localSettings' && gateLocal)
  )
}

/** densable `xy` — skip gated additionalDirectories from a source. */
export function shouldGateAdditionalDirectories(
  source: SettingSource,
): boolean {
  return isSourceGrantsGated(source)
}

/**
 * Allow-rule strings from enabled sources whose grants are not gated. The
 * merged `settings.permissions.allow` cannot be gated after the fact — the
 * merge concatenates every source and drops the provenance the gate needs.
 */
export function collectUngatedAllowRuleStrings(): string[] {
  const rules: string[] = []
  for (const source of getEnabledSettingSources()) {
    if (isSourceGrantsGated(source)) {
      continue
    }
    const allow = getSettingsForSource(source)?.permissions?.allow
    if (allow) {
      rules.push(...allow)
    }
  }
  return rules
}

export function collectUngatedAdditionalDirectories(): string[] {
  const dirs: string[] = []
  for (const source of getEnabledSettingSources()) {
    if (shouldGateAdditionalDirectories(source)) {
      continue
    }
    const extra =
      getSettingsForSource(source)?.permissions?.additionalDirectories
    if (extra) {
      dirs.push(...extra)
    }
  }
  return dirs
}

export function resetProjectGrantsGateWarningsForTests(): void {
  warned.clear()
}
