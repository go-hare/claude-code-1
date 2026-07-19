import type { LocalCommandCall } from '../../types/command.js'
import {
  applyConfigShorthand,
  configNonInteractiveUsage,
  isConfigHelpOrListToken,
  parseConfigShorthand,
} from './argumentCompletions.js'

/**
 * densable Edy / shs (2.1.211): non-interactive `/config key=value`.
 * Only enabled when `getIsNonInteractiveSession()` is true (headless / -p).
 */
export const call: LocalCommandCall = async args => {
  const trimmed = args?.trim() || ''
  const lower = trimmed.toLowerCase()
  if (!trimmed || isConfigHelpOrListToken(lower)) {
    return { type: 'text', value: configNonInteractiveUsage() }
  }

  const pairs = parseConfigShorthand(trimmed)
  if (!pairs) {
    return {
      type: 'text',
      value: `Expected key=value, got "${trimmed}". Run /config to see what's available.`,
    }
  }

  const results = await applyConfigShorthand(pairs)
  return {
    type: 'text',
    value: results.map(r => r.message).join('\n'),
  }
}
