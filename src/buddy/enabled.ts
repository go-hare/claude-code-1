import { feature } from 'bun:bundle'
import { isEnvTruthy } from '../utils/envUtils.js'

export const BUDDY_ENABLE_ENV_VAR = 'CLAUDE_CODE_ENABLE_BUDDY'

export function isBuddyEnabled(): boolean {
  // Official ENABLE_BUDDY densable pure env half.
  let envOverride: boolean | null = null
  try {
    const { resolveBuddyEnvOverride } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    envOverride = resolveBuddyEnvOverride()
  } catch {
    const raw = process.env.CLAUDE_CODE_ENABLE_BUDDY
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
      envOverride = false
    } else if (isEnvTruthy(raw)) {
      envOverride = true
    }
  }
  if (envOverride === false) return false

  if (feature('BUDDY')) return true

  if (process.env.USER_TYPE !== 'ant') {
    return true
  }

  return envOverride === true
}
