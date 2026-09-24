/**
 * Remaining densable `iCe` cases live on `applyMessageStoreAction`.
 * This wrapper keeps the split import used by colocated tests.
 *
 * densable 2.1.251: `append-or-move-by-uuid` = `eBt` BODY (HAVE).
 */
import type { Message } from '../../types/message.js'
import { applyMessageStoreAction } from '../messageStore.js'

export type RemainingMessageStoreAction =
  | { type: 'replace-all'; messages: Message[] }
  | { type: 'remove-by-uuid'; uuid: Message['uuid'] }
  | { type: 'replace-by-uuid'; uuid: Message['uuid']; message: Message }
  | { type: 'insert-after-uuid'; uuid: Message['uuid']; messages: Message[] }
  | {
      type: 'append-or-move-by-uuid'
      message: Message
    }
  | {
      type: 'remove-uuids-and-append'
      excludeUuids: Set<Message['uuid']>
      message: Message
    }
  | { type: 'update'; updater: (messages: Message[]) => Message[] }

/** densable iCe remaining cases (full object minus append / ephemeral). */
export function applyRemainingMessageStoreAction(
  e: Message[],
  t: RemainingMessageStoreAction,
): Message[] {
  return applyMessageStoreAction(e, t)
}
