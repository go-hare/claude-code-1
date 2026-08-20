import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js'
import { SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE } from './constants.js'
import type { AgentDefinition } from './loadAgentsDir.js'

export { SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE }

/**
 * densable QJe — NFKC + lower + collapse White_Space / Pd / `_`.
 */
export function normalizeAgentTypeKey(agentType: string): string {
  return agentType
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{White_Space}\p{Pd}_]+/gu, '')
}

/**
 * densable FTi — join available agent type names for error copy.
 */
export function formatAvailableAgentTypes(agentTypes: string[]): string {
  return agentTypes.join(', ') || 'none'
}

/**
 * densable Abf(activeAgents, allowedAgentTypes).
 *
 * Prefer an exact `general-purpose` agentType; else accept exactly one
 * QJe-normalized match. Both paths still respect the allowlist when set.
 */
export function isGeneralPurposeAvailable(
  agents: ReadonlyArray<Pick<AgentDefinition, 'agentType'>>,
  allowedAgentTypes?: readonly string[],
): boolean {
  const gpKey = normalizeAgentTypeKey(GENERAL_PURPOSE_AGENT.agentType)
  const matches = agents.filter(
    agent => normalizeAgentTypeKey(agent.agentType) === gpKey,
  )
  const isAllowed = (agent: Pick<AgentDefinition, 'agentType'>): boolean =>
    allowedAgentTypes?.includes(agent.agentType) ?? true

  const exact = matches.find(
    agent => agent.agentType === GENERAL_PURPOSE_AGENT.agentType,
  )
  if (exact) {
    return isAllowed(exact)
  }
  return matches.length === 1 && isAllowed(matches[0]!)
}
