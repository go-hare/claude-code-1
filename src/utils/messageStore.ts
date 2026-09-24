/**
 * densable iCe — message-store reducer. Local REPL has no store object;
 * this is the gold operation used by setMessages.
 *
 * `replace-last-ephemeral-progress`: walk back at most Mn progress
 * messages; replace when parentToolUseID and data.type match; else append.
 * Break on the first non-progress message.
 *
 * densable 2.1.251 SEA: `var Mn=200` (not 64).
 * `append-or-move-by-uuid` → densable `eBt` BODY (was wrongly marked ABSENT).
 */

import type { Message } from '../types/message.js'

/** densable `Mn` — max suffix scanned for an ephemeral progress replace. SEA `var Mn=200`. */
export const EPHEMERAL_PROGRESS_SCAN_WINDOW = 200

export type MessageStoreAction =
  | { type: 'append'; messages: Message[] }
  | { type: 'replace-all'; messages: Message[] }
  | { type: 'remove-by-uuid'; uuid: Message['uuid'] }
  | {
      type: 'replace-by-uuid'
      uuid: Message['uuid']
      message: Message
    }
  | {
      type: 'insert-after-uuid'
      uuid: Message['uuid']
      messages: Message[]
    }
  | {
      type: 'replace-last-ephemeral-progress'
      message: Message
    }
  | {
      type: 'append-or-move-by-uuid'
      message: Message
    }
  | {
      type: 'remove-uuids-and-append'
      excludeUuids: ReadonlySet<Message['uuid']>
      message: Message
    }
  | { type: 'update'; updater: (messages: Message[]) => Message[] }

/**
 * densable `eBt(e,t)` — if uuid absent, append; else drop prior copies and
 * append at end (move-to-end). Cuts duplicate list growth during turns.
 */
export function appendOrMoveByUuid(e: Message[], t: Message): Message[] {
  if (e.findLastIndex(o => o.uuid === t.uuid) === -1) return [...e, t]
  return [...e.filter(o => o.uuid !== t.uuid), t]
}

/**
 * densable iCe full switch (incl. eBt).
 */
export function applyMessageStoreAction(
  e: Message[],
  t: MessageStoreAction,
): Message[] {
  switch (t.type) {
    case 'append':
      return t.messages.length === 0 ? e : [...e, ...t.messages]
    case 'replace-all':
      return t.messages
    case 'remove-by-uuid': {
      const o = e.findIndex(i => i.uuid === t.uuid)
      if (o === -1) return e
      const r = e.slice()
      // biome-ignore lint/complexity/noCommaOperator: densable iCe `return r.splice(o,1),r`
      return r.splice(o, 1), r
    }
    case 'replace-by-uuid': {
      const o = e.findIndex(r => r.uuid === t.uuid)
      return o === -1 ? [...e, t.message] : e.with(o, t.message)
    }
    case 'insert-after-uuid': {
      const o = e.findIndex(i => i.uuid === t.uuid)
      if (o === -1 || t.messages.length === 0) return e
      const r = e.slice()
      // biome-ignore lint/complexity/noCommaOperator: densable iCe `return r.splice(o+1,0,...t.messages),r`
      return r.splice(o + 1, 0, ...t.messages), r
    }
    case 'replace-last-ephemeral-progress': {
      const o = Math.max(0, e.length - EPHEMERAL_PROGRESS_SCAN_WINDOW)
      for (let r = e.length - 1; r >= o; r--) {
        const i = e[r]
        if (i?.type !== 'progress') break
        if (
          i.parentToolUseID === t.message.parentToolUseID &&
          (i.data as { type: unknown }).type ===
            (t.message.data as { type: unknown }).type
        ) {
          return e.with(r, t.message)
        }
      }
      return [...e, t.message]
    }
    case 'append-or-move-by-uuid':
      return appendOrMoveByUuid(e, t.message)
    case 'remove-uuids-and-append':
      return [...e.filter(o => !t.excludeUuids.has(o.uuid)), t.message]
    case 'update':
      return t.updater(e)
  }
}
