/**
 * densable iCe — message-store reducer. Local REPL has no store object;
 * this is the gold operation used by setMessages.
 *
 * `replace-last-ephemeral-progress`: walk back at most Mn progress
 * messages; replace when parentToolUseID and data.type match; else append.
 * Break on the first non-progress message.
 */

import type { Message } from '../types/message.js'

/** densable `Mn` — max suffix scanned for an ephemeral progress replace. */
export const EPHEMERAL_PROGRESS_SCAN_WINDOW = 64

export type MessageStoreAction =
  | { type: 'append'; messages: Message[] }
  | {
      type: 'replace-last-ephemeral-progress'
      message: Message
    }

function progressParentAndType(message: Message): {
  parentToolUseID: unknown
  dataType: unknown
} {
  const data = message.data
  const dataType =
    data && typeof data === 'object' && data !== null && 'type' in data
      ? data.type
      : undefined
  return { parentToolUseID: message.parentToolUseID, dataType }
}

/**
 * densable iCe `replace-last-ephemeral-progress` case (and append).
 */
export function applyMessageStoreAction(
  messages: Message[],
  action: MessageStoreAction,
): Message[] {
  switch (action.type) {
    case 'append':
      return action.messages.length === 0
        ? messages
        : [...messages, ...action.messages]
    case 'replace-last-ephemeral-progress': {
      const incoming = progressParentAndType(action.message)
      const start = Math.max(
        0,
        messages.length - EPHEMERAL_PROGRESS_SCAN_WINDOW,
      )
      for (let i = messages.length - 1; i >= start; i--) {
        const row = messages[i]
        if (row?.type !== 'progress') break
        const existing = progressParentAndType(row)
        if (
          existing.parentToolUseID === incoming.parentToolUseID &&
          existing.dataType === incoming.dataType
        ) {
          const next = messages.slice()
          next[i] = action.message
          return next
        }
      }
      return [...messages, action.message]
    }
  }
}
