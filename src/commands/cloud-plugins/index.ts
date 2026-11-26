import { isCloudPluginForwardingOptedOut } from '../../cli/cloudPluginForward.js'
import { isViolinWoodEnabledSync } from '../../cli/violinWood.js'
import type { Command } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

export const CLOUD_PLUGINS_AMATI_FLAG = 'tengu_violin_amati'

/**
 * Official 2.1.331 `iDo() && !s.CLAUDE_CODE_DISABLE_PLUGIN_FORWARDING`
 * where `iDo() = ES() && kDs()` (`tengu_violin_wood` && `tengu_violin_amati`).
 */
export function isCloudPluginsCommandEnabled(): boolean {
  if (isCloudPluginForwardingOptedOut()) return false
  try {
    return (
      isViolinWoodEnabledSync() &&
      Boolean(
        getFeatureValue_CACHED_MAY_BE_STALE(CLOUD_PLUGINS_AMATI_FLAG, false),
      )
    )
  } catch {
    return false
  }
}

/**
 * Official 2.1.331 `P_t` — `/cloud-plugins` consent dialog.
 */
const cloudPlugins = {
  type: 'local-jsx',
  name: 'cloud-plugins',
  description:
    'Choose whether cloud sessions use the plugins enabled on this machine',
  requires: { workspace: false, ink: true },
  isEnabled: () => isCloudPluginsCommandEnabled(),
  load: () => import('./cloud-plugins.js'),
} satisfies Command

export default cloudPlugins
