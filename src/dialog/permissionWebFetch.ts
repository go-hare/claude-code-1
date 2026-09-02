/**
 * densable csu / Ryy / Hyy / Iyy.
 *
 * Gold 2.1.239: jsu `vM(Uno,csu)`. Esc/onCancel → `{behavior:"cancelled"}`.
 * Hyy does NOT require `behavior==="ask"` (unlike chrome Nmy).
 * Iyy addRules `domain:${hostname}` destination localSettings.
 * Do not dequeue (doo W() already removeFromQueue). Do not invent dh.
 */
import type { PermissionUpdate } from '../types/permissions.js'
import { sanitizeHostDisplay } from './permissionBrowser.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'
import type { PermissionPromptResult } from './specs/permissionKinds.js'

export type WebFetchPermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  hostname: string
  input?: unknown
  description?: string
  showAlwaysAllow?: boolean
  isAskCappedByOrg?: boolean
  requestSource?: PermissionRequestSource
}

export type WebFetchDomainAllowRow = {
  display: string
  applies: PermissionUpdate[]
}

export type WebFetchPermissionChoice =
  | 'yes'
  | 'yes-dont-ask-again-domain'
  | 'no'

function isValidAllowRow(row: WebFetchDomainAllowRow | null): boolean {
  return row !== null && Array.isArray(row.applies) && row.applies.length > 0
}

/** densable Hyy — no behavior==="ask" gate. */
export function shouldShowWebFetchDomainAllow(
  payload: WebFetchPermissionPayload,
): boolean {
  const result = payload.permissionResult as {
    decisionReason?: { type?: string; classifierApprovable?: boolean }
  } | null
  const reason = result?.decisionReason
  const blocked = reason?.type === 'safetyCheck' && !reason.classifierApprovable
  return (
    payload.showAlwaysAllow === true &&
    !blocked &&
    payload.isAskCappedByOrg !== true &&
    payload.hostname !== '' &&
    !payload.hostname.includes('*')
  )
}

/** densable Iyy */
export function buildWebFetchDomainAllowRow(
  payload: WebFetchPermissionPayload,
): WebFetchDomainAllowRow | null {
  const hostname = payload.hostname
  if (typeof hostname !== 'string' || hostname === '') return null
  const sanitized = sanitizeHostDisplay(hostname)
  if (sanitized === null) return null
  return {
    display: sanitized.display,
    applies: [
      {
        type: 'addRules',
        rules: [
          {
            toolName: payload.toolName,
            ruleContent: `domain:${hostname}`,
          },
        ],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
  }
}

/** densable Ryy */
export function resolveWebFetchPermissionAnswer(
  choice: WebFetchPermissionChoice,
  payload: WebFetchPermissionPayload,
  row: WebFetchDomainAllowRow | null,
): PermissionPromptResult {
  switch (choice) {
    case 'yes':
      return { behavior: 'allow', updatedInput: payload.input }
    case 'yes-dont-ask-again-domain':
      if (!isValidAllowRow(row)) {
        return { behavior: 'allow', updatedInput: payload.input }
      }
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        permissionUpdates: row!.applies,
      }
    case 'no':
      return { behavior: 'deny' }
  }
}
