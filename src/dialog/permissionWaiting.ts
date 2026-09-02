/**
 * densable waitingFor / y2A — Host open-stack status text.
 *
 * Gold (239 SEA y2A):
 *   v4t ask → "input needed"
 *   FRr sandbox → "sandbox request"
 *   Gbt mcp_url_elicitation → "input needed"
 *   $ne / tbt → "dialog open"
 *   Dot goal → "goal proposal"
 *   Wxt/Gxt/GSn/qSn/CHr → "dialog open"
 * Other permission_* → densable P1u `approve …` via formatPermissionNeeds.
 */
import { formatPermissionNeeds } from '../utils/bgNeedsInputBridge.js'
import { getPermissionConfirm } from './permissionConfirmRegistry.js'
import { MANAGED_SETTINGS_SECURITY_KIND } from './specs/managedSettingsSecurity.js'
import {
  FABLE_OVERAGE_CONSENT_PROMPT_KIND,
  GOAL_PROPOSAL_KIND,
  MCP_URL_ELICITATION_KIND,
  REFUSAL_FALLBACK_PROMPT_KIND,
  SANDBOX_NETWORK_ACCESS_KIND,
  isSoftNmsDialogKind,
} from './specs/jsuKinds.js'
import {
  PERMISSION_ASK_USER_QUESTION_KIND,
  isPermissionDialogKind,
} from './specs/permissionKinds.js'

type PermissionPayload = {
  requestId?: string
  toolName?: string
  userFacingName?: string
  input?: unknown
}

/** densable y2A exact strings for Host kinds that are not P1u `approve …`. */
export const GOLD_Y2A_WAITING: Readonly<Record<string, string>> = {
  [PERMISSION_ASK_USER_QUESTION_KIND]: 'input needed',
  [SANDBOX_NETWORK_ACCESS_KIND]: 'sandbox request',
  [MCP_URL_ELICITATION_KIND]: 'input needed',
  [REFUSAL_FALLBACK_PROMPT_KIND]: 'dialog open',
  [FABLE_OVERAGE_CONSENT_PROMPT_KIND]: 'dialog open',
  [GOAL_PROPOSAL_KIND]: 'goal proposal',
}

function formatP1uFromPayload(payload: unknown): string {
  const p = (payload ?? {}) as PermissionPayload
  const confirm = p.requestId ? getPermissionConfirm(p.requestId) : undefined
  if (confirm) {
    let userFacingName: string | undefined
    try {
      userFacingName = confirm.tool.userFacingName?.(confirm.input as never)
    } catch {
      userFacingName = undefined
    }
    return formatPermissionNeeds({
      toolName: confirm.tool.name,
      userFacingName,
      input: (confirm.input ?? null) as Record<string, unknown> | null,
    })
  }
  if (!p.toolName) return 'input needed'
  return formatPermissionNeeds({
    toolName: p.toolName,
    userFacingName: p.userFacingName,
    input: (p.input ?? null) as Record<string, unknown> | null,
  })
}

/**
 * Resolve densable waitingFor from Host top kind/payload.
 * Returns undefined when kind is not a Host-owned waiting surface.
 */
export function resolveHostWaitingFor(
  kind: string | undefined,
  payload: unknown,
): string | undefined {
  if (!kind) return undefined
  const y2a = GOLD_Y2A_WAITING[kind]
  if (y2a) return y2a
  if (kind === MANAGED_SETTINGS_SECURITY_KIND || isSoftNmsDialogKind(kind)) {
    return 'dialog open'
  }
  if (isPermissionDialogKind(kind)) {
    return formatP1uFromPayload(payload)
  }
  return undefined
}

/** @deprecated use resolveHostWaitingFor — kept for call-site rename */
export function resolveHostPermissionWaitingFor(
  kind: string | undefined,
  payload: unknown,
): string | undefined {
  return resolveHostWaitingFor(kind, payload)
}
