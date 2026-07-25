/**
 * Official CLAUDE_CODE_DISABLE_WORKFLOWS + feh/wIr workflows availability.
 *
 * feh():
 *   truthy CLAUDE_CODE_WORKFLOWS → {available,defaultOn} = GB tengu_workflows_enabled
 *   falsy CLAUDE_CODE_WORKFLOWS  → unavailable
 *   GB off                       → unavailable
 *   else                         → available, defaultOn = subscription !== "pro"
 *
 * wIr densable core:
 *   zBn Wi("allow_workflows") && !DISABLE_WORKFLOWS && feh().available
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export type WorkflowsAvailability = {
  available: boolean
  defaultOn: boolean
}

/**
 * Official feh — pure/injectable GB + subscription for tests.
 */
export function resolveWorkflowsAvailability(input?: {
  env?: NodeJS.ProcessEnv
  gbEnabled?: boolean
  subscriptionType?: string | null
}): WorkflowsAvailability {
  const env = input?.env ?? process.env
  const gb =
    input?.gbEnabled ??
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_workflows_enabled', true)

  if (isEnvTruthy(env.CLAUDE_CODE_WORKFLOWS)) {
    return { available: gb, defaultOn: gb }
  }
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_WORKFLOWS)) {
    return { available: false, defaultOn: false }
  }
  if (!gb) {
    return { available: false, defaultOn: false }
  }
  const sub =
    input && 'subscriptionType' in input ? input.subscriptionType : undefined
  // Official defaultOn: Us() !== "pro". When subscription not injected, default on.
  return { available: true, defaultOn: sub !== 'pro' }
}

/**
 * Official o5t densable — DISABLE_WORKFLOWS env OR settings.disableWorkflows.
 */
export function isWorkflowsSettingsDisabled(input?: {
  env?: NodeJS.ProcessEnv
  settingsDisableWorkflows?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_DISABLE_WORKFLOWS)) return true
  return input?.settingsDisableWorkflows === true
}

/**
 * Official A1n densable — settings.workflowKeywordTriggerEnabled, default true.
 */
export function isWorkflowKeywordTriggerEnabled(
  settingsWorkflowKeywordTriggerEnabled?: boolean,
): boolean {
  return settingsWorkflowKeywordTriggerEnabled ?? true
}

/**
 * densable zBn — Wi("allow_workflows") via policy limits (fail open).
 * Injectable via input.policyAllow for tests.
 */
function resolveWorkflowsPolicyAllow(
  policyAllow: boolean | null | undefined,
): boolean {
  if (policyAllow === false) return false
  if (policyAllow === true) return true
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isPolicyAllowed } =
      require('../services/policyLimits/index.js') as typeof import('../services/policyLimits/index.js')
    return isPolicyAllowed('allow_workflows')
  } catch {
    // densable fail-open when policy service unavailable
    return true
  }
}

/**
 * Official wIr densable: policy allow_workflows (zBn) + DISABLE_WORKFLOWS /
 * settings.disableWorkflows + feh available.
 */
export function isWorkflowsDisabled(
  env: NodeJS.ProcessEnv = process.env,
  input?: {
    gbEnabled?: boolean
    subscriptionType?: string | null
    policyAllow?: boolean | null
    settingsDisableWorkflows?: boolean
  },
): boolean {
  // densable zBn / Wi("allow_workflows") — false → disabled
  if (!resolveWorkflowsPolicyAllow(input?.policyAllow)) {
    return true
  }
  if (
    isWorkflowsSettingsDisabled({
      env,
      settingsDisableWorkflows: input?.settingsDisableWorkflows,
    })
  ) {
    return true
  }
  const { available } = resolveWorkflowsAvailability({
    env,
    gbEnabled: input?.gbEnabled,
    subscriptionType: input?.subscriptionType,
  })
  return !available
}

/**
 * Inverse of isWorkflowsDisabled — workflows feature available for tool/UI.
 */
export function isWorkflowsAvailable(
  env: NodeJS.ProcessEnv = process.env,
  input?: {
    gbEnabled?: boolean
    subscriptionType?: string | null
    policyAllow?: boolean | null
  },
): boolean {
  return !isWorkflowsDisabled(env, input)
}

/**
 * densable FE-shaped: workflows available AND settings.enableWorkflows
 * (or product defaultOn when unset). Used to gate keyword/ultra workflow
 * attachment injection, matching densable's FE()?[workflow_keyword…] branch.
 */
export function isWorkflowFeatureEnabled(
  env: NodeJS.ProcessEnv = process.env,
  input?: {
    gbEnabled?: boolean
    subscriptionType?: string | null
    policyAllow?: boolean | null
    settingsDisableWorkflows?: boolean
    enableWorkflows?: boolean
  },
): boolean {
  if (
    isWorkflowsDisabled(env, {
      gbEnabled: input?.gbEnabled,
      subscriptionType: input?.subscriptionType,
      policyAllow: input?.policyAllow,
      settingsDisableWorkflows: input?.settingsDisableWorkflows,
    })
  ) {
    return false
  }
  const { defaultOn } = resolveWorkflowsAvailability({
    env,
    gbEnabled: input?.gbEnabled,
    subscriptionType: input?.subscriptionType,
  })
  // densable FE: GO()?.settings.enableWorkflows ?? defaultOn
  return input?.enableWorkflows ?? defaultOn
}
