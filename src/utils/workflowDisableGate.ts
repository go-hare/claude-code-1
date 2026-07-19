/**
 * Official CLAUDE_CODE_DISABLE_WORKFLOWS + feh/wIr workflows availability.
 *
 * feh():
 *   truthy CLAUDE_CODE_WORKFLOWS → {available,defaultOn} = GB tengu_workflows_enabled
 *   falsy CLAUDE_CODE_WORKFLOWS  → unavailable
 *   GB off                       → unavailable
 *   else                         → available, defaultOn = subscription !== "pro"
 *
 * wIr densable core (policy allow_workflows left denser / injectable):
 *   !DISABLE_WORKFLOWS && feh().available
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
 * Official wIr densable (without policy Xi("allow_workflows")).
 * DISABLE_WORKFLOWS / settings.disableWorkflows or feh unavailable → disabled.
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
  if (input?.policyAllow === false) return true
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
 * densable FE — workflows feature on for tool + ultracode keyword path.
 * Mirrors wiring.ts Workflow tool isEnabled (o5t/peh + enableWorkflows).
 */
export function isWorkflowsFeatureEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    const { resolveEnableWorkflowsSetting } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    const settings = getInitialSettings()
    if (
      isWorkflowsDisabled(env, {
        settingsDisableWorkflows: settings.disableWorkflows,
      })
    ) {
      return false
    }
    const enable = resolveEnableWorkflowsSetting(settings.enableWorkflows)
    if (enable === false) return false
    return true
  } catch {
    return !isWorkflowsDisabled(env)
  }
}

/**
 * densable VBn — settings.workflowKeywordTriggerEnabled (default true).
 */
export function isWorkflowKeywordTriggerEnabledFromSettings(): boolean {
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    return isWorkflowKeywordTriggerEnabled(
      getInitialSettings().workflowKeywordTriggerEnabled,
    )
  } catch {
    return isWorkflowKeywordTriggerEnabled()
  }
}
