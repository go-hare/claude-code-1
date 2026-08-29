/**
 * densable nHt vs tip PromptInput hide.
 *
 * Gold nHt = `open.some(d => !i_y.has(d.kind))` — see `useHasBlockingOpenDialogs`
 * (permission / managed_settings count; used for yMe / hasSuppressedDialogs).
 *
 * PromptInput hide is NOT gold nHt: permission_* / managed_settings keep the
 * draft via zIr / focused paths. Soft i_y never hides. Other open kinds
 * (FRr / UOo / Gbt / …) hide the prompt so Select owns Esc.
 *
 * Predicate scans the whole open stack (not just top) so soft-on-blocking
 * still hides the prompt.
 */
import { MANAGED_SETTINGS_SECURITY_KIND } from './specs/managedSettingsSecurity.js'
import { isSoftNmsDialogKind } from './specs/jsuKinds.js'
import { isPermissionDialogKind } from './specs/permissionKinds.js'

/** Kind that should hide PromptInput while Host is visible (not soft / not zIr Host). */
export function isHardPromptBlockingDialogKind(
  kind: string | undefined,
): boolean {
  if (!kind) return false
  if (isSoftNmsDialogKind(kind)) return false
  if (isPermissionDialogKind(kind)) return false
  if (kind === MANAGED_SETTINGS_SECURITY_KIND) return false
  return true
}

/**
 * True when any open dialog should hide PromptInput.
 * Prefer this over top-only checks (soft covering a peer must still hide).
 */
export function nhtHidesPromptInput(
  openOrTop: string | undefined | null | ReadonlyArray<{ kind: string }>,
): boolean {
  if (openOrTop == null) return false
  if (typeof openOrTop === 'string') {
    return isHardPromptBlockingDialogKind(openOrTop)
  }
  return openOrTop.some(d => isHardPromptBlockingDialogKind(d.kind))
}
