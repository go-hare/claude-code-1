import type { Command } from '../../commands.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export default {
  type: 'local-jsx',
  name: 'logout',
  description: 'Sign out from your Anthropic account',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGOUT_COMMAND),
  // Official 2.1.323 fAn (#2206): support /logout in background / fleet host sessions.
  fleetHostCall: async host => {
    const { fleetHostLogout } = await import('./logout.js')
    return fleetHostLogout(host)
  },
  load: () => import('./logout.js'),
} satisfies Command
