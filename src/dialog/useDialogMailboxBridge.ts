/**
 * densable hLo — bridge dialog mailbox → DialogStore.
 */
import { useEffect } from 'react'
import type { DialogMailbox } from './dialogMailbox.js'
import { useDialogStore } from './DialogStoreContext.js'

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
        mailbox.reply({ id, cancelled: true })
      }
      owned.clear()
    }
  }, [mailbox, store])
}
