import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeEnabled,
} from '../../utils/fastMode.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

/**
 * densable zPy (interactive local-jsx) + wSs (non-interactive local).
 */
export const fast: Command = {
  type: 'local-jsx',
  name: 'fast',
  get description() {
    return `Toggle fast mode (${FAST_MODE_MODEL_DISPLAY} only)`
  },
  availability: ['claude-ai', 'console'],
  isEnabled: () => isFastModeEnabled() && !getIsNonInteractiveSession(),
  get isHidden() {
    return !isFastModeEnabled()
  },
  argumentHint: '[on|off]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./fast.js'),
}

export const fastNonInteractive: Command = {
  type: 'local',
  name: 'fast',
  supportsNonInteractive: true,
  get description() {
    return `Toggle fast mode (${FAST_MODE_MODEL_DISPLAY} only)`
  },
  argumentHint: '[on|off]',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return isFastModeEnabled() && getIsNonInteractiveSession()
  },
  load: () => import('./fast-noninteractive.js'),
}

export default fast
