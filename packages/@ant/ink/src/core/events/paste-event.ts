import stripAnsi from 'strip-ansi'
import { TerminalEvent } from './terminal-event.js'

// Official 2.1.325 `RC` / `MC` / `TC` / `AC` / `wC` — C1 & ESC control-sequence sanitization for PasteEvent.
// Built via RegExp() to keep Biome noControlCharactersInRegex clean.
const C1_ANY_RE = /[\u0090\u0098\u009b\u009d-\u009f]/
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional C1/ESC match
const ESC_C1_RE = /\u001b[\u0090\u0098\u009b\u009d-\u009f]/g
const C1_ALL_RE = /[\u0090\u0098\u009b\u009d-\u009f]/g
const C1_STRING_BEL_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional C1/BEL match
  /([\u0090\u0098\u009d-\u009f][^\u0007\u001b\u0090\u0098\u009d-\u009f\r\n]*)\u0007/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ESC/BEL match
const ESC_STRING_BEL_RE = /(\u001b[PX^_][^\u0007\u001b]*)\u0007/g
const ESC_CHAR = '\x1b'
const BEL_CHAR = '\x07'

/**
 * Paste event dispatched through the DOM tree via capture/bubble.
 *
 * Official densable 2.1.210 (`H6e`) + 2.1.325 (`VAe`):
 * Sanitizes C1/ANSI sequences and records `rawEmpty` / `rawEndedWithFocusTail`.
 * `pastedText` is kept as an alias of `text` for older call sites.
 */
export class PasteEvent extends TerminalEvent {
  readonly text: string
  readonly rawEmpty: boolean
  readonly rawEndedWithFocusTail: boolean

  constructor(input: string | PasteEvent) {
    super('paste', { bubbles: true, cancelable: true })
    if (input instanceof PasteEvent) {
      this.text = input.text
      this.rawEmpty = input.rawEmpty
      this.rawEndedWithFocusTail = input.rawEndedWithFocusTail
      return
    }
    this.rawEmpty = input.length === 0 || input === '[I' || input === '[O'
    this.rawEndedWithFocusTail = input.endsWith('[I') || input.endsWith('[O')
    let sanitized = C1_ANY_RE.test(input)
      ? input
          .replace(C1_STRING_BEL_RE, '$1')
          .replace(ESC_C1_RE, '')
          .replace(C1_ALL_RE, '')
      : input
    if (sanitized.includes(ESC_CHAR)) {
      const terminated = sanitized.replace(ESC_STRING_BEL_RE, `$1${ESC_CHAR}\\`)
      sanitized = stripAnsi(terminated.replaceAll(BEL_CHAR, ''))
    }
    this.text = sanitized
  }

  /** Alias for densable-era consumers that read pastedText. */
  get pastedText(): string {
    return this.text
  }
}

/** @deprecated Use PasteEvent class; shape kept for type-only imports. */
export type PasteEventShape = {
  pastedText: string
}
