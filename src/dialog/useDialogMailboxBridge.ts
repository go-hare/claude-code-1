/**
 * densable hLo — bridge dialog mailbox → DialogStore.
 */
import { useEffect } from 'react'
import type { DialogMailbox } from './dialogMailbox.js'
import { useDialogStore } from './DialogStoreContext.js'

/**
 * Official 2.1.326 #108 (`Bee`): when Claude Code is exiting (e.g., double Ctrl+C
 * at ExitBackgroundWorkDialog or an unrecoverable interface error in renderAndRun),
 * unmounting the Ink tree must NOT resolve pending background/subagent permission
 * dialogs as a user refusal.
 */
let sessionExiting = false

export function markSessionExiting(): void {
  sessionExiting = true
}

export function isSessionExiting(): boolean {
  return sessionExiting
}

/** @internal test helper */
export function resetSessionExitingForTest(): void {
  sessionExiting = false
}

/** densable hLo(channel) */
export function useDialogMailboxBridge(
  mailbox: DialogMailbox | undefined,
): void {
  const store = useDialogStore()
  useEffect(() => {
    if (!mailbox) return
    const owned = new Set<string>()
    const unsubReq = mailbox.subscribe(entry => {
      owned.add(entry.id)
      store.open(entry)
    })
    const unsubCancel = mailbox.onCancel(id => {
      store.dismiss(id)
    })
    const unsubUpdate = mailbox.onUpdate(({ id, payload }) => {
      if (owned.has(id)) store.update(id, payload)
    })
    const unsubClosed = store.onClosed(event => {
      if (!owned.delete(event.id)) return
      mailbox.reply(
        event.type === 'answered'
          ? { id: event.id, result: event.result }
          : { id: event.id, cancelled: true },
      )
    })
    return () => {
      unsubReq()
      unsubCancel()
      unsubUpdate()
      unsubClosed()
      for (const id of owned) {
        store.dismiss(id)
        if (!sessionExiting) {
          mailbox.reply({ id, cancelled: true })
        }
      }
      owned.clear()
    }
  }, [mailbox, store])
}
