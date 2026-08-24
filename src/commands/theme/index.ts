import type { Command } from '../../commands.js'
import { shouldFullscreenCommandBeImmediate } from '../../utils/immediateCommand.js'

const theme = {
  type: 'local-jsx',
  name: 'theme',
  description: 'Change the theme',
  // densable 2.1.234: get immediate(){return Ns()} — fullscreen feature gate
  get immediate() {
    return shouldFullscreenCommandBeImmediate()
  },
  load: () => import('./theme.js'),
} satisfies Command

export default theme
