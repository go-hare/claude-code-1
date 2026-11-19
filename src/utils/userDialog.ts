/**
 * Official request_user_dialog densables (W1n / xbo / vje / cJr / Evf / iSf).
 *
 * Full StructuredIO.requestUserDialog consumer + dialog-kind registry remain
 * denser in structuredIO / print; this densifies pure helpers.
 */

import type { RequiresActionDetails } from './sessionState.js'
import { resolveUserDialogTimeoutMsOrDefault } from './residualMsEnvGates.js'

/** Official MAX_DECLARED_DIALOG_KINDS (cJr). */
export const MAX_DECLARED_DIALOG_KINDS = 32

/** Official default action copy for known dialog kinds (KDy + 2.1.323 #2112). */
export const DEFAULT_DIALOG_ACTION_DESCRIPTIONS: Readonly<
  Record<string, string>
> = {
  refusal_fallback_prompt: 'choose: retry on fallback model or edit prompt',
  fable_overage_consent_prompt:
    'choose: continue Fable 5 on usage credits or switch models',
  auto_mode_server_fallback:
    'acknowledge the classifier billing notice (Enter continues in auto mode)',
  auto_mode_outside_reads:
    'choose: keep allowing reads outside the working directories, or block them',
}

export type UserDialogResponseBehavior = 'completed' | 'cancelled'

export type UserDialogResponse = {
  behavior: UserDialogResponseBehavior
  /** Dialog-specific result; opaque to the protocol. */
  result?: unknown
}

export type DeclaredDialogKindsSource = 'initialize' | 'restored' | string

/**
 * Official vje — sanitize declared dialog kinds (non-empty strings ≤64, max 32).
 */
export function sanitizeDeclaredDialogKinds(
  kinds: unknown,
  max = MAX_DECLARED_DIALOG_KINDS,
): string[] {
  if (!Array.isArray(kinds)) return []
  return kinds
    .filter(
      (k): k is string =>
        typeof k === 'string' && k.length > 0 && k.length <= 64,
    )
    .slice(0, max)
}

/**
 * Official xbo — pending_action details for a parked user dialog.
 */
export function buildUserDialogRequiresActionDetails(
  dialogKind: string,
  payload: unknown,
  requestId: string,
  toolUseId?: string | null,
): RequiresActionDetails {
  const action =
    DEFAULT_DIALOG_ACTION_DESCRIPTIONS[dialogKind] ??
    `Respond to the ${dialogKind} dialog to continue`
  return {
    tool_name: `dialog:${dialogKind}`,
    display_tool_name: 'Claude needs your input',
    action_description: action,
    tool_use_id: toolUseId ?? '',
    request_id: requestId,
    input: {
      dialog_kind: dialogKind,
      payload,
    },
  }
}

/**
 * Official W1n consumer — resolve timeout for request_user_dialog park.
 * 0 / negative → no timer (official `if(i>0)`).
 */
export function resolveUserDialogParkTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolveUserDialogTimeoutMsOrDefault(env)
}

/**
 * Official Evf deriveParkedPermission densable.
 * Returns parked permission request ids when resume-interrupted-turn is on
 * and pending_action is a non-dialog permission with a known tool_use_id.
 */
export function deriveParkedPermission(input: {
  resumeInterruptedTurn: boolean
  pendingAction: RequiresActionDetails | null | undefined
  /** e.g. restored worker kind; "none" skips. */
  restoreKind?: string | null
  knownToolUseIds?: ReadonlySet<string> | null
}): { request_id: string; tool_use_id: string } | undefined {
  if (!input.resumeInterruptedTurn) return undefined
  if (!input.restoreKind || input.restoreKind === 'none') return undefined
  const n = input.pendingAction
  if (!n?.request_id || !n.tool_use_id) return undefined
  if (n.tool_name?.startsWith('dialog:')) return undefined
  if (input.knownToolUseIds && !input.knownToolUseIds.has(n.tool_use_id)) {
    return undefined
  }
  return { request_id: n.request_id, tool_use_id: n.tool_use_id }
}

export type ParkedPermissionIds = {
  request_id: string
  tool_use_id: string
}

/**
 * Official Svf parked-permission resume plan densable.
 * When resume-interrupted is on and Evf yields parked ids, wait
 * PARKED_PERMISSION_WAIT_MS (default 2s) for a late control_response before
 * continuing. Pure plan — host supplies wait/answer callbacks.
 */
export function planParkedPermissionResume(input: {
  resumeInterruptedTurn: boolean
  pendingAction: RequiresActionDetails | null | undefined
  restoreKind?: string | null
  knownToolUseIds?: ReadonlySet<string> | null
  env?: NodeJS.ProcessEnv
}):
  | { wait: false; reason: string }
  | { wait: true; parked: ParkedPermissionIds; waitMs: number } {
  const parked = deriveParkedPermission({
    resumeInterruptedTurn: input.resumeInterruptedTurn,
    pendingAction: input.pendingAction,
    restoreKind: input.restoreKind,
    knownToolUseIds: input.knownToolUseIds,
  })
  if (!parked) {
    return { wait: false, reason: 'no_parked_permission' }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveParkedPermissionWaitMsOrDefault } =
    require('./residualMsEnvGates.js') as typeof import('./residualMsEnvGates.js')
  const waitMs = resolveParkedPermissionWaitMsOrDefault(input.env)
  return { wait: true, parked, waitMs }
}

/**
 * Official Svf wait densable — race a host answer promise against waitMs.
 * Returns the answer if it arrives in time, else null (resume continues).
 * Never throws.
 */
export async function waitForParkedPermissionAnswer<T>(input: {
  waitMs: number
  /** Resolves when host delivers the parked permission answer. */
  answer: Promise<T>
  /** Optional sleep inject for tests. */
  sleep?: (ms: number) => Promise<void>
}): Promise<T | null> {
  const sleep =
    input.sleep ??
    ((ms: number) =>
      new Promise<void>(resolve => {
        const t = setTimeout(resolve, ms)
        t.unref?.()
      }))
  if (!(input.waitMs > 0)) {
    // 0 wait: still race once so an already-resolved answer wins.
    try {
      return await Promise.race([
        input.answer,
        Promise.resolve(null as T | null),
      ])
    } catch {
      return null
    }
  }
  try {
    return await Promise.race([
      input.answer.then(v => v).catch(() => null as T | null),
      sleep(input.waitMs).then(() => null as T | null),
    ])
  } catch {
    return null
  }
}

function parseMcpPermissionToolName(
  toolName: string,
): { serverName: string; toolName: string } | undefined {
  if (!toolName.startsWith('mcp__')) return undefined
  const parts = toolName.split('__')
  if (parts.length < 3) return undefined
  const serverName = parts[1]
  const mcpToolName = parts.slice(2).join('__')
  if (!serverName || !mcpToolName) return undefined
  return { serverName, toolName: mcpToolName }
}

function titleCaseMcpPart(part: string): string {
  return part
    .replace(/_+/g, ' ')
    .trim()
    .replace(/\b\w/g, ch => ch.toUpperCase())
}

/** SEA `kGr` (2.1.295 #445) — format an MCP server + tool name as `server — Tool Name`. */
export function formatMcpPermissionDisplayName(
  serverName: string,
  toolName: string,
): string {
  const server = serverName.trim() || '(unnamed server)'
  const formattedTool =
    titleCaseMcpPart(toolName) || toolName.trim() || '(unnamed tool)'
  return `${server} \u2014 ${formattedTool}`.replace(/\s+/g, ' ').trim()
}

/** Official post_turn_summary copy for dialog-blocked sessions. */
export function buildUserDialogBlockedSummary(details: RequiresActionDetails): {
  status_category: 'blocked'
  status_detail: string
  needs_action: string
} {
  if (details.tool_name.startsWith('dialog:')) {
    return {
      status_category: 'blocked',
      status_detail: 'Waiting on a user dialog',
      needs_action: details.action_description,
    }
  }
  const parsed = parseMcpPermissionToolName(details.tool_name)
  const label =
    !parsed || parsed.serverName === 'claude-in-chrome'
      ? details.tool_name
      : formatMcpPermissionDisplayName(parsed.serverName, parsed.toolName)
  return {
    status_category: 'blocked',
    status_detail: `Waiting on permission: ${label}`,
    needs_action: `Approve or deny ${label}`,
  }
}
