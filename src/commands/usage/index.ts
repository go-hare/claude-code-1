import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'

/**
 * densable TSs (interactive local-jsx) + SSs (non-interactive local).
 */
export const usage: Command = {
  type: 'local-jsx',
  name: 'usage',
  aliases: ['cost', 'stats'],
  description: 'Show session cost, plan usage, and activity stats',
  isEnabled: () => !getIsNonInteractiveSession(),
  load: () => import('./usage.js'),
}

export const usageNonInteractive: Command = {
  type: 'local',
  name: 'usage',
  aliases: ['cost', 'stats'],
  supportsNonInteractive: true,
  description:
    "Show session cost, plan usage, and what's contributing to your limits",
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  load: () => import('./usage-noninteractive.js'),
}

export default usage
