import { feature } from 'bun:bundle'
import { isBridgeEnabled } from '../../bridge/bridgeEnabled.js'
import type { Command } from '../../commands.js'
import { isRemoteControlDisabledBySettings } from '../../utils/residualFinalEnvGates.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

function isRemoteControlDisabledByManagedSettings(): boolean {
  try {
    return isRemoteControlDisabledBySettings(
      getInitialSettings().disableRemoteControl,
    )
  } catch {
    return false
  }
}

function isEnabled(): boolean {
  if (!feature('BRIDGE_MODE')) {
    return false
  }
  return isBridgeEnabled() || isRemoteControlDisabledByManagedSettings()
}

const bridge = {
  type: 'local-jsx',
  name: 'remote-control',
  aliases: ['rc'],
  description: 'Connect this terminal for remote-control sessions',
  argumentHint: '[name]',
  isEnabled,
  get isHidden() {
    return !isBridgeEnabled()
  },
  immediate: true,
  load: () => import('./bridge.js'),
} satisfies Command

export default bridge
