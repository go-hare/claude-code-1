import type { Command } from '../../commands.js'
import {
  shouldFullscreenInferenceCommandBeImmediate,
  shouldInferenceConfigCommandBeImmediate,
} from '../../utils/immediateCommand.js'

const config = {
  aliases: ['settings'],
  type: 'local-jsx',
  name: 'config',
  // densable: "Open settings"
  description: 'Open settings',
  argumentHint: '[key=value]',
  // densable 2.1.234: immediate:(e)=>e.trim()!==""?X3e():RVr()
  immediate: (args: string) =>
    args.trim() !== ''
      ? shouldInferenceConfigCommandBeImmediate()
      : shouldFullscreenInferenceCommandBeImmediate(),
  load: () => import('./config.js'),
} satisfies Command

export default config
