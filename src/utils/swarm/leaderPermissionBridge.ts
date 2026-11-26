/**
 * Leader Permission Bridge
 *
 * Module-level bridge that allows the REPL to register its setToolUseConfirmQueue
 * (+ DialogStore for densable NMs mirror) and setToolPermissionContext for
 * in-process teammates.
 *
 * densable: permissions surface via DialogStore / NMs — tip mirrors through
 * enqueuePermissionConfirm, not a second PermissionRequest overlay.
 */

import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import type { DialogStore } from '../../dialog/dialogStore.js'
import type { ToolPermissionContext } from '../../Tool.js'
import {
  dequeuePermissionConfirm,
  enqueuePermissionConfirm,
} from '../../hooks/toolPermission/PermissionContext.js'
import { getBootstrapSession, RootSessionSlot } from '../sessionHost.js'

export type SetToolUseConfirmQueueFn = (
  updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
) => void

export type SetToolPermissionContextFn = (
  context: ToolPermissionContext,
  options?: { preserveMode?: boolean },
) => void

type LeaderPermissionBridgeState = {
  registeredSetter: SetToolUseConfirmQueueFn | null
  registeredDialogStore: DialogStore | null
  registeredPermissionContextSetter: SetToolPermissionContextFn | null
}

/** Official 2.1.331 [$e-187 OYo] — per-root-session leader permission bridge. */
const leaderPermissionBridgeSlot =
  new RootSessionSlot<LeaderPermissionBridgeState>(() => ({
    registeredSetter: null,
    registeredDialogStore: null,
    registeredPermissionContextSetter: null,
  }))

function getBridgeState(): LeaderPermissionBridgeState {
  return leaderPermissionBridgeSlot.of(getBootstrapSession())
}

export function registerLeaderToolUseConfirmQueue(
  setter: SetToolUseConfirmQueueFn,
  dialogStore?: DialogStore | null,
): void {
  const state = getBridgeState()
  state.registeredSetter = setter
  state.registeredDialogStore = dialogStore ?? null
}

export function getLeaderToolUseConfirmQueue(): SetToolUseConfirmQueueFn | null {
  return getBridgeState().registeredSetter
}

/** densable NMs mirror push — prefer over raw setQueue append */
export function pushLeaderToolUseConfirm(item: ToolUseConfirm): boolean {
  const state = getBridgeState()
  if (!state.registeredSetter) return false
  enqueuePermissionConfirm(
    state.registeredSetter as never,
    state.registeredDialogStore,
    item,
  )
  return true
}

export function removeLeaderToolUseConfirm(toolUseID: string): void {
  const state = getBridgeState()
  if (!state.registeredSetter) return
  dequeuePermissionConfirm(
    state.registeredSetter as never,
    state.registeredDialogStore,
    toolUseID,
  )
}

export function unregisterLeaderToolUseConfirmQueue(): void {
  const state = getBridgeState()
  state.registeredSetter = null
  state.registeredDialogStore = null
}

export function registerLeaderSetToolPermissionContext(
  setter: SetToolPermissionContextFn,
): void {
  getBridgeState().registeredPermissionContextSetter = setter
}

export function getLeaderSetToolPermissionContext(): SetToolPermissionContextFn | null {
  return getBridgeState().registeredPermissionContextSetter
}

export function unregisterLeaderSetToolPermissionContext(): void {
  getBridgeState().registeredPermissionContextSetter = null
}
