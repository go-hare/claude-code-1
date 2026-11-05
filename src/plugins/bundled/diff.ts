/**
 * densable 2.1.289 yfe `cc-plugin-diff` (`rl` / `vr` / `Hr` / `ft` / `Fr`).
 */
import { join } from 'path'
import { getIsInteractive, getIsRemoteMode } from '../../bootstrap/state.js'
import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  getPinnedFeatureValue,
} from '../../services/analytics/growthbook.js'
import { getGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  getLoadedFunctionHooksModules,
  handleHostOp,
  leftoverFu,
  rememberAskedPane,
} from '../../utils/plugins/functionHooksModules.js'
import { OFFICIAL_MARKETPLACE_NAME } from '../../utils/plugins/officialMarketplace.js'
import { isChildSession } from '../../utils/sessionRoleEnv.js'
import {
  BUILTIN_MARKETPLACE_NAME,
  getBuiltinPluginDefinition,
  getBuiltinPlugins,
  registerBuiltinPlugin,
} from '../builtinPlugins.js'

export const DIFF_MOD_FOLDER = 'diff'
export const DIFF_PLUGIN_NAME = 'cc-plugin-diff'
export const DIFF_STORE_ID = `${DIFF_PLUGIN_NAME}@${BUILTIN_MARKETPLACE_NAME}`
export const DIFF_PLUGIN_DESCRIPTION =
  'The diff panel as a plugin pane: /diff, the changed files and their hunks beside the transcript, refreshed as Claude edits'
export const DIFF_GB_FEATURE = 'tengu_quiet_dolphin'

const DESKTOP_ENTRYPOINTS = new Set(['claude-desktop', 'claude-desktop-3p'])

function isDesktopHostManagedBackground(): boolean {
  const entry = process.env.CLAUDE_CODE_ENTRYPOINT
  const lineage =
    Boolean(process.env.CLAUDE_CODE_HOST_GATEWAY_LINEAGE) &&
    Boolean(process.env.CLAUDE_CODE_HOST_CREDS_FILE)
  return (
    Boolean(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) &&
    Boolean(process.env.CLAUDE_CODE_USE_GATEWAY) &&
    ((entry !== undefined && DESKTOP_ENTRYPOINTS.has(entry)) || lineage)
  )
}

/**
 * densable `ft` — `!Ce() || yE() === "claude-desktop" && Ive()`.
 * Never export minify `ft` / `Ive`.
 */
function leftoverFt(): boolean {
  if (getIsInteractive()) return true
  const entry = process.env.CLAUDE_CODE_ENTRYPOINT
  return (
    entry === 'claude-desktop' &&
    !isChildSession() &&
    !isDesktopHostManagedBackground()
  )
}

export function isDiffPaneDrawable(): boolean {
  return leftoverFt()
}

/** densable `vr` — `ft() && eo(Ie(), true)`. */
export function isDiffPluginAvailable(): boolean {
  return leftoverFt() && getPinnedFeatureValue(DIFF_GB_FEATURE, true)
}

/** densable `Hr` — `ft() && k(Ie(), true)`. */
export function isDiffPluginOfferedNow(): boolean {
  return (
    leftoverFt() && getFeatureValue_CACHED_MAY_BE_STALE(DIFF_GB_FEATURE, true)
  )
}

const DIFF_RUNTIME_PLUGIN_NAME = `builtin:${DIFF_PLUGIN_NAME}`
const DIFF_STORE_OPEN_KEY = 'open'
const DIFF_PANE_ID = 'diff'

/**
 * densable `Wpn()` + `K4n(Sue)` — whether `cc-plugin-diff` is active and live
 * in `getLoadedFunctionHooksModules()`, superseding the classic diff sidebar.
 */
export function isDiffModLoaded(): boolean {
  if (getIsRemoteMode()) return false
  if (getBuiltinPluginDefinition(DIFF_PLUGIN_NAME)?.isAvailable?.() !== true) {
    return false
  }
  if (!getBuiltinPlugins().enabled.some(p => p.name === DIFF_PLUGIN_NAME)) {
    return false
  }
  const allowedSources = new Set([
    `${DIFF_PLUGIN_NAME}@${BUILTIN_MARKETPLACE_NAME}`,
    `${DIFF_MOD_FOLDER}@${BUILTIN_MARKETPLACE_NAME}`,
    `${DIFF_PLUGIN_NAME}@${OFFICIAL_MARKETPLACE_NAME}`,
    `${DIFF_MOD_FOLDER}@${OFFICIAL_MARKETPLACE_NAME}`,
  ])
  return getLoadedFunctionHooksModules().some(
    mod =>
      (mod.status === undefined || mod.status === 'live') &&
      (((mod.name === DIFF_RUNTIME_PLUGIN_NAME ||
        mod.name === `builtin:${DIFF_MOD_FOLDER}`) &&
        (mod.pluginStorageId === undefined ||
          allowedSources.has(mod.pluginStorageId))) ||
        ((mod.name === DIFF_PLUGIN_NAME || mod.name === DIFF_MOD_FOLDER) &&
          mod.pluginStorageId !== undefined &&
          allowedSources.has(mod.pluginStorageId))),
  )
}

/**
 * densable `Fr(e)` — carry `diffSidebarOpen` preference into the plugin store
 * (`$.store.get/set("open")`) and seed `asked` pane floor (`sNo`) when true.
 */
export async function carryDiffPanelPreference(
  savedOpen: boolean | undefined,
): Promise<void> {
  const existing = await handleHostOp(
    'store.get',
    [{ key: DIFF_STORE_OPEN_KEY }],
    DIFF_RUNTIME_PLUGIN_NAME,
  )
  if (existing === undefined && savedOpen !== undefined) {
    await handleHostOp(
      'store.set',
      [{ key: DIFF_STORE_OPEN_KEY, value: savedOpen }],
      DIFF_RUNTIME_PLUGIN_NAME,
    )
    logForDebugging(
      `diff: carried the built-in panel's saved preference (${savedOpen})`,
    )
  }
  if ((existing ?? savedOpen) === true) {
    rememberAskedPane({
      plugin: DIFF_RUNTIME_PLUGIN_NAME,
      id: DIFF_PANE_ID,
    })
  }
}

export function registerDiffBuiltinPlugin(): void {
  if (isDiffPluginOfferedNow()) {
    carryDiffPanelPreference(getGlobalConfig().diffSidebarOpen).catch(err => {
      logForDebugging(`diff: the panel preference did not carry: ${err}`)
    })
  }
  registerBuiltinPlugin({
    name: DIFF_PLUGIN_NAME,
    description: DIFF_PLUGIN_DESCRIPTION,
    isAvailable: isDiffPluginAvailable,
    hooksModule: leftoverFu(
      join(import.meta.dir, '../../../vendor/claude-code-mods/mods/diff'),
      {
        register: (...args: unknown[]) => {
          const mod =
            require('../../../vendor/claude-code-mods/mods/diff/hooks/register.ts') as {
              register?: (...inner: unknown[]) => unknown
            }
          return mod.register?.(...args)
        },
      },
      () => ({
        scan: {
          hooks: [
            'session.start',
            'ui.render',
            'command.run',
            'ui.close',
            'ui.focus',
            'ui.scroll',
            'tool.call',
            'prompt.submit',
          ],
          calls: [
            'clock.after',
            'clock.every',
            'clock.now',
            'command.register',
            'env.get',
            'fs.list',
            'fs.read',
            'fs.stat',
            'process.run',
            'session.id',
            'session.messages',
            'session.usage',
            'settings.read',
            'store.get',
            'store.set',
            'telemetry.log',
            'telemetry.mark',
            'ui.close',
            'ui.invalidate',
            'ui.log',
            'ui.open',
            'ui.resolve',
            'ui.status',
          ],
          runCommands: ['clear', 'diff', 'resume'],
          env: {
            reads: ['CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING'],
            writes: [],
          },
        },
        files: {},
      }),
    ),
  })
}
