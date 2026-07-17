import {
  nonAlphanumericKeys,
  type ParsedKey,
  unicodeFromExtendedKeySequence,
} from '../parse-keypress.js'
import { Event } from './event.js'

export type Key = {
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  pageDown: boolean
  pageUp: boolean
  wheelUp: boolean
  wheelDown: boolean
  home: boolean
  end: boolean
  return: boolean
  escape: boolean
  ctrl: boolean
  shift: boolean
  fn: boolean
  tab: boolean
  backspace: boolean
  delete: boolean
  meta: boolean
  super: boolean
}

function parseKey(keypress: ParsedKey): [Key, string] {
  const key: Key = {
    upArrow: keypress.name === 'up',
    downArrow: keypress.name === 'down',
    leftArrow: keypress.name === 'left',
    rightArrow: keypress.name === 'right',
    pageDown: keypress.name === 'pagedown',
    pageUp: keypress.name === 'pageup',
    wheelUp: keypress.name === 'wheelup',
    wheelDown: keypress.name === 'wheeldown',
    home: keypress.name === 'home',
    end: keypress.name === 'end',
    // Official densable sji (2.1.210): only name "return" sets key.return.
    // Bare \n is named "enter" and yields input "\n" (multiline insert), not submit.
    return: keypress.name === 'return',
    escape: keypress.name === 'escape',
    fn: keypress.fn,
    ctrl: keypress.ctrl,
    shift: keypress.shift,
    tab: keypress.name === 'tab',
    backspace: keypress.name === 'backspace',
    delete: keypress.name === 'delete',
    // `parseKeypress` parses \u001B\u001B[A (meta + up arrow) as meta = false
    // but with option = true, so we need to take this into account here
    // to avoid breaking changes in Ink.
    // TODO(vadimdemedes): consider removing this in the next major version.
    meta: keypress.meta || keypress.name === 'escape' || keypress.option,
    // Super (Cmd on macOS / Win key) — only arrives via kitty keyboard
    // protocol CSI u sequences. Distinct from meta (Alt/Option) so
    // bindings like cmd+c can be expressed separately from opt+c.
    super: keypress.super,
  }

  // Official lag: wheel/mouse never become text insert. Keybindings still
  // see key.wheelUp/wheelDown; only the character payload is suppressed.
  if (
    keypress.name === 'wheelup' ||
    keypress.name === 'wheeldown' ||
    keypress.name === 'mouse'
  ) {
    return [key, '']
  }

  // Official densable sji: name==="enter" → input "\n" (not submit).
  if (keypress.name === 'enter') {
    return [key, '\n']
  }

  let input = keypress.ctrl ? keypress.name : keypress.sequence

  // Handle undefined input case
  if (input === undefined) {
    input = ''
  }

  // When ctrl is set, keypress.name for space is the literal word "space".
  // Convert to actual space character for consistency with the CSI u branch
  // (which maps 'space' → ' '). Without this, ctrl+space leaks the literal
  // word "space" into text input.
  if (keypress.ctrl && input === 'space') {
    input = ' '
  }

  // Suppress unrecognized escape sequences that were parsed as function keys
  // (matched by FN_KEY_RE) but have no name in the keyName map.
  // Examples: ESC[25~ (F13/Right Alt on Windows), ESC[26~ (F14), etc.
  // Without this, the ESC prefix is stripped below and the remainder (e.g.,
  // "[25~") leaks into the input as literal text.
  if (keypress.code && !keypress.name) {
    input = ''
  }

  // Strip ESC prefix(es). Official fag sees post-tokenizer sequences;
  // ESC-prefixed nameless CSI is swallowed via charCodeAt(0)===27.
  // TODO(vadimdemedes): remove ESC strip in the next major version.
  while (input.startsWith('\u001B')) {
    input = input.slice(1)
  }

  // Official fag: pure orphan SGR burst → "".
  //   /^(\[<\d[\d;]*[Mm]?)+$/
  // No invented 2-param / 3-param / M{2,} residual sinks here — those are
  // covered by official sji below ([...input].length === 1 only).
  if (!keypress.name && /^(\[<\d[\d;]*[Mm]?)+$/.test(input)) {
    input = ''
  }

  // Track whether we've already processed this as a special sequence
  // that converted input to the key name (CSI u or application keypad mode).
  // For these, we don't want to clear input with nonAlphanumericKeys check.
  let processedAsSpecialSequence = false

  // Handle CSI u sequences (Kitty keyboard protocol): after stripping ESC,
  // we're left with "[codepoint;modifieru" (e.g., "[98;3u" for Alt+b).
  // Use the parsed key name instead for input handling. Require a digit
  // after [ — real CSI u is always [<digits>…u, and a bare startsWith('[')
  // false-matches X10 mouse at row 85 (Cy = 85+32 = 'u'), leaking the
  // literal text "mouse" into the prompt via processedAsSpecialSequence.
  // Also accept progressive-enhancement params with ":" (e.g. "[58:65306;2u").
  //
  // Official 2.1.210: VXc does not name codepoints past the surrogate block
  // (so U+FF1A fullwidth colon has empty name), and fag() then swallows
  // ESC-prefixed nameless sequences as "". Recovery for paste uses sig
  // (fromCodePoint any ≤0x10FFFF). Live IME paths that emit ESC[65306u
  // therefore need empty-name recovery here — which is what we do — while
  // named printable Unicode (our keycodeToName extension) still inserts.
  if (/^\[\d/.test(input) && input.endsWith('u')) {
    if (!keypress.name) {
      // Prefer recovering printable Unicode (CJK / fullwidth punct via IME)
      // from the CSI u codepoint. Only swallow true unmapped functional keys
      // (Caps Lock 57358, F13–F35, KP nav, bare modifiers, etc.) so the raw
      // "[57358u" doesn't leak into the prompt. See #38781.
      // Use the original sequence (with ESC) for the regex match.
      // Release events (mods:3) return undefined from the helper → empty.
      input =
        unicodeFromExtendedKeySequence(keypress.sequence ?? keypress.raw) ?? ''
    } else {
      // Prefer text recovered from progressive CSI u (shifted/text fields)
      // when the primary name is a bare ASCII printable and the IME produced
      // a different fullwidth/CJK character (ESC[58:65306;2u → name ":" but
      // text is "："). Functional multi-char names always win for bindings.
      const recovered = unicodeFromExtendedKeySequence(
        keypress.sequence ?? keypress.raw,
      )
      if (
        recovered &&
        recovered !== keypress.name &&
        keypress.name.length === 1 &&
        keypress.name >= ' ' &&
        keypress.name <= '~' &&
        !nonAlphanumericKeys.includes(keypress.name)
      ) {
        input = recovered
      } else {
        // processedAsSpecialSequence bypasses nonAlphanumericKeys below, so
        // functional multi-char names must be cleared here (return/tab/escape/
        // backspace would otherwise leak as literal text). space → ' '.
        // Single-char / Unicode printable names pass through for insertion.
        input =
          keypress.name === 'space'
            ? ' '
            : nonAlphanumericKeys.includes(keypress.name)
              ? ''
              : keypress.name
      }
    }
    processedAsSpecialSequence = true
  }

  // Handle xterm modifyOtherKeys sequences: after stripping ESC, we're left
  // with "[27;modifier;keycode~" (e.g., "[27;3;98~" for Alt+b). Same
  // extraction as CSI u — without this, printable-char keycodes (single-letter
  // names) skip the nonAlphanumericKeys clear and leak "[27;..." as input.
  if (input.startsWith('[27;') && input.endsWith('~')) {
    if (!keypress.name) {
      // Recover printable Unicode codepoints; swallow true unmapped keys.
      input =
        unicodeFromExtendedKeySequence(keypress.sequence ?? keypress.raw) ?? ''
    } else {
      input =
        keypress.name === 'space'
          ? ' '
          : nonAlphanumericKeys.includes(keypress.name)
            ? ''
            : keypress.name
    }
    processedAsSpecialSequence = true
  }

  // Handle application keypad mode sequences: after stripping ESC,
  // we're left with "O<letter>" (e.g., "Op" for numpad 0, "Oy" for numpad 9).
  // Use the parsed key name (the digit character) for input handling.
  if (
    input.startsWith('O') &&
    input.length === 2 &&
    keypress.name &&
    keypress.name.length === 1
  ) {
    input = keypress.name
    processedAsSpecialSequence = true
  }

  // Clear input for non-alphanumeric keys (arrows, function keys, etc.)
  // Skip this for CSI u and application keypad mode sequences since
  // those were already converted to their proper input characters.
  if (
    !processedAsSpecialSequence &&
    keypress.name &&
    nonAlphanumericKeys.includes(keypress.name)
  ) {
    input = ''
  }

  // Official densable fag (2.1.210): nameless ESC-prefixed sequences produce
  // no key text (`seq.charCodeAt(0)===0x1b → ""`). KeyboardEvent already does
  // this, but InputEvent historically strips ESC and keeps the residue — so a
  // 50ms incomplete-CSI flush of "\x1b[" becomes a single typed "[" (live
  // "[[[[[[[[[[" during collapse-scroll). After CSI u / modifyOtherKeys /
  // keypad recovery above, any remaining nameless ESC-origin residue must be
  // emptied. Preserve ink's ESC+alnum meta path only (Alt+letter → "a").
  if (!processedAsSpecialSequence && !keypress.name && input !== '') {
    const orig = keypress.sequence ?? keypress.raw ?? ''
    if (orig.charCodeAt(0) === 0x1b) {
      const isMetaAlnum =
        orig.length === 2 &&
        input.length === 1 &&
        ((input >= 'a' && input <= 'z') ||
          (input >= 'A' && input <= 'Z') ||
          (input >= '0' && input <= '9'))
      if (!isMetaAlnum) {
        input = ''
      }
    }
  }

  // Official densable sji (2.1.210) — the real reason official never types
  // "17;19M" / "MMMM" / orphan bursts into the prompt even when those strings
  // reach the keyboard path:
  //   input = name==="enter" ? "\n" : [...e.key].length===1 ? e.key : ""
  // Multi-codepoint sequences are NOT typed. Single codepoints (ASCII, CJK,
  // fullwidth punct) still insert. Bracketed paste sets isPasted and keeps
  // the full payload for the paste handler (official uses dispatchPasteEvent).
  if (!keypress.isPasted && input !== '' && [...input].length !== 1) {
    input = ''
  }

  // Set shift=true for uppercase letters (A-Z)
  // Must check it's actually a letter, not just any char unchanged by toUpperCase
  if (
    input.length === 1 &&
    typeof input[0] === 'string' &&
    input[0] >= 'A' &&
    input[0] <= 'Z'
  ) {
    key.shift = true
  }

  return [key, input]
}

export class InputEvent extends Event {
  readonly keypress: ParsedKey
  readonly key: Key
  readonly input: string

  constructor(keypress: ParsedKey) {
    super()
    const [key, input] = parseKey(keypress)

    this.keypress = keypress
    this.key = key
    this.input = input
  }
}
