/**
 * densable svr / V3w / TPl / uhs / wEo — auto-mode-setup write path.
 * Gold: docs/upstream-extraction/v2.1.239/snippets/gold-wide-{svr,V3w,TPl,uhs}.txt
 *
 * Writes userSettings only. storageV5 param is accepted for call-shape parity
 * and intentionally ignored (no storageV5 host).
 */
import mergeWith from 'lodash-es/mergeWith.js'
import { dirname } from 'path'
import { z } from 'zod'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { logForDebugging } from '../../utils/debug.js'
import { isENOENT } from '../../utils/errors.js'
import { writeFileSyncAndFlush_DEPRECATED } from '../../utils/file.js'
import { readFileSync } from '../../utils/fileRead.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { safeParseJSON } from '../../utils/json.js'
import { clone, jsonStringify } from '../../utils/slowOperations.js'
import { markInternalWrite } from '../../utils/settings/internalWrites.js'
import {
  getSettingsFilePathForSource,
  getSettingsForSourceUncached,
} from '../../utils/settings/settings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import type { SettingsJson } from '../../utils/settings/types.js'

/** densable roe */
export const AUTO_MODE_DEFAULTS_SENTINEL = '$defaults' as const

const RULE_KEYS = ['allow', 'soft_deny', 'hard_deny'] as const
type RuleKey = (typeof RULE_KEYS)[number]

/** densable ivr / Rqi / W3w / G3w / D8 / z3w */
const MAX_ENTRIES = 200
const MAX_ENTRY_CHARS = 10_000
const ENV_ENTRY_WARN = 200
const ENV_BYTES_WARN = 50_000
const SETTINGS_FILE_CAP = 2_097_152
const AUTO_MODE_SECTION_WARN = SETTINGS_FILE_CAP / 4

/** densable s$m — credential-in-URL */
const CREDENTIAL_IN_URL = /:\/\/[^/\s\\]*@/g

/** densable Q3w — strip variation selectors for zge */
const VARIATION_SELECTORS = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu

/** densable J3w — invisible / bidi */
const INVISIBLE =
  /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029\u2800\uFFF9-\uFFFB\u{1D173}-\u{1D17A}]/u

/** densable Ytr — autoMode block schema (no classifyAllShell; TPl/K3w own $defaults) */
export const autoModeBlockSchema = z.object({
  allow: z.array(z.string()).optional(),
  soft_deny: z.array(z.string()).optional(),
  hard_deny: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  environment: z.array(z.string()).optional(),
})

export type AutoModeSetupProposal = {
  environment: string[]
  allow: string[]
  soft_deny: string[]
  hard_deny: string[]
}

export type AutoModeWriteInput = {
  mode?: 'append' | 'replace'
  autoMode?: {
    environment: string[]
    allow?: string[]
    soft_deny?: string[]
    hard_deny?: string[]
  }
  removeFromPermissionsAllow?: string[]
}

export type AutoModeWriteResult = {
  filePath: string
  autoModeKeysWritten: string[]
  environmentEntriesPreserved: number
  permissionsAllowRemoved: string[]
  permissionsAllowNotFound: string[]
  permissionsAllowSkipped: boolean
  warnings: string[]
}

export type AutoModeRemovalStats = {
  removed: number
  skipped: number
  notFound?: number
}

export class AutoModeSetupWriteError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AutoModeSetupWriteError'
    this.code = code
  }
}

/** densable zge */
export function stripVariationSelectors(entry: string): string {
  return entry.replace(VARIATION_SELECTORS, '')
}

/** densable oUe + Frn */
export function isRemovableAllowRule(rule: string): boolean {
  const trimmed = rule.trim()
  if (
    !(
      trimmed.length > 0 &&
      trimmed.length <= 120 &&
      !/[\r\n\v\f\u0085\u2028\u2029]/.test(rule) &&
      !rule.includes('`') &&
      !/^(#|-|>|<<<)/.test(trimmed)
    )
  ) {
    return false
  }
  if (trimmed !== rule) return false
  return rule.replace(CREDENTIAL_IN_URL, '://') === rule
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map(i => `${i.path.map(String).join('.')}: ${i.message}`)
    .join('; ')
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : []
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

/** densable Iqi */
function validateEntries(name: string, entries: string[]): string | null {
  if (entries.length > MAX_ENTRIES) {
    return `${name} has ${entries.length} entries; the maximum is ${MAX_ENTRIES}.`
  }
  for (const raw of entries) {
    const n = stripVariationSelectors(raw)
    if (n.trim() === '') return `${name} contains an empty entry.`
    if (n.length > MAX_ENTRY_CHARS) {
      return `${name} contains an entry of ${n.length} characters; the maximum is ${MAX_ENTRY_CHARS}.`
    }
    if (hasControlChar(n)) {
      return `${name} contains an entry with a control character; entries must be single-line text.`
    }
    if (INVISIBLE.test(n)) {
      return `${name} contains an entry with an invisible or bidirectional character; entries must be plainly renderable text.`
    }
    if (n.includes('<settings_')) {
      return `${name} contains an entry with a literal "<settings_" template token; entries must not contain classifier template tokens.`
    }
  }
  return null
}

/** densable TPl */
export function validateAutoModeWriteInput(
  input: AutoModeWriteInput,
): string | null {
  const { autoMode } = input
  if (
    autoMode === undefined &&
    (input.removeFromPermissionsAllow ?? []).length === 0
  ) {
    return 'Nothing to save.'
  }
  if (autoMode !== undefined) {
    const parsed = autoModeBlockSchema.safeParse(autoMode)
    if (!parsed.success) {
      return `autoMode block failed validation: ${formatZodIssues(parsed.error)}`
    }
    if (!autoMode.environment || autoMode.environment.length === 0) {
      return 'autoMode.environment is empty — nothing to save.'
    }
    const envErr = validateEntries('environment', autoMode.environment)
    if (envErr) return envErr
    if (
      autoMode.environment.some(
        e => stripVariationSelectors(e) === AUTO_MODE_DEFAULTS_SENTINEL,
      )
    ) {
      return `autoMode.environment must not contain "${AUTO_MODE_DEFAULTS_SENTINEL}" — skipped slots get their shipped default text written verbatim instead.`
    }
    for (const key of RULE_KEYS) {
      const arr = autoMode[key]
      if (arr === undefined) continue
      if (arr.length === 0) {
        return `autoMode.${key} is empty — omit the key when nothing was accepted for it.`
      }
      const err = validateEntries(key, arr)
      if (err) return err
      if (!arr.includes(AUTO_MODE_DEFAULTS_SENTINEL)) {
        return `autoMode.${key} is missing the literal entry "${AUTO_MODE_DEFAULTS_SENTINEL}" — without it the array replaces the shipped rules instead of extending them.`
      }
    }
  }
  const removal = input.removeFromPermissionsAllow
  if (removal !== undefined) {
    if (!Array.isArray(removal)) {
      return 'removeFromPermissionsAllow must be an array of rule strings.'
    }
    if (removal.length > MAX_ENTRIES) {
      return `removeFromPermissionsAllow has ${removal.length} entries; the maximum is ${MAX_ENTRIES}.`
    }
    for (const [i, rule] of removal.entries()) {
      if (typeof rule !== 'string' || !isRemovableAllowRule(rule)) {
        return `removeFromPermissionsAllow[${i}] is not a rule string the removal offer could have produced.`
      }
    }
  }
  return null
}

/** densable Y3w */
function normalizeIncoming(
  autoMode: NonNullable<AutoModeWriteInput['autoMode']>,
) {
  const out: {
    environment: string[]
    allow?: string[]
    soft_deny?: string[]
    hard_deny?: string[]
  } = {
    environment: autoMode.environment.map(stripVariationSelectors),
  }
  for (const key of RULE_KEYS) {
    const arr = autoMode[key]
    if (arr !== undefined) out[key] = arr.map(stripVariationSelectors)
  }
  return out
}

/**
 * densable q3w — section-aware environment append (`### ` headers).
 */
export function mergeEnvironmentAppend(
  existing: string[],
  incoming: string[],
): string[] {
  const isHeader = (p: string) => p.startsWith('### ')
  const out = [...existing]
  const key = (section: string, line: string) =>
    `${section}\0${stripVariationSelectors(line)}`
  const sectionKeys = new Set<string>()
  const globalKeys = new Set<string>()
  {
    let section = ''
    for (const line of existing) {
      if (isHeader(line)) section = stripVariationSelectors(line)
      else {
        sectionKeys.add(key(section, line))
        globalKeys.add(stripVariationSelectors(line))
      }
    }
  }
  let insertAt = out.length
  let currentSection = ''
  let emptyHeaderIdx = -1
  let headerHasBody = false
  const dropEmptyHeader = () => {
    if (emptyHeaderIdx !== -1 && !headerHasBody) {
      out.splice(emptyHeaderIdx, 1)
      if (insertAt > emptyHeaderIdx) insertAt--
    }
    emptyHeaderIdx = -1
    headerHasBody = false
  }
  for (const line of incoming) {
    if (isHeader(line)) {
      dropEmptyHeader()
      currentSection = stripVariationSelectors(line)
      const existingIdx = out.findIndex(
        h => stripVariationSelectors(h) === currentSection,
      )
      if (existingIdx === -1) {
        out.push(line)
        emptyHeaderIdx = out.length - 1
        insertAt = out.length
      } else {
        let h = existingIdx + 1
        while (h < out.length && !isHeader(out[h]!)) h++
        insertAt = h
      }
      continue
    }
    const z = stripVariationSelectors(line)
    if (
      sectionKeys.has(key(currentSection, line)) ||
      sectionKeys.has(key('', line)) ||
      (currentSection === '' && globalKeys.has(z))
    ) {
      continue
    }
    out.splice(insertAt++, 0, line)
    sectionKeys.add(key(currentSection, line))
    globalKeys.add(z)
    if (emptyHeaderIdx !== -1) headerHasBody = true
  }
  dropEmptyHeader()
  return out
}

/**
 * densable K3w — merge rule arrays with $defaults seed / dedupe.
 */
export function mergeRuleArray(
  key: RuleKey,
  existing: string[],
  incoming: string[],
): string[] {
  const keepDefaults =
    key !== 'allow' ||
    existing.length === 0 ||
    existing.some(
      s => stripVariationSelectors(s) === AUTO_MODE_DEFAULTS_SENTINEL,
    )
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of [AUTO_MODE_DEFAULTS_SENTINEL, ...existing, ...incoming]) {
    const z = stripVariationSelectors(s)
    if (z === AUTO_MODE_DEFAULTS_SENTINEL && !keepDefaults) continue
    if (seen.has(z)) continue
    seen.add(z)
    out.push(s)
  }
  return out
}

/** densable uhs */
export function proposalToAutoModeWrite(
  proposal: AutoModeSetupProposal,
): NonNullable<AutoModeWriteInput['autoMode']> {
  return {
    environment: proposal.environment,
    ...(proposal.allow.length > 0 && { allow: proposal.allow }),
    ...(proposal.soft_deny.length > 0 && { soft_deny: proposal.soft_deny }),
    ...(proposal.hard_deny.length > 0 && { hard_deny: proposal.hard_deny }),
  }
}

/** densable wEo */
export function formatAutoModeSavedMessage(
  result: AutoModeWriteResult,
  removal: AutoModeRemovalStats,
): string {
  let msg =
    `Saved to ${result.filePath} (${result.autoModeKeysWritten.join(', ')}` +
    (result.environmentEntriesPreserved > 0
      ? `; kept ${result.environmentEntriesPreserved} existing environment ${result.environmentEntriesPreserved === 1 ? 'entry' : 'entries'}`
      : '') +
    (removal.removed > 0
      ? `; removed ${removal.removed} permissions.allow ${removal.removed === 1 ? 'entry' : 'entries'}`
      : '') +
    '). Run `claude auto-mode config` to see the effective result.'
  if (removal.skipped > 0) {
    msg += ` Note: ${removal.skipped} ${removal.skipped === 1 ? 'rule' : 'rules'} couldn't be removed — permissions.allow isn't an array in your settings.`
  }
  if ((removal.notFound ?? 0) > 0) {
    msg += ` Note: ${removal.notFound} ${removal.notFound === 1 ? 'rule was' : 'rules were'} already gone from permissions.allow.`
  }
  if (result.warnings.length > 0) {
    msg += `\n${result.warnings.join('\n')}`
  }
  return msg
}

function mapWriteError(
  error: Error,
  filePath: string,
): AutoModeSetupWriteError {
  if (error.message.includes('Invalid JSON syntax')) {
    return new AutoModeSetupWriteError(
      'settings_file_invalid',
      `The settings file at ${filePath} contains invalid JSON — fix or remove it, then re-run setup.`,
    )
  }
  return new AutoModeSetupWriteError(
    'write_failed',
    `Could not write ${filePath} — check file permissions and disk space (run with --debug for the underlying error).`,
  )
}

/**
 * densable x_ snapshot of `m`: uncached schema parse, else raw JSON.
 * Schema failure must still see existing autoMode / permissions so append
 * does not become replace (gold updater receives the live object, not `{}`).
 * Do not invent a public x_ API on settings.ts.
 */
function readUserSettingsSnapshot(filePath: string): SettingsJson {
  const parsed = getSettingsForSourceUncached('userSettings')
  if (parsed) return parsed
  let content: string | null = null
  try {
    content = readFileSync(filePath)
  } catch (e) {
    if (!isENOENT(e)) throw e
  }
  if (content === null) return {}
  const rawData = safeParseJSON(content)
  if (rawData === null) {
    throw new AutoModeSetupWriteError(
      'settings_file_invalid',
      `The settings file at ${filePath} contains invalid JSON — fix or remove it, then re-run setup.`,
    )
  }
  if (rawData && typeof rawData === 'object') {
    logForDebugging(
      `Using raw settings from ${filePath} due to validation failure`,
    )
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
 * densable V3w — merge + write userSettings.
 * `@param _storageV5` gold 4th-arg slot; tip ignores (no storageV5 host).
 */
export async function writeAutoModeSetup(
  input: AutoModeWriteInput,
  _storageV5?: unknown,
): Promise<AutoModeWriteResult> {
  const invalid = validateAutoModeWriteInput(input)
  if (invalid) throw new AutoModeSetupWriteError('invalid_input', invalid)

  const filePath = getSettingsFilePathForSource('userSettings')
  if (!filePath) {
    throw new AutoModeSetupWriteError(
      'no_user_settings_path',
      'Could not resolve the user settings file path.',
    )
  }

  const incoming =
    input.autoMode !== undefined ? normalizeIncoming(input.autoMode) : undefined
  const mode = input.mode ?? 'append'
  const toRemove = input.removeFromPermissionsAllow ?? []
  const warnings: string[] = []
  let environmentEntriesPreserved = 0
  let permissionsAllowRemoved: string[] = []
  let permissionsAllowNotFound: string[] = []
  let permissionsAllowSkipped = false
  let mergeError: string | null = null

  // densable x_ updater body: one uncached read of m (schema or raw), merge,
  // one write. Do not invent a public x_ API — getSettingsForSource is cached.
  const existing = readUserSettingsSnapshot(filePath)
  const patch: SettingsJson = {}

  if (incoming !== undefined) {
    const existingAuto = existing.autoMode
    if (Array.isArray(existingAuto)) {
      throw new AutoModeSetupWriteError(
        'invalid_merged',
        'the existing autoMode value in the settings file is an array — remove or fix it, then re-run setup.',
      )
    }
    const prev =
      existingAuto !== null && typeof existingAuto === 'object'
        ? (existingAuto as Record<string, unknown>)
        : undefined

    const next: Record<string, unknown> = {}
    if (mode === 'append') {
      const prevEnv = asStringArray(prev?.environment)
      environmentEntriesPreserved = prevEnv.length
      next.environment = mergeEnvironmentAppend(prevEnv, incoming.environment)
    } else {
      next.environment = incoming.environment
    }
    for (const key of RULE_KEYS) {
      const arr = incoming[key]
      if (arr === undefined) continue
      next[key] = mergeRuleArray(key, asStringArray(prev?.[key]), arr)
    }

    const mergedForValidate = { ...prev, ...next }
    const parsed = autoModeBlockSchema.safeParse(mergedForValidate)
    if (!parsed.success) {
      mergeError = `merging with the existing autoMode block in the settings file would produce an invalid result: ${formatZodIssues(parsed.error)}`
    } else {
      const env = next.environment as string[]
      const envBytes = Buffer.byteLength(JSON.stringify(env), 'utf8')
      if (env.length > ENV_ENTRY_WARN || envBytes > ENV_BYTES_WARN) {
        const w = `autoMode.environment now has ${env.length} entries (~${Math.round(envBytes / 1024)} KB). It's spliced into the classifier prompt on every auto-mode decision — consider pruning stale entries.`
        warnings.push(w)
        logForDebugging(`auto-mode setup: ${w}`, { level: 'warn' })
      }
      const sectionBytes = Buffer.byteLength(
        JSON.stringify(mergedForValidate),
        'utf8',
      )
      if (sectionBytes > AUTO_MODE_SECTION_WARN) {
        warnings.push(
          `The autoMode settings section is ${Math.round(sectionBytes / 1024)}KB serialized — the whole settings file stops loading past ${Math.round(SETTINGS_FILE_CAP / 1048576)}MiB. Consider trimming rules or environment entries.`,
        )
      }
      patch.autoMode = next as SettingsJson['autoMode']
    }
  }

  if (mergeError) {
    throw new AutoModeSetupWriteError('invalid_merged', mergeError)
  }

  if (toRemove.length > 0) {
    const allow = existing.permissions?.allow
    if (!Array.isArray(allow)) {
      permissionsAllowSkipped = true
    } else {
      const removeSet = new Set(toRemove)
      const remaining = allow.filter(r => !removeSet.has(r))
      permissionsAllowRemoved = allow.filter(r => removeSet.has(r))
      const present = new Set(allow)
      permissionsAllowNotFound = toRemove.filter(r => !present.has(r))
      if (permissionsAllowRemoved.length > 0) {
        patch.permissions = { allow: remaining }
      }
    }
  }

  if (Object.keys(patch).length > 0) {
    // gold x_ mergeWith(m, h): h.autoMode is k (incoming keys only). Sibling
    // autoMode keys (e.g. existing soft_deny when incoming omitted it) stay.
    const next = mergeWith(
      clone(existing) as SettingsJson,
      patch,
      (
        _objValue: unknown,
        srcValue: unknown,
        key: string | number | symbol,
        object: Record<string | number | symbol, unknown>,
      ) => {
        if (srcValue === undefined && object && typeof key === 'string') {
          delete object[key]
          return undefined
        }
        if (Array.isArray(srcValue)) {
          return srcValue
        }
        return undefined
      },
    )
    try {
      writeUserSettingsSnapshot(filePath, next)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      logForDebugging(`auto-mode setup write failed: ${error.message}`, {
        level: 'error',
      })
      throw mapWriteError(error, filePath)
    }
  }

  return {
    filePath,
    autoModeKeysWritten: incoming !== undefined ? Object.keys(incoming) : [],
    environmentEntriesPreserved,
    permissionsAllowRemoved,
    permissionsAllowNotFound,
    permissionsAllowSkipped,
    warnings,
  }
}

/** densable svr */
export async function saveAutoModeSetup(
  input: AutoModeWriteInput,
  storageV5?: unknown,
): Promise<AutoModeWriteResult> {
  let result: AutoModeWriteResult
  try {
    result = await writeAutoModeSetup(input, storageV5)
  } catch (err) {
    const code = err instanceof AutoModeSetupWriteError ? err.code : 'unknown'
    logEvent('tengu_auto_mode_setup_write_error', {
      code: code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    throw err
  }
  if (result.permissionsAllowSkipped) {
    logEvent('tengu_auto_mode_setup_write', {
      outcome:
        'permissions_allow_skipped' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } else {
    logEvent('tengu_auto_mode_setup_write', {
      outcome:
        'ok' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  return result
}
