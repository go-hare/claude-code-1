/**
 * densable 2.1.216 control-character gate for tool inputs shown in approval
 * dialogs (`XAu` / `r0e` / `K_`).
 *
 * Blocks C0 (except TAB/LF) and C1 controls so nulls, CR, DEL, and other
 * non-printing code units cannot hide metacharacters from the permission UI.
 * Non-ASCII text (CJK, accents, …) is allowed — those code points are > 0x9F.
 */

/** densable `Wjg` / `Ya_` / `LS_` — schema refine failure message. */
export const CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG =
  'command contains control characters that would be hidden in the approval dialog'

/** densable `bS_` — workflow script field. */
export const SCRIPT_CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG =
  'script contains control characters that would be hidden in the approval dialog'

/** densable `XAu` — true when code unit is a hidden control (not TAB/LF). */
export function isHiddenControlCode(code: number): boolean {
  if (code === 9 || code === 10) return false
  return code < 32 || (code >= 127 && code <= 159)
}

/** densable `r0e` — true when string has no hidden control code units. */
export function hasNoHiddenControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (isHiddenControlCode(value.charCodeAt(i))) return false
  }
  return true
}

/** densable `K_` — replace hidden controls with U+FFFD for safe display. */
export function replaceHiddenControlChars(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    out += isHiddenControlCode(ch.charCodeAt(0)) ? '\uFFFD' : ch
  }
  return out
}
