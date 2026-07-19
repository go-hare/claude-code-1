import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getMainLoopModel, renderModelName } from '../../utils/model/model.js'

/**
 * densable sEs (interactive local-jsx) + iEs (non-interactive local).
 */
export const model: Command = {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return `Set the AI model for Claude Code (currently ${renderModelName(getMainLoopModel())})`
  },
  argumentHint: '[model]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  isEnabled: () => !getIsNonInteractiveSession(),
  load: () => import('./model.js'),
}

export const modelNonInteractive: Command = {
  type: 'local',
  name: 'model',
  supportsNonInteractive: true,
  description: 'Set the AI model for Claude Code',
  argumentHint: '<model>',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  load: () => import('./model-noninteractive.js'),
}

export default model
