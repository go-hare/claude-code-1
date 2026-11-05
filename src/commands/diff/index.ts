import type { Command } from '../../commands.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { isDiffSidebarOwnedByPlugin } from '../../utils/replDiffTab.js'
import {
  resolveDiffPresentation,
  type CommandPresentation,
} from '../../utils/willowCrate.js'

/**
 * densable 2.1.289 `Yje` (was `D$e` / `jDl`):
 *   isEnabled: () => !Wpn()
 *   description: k1t(vc()?"fullscreen":"inline")==="fullscreen" ? toggle : view
 *   immediate: (args, presentation) => k1t(presentation)==="fullscreen"
 * Official also has thinClientDispatch:"control-request" — no local host.
 */
const diff = {
  type: 'local-jsx',
  name: 'diff',
  isEnabled: () => !isDiffSidebarOwnedByPlugin(),
  get description() {
    return resolveDiffPresentation(
      isFullscreenEnvEnabled() ? 'fullscreen' : 'inline',
    ) === 'fullscreen'
      ? 'Toggle the diff panel showing uncommitted changes'
      : 'View uncommitted changes and per-turn diffs'
  },
  immediate: (_args: string, presentation?: CommandPresentation) =>
    resolveDiffPresentation(presentation ?? 'inline') === 'fullscreen',
  load: () => import('./diff.js'),
} satisfies Command

export default diff
