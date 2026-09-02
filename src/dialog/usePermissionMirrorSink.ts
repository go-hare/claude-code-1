/**
 * Install the enqueue/mirror Host sink on DialogStore.onClosed.
 */
import { useEffect } from 'react'
import { useDialogStore } from './DialogStoreContext.js'
import { settlePermissionMirror } from './settlePermissionMirror.js'

export function usePermissionMirrorSink(): void {
  const store = useDialogStore()
  useEffect(() => {
    return store.onClosed(event => {
      settlePermissionMirror(event)
    })
  }, [store])
}
