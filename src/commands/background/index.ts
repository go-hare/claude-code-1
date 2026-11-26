import type { Command } from '../../commands.js'

/**
 * Official 2.1.331 `chunk-3bvcsr0n.js` (`BYs`) — `/background` slash command.
 * Registered under `fleetBackground` when Agent View is enabled.
 */
const background = {
  type: 'local-jsx',
  name: 'background',
  aliases: ['bg'],
  description: 'Send this session to the background and free the terminal',
  argumentHint: '[prompt]',
  immediate: (args: string) => !args.trim(),
  isEnabled: () => true,
  load: () => import('./background.js'),
} satisfies Command

export default background
