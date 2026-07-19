import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'

/**
 * densable RDy (interactive local-jsx) + aSs (non-interactive local).
 */
export const rename: Command = {
  type: 'local-jsx',
  name: 'rename',
  aliases: ['name'],
  description: 'Rename the current conversation',
  immediate: true,
  argumentHint: '[name]',
  isEnabled: () => !getIsNonInteractiveSession(),
  load: () => import('./rename.js'),
}

export const renameNonInteractive: Command = {
  type: 'local',
  name: 'rename',
  aliases: ['name'],
  supportsNonInteractive: true,
  description: 'Rename the current conversation',
  argumentHint: '[name]',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  load: () => import('./rename-noninteractive.js'),
}

export default rename
