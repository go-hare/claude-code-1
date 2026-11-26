import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { isBgSession } from '../../utils/concurrentSessions.js'
import { getActiveAttachHandle } from './stopCore.js'

const STOP_DESCRIPTION =
  'Stop this background session; transcript and worktree are kept'

/**
 * Official 2.1.331 `chunk-nvx99n0s.js` (`UYs`) — interactive `/stop` command.
 * Enabled only inside a background session (`qt()`) or an attached bg session (`Fdn() !== null`).
 */
const stop = {
  type: 'local-jsx',
  name: 'stop',
  description: STOP_DESCRIPTION,
  immediate: true,
  isEnabled: () => isBgSession() || getActiveAttachHandle() !== null,
  load: () => import('./stop.js'),
} satisfies Command

/**
 * Official 2.1.331 `chunk-nvx99n0s.js` (`Xuo` / `stopNonInteractive`) —
 * headless / bridge twin for `/stop`.
 */
export const stopNonInteractive = {
  type: 'local',
  name: 'stop',
  supportsNonInteractive: true,
  description: STOP_DESCRIPTION,
  isEnabled: () => isBgSession(),
  get isHidden(): boolean {
    return !getIsNonInteractiveSession()
  },
  load: () => import('./stop-noninteractive.js'),
} satisfies Command

export default stop
