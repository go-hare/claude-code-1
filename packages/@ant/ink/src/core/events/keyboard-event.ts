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
 * (leading-`<` runs, pure `[<\d…`, 3-param without `<`) empties here.
 * Under-strip policy: keep pure MMMM / 17;19M / 1;2;3 / short 4M.
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
 * scroll desync often loses ESC and the `[`, producing glued leading-`<` runs.
 * Main prompt inserts via KeyboardEvent.key (no sji), so those empty here.
 *
 * Under-strip (review residual): do NOT empty pure MMMM, 2-param 17;19M,
 * bare 1;2;3 / 32;19, short 4M, or multi-finalizer digit noise without `<`.
 * Charset for leading-`<` path is only `[]<\d;Mm` + optional ESC — never letters.
 */
export function isSgrMouseResidue(seq: string): boolean {
  if (!seq) return false
  // densable 228 xM_ (KeyboardEvent.key): pure orphan SGR with leading `[`
  //   if (/^(\[<\d[\d;]*[Mm]?)+$/.test(t)) return ""
  // densable does NOT empty 2-param bursts (3;60M143;60M…) — invent-ban.
  if (/^(\[<\d[\d;]*[Mm]?)+$/.test(seq)) return true
  // Fork extras below (pre-existing local delta vs densable xM_): progressive
  // desync when ESC and/or `[` lost. Documented; not densable 1:1.
  // ESC lost AND often `[` lost: leading-`<` SGR forms only.
  if (isSgrResidueCharset(seq) && /<\d/.test(seq) && /[Mm]/.test(seq)) {
    return true
  }
  // Incomplete body held without finalizer (`[<64;19;15` / `<64;19;15`).
  const noEsc = seq.charCodeAt(0) === 0x1b ? seq.slice(1) : seq
  if (/^(?:\[<\d[\d;]*|<\d[\d;]*)$/.test(noEsc)) return true
  // Progressive complete 3-param without `<` (`64;32;19M`) after peel only.
  // Bare "1;2;3" / "32;19" / "4M" / pure Mm runs are kept (review under-strip).
  if (/^(?:\d+;){2}\d+[Mm]$/.test(seq)) return true
  // Progressive peel tail after col/row dropped: ";19M" / ";19m"
  if (/^;\d+[Mm]$/.test(seq)) return true
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
  // Finalizer glued to progressive 3-param after ESC/`[` loss:
  // live `[Image #4]M5;12;11M[<65;…` → chip + `M5;12;11M` after complete strip.
  // Require 3 params (two `;`) — 2-param `17;19M` is ambiguous typed text.
  out = out.replace(/[Mm](?:\d+;){2}\d+[Mm]/g, '')
  // Glued progressive 3-param residue (lost `[<`): `5;23;12M` only — not `17;19M`.
  out = out.replace(/(?:^|[^0-9A-Za-z])(?:\d+;){2}\d+[Mm]/g, m => {
    const first = m[0]!
    if ((first >= '0' && first <= '9') || first === ';') return ''
    return first
  })
  // Pure progressive 3-param with finalizer only (`5;23;12M`). Keep 2-param.
  out = out.replace(/^(?:\d+;){2}\d+[Mm]/, '')
  // Pure progressive peel tail only (do not strip middle of "17;19M" / "32;19M").
  if (/^;\d+[Mm]$/.test(out)) return ''
  // Do NOT strip pure "MMMM" / "MMM8MMMM" / short "4M" — under-strip policy.
  // densable parse-keypress has no pendingSgr / peel — incomplete CSI flushes.
  // Leading-`<` progressive desync without `[`
  out = out.replace(/<\d[\d;]*[Mm]/g, '')
  return out
}

/**
 * Convert a ParsedKey into the browser-like `KeyboardEvent.key` string.
 *
 * densable 2.1.228 `xM_` (KeyboardEvent.key; was Q_g/fag):
 *   space → " "; ctrl → name; single printable → seq; named → name;
 *   ESC-prefixed nameless → ""; pure `/^(\[<\d[\d;]*[Mm]?)+$/` → "";
 *   else → seq.  **No** 2-param / leading-`<` / 3-param-without-`[` in densable.
 *
 * Fork extras (pre-existing local delta, not densable 1:1): `isSgrMouseResidue`
 * progressive sinks + `stripSgrMouseFragments` mixed scrub. Main insert remains
 * densable `J1T`/`OC_`: `B.key.length>=1 && !J1T.has(B.name)` (no sji).
 * densable InputEvent adapter still uses `[...e.key].length===1` (sji) — main
 * prompt does not.
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
