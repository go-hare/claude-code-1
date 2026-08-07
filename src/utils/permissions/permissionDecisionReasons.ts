/**
 * densable 2.1.216 gold — permission-prompt / canUseTool deny reasons used for
 * telemetry classification (rx_ / Gwu).
 *
 * SEA consts: QFn, ZFn, e2n, h8t and pCi/iNr/fCi/g8t objects.
 * Changelog: failed permission-prompt requests must not count as user
 * rejections; user interrupts report as user_abort.
 */

import type { PermissionDecisionReason } from 'src/types/permissions.js'

/** densable QFn */
export const TOOL_PERMISSION_STREAM_CLOSED_REASON =
  'tool permission stream closed before response received'

/** densable ZFn */
export const CAN_USE_TOOL_INVALID_RESULT_REASON =
  'canUseTool returned a schema-invalid permission result'

/** densable e2n */
export const TOOL_PERMISSION_REQUEST_FAILED_REASON =
  'tool permission request failed'

/** densable h8t — interrupt / abort of the permission prompt request */
export const TOOL_PERMISSION_REQUEST_ABORTED_REASON =
  'tool permission request aborted'

/** densable Moi — appended to schema-invalid user-facing messages */
export const PERMISSION_RESULT_SHAPE_HINT =
  "Expected {behavior: 'allow', updatedInput?: object} or {behavior: 'deny', message: string}."

/** densable pCi */
export const permissionStreamClosedDenyReason = {
  type: 'other',
  reason: TOOL_PERMISSION_STREAM_CLOSED_REASON,
} as const satisfies PermissionDecisionReason

/** densable iNr */
export const canUseToolInvalidResultDenyReason = {
  type: 'other',
  reason: CAN_USE_TOOL_INVALID_RESULT_REASON,
} as const satisfies PermissionDecisionReason

/** densable fCi */
export const canUseToolRequestFailedDenyReason = {
  type: 'other',
  reason: TOOL_PERMISSION_REQUEST_FAILED_REASON,
} as const satisfies PermissionDecisionReason

/** densable g8t */
export const canUseToolAbortedDenyReason = {
  type: 'other',
  reason: TOOL_PERMISSION_REQUEST_ABORTED_REASON,
} as const satisfies PermissionDecisionReason

/**
 * densable tx_ — map a rule origin to OTel `source` vocabulary.
 */
export function ruleSourceToOTelSource(
  ruleSource: string,
  behavior: 'allow' | 'deny',
): string {
  switch (ruleSource) {
    case 'session':
      return behavior === 'allow' ? 'user_temporary' : 'user_reject'
    case 'localSettings':
    case 'userSettings':
      return behavior === 'allow' ? 'user_permanent' : 'user_reject'
    default:
      return 'config'
  }
}

/**
 * densable rx_ — map PermissionDecisionReason → OTel `source` for the
 * non-interactive tool_decision path.
 *
 * Critical 2.1.216 fix: `other` + aborted reason → `user_abort` (not config /
 * user_reject). Failed / stream-closed / schema-invalid stay `config` so they
 * do not count as user rejections.
 */
export function decisionReasonToOTelSource(
  reason: PermissionDecisionReason | undefined,
  behavior: 'allow' | 'deny',
): string {
  if (!reason) {
    return 'config'
  }
  switch (reason.type) {
    case 'permissionPromptTool': {
      // toolResult carries parsed Output from PermissionPromptToolResultSchema.
      const toolResult = reason.toolResult as
        | { decisionClassification?: string }
        | undefined
      const classified = toolResult?.decisionClassification
      if (
        classified === 'user_temporary' ||
        classified === 'user_permanent' ||
        classified === 'user_reject'
      ) {
        return classified
      }
      // densable: unset → temporary for allow, reject for deny (conservative)
      return behavior === 'allow' ? 'user_temporary' : 'user_reject'
    }
    case 'rule':
      return ruleSourceToOTelSource(reason.rule.source, behavior)
    case 'hook':
      return 'hook'
    case 'mode':
    case 'classifier':
    case 'subcommandResults':
    case 'asyncAgent':
    case 'sandboxOverride':
    case 'workingDir':
    case 'safetyCheck':
      return 'config'
    case 'other':
      // densable: if(e.reason===h8t)return"user_abort";return"config"
      if (reason.reason === TOOL_PERMISSION_REQUEST_ABORTED_REASON) {
        return 'user_abort'
      }
      return 'config'
    default: {
      const _exhaustive: never = reason
      void _exhaustive
      return 'config'
    }
  }
}

/**
 * densable Gwu `other` branch labels for detailed analytics (not OTel source).
 */
export function otherDecisionReasonAnalyticsLabel(
  reason: string,
):
  | 'permissionStreamClosed'
  | 'canUseToolInvalidResult'
  | 'canUseToolRequestFailed'
  | 'canUseToolAborted'
  | 'other' {
  switch (reason) {
    case TOOL_PERMISSION_STREAM_CLOSED_REASON:
      return 'permissionStreamClosed'
    case CAN_USE_TOOL_INVALID_RESULT_REASON:
      return 'canUseToolInvalidResult'
    case TOOL_PERMISSION_REQUEST_FAILED_REASON:
      return 'canUseToolRequestFailed'
    case TOOL_PERMISSION_REQUEST_ABORTED_REASON:
      return 'canUseToolAborted'
    default:
      return 'other'
  }
}
