/**
 * Tip bridge: ToolUseConfirm lives outside DialogStore payload (callbacks).
 * densable keeps resolve in doo(); tip keeps confirm in this registry keyed by
 * toolUseID / requestId (permission_prompt payload.requestId).
 */
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'

const confirms = new Map<string, ToolUseConfirm>()

export function registerPermissionConfirm(item: ToolUseConfirm): void {
  confirms.set(item.toolUseID, item)
}

export function unregisterPermissionConfirm(toolUseID: string): void {
  confirms.delete(toolUseID)
}

export function getPermissionConfirm(
  toolUseID: string,
): ToolUseConfirm | undefined {
  return confirms.get(toolUseID)
}

export function clearPermissionConfirms(): void {
  confirms.clear()
}

/** @deprecated tests — prefer clearPermissionConfirms */
export function clearPermissionConfirmsForTests(): void {
  clearPermissionConfirms()
}
