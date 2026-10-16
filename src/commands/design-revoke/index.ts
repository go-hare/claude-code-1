import type { Command } from '../../commands.js'
import { isDesignLoginAvailable } from '../../cli/handlers/designOauth.js'

/** densable `m8t` — hidden local `/design-revoke`. */
const designRevoke = {
  type: 'local',
  name: 'design-revoke',
  description: 'Revoke Claude agent access to your Design projects',
  isEnabled: () => isDesignLoginAvailable(),
  isHidden: true,
  supportsNonInteractive: true,
  load: () =>
    import('../design-consent/call.js').then(m => ({
      call: (_args, context) => m.callDesignConsent('revoke', context),
    })),
} satisfies Command

export default designRevoke
