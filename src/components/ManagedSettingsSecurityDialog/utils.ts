import {
  DANGEROUS_SHELL_SETTINGS,
  isSafeManagedEnv,
} from '../../utils/managedEnvConstants.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { jsonStringify } from '../../utils/slowOperations.js'

type DangerousShellSetting = (typeof DANGEROUS_SHELL_SETTINGS)[number]

export type DangerousSettings = {
  shellSettings: Partial<Record<DangerousShellSetting, string>>
  envVars: Record<string, string>
  hasHooks: boolean
  hooks?: unknown
  /** densable hFt hasClaudeMd — managed CLAUDE.md injection */
  hasClaudeMd: boolean
  claudeMd?: string
}

/**
 * densable hFt — extract dangerous settings from a settings object.
 *
 * Dangerous env vars: any env NOT safe via densable B7t
 * (SAFE_ENV_VARS / LEh, or SAFE_WHEN_TRUTHY / MEh when truthy).
 * Shell helpers: densable S3l string or {command:string}.
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

  const shellSettings: Partial<Record<DangerousShellSetting, string>> = {}
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
 * densable KFs — format dangerous settings as name list for the UI.
 */
export function formatDangerousSettingsList(
  dangerous: DangerousSettings,
): string[] {
  const items: string[] = []

  for (const key of Object.keys(dangerous.shellSettings)) {
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
