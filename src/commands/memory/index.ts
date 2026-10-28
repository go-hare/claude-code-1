import type { Command } from '../../commands.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'Edit CLAUDE.md files and memory settings',
  load: () => import('./memory.js'),
}

export default memory
