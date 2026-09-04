/**
 * densable 2.1.243 #49 — client error when effort is xhigh/max and thinking
 * is off. SEA names the level, the setting that disabled thinking, and
 * `/effort high` (interactive) or `--effort high` (CLI) as the fix.
 */

import { getSettingsWithErrors } from './settings/settings.js'

export function isTopEffortWithThinkingOff(
  effort: string | undefined,
  thinkingOff: boolean,
): effort is 'xhigh' | 'max' {
  return thinkingOff && (effort === 'xhigh' || effort === 'max')
}

function describeThinkingOffCause(): string {
  const raw = process.env.MAX_THINKING_TOKENS
  if (raw !== undefined) {
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n <= 0) {
      return 'unset MAX_THINKING_TOKENS=0'
    }
  }

  const { settings } = getSettingsWithErrors()
  if (settings.alwaysThinkingEnabled === false) {
    return 'remove "alwaysThinkingEnabled": false from settings'
  }

  return 'start the session without thinking disabled'
}

/** Interactive / REPL. */
export function formatEffortThinkingOffError(level: 'xhigh' | 'max'): string {
  return (
    `Effort '${level}' isn't available with thinking turned off on this model. ` +
    `run /effort high to continue, or turn thinking back on (${describeThinkingOffCause()})`
  )
}

/** CLI `--effort` / settings bootstrap. */
export function formatEffortThinkingOffCliError(
  level: 'xhigh' | 'max',
): string {
  return (
    `Effort '${level}' isn't available with thinking turned off on this model. ` +
    `use --effort high (or the effortLevel setting), or turn thinking back on (${describeThinkingOffCause()})`
  )
}
