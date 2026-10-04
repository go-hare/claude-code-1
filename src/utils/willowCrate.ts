import { getIsRemoteMode } from '../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

export type CommandPresentation = 'fullscreen' | 'inline'

/**
 * densable `Bve` — `!x("tengu_jazzy_ripple", false)`.
 * Gates the fullscreen REPL uncommitted diff panel. Official default is on
 * (ripple off). 2.1.283 dropped `tengu_willow_crate` / `P6e` from `/diff`.
 */
export function isDiffPanelEnabled(): boolean {
  return !getFeatureValue_CACHED_MAY_BE_STALE('tengu_jazzy_ripple', false)
}

/**
 * densable `G0t(e, n=!1)`:
 *   if remote or e!=="fullscreen" → "inline"
 *   else Bve()||n → "fullscreen" else "inline"
 */
export function resolveDiffPresentation(
  requested: CommandPresentation,
  dispatchedAsImmediate = false,
): CommandPresentation {
  if (getIsRemoteMode() || requested !== 'fullscreen') return 'inline'
  return isDiffPanelEnabled() || dispatchedAsImmediate ? 'fullscreen' : 'inline'
}
