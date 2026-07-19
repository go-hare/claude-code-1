import type { ParsedKey } from '../parse-keypress.js'
import { TerminalEvent } from './terminal-event.js'

/**
 * Keyboard event dispatched through the DOM tree via capture/bubble.
 *
 * Official densable 2.1.210 KeyboardEvent shape:
 * - `key` — fag(parsed): literal char / named multi-char / "" for ESC residue
 * - `name` — raw ParsedKey.name ("" when nameless); used by tS_ blacklist
 * - `sequence` — raw ParsedKey.sequence
 *
 * Main prompt inserts with: `if (q.key.length >= 1 && !tS_.has(q.name)) insert(q.key)`
 * where tS_ = pageup/pagedown/insert/wheelup/wheeldown/mouse/clear/enter/f1…f12.
 *
 * Official densable relies on tokenizer buffering + lag wheel routing +
 * InputEvent sji for multi-codepoint. This fork's main prompt inserts via
 * KeyboardEvent.key (no sji), so progressive Terminal.app desync residue
 * (`MMM8MMMM`, `<64;32;19M…`, `17;19M`) must empty here via isSgrMouseResidue.
 */
export class KeyboardEvent extends TerminalEvent {
  readonly key: string
  readonly name: string
  readonly sequence: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly meta: boolean
  readonly superKey: boolean
  readonly fn: boolean

  constructor(parsedKey: ParsedKey) {
    super('keydown', { bubbles: true, cancelable: true })

    this.key = keyFromParsed(parsedKey)
    this.name = parsedKey.name ?? ''
    this.sequence = parsedKey.sequence ?? ''
    this.ctrl = parsedKey.ctrl
    this.shift = parsedKey.shift
    this.meta = parsedKey.meta || parsedKey.option
    this.superKey = parsedKey.super
    this.fn = parsedKey.fn
  }
}

/** Charset of pure SGR residue: `[]<\d;Mm` + ESC (0x1b). Built without
 * control-char regex literals so biome noControlCharactersInRegex stays clean. */
function isSgrResidueCharset(seq: string): boolean {
  for (let i = 0; i < seq.length; i++) {
    const c = seq.charCodeAt(i)
    // ESC, `[`, `]`, `<`, digits, `;`, `M`, `m`
    if (
      c !== 0x1b &&
      c !== 0x5b &&
      c !== 0x5d &&
      c !== 0x3c &&
      !(c >= 0x30 && c <= 0x39) &&
      c !== 0x3b &&
      c !== 0x4d &&
      c !== 0x6d
    ) {
      return false
    }
  }
  return seq.length > 0
}

/**
 * True when `seq` is pure SGR-mouse desync residue (no legitimate typed text).
 *
 * Official densable fag only empties pure `\[<\d…` bursts. Live Terminal.app /
 * scroll desync often loses ESC and the `[` as well, producing glued runs like:
 *   `<64;32;19M4;32;19M32;19M;19M<65;32;19M`
 * and mixed finalizer noise like `MMM8MMMM` (digit from a torn button code
 * between late `M`/`m` finalizers). Main prompt inserts via KeyboardEvent.key
 * (no sji), so those must empty here.
 *
 * Charset is only `[]<\d;Mm` plus optional leading ESC — never letters, so
 * `[MAX]`, image chips, and normal text never match.
 */
export function isSgrMouseResidue(seq: string): boolean {
  if (!seq) return false
  // Pure finalizer runs of length ≥2 (single M/m still types).
  if (/^[Mm]{2,}$/.test(seq)) return true
  // Mixed finalizer desync: only M/m + digits, ≥2 finalizers, length ≥3
  // (live walls like "MMM8MMMM" / "MM64MM" after peel leaves finalizer noise).
  // Lone "M8" / "8M" still type; require multi-finalizer + digit noise.
  if (
    seq.length >= 3 &&
    /^[Mm\d]+$/.test(seq) &&
    /\d/.test(seq) &&
    (seq.match(/[Mm]/g) ?? []).length >= 2
  ) {
    return true
  }
  // Official: pure orphan SGR with leading `[` (complete or incomplete tails).
  if (/^(\[<\d[\d;]*[Mm]?)+$/.test(seq)) return true
  // ESC lost AND often `[` lost: leading-`<` forms + progressive param tails.
  // Fragments: `[?<btn;col;row[Mm]?`, `btn;col;rowM`, `col;rowM`, `;rowM`, `M+`.
  if (
    isSgrResidueCharset(seq) &&
    /[Mm]/.test(seq) &&
    // At least one SGR-ish marker: `<digits`, `digits;digits`, or `;digitsM`
    /(?:<\d|\d;\d|;\d+[Mm])/.test(seq)
  ) {
    return true
  }
  // Incomplete body held without finalizer (`[<64;19;15` / `<64;19;15` /
  // `\x1b[<64;19;15`). Strip optional ESC then match printable form.
  const noEsc = seq.charCodeAt(0) === 0x1b ? seq.slice(1) : seq
  if (/^(?:\[<\d[\d;]*|<\d[\d;]*)$/.test(noEsc)) return true
  // Incomplete param runs without finalizer (btn;col;row / col;row) — live
  // stream often peels the head and leaves `64;32;19` or `32;19` as text.
  // Never letters; single numbers / "1" still type (no `;`).
  if (/^(?:\d+;){1,2}\d+$/.test(seq)) return true
  // Progressive short tail after ESC/`[`/`<` loss: last coord + finalizer.
  // Live screenshot: bare "4M" in the prompt after scroll-over-input.
  // Terminal col/row are 1–3 digits; bare "M"/"m" still type; "M8" still types
  // (digit after finalizer — not a torn row). Intentional "4M" is rare in
  // prompts vs constant SGR desync on Apple Terminal scroll.
  if (/^\d{1,3}[Mm]$/.test(seq)) return true
  return false
}

/**
 * Strip embedded complete/partial SGR mouse fragments from mixed key text.
 * Live: `[Image #2][<65;23;12M5;23;12M` → `[Image #2]` after scrub.
 * Pure residue after scrub is emptied by caller via isSgrMouseResidue.
 */
export function stripSgrMouseFragments(text: string): string {
  if (!text) return text
  // Complete orphan SGR (optional leading ESC). ESC built without control-char
  // regex literal so biome noControlCharactersInRegex stays clean.
  const esc = String.fromCharCode(0x1b)
  let out = text.split(esc).join('')
  out = out.replace(/\[<\d+;\d+;\d+[Mm]/g, '')
  // Finalizer glued to progressive params after ESC/`[` loss:
  // live `[Image #4]M5;12;11M[<65;…` → chip + `M5;12;11M` after complete strip.
  out = out.replace(/[Mm](?:\d+;){1,2}\d+[Mm]/g, '')
  // Glued progressive param residue (lost `[<`): `5;23;12M` / `17;19M`
  out = out.replace(/(?:^|[^0-9A-Za-z])(?:\d+;){1,2}\d+[Mm]/g, m => {
    const first = m[0]!
    if ((first >= '0' && first <= '9') || first === ';') return ''
    return first
  })
  out = out.replace(/^(?:\d+;){1,2}\d+[Mm]/, '')
  // Short last-coord + finalizer glued after text/chip (`…4M` / `…12m`)
  out = out.replace(/(?:^|[^0-9A-Za-z])\d{1,3}[Mm]/g, m => {
    const first = m[0]!
    if (first >= '0' && first <= '9') return ''
    return first
  })
  out = out.replace(/^\d{1,3}[Mm]/, '')
  // Pure finalizer runs of length ≥2 left after peel
  out = out.replace(/[Mm]{2,}/g, '')
  // Leading-`<` progressive desync without `[`
  out = out.replace(/<\d[\d;]*[Mm]/g, '')
  return out
}

/**
 * Convert a ParsedKey into the browser-like `KeyboardEvent.key` string.
 *
 * Official densable 2.1.211 `Q_g` / fag:
 *   space → " "; ctrl → name; single printable → seq; named → name;
 *   ESC-prefixed nameless → ""; pure `/^(\[<\d[\d;]*[Mm]?)+$/` → "";
 *   else → seq.
 *
 * Fork extra: `isSgrMouseResidue` + `stripSgrMouseFragments` empty progressive
 * desync and scrub embedded SGR from mixed tokens. Official main insert is
 * `B.key.length>=1 && !OC_.has(B.name)` with no sji — without these sinks,
 * Terminal.app scroll desync types residual SGR into the prompt.
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

  // Official fag: nameless ESC-prefixed sequences produce no key text.
  if (seq.charCodeAt(0) === 0x1b) return ''
  // Official pure orphan SGR + fork progressive residue sink.
  if (isSgrMouseResidue(seq)) return ''

  // Mixed tokens: strip embedded SGR, then re-check residue.
  // e.g. `[Image #2][<65;23;12M5;23;12M` → `[Image #2]` (keep chip).
  if (seq.length > 1 && /[<\dMm;[]/.test(seq)) {
    const scrubbed = stripSgrMouseFragments(seq)
    if (!scrubbed || isSgrMouseResidue(scrubbed)) return ''
    if (scrubbed !== seq) return scrubbed
  }

  return seq
}
