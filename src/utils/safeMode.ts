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

function hasFlagBeforeDoubleDash(
  flag: string,
  argv: readonly string[],
): boolean {
  const idx = argv.indexOf(flag)
  if (idx === -1) return false
  const doubleDash = argv.indexOf('--')
  return doubleDash === -1 || idx < doubleDash
}

function formatModeDisableAction(
  flag: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.CLAUDE_CODE_SESSION_KIND === 'bg'
    ? 'run /stop, then claude --resume from your shell'
    : `restart without ${flag}`
}

/** Official zS — how to turn safe mode off (copy). */
export function safeModeDisableHint(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return hasFlagBeforeDoubleDash('--safe-mode', argv)
    ? formatModeDisableAction('--safe-mode', env)
    : 'unset CLAUDE_CODE_SAFE_MODE'
}

/** Official wOt — how to turn bare mode off (copy). */
export function bareModeDisableHint(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return hasFlagBeforeDoubleDash('--bare', argv)
    ? formatModeDisableAction('--bare', env)
    : 'unset CLAUDE_CODE_SIMPLE'
}
