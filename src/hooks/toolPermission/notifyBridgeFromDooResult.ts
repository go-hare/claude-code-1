/**
 * densable W() / kdm.notifyBridgeAndTeardown — Hnu and other Host-answered
 * permission_* kinds settle via store.answer, not confirm.onAllow.
 *
 * Official W(Q) (236 gold-doo-full, still the NMs-era body):
 *   allow → D({behavior:"allow", updatedInput, updatedPermissions})
 *   deny → D({behavior:"deny", message: feedback ?? "User denied permission"})
 *   cancelled → D({behavior:"deny", message:"User aborted"}) then cancelAndAbort
 *
 * D is not cancel-only: kdm S sendResponse(payload) then cancelRequest.
 * Sandbox Esc cancelRequest is FRr / K8c, not permission doo W().
 */
import type { PermissionPromptResult } from '../../dialog/specs/permissionKinds.js'
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js'

export type DooBridgeNotify = (msg: {
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  updatedPermissions?: PermissionUpdate[]
  message?: string
}) => void

export function notifyBridgeFromDooResult(
  notifyBridge: DooBridgeNotify | undefined,
  result: PermissionPromptResult,
  fallbackInput: Record<string, unknown>,
): void {
  if (!notifyBridge) return
  if (result.behavior === 'allow') {
    notifyBridge({
      behavior: 'allow',
      updatedInput:
        (result.updatedInput as Record<string, unknown> | undefined) ??
        fallbackInput,
      ...(result.permissionUpdates !== undefined
        ? {
            updatedPermissions: result.permissionUpdates as PermissionUpdate[],
          }
        : {}),
    })
    return
  }
  notifyBridge({
    behavior: 'deny',
    message:
      result.behavior === 'cancelled'
        ? 'User aborted'
        : (result.feedback ?? 'User denied permission'),
  })
}
