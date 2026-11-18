import { useEffect, useRef } from 'react'
import { useNotifications } from 'src/context/notifications.js'
import { logEvent } from 'src/services/analytics/index.js'
import {
  IDLE_UPSELL_DELAY_MINUTES,
  PUSH_IDLE_UPSELL_KEY,
  RC_IDLE_UPSELL_KEY,
  recordPushNotifIdleUpsellShown,
  recordRcIdleUpsellShown,
  shouldShowPushNotifIdleUpsell,
  shouldShowRcIdleUpsell,
} from 'src/services/tips/tipRegistry.js'
import { useAppState, useAppStateStore } from 'src/state/AppState.js'

/**
 * Gold `BAt` (`remote-control-upsell` / `push-idle-upsell`) (#1418):
 * After 20 minutes idle following a query completion, nudge Remote Control
 * (if unused) or Push Notifications (if RC was used and push is off).
 */
export function useIdleUpsellNotification(
  isLoading: boolean,
  lastQueryCompletionTime: number,
): void {
  const { addNotification, removeNotification } = useNotifications()
  const store = useAppStateStore()
  const isBriefOnly = useAppState(s => s.isBriefOnly)
  const shownRef = useRef(false)

  useEffect(() => {
    if (
      isBriefOnly ||
      lastQueryCompletionTime === 0 ||
      isLoading ||
      shownRef.current
    ) {
      return
    }
    const state = store.getState()
    const bridgeReady = state.replBridgeEnabled && !state.replBridgeOutboundOnly
    const kind =
      !bridgeReady && shouldShowRcIdleUpsell()
        ? 'rc'
        : shouldShowPushNotifIdleUpsell()
          ? 'push'
          : null
    if (kind === null) {
      return
    }
    const elapsed = Date.now() - lastQueryCompletionTime
    const delayMs = Math.max(0, IDLE_UPSELL_DELAY_MINUTES * 60_000 - elapsed)
    const timer = setTimeout(() => {
      if (shownRef.current) return
      const idleMinutes = Math.round(
        (Date.now() - lastQueryCompletionTime) / 60_000,
      )
      if (kind === 'rc') {
        const cur = store.getState()
        if (
          (cur.replBridgeEnabled && !cur.replBridgeOutboundOnly) ||
          !shouldShowRcIdleUpsell()
        ) {
          return
        }
        shownRef.current = true
        recordRcIdleUpsellShown()
        addNotification({
          key: RC_IDLE_UPSELL_KEY,
          kind: 'upsell',
          segments: [
            { text: 'control this session from your phone · ', dim: true },
            { text: '/remote-control', color: 'suggestion' },
          ],
          priority: 'medium',
          timeoutMs: 2_147_483_647,
        })
        logEvent('tengu_rc_upsell_notification_shown', { idleMinutes })
      } else {
        if (!shouldShowPushNotifIdleUpsell()) {
          return
        }
        shownRef.current = true
        recordPushNotifIdleUpsellShown()
        addNotification({
          key: PUSH_IDLE_UPSELL_KEY,
          kind: 'upsell',
          segments: [
            {
              text: 'get pinged when Claude finishes · enable push notifications in ',
              dim: true,
            },
            { text: '/config', color: 'suggestion' },
          ],
          priority: 'medium',
          timeoutMs: 2_147_483_647,
        })
        logEvent('tengu_push_notif_upsell_notification_shown', { idleMinutes })
      }
    }, delayMs)
    timer.unref?.()

    return () => {
      clearTimeout(timer)
      removeNotification(RC_IDLE_UPSELL_KEY)
      removeNotification(PUSH_IDLE_UPSELL_KEY)
    }
  }, [
    isBriefOnly,
    isLoading,
    lastQueryCompletionTime,
    store,
    addNotification,
    removeNotification,
  ])
}
