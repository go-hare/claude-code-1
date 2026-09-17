import { replaceMemoryToggledOff } from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'
import { logForDebugging } from './debug.js'

/**
 * Official AF — print restore after EF(pt), before empty DF(pt).
 * Yv = replaceMemoryToggledOff.
 */
export function restoreMemoryToggleFromWorkerState(
  restored: { internal?: Record<string, unknown> | null } | null | undefined,
): void {
  if (restored?.internal?.memory_toggled_off !== true) return
  replaceMemoryToggledOff(true)
  logEvent('tengu_memory_toggle_restored', {})
  logForDebugging(
    '[print.ts] restored /pause-memory toggle from prior worker epoch',
  )
}
