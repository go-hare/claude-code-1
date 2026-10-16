import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import {
  shouldFullscreenInferenceCommandBeImmediate,
  shouldInferenceConfigCommandBeImmediate,
} from '../../utils/immediateCommand.js'
import { getConfigArgumentCompletions } from './configShorthand.js'

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
  getArgumentCompletions: (args, context) =>
    getConfigArgumentCompletions(args, context),
  load: () => import('./config.js'),
} satisfies Command

export const configNonInteractive: Command = {
  type: 'local',
  name: 'config',
  aliases: ['settings'],
  supportsNonInteractive: true,
  description: 'Set a setting by key',
  argumentHint: 'key=value',
  isEnabled: () => getIsNonInteractiveSession(),
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  load: () => import('./config-noninteractive.js'),
}

export default config
