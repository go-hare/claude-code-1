/**
 * densable 2.1.289 Gje — `/config key=value` local (headless) twin.
 */
import type { LocalCommandCall } from '../../types/command.js'
import {
  applyConfigShorthandFromArgs,
  formatConfigShorthandHelp,
  isConfigHelpOrListToken,
  parseConfigKeyValueArgs,
} from './configShorthand.js'

export const call: LocalCommandCall = async (args, context) => {
  const trimmed = args.trim()
  const lower = trimmed.toLowerCase()
  if (!lower || isConfigHelpOrListToken(lower)) {
    return {
      type: 'text',
      value: await formatConfigShorthandHelp(context),
    }
  }
  if (!parseConfigKeyValueArgs(trimmed)) {
    return {
      type: 'text',
      value: `Expected key=value, got "${trimmed}". Run /config to see what's available.`,
    }
  }
  return {
    type: 'text',
    value: await applyConfigShorthandFromArgs(trimmed, context),
  }
}
