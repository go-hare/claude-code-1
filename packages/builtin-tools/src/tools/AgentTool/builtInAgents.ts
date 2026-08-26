import { feature } from 'bun:bundle'
import { getIsNonInteractiveSession } from 'src/bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { CLAUDE_CODE_GUIDE_AGENT } from './built-in/claudeCodeGuideAgent.js'
import { EXPLORE_AGENT } from './built-in/exploreAgent.js'
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js'
import { PLAN_AGENT } from './built-in/planAgent.js'
import { STATUSLINE_SETUP_AGENT } from './built-in/statuslineSetup.js'
import { VERIFICATION_AGENT } from './built-in/verificationAgent.js'
import {
  isWebFetchAgentEnabled,
  WEB_FETCH_AGENT,
} from './built-in/webFetchAgent.js'
import type { AgentDefinition } from './loadAgentsDir.js'

export function areExplorePlanAgentsEnabled(): boolean {
  // Official DISABLE_EXPLORE_PLAN_AGENTS densable force-off.
  try {
    const { isExplorePlanAgentsDisabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/utils/residualFinalEnvGates.js') as typeof import('src/utils/residualFinalEnvGates.js')
    if (isExplorePlanAgentsDisabled()) return false
  } catch {
    if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS)) {
      return false
    }
  }
  if (feature('BUILTIN_EXPLORE_PLAN_AGENTS')) {
    return true
  }
  return false
}

export function getBuiltInAgents(): AgentDefinition[] {
  // Allow disabling all built-in agents via env var (useful for SDK users who want a blank slate)
  // Only applies in noninteractive mode (SDK/API usage)
  if (
    isEnvTruthy(process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS) &&
    getIsNonInteractiveSession()
  ) {
    return []
  }

  // Use lazy require inside the function body to avoid circular dependency
  // issues at module init time. The coordinatorMode module depends on tools
  // which depend on AgentTool which imports this file.
  if (feature('COORDINATOR_MODE')) {
    // Official COORDINATOR_MODE densable.
    let coordinatorMode = isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)
    try {
      const { isCoordinatorModeEnvEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/residualFinalEnvGates.js') as typeof import('src/utils/residualFinalEnvGates.js')
      coordinatorMode = isCoordinatorModeEnvEnabled()
    } catch {
      // keep raw env fallback
    }
    if (coordinatorMode) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { getCoordinatorAgents } =
        require('src/coordinator/workerAgent.js') as typeof import('src/coordinator/workerAgent.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      return getCoordinatorAgents()
    }
  }

  const agents: AgentDefinition[] = [
    GENERAL_PURPOSE_AGENT,
    STATUSLINE_SETUP_AGENT,
  ]

  if (areExplorePlanAgentsEnabled()) {
    agents.push(EXPLORE_AGENT, PLAN_AGENT)
  }

  // Official yvt: aAi() → push bpr before the non-SDK guide agent.
  if (isWebFetchAgentEnabled()) {
    agents.push(WEB_FETCH_AGENT)
  }

  // Include Code Guide agent for non-SDK entrypoints.
  // Note (2.1.207): CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL gates the
  // claude-code-docs *skill* (registerClaudeCodeSkill), not this agent.
  const isNonSdkEntrypoint =
    process.env.CLAUDE_CODE_ENTRYPOINT !== 'sdk-ts' &&
    process.env.CLAUDE_CODE_ENTRYPOINT !== 'sdk-py' &&
    process.env.CLAUDE_CODE_ENTRYPOINT !== 'sdk-cli'

  if (isNonSdkEntrypoint) {
    agents.push(CLAUDE_CODE_GUIDE_AGENT)
  }

  if (
    feature('VERIFICATION_AGENT') &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_hive_evidence', false)
  ) {
    agents.push(VERIFICATION_AGENT)
  }

  return agents
}
