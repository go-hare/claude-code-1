import type { ParsedKey } from '../parse-keypress.js'
import { TerminalEvent } from './terminal-event.js'

/**
 * Keyboard event dispatched through the DOM tree via capture/bubble.
 *
 * Follows browser KeyboardEvent semantics: `key` is the literal character
 * for printable keys ('a', '3', ' ', '/') and a multi-char name for
 * special keys ('down', 'return', 'escape', 'f1'). The idiomatic
 * printable-char check is `e.key.length === 1`.
 */
export class KeyboardEvent extends TerminalEvent {
  readonly key: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly meta: boolean
  readonly superKey: boolean
  readonly fn: boolean

  constructor(parsedKey: ParsedKey) {
    super('keydown', { bubbles: true, cancelable: true })

    this.key = keyFromParsed(parsedKey)
    this.ctrl = parsedKey.ctrl
    this.shift = parsedKey.shift
    this.meta = parsedKey.meta || parsedKey.option
    this.superKey = parsedKey.super
    this.fn = parsedKey.fn
  }
}

/**
 * Convert a ParsedKey into the browser-like `KeyboardEvent.key` string.
 * Aligned with official 2.1.210 densable `fag()`:
 *   space name → ' '; ctrl → letter name; single printable seq → that char;
 *   named key (with shift uppercasing) → name; ESC-prefixed / orphan SGR
 *   nameless sequences → '' (do not leak into text insert).
 */
function keyFromParsed(parsed: ParsedKey): string {
  const seq = parsed.sequence ?? ''
  const name = parsed.name ?? ''

  // CSI u / modifyOtherKeys report space as name "space" with a multi-char
  // sequence. Official returns the literal space character first.
  if (name === 'space') return ' '

  // Ctrl combos: sequence is a control byte (\x03 for ctrl+c), name is the
  // letter. Browsers report e.key === 'c' with e.ctrlKey === true.
  if (parsed.ctrl) return name

  // Single printable char (space through ~, plus anything above ASCII):
  // use the literal char. Browsers report e.key === '3', not 'Digit3'.
  // This is also the path for raw UTF-8 / high-byte-reassembled CJK (name
  // is often empty; sequence is the character itself).
  if (seq.length === 1) {
    const code = seq.charCodeAt(0)
    if (code >= 0x20 && code !== 0x7f) return seq
  }

  // Named special keys (arrows, F-keys, return, tab, escape, wheel*, etc.)
  // and printable Unicode names recovered from CSI u (e.g. fullwidth `：`).
  // Prefer name over raw sequence — browsers report e.key === 'ArrowDown'.
  // Official uses toUpperCase() for any single-char name under shift, not
  // only a–z (covers non-Latin when terminals report shift).
  if (name) {
    if (parsed.shift && name.length === 1) {
      const upper = name.toUpperCase()
      if (upper !== name && upper.length === 1) return upper
    }
    return name
  }

  // Official fag: nameless ESC-prefixed sequences produce no key text
  // (unmapped functional CSI u, incomplete recovery, etc.).
  if (seq.charCodeAt(0) === 0x1b) return ''
  // Official 2.1.153 $z5 / 2.1.210 fag: swallow ESC-less SGR mouse fragments
  // that escaped the parser as nameless keys. Single orphan: `[<65;11;10M`.
  // Fast-scroll burst after a heavy-render ESC flush:
  // `[<65;11;10M[<65;11;10M...`. Without this, return name||seq would type
  // the garbage into the prompt via onKeyDown paths that insert e.key.
  if (/^(\[<\d[\d;]*[Mm]?)+$/.test(seq)) return ''

  return seq
}
