import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { colorArgumentHint } from './applyColor.js'

/**
 * densable Uuy (interactive local-jsx) + $ms (non-interactive local).
 * Only one isEnabled at a time so findCommand stays unambiguous.
 */
export const color: Command = {
  type: 'local-jsx',
  name: 'color',
  description: 'Set the prompt bar color for this session',
  immediate: true,
  argumentHint: colorArgumentHint(),
  isEnabled: () => !getIsNonInteractiveSession(),
  load: () => import('./color.js'),
}

export const colorNonInteractive: Command = {
  type: 'local',
  name: 'color',
  supportsNonInteractive: true,
  description: 'Set the prompt bar color for this session',
  argumentHint: colorArgumentHint(),
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  load: () => import('./color-noninteractive.js'),
}

export default color
