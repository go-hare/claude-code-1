/**
 * Official CLAUDE_CODE_SAFE_MODE / --safe-mode portable gate.
 */

import { isEnvTruthy } from './envUtils.js'

export function isSafeModeEnabled(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  if (isEnvTruthy(env.CLAUDE_CODE_SAFE_MODE)) return true
  return argv.includes('--safe-mode')
}

/** Official Vv — how to turn safe mode off (copy). */
export function safeModeDisableHint(
  argv: readonly string[] = process.argv,
): string {
  return argv.includes('--safe-mode')
    ? 'restart without --safe-mode'
    : 'unset CLAUDE_CODE_SAFE_MODE'
}
