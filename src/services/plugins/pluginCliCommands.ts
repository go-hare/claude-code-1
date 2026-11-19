/**
 * CLI command wrappers for plugin operations
 *
 * This module provides thin wrappers around the core plugin operations
 * that handle CLI-specific concerns like console output and process exit.
 *
 * For the core operations (without CLI side effects), see pluginOperations.ts
 */
import figures from 'figures'
import { basename } from 'path'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { gracefulShutdown } from '../../utils/gracefulShutdown.js'
import { logError } from '../../utils/log.js'
import { getManagedPluginNames } from '../../utils/plugins/managedPlugins.js'
import {
  PluginCommandRefusedError,
  classifyPluginCommandRefusal,
  errorFromPluginFailureCode,
} from '../../utils/plugins/pluginCommandRefusal.js'
import { Io, re } from '../../utils/plugins/escapeSafeText.js'
import {
  parsePluginIdentifier,
  scopeToSettingSource,
} from '../../utils/plugins/pluginIdentifier.js'
import { hydrateSyncedPluginDirsFromDisk } from '../../utils/plugins/syncedPluginHydrate.js'
import type { PluginScope } from '../../utils/plugins/schemas.js'
import { writeToStdout } from '../../utils/process.js'
import {
  getSettingsFilePathForSource,
  parseSettingsFile,
} from '../../utils/settings/settings.js'
import { plural } from '../../utils/stringUtils.js'
import {
  buildPluginTelemetryFields,
  classifyPluginCommandError,
} from '../../utils/telemetry/pluginTelemetry.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../analytics/index.js'
import {
  printPluginCliJsonLine,
  withShownCommandSha256,
  type MarketplaceShownCommand,
  type PluginCliJsonCommand,
} from '../../utils/plugins/pluginAcceptCommand.js'
import {
  disableAllPluginsOp,
  disablePluginOp,
  enablePluginOp,
  type InstallableScope,
  installPluginOp,
  uninstallPluginOp,
  updatePluginOp,
  VALID_INSTALLABLE_SCOPES,
  VALID_UPDATE_SCOPES,
} from './pluginOperations.js'

export { VALID_INSTALLABLE_SCOPES, VALID_UPDATE_SCOPES }

/**
 * Official `u9o` (#346) — check if the settings file for `scope` has fatal
 * validation/parse errors that prevent Claude Code from loading it.
 */
export function getUnloadedSettingsWarning(
  scope?: PluginScope,
  deps: {
    getPath?: typeof getSettingsFilePathForSource
    parseFile?: typeof parseSettingsFile
  } = {},
): string | null {
  try {
    if (scope === undefined || scope === 'managed') return null
    const source = scopeToSettingSource(scope)
    const getPath = deps.getPath ?? getSettingsFilePathForSource
    const parseFile = deps.parseFile ?? parseSettingsFile
    const file = getPath(source)
    if (
      file === undefined ||
      (source === 'userSettings' && basename(file) === 'cowork_settings.json')
    ) {
      return null
    }
    const errors = parseFile(file).errors.filter(
      err =>
        (err.file === undefined || err.file === file) &&
        err.severity !== 'warning',
    )
    const [first] = errors
    if (first === undefined) return null
    const rest = errors.length - 1
    const errorClass =
      'errorClass' in first && typeof first.errorClass === 'string'
        ? first.errorClass
        : undefined
    const detail =
      first.path !== ''
        ? `its "${first.path.slice(0, 80)}" ${
            rest > 0 ? `and ${rest} other ${plural(rest, 'value')} are` : 'is'
          } not valid`
        : errorClass === 'unreadable'
          ? 'it could not be read'
          : 'it is not a JSON object'
    return `${file} does not load (${detail}), so Claude Code ignores the whole file, including anything this command wrote there. Fix the file, then run this command again if its change is missing. If a newer Claude Code wrote the file, update Claude Code instead.`
  } catch (err) {
    logForDebugging(
      `settings file check after a plugin command skipped: ${errorMessage(err)}`,
      { level: 'warn' },
    )
    return null
  }
}

/**
 * Official `$or` (#346) — append a warning when the target settings file does not load.
 */
export function withUnloadedSettingsWarning(
  message: string,
  scope?: PluginScope,
): string {
  const warning = getUnloadedSettingsWarning(scope)
  return warning === null
    ? message
    : `${message}\n${figures.warning} ${warning}`
}

type PluginCliCommand =
  | 'install'
  | 'uninstall'
  | 'enable'
  | 'disable'
  | 'disable-all'
  | 'update'

/**
 * Generic error handler for plugin CLI commands. Emits
 * tengu_plugin_command_failed before exit so dashboards can compute a
 * success rate against the corresponding success events.
 */
export type PluginCliJsonOptions = {
  json?: boolean
  scope?: string
  shownCommand?: MarketplaceShownCommand
}

function jsonCommandName(
  command: PluginCliCommand,
): PluginCliJsonCommand | undefined {
  if (command === 'disable-all') return 'disable'
  if (
    command === 'install' ||
    command === 'uninstall' ||
    command === 'enable' ||
    command === 'disable' ||
    command === 'update'
  ) {
    return command
  }
  return undefined
}

async function handlePluginCommandError(
  error: unknown,
  command: PluginCliCommand,
  plugin?: string,
  jsonOptions?: PluginCliJsonOptions,
): Promise<never> {
  logError(error)
  const failureCode =
    error instanceof PluginCommandRefusedError
      ? classifyPluginCommandRefusal(error).code
      : classifyPluginCommandError(error)
  const jsonCmd = jsonCommandName(command)
  if (jsonOptions?.json && jsonCmd) {
    await printPluginCliJsonLine({
      command: jsonCmd,
      outcome: 'failed',
      ...(command === 'disable-all' ? { all: true } : { plugin }),
      scope: jsonOptions.scope,
      message: errorMessage(error),
      failureCode,
      shownCommand: jsonOptions.shownCommand
        ? withShownCommandSha256(jsonOptions.shownCommand)
        : undefined,
    })
  }
  const operation = plugin
    ? `${command} plugin "${plugin}"`
    : command === 'disable-all'
      ? 'disable all plugins'
      : `${command} plugins`
  console.error(
    Io(`${figures.cross} Failed to ${operation}: ${errorMessage(error)}`),
  )
  const telemetryFields = plugin
    ? (() => {
        const { name, marketplace } = parsePluginIdentifier(plugin)
        return {
          _PROTO_plugin_name:
            name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
          ...(marketplace && {
            _PROTO_marketplace_name:
              marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
          }),
          ...buildPluginTelemetryFields(
            name,
            marketplace,
            getManagedPluginNames(),
          ),
        }
      })()
    : {}
  logEvent('tengu_plugin_command_failed', {
    command:
      command as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_category:
      failureCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...telemetryFields,
  })
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(1)
}

/**
 * CLI command: Install a plugin non-interactively
 * @param plugin Plugin identifier (name or plugin@marketplace)
 * @param scope Installation scope: user, project, or local (defaults to 'user')
 * @param configEntries densable --config KEY=VALUE (repeatable)
 * @param shownSourceCommand densable ptm grantKey (HK) after CLI consent
 */
export async function installPlugin(
  plugin: string,
  scope: InstallableScope = 'user',
  configEntries?: readonly string[],
  shownSourceCommand?: string,
  shownEntryHelper?: { command: string; archiveUrl: string },
  jsonOptions: PluginCliJsonOptions = {},
): Promise<void> {
  try {
    if (!jsonOptions.json) {
      console.log(re(`Installing plugin "${plugin}"...`))
    }

    const result = await installPluginOp(plugin, scope, {
      shownSourceCommand,
      shownEntryHelper,
    })

    if (!result.success) {
      throw errorFromPluginFailureCode(result.message, result.failureCode)
    }

    // Official 2.1.323 #2044 & #2189: when a plugin's install command exits 0
    // and writes to stderr, surface the stderr note and use a warning mark
    // instead of a plain success checkmark.
    let installLine = withUnloadedSettingsWarning(
      result.message,
      result.scope || scope,
    )
    if (result.commandStderr) {
      const { formatCommandSourceStderrNote, formatCommandSourceWarningHint } =
        await import('../../utils/plugins/pluginCommandSource.js')
      installLine = `${installLine}\n${formatCommandSourceStderrNote(result.commandStderr)}\n${formatCommandSourceWarningHint(false)}`
    }

    if (!jsonOptions.json) {
      const mark = result.commandPrinted ? figures.warning : figures.tick
      console.log(Io(`${mark} ${installLine}`))
    }

    // densable Kao: nothingWritten skips --config save (gold `$Jy` only on write).
    let configApplied: boolean | undefined =
      configEntries && configEntries.length > 0 ? true : undefined
    let notice = ''
    let unsetOptionCount: number | undefined
    if (result.nothingWritten) {
      if (configApplied) {
        notice = `${figures.warning} --config values were not saved, because this command changed nothing. To set them, run /plugin configure ${result.pluginId || plugin} in Claude Code.`
        configApplied = false
      }
    } else {
      const { formatPostInstallUserConfigResult } = await import(
        '../../utils/plugins/parsePluginCliConfig.js'
      )
      const userConfigRes = await formatPostInstallUserConfigResult(
        result.pluginId || plugin,
        configEntries,
      )
      notice = userConfigRes.notice
      unsetOptionCount = userConfigRes.unsetOptionCount
    }
    if (notice && !jsonOptions.json) {
      console.log(Io(notice))
    }
    const combined = notice ? `${installLine}\n${notice}` : installLine
    if (jsonOptions.json) {
      await printPluginCliJsonLine({
        command: 'install',
        outcome: 'ok',
        plugin,
        pluginId: result.pluginId,
        scope: result.scope || scope,
        message: combined,
        configApplied,
        ...(unsetOptionCount !== undefined ? { unsetOptionCount } : {}),
        ...(result.commandPrinted ? { commandPrinted: true } : {}),
      })
    }

    // _PROTO_* routes to PII-tagged plugin_name/marketplace_name BQ columns.
    // Unredacted plugin_id was previously logged to general-access
    // additional_metadata for all users — dropped in favor of the privileged
    // column route.
    const { name, marketplace } = parsePluginIdentifier(
      result.pluginId || plugin,
    )
    logEvent('tengu_plugin_installed_cli', {
      _PROTO_plugin_name:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(marketplace && {
        _PROTO_marketplace_name:
          marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      scope: (result.scope ||
        scope) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      install_source:
        'cli-explicit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginTelemetryFields(name, marketplace, getManagedPluginNames()),
    })

    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  } catch (error) {
    await handlePluginCommandError(error, 'install', plugin, jsonOptions)
  }
}

/**
 * CLI command: Uninstall a plugin non-interactively
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Uninstall from scope: user, project, or local (defaults to 'user')
 */
export async function uninstallPlugin(
  plugin: string,
  scope: InstallableScope = 'user',
  keepData = false,
  jsonOptions: PluginCliJsonOptions = {},
): Promise<void> {
  try {
    const result = await uninstallPluginOp(plugin, scope, !keepData)

    if (!result.success) {
      throw new Error(result.message)
    }

    if (jsonOptions.json) {
      await printPluginCliJsonLine({
        command: 'uninstall',
        outcome: 'ok',
        plugin,
        pluginId: result.pluginId,
        scope: result.scope || scope,
        keptData: keepData,
        message: result.message,
      })
    } else {
      console.log(Io(`${figures.tick} ${result.message}`))
    }

    const { name, marketplace } = parsePluginIdentifier(
      result.pluginId || plugin,
    )
    logEvent('tengu_plugin_uninstalled_cli', {
      _PROTO_plugin_name:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(marketplace && {
        _PROTO_marketplace_name:
          marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      scope: (result.scope ||
        scope) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginTelemetryFields(name, marketplace, getManagedPluginNames()),
    })

    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  } catch (error) {
    await handlePluginCommandError(error, 'uninstall', plugin, jsonOptions)
  }
}

/**
 * CLI command: Enable a plugin non-interactively
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Optional scope. If not provided, finds the most specific scope for the current project.
 */
export async function enablePlugin(
  plugin: string,
  scope?: InstallableScope,
  jsonOptions: PluginCliJsonOptions = {},
): Promise<void> {
  try {
    await hydrateSyncedPluginDirsFromDisk()
    const result = await enablePluginOp(plugin, scope)

    if (!result.success) {
      throw new Error(result.message)
    }

    const enableMessage = withUnloadedSettingsWarning(
      result.message,
      result.scope ?? scope,
    )
    if (jsonOptions.json) {
      await printPluginCliJsonLine({
        command: 'enable',
        outcome: 'ok',
        plugin,
        pluginId: result.pluginId,
        scope: result.scope ?? scope,
        message: enableMessage,
      })
    } else {
      console.log(Io(`${figures.tick} ${enableMessage}`))
    }

    const { name, marketplace } = parsePluginIdentifier(
      result.pluginId || plugin,
    )
    logEvent('tengu_plugin_enabled_cli', {
      _PROTO_plugin_name:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(marketplace && {
        _PROTO_marketplace_name:
          marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      scope:
        result.scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginTelemetryFields(name, marketplace, getManagedPluginNames()),
    })

    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  } catch (error) {
    await handlePluginCommandError(error, 'enable', plugin, jsonOptions)
  }
}

/**
 * CLI command: Disable a plugin non-interactively
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Optional scope. If not provided, finds the most specific scope for the current project.
 */
export async function disablePlugin(
  plugin: string,
  scope?: InstallableScope,
  jsonOptions: PluginCliJsonOptions = {},
): Promise<void> {
  try {
    await hydrateSyncedPluginDirsFromDisk()
    const result = await disablePluginOp(plugin, scope)

    if (!result.success) {
      throw new Error(result.message)
    }

    const disableMessage = withUnloadedSettingsWarning(
      result.message,
      result.scope ?? scope,
    )
    if (jsonOptions.json) {
      await printPluginCliJsonLine({
        command: 'disable',
        outcome: 'ok',
        plugin,
        pluginId: result.pluginId,
        scope: result.scope ?? scope,
        message: disableMessage,
      })
    } else {
      console.log(Io(`${figures.tick} ${disableMessage}`))
    }

    const { name, marketplace } = parsePluginIdentifier(
      result.pluginId || plugin,
    )
    logEvent('tengu_plugin_disabled_cli', {
      _PROTO_plugin_name:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(marketplace && {
        _PROTO_marketplace_name:
          marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      scope:
        result.scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginTelemetryFields(name, marketplace, getManagedPluginNames()),
    })

    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  } catch (error) {
    await handlePluginCommandError(error, 'disable', plugin, jsonOptions)
  }
}

/**
 * CLI command: Disable all enabled plugins non-interactively
 */
export async function disableAllPlugins(
  jsonOptions: PluginCliJsonOptions = {},
): Promise<void> {
  try {
    await hydrateSyncedPluginDirsFromDisk()
    const result = await disableAllPluginsOp()

    if (!result.success) {
      throw new Error(result.message)
    }

    if (jsonOptions.json) {
      await printPluginCliJsonLine({
        command: 'disable',
        outcome: 'ok',
        all: true,
        message: result.message,
      })
    } else {
      console.log(Io(`${figures.tick} ${result.message}`))
    }

    logEvent('tengu_plugin_disabled_all_cli', {})

    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  } catch (error) {
    await handlePluginCommandError(error, 'disable-all', undefined, jsonOptions)
  }
}

/**
 * CLI command: Update a plugin non-interactively
 * densable 2.1.229 #4: announceCommandSource → ptm for command sources; -y/--yes
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Scope to update
 * @param options.yes densable -y accept command source without prompt
 */
export async function updatePluginCli(
  plugin: string,
  scope: PluginScope,
  options: { yes?: boolean; json?: boolean; acceptCommand?: string } = {},
): Promise<void> {
  let shownCommand: MarketplaceShownCommand | undefined
  try {
    if (!options.json) {
      writeToStdout(
        `${re(`Checking for updates for plugin "${plugin}" at ${scope} scope…`)}\n`,
      )
    }

    const { promptCommandSourceConsent } = await import(
      '../../utils/plugins/pluginCommandSource.js'
    )

    const { promptEntryHeadersHelperConfirm } = await import(
      '../../utils/plugins/marketplaceHeadersHelper.js'
    )

    const result = await updatePluginOp(plugin, scope, {
      // SEA nyh: explicit:!0 + onEntryHelperDisclosure → bl + f3l
      explicit: true,
      onEntryHelperDisclosure: async (disclosure, helper, helperPluginId) => {
        writeToStdout(`${Io(disclosure)}\n`)
        const { describeEntryHelperShown, withAcceptCommandMatched } =
          await import('../../utils/plugins/pluginAcceptCommand.js')
        const shown = await describeEntryHelperShown({
          pluginId: helperPluginId ?? plugin,
          command: helper?.command ?? '',
          archiveUrl: helper?.archiveUrl ?? '',
        })
        shownCommand = withAcceptCommandMatched(shown, options.acceptCommand)
        const verdict = await promptEntryHeadersHelperConfirm({
          yes: options.yes === true,
          acceptCommand: options.acceptCommand,
          shown,
        })
        if (verdict === 'accepted') {
          shownCommand = undefined
        }
        return verdict
      },
      // densable R0v announceCommandSource → ptm; declined aborts
      announceCommandSource: async (pluginId, entry, acceptedCommand) => {
        const consent = await promptCommandSourceConsent(pluginId, entry, {
          yes: options.yes === true,
          acceptedCommand,
          acceptCommand: options.acceptCommand,
          onShown: shown => {
            shownCommand = shown
          },
        })
        if (consent?.kind === 'accepted') {
          shownCommand = undefined
        }
        if (consent?.kind === 'declined') {
          throw new Error('Aborted — the command was not run.')
        }
        return consent?.kind === 'accepted' ? consent.grantKey : undefined
      },
    })

    if (!result.success) {
      throw errorFromPluginFailureCode(result.message, result.failureCode)
    }

    if (options.json) {
      await printPluginCliJsonLine({
        command: 'update',
        outcome: 'ok',
        plugin,
        pluginId: result.pluginId,
        scope: result.scope ?? scope,
        message: result.message,
        updateOutcome: result.alreadyUpToDate ? 'up_to_date' : 'updated',
        oldVersion: result.oldVersion,
        newVersion: result.newVersion,
      })
    } else {
      if (result.folderNote !== undefined) {
        writeToStdout(`${result.folderNote}\n`)
      }
      writeToStdout(`${Io(`${figures.tick} ${result.message}`)}\n`)
    }

    if (!result.alreadyUpToDate) {
      const { name, marketplace } = parsePluginIdentifier(
        result.pluginId || plugin,
      )
      logEvent('tengu_plugin_updated_cli', {
        _PROTO_plugin_name:
          name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
        ...(marketplace && {
          _PROTO_marketplace_name:
            marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
        }),
        old_version: (result.oldVersion ||
          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        new_version: (result.newVersion ||
          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...buildPluginTelemetryFields(
          name,
          marketplace,
          getManagedPluginNames(),
        ),
      })
    }

    await gracefulShutdown(0)
  } catch (error) {
    await handlePluginCommandError(error, 'update', plugin, {
      json: options.json,
      scope,
      shownCommand,
    })
  }
}
