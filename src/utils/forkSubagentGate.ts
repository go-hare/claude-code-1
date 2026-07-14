/**
 * Official CLAUDE_CODE_FORK_SUBAGENT / GB portable resolver.
 * Returns reason string matching official shape.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export type ForkSubagentSource =
  | 'env'
  | 'disabled'
  | 'gb_rollout'
  | 'disabled_ant'

/**
 * @param isAnt when true (USER_TYPE=ant paths), official disables fork.
 */
export function resolveForkSubagentSource(input?: {
  env?: NodeJS.ProcessEnv
  isAnt?: boolean
  gbValue?: boolean
}): ForkSubagentSource {
  const env = input?.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_FORK_SUBAGENT)) return 'env'
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_FORK_SUBAGENT)) return 'disabled'
  if (input?.isAnt) return 'disabled'
  const gb =
    input?.gbValue ??
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_fork_subagent', false)
  if (gb) return 'gb_rollout'
  return 'disabled'
}

export function isForkSubagentEnabled(input?: {
  env?: NodeJS.ProcessEnv
  isAnt?: boolean
  gbValue?: boolean
}): boolean {
  const src = resolveForkSubagentSource(input)
  return src === 'env' || src === 'gb_rollout'
}
