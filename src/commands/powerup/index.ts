import type { Command } from '../../commands.js'

/**
 * Official 2.1.331 `oIt` — `/powerup` interactive short lessons command.
 */
const powerup = {
  type: 'local-jsx',
  name: 'powerup',
  description: 'Learn Claude Code features in short lessons',
  requires: { ink: true },
  load: () => import('./powerup.js'),
} satisfies Command

export default powerup
