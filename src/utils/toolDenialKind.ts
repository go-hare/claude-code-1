/**
 * densable TKu / Jay residual — toolDenialKind on denied tool_result messages.
 * Behavior only (transcript / SDK outcome codes); no analytics.
 */

export type ToolDenialKind =
  | 'user-rejected'
  | 'permission-rule'
  | 'automode-blocked'
  | 'automode-unavailable'
  | 'automode-parsing-error'

/**
 * densable gTt / $cs — reason strings used by auto-mode classifier denials.
 * Matched against decisionReason.reason for TKu classification.
 */
export const AUTOMODE_CLASSIFIER_UNAVAILABLE_REASON = 'Classifier unavailable'
export const AUTOMODE_PARSING_ERROR_REASON_PREFIX =
  'Auto mode could not evaluate this action and is blocking it for safety'

/** densable Jay — toolDenialKind → transcript outcome code. */
export const TOOL_DENIAL_KIND_OUTCOME: Record<ToolDenialKind, string> = {
  'user-rejected': 'rejected-by-user',
  'permission-rule': 'blocked-by-permissions',
  'automode-blocked': 'automode-blocked',
  'automode-unavailable': 'automode-unavailable',
  'automode-parsing-error': 'automode-parsing-error',
}

type DecisionReasonLike = {
  type?: string
  classifier?: string
  reason?: string
}

type PermissionDecisionLike = {
  behavior?: string
  decisionReason?: DecisionReasonLike
}

/**
 * densable TKu — map permission deny/ask decision → toolDenialKind.
 * - behavior ask → user-rejected
 * - classifier auto-mode: unavailable / parsing-error prefix / blocked
 * - else → permission-rule
 */
export function toolDenialKindFromPermissionDecision(
  decision: PermissionDecisionLike | null | undefined,
): ToolDenialKind {
  if (decision?.behavior === 'ask') return 'user-rejected'
  const reason = decision?.decisionReason
  if (reason?.type === 'classifier' && reason.classifier === 'auto-mode') {
    if (reason.reason === AUTOMODE_CLASSIFIER_UNAVAILABLE_REASON) {
      return 'automode-unavailable'
    }
    if (
      typeof reason.reason === 'string' &&
      reason.reason.startsWith(AUTOMODE_PARSING_ERROR_REASON_PREFIX)
    ) {
      return 'automode-parsing-error'
    }
    return 'automode-blocked'
  }
  return 'permission-rule'
}

/** densable Jay lookup — outcome string for transcript rendering. */
export function toolDenialOutcomeFromKind(
  kind: ToolDenialKind | undefined,
): string | undefined {
  if (!kind) return undefined
  return TOOL_DENIAL_KIND_OUTCOME[kind]
}
