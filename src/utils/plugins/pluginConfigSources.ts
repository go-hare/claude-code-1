/**
 * Official 2.1.207: pluginConfigs are only honored from user / --settings /
 * managed sources — never project `.claude/settings.json` or
 * `.claude/settings.local.json` (secrets must not be repo-committed).
 */
import { getEnabledSettingSources } from '../settings/constants.js'
import { getSettingsForSource } from '../settings/settings.js'

/** Sources that may contribute pluginConfigs (official 2.1.207). */
export const PLUGIN_CONFIG_SETTING_SOURCES = [
  'userSettings',
  'flagSettings',
  'policySettings',
] as const

export type PluginConfigOptionValue = string | number | boolean | string[]
export type PluginConfigOptions = Record<string, PluginConfigOptionValue>

export type PluginConfigEntry = {
  options?: PluginConfigOptions
  mcpServers?: Record<string, PluginConfigOptions>
}

/**
 * Pure merge used by loadPluginConfigFromAllowedSources (and unit tests).
 * Later entries in `sources` win on key collision.
 */
export function mergePluginConfigEntries(
  entries: Array<PluginConfigEntry | undefined | null>,
): PluginConfigEntry {
  let options: PluginConfigOptions | undefined
  let mcpServers: Record<string, PluginConfigOptions> | undefined

  for (const entry of entries) {
    if (!entry) continue
    if (entry.options) {
      options = { ...options, ...entry.options }
    }
    if (entry.mcpServers) {
      mcpServers = mcpServers ?? {}
      for (const [serverName, serverCfg] of Object.entries(entry.mcpServers)) {
        mcpServers[serverName] = {
          ...mcpServers[serverName],
          ...serverCfg,
        }
      }
    }
  }

  return { options, mcpServers }
}

/**
 * Merge `pluginConfigs[pluginId]` from the allowed setting sources only.
 */
export function loadPluginConfigFromAllowedSources(pluginId: string): {
  options?: PluginConfigOptions
  mcpServers?: Record<string, PluginConfigOptions>
} {
  const enabled = new Set(getEnabledSettingSources())
  const entries = PLUGIN_CONFIG_SETTING_SOURCES.map(source => {
    if (!enabled.has(source)) return undefined
    return getSettingsForSource(source)?.pluginConfigs?.[pluginId]
  })
  return mergePluginConfigEntries(entries)
}
