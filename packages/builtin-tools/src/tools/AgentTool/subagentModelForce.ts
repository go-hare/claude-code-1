import { isEnvTruthy } from 'src/utils/envUtils.js'
import { getDefaultSubagentModel } from 'src/utils/model/agent.js'

/**
 * densable qS — CLAUDE_CODE_SUBAGENT_MODEL_FORCE (bool env).
 */
export function isSubagentModelForceEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE)
}

/**
 * densable Rs — when FORCE is set, drop frontmatter unless the env default is
 * inherit, and drop the per-call model unless it is inherit.
 */
export function applySubagentModelForce(
  agentModel: string | undefined,
  toolModel: string | undefined,
): [string | undefined, string | undefined] {
  if (!isSubagentModelForceEnabled()) {
    return [agentModel, toolModel]
  }
  return [
    getDefaultSubagentModel() === 'inherit' ? agentModel : undefined,
    toolModel === 'inherit' ? 'inherit' : undefined,
  ]
}

/** Spawn teammate model after Rs: tool override, else frontmatter. */
export function resolveForcedSpawnModel(
  agentModel: string | undefined,
  toolModel: string | undefined,
): string | undefined {
  const [frontmatter, tool] = applySubagentModelForce(agentModel, toolModel)
  return tool ?? frontmatter
}
