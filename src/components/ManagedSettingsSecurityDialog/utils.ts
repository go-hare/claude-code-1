import {
  DANGEROUS_SHELL_SETTINGS,
  isSafeManagedEnv,
} from '../../utils/managedEnvConstants.js'
import { SETTINGS_KEY_ALIASES } from '../../utils/settings/settingsAliases.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { jsonStringify } from '../../utils/slowOperations.js'

/**
 * densable sJc — sandbox binary / ripgrep overrides that require managed-settings
 * approval (2.1.232 #34). Project settings cannot set these for runtime (#48);
 * when present on managed payload they still surface as dangerous shell keys
 * `sandbox.${key}` in d7e.
 */
export const DANGEROUS_SANDBOX_BINARY_KEYS = [
  'bwrapPath',
  'ripgrep',
  'socatPath',
] as const

export type DangerousSandboxBinaryKey =
  (typeof DANGEROUS_SANDBOX_BINARY_KEYS)[number]

type DangerousShellSetting = (typeof DANGEROUS_SHELL_SETTINGS)[number]

/**
 * densable shellSettings keys: S3l helpers + `sandbox.${sJc}` + dynamic
 * `extraKnownMarketplaces[...]` / `policyHelpers.*` projection keys (Y_e).
 */
export type DangerousShellKey =
  | DangerousShellSetting
  | `sandbox.${DangerousSandboxBinaryKey}`
  | string

export type DangerousSettings = {
  shellSettings: Record<string, string>
  envVars: Record<string, string>
  hasHooks: boolean
  hooks?: unknown
  /** densable hFt hasClaudeMd — managed CLAUDE.md injection */
  hasClaudeMd: boolean
  claudeMd?: string
}

/**
 * densable PN_ — resolve extraKnownMarketplaces, falling back to nxn alias
 * `additionalMarketplaces` when the canonical key is absent.
 */
export function resolveExtraKnownMarketplacesProjection(
  settings: SettingsJson | null | undefined,
): Record<string, unknown> | undefined {
  if (!settings) return undefined
  const rec = settings as SettingsJson & Record<string, unknown>
  const canonical = rec.extraKnownMarketplaces
  if (canonical !== undefined && canonical !== null) {
    return canonical as Record<string, unknown>
  }
  for (const { alias, canonical: canon } of SETTINGS_KEY_ALIASES) {
    if (canon !== 'extraKnownMarketplaces') continue
    const aliased = rec[alias]
    if (
      aliased !== undefined &&
      aliased !== null &&
      typeof aliased === 'object'
    ) {
      return aliased as Record<string, unknown>
    }
  }
  return undefined
}

/**
 * densable vBu — project a headersHelper command with optional source/url.
 */
export function formatExtraKnownHeadersHelperValue(
  command: string,
  source: string | undefined,
  url: string | undefined,
): string {
  return jsonStringify([
    command,
    typeof source === 'string' ? source : null,
    typeof url === 'string' ? url : null,
  ])
}

/**
 * densable Dwv — coerce sandbox binary field to a non-empty display string.
 * string path → path; {command, args?} → JSON-array form for hash/UI.
 */
export function coerceSandboxBinarySettingValue(
  value: unknown,
): string | undefined {
  if (typeof value === 'string') {
    return value.length > 0 ? value : undefined
  }
  // densable Dwv: string path or {command, args?}. booleans/numbers/null → ignore
  // (schema is string | {command}; truthy boolean alone is not a binary override).
  if (
    value !== null &&
    typeof value === 'object' &&
    'command' in value &&
    typeof (value as { command: unknown }).command === 'string'
  ) {
    const command = (value as { command: string }).command
    if (!command) return undefined
    const args =
      'args' in value && Array.isArray((value as { args: unknown }).args)
        ? (value as { args: unknown[] }).args.map(String)
        : []
    // densable Dwv: always JSON array of [command, ...args]
    return jsonStringify([command, ...args])
  }
  return undefined
}

/**
 * densable Owv — managed sandbox binary override present (bwrap/socat/ripgrep).
 * Used with benign-env-only short-circuit: env-only URL allowlist cannot skip
 * approval when sandbox binaries are set.
 */
export function hasDangerousSandboxBinarySettings(
  settings: SettingsJson | null | undefined,
): boolean {
  // densable Owv — true iff d7e would emit any sandbox.${sJc} shell key.
  // Share coerceSandboxBinarySettingValue so object/string rules match extract.
  const sandbox = (settings as { sandbox?: unknown } | null | undefined)
    ?.sandbox
  if (sandbox === null || typeof sandbox !== 'object') return false
  const s = sandbox as Record<string, unknown>
  return DANGEROUS_SANDBOX_BINARY_KEYS.some(
    key => coerceSandboxBinarySettingValue(s[key]) !== undefined,
  )
}

/**
 * densable hFt/d7e — extract dangerous settings from a settings object.
 *
 * Dangerous env vars: any env NOT safe via densable B7t
 * (SAFE_ENV_VARS / LEh, or SAFE_WHEN_TRUTHY / MEh when truthy).
 * Shell helpers: densable S3l string or {command:string}.
 * Sandbox binaries: densable sJc → shellSettings[`sandbox.${key}`] (232 #34).
 * Also: hooks object + non-empty claudeMd string.
 */
export function extractDangerousSettings(
  settings: SettingsJson | null | undefined,
): DangerousSettings {
  if (!settings) {
    return {
      shellSettings: {},
      envVars: {},
      hasHooks: false,
      hasClaudeMd: false,
    }
  }

  const shellSettings: Record<string, string> = {}
  const settingsRecord = settings as Record<string, unknown>
  for (const key of DANGEROUS_SHELL_SETTINGS) {
    const value = settingsRecord[key]
    let command: string | undefined
    if (typeof value === 'string') {
      command = value
    } else if (
      value !== null &&
      typeof value === 'object' &&
      'command' in value &&
      typeof (value as { command: unknown }).command === 'string'
    ) {
      command = (value as { command: string }).command
    }
    if (command !== undefined && command.length > 0) {
      shellSettings[key] = command
    }
  }

  // densable Y_e / PN_: extraKnownMarketplaces[*].source.headersHelper +
  // settings-source plugins[*].headersHelper / .source.command
  const extraKnown = resolveExtraKnownMarketplacesProjection(settings)
  if (extraKnown && typeof extraKnown === 'object') {
    for (const [marketplaceName, marketplaceValue] of Object.entries(
      extraKnown,
    )) {
      const marketplace =
        marketplaceValue !== null && typeof marketplaceValue === 'object'
          ? (marketplaceValue as Record<string, unknown>)
          : undefined
      const source = marketplace?.source
      if (!source || typeof source !== 'object') continue
      const sourceRec = source as Record<string, unknown>
      if (
        sourceRec.source === 'url' &&
        typeof sourceRec.headersHelper === 'string' &&
        sourceRec.headersHelper.length > 0
      ) {
        shellSettings[
          `extraKnownMarketplaces[${jsonStringify(marketplaceName)}].source.headersHelper`
        ] = formatExtraKnownHeadersHelperValue(
          sourceRec.headersHelper,
          'url',
          typeof sourceRec.url === 'string' ? sourceRec.url : undefined,
        )
      }
      if (sourceRec.source === 'settings' && Array.isArray(sourceRec.plugins)) {
        const nameCounts = new Map<string, number>()
        for (const plugin of sourceRec.plugins) {
          const pluginRec =
            plugin !== null && typeof plugin === 'object'
              ? (plugin as Record<string, unknown>)
              : undefined
          const pluginName = jsonStringify(pluginRec?.name)
          const idx = nameCounts.get(pluginName) ?? 0
          nameCounts.set(pluginName, idx + 1)
          const pluginSource = pluginRec?.source
          if (
            pluginSource !== null &&
            typeof pluginSource === 'object' &&
            'source' in pluginSource &&
            (pluginSource as { source?: unknown }).source === 'command' &&
            'command' in pluginSource &&
            typeof (pluginSource as { command?: unknown }).command ===
              'string' &&
            (pluginSource as { command: string }).command.length > 0
          ) {
            shellSettings[
              `extraKnownMarketplaces[${jsonStringify(marketplaceName)}].plugins[${jsonStringify(pluginRec?.name)}][${idx}].source.command`
            ] = (pluginSource as { command: string }).command
          }
          if (
            typeof pluginRec?.headersHelper === 'string' &&
            pluginRec.headersHelper.length > 0
          ) {
            const h = pluginRec.source
            const g = h !== null && typeof h === 'object'
            const sourceKind =
              g && 'source' in (h as object)
                ? (h as { source?: unknown }).source
                : undefined
            const sourceUrl =
              g && 'url' in (h as object)
                ? (h as { url?: unknown }).url
                : undefined
            shellSettings[
              `extraKnownMarketplaces[${jsonStringify(marketplaceName)}].plugins[${jsonStringify(pluginRec.name)}][${idx}].headersHelper`
            ] = formatExtraKnownHeadersHelperValue(
              pluginRec.headersHelper,
              typeof sourceKind === 'string' ? sourceKind : undefined,
              typeof sourceUrl === 'string' ? sourceUrl : undefined,
            )
          }
        }
      }
    }
  }

  // densable d7e: sandbox sJc keys → shellSettings[`sandbox.${s}`]
  const sandbox = settingsRecord.sandbox
  if (sandbox !== null && typeof sandbox === 'object') {
    const sandboxRec = sandbox as Record<string, unknown>
    for (const key of DANGEROUS_SANDBOX_BINARY_KEYS) {
      const coerced = coerceSandboxBinarySettingValue(sandboxRec[key])
      if (coerced) {
        shellSettings[`sandbox.${key}`] = coerced
      }
    }
  }

  const envVars: Record<string, string> = {}
  if (settings.env && typeof settings.env === 'object') {
    for (const [key, value] of Object.entries(settings.env)) {
      if (value === undefined) continue
      const asString = String(value)
      // densable: a.length > 0 && !B7t(i, a)
      if (asString.length > 0 && !isSafeManagedEnv(key, asString)) {
        envVars[key] = asString
      }
    }
  }

  const hasHooks =
    settings.hooks !== undefined &&
    settings.hooks !== null &&
    typeof settings.hooks === 'object' &&
    Object.keys(settings.hooks).length > 0

  const claudeMdRaw = settingsRecord.claudeMd
  const hasClaudeMd = typeof claudeMdRaw === 'string' && claudeMdRaw.length > 0

  return {
    shellSettings,
    envVars,
    hasHooks,
    hooks: hasHooks ? settings.hooks : undefined,
    hasClaudeMd,
    claudeMd: hasClaudeMd ? (claudeMdRaw as string) : undefined,
  }
}

/**
 * densable sOo — any dangerous surface present.
 */
export function hasDangerousSettings(dangerous: DangerousSettings): boolean {
  return (
    Object.keys(dangerous.shellSettings).length > 0 ||
    Object.keys(dangerous.envVars).length > 0 ||
    dangerous.hasHooks ||
    dangerous.hasClaudeMd
  )
}

/**
 * densable FLd — compare old vs new dangerous projections.
 */
export function hasDangerousSettingsChanged(
  oldSettings: SettingsJson | null | undefined,
  newSettings: SettingsJson | null | undefined,
): boolean {
  const oldDangerous = extractDangerousSettings(oldSettings)
  const newDangerous = extractDangerousSettings(newSettings)

  if (!hasDangerousSettings(newDangerous)) {
    return false
  }

  if (!hasDangerousSettings(oldDangerous)) {
    return true
  }

  const oldJson = jsonStringify({
    shellSettings: oldDangerous.shellSettings,
    envVars: oldDangerous.envVars,
    hooks: oldDangerous.hooks,
    claudeMd: oldDangerous.claudeMd,
  })
  const newJson = jsonStringify({
    shellSettings: newDangerous.shellSettings,
    envVars: newDangerous.envVars,
    hooks: newDangerous.hooks,
    claudeMd: newDangerous.claudeMd,
  })

  return oldJson !== newJson
}

/**
 * densable SN_ — parse vBu JSON `[command, source|null, url|null]`.
 */
function parseExtraKnownHeadersHelperValue(
  value: string,
): { command: string; url?: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      typeof parsed[0] !== 'string'
    ) {
      return undefined
    }
    return {
      command: parsed[0],
      url: typeof parsed[2] === 'string' ? parsed[2] : undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * densable U8s / KFs — format dangerous settings as name list for the UI.
 * extraKnownMarketplaces[*].headersHelper shows command (+ optional → url).
 */
export function formatDangerousSettingsList(
  dangerous: DangerousSettings,
): string[] {
  const items: string[] = []

  for (const [key, value] of Object.entries(dangerous.shellSettings)) {
    if (value === undefined) continue
    if (key.startsWith('extraKnownMarketplaces[')) {
      if (key.endsWith('.headersHelper')) {
        const parsed = parseExtraKnownHeadersHelperValue(value)
        if (parsed !== undefined) {
          items.push(
            `${key}: ${parsed.command}${
              parsed.url === undefined ? '' : ` → ${parsed.url}`
            }`,
          )
          continue
        }
      } else if (key.endsWith('.source.command')) {
        items.push(`${key}: ${value}`)
        continue
      }
    }
    items.push(key)
  }

  for (const key of Object.keys(dangerous.envVars)) {
    items.push(key)
  }

  if (dangerous.hasHooks) {
    items.push('hooks')
  }

  if (dangerous.hasClaudeMd) {
    items.push('claudeMd')
  }

  return items
}
