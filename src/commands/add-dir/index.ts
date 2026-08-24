import type { Command } from '../../commands.js'
import { shouldFullscreenCommandBeImmediate } from '../../utils/immediateCommand.js'

const addDir = {
  type: 'local-jsx',
  name: 'add-dir',
  description: 'Add a new working directory',
  argumentHint: '<path>',
  // densable 2.1.234: immediate:(e)=>e.trim()!==""||Ns()
  // path arg always mid-turn; empty-arg dialog only under fullscreen feature gate
  immediate: (args: string) =>
    args.trim() !== '' || shouldFullscreenCommandBeImmediate(),
  load: () => import('./add-dir.js'),
} satisfies Command

export default addDir
