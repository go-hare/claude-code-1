import type { ComputerUseAPI } from '@ant/computer-use-swift'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'

const swiftLoaderHostSlot = new HostSlot<{
  cached: ComputerUseAPI | undefined
}>(() => ({
  cached: undefined,
}))

/**
 * macOS-only loader for @ant/computer-use-swift.
 * Non-darwin platforms should use src/utils/computerUse/platforms/ instead.
 */
export function requireComputerUseSwift(): ComputerUseAPI {
  const hostState = swiftLoaderHostSlot.of(getBootstrapSessionHost())
  if (hostState.cached) return hostState.cached
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@ant/computer-use-swift')
  if (mod.ComputerUseAPI && typeof mod.ComputerUseAPI === 'function') {
    hostState.cached = new mod.ComputerUseAPI() as ComputerUseAPI
  } else {
    hostState.cached = mod as ComputerUseAPI
  }
  return hostState.cached
}

export type { ComputerUseAPI }
