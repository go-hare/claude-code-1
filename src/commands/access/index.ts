import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

export const ACCESS_COMMAND_FLAG = 'tengu_gentle_sky'

/**
 * Official 2.1.331 `Auo` — `/access` slash command to view verification
 * programs for the current claude.ai account.
 */
const access = {
  type: 'local-jsx',
  name: 'access',
  description: 'View the verification programs your account is in',
  availability: ['claude-ai'],
  immediate: true,
  isEnabled: () =>
    getFeatureValue_CACHED_MAY_BE_STALE(ACCESS_COMMAND_FLAG, false) === true &&
    !getIsRemoteMode(),
  load: () => import('./access.js'),
} satisfies Command

export default access
