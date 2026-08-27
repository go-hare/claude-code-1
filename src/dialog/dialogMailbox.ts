/**
 * densable kdy — dialog request mailbox (request / reply / update / cancel).
 */
import { createSignal } from '../utils/signal.js'
import type { OpenDialogEntry } from './dialogStore.js'

export type DialogMailboxReply =
  | { id: string; result: unknown }
  | { id: string; cancelled: true }

export type DialogMailboxUpdate = { id: string; payload: unknown }

export type DialogRequestOptions = {
  signal?: AbortSignal
  queueBehind?: boolean
}

export type DialogMailbox = {
  subscribe: (listener: (entry: OpenDialogEntry) => void) => () => void
  onCancel: (listener: (id: string) => void) => () => void
  onUpdate: (listener: (update: DialogMailboxUpdate) => void) => () => void
  reply: (msg: DialogMailboxReply) => void
  request: (
    input: { kind: string; payload: unknown },
    options?: DialogRequestOptions,
  ) => {
    id: string
    replied: Promise<DialogMailboxReply>
    update: (payload: unknown) => void
  }
}

/** densable kdy */
export function createDialogMailbox(): DialogMailbox {
  const requests = createSignal<[OpenDialogEntry]>()
  const cancels = createSignal<[string]>()
  const updates = createSignal<[DialogMailboxUpdate]>()
  const pending = new Map<string, (reply: DialogMailboxReply) => void>()
  let seq = 0

  return {
    subscribe: requests.subscribe,
    onCancel: cancels.subscribe,
    onUpdate: updates.subscribe,
    reply(msg) {
      const resolve = pending.get(msg.id)
      if (!resolve) return
      pending.delete(msg.id)
      resolve(msg)
    },
    request({ kind, payload }, options) {
      seq += 1
      const id = `dialog-${seq}`
      const { promise, resolve } = Promise.withResolvers<DialogMailboxReply>()
      const signal = options?.signal
      if (signal?.aborted) {
        queueMicrotask(() => resolve({ id, cancelled: true }))
        return { id, replied: promise, update: () => {} }
      }
      let onAbort: (() => void) | undefined
      pending.set(id, reply => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
        resolve(reply)
      })
      if (signal) {
        onAbort = () => {
          if (pending.delete(id)) {
            resolve({ id, cancelled: true })
            cancels.emit(id)
          }
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      requests.emit({
        id,
        kind,
        payload,
        queueBehind: options?.queueBehind,
      })
      return {
        id,
        replied: promise,
        update: nextPayload => {
          if (pending.has(id)) {
            updates.emit({ id, payload: nextPayload })
          }
        },
      }
    },
  }
}
