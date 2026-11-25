/**
 * densable 2.1.289 n0t / Ge / ye / uo / Lat / Nat / r0t — `/config key=value`.
 */
import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../types/command.js'
import { booleanOfInput } from '../../utils/booleanOfInput.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'

export const CONFIG_HELP_TOKENS = ['help', '-h', '--help'] as const
export const CONFIG_LIST_TOKENS = [
  'list',
  'show',
  'display',
  'current',
  'view',
  'get',
  'check',
  'describe',
  'print',
  'version',
  'about',
  'status',
  '?',
] as const

const MANAGED_ENUM_HINTS = new Map([
  ['agentsView', '/config (Agents view row)'],
  ['autoUpdatesChannel', '/channel'],
  ['showExternalIncludesDialog', '/config (External CLAUDE.md row)'],
])

const PLUGIN_CONFIG_REMOTE_REFUSAL =
  "a plugin's settings can't be changed over Remote Control or from a relayed message — open /config in the session itself"

export class ConfigSettingRefusalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigSettingRefusalError'
  }
}

export type ConfigSettingChange = {
  error?: Error | null
  messageSuffix?: string
}

export type ConfigSettingLock = {
  reason?: string
  source?: string
  reasonShipsOffBox?: boolean
  writableWhileLocked?: string[]
}

export type ConfigSettingRow = {
  id: string
  label: string
  searchText?: string
  type: 'boolean' | 'enum' | 'managedEnum'
  value: boolean | string
  options?: string[]
  optionsHint?: string
  coerce?: (raw: string) => string | undefined
  consentGated?: boolean
  canWithdraw?: () => boolean
  lock?: ConfigSettingLock
  onChange: (
    value: boolean | string,
  ) => Promise<ConfigSettingChange | undefined> | undefined
}

export type ConfigKeyValuePair = { key: string; raw: string }

export type ConfigShorthandResult = {
  ok: boolean
  kind: 'refusal' | 'locked' | 'save-failure'
  message: string
}

function asMeta(
  value: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

function displayLabel(row: ConfigSettingRow): string {
  return row.label
}

/** densable ye — lock blocks unless writableWhileLocked matches raw. */
export function isConfigSettingLockedForRaw(
  row: ConfigSettingRow,
  raw: string,
): boolean {
  return (
    row.lock !== undefined &&
    !row.lock.writableWhileLocked?.some(
      allowed => allowed.toLowerCase() === raw.toLowerCase(),
    )
  )
}

/** densable n0t */
export function parseConfigKeyValueArgs(
  args: string,
): ConfigKeyValuePair[] | null {
  const s = args.trim()
  if (!s || !s.includes('=')) return null
  const tokens = s.split(/\s+/)
  const withEq = tokens.filter(token => token.includes('=')).length
  if (withEq === 1) {
    const at = s.indexOf('=')
    const key = s.slice(0, at)
    if (!key || /\s/.test(key)) return null
    return [{ key, raw: s.slice(at + 1) }]
  }
  const pairs: ConfigKeyValuePair[] = []
  for (const token of tokens) {
    const at = token.indexOf('=')
    if (at <= 0) return null
    pairs.push({ key: token.slice(0, at), raw: token.slice(at + 1) })
  }
  return pairs
}

/** densable Ge */
export function findConfigSetting(
  key: string,
  rows: ConfigSettingRow[],
): ConfigSettingRow | undefined {
  const lower = key.toLowerCase()
  const caseInsensitive = rows.filter(row => row.id.toLowerCase() === lower)
  return (
    rows.find(row => row.id === key) ??
    (caseInsensitive.length === 1 ? caseInsensitive[0] : undefined)
  )
}

import type { ThemeSetting } from '../../utils/theme.js'

export type ConfigShorthandOverrides = {
  setTheme?: (setting: ThemeSetting) => unknown
  includeHooks?: boolean
  remoteToolServingOn?: boolean
}

function asConfigSettingRow(row: {
  id: string
  label: string | { toString(): string }
  searchText?: string
  type: ConfigSettingRow['type']
  value: boolean | string
  options?: string[]
  optionsHint?: string
  coerce?: (raw: string) => string | undefined
  consentGated?: boolean
  canWithdraw?: () => boolean
  lock?: ConfigSettingLock
  onChange: (value: boolean | string) => unknown
}): ConfigSettingRow {
  const label =
    typeof row.label === 'string' ? row.label : (row.searchText ?? row.id)
  return {
    id: row.id,
    label,
    ...(row.searchText !== undefined ? { searchText: row.searchText } : {}),
    type: row.type,
    value: row.value,
    ...(row.options !== undefined ? { options: row.options } : {}),
    ...(row.optionsHint !== undefined ? { optionsHint: row.optionsHint } : {}),
    ...(row.coerce !== undefined ? { coerce: row.coerce } : {}),
    ...(row.consentGated !== undefined
      ? { consentGated: row.consentGated }
      : {}),
    ...(row.canWithdraw !== undefined ? { canWithdraw: row.canWithdraw } : {}),
    ...(row.lock !== undefined ? { lock: row.lock } : {}),
    onChange: async value => {
      const result = await row.onChange(value)
      if (
        typeof result === 'object' &&
        result !== null &&
        ('error' in result || 'messageSuffix' in result)
      ) {
        return result as ConfigSettingChange
      }
      return undefined
    },
  }
}

/**
 * Official 2.1.331 `ke` (@335530540): keep `defaultToAgentsView` settable via
 * `/config defaultToAgentsView=false` even when `tengu_maple_sundial` replaces
 * it with the grouped `agentsView` row in the visual dialog.
 */
function mergeDialogFieldRowsForShorthand<T extends { id: string }>(
  settings: T[],
  dialogFieldRows: T[],
  isRemote: boolean,
): T[] {
  if (isRemote) return settings
  const targetId = 'defaultToAgentsView'
  return [
    ...settings.filter(row => row.id !== targetId),
    ...dialogFieldRows.filter(row => row.id === targetId),
  ]
}

/** densable we(ke(hKe(ce(n))), n) — core catalog + dialogFieldRows + plugin rows + hooks. */
export async function getConfigSettingsCatalog(
  context: LocalJSXCommandContext,
  overrides: ConfigShorthandOverrides = {},
): Promise<ConfigSettingRow[]> {
  const {
    hKe,
    ceFromCommandContext,
    weConfigPluginRows,
    wrapSettingWithConfigSetHook,
    describeConfigRowsWithHooks,
    PLUGIN_CONFIG_REMOTE_REFUSAL,
  } = await import('../../components/Settings/Config.js')
  const enabled = context.getAppState().plugins?.enabled ?? []
  const isRemote = getIsRemoteMode()
  const { settings, dialogFieldRows } = hKe(
    ceFromCommandContext(context, overrides),
  )
  const coreRows = mergeDialogFieldRowsForShorthand(
    settings,
    dialogFieldRows,
    isRemote,
  )
  let rows = weConfigPluginRows(coreRows, enabled, {
    storageV5: context.storageV5,
    reloadPlugins: context.reloadPlugins,
    ...(isRemote ? { refusal: PLUGIN_CONFIG_REMOTE_REFUSAL } : {}),
  })
  if (overrides.includeHooks !== false) {
    const origin = isRemote
      ? ({ kind: 'bridge' } as const)
      : ({ kind: 'composer' } as const)
    const describeOverrides = await describeConfigRowsWithHooks(rows)
    if (describeOverrides.size > 0) {
      rows = rows.flatMap(row => {
        const override = describeOverrides.get(row.id)
        if (override?.hidden) return []
        if (override) {
          return [{ ...row, label: override.label }]
        }
        return [row]
      })
    }
    rows = rows.map(row => wrapSettingWithConfigSetHook(row, origin))
  }
  return rows.map(row => asConfigSettingRow(row as never))
}

/** densable uo */
export async function applyConfigSetting(
  key: string,
  raw: string,
  rows: ConfigSettingRow[],
): Promise<ConfigShorthandResult> {
  const row = findConfigSetting(key, rows)
  try {
    const { logEvent } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
    logEvent('tengu_config_shorthand', {
      key_hash: asMeta(key),
      matched: row !== undefined,
    })
  } catch {
    // telemetry optional
  }
  if (!row) {
    const matches = rows.filter(
      candidate => candidate.id.toLowerCase() === key.toLowerCase(),
    )
    return {
      ok: false,
      kind: 'refusal',
      message:
        matches.length > 1
          ? `${key} matches ${matches.map(m => m.id).join(' and ')}; type one exactly.`
          : `${key} isn't a /config setting. Run /config to see what's available.`,
    }
  }
  const label = displayLabel(row)
  if (isConfigSettingLockedForRaw(row, raw)) {
    const kind: ConfigShorthandResult['kind'] =
      row.lock?.reason === PLUGIN_CONFIG_REMOTE_REFUSAL ||
      row.lock?.reasonShipsOffBox
        ? 'refusal'
        : 'locked'
    return {
      ok: false,
      kind,
      message: `Couldn't save ${label}: ${row.lock?.reason}`,
    }
  }
  if (row.consentGated) {
    const turningOff = booleanOfInput(raw) === false
    const offPath =
      (row.type === 'boolean' && turningOff) ||
      (row.lock !== undefined && !isConfigSettingLockedForRaw(row, raw))
    const held = row.value === true || row.canWithdraw?.() === true
    if (offPath && !held) {
      return {
        ok: true,
        kind: 'refusal',
        message: `${key} is already off.`,
      }
    }
    if (!(offPath && held)) {
      return {
        ok: false,
        kind: 'refusal',
        message: `${label} can't be enabled with key=value — open /config to change it from the panel.`,
      }
    }
  }
  switch (row.type) {
    case 'boolean': {
      const next = booleanOfInput(raw)
      if (next === undefined) {
        return {
          ok: false,
          kind: 'refusal',
          message: `${label} takes true or false, not "${raw}".`,
        }
      }
      const result = await row.onChange(next)
      if (result?.error) {
        const suffix = result.messageSuffix ?? ''
        if (result.error instanceof ConfigSettingRefusalError) {
          return {
            ok: false,
            kind: 'refusal',
            message: `${label}: ${result.error.message}${suffix}`,
          }
        }
        return {
          ok: false,
          kind: 'save-failure',
          message: `Couldn't save ${label}: ${result.error.message}${suffix}`,
        }
      }
      return {
        ok: true,
        kind: 'refusal',
        message: `Set ${label} to ${next ? 'true' : 'false'}${result?.messageSuffix ?? ''}`,
      }
    }
    case 'enum':
    case 'managedEnum': {
      const coerce = row.coerce
      if (!row.options && !coerce) {
        return {
          ok: false,
          kind: 'refusal',
          message: `${label} can't be set with key=value — use ${MANAGED_ENUM_HINTS.get(row.id) ?? '/config'}.`,
        }
      }
      const next = coerce
        ? coerce(raw)
        : row.options?.find(
            option => option.toLowerCase() === raw.toLowerCase(),
          )
      if (next === undefined) {
        const hint =
          row.type === 'managedEnum' && row.optionsHint
            ? ` ${row.optionsHint}`
            : ''
        return {
          ok: false,
          kind: 'refusal',
          message: row.options
            ? `${label} takes one of: ${row.options.join(', ')}.${hint}`
            : `${label} doesn't accept "${raw}".${hint}`,
        }
      }
      const result = await row.onChange(next)
      if (result?.error) {
        const suffix = result.messageSuffix ?? ''
        if (result.error instanceof ConfigSettingRefusalError) {
          return {
            ok: false,
            kind: 'refusal',
            message: `${label}: ${result.error.message}${suffix}`,
          }
        }
        return {
          ok: false,
          kind: 'save-failure',
          message: `Couldn't save ${label}: ${result.error.message}${suffix}`,
        }
      }
      return {
        ok: true,
        kind: 'refusal',
        message: `Set ${label} to ${next}${result?.messageSuffix ?? ''}`,
      }
    }
  }
}

/** densable Nat — withhold save-failure/locked detail off-box. */
export function formatConfigShorthandResult(
  result: ConfigShorthandResult,
  withholdDetail: boolean,
): string {
  if (!withholdDetail) return result.message
  switch (result.kind) {
    case 'save-failure':
      return "Couldn't save this setting (detail withheld on this connection)."
    case 'locked':
      return "Couldn't save this setting: a trusted policy owns it (detail withheld on this connection)."
    case 'refusal':
      return result.message
  }
}

/** densable r0t */
export function formatConfigShorthandUsage(rows: ConfigSettingRow[]): string {
  return rows
    .flatMap(row => {
      if (row.consentGated) return []
      const spec =
        row.type === 'boolean'
          ? 'true|false'
          : row.options
            ? row.options.join('|')
            : row.type === 'managedEnum' && row.coerce
              ? '<value>'
              : null
      return spec ? [`  ${row.id}=${spec}`] : []
    })
    .sort()
    .join('\n')
}

/** densable Lat / _Mn */
export async function applyConfigKeyValues(
  pairs: ConfigKeyValuePair[],
  context: LocalJSXCommandContext,
  overrides: ConfigShorthandOverrides = {},
): Promise<ConfigShorthandResult[]> {
  let rows = await getConfigSettingsCatalog(context, overrides)
  const hitPolicyLock = pairs.some(({ key, raw }) => {
    const row = findConfigSetting(key, rows)
    return (
      row !== undefined &&
      row.lock?.source !== 'managed' &&
      isConfigSettingLockedForRaw(row, raw)
    )
  })
  if (hitPolicyLock) {
    try {
      const { refreshPolicyLimits } = await import(
        '../../services/policyLimits/index.js'
      )
      await refreshPolicyLimits()
    } catch {
      // ignore refresh error
    }
    rows = await getConfigSettingsCatalog(context, overrides)
  }
  const results: ConfigShorthandResult[] = []
  for (const { key, raw } of pairs) {
    results.push(await applyConfigSetting(key, raw, rows))
  }
  return results
}

export function isConfigHelpOrListToken(token: string): boolean {
  const t = token.toLowerCase()
  return (
    (CONFIG_HELP_TOKENS as readonly string[]).includes(t) ||
    (CONFIG_LIST_TOKENS as readonly string[]).includes(t)
  )
}

export async function formatConfigShorthandHelp(
  context: LocalJSXCommandContext,
): Promise<string> {
  const rows = await getConfigSettingsCatalog(context, { includeHooks: false })
  const usage = formatConfigShorthandUsage(rows)
  return `Usage: /config key=value [key=value ...]\n${usage}`
}

export async function applyConfigShorthandFromArgs(
  args: string,
  context: LocalJSXCommandContext,
  overrides: ConfigShorthandOverrides = {},
): Promise<string> {
  const pairs = parseConfigKeyValueArgs(args)
  if (!pairs) {
    return `Expected key=value, got "${args}". Run /config to see what's available.`
  }
  const results = await applyConfigKeyValues(pairs, context, overrides)
  const withhold = getIsRemoteMode()
  return results
    .map(result => formatConfigShorthandResult(result, withhold))
    .join('\n')
}

/**
 * Official 2.1.331 `xud` + `jo` (@335533800, @335534620):
 * - Synthesizes `['true', 'false']` for boolean rows
 * - Filters to settable rows (boolean, options, or managedEnum with coerce)
 * - Falls back to `optionsHint` for description when no fixed options exist
 */
export async function getConfigArgumentCompletions(
  args: string,
  context: LocalJSXCommandContext,
): Promise<
  Array<{
    value: string
    description?: string
    isFinal?: boolean
    appendSpace?: boolean
  }>
> {
  const catalog = await getConfigSettingsCatalog(context, {
    includeHooks: false,
  })
  const settable = catalog.flatMap(row => {
    if (row.consentGated) return []
    const options =
      row.type === 'boolean'
        ? ['true', 'false']
        : row.options && row.options.length > 0
          ? row.options
          : undefined
    if (options || (row.type === 'managedEnum' && row.coerce)) {
      return [
        {
          id: row.id,
          options,
          hint: row.type === 'managedEnum' ? row.optionsHint : undefined,
        },
      ]
    }
    return []
  })
  const eq = args.indexOf('=')
  if (eq === -1) {
    const prefix = args.toLowerCase()
    return settable
      .filter(item => item.id.toLowerCase().startsWith(prefix))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(item => ({
        value: `${item.id}=`,
        description: item.options?.slice(0, 4).join(' | ') ?? item.hint,
        isFinal: false,
        appendSpace: false,
      }))
  }
  const key = args.slice(0, eq)
  const valuePrefix = args.slice(eq + 1).toLowerCase()
  const match = settable.find(
    candidate => candidate.id.toLowerCase() === key.toLowerCase(),
  )
  if (!match?.options) return []
  return match.options
    .filter(option => option.toLowerCase().startsWith(valuePrefix))
    .map(option => ({
      value: `${match.id}=${option}`,
      isFinal: true,
    }))
}
