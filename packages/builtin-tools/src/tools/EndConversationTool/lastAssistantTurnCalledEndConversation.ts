/**
 * densable Mqu / lastAssistantTurnCalledEndConversation — two-step reflection gate.
 *
 * Walks messages reverse from the end:
 * - On assistant: if any tool_use named EndConversation → true (prior call this turn)
 * - On user: if content is NOT exclusively tool_result blocks → false (new user turn)
 *            if we already saw an assistant without EndConversation → false
 */

import type { Message } from 'src/types/message.js'
import { END_CONVERSATION_TOOL_NAME } from './prompt.js'

export function lastAssistantTurnCalledEndConversation(
  messages: readonly Message[],
  toolName: string = END_CONVERSATION_TOOL_NAME,
): boolean {
  let sawAssistant = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.type === 'assistant') {
      sawAssistant = true
      const content = msg.message?.content
      if (
        Array.isArray(content) &&
        content.some(
          block =>
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            block.type === 'tool_use' &&
            'name' in block &&
            block.name === toolName,
        )
      ) {
        return true
      }
      continue
    }
    if (msg?.type === 'user') {
      const content = msg.message?.content
      const onlyToolResults =
        Array.isArray(content) &&
        content.length > 0 &&
        content.every(
          block =>
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            block.type === 'tool_result',
        )
      if (!onlyToolResults) return false
      if (sawAssistant) return false
    }
  }
  return false
}
