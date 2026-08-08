/**
 * densable 2.1.218 plugin install --config (BJy + $Jy).
 *
 * BJy: parse repeatable KEY=VALUE flags against manifest.userConfig.
 * $Jy: post-install apply + report still-unconfigured options.
 */
import figures from 'figures'
import type { LoadedPlugin } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import {
  formatFrontmatterBooleanError,
  tryParseBooleanFrontmatter,
} from '../frontmatterParser.js'
import { clearPluginCache, loadAllPluginsCacheOnly } from './pluginLoader.js'
import {
  getPluginStorageId,
  getUnconfiguredOptions,
  savePluginOptions,
  type PluginOptionSchema,
  type PluginOptionValues,
} from './pluginOptionsStorage.js'
import { validateUserConfig } from './mcpbHandler.js'

/**
 * densable BJy — parse CLI `--config KEY=VALUE` entries against a plugin's
 * userConfig schema. Throws densable error strings on bad input.
 */
export function parsePluginCliConfigFlags(
  entries: readonly string[],
  userConfig: PluginOptionSchema,
): PluginOptionValues {
  const out: PluginOptionValues = {}
  for (const raw of entries) {
    const eq = raw.indexOf('=')
    if (eq <= 0) {
      throw new Error(
        `--config expects KEY=VALUE, got "${raw}". Use --config key=value (repeatable).`,
      )
    }
    const key = raw.slice(0, eq)
    // densable: first line only, then trim
    const value = (raw.slice(eq + 1).split(/\r\n|\r|\n/, 1)[0] ?? '').trim()
    const field = Object.hasOwn(userConfig, key) ? userConfig[key] : undefined
    if (!field) {
      const known = Object.keys(userConfig)
      throw new Error(
        `--config key "${key}" isn't declared in this plugin's userConfig.` +
          (known.length > 0 ? ` Known keys: ${known.join(', ')}.` : ''),
      )
    }
    if (value === '') {
      throw new Error(
        `--config ${key}: value is empty. Omit the flag to leave "${key}" unset.`,
      )
    }
    if (field.type === 'number') {
      const n = Number(value)
      if (Number.isNaN(n)) {
        throw new Error(`--config ${key}: "${value}" is not a number`)
      }
      out[key] = n
    } else if (field.type === 'boolean') {
      // densable: require Jt(c) || nu(c); store Jt(c)
      const parsed = tryParseBooleanFrontmatter(value)
      if (parsed === undefined) {
        throw new Error(
          `--config ${key}: ${formatFrontmatterBooleanError(value)}`,
        )
      }
      out[key] = parsed
    } else {
      // string | file | directory — store string
      out[key] = value
    }
  }

  // densable nx: validate only schema keys present in parsed values
  const partialSchema: PluginOptionSchema = {}
  for (const [k, v] of Object.entries(userConfig)) {
    if (Object.hasOwn(out, k)) {
      partialSchema[k] = v
    }
  }
  const validation = validateUserConfig(out, partialSchema)
  if (!validation.valid) {
    throw new Error(
      `--config validation failed: ${validation.errors.join('; ')}`,
    )
  }
  return out
}

function pluralOption(n: number): string {
  return n === 1 ? 'option' : 'options'
}

function findLoadedPlugin(
  plugins: LoadedPlugin[],
  pluginId: string,
): LoadedPlugin | undefined {
  // densable Xao: match by source / name@marketplace / name
  const exact = plugins.find(
    p => p.source === pluginId || getPluginStorageId(p) === pluginId,
  )
  if (exact) return exact
  const byName = plugins.find(
    p => p.name === pluginId || p.source.startsWith(`${pluginId}@`),
  )
  return byName
}

/**
 * densable $Jy — after successful install, apply --config values and/or
 * report remaining unconfigured userConfig options.
 *
 * Returns a non-empty string to append under the install success line.
 * Throws when --config was given but cannot be applied (caller may soft-catch).
 */
export async function applyPostInstallPluginUserConfig(
  pluginId: string,
  configEntries: readonly string[] | undefined,
): Promise<string> {
  // densable qT() cache clear so just-installed plugin is visible
  clearPluginCache('post-install userConfig')
  const { enabled, disabled } = await loadAllPluginsCacheOnly()
  const plugin = findLoadedPlugin([...enabled, ...disabled], pluginId)
  if (!plugin) {
    if (configEntries && configEntries.length > 0) {
      throw new Error(
        `--config was given but plugin "${pluginId}" failed to load after install — run \`claude plugin list\` to see why.`,
      )
    }
    return ''
  }
  const userConfig = plugin.manifest.userConfig
  if (!userConfig || Object.keys(userConfig).length === 0) {
    if (configEntries && configEntries.length > 0) {
      throw new Error(
        `--config was given but plugin "${pluginId}" declares no userConfig options.`,
      )
    }
    return ''
  }
  if (configEntries && configEntries.length > 0) {
    const values = parsePluginCliConfigFlags(configEntries, userConfig)
    savePluginOptions(getPluginStorageId(plugin), values, userConfig)
  }
  const unconfigured = getUnconfiguredOptions(plugin)
  const keys = Object.keys(unconfigured)
  if (keys.length === 0) return ''
  const required = keys.filter(k => userConfig[k]?.required === true)
  return (
    `${keys.length} userConfig ${pluralOption(keys.length)} not yet set` +
    (required.length > 0 ? ` (${required.length} required)` : '') +
    ` — run /plugin configure ${pluginId} in Claude Code, or pass --config KEY=VALUE.`
  )
}

/**
 * densable swp post-install tail: run $Jy; soft-warn when --config fails after install.
 */
export async function formatPostInstallUserConfigNotice(
  pluginId: string,
  configEntries: readonly string[] | undefined,
): Promise<string> {
  try {
    return await applyPostInstallPluginUserConfig(pluginId, configEntries)
  } catch (e) {
    const msg = errorMessage(e)
    logForDebugging(`post-install userConfig step failed: ${msg}`, {
      level: 'warn',
    })
    if (configEntries && configEntries.length > 0) {
      return `${figures.warning} Installed, but --config not applied: ${msg}`
    }
    return ''
  }
}
