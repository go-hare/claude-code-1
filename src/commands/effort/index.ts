import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

/**
 * densable cLy (interactive local-jsx) + yEs (non-interactive local).
 * densable gates noninteractive with pn(); interactive stays default when
 * interactive session (fork matches config/color dual pattern).
 */
export const effort: Command = {
  type: 'local-jsx',
  name: 'effort',
  description: 'Set effort level for model usage',
  argumentHint: '[low|medium|high|xhigh|max|auto]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  isEnabled: () => !getIsNonInteractiveSession(),
  load: () => import('./effort.js'),
}

export const effortNonInteractive: Command = {
  type: 'local',
  name: 'effort',
  supportsNonInteractive: true,
  description: 'Set effort level for model usage',
  argumentHint: '<low|medium|high|xhigh|max|auto>',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  load: () => import('./effort-noninteractive.js'),
}

export default effort
