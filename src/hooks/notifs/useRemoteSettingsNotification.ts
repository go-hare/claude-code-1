/**
 * Official 2.1.325 `li(e)` (#1531): surface remote managed settings load status
 * transitions (`pending` / `missing` / `failed` / `stale_cache` / `answered`)
 * through the REPL notification queue.
 */
import { useEffect, useRef } from 'react'
import {
  type Notification,
  useNotifications,
} from 'src/context/notifications.js'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import {
  buildRemoteSettingsLoadNotice,
  onRemoteSettingsLoadStatusChanged,
  type RemoteSettingsNoticeSaid,
} from '../../utils/settings/remoteSettingsState.js'

export const REMOTE_SETTINGS_NOTICE_KEY = 'remote-settings-load-status'

export function dispatchRemoteSettingsLoadNotice(
  prevSaid: RemoteSettingsNoticeSaid | undefined,
  addNotification: (notice: Notification) => void,
): RemoteSettingsNoticeSaid | undefined {
  const result = buildRemoteSettingsLoadNotice(prevSaid)
  if (result === null) {
    return prevSaid
  }
  if (result.message !== null) {
    addNotification({
      key: REMOTE_SETTINGS_NOTICE_KEY,
      text: result.message,
      ...(result.severity === 'warning' ? { color: 'warning' as const } : {}),
      priority: 'immediate',
    })
  }
  return result.said
}

export function useRemoteSettingsNotification(): void {
  const { addNotification } = useNotifications()
  const saidRef = useRef<RemoteSettingsNoticeSaid | undefined>(undefined)

  useEffect(() => {
    if (getIsRemoteMode()) return

    const syncNotice = (): void => {
      saidRef.current = dispatchRemoteSettingsLoadNotice(
        saidRef.current,
        addNotification,
      )
    }

    syncNotice()
    return onRemoteSettingsLoadStatusChanged(syncNotice)
  }, [addNotification])
}
