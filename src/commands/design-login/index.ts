import type { Command } from '../../commands.js'
import { isDesignLoginAvailable } from '../../cli/handlers/designOauth.js'

/** densable `g8t` — `/design-login` local-jsx (VS Code host is separate). */
const designLogin = {
  type: 'local-jsx',
  name: 'design-login',
  description:
    'Authorize design-system access for /design-sync with your claude.ai account',
  isEnabled: () => isDesignLoginAvailable(),
  load: () => import('./designLogin.js'),
} satisfies Command

export default designLogin
