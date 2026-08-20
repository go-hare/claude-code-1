/**
 * densable 2.1.235 #12 — central showAlwaysAllow gate (≈ SEA `cNr` consumers).
 *
 * Gold:
 *   showAlwaysAllow:
 *     cNr() &&
 *     !(permissionResult.behavior === "ask" &&
 *       permissionResult.suppressAlwaysAllowRule === !0) &&
 *     tool.suppressesAlwaysAllowRule?.(input) !== !0
 *
 * Callers supply `baseAllowed` (typically `shouldShowAlwaysAllowOptions()` and
 * any host-specific extras like non-empty hostname). Org ask-ceiling
 * (`isAskCappedByOrg`) may be folded into baseAllowed or passed explicitly.
 */

export type ShowPersistentAllowPermissionResult = {
  behavior?: string
  suppressAlwaysAllowRule?: boolean
}

export type ShowPersistentAllowTool = {
  // Tool.suppressesAlwaysAllowRule is typed on the tool's zod input; hosts pass
  // Tool objects, so accept any input arity/contravariance here.
  suppressesAlwaysAllowRule?: (input: never) => boolean
}

export function shouldShowPersistentAllowOption({
  baseAllowed,
  permissionResult,
  tool,
  input,
  isAskCappedByOrg = false,
}: {
  baseAllowed: boolean
  permissionResult?: ShowPersistentAllowPermissionResult
  tool?: ShowPersistentAllowTool
  input?: unknown
  isAskCappedByOrg?: boolean
}): boolean {
  if (!baseAllowed || isAskCappedByOrg) {
    return false
  }
  if (
    permissionResult?.behavior === 'ask' &&
    permissionResult.suppressAlwaysAllowRule === true
  ) {
    return false
  }
  if (tool?.suppressesAlwaysAllowRule?.(input as never) === true) {
    return false
  }
  return true
}
