/**
 * densable nHt vs tip PromptInput hide.
 *
 * Gold nHt = `open.some(d => !i_y.has(d.kind))` — see `useHasBlockingOpenDialogs`
 * (permission / managed_settings count; used for yMe / hasSuppressedDialogs).
 *
 * Gold nP hides PromptInput when WO (engine dialog) is open and not typing,
 * or when userInvoked T5. Permission Ask is engine-opened → hide PromptInput
 * so DualInk Select owns Esc (draft stays in the store). Soft i_y never hides.
 *
 * Predicate scans the whole open stack (not just top) so soft-on-blocking
 * still hides the prompt.
 */
import type { HostParkMode } from './hostPark.js'
import { isSoftNmsDialogKind } from './specs/jsuKinds.js'

/** Kind that should hide PromptInput while Host is visible (not soft i_y). */
export function isHardPromptBlockingDialogKind(
  kind: string | undefined,
): boolean {
  if (!kind) return false
  if (isSoftNmsDialogKind(kind)) return false
  return true
}

/**
 * True when any open dialog should hide PromptInput.
 * Prefer this over top-only checks (soft covering a peer must still hide).
 *
 * When `parkedOrMode` indicates the Host is parked (`true` or a non-null
 * `HostParkMode`, e.g. `'draft'` / `'typing'`), returns `false` so PromptInput
 * stays mounted and editable while the dialog waits for the user to send or
 * clear their draft (breaks the draft↔hard-dialog deadlock).
 */
export function nhtHidesPromptInput(
  openOrTop: string | undefined | null | ReadonlyArray<{ kind: string }>,
  parkedOrMode: boolean | HostParkMode = false,
): boolean {
  const isParked =
    typeof parkedOrMode === 'boolean' ? parkedOrMode : parkedOrMode !== null
  if (isParked) return false
  if (openOrTop == null) return false
  if (typeof openOrTop === 'string') {
    return isHardPromptBlockingDialogKind(openOrTop)
  }
  return openOrTop.some(d => isHardPromptBlockingDialogKind(d.kind))
}
