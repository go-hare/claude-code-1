import type { Message } from '../types/message.js'
import { getMessagesAfterCompactBoundary } from './messages.js'
import { tokenCountFromLastAPIResponse } from './tokens.js'

/**
 * densable `ZD(mC(transcript snapshot))` — context-window tokens after the
 * last compact boundary. Billing `getTotalInputTokens()` undercounts cache
 * reads and is 0 after /resume, so it must not gate the idle-return hint.
 */
export function idleReturnContextTokens(messages: readonly Message[]): number {
  return tokenCountFromLastAPIResponse(
    getMessagesAfterCompactBoundary(messages as Message[]),
  )
}
