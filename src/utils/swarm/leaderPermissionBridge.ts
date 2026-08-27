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

export type SetToolUseConfirmQueueFn = (
  updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
) => void

export type SetToolPermissionContextFn = (
  context: ToolPermissionContext,
  options?: { preserveMode?: boolean },
) => void

let registeredSetter: SetToolUseConfirmQueueFn | null = null
let registeredDialogStore: DialogStore | null = null
let registeredPermissionContextSetter: SetToolPermissionContextFn | null = null

export function registerLeaderToolUseConfirmQueue(
  setter: SetToolUseConfirmQueueFn,
  dialogStore?: DialogStore | null,
): void {
  registeredSetter = setter
  registeredDialogStore = dialogStore ?? null
}

export function getLeaderToolUseConfirmQueue(): SetToolUseConfirmQueueFn | null {
  return registeredSetter
}

/** densable NMs mirror push — prefer over raw setQueue append */
export function pushLeaderToolUseConfirm(item: ToolUseConfirm): boolean {
  if (!registeredSetter) return false
  enqueuePermissionConfirm(
    registeredSetter as never,
    registeredDialogStore,
    item,
  )
  return true
}

export function removeLeaderToolUseConfirm(toolUseID: string): void {
  if (!registeredSetter) return
  dequeuePermissionConfirm(
    registeredSetter as never,
    registeredDialogStore,
    toolUseID,
  )
}

export function unregisterLeaderToolUseConfirmQueue(): void {
  registeredSetter = null
  registeredDialogStore = null
}

export function registerLeaderSetToolPermissionContext(
  setter: SetToolPermissionContextFn,
): void {
  registeredPermissionContextSetter = setter
}

export function getLeaderSetToolPermissionContext(): SetToolPermissionContextFn | null {
  return registeredPermissionContextSetter
}

export function unregisterLeaderSetToolPermissionContext(): void {
  registeredPermissionContextSetter = null
}
