import stripAnsi from 'strip-ansi'
import { formatTotalCost } from '../../cost-tracker.js'
import type { LocalCommandCall } from '../../types/command.js'

/**
 * densable SSs — non-interactive `/usage` / `/cost` / `/stats` cost summary.
 * Interactive path still opens the Usage settings tab.
 * Reuses formatTotalCost (same body densable prints; strip chalk for plain text).
 */
export const call: LocalCommandCall = async () => {
  return { type: 'text', value: stripAnsi(formatTotalCost()) }
}
