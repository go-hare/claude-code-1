import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvTruthy } from './envUtils.js'

/**
 * densable `xd` / isAgentSwarmsEnabled.
 *
 * Official is opt-in: env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` or
 * `--agent-teams`, then GrowthBook `tengu_amber_flint` (default ON kill switch).
 * Do not default-on — that stamps `teamName` on leader transcripts and
 * `/resume` drops them (official `if (u.teamName) return null`).
 */
function hasAgentTeamsCliFlag(): boolean {
  return process.argv.includes('--agent-teams')
}

export function isAgentSwarmsEnabled(): boolean {
  if (
    !isEnvTruthy(process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) &&
    !hasAgentTeamsCliFlag()
  ) {
    return false
  }
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_flint', true)) {
    return false
  }
  return true
}
