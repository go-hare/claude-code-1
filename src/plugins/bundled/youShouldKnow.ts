/**
 * densable 2.1.289 `cc-plugin-you-should-know` listing.
 * Gold hooksModule lives in vendor/.../cc-plugin-you-should-know/hooks.
 * Listing + GB/sTn/taint gate here.
 */
import { join } from 'path'
import {
  leftoverComplianceTaintsSettled,
  leftoverTaintsInclude,
} from '../../cli/leftoverTulip.js'
import { leftoverFu } from '../../utils/plugins/functionHooksModules.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

export const YOU_SHOULD_KNOW_PLUGIN_NAME = 'cc-plugin-you-should-know'
export const YOU_SHOULD_KNOW_PLUGIN_DESCRIPTION =
  'You should know: a side agent watches your back while Claude works on longer tasks. It looks for things worth knowing that you might miss, and surfaces them above the prompt.'
export const YOU_SHOULD_KNOW_GB_FEATURE = 'tengu_jolly_dewdrop'

/**
 * densable bn — sTn() && !dl(hipaa/zdr/ldr) && k(Io(), false).
 * gold k is unpinned getFeatureValue_CACHED_MAY_BE_STALE (not eo pin).
 */
export function isYouShouldKnowPluginAvailable(): boolean {
  if (
    leftoverTaintsInclude('hipaa') ||
    leftoverTaintsInclude('zdr') ||
    leftoverTaintsInclude('ldr')
  ) {
    return false
  }
  if (!leftoverComplianceTaintsSettled()) return false
  return getFeatureValue_CACHED_MAY_BE_STALE(YOU_SHOULD_KNOW_GB_FEATURE, false)
}

export function registerYouShouldKnowBuiltinPlugin(): void {
  registerBuiltinPlugin({
    name: YOU_SHOULD_KNOW_PLUGIN_NAME,
    description: YOU_SHOULD_KNOW_PLUGIN_DESCRIPTION,
    defaultEnabled: false,
    isAvailable: isYouShouldKnowPluginAvailable,
    hooksModule: leftoverFu(
      join(
        import.meta.dir,
        '../../../vendor/claude-code-mods/mods/cc-plugin-you-should-know',
      ),
      {
        register: (...args: unknown[]) => {
          const mod =
            require('../../../vendor/claude-code-mods/mods/cc-plugin-you-should-know/hooks/register.ts') as {
              register?: (...inner: unknown[]) => unknown
            }
          return mod.register?.(...args)
        },
      },
      () => ({
        scan: {
          hooks: [
            'prompt.submit',
            'command.run',
            'turn.step',
            'ui.render',
            'session.detach',
            'session.end',
          ],
          calls: [
            'clock.after',
            'env.get',
            'model.fork',
            'prompt.fill',
            'prompt.read',
            'prompt.submit',
            'session.id',
            'session.surfaces',
            'session.version',
            'state.get',
            'state.set',
            'store.get',
            'store.set',
            'telemetry.log',
            'telemetry.mark',
            'ui.invalidate',
            'ui.resolve',
            'ui.toast',
          ],
          runCommands: ['plugin'],
          env: {
            reads: ['CLAUDE_CODE_YOU_SHOULD_KNOW_DEBUG', 'USER_TYPE'],
            writes: [],
          },
          state: {
            reads: [{ plugin: YOU_SHOULD_KNOW_PLUGIN_NAME, key: 'aboutOpen' }],
            writes: [{ plugin: YOU_SHOULD_KNOW_PLUGIN_NAME, key: 'aboutOpen' }],
          },
        },
        files: {},
      }),
    ),
  })
}
