import { feature } from 'bun:bundle'
import { isEnvDefinedFalsy, isEnvTruthy } from '../utils/envUtils.js'

export const BUDDY_ENABLE_ENV_VAR = 'CLAUDE_CODE_ENABLE_BUDDY'

export function isBuddyEnabled(): boolean {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_ENABLE_BUDDY)) {
    return false
  }

  if (feature('BUDDY')) return true

  if (process.env.USER_TYPE !== 'ant') {
    return true
  }

  return isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_BUDDY)
}
