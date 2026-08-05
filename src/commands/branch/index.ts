import type { Command } from '../../commands.js'

const branch = {
  type: 'local-jsx',
  name: 'branch',
  // densable 2.1.212: /fork is its own command (bg session copy) — no alias
  aliases: [] as string[],
  description: 'Create a branch of the current conversation at this point',
  argumentHint: '[name]',
  load: () => import('./branch.js'),
} satisfies Command

export default branch
