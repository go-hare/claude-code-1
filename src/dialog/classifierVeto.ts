/**
 * densable w2 / W9 — walk permission decisionReason for a
 * non-classifier-approvable safetyCheck (including nested
 * subcommandResults).
 */
import type { PermissionDecisionReason } from '../types/permissions.js'
import { findSafetyCheckDecision } from '../utils/permissions/permissions.js'

export function isClassifierNotApprovable(permissionResult: unknown): boolean {
  const reason = (
    permissionResult as {
      decisionReason?: PermissionDecisionReason
    } | null
  )?.decisionReason
  return (
    findSafetyCheckDecision(reason, check => !check.classifierApprovable) !==
    undefined
  )
}

/** densable vgy — walker only when behavior === "ask". */
export function isAskGatedClassifierNotApprovable(
  permissionResult: unknown,
): boolean {
  const result = permissionResult as {
    behavior?: string
    decisionReason?: PermissionDecisionReason
  } | null
  if (result?.behavior !== 'ask') return false
  return (
    findSafetyCheckDecision(
      result.decisionReason,
      check => !check.classifierApprovable,
    ) !== undefined
  )
}
