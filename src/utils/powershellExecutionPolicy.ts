/**
 * Official CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY.
 * Default: inject -ExecutionPolicy Bypass so tool runs are not blocked by
 * Restricted policy. When env is truthy, omit Bypass and honor the host policy.
 */

import { isEnvTruthy } from './envUtils.js'

export function shouldRespectPowerShellExecutionPolicy(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY)
}

/**
 * Build pwsh flag prefix for -NoProfile/-NonInteractive/optional Bypass.
 * Caller appends -Command / -EncodedCommand + payload.
 */
export function buildPowerShellInvocationFlags(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const flags = ['-NoProfile', '-NonInteractive']
  if (!shouldRespectPowerShellExecutionPolicy(env)) {
    flags.push('-ExecutionPolicy', 'Bypass')
  }
  return flags
}
