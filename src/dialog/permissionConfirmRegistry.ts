/**
 * Tip bridge: ToolUseConfirm lives outside DialogStore payload (callbacks).
 * densable keeps resolve in doo(); tip keeps confirm in this registry keyed by
 * toolUseID / requestId (permission_prompt payload.requestId).
 */
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import { getBootstrapSession, RootSessionSlot } from '../utils/sessionRoot.js'

const confirmsBySession = new RootSessionSlot<Map<string, ToolUseConfirm>>(
  () => new Map(),
)

function getConfirms(): Map<string, ToolUseConfirm> {
  return confirmsBySession.of(getBootstrapSession())
}

export function registerPermissionConfirm(item: ToolUseConfirm): void {
  getConfirms().set(item.toolUseID, item)
}

export function unregisterPermissionConfirm(toolUseID: string): void {
  getConfirms().delete(toolUseID)
}

export function getPermissionConfirm(
  toolUseID: string,
): ToolUseConfirm | undefined {
  return getConfirms().get(toolUseID)
}

export function clearPermissionConfirms(): void {
  getConfirms().clear()
}

/** @deprecated tests — prefer clearPermissionConfirms */
export function clearPermissionConfirmsForTests(): void {
  clearPermissionConfirms()
}
