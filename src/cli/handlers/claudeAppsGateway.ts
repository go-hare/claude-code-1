/**
 * Official 2.1.328 (#547): Claude apps gateway startup validation helpers.
 *
 * Validates managed policy `maxEffortLevel` (top-level and per-model under
 * `modelSettings.<model>.maxEffortLevel`) so administrators receive an explicit
 * startup warning when a policy specifies an unrecognized effort level that
 * Claude Code clients would ignore.
 */

export const VALID_GATEWAY_MAX_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type GatewayMaxEffortLevel =
  (typeof VALID_GATEWAY_MAX_EFFORT_LEVELS)[number]

export type GatewayManagedPolicyEntry = {
  payload?: {
    settings?: Record<string, unknown>
  }
}

export type ClaudeAppsGatewayStartupConfig = {
  managedPolicies?: GatewayManagedPolicyEntry[]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Official 2.1.328 (#547): Check every managed policy's `maxEffortLevel` and
 * `modelSettings.<model>.maxEffortLevel` against `VALID_GATEWAY_MAX_EFFORT_LEVELS`
 * and return exact startup warnings for any invalid values.
 */
export function validateGatewayManagedPolicyEffortLevels(
  managedPolicies: GatewayManagedPolicyEntry[] | undefined,
): string[] {
  const warnings: string[] = []
  if (!Array.isArray(managedPolicies)) return warnings

  const allowedDisplay = VALID_GATEWAY_MAX_EFFORT_LEVELS.join(', ')

  for (const [policyIndex, policy] of managedPolicies.entries()) {
    const settings = policy?.payload?.settings
    if (!isPlainRecord(settings)) continue

    const checks: Record<string, unknown> = {
      maxEffortLevel: settings.maxEffortLevel,
    }
    if (isPlainRecord(settings.modelSettings)) {
      for (const [modelKey, modelEntry] of Object.entries(
        settings.modelSettings,
      )) {
        if (isPlainRecord(modelEntry)) {
          checks[`modelSettings.${modelKey}.maxEffortLevel`] =
            modelEntry.maxEffortLevel
        }
      }
    }

    for (const [fieldPath, value] of Object.entries(checks)) {
      if (
        value !== undefined &&
        !(VALID_GATEWAY_MAX_EFFORT_LEVELS as readonly unknown[]).includes(value)
      ) {
        warnings.push(
          `managed policy ${policyIndex} ${fieldPath} is not one of ${allowedDisplay}, so Claude Code ignores it. Fix the value, or upgrade the gateway if the level was added in a newer Claude Code.`,
        )
      }
    }
  }

  return warnings
}

/**
 * Validate a Claude apps gateway startup configuration and return all startup
 * warnings.
 */
export function validateClaudeAppsGatewayStartupConfig(
  config: ClaudeAppsGatewayStartupConfig,
): { warnings: string[] } {
  return {
    warnings: validateGatewayManagedPolicyEffortLevels(config.managedPolicies),
  }
}

/**
 * Emit all Claude apps gateway startup warnings to `warn` (default: `console.warn`).
 */
export function emitClaudeAppsGatewayStartupWarnings(
  config: ClaudeAppsGatewayStartupConfig,
  warn: (message: string) => void = msg => console.warn(msg),
): string[] {
  const { warnings } = validateClaudeAppsGatewayStartupConfig(config)
  for (const warning of warnings) {
    warn(warning)
  }
  return warnings
}
