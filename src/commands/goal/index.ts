/**
 * densable 2.1.289 `/goal` — local-jsx Dialog (default) + local headless twin.
 *
 * Gold:
 *   e = {type:"local-jsx", name:"goal", description:"Set a goal Claude checks
 *        before stopping", argumentHint:"[<condition> | clear]", immediate:!0}
 *   o = {type:"local", name:"goal", supportsNonInteractive:!0,
 *        description:"Set a goal — keep working until the condition is met",
 *        get isHidden(){return!Ce()}, isEnabled:()=>Ce()||jn()}
 *   Ce = getIsNonInteractiveSession, jn = getIsRemoteMode
 *
 * thinClientDispatch:"post-text" is leftover-stop (no local host).
 */
import {
  getIsNonInteractiveSession,
  getIsRemoteMode,
} from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'

const goal = {
  type: 'local-jsx',
  name: 'goal',
  description: 'Set a goal Claude checks before stopping',
  argumentHint: '[<condition> | clear]',
  immediate: true,
  load: () => import('./goal.js'),
} satisfies Command

export const goalNonInteractive = {
  type: 'local',
  name: 'goal',
  supportsNonInteractive: true,
  description: 'Set a goal — keep working until the condition is met',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled: () => getIsNonInteractiveSession() || getIsRemoteMode(),
  load: () => import('../goal.js'),
} satisfies Command

export default goal
