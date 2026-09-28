import type { Command } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'

function mapleSundial(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_maple_sundial', false)
}

const outputStyle = {
  type: 'local',
  name: 'output-style',
  supportsNonInteractive: true,
  description: 'List output styles or switch to one',
  argumentHint: '[style]',
  isEnabled: () => getIsNonInteractiveSession() || !mapleSundial(),
  get isHidden() {
    return !getIsNonInteractiveSession() && mapleSundial()
  },
  load: () => import('./output-style.js'),
} satisfies Command

/** densable vjt maple_sundial alias — hidden "moved to /config". */
export const outputStyleMapleAlias = {
  type: 'local-jsx',
  name: 'output-style',
  description: 'Output style moved to /config',
  isHidden: true,
  isEnabled: () => mapleSundial(),
  load: () => import('./output-style-alias.js'),
} satisfies Command

export default outputStyle
