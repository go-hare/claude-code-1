/**
 * densable 2.1.216 #5 — Claude Code on the web idle re-ask / drop answer.
 *
 * On re-`initialize` (web client reconnect after idle), densable does **not**
 * return `error: Already initialized`. It returns **success** with a full
 * initialize payload **plus** pending control requests so the host can
 * redeliver AskUserQuestion / permission prompts instead of re-asking or
 * dropping the user's answer.
 *
 * Gold (`l1S` / print initialize handler):
 * ```js
 * if (alreadyInitialized) {
 *   const perms = io.getPendingPermissionRequests()
 *   const dialogs = io.getPendingUserDialogRequests()
 *   logEvent('tengu_reinit_pending_redelivery', {
 *     n_pending_permissions: perms.length,
 *     n_pending_dialogs: dialogs.length,
 *   })
 *   enqueue({
 *     type: 'control_response',
 *     response: {
 *       subtype: 'success', // not error
 *       request_id,
 *       response: await buildInitResponse(...),
 *       pending_permission_requests: perms,
 *       pending_user_dialog_requests: dialogs,
 *     },
 *   })
 *   return
 * }
 * ```
 */

export const TENG_U_REINIT_PENDING_REDELIVERY =
  'tengu_reinit_pending_redelivery' as const

export type ReinitRedeliveryTelemetry = {
  n_pending_permissions: number
  n_pending_dialogs: number
}

export type ReinitControlResponseShape<
  TInit extends Record<string, unknown> = Record<string, unknown>,
  TPending = unknown,
> = {
  subtype: 'success'
  request_id: string
  /** Full initialize payload (commands/agents/models/account/…). */
  response: TInit
  pending_permission_requests: TPending[]
  pending_user_dialog_requests: TPending[]
}

/**
 * densable reinit control_response shape (pure — no IO).
 * Host UIs (CCR web / RemoteSessionManager) re-arm dialogs from the
 * pending_* sibling fields on **success** responses.
 */
export function buildReinitSuccessResponse<
  TInit extends Record<string, unknown>,
  TPending,
>(args: {
  requestId: string
  initResponse: TInit
  pendingPermissionRequests: TPending[]
  pendingUserDialogRequests: TPending[]
}): ReinitControlResponseShape<TInit, TPending> {
  return {
    subtype: 'success',
    request_id: args.requestId,
    response: args.initResponse,
    pending_permission_requests: args.pendingPermissionRequests,
    pending_user_dialog_requests: args.pendingUserDialogRequests,
  }
}

export function reinitRedeliveryTelemetry(
  nPendingPermissions: number,
  nPendingDialogs: number,
): ReinitRedeliveryTelemetry {
  return {
    n_pending_permissions: nPendingPermissions,
    n_pending_dialogs: nPendingDialogs,
  }
}
