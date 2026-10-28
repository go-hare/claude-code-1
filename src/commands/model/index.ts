import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import {
  getMainLoopModel,
  getUserSpecifiedModelSetting,
  renderModelName,
} from '../../utils/model/model.js'

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    const current = getUserSpecifiedModelSetting() ?? getMainLoopModel()
    return `Set the AI model for Claude Code (currently ${renderModelName(current)})`
  },
  argumentHint: '[model]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./model.js'),
} satisfies Command
