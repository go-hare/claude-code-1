import type { Command } from '../../commands.js'
import { shouldFullscreenCommandBeImmediate } from '../../utils/immediateCommand.js'

const help = {
  type: 'local-jsx',
  name: 'help',
  description: 'Show help and available commands',
  // densable 2.1.234: get immediate(){return Ns()} — fullscreen feature gate
  get immediate() {
    return shouldFullscreenCommandBeImmediate()
  },
  load: () => import('./help.js'),
} satisfies Command

export default help
