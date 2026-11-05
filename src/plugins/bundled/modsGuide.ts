/**
 * densable 2.1.289 `cc-plugin-mods-guide` listing.
 * Gold hooksModule is Clawd cooking overlay on the How does this work card.
 * Listing + GB gate here; overlay BODY stays analog (not inlined).
 */
import { join } from 'path'
import { getPinnedFeatureValue } from '../../services/analytics/growthbook.js'
import { leftoverFu } from '../../utils/plugins/functionHooksModules.js'
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

export const MODS_GUIDE_PLUGIN_NAME = 'cc-plugin-mods-guide'
export const MODS_GUIDE_PLUGIN_DESCRIPTION =
  'How mods work: asked how hot reloading works, the question card gets a small panel over it with Clawd cooking, gone once the card is answered'
export const MODS_GUIDE_GB_FEATURE = 'tengu_linen_acorn'

export function isModsGuidePluginAvailable(): boolean {
  if (isScreenReaderModeEnabled()) return false
  return getPinnedFeatureValue(MODS_GUIDE_GB_FEATURE, false)
}

export function registerModsGuideBuiltinPlugin(): void {
  registerBuiltinPlugin({
    name: MODS_GUIDE_PLUGIN_NAME,
    description: MODS_GUIDE_PLUGIN_DESCRIPTION,
    isAvailable: isModsGuidePluginAvailable,
    hooksModule: leftoverFu(
      join(
        import.meta.dir,
        '../../../vendor/claude-code-mods/mods/cc-plugin-mods-guide',
      ),
      {
        register: (...args: unknown[]) => {
          const mod =
            require('../../../vendor/claude-code-mods/mods/cc-plugin-mods-guide/hooks/register.ts') as {
              register?: (...inner: unknown[]) => unknown
            }
          return mod.register?.(...args)
        },
      },
      () => ({
        scan: {
          hooks: ['ui.render'],
          calls: [
            'clock.every',
            'clock.now',
            'env.get',
            'settings.read',
            'ui.blit',
            'ui.resolve',
          ],
          env: {
            reads: ['FORCE_COLOR', 'NO_COLOR', 'TERM'],
            writes: [],
          },
        },
        files: {},
      }),
    ),
  })
}
