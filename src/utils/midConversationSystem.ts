/**
 * Official mid_conversation_system beta gate (portable qqt).
 *
 * FORCE env → on; known older Claude models → off; mythos / mid_conv_system
 * capability / explicit enable env → on; else off.
 */

import { isEnvTruthy } from './envUtils.js'

const KNOWN_UNSUPPORTED_EXACT = new Set([
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-sonnet-4-0',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
])

export function isMidConversationSystemForced(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM) ||
    isEnvTruthy(env.CLAUDE_CODE_MID_CONVERSATION_SYSTEM)
  )
}

/**
 * Official qqt polarity: older models do NOT support mid-conversation system.
 */
export function shouldUseMidConversationSystem(input: {
  model?: string
  env?: NodeJS.ProcessEnv
  /** When provided, overrides model heuristic (from model beta map). */
  modelBetaEnabled?: boolean
  /** Optional capability flag (official dW mid_conv_system). */
  midConvSystemCapability?: boolean
}): boolean {
  const env = input.env ?? process.env
  if (isMidConversationSystemForced(env)) return true
  if (input.modelBetaEnabled !== undefined) return input.modelBetaEnabled
  const m = input.model ?? ''
  if (!m) return false
  if (m.includes('claude-3-') || KNOWN_UNSUPPORTED_EXACT.has(m)) {
    return false
  }
  if (input.midConvSystemCapability === true || m === 'claude-mythos-5') {
    return true
  }
  return false
}
