/**
 * densable 2.1.218 #28 — /cd Move this session to a new working directory.
 */
import type { Command } from '../../types/command.js'

const cd = {
  type: 'local-jsx',
  name: 'cd',
  description: 'Move this session to a new working directory',
  argumentHint: '<path>',
  load: () => import('./cdCommand.js'),
} satisfies Command

export default cd
