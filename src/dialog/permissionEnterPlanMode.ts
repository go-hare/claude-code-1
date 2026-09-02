/**
 * densable Ynu / rhy / PYe("plan") analog.
 *
 * Gold 2.1.239: jsu `vM(xno,Ynu)`. Yes mints setMode session.
 * Cancel / no → deny (not cancelled). Do not dequeue (doo W() already
 * removeFromQueue). tengu_plan_enter only `{entryMethod:"tool"}`.
 * No PYe token — always mint the setMode row so Yes cannot starve to deny.
 */
import type { PermissionUpdate } from '../types/permissions.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'
import type { PermissionPromptResult } from './specs/permissionKinds.js'

export const ENTER_PLAN_MODE_CONFIRM_LABEL = 'Yes, enter plan mode'
export const ENTER_PLAN_MODE_CANCEL_LABEL = 'No, start implementing now'

export type EnterPlanModePermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  requestSource?: PermissionRequestSource
}

export type EnterPlanModeConsentRow = {
  label: string
  applies: PermissionUpdate[]
}

export type EnterPlanModeChoice = 'yes' | 'no'

/** densable PYe("plan") without plan-keep-context — Ynu confirm fallback. */
export function mintEnterPlanModeRow(): EnterPlanModeConsentRow {
  return {
    label: ENTER_PLAN_MODE_CONFIRM_LABEL,
    applies: [{ type: 'setMode', mode: 'plan', destination: 'session' }],
  }
}

function isValidConsentRow(row: EnterPlanModeConsentRow | null): boolean {
  return row !== null && Array.isArray(row.applies) && row.applies.length > 0
}

/** densable rhy */
export function resolveEnterPlanModeAnswer(
  choice: EnterPlanModeChoice,
  row: EnterPlanModeConsentRow | null,
): PermissionPromptResult {
  switch (choice) {
    case 'yes': {
      if (row === null || !isValidConsentRow(row)) {
        return { behavior: 'deny' }
      }
      return {
        behavior: 'allow',
        updatedInput: {},
        permissionUpdates: row.applies,
      }
    }
    case 'no':
      return { behavior: 'deny' }
  }
}
