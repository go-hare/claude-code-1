import type { Command } from '../../commands.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import {
  resolveDiffPresentation,
  type CommandPresentation,
} from '../../utils/willowCrate.js'

/**
 * densable 2.1.283 `D$e` (was `jDl`):
 *   description: G0t(Cl()?"fullscreen":"inline")==="fullscreen" ? toggle : view
 *   immediate: (args, presentation) => G0t(presentation)==="fullscreen"
 *   isEnabled: !Otn() — skip plugin-owned `/diff` (host N/A)
 * Official also has thinClientDispatch:"control-request" — no local host.
 */
const diff = {
  type: 'local-jsx',
  name: 'diff',
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
