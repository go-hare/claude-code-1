import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'

/**
 * densable vdy (interactive local-jsx) + shs (non-interactive local).
 * findCommand returns the first match; only one isEnabled at a time.
 */
export const config: Command = {
  aliases: ['settings'],
  type: 'local-jsx',
  name: 'config',
  description: 'Open settings',
  // densable vdy: argumentHint + getArgumentCompletions for key=value typeahead
  argumentHint: '[key=value]',
  isEnabled: () => !getIsNonInteractiveSession(),
  getArgumentCompletions: (argsSoFar, partial) =>
    import('./argumentCompletions.js').then(m =>
      m.getConfigArgumentCompletions(argsSoFar, partial),
    ),
  load: () => import('./config.js'),
}

export const configNonInteractive: Command = {
  type: 'local',
  name: 'config',
  aliases: ['settings'],
  supportsNonInteractive: true,
  description: 'Set a setting by key',
  argumentHint: 'key=value',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  getArgumentCompletions: (argsSoFar, partial) =>
    import('./argumentCompletions.js').then(m =>
      m.getConfigArgumentCompletions(argsSoFar, partial),
    ),
  load: () => import('./config-noninteractive.js'),
}

export default config
