/**
 * densable 2.1.216 control-character gate for tool inputs shown in approval
 * dialogs (`XAu` / `r0e` / `K_` → SEA 2.1.223 `xRd` / `eHe` / `Jg`·`DRd`).
 *
 * densable 2.1.223 #5 — permission prompts must not hide TAB padding or
 * invisible Unicode (bidi / zero-width / BOM) from the approval dialog.
 *
 * SEA anchors (2.1.223):
 * - `xRd` — C0/C1 except TAB/LF (schema gate only)
 * - `eHe` — refine: no xRd code units
 * - `IRd` — bidi / ALM (display-only)
 * - `Jg`/`DRd` — display: xRd || IRd || lone surrogate → U+FFFD
 * - Schema still allows TAB/LF; display maps TAB → `⇥` so padding cannot
 *   collapse away part of the command in the terminal UI.
 */

/** densable `Wjg` / `Ya_` / `hyy` / `aRy` / `Rvb` — schema refine failure. */
export const CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG =
  'command contains control characters that would be hidden in the approval dialog'

/** densable `bS_` / `gvb` — workflow script field. */
export const SCRIPT_CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG =
  'script contains control characters that would be hidden in the approval dialog'

/**
 * densable `xRd` — true when code unit is a hidden C0/C1 control (not TAB/LF).
 * Schema refine (`eHe` / `hasNoHiddenControlChars`) uses only this.
 */
export function isHiddenControlCode(code: number): boolean {
  if (code === 9 || code === 10) return false
  return code < 32 || (code >= 127 && code <= 159)
}

/**
 * densable `IRd` — bidi / Arabic letter mark that can reverse or hide text
 * in terminal approval UI.
 * Code units:
 * - U+061C Arabic letter mark (1564)
 * - U+202A–U+202E bidi embeddings/overrides (8234–8238)
 * - U+2066–U+2069 bidi isolates (8294–8297)
 */
export function isBidiControlCode(code: number): boolean {
  if (code === 0x061c) return true
  if (code >= 0x202a && code <= 0x202e) return true
  if (code >= 0x2066 && code <= 0x2069) return true
  return false
}

/**
 * densable 2.1.223 #5 — zero-width / format that collapses in UI (beyond IRd).
 * densable full path also runs grapheme-width sanitize (`kRd`/`RRd`); we map
 * the common zero-width set explicitly for display.
 * - U+200B–U+200F ZWSP/ZWNJ/ZWJ/LRM/RLM
 * - U+2060 word joiner
 * - U+FEFF BOM / ZWNBSP
 */
export function isInvisibleFormatCode(code: number): boolean {
  if (code >= 0x200b && code <= 0x200f) return true
  if (code === 0x2060) return true
  if (code === 0xfeff) return true
  return false
}

/**
 * densable `tgy` subset — lone UTF-16 surrogates (invalid text).
 */
export function isLoneSurrogateCode(code: number): boolean {
  return code >= 0xd800 && code <= 0xdfff
}

/**
 * Code unit that must be replaced for safe approval-dialog display
 * (densable `DRd` + 223 #5 TAB visibility).
 * TAB is included for *display* replacement only — schema still allows it.
 */
export function isApprovalHidingCode(code: number): boolean {
  if (code === 10) return false // LF stays for multi-line commands
  if (code === 9) return true // TAB — visible ⇥ in dialog
  return (
    isHiddenControlCode(code) ||
    isBidiControlCode(code) ||
    isInvisibleFormatCode(code) ||
    isLoneSurrogateCode(code)
  )
}

/**
 * densable `eHe` / `r0e` — true when string has no C0/C1 hidden controls.
 * TAB and LF remain allowed (shell-legitimate). Bidi / zero-width are NOT
 * schema-rejected (densable only sanitizes them on display via `Jg`).
 */
export function hasNoHiddenControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (isHiddenControlCode(value.charCodeAt(i))) return false
  }
  return true
}

/**
 * densable `Jg`/`DRd` + 2.1.223 #5 — replace approval-hiding chars for display.
 * SEA walks `for (const o of e)` + `codePointAt(0)` so paired surrogates
 * (emoji / non-BMP) stay intact; only true lone surrogates hit `tgy`.
 * - Hidden C0/C1, bidi, zero-width format, lone surrogates → U+FFFD
 * - TAB → visible `⇥` so padding cannot hide the rest of the command
 * - LF preserved
 */
export function replaceHiddenControlChars(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0)!
    if (code === 9) {
      out += '⇥'
      continue
    }
    out += isApprovalHidingCode(code) ? '�' : ch
  }
  return out
}
