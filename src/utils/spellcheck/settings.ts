/**
 * densable 2.1.235 #1 — spellcheck settings resolution (user/flag/managed only).
 */

import { logForDebugging } from '../debug.js'
import { getSettingsForSource } from '../settings/settings.js'
import { getSettingSourceDisplayNameLowercase } from '../settings/constants.js'
import type { SettingsJson } from '../settings/types.js'
import type { SettingSource } from '../settings/constants.js'

type SettingsSourceReader = typeof getSettingsForSource

export type SpellcheckSettingsBlock = NonNullable<SettingsJson['spellcheck']>

export type ResolvedSpellcheckSettings = {
  /** Highest-precedence user/flag/managed block, if any. */
  block: SpellcheckSettingsBlock | undefined
  source: SettingSource | undefined
  enabled: boolean
}

const warnedHosts = new WeakMap<object, Set<string>>()

/** densable dhg — once-per-host warning log. */
export function warnSpellcheckOnce(host: object, message: string): void {
  let set = warnedHosts.get(host)
  if (!set) {
    set = new Set()
    warnedHosts.set(host, set)
  }
  if (set.has(message)) return
  set.add(message)
  logForDebugging(`[spellcheck] ${message}`)
}

/** Test helper — clear once-per-host warn set. */
export function resetSpellcheckSettingsWarningsForTests(): void {
  // WeakMap has no clear; new hosts in tests are fresh objects.
}

/**
 * densable lRt("spellcheck")[0] over security-sensitive sources only
 * (policySettings → flagSettings → userSettings). Whole block wins.
 * Project/local are never consulted for the effective block.
 */
export function resolveSpellcheckSettings(
  getSource: SettingsSourceReader = getSettingsForSource,
): ResolvedSpellcheckSettings {
  const sources = [
    'policySettings',
    'flagSettings',
    'userSettings',
  ] as const satisfies readonly SettingSource[]
  let block: SpellcheckSettingsBlock | undefined
  let source: SettingSource | undefined
  for (const s of sources) {
    const value = getSource(s)?.spellcheck
    if (value !== undefined && value !== null) {
      block = value
      source = s
      break
    }
  }
  return {
    block,
    source,
    enabled: block?.enabled === true,
  }
}

/** Emit densable policy warnings for ignored project/local + disabled whole block. */
export function emitSpellcheckSettingsWarnings(
  host: object,
  resolved: ResolvedSpellcheckSettings,
  getSource: SettingsSourceReader = getSettingsForSource,
): void {
  if (
    getSource('projectSettings')?.spellcheck !== undefined ||
    getSource('localSettings')?.spellcheck !== undefined
  ) {
    warnSpellcheckOnce(
      host,
      'a spellcheck block in project or local settings is ignored, whatever else is configured; set it in your user settings (~/.claude/settings.json) instead',
    )
  }
  if (
    resolved.source &&
    resolved.block &&
    resolved.block.enabled === undefined
  ) {
    warnSpellcheckOnce(
      host,
      `the spellcheck block in ${getSettingSourceDisplayNameLowercase(resolved.source)} applies (as a whole, over any lower tier) and has no usable "enabled": true, so spell checking is off`,
    )
  }
}
