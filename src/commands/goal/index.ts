import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from 'src/commands.js'

/**
 * densable h1y (interactive local-jsx) + g1y (non-interactive local).
 * Feature-gated via commands.ts GOAL flag.
 */
export const goal: Command = {
  type: 'local-jsx',
  name: 'goal',
  description:
    'Set or view a persistent goal that drives auto-continuation across turns',
  argumentHint: '[<objective> | status | clear | pause | resume | complete]',
  bridgeSafe: false,
  isEnabled: () => !getIsNonInteractiveSession(),
  load: () => import('./goal.js'),
}

export const goalNonInteractive: Command = {
  type: 'local',
  name: 'goal',
  supportsNonInteractive: true,
  description: 'Set a goal — keep working until the condition is met',
  argumentHint: '[<objective> | status | clear | pause | resume | complete]',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  load: () => import('./goal-noninteractive.js'),
}

export default goal
