import { feature } from 'bun:bundle'
import { useEffect, useRef } from 'react'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import {
  useAppState,
  useAppStateStore,
  useSetAppState,
} from '../../state/AppState.js'
import type { ToolPermissionContext } from '../../Tool.js'
import {
  BYPASS_DISABLED_BY_HELD_TO_AUTO_MESSAGE,
  BYPASS_DISABLED_BY_SETTINGS_MESSAGE,
  createDisabledBypassPermissionsContext,
  getBypassPermissionsDisabledReason,
  isBypassPermissionsModeDisabled,
  isModeBlockedByHeldToAuto,
  verifyAutoModeGateAccess,
} from './permissionSetup.js'

export {
  BYPASS_DISABLED_BY_HELD_TO_AUTO_MESSAGE,
  BYPASS_DISABLED_BY_SETTINGS_MESSAGE,
  getBypassPermissionsDisabledReason,
  isModeBlockedByHeldToAuto,
}

let bypassPermissionsCheckRan = false

/**
 * Checks whether bypassPermissions mode is disabled by policy/settings/gate/
 * held-to-auto session cap (`CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO`, official
 * 2.1.331 `xIo`/`FC`) and strips it from AppState.toolPermissionContext if so.
 */
export async function checkAndDisableBypassPermissionsIfNeeded(
  _toolPermissionContext: ToolPermissionContext,
  setAppState: (
    f: (
      prev: import('../../state/AppState.js').AppState,
    ) => import('../../state/AppState.js').AppState,
  ) => void,
): Promise<void> {
  if (bypassPermissionsCheckRan) {
    return
  }
  bypassPermissionsCheckRan = true

  const disabledReason = getBypassPermissionsDisabledReason()
  if (disabledReason === undefined && !isBypassPermissionsModeDisabled()) {
    return
  }

  setAppState(prev => {
    const nextCtx = createDisabledBypassPermissionsContext(
      prev.toolPermissionContext,
    )
    if (nextCtx === prev.toolPermissionContext) {
      return prev
    }
    if (disabledReason && prev.notifications?.queue) {
      return {
        ...prev,
        toolPermissionContext: nextCtx,
        notifications: {
          ...prev.notifications,
          queue: [
            ...prev.notifications.queue,
            {
              key: 'bypass-permissions-disabled-by-settings',
              text: disabledReason,
              color: 'warning' as const,
              priority: 'high' as const,
            },
          ],
        },
      }
    }
    return { ...prev, toolPermissionContext: nextCtx }
  })
}

/**
 * Reset the run-once flag for checkAndDisableBypassPermissionsIfNeeded.
 */
export function resetBypassPermissionsCheck(): void {
  bypassPermissionsCheckRan = false
}

/**
 * Runs the bypassPermissions killswitch check on mount.
 */
export function useKickOffCheckAndDisableBypassPermissionsIfNeeded(): void {
  const setAppState = useSetAppState()
  const store = useAppStateStore()

  useEffect(() => {
    if (getIsRemoteMode()) return
    void checkAndDisableBypassPermissionsIfNeeded(
      store.getState().toolPermissionContext,
      setAppState,
    ).catch(error => {
      logError(
        new Error('Bypass permissions killswitch check failed', {
          cause: toError(error),
        }),
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

let autoModeCheckRan = false

export async function checkAndDisableAutoModeIfNeeded(
  toolPermissionContext: ToolPermissionContext,
  setAppState: (
    f: (
      prev: import('../../state/AppState.js').AppState,
    ) => import('../../state/AppState.js').AppState,
  ) => void,
  fastMode?: boolean,
): Promise<void> {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (autoModeCheckRan) {
      return
    }
    autoModeCheckRan = true

    const { updateContext, notification } = await verifyAutoModeGateAccess(
      toolPermissionContext,
      fastMode,
    )
    setAppState(prev => {
      const nextCtx = updateContext(prev.toolPermissionContext)
      const newState =
        nextCtx === prev.toolPermissionContext
          ? prev
          : { ...prev, toolPermissionContext: nextCtx }
      if (!notification) return newState
      return {
        ...newState,
        notifications: {
          ...newState.notifications,
          queue: [
            ...newState.notifications.queue,
            {
              key: 'auto-mode-gate-notification',
              text: notification,
              color: 'warning' as const,
              priority: 'high' as const,
            },
          ],
        },
      }
    })
  }
}

/**
 * Reset the run-once flag for checkAndDisableAutoModeIfNeeded.
 * Call this after /login so the gate check re-runs with the new org.
 */
export function resetAutoModeGateCheck(): void {
  autoModeCheckRan = false
}

export function useKickOffCheckAndDisableAutoModeIfNeeded(): void {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)
  const fastMode = useAppState(s => s.fastMode)
  const setAppState = useSetAppState()
  const store = useAppStateStore()
  const isFirstRunRef = useRef(true)

  // Runs on mount (startup check) AND whenever the model or fast mode changes
  useEffect(() => {
    if (getIsRemoteMode()) return
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false
    } else {
      resetAutoModeGateCheck()
    }
    void checkAndDisableAutoModeIfNeeded(
      store.getState().toolPermissionContext,
      setAppState,
      fastMode,
    ).catch(error => {
      logError(
        new Error('Auto mode gate check failed', { cause: toError(error) }),
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainLoopModel, mainLoopModelForSession, fastMode])
}
