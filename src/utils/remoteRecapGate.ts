/**
 * Official CLAUDE_CODE_ENABLE_REMOTE_RECAP / tengu_harbor_moth portable gate.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export function isRemoteRecapEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  const raw = env.CLAUDE_CODE_ENABLE_REMOTE_RECAP
  if (raw !== undefined) {
    if (isEnvTruthy(raw)) return true
    if (isEnvDefinedFalsy(raw)) return false
  }
  if (input?.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_moth', false)
}
