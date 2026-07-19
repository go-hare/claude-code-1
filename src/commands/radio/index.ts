import type { Command } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

/**
 * densable BOy / tengu_velvet_static — Claude FM lo-fi radio slash command.
 * Gated by GrowthBook; disabled by default.
 */
const radio = {
  type: 'local',
  name: 'radio',
  description: 'Listen to Claude FM lo-fi radio',
  isEnabled: () =>
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_velvet_static', false),
  supportsNonInteractive: false,
  load: () => import('./radio.js'),
} satisfies Command

export default radio
