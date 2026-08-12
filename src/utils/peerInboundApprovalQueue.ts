/**
 * densable 2.1.224 #5 — gGn open host with queueBehind (SEA rSh → n(gGn,…,{queueBehind:!0})).
 *
 * Local substitute for densable dialog registry Oy/Ns: one active peer_inbound_approval
 * at a time; further opens wait. AbortSignal cancels waiting or active entries as
 * behaviour "cancelled" (caller maps expired vs user-cancel via its own flag).
 */
import type { PeerInboundApprovalPayload } from '../components/PeerInboundApprovalDialog.js'

export type PeerInboundApprovalBehavior = 'approve' | 'deny' | 'cancelled'

type QueueEntry = {
  /** Opaque key (held entry object identity) for release-path UI drop. */
  key?: object
  payload: PeerInboundApprovalPayload
  signal?: AbortSignal
  resolve: (behavior: PeerInboundApprovalBehavior) => void
  onAbort?: () => void
}

export type PeerInboundApprovalQueue = {
  /** densable n(gGn, payload, {signal, queueBehind:!0}) */
  open: (
    payload: PeerInboundApprovalPayload,
    opts?: { signal?: AbortSignal; key?: object },
  ) => Promise<PeerInboundApprovalBehavior>
  /** Answer the active dialog (Select / Dialog cancel). */
  answer: (behavior: PeerInboundApprovalBehavior) => void
  /**
   * Drop active/waiting UI for keys that left the hold buffer via mode/policy
   * release (without user answer). Settles those promises as cancelled so
   * caller's Kei path sees gone / no double-deny on already-released entries.
   */
  cancelKeys: (keys: object[]) => void
  /** Advance queue when external dialog slot becomes free. */
  tryPump: () => void
  getActivePayload: () => PeerInboundApprovalPayload | null
  /** Subscribe to active-payload changes for React. Returns unsubscribe. */
  subscribe: (listener: () => void) => () => void
  /** Test / unmount: reject waiters as cancelled and clear. */
  dispose: () => void
}

/**
 * Create a queueBehind dialog host for peer inbound approval.
 * `isSlotFree` gates showing (densable waits behind other dialogs when false).
 */
export function createPeerInboundApprovalQueue(options?: {
  isSlotFree?: () => boolean
}): PeerInboundApprovalQueue {
  const waiting: QueueEntry[] = []
  let active: QueueEntry | null = null
  const listeners = new Set<() => void>()
  const isSlotFree = options?.isSlotFree ?? (() => true)

  const notify = (): void => {
    for (const l of listeners) l()
  }

  const detachAbort = (entry: QueueEntry): void => {
    if (entry.onAbort && entry.signal) {
      entry.signal.removeEventListener('abort', entry.onAbort)
      entry.onAbort = undefined
    }
  }

  const settle = (
    entry: QueueEntry,
    behavior: PeerInboundApprovalBehavior,
  ): void => {
    detachAbort(entry)
    entry.resolve(behavior)
  }

  const pump = (): void => {
    if (active) return
    if (!isSlotFree()) return
    while (waiting.length > 0) {
      const next = waiting.shift()!
      if (next.signal?.aborted) {
        settle(next, 'cancelled')
        continue
      }
      active = next
      notify()
      return
    }
  }

  const open = (
    payload: PeerInboundApprovalPayload,
    opts?: { signal?: AbortSignal; key?: object },
  ): Promise<PeerInboundApprovalBehavior> => {
    return new Promise(resolve => {
      const entry: QueueEntry = {
        key: opts?.key,
        payload,
        signal: opts?.signal,
        resolve,
      }
      if (entry.signal) {
        const onAbort = (): void => {
          if (active === entry) {
            active = null
            notify()
            settle(entry, 'cancelled')
            pump()
            return
          }
          const idx = waiting.indexOf(entry)
          if (idx !== -1) {
            waiting.splice(idx, 1)
            settle(entry, 'cancelled')
          }
        }
        entry.onAbort = onAbort
        if (entry.signal.aborted) {
          settle(entry, 'cancelled')
          return
        }
        entry.signal.addEventListener('abort', onAbort, { once: true })
      }
      waiting.push(entry)
      pump()
    })
  }

  const answer = (behavior: PeerInboundApprovalBehavior): void => {
    if (!active) return
    const entry = active
    active = null
    notify()
    settle(entry, behavior)
    pump()
  }

  const cancelKeys = (keys: object[]): void => {
    if (keys.length === 0) return
    const set = new Set(keys)
    if (active?.key && set.has(active.key)) {
      const entry = active
      active = null
      notify()
      settle(entry, 'cancelled')
    }
    for (let i = waiting.length - 1; i >= 0; i--) {
      const w = waiting[i]!
      if (w.key && set.has(w.key)) {
        waiting.splice(i, 1)
        settle(w, 'cancelled')
      }
    }
    pump()
  }

  return {
    open,
    answer,
    cancelKeys,
    tryPump: pump,
    getActivePayload: () => active?.payload ?? null,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: () => {
      if (active) {
        settle(active, 'cancelled')
        active = null
      }
      while (waiting.length > 0) {
        settle(waiting.shift()!, 'cancelled')
      }
      notify()
    },
  }
}
