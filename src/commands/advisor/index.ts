import type { Command } from '../../commands.js'
import {
  canUserConfigureAdvisor,
  getAdvisorCommandAliases,
} from '../../utils/advisor.js'
import {
  shouldFullscreenInferenceCommandBeImmediate,
  shouldInferenceConfigCommandBeImmediate,
} from '../../utils/immediateCommand.js'

const advisor = {
  type: 'local-jsx',
  name: 'advisor',
  // densable: "Let Claude consult a stronger model at key moments"
  description: 'Let Claude consult a stronger model at key moments',
  get argumentHint() {
    return `[${[...getAdvisorCommandAliases(), 'off'].join('|')}]`
  },
  // densable 2.1.234: immediate:(e)=>e.trim()!==""?X3e():RVr()
  immediate: (args: string) =>
    args.trim() !== ''
      ? shouldInferenceConfigCommandBeImmediate()
      : shouldFullscreenInferenceCommandBeImmediate(),
  isEnabled: () => canUserConfigureAdvisor(),
  get isHidden() {
    return !canUserConfigureAdvisor()
  },
  load: () => import('./advisor.js'),
} satisfies Command

export default advisor
