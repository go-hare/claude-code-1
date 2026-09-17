/**
 * densable 2.1.246 #2 — `/permissions` Auto tab write path.
 * Official `Ne` / `Un` / `Ki` / `Hi` / `qi` / `Gi` / `nc` / `Wi` (SEA @234578400).
 * Separate from setup `writeAutoModeSetup` (`svr` / `$defaults` proposal).
 */
import { dirname } from 'path'
import {
  AUTO_MODE_DEFAULTS_SENTINEL,
  MAX_ENTRIES,
  MAX_ENTRY_CHARS,
  autoModeBlockSchema,
  stripVariationSelectors,
} from './write.js'
import { isENOENT } from '../../utils/errors.js'
import { writeFileSyncAndFlush_DEPRECATED } from '../../utils/file.js'
import { readFileSync } from '../../utils/fileRead.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { safeParseJSON } from '../../utils/json.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { markInternalWrite } from '../../utils/settings/internalWrites.js'
import {
  getSettingsFilePathForSource,
  getSettingsForSourceUncached,
} from '../../utils/settings/settings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import type { SettingsJson } from '../../utils/settings/types.js'

export const AUTO_MODE_TAB_SECTIONS = [
  'allow',
  'soft_deny',
  'hard_deny',
  'environment',
] as const

export type AutoModeTabSection = (typeof AUTO_MODE_TAB_SECTIONS)[number]

export class AutoModeRuleWriteError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AutoModeRuleWriteError'
    this.code = code
  }
}

/**
 * densable `$t` / `yce` / `uLs().value` — environment-as-document / editable builtins.
 * SEA 2.1.246: `function yce(){return uLs().value}` + `uLs(){return{value:!0,src:"default"}}`.
 * Always ON. `if(!$t())` is the internalTemplate fallback (unreachable on this pack).
 * Nearby `Yr` is the Auto tab confirm UI, not a second builtin switch.
 */
export function isAutoModeEnvironmentDocument(): boolean {
  return true
}

/** densable `ho` / `tc` — CRLF + variation-selector normalize. */
export function normalizeAutoModeRuleText(text: string): string {
  return stripVariationSelectors(text.replace(/\r\n/g, '\n'))
}

function countEntriesMinusSentinel(entries: readonly string[]): number {
  return (
    entries.length - (entries.includes(AUTO_MODE_DEFAULTS_SENTINEL) ? 1 : 0)
  )
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (
      (c < 32 && c !== 9) ||
      (c >= 127 && c <= 159) ||
      c === 8232 ||
      c === 8233
    ) {
      return true
    }
  }
  return false
}

const INVISIBLE =
  /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029\u2800\uFFF9-\uFFFB\u{1D173}-\u{1D17A}]/u

/** densable `ji` — per-line checks for an incoming rule. */
function validateRuleLines(
  _section: AutoModeTabSection,
  lines: readonly string[],
): string | null {
  for (const raw of lines) {
    const n = stripVariationSelectors(raw)
    if (n.trim() === '') return 'the rule contains an empty line.'
    if (hasControlChar(n)) {
      return 'the rule contains a control character; entries must be single-line text.'
    }
    if (INVISIBLE.test(n)) {
      return 'the rule contains an invisible or bidirectional character; entries must be plainly renderable text.'
    }
    if (n.includes('<settings_')) {
      return 'the rule contains a literal "<settings_" template token; entries must not contain classifier template tokens.'
    }
  }
  return null
}

/** densable `nc` — drop consecutive `### ` headers with no following entry. */
export function dropEmptyEnvironmentHeaders(entries: string[]): string[] {
  const isHeader = (line: string) => line.startsWith('### ')
  const out: string[] = []
  let pending: string | undefined
  for (const line of entries) {
    if (isHeader(line)) {
      pending = line
      continue
    }
    if (pending !== undefined) {
      out.push(pending)
      pending = undefined
    }
    out.push(line)
  }
  return out
}

function readUserSettingsSnapshot(filePath: string): SettingsJson {
  let content: string | null = null
  try {
    content = readFileSync(filePath)
  } catch (e) {
    if (!isENOENT(e)) {
      throw new AutoModeRuleWriteError(
        'settings_file_invalid',
        'the settings file has a validation error or cannot be read, so its auto mode rules are not in effect; fix it (Claude Code names the problem at startup), then try again.',
      )
    }
  }
  if (content === null) {
    return getSettingsForSourceUncached('userSettings') ?? {}
  }
  const rawData = safeParseJSON(content)
  if (rawData === null) {
    throw new AutoModeRuleWriteError(
      'settings_file_invalid',
      'the settings file has a validation error or cannot be read, so its auto mode rules are not in effect; fix it (Claude Code names the problem at startup), then try again.',
    )
  }
  if (rawData && typeof rawData === 'object') {
    return rawData as SettingsJson
  }
  return {}
}

function writeUserSettingsSnapshot(
  filePath: string,
  settings: SettingsJson,
): void {
  getFsImplementation().mkdirSync(dirname(filePath))
  markInternalWrite(filePath)
  writeFileSyncAndFlush_DEPRECATED(
    filePath,
    jsonStringify(settings, null, 2) + '\n',
  )
  resetSettingsCache()
}

/**
 * densable `Un` — mutate one autoMode section in userSettings.
 */
export async function mutateAutoModeSection(
  section: AutoModeTabSection,
  mutate: (current: string[]) => string[] | { refuse: string } | null,
): Promise<void> {
  const filePath = getSettingsFilePathForSource('userSettings')
  if (!filePath) {
    throw new AutoModeRuleWriteError(
      'no_user_settings_path',
      'Could not resolve the user settings file path.',
    )
  }

  const existing = readUserSettingsSnapshot(filePath)
  const autoMode = existing.autoMode
  if (Array.isArray(autoMode)) {
    throw new AutoModeRuleWriteError(
      'settings_file_invalid',
      'the existing autoMode value in the settings file is an array — fix or remove it, then try again.',
    )
  }
  if (
    autoMode !== undefined &&
    !autoModeBlockSchema.safeParse(autoMode).success
  ) {
    throw new AutoModeRuleWriteError(
      'settings_file_invalid',
      'the existing autoMode value in the settings file does not match the expected shape — fix or remove it, then try again.',
    )
  }

  const block = (autoMode ?? {}) as Record<string, unknown>
  const current = Array.isArray(block[section])
    ? (block[section] as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : []

  const mutated = mutate(current)
  if (mutated !== null && !Array.isArray(mutated)) {
    throw new AutoModeRuleWriteError('invalid_input', mutated.refuse)
  }
  if (mutated !== null) {
    const nextCount = countEntriesMinusSentinel(mutated)
    const prevCount = countEntriesMinusSentinel(current)
    if (nextCount > MAX_ENTRIES && nextCount > prevCount) {
      throw new AutoModeRuleWriteError(
        'invalid_input',
        `autoMode.${section} already has ${prevCount} entries; the maximum is ${MAX_ENTRIES}.`,
      )
    }
  }
  if (mutated === null) {
    throw new AutoModeRuleWriteError(
      'entry_not_found',
      'That rule changed on disk while the dialog was open — close and reopen /permissions, then try again.',
    )
  }

  const nextAuto = {
    ...(autoMode !== null && typeof autoMode === 'object' ? autoMode : {}),
    [section]: mutated,
  }
  writeUserSettingsSnapshot(filePath, {
    ...existing,
    autoMode: nextAuto,
  })
}

/** densable `Ki` / `Xo` */
export function validateAutoModeRuleInput(
  section: AutoModeTabSection,
  raw: string,
): string | null {
  try {
    assertAutoModeRuleInput(section, normalizeAutoModeRuleText(raw))
    return null
  } catch (error) {
    return error instanceof AutoModeRuleWriteError
      ? error.message
      : String(error)
  }
}

function assertAutoModeRuleInput(
  section: AutoModeTabSection,
  text: string,
): void {
  if (text === AUTO_MODE_DEFAULTS_SENTINEL) {
    throw new AutoModeRuleWriteError(
      'invalid_input',
      `"${AUTO_MODE_DEFAULTS_SENTINEL}" is reserved — it splices the built-in rules in and cannot be added as a rule.`,
    )
  }
  if (text.length > MAX_ENTRY_CHARS) {
    throw new AutoModeRuleWriteError(
      'invalid_input',
      `the rule is ${text.length} characters; the maximum is ${MAX_ENTRY_CHARS}.`,
    )
  }
  const lines = text.split('\n')
  if (
    section === 'environment' &&
    lines.some(line => line.startsWith('### '))
  ) {
    throw new AutoModeRuleWriteError(
      'invalid_input',
      "'### ' lines are environment section headers (structure, not entries) and cannot be written here.",
    )
  }
  const problem = validateRuleLines(section, lines)
  if (problem) throw new AutoModeRuleWriteError('invalid_input', problem)
}

/** densable `Hi` / `qm` */
export async function addAutoModeRule(
  section: AutoModeTabSection,
  raw: string,
): Promise<void> {
  const text = normalizeAutoModeRuleText(raw)
  assertAutoModeRuleInput(section, text)
  await mutateAutoModeSection(section, current => {
    if (section === 'environment' && isAutoModeEnvironmentDocument()) {
      return {
        refuse:
          'The environment is edited as a document — use Edit environment on the Auto mode tab.',
      }
    }
    if (section !== 'environment' && current.length === 0) {
      return [AUTO_MODE_DEFAULTS_SENTINEL, text]
    }
    return [...current, text]
  })
}

/** densable `qi` / `Gm` */
export async function updateAutoModeRule(
  section: AutoModeTabSection,
  index: number,
  previous: string,
  raw: string,
): Promise<void> {
  const text = normalizeAutoModeRuleText(raw)
  assertAutoModeRuleInput(section, text)
  await mutateAutoModeSection(section, current => {
    if (previous === AUTO_MODE_DEFAULTS_SENTINEL) {
      return {
        refuse: `"${AUTO_MODE_DEFAULTS_SENTINEL}" is splice plumbing, not an editable rule.`,
      }
    }
    if (section === 'environment' && previous.startsWith('### ')) {
      return {
        refuse:
          "'### ' lines are environment section headers (structure, not entries) and cannot be edited here.",
      }
    }
    if (current[index] !== previous) return null
    const next = [...current]
    next[index] = text
    return next
  })
}

/** densable `Gi` / `Qm` */
export async function deleteAutoModeRule(
  section: AutoModeTabSection,
  index: number,
  previous: string,
): Promise<void> {
  await mutateAutoModeSection(section, current => {
    if (previous === AUTO_MODE_DEFAULTS_SENTINEL) {
      return {
        refuse: `"${AUTO_MODE_DEFAULTS_SENTINEL}" is splice plumbing, not a deletable rule.`,
      }
    }
    if (section === 'environment' && previous.startsWith('### ')) {
      return {
        refuse:
          "'### ' lines are environment section headers (structure, not entries) and cannot be deleted here.",
      }
    }
    if (current[index] !== previous) return null
    const next = [...current.slice(0, index), ...current.slice(index + 1)]
    return section === 'environment' ? dropEmptyEnvironmentHeaders(next) : next
  })
}

export type EnvironmentDocumentParse = {
  entries: string[]
  problem: string | null
}

/** densable `oc` / `Yi` */
export function parseEnvironmentDocument(
  text: string,
): EnvironmentDocumentParse {
  const entries = dropEmptyEnvironmentHeaders(
    text
      .split('\n')
      .map(line => normalizeAutoModeRuleText(line))
      .filter(line => line.length > 0),
  )
  if (entries.length === 0) return { entries, problem: null }
  const problem = validateRuleLines('environment', entries)
  return { entries, problem }
}

/** densable `Wi` */
export async function writeEnvironmentDocument(text: string): Promise<void> {
  const parsed = parseEnvironmentDocument(text)
  if (parsed.problem) {
    throw new AutoModeRuleWriteError('invalid_input', parsed.problem)
  }
  await mutateAutoModeSection('environment', () => parsed.entries)
}

export function sectionLabel(section: AutoModeTabSection): string {
  switch (section) {
    case 'allow':
      return 'Soft allow'
    case 'soft_deny':
      return 'Soft deny'
    case 'hard_deny':
      return 'Hard deny'
    case 'environment':
      return 'Environment'
  }
}
