/**
 * densable InboxPoller protocol-frame classification (pure).
 *
 * Gold: after named handlers (permission/sandbox/shutdown/mode/plan_request),
 * remaining `kre` frames:
 *   - plan_approval_response && handled (set `b`) → rewrite text via Ejr
 *   - else drop with warn
 * team_permission_update is always dropped (AZi: never apply rules from inbox).
 */

import { formatPlanApprovalForModel } from '../utils/inProcessTeammateHelpers.js'
import {
  isModeSetRequest,
  isPermissionRequest,
  isPermissionResponse,
  isPlanApprovalRequest,
  isPlanApprovalResponse,
  isSandboxPermissionRequest,
  isSandboxPermissionResponse,
  isShutdownApproved,
  isShutdownRequest,
  isStructuredProtocolMessage,
  isTeamPermissionUpdate,
  type TeammateMessage,
} from '../utils/teammateMailbox.js'

export type InboxProtocolBuckets = {
  permissionRequests: TeammateMessage[]
  permissionResponses: TeammateMessage[]
  sandboxPermissionRequests: TeammateMessage[]
  sandboxPermissionResponses: TeammateMessage[]
  shutdownRequests: TeammateMessage[]
  shutdownApprovals: TeammateMessage[]
  modeSetRequests: TeammateMessage[]
  planApprovalRequests: TeammateMessage[]
  regularMessages: TeammateMessage[]
  droppedProtocolFrames: TeammateMessage[]
}

/**
 * Classify unread mailbox messages into handler buckets.
 * `handledPlanApprovals` is densable set `b` — messages already side-effected
 * in the early plan_approval_response pass (includes rejects).
 */
export function classifyInboxProtocolMessages(
  unread: readonly TeammateMessage[],
  handledPlanApprovals: ReadonlySet<TeammateMessage> = new Set(),
): InboxProtocolBuckets {
  const permissionRequests: TeammateMessage[] = []
  const permissionResponses: TeammateMessage[] = []
  const sandboxPermissionRequests: TeammateMessage[] = []
  const sandboxPermissionResponses: TeammateMessage[] = []
  const shutdownRequests: TeammateMessage[] = []
  const shutdownApprovals: TeammateMessage[] = []
  const modeSetRequests: TeammateMessage[] = []
  const planApprovalRequests: TeammateMessage[] = []
  const regularMessages: TeammateMessage[] = []
  const droppedProtocolFrames: TeammateMessage[] = []

  for (const m of unread) {
    const permReq = isPermissionRequest(m.text)
    const permResp = isPermissionResponse(m.text)
    const sandboxReq = isSandboxPermissionRequest(m.text)
    const sandboxResp = isSandboxPermissionResponse(m.text)
    const shutdownReq = isShutdownRequest(m.text)
    const shutdownApproval = isShutdownApproved(m.text)
    const modeSetReq = isModeSetRequest(m.text)
    const planApprovalReq = isPlanApprovalRequest(m.text)
    const planApprovalResp = isPlanApprovalResponse(m.text)

    if (permReq) {
      permissionRequests.push(m)
    } else if (permResp) {
      permissionResponses.push(m)
    } else if (sandboxReq) {
      sandboxPermissionRequests.push(m)
    } else if (sandboxResp) {
      sandboxPermissionResponses.push(m)
    } else if (shutdownReq) {
      shutdownRequests.push(m)
    } else if (shutdownApproval) {
      shutdownApprovals.push(m)
    } else if (isTeamPermissionUpdate(m.text)) {
      // densable AZi: permission rules are never accepted from the inbox
      droppedProtocolFrames.push(m)
    } else if (modeSetReq) {
      modeSetRequests.push(m)
    } else if (planApprovalReq) {
      planApprovalRequests.push(m)
    } else if (planApprovalResp) {
      if (handledPlanApprovals.has(m)) {
        regularMessages.push({
          ...m,
          text: formatPlanApprovalForModel(planApprovalResp),
        })
      } else {
        droppedProtocolFrames.push(m)
      }
    } else if (isStructuredProtocolMessage(m.text)) {
      droppedProtocolFrames.push(m)
    } else {
      regularMessages.push(m)
    }
  }

  return {
    permissionRequests,
    permissionResponses,
    sandboxPermissionRequests,
    sandboxPermissionResponses,
    shutdownRequests,
    shutdownApprovals,
    modeSetRequests,
    planApprovalRequests,
    regularMessages,
    droppedProtocolFrames,
  }
}
