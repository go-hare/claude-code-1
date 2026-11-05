/**
 * densable 2.1.289 yfe `cc-plugin-responsive-mode` (`B` / `c` / `oX` / `Gxn`).
 * Gold c = oX() && !Gxn() && eo("tengu_quiet_ember", false).
 */
import { join } from 'path'
import { getIsInteractive } from '../../bootstrap/state.js'
import { getPinnedFeatureValue } from '../../services/analytics/growthbook.js'
import { leftoverFu } from '../../utils/plugins/functionHooksModules.js'
import { isChildSession } from '../../utils/sessionRoleEnv.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

export const RESPONSIVE_MODE_PLUGIN_NAME = 'cc-plugin-responsive-mode'
export const RESPONSIVE_MODE_PLUGIN_DESCRIPTION =
  'Responsive mode: Claude replies to you in a sentence before thinking or using tools, on every prompt'
export const RESPONSIVE_MODE_GB_FEATURE = 'tengu_quiet_ember'

/**
 * densable oX Set `O` — attended entrypoints when not interactive.
 * Never export minify oX.
 */
const leftoverOxAttendedEntrypoints = new Set([
  'claude-vscode',
  'claude-desktop',
  'claude-desktop-3p',
  'local-agent',
  'local_agent',
  'remote',
  'remote_desktop',
  'remote_mobile',
  'remote_projects',
  'remote_cowork',
  'ssh-remote',
  'claude-in-slack',
  'claude_in_slack',
  'claude-in-teams',
  'claude-coworker',
  'claude-coworker-terminal',
])

/**
 * densable oX: false for bg/daemon/daemon-worker or Sy() teammateAgentId;
 * interactive → true; else !childSession && ENTRYPOINT in O.
 * Never export minify oX.
 */
function leftoverOx(): boolean {
  const kind = process.env.CLAUDE_CODE_SESSION_KIND
  if (kind === 'bg' || kind === 'daemon' || kind === 'daemon-worker') {
    return false
  }
  try {
    const { getBootstrapSessionHost } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/sessionRoot.js') as typeof import('../../utils/sessionRoot.js')
    if (
      getBootstrapSessionHost().extensionsConfig.teammateAgentId() !== undefined
    ) {
      return false
    }
  } catch {
    // host optional
  }
  if (getIsInteractive()) return true
  if (isChildSession()) return false
  const entry = process.env.CLAUDE_CODE_ENTRYPOINT
  return entry !== undefined && leftoverOxAttendedEntrypoints.has(entry)
}

/**
 * densable Gxn — claude-in-slack / claude_in_slack / claude-in-teams.
 * Never export minify Gxn.
 */
function leftoverGxn(): boolean {
  const entry = process.env.CLAUDE_CODE_ENTRYPOINT
  return (
    entry === 'claude-in-slack' ||
    entry === 'claude_in_slack' ||
    entry === 'claude-in-teams'
  )
}

export function isResponsiveModePluginAvailable(): boolean {
  return (
    leftoverOx() &&
    !leftoverGxn() &&
    getPinnedFeatureValue(RESPONSIVE_MODE_GB_FEATURE, false)
  )
}

export function registerResponsiveModeBuiltinPlugin(): void {
  registerBuiltinPlugin({
    name: RESPONSIVE_MODE_PLUGIN_NAME,
    description: RESPONSIVE_MODE_PLUGIN_DESCRIPTION,
    defaultEnabled: false,
    isAvailable: isResponsiveModePluginAvailable,
    hooksModule: leftoverFu(
      join(
        import.meta.dir,
        '../../../vendor/claude-code-mods/mods/cc-plugin-responsive-mode',
      ),
      {
        register: (on: unknown) => {
          const mod =
            require('../../../vendor/claude-code-mods/mods/cc-plugin-responsive-mode/hooks/register.ts') as {
              registerHooks?: (
                hookOn: unknown,
                spliced: () => boolean,
              ) => unknown
            }
          return mod.registerHooks?.(on, () => false)
        },
      },
      () => ({
        scan: {
          hooks: ['prompt.section', 'prompt.submit', 'ui.render'],
          calls: ['turn.abort'],
        },
        files: {},
      }),
    ),
  })
}
