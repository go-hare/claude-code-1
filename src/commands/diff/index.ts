import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { isWillowCrateEnabled } from '../../utils/willowCrate.js'

/**
 * densable `jDl`:
 *   description getter toggles on `P6e()`
 *   immediate: if wa() false; if P6e() then Vs(); else false
 * Official also has thinClientDispatch:"control-request" — no local host.
 */
const diff = {
  type: 'local-jsx',
  name: 'diff',
  get description() {
    return isWillowCrateEnabled()
      ? 'Toggle the diff panel showing uncommitted changes'
      : 'View uncommitted changes and per-turn diffs'
  },
  immediate: () => {
    if (getIsRemoteMode()) return false
    if (isWillowCrateEnabled()) return isFullscreenEnvEnabled()
    return false
  },
  load: () => import('./diff.js'),
} satisfies Command

export default diff
