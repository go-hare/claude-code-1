import type { Command } from '../../commands.js'
import { isDesignLoginAvailable } from '../../cli/handlers/designOauth.js'

/** densable `p8t` — hidden local `/design-consent`. */
const designConsent = {
  type: 'local',
  name: 'design-consent',
  description: 'Grant Claude agent access to your Design projects',
  isEnabled: () => isDesignLoginAvailable(),
  isHidden: true,
  supportsNonInteractive: true,
  load: () => import('./call.js'),
} satisfies Command

export default designConsent
