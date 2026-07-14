/**
 * Official CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE portable gate.
 * Truthy = enable package-manager auto-update UI path.
 * Falsy/unset = follow existing isAutoUpdaterDisabled / settings behavior
 * (helper only exposes the env force-on signal for consumers).
 */

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

/**
 * Returns:
 * - true when env force-enables
 * - false when env force-disables
 * - undefined when unset (caller uses existing defaults)
 */
export function resolvePackageManagerAutoUpdateFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  if (isEnvTruthy(env.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE)) return true
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE)) {
    return false
  }
  return undefined
}
