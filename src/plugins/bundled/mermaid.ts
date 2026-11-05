/**
 * densable 2.1.289 yfe `cc-plugin-mermaid` (`Ut` / `de` / `jt(Z)`).
 */
import { join } from 'path'
import { getPinnedFeatureValue } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { leftoverFu } from '../../utils/plugins/functionHooksModules.js'
import { leftoverHooksModulesOn } from '../../utils/plugins/pluginDevMods.js'
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

export const MERMAID_PLUGIN_NAME = 'cc-plugin-mermaid'
export const MERMAID_PLUGIN_DESCRIPTION =
  "Mermaid diagrams in the terminal: flowcharts and sequence diagrams in a reply's mermaid code fences are drawn in place as box-drawing text"
export const MERMAID_GB_FEATURE = 'tengu_mermaid_mod'

export function isMermaidPluginAvailable(): boolean {
  if (!leftoverHooksModulesOn()) return false
  if (isScreenReaderModeEnabled()) return false
  return getPinnedFeatureValue(MERMAID_GB_FEATURE, false)
}

function recordMermaidRenderOutcome(
  seen: Set<string>,
  outcome: 'drawn' | 'kept' | 'threw',
): void {
  if (seen.has(outcome)) return
  seen.add(outcome)
  if (outcome === 'drawn') {
    logEvent('tengu_feature_ok', {
      feature_name:
        'mermaid_render' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } else {
    const code = outcome === 'kept' ? 'fell_back' : 'threw'
    logEvent('tengu_feature_not_used', {
      feature_name:
        'mermaid_render' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
}

export function registerMermaidBuiltinPlugin(): void {
  registerBuiltinPlugin({
    name: MERMAID_PLUGIN_NAME,
    description: MERMAID_PLUGIN_DESCRIPTION,
    // gold uS omits defaultEnabled → PZ ?? true
    isAvailable: isMermaidPluginAvailable,
    hooksModule: leftoverFu(
      join(
        import.meta.dir,
        '../../../vendor/claude-code-mods/mods/cc-plugin-mermaid',
      ),
      {
        register: (on: unknown) => {
          const mod =
            require('../../../vendor/claude-code-mods/mods/cc-plugin-mermaid/hooks/register.ts') as {
              registerHooks?: (
                hookOn: unknown,
                recorder: {
                  record: (outcome: 'drawn' | 'kept' | 'threw') => void
                },
              ) => unknown
            }
          const seen = new Set<string>()
          return mod.registerHooks?.(on, {
            record: outcome => recordMermaidRenderOutcome(seen, outcome),
          })
        },
      },
      () => ({
        scan: { hooks: ['ui.render'], calls: [] },
        files: {},
      }),
    ),
  })
}
