import type { Tools } from '../Tool.js'
import type {
  AttachmentMessage,
  Message,
  UserMessage,
} from '../types/message.js'
import { normalizeMessagesForAPI } from '../utils/messages.js'

/**
 * densable 2.1.228 `St` — mid-turn toolResults accumulation after tool updates.
 *
 * Gold (SEA 228, vs 227 which only special-cased `read_truncation_notice`):
 *   if attachment → push raw attachment
 *   if virtual user/assistant → skip
 *   else → normalizeMessagesForAPI → push type==="user"
 *
 * Why: SkillTool `newMessages` include `deferred_tools_delta` attachments.
 * Mid-turn `getAttachmentMessages` reconstructs prior deltas from history that
 * includes toolResults. If those attachments are only normalized to user text,
 * the next scan misses them and re-emits the deferred-tools reminder (changelog #11).
 */
export function accumulateToolResultForMidTurn(
  message: Message,
  toolResults: Array<UserMessage | AttachmentMessage>,
  tools: Tools,
  model?: string,
): void {
  if (message.type === 'attachment') {
    // Narrow Message → AttachmentMessage for toolResults (discriminated union).
    const attachment = message as AttachmentMessage
    toolResults.push(attachment)
    return
  }
  if (
    (message.type === 'user' || message.type === 'assistant') &&
    (message as { isVirtual?: boolean }).isVirtual === true
  ) {
    return
  }
  toolResults.push(
    ...normalizeMessagesForAPI([message], tools, model).filter(
      (m): m is UserMessage => m.type === 'user',
    ),
  )
}
