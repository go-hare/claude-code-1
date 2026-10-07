/**
 * densable 2.1.289 `pluginConfigureHandler` (Ja).
 *
 * - No --values-stdin: list each userConfig option and whether it is set.
 * - --values-stdin: read a JSON object of values from stdin (≤256 KiB) and save.
 */
import figures from 'figures'
import { setUseCoworkPlugins } from '../../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { clearPluginCache, loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import {
  getPluginStorageId,
  getUnconfiguredOptions,
  loadPluginOptionsNw,
  savePluginOptions,
  type PluginOptionSchema,
} from '../../utils/plugins/pluginOptionsStorage.js'
import { parsePluginCliConfigFlags } from '../../utils/plugins/parsePluginCliConfig.js'
import { re } from '../../utils/plugins/escapeSafeText.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { readStdinUpTo } from '../vscodeStdin.js'
import { cliError, cliOk } from '../exit.js'

function findInstalledPlugin(
  plugins: LoadedPlugin[],
  pluginId: string,
): LoadedPlugin | undefined {
  const exact = plugins.find(
    p => p.source === pluginId || getPluginStorageId(p) === pluginId,
  )
  if (exact) return exact
  return plugins.find(
    p => p.name === pluginId || p.source.startsWith(`${pluginId}@`),
  )
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') {
      out[k] = v
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      // densable peels say "JSON object of strings"; coerce primitives that
      // parsePluginCliConfigFlags already accepts via KEY=VALUE.
      out[k] = String(v)
    } else {
      return undefined
    }
  }
  return out
}

export async function pluginConfigureHandler(
  plugin: string,
  options: { cowork?: boolean; json?: boolean; valuesStdin?: boolean },
): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  logEvent('tengu_plugin_configure_command', {})

  clearPluginCache('plugin configure')
  const { enabled, disabled } = await loadAllPluginsCacheOnly()
  const loaded = findInstalledPlugin([...enabled, ...disabled], plugin)
  if (!loaded) {
    logEvent('cli_plugin_configure', {
      outcome:
        'not_found' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    cliError(
      `No installed plugin has the id "${plugin}". Use its full id (name@marketplace), as \`claude plugin list${options.cowork ? ' --cowork' : ''}\` shows it.`,
    )
  }

  const pluginId = getPluginStorageId(loaded)
  const schema: PluginOptionSchema = loaded.manifest.userConfig ?? {}
  const displayName = loaded.manifest.name ?? loaded.name
  const example =
    'Example: claude plugin configure <plugin> --values-stdin < values.json'

  if (options.valuesStdin) {
    if (process.stdin.isTTY) {
      logEvent('cli_plugin_configure', {
        outcome:
          'invalid_stdin' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      cliError(`No option values were piped in. ${example}`)
    }
    const raw = await readStdinUpTo(256 * 1024)
    if (raw === null) {
      logEvent('cli_plugin_configure', {
        outcome:
          'invalid_stdin' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      cliError('The input on stdin is over the 256 KB limit.')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    const record = asStringRecord(parsed)
    if (record === undefined) {
      logEvent('cli_plugin_configure', {
        outcome:
          'invalid_stdin' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      cliError(`The input on stdin isn't a JSON object of strings. ${example}`)
    }
    if (Object.keys(schema).length === 0) {
      cliError(
        `--config was given but plugin "${pluginId}" declares no userConfig options.`,
      )
    }
    const entries = Object.entries(record).map(([k, v]) => `${k}=${v}`)
    let savedKeys: string[] = []
    try {
      const values = parsePluginCliConfigFlags(entries, schema)
      await savePluginOptions(pluginId, values, schema)
      savedKeys = Object.keys(values)
    } catch (e) {
      logEvent('cli_plugin_configure', {
        outcome:
          'save_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      cliError(`Failed to save configuration: ${errorMessage(e)}`)
    }
    let unconfigured: string[] | undefined
    try {
      unconfigured = Object.keys(await getUnconfiguredOptions(loaded))
    } catch (e) {
      logError(e)
    }
    if (options.json) {
      cliOk(
        jsonStringify({
          pluginId,
          displayName,
          saved: savedKeys,
          ...(unconfigured ? { unconfigured } : {}),
        }),
      )
    }
    cliOk(
      savedKeys.length > 0
        ? 'Configuration saved. Restart Claude Code to apply it.'
        : 'No configuration changes.',
    )
  }

  let saved: Record<string, unknown>
  let unconfiguredKeys: string[]
  try {
    saved = await loadPluginOptionsNw(pluginId)
    unconfiguredKeys = Object.keys(await getUnconfiguredOptions(loaded))
  } catch (e) {
    logEvent('cli_plugin_configure', {
      outcome:
        'saved_options_read_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    cliError(
      `Could not read the saved options for "${pluginId}": ${errorMessage(e)}`,
    )
  }

  const configured = Object.keys(schema).filter(k => {
    const v = saved[k]
    return v !== undefined && v !== ''
  })

  if (options.json) {
    cliOk(
      jsonStringify({
        pluginId,
        displayName,
        schema,
        configured,
        unconfigured: unconfiguredKeys,
      }),
    )
  }

  if (Object.keys(schema).length === 0) {
    cliOk(`${displayName} (${pluginId}) has no options to set.`)
  }

  const lines: string[] = [`Options for ${re(displayName)} (${re(pluginId)}):`]
  for (const [key, field] of Object.entries(schema)) {
    const flags = [
      field.required ? 'required' : 'optional',
      field.sensitive ? 'sensitive' : undefined,
      configured.includes(key) ? 'set' : 'not set',
    ].filter(Boolean)
    const title =
      field.title && field.title !== key ? ` — ${field.title}` : ''
    lines.push(
      `  ${figures.pointer} ${key}${title} (${flags.join(', ')})`,
    )
  }
  lines.push(
    '',
    'Set values with /plugin configure <plugin> in Claude Code, or pipe a JSON object to `claude plugin configure <plugin> --values-stdin`.',
  )
  cliOk(lines.join('\n'))
}
