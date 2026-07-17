import { TerminalEvent } from './terminal-event.js'

/**
 * Paste event dispatched through the DOM tree via capture/bubble.
 *
 * Official densable 2.1.210 (H6e):
 *   class extends Event { text; constructor(e) { super("paste", {bubbles, cancelable}); this.text = e } }
 *
 * App lag: isPasted → dispatchPasteEvent(sequence) → focused node's onPaste.
 * Bracketed paste never becomes KeyboardEvent / InputEvent insert.
 *
 * `pastedText` is kept as an alias of `text` for older call sites.
 */
export class PasteEvent extends TerminalEvent {
  readonly text: string

  constructor(text: string) {
    super('paste', { bubbles: true, cancelable: true })
    this.text = text
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
