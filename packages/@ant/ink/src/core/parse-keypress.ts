/**
 * Keyboard input parser - converts terminal input to key events
 *
 * Uses the termio tokenizer for escape sequence boundary detection,
 * then interprets sequences as keypresses.
 */
import { Buffer } from 'buffer'
import { FOCUS_IN, FOCUS_OUT, PASTE_END, PASTE_START } from './termio/csi.js'
import {
  createTokenizer,
  type Token,
  type Tokenizer,
} from './termio/tokenize.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const META_KEY_CODE_RE = /^(?:\x1b)([a-zA-Z0-9])$/

const FN_KEY_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
  /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/

// CSI u (kitty keyboard protocol), including progressive-enhancement
// subparameters (colon-separated) from the full form:
//   CSI unicode-key-code[:shifted[:base]] ; mods[:event-type] ; text-as-codepoints u
// Examples:
//   ESC[13;2u              Shift+Enter (basic)
//   ESC[27u                Escape, no modifiers
//   ESC[58:65306;2u        key ":" with shifted key U+FF1A (fullwidth colon)
//   ESC[58:65306;2:1;65306u  same + event-type press + associated text U+FF1A
// Each field accepts digits and ":" so subparams don't fail the match and get
// swallowed as unmapped functional keys (the CJK fullwidth-colon bug).
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const CSI_U_RE = /^\x1b\[([\d:]+)(?:;([\d:]+))?(?:;([\d:]+))?u/

// xterm modifyOtherKeys: ESC [ 27 ; modifier ; keycode ~
// Example: ESC[27;2;13~ = Shift+Enter. Emitted by Ghostty/tmux/xterm when
// modifyOtherKeys=2 is active or via user keybinds, typically over SSH where
// TERM sniffing misses Ghostty and we never push Kitty keyboard mode.
// Note param order is reversed vs CSI u (modifier first, keycode second).
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const MODIFY_OTHER_KEYS_RE = /^\x1b\[27;(\d+);(\d+)~/

// -- Terminal response patterns (inbound sequences from the terminal itself) --
// DECRPM: CSI ? Ps ; Pm $ y  — response to DECRQM (request mode)
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const DECRPM_RE = /^\x1b\[\?(\d+);(\d+)\$y$/
// DA1: CSI ? Ps ; ... c  — primary device attributes response
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const DA1_RE = /^\x1b\[\?([\d;]*)c$/
// DA2: CSI > Ps ; ... c  — secondary device attributes response
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const DA2_RE = /^\x1b\[>([\d;]*)c$/
// Kitty keyboard flags: CSI ? flags u  — response to CSI ? u query
// (private ? marker distinguishes from CSI u key events)
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const KITTY_FLAGS_RE = /^\x1b\[\?(\d+)u$/
// DECXCPR cursor position: CSI ? row ; col R
// The ? marker disambiguates from modified F3 keys (Shift+F3 = CSI 1;2 R,
// Ctrl+F3 = CSI 1;5 R, etc.) — plain CSI row;col R is genuinely ambiguous.
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const CURSOR_POSITION_RE = /^\x1b\[\?(\d+);(\d+)R$/
// OSC response: OSC code ; data (BEL|ST)
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const OSC_RESPONSE_RE = /^\x1b\](\d+);(.*?)(?:\x07|\x1b\\)$/s
// XTVERSION: DCS > | name ST  — terminal name/version string (answer to CSI > 0 q).
// xterm.js replies "xterm.js(X.Y.Z)"; Ghostty, kitty, iTerm2, etc. reply with
// their own name. Unlike TERM_PROGRAM, this survives SSH since the query/reply
// goes through the pty, not the environment.
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const XTVERSION_RE = /^\x1bP>\|(.*?)(?:\x07|\x1b\\)$/s
// SGR mouse event: CSI < button ; col ; row M (press) or m (release)
// Button codes: 64=wheel-up, 65=wheel-down (0x40 | wheel-bit).
// Button 32=left-drag (0x20 | motion-bit). Plain 0/1/2 = left/mid/right click.
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/
// densable 2.1.239 Qpr / Xyf / mwS / hwS — split mouse reports across writes.
// Incomplete ESC[ < digits;  prefix is held (not flushed as typed keys).
// Completed prefix is dropped (changelog "35;150;7M"), not pendingSgr invent.
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const INCOMPLETE_SGR_MOUSE_PREFIX_RE = /^\x1b\[<[\d;]*$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const COMPLETED_SGR_MOUSE_PREFIX_RE = /^\x1b\[<[\d;]*[Mm]/
/** densable hwS — max length still treated as a held incomplete SGR prefix. */
const HELD_SGR_MOUSE_PREFIX_MAX = 32
// densable 2.1.228 kTd text-branch orphan mouse recovery (was ZXc):
// whole-token only — not prefix peel, not multi-event burst, not embedded.
//   /^\[<\d+;\d+;\d+[Mm]$/   SGR
//   /^\[M[\x60-\x7f][\x20-\uffff]{2}$/  X10 wheel payload
// Bursts / incomplete / param residue stay one text key.
const ORPHAN_SGR_WHOLE_TOKEN_RE = /^\[<\d+;\d+;\d+[Mm]$/
const ORPHAN_X10_WHEEL_WHOLE_TOKEN_RE = /^\[M[\u0060-\u007f][\u0020-\uffff]{2}$/

/**
 * Official Uog/Bog densable: CLAUDE_CODE_ALTGR_AS_TEXT / WT_SESSION.
 * force | off | auto (Windows Terminal default).
 */
function resolveAltGrAsTextMode(): 'force' | 'off' | 'auto' {
  const raw = process.env.CLAUDE_CODE_ALTGR_AS_TEXT
  if (raw) {
    const normalized = raw.toLowerCase().trim()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return 'force'
    if (['0', 'false', 'no', 'off'].includes(normalized)) return 'off'
  }
  return process.env.WT_SESSION ? 'auto' : 'off'
}

/**
 * Official jog / qgg — codepoints that may be AltGr text.
 * Extended past official `e>=160&&e<55296` so fullwidth forms (U+FF1A etc.)
 * and CJK after the surrogate block also rewrite ctrl+meta → plain text.
 * Without this, ESC[65306;7u (AltGr/IME) keeps ctrl+meta and useTextInput
 * mapKey swallows the character via handleCtrl/handleMeta.
 */
function isAltGrPrintableCodepoint(codepoint: number): boolean {
  if (codepoint > 32 && codepoint < 127) return true
  if (codepoint >= 160 && codepoint < 0xd800) return true
  // Fullwidth / CJK beyond surrogates (official FJc stops at 55296; we need
  // these for IME punctuation under AltGr-reported mods).
  return isPrintableUnicodeCodepoint(codepoint)
}

/** Official Wog/zgg — ASCII alnum; auto mode leaves these as real ctrl+meta. */
function isAsciiAlphanumericCodepoint(codepoint: number): boolean {
  return (
    (codepoint >= 48 && codepoint <= 57) ||
    (codepoint >= 65 && codepoint <= 90) ||
    (codepoint >= 97 && codepoint <= 122)
  )
}

/**
 * Official NJc/rau densable — treat ctrl+meta (without super) printable as
 * AltGr text when CLAUDE_CODE_ALTGR_AS_TEXT allows it.
 */
function shouldRewriteAltGrAsText(
  mods: { ctrl: boolean; meta: boolean; super: boolean },
  codepoint: number,
): boolean {
  if (!(mods.ctrl && mods.meta) || mods.super) return false
  if (!isAltGrPrintableCodepoint(codepoint)) return false
  const mode = resolveAltGrAsTextMode()
  if (mode === 'off') return false
  if (mode === 'force') return true
  // auto: non-alnum only (punctuation / fullwidth / CJK)
  return !isAsciiAlphanumericCodepoint(codepoint)
}

/** Official OJc/tau — plain text key with modifiers cleared. */
function altGrTextKey(
  sequence: string,
  codepoint: number,
  shift: boolean,
): ParsedKey {
  return {
    kind: 'key',
    name: String.fromCodePoint(codepoint),
    fn: false,
    ctrl: false,
    meta: false,
    shift,
    option: false,
    super: false,
    sequence,
    raw: sequence,
    isPasted: false,
  }
}

function createPasteKey(content: string): ParsedKey {
  return {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: content,
    raw: content,
    isPasted: true,
  }
}

/** DECRPM status values (response to DECRQM) */
export const DECRPM_STATUS = {
  NOT_RECOGNIZED: 0,
  SET: 1,
  RESET: 2,
  PERMANENTLY_SET: 3,
  PERMANENTLY_RESET: 4,
} as const

/**
 * A response sequence received from the terminal (not a keypress).
 * Emitted in answer to queries like DECRQM, DA1, OSC 11, etc.
 */
export type TerminalResponse =
  /** DECRPM: answer to DECRQM (request DEC private mode status) */
  | { type: 'decrpm'; mode: number; status: number }
  /** DA1: primary device attributes (used as a universal sentinel) */
  | { type: 'da1'; params: number[] }
  /** DA2: secondary device attributes (terminal version info) */
  | { type: 'da2'; params: number[] }
  /** Kitty keyboard protocol: current flags (answer to CSI ? u) */
  | { type: 'kittyKeyboard'; flags: number }
  /** DSR: cursor position report (answer to CSI 6 n) */
  | { type: 'cursorPosition'; row: number; col: number }
  /** OSC response: generic operating-system-command reply (e.g. OSC 11 bg color) */
  | { type: 'osc'; code: number; data: string }
  /** XTVERSION: terminal name/version string (answer to CSI > 0 q).
   *  Example values: "xterm.js(5.5.0)", "ghostty 1.2.0", "iTerm2 3.6". */
  | { type: 'xtversion'; name: string }

/**
 * Try to recognize a sequence token as a terminal response.
 * Returns null if the sequence is not a known response pattern
 * (i.e. it should be treated as a keypress).
 *
 * These patterns are syntactically distinguishable from keyboard input —
 * no physical key produces CSI ? ... c or CSI ? ... $ y, so they can be
 * safely parsed out of the input stream at any time.
 */
function parseTerminalResponse(s: string): TerminalResponse | null {
  // CSI-prefixed responses
  if (s.startsWith('\x1b[')) {
    let m: RegExpExecArray | null

    if ((m = DECRPM_RE.exec(s))) {
      return {
        type: 'decrpm',
        mode: parseInt(m[1]!, 10),
        status: parseInt(m[2]!, 10),
      }
    }

    if ((m = DA1_RE.exec(s))) {
      return { type: 'da1', params: splitNumericParams(m[1]!) }
    }

    if ((m = DA2_RE.exec(s))) {
      return { type: 'da2', params: splitNumericParams(m[1]!) }
    }

    if ((m = KITTY_FLAGS_RE.exec(s))) {
      return { type: 'kittyKeyboard', flags: parseInt(m[1]!, 10) }
    }

    if ((m = CURSOR_POSITION_RE.exec(s))) {
      return {
        type: 'cursorPosition',
        row: parseInt(m[1]!, 10),
        col: parseInt(m[2]!, 10),
      }
    }

    return null
  }

  // OSC responses (e.g. OSC 11 ; rgb:... for bg color query)
  if (s.startsWith('\x1b]')) {
    const m = OSC_RESPONSE_RE.exec(s)
    if (m) {
      return { type: 'osc', code: parseInt(m[1]!, 10), data: m[2]! }
    }
  }

  // DCS responses (e.g. XTVERSION: DCS > | name ST)
  if (s.startsWith('\x1bP')) {
    const m = XTVERSION_RE.exec(s)
    if (m) {
      return { type: 'xtversion', name: m[1]! }
    }
  }

  return null
}

function splitNumericParams(params: string): number[] {
  if (!params) return []
  return params.split(';').map(p => parseInt(p, 10))
}

/** One high-byte CSI u / modifyOtherKeys event awaiting UTF-8 reassembly. */
type PendingByteEvent = {
  seq: string
  byte: number
}

export type KeyParseState = {
  mode: 'NORMAL' | 'IN_PASTE'
  incomplete: string
  pasteBuffer: string
  /**
   * High-byte CSI u events (code 128–255, no real modifiers) that some
   * terminals emit under the Kitty keyboard protocol — one event per UTF-8
   * byte of a multi-byte character. Official 2.1.210 reassembles these into
   * a single Unicode character before parseKeypress so CJK / fullwidth
   * punctuation (e.g. `：` = EF BC 9A) is not inserted as Latin-1 garbage
   * or swallowed. See highByteFromExtendedKeySequence + reassemble below.
   */
  pendingByteEvents: PendingByteEvent[]
  /**
   * densable droppedMousePrefix — incomplete ESC[<… parked out of the
   * tokenizer (too long for Qpr, or Jyf after mousePrefixDropAt).
   */
  droppedMousePrefix: string
  // Internal tokenizer instance — incomplete CSI stays in tokenizer.buffer()
  // until App NORMAL_TIMEOUT / mousePrefixDropAt flush (densable Qyf).
  _tokenizer?: Tokenizer
}

export const INITIAL_STATE: KeyParseState = {
  mode: 'NORMAL',
  incomplete: '',
  pasteBuffer: '',
  pendingByteEvents: [],
  droppedMousePrefix: '',
}

/** densable Qpr */
export function isHeldSgrMousePrefix(value: string): boolean {
  return (
    value.length <= HELD_SGR_MOUSE_PREFIX_MAX &&
    INCOMPLETE_SGR_MOUSE_PREFIX_RE.test(value)
  )
}

/**
 * densable Jyf — park tokenizer buffer into droppedMousePrefix and reset.
 * App calls this when mousePrefixDropAt expires so a late text chunk can
 * still complete/drop the report instead of typing "35;150;7M".
 */
export function parkIncompleteMousePrefix(state: KeyParseState): KeyParseState {
  const prefix = state._tokenizer?.buffer() ?? ''
  state._tokenizer?.reset()
  return { ...state, incomplete: '', droppedMousePrefix: prefix }
}

function inputToString(input: Buffer | string): string {
  if (Buffer.isBuffer(input)) {
    if (input[0]! > 127 && input[1] === undefined) {
      ;(input[0] as unknown as number) -= 128
      return '\x1b' + String(input)
    } else {
      return String(input)
    }
  } else if (input !== undefined && typeof input !== 'string') {
    return String(input)
  } else if (!input) {
    return ''
  } else {
    return input
  }
}

/**
 * Extract a high UTF-8 byte (128–255) from a simple CSI u / modifyOtherKeys
 * event with no modifiers. Official densable zXc — terminals under Kitty
 * keyboard mode sometimes report multi-byte characters as one event per
 * UTF-8 byte (e.g. fullwidth `：` → ESC[239u ESC[188u ESC[154u). Those must
 * be reassembled, not treated as Latin-1 / C1 codepoints.
 */
function highByteFromExtendedKeySequence(sequence: string): number | undefined {
  const csi = CSI_U_RE.exec(sequence)
  let code: number | undefined
  let mods: number | undefined
  if (csi) {
    code = firstSubparam(csi[1])
    mods = firstSubparam(csi[2])
  } else {
    const mok = MODIFY_OTHER_KEYS_RE.exec(sequence)
    if (mok) {
      mods = parseInt(mok[1]!, 10)
      code = parseInt(mok[2]!, 10)
    }
  }
  if (code === undefined || code < 128 || code > 255) return undefined
  // Only unmodified (or omitted mods, treated as 1). Real Shift/Alt/Ctrl
  // high-byte events are not UTF-8 fragments.
  if (mods !== undefined && mods !== 1) return undefined
  // Progressive-enhancement event-type subparam: only press (or default)
  // participates in reassembly. Release/repeat would corrupt the buffer.
  if (csi?.[2]?.includes(':')) {
    const eventType = parseInt(csi[2].split(':')[1] ?? '1', 10)
    if (Number.isFinite(eventType) && eventType !== 1) return undefined
  }
  return code
}

export function parseMultipleKeypresses(
  prevState: KeyParseState,
  input: Buffer | string | null = '',
): [ParsedInput[], KeyParseState] {
  const isFlush = input === null
  const inputString = isFlush ? '' : inputToString(input)

  // densable Qyf: mbt({x10Mouse:!0}) + droppedMousePrefix hold on flush
  const tokenizer = prevState._tokenizer ?? createTokenizer({ x10Mouse: true })
  let droppedMousePrefix = prevState.droppedMousePrefix ?? ''
  let tokens: Token[]
  if (isFlush && prevState.mode !== 'IN_PASTE') {
    const held = tokenizer.buffer()
    if (isHeldSgrMousePrefix(held)) {
      tokens = []
    } else if (INCOMPLETE_SGR_MOUSE_PREFIX_RE.test(held)) {
      tokenizer.reset()
      droppedMousePrefix = held
      tokens = []
    } else {
      tokens = tokenizer.flush()
    }
  } else {
    tokens = isFlush ? tokenizer.flush() : tokenizer.feed(inputString)
  }

  const keys: ParsedInput[] = []
  let inPaste = prevState.mode === 'IN_PASTE'
  let pasteBuffer = prevState.pasteBuffer
  // Copy so we never mutate prevState.pendingByteEvents in place.
  let pendingByteEvents: PendingByteEvent[] = [
    ...(prevState.pendingByteEvents ?? []),
  ]

  /** Emit a single pending high-byte event as a normal key/paste char. */
  const emitPendingByte = (ev: PendingByteEvent): void => {
    if (inPaste) {
      pasteBuffer += String.fromCharCode(ev.byte)
    } else {
      keys.push(parseKeypress(ev.seq))
    }
  }

  /** Flush any incomplete multi-byte assembly (densable d()). */
  const flushPendingBytes = (): void => {
    for (const ev of pendingByteEvents) {
      emitPendingByte(ev)
    }
    pendingByteEvents = []
  }

  /**
   * densable p() — accumulate high-byte CSI u events into one UTF-8 char.
   * Lead bytes 0xC2–0xF4 start a multi-byte sequence; continuation 0x80–0xBF
   * extend it; anything else flushes and retries.
   */
  const reassembleHighByte = (seq: string, byte: number): void => {
    if (pendingByteEvents.length === 0) {
      if (byte >= 0xc2 && byte <= 0xf4) {
        pendingByteEvents = [{ seq, byte }]
        return
      }
      emitPendingByte({ seq, byte })
      return
    }
    if (byte >= 0x80 && byte <= 0xbf) {
      pendingByteEvents = [...pendingByteEvents, { seq, byte }]
      const lead = pendingByteEvents[0]!.byte
      const expected = lead <= 0xdf ? 2 : lead <= 0xef ? 3 : 4
      if (pendingByteEvents.length < expected) return
      const assembled = pendingByteEvents
      pendingByteEvents = []
      const buf = Buffer.from(assembled.map(e => e.byte))
      const text = buf.toString('utf8')
      if (
        [...text].length !== 1 ||
        Buffer.byteLength(text, 'utf8') !== assembled.length
      ) {
        for (const ev of assembled) {
          emitPendingByte(ev)
        }
        return
      }
      if (inPaste) {
        pasteBuffer += text
      } else {
        keys.push(parseKeypress(text))
      }
      return
    }
    flushPendingBytes()
    reassembleHighByte(seq, byte)
  }

  for (const token of tokens) {
    if (token.type === 'sequence') {
      // densable Qyf: any sequence clears droppedMousePrefix (comma).
      droppedMousePrefix = ''
      if (token.value === PASTE_START) {
        flushPendingBytes()
        inPaste = true
        pasteBuffer = ''
      } else if (token.value === PASTE_END) {
        flushPendingBytes()
        // Always emit a paste key, even for empty pastes (clipboard image path).
        keys.push(createPasteKey(pasteBuffer))
        inPaste = false
        pasteBuffer = ''
      } else if (inPaste) {
        // High-byte CSI u fragments under Kitty → reassemble to real UTF-8.
        const highByte = highByteFromExtendedKeySequence(token.value)
        if (highByte !== undefined) {
          reassembleHighByte(token.value, highByte)
          continue
        }
        // densable YXc: skip focus / mouse inside paste; else MO5 unicode convert.
        if (
          token.value === FOCUS_IN ||
          token.value === FOCUS_OUT ||
          SGR_MOUSE_RE.test(token.value) ||
          (token.value.length === 6 && token.value.startsWith('\x1b[M'))
        ) {
          continue
        }
        if (
          !parseTerminalResponse(token.value) &&
          !SGR_MOUSE_RE.test(token.value)
        ) {
          // Keep pending only for fragments (handled above).
        }
        flushPendingBytes()
        pasteBuffer +=
          unicodeFromExtendedKeySequence(token.value) ?? token.value
      } else {
        // densable kTd sequence branch (no pendingSgr / absorbMm invent).
        const highByte = highByteFromExtendedKeySequence(token.value)
        if (highByte !== undefined) {
          reassembleHighByte(token.value, highByte)
          continue
        }
        const response = parseTerminalResponse(token.value)
        if (response) {
          keys.push({ kind: 'response', sequence: token.value, response })
          continue
        }
        const mouse = parseMouseEvent(token.value)
        if (mouse) {
          keys.push(mouse)
          continue
        }
        // densable: d() before ZUr for non-mouse / non-FOCUS_OUT-gated sequences.
        if (
          token.value === FOCUS_OUT ||
          (!SGR_MOUSE_RE.test(token.value) &&
            !(token.value.length === 6 && token.value.startsWith('\x1b[M')))
        ) {
          flushPendingBytes()
        }
        // densable: incomplete CSI flush becomes a sequence → U_n (parseKeypress).
        // Qpr hold is on flush (above), not here.
        keys.push(parseKeypress(token.value))
      }
    } else if (token.type === 'text') {
      // densable: d() before text.
      flushPendingBytes()
      let text = token.value
      if (!inPaste && droppedMousePrefix) {
        const combined = droppedMousePrefix + text
        const completed = COMPLETED_SGR_MOUSE_PREFIX_RE.exec(combined)
        if (completed) {
          droppedMousePrefix = ''
          text = combined.slice(completed[0].length)
          if (!text) continue
        } else if (isHeldSgrMousePrefix(combined)) {
          droppedMousePrefix = combined
          continue
        } else {
          droppedMousePrefix = ''
        }
      } else if (!inPaste && isHeldSgrMousePrefix(text)) {
        droppedMousePrefix = text
        continue
      }
      if (inPaste) {
        pasteBuffer += text
      } else if (
        ORPHAN_SGR_WHOLE_TOKEN_RE.test(text) ||
        ORPHAN_X10_WHEEL_WHOLE_TOKEN_RE.test(text)
      ) {
        // densable kTd: whole-token only re-ESC + CTd/U_n. No prefix peel.
        const seq = '\x1b' + text
        const mouse = parseMouseEvent(seq)
        keys.push(mouse ?? parseKeypress(seq))
      } else {
        // densable: whole text token → one ZUr key.
        // Extra (local enter safety, not densable invent for mouse): if a large
        // batch still embeds CR/LF (buffer ≥64 / no peel), split + collapse
        // consecutive terminators so Enter is not lost / double-submit.
        if ([...text].length > 1 && /[\r\n]/.test(text)) {
          const chars = [...text]
          for (let i = 0; i < chars.length; ) {
            const ch = chars[i]!
            if (ch === '\r' || ch === '\n') {
              keys.push(parseKeypress(ch))
              i++
              while (
                i < chars.length &&
                (chars[i] === '\r' || chars[i] === '\n')
              ) {
                i++
              }
              continue
            }
            keys.push(parseKeypress(ch))
            i++
          }
        } else {
          keys.push(parseKeypress(text))
        }
      }
    }
  }

  // densable: if(r) d(); if(r&&a) emit paste.
  if (isFlush) {
    flushPendingBytes()
    if (inPaste && pasteBuffer) {
      keys.push(createPasteKey(pasteBuffer))
      inPaste = false
      pasteBuffer = ''
    }
  }

  const newState: KeyParseState = {
    mode: inPaste ? 'IN_PASTE' : 'NORMAL',
    incomplete: tokenizer.buffer(),
    pasteBuffer,
    pendingByteEvents,
    droppedMousePrefix,
    _tokenizer: tokenizer,
  }

  return [keys, newState]
}

const keyName: Record<string, string> = {
  /* xterm/gnome ESC O letter */
  OP: 'f1',
  OQ: 'f2',
  OR: 'f3',
  OS: 'f4',
  /* Application keypad mode (numpad digits 0-9) */
  Op: '0',
  Oq: '1',
  Or: '2',
  Os: '3',
  Ot: '4',
  Ou: '5',
  Ov: '6',
  Ow: '7',
  Ox: '8',
  Oy: '9',
  /* Application keypad mode (numpad operators) */
  Oj: '*',
  Ok: '+',
  Ol: ',',
  Om: '-',
  On: '.',
  Oo: '/',
  OM: 'return',
  /* xterm/rxvt ESC [ number ~ */
  '[11~': 'f1',
  '[12~': 'f2',
  '[13~': 'f3',
  '[14~': 'f4',
  /* from Cygwin and used in libuv */
  '[[A': 'f1',
  '[[B': 'f2',
  '[[C': 'f3',
  '[[D': 'f4',
  '[[E': 'f5',
  /* common */
  '[15~': 'f5',
  '[17~': 'f6',
  '[18~': 'f7',
  '[19~': 'f8',
  '[20~': 'f9',
  '[21~': 'f10',
  '[23~': 'f11',
  '[24~': 'f12',
  /* xterm ESC [ letter */
  '[A': 'up',
  '[B': 'down',
  '[C': 'right',
  '[D': 'left',
  '[E': 'clear',
  '[F': 'end',
  '[H': 'home',
  /* xterm/gnome ESC O letter */
  OA: 'up',
  OB: 'down',
  OC: 'right',
  OD: 'left',
  OE: 'clear',
  OF: 'end',
  OH: 'home',
  /* xterm/rxvt ESC [ number ~ */
  '[1~': 'home',
  '[2~': 'insert',
  '[3~': 'delete',
  '[4~': 'end',
  '[5~': 'pageup',
  '[6~': 'pagedown',
  /* putty */
  '[[5~': 'pageup',
  '[[6~': 'pagedown',
  /* rxvt */
  '[7~': 'home',
  '[8~': 'end',
  /* rxvt keys with modifiers */
  '[a': 'up',
  '[b': 'down',
  '[c': 'right',
  '[d': 'left',
  '[e': 'clear',

  '[2$': 'insert',
  '[3$': 'delete',
  '[5$': 'pageup',
  '[6$': 'pagedown',
  '[7$': 'home',
  '[8$': 'end',

  Oa: 'up',
  Ob: 'down',
  Oc: 'right',
  Od: 'left',
  Oe: 'clear',

  '[2^': 'insert',
  '[3^': 'delete',
  '[5^': 'pageup',
  '[6^': 'pagedown',
  '[7^': 'home',
  '[8^': 'end',
  /* misc. */
  '[Z': 'tab',
}

export const nonAlphanumericKeys = [
  // Filter out single-character values (digits, operators from numpad) since
  // those are printable characters that should produce input
  ...Object.values(keyName).filter(v => v.length > 1),
  // escape and backspace are assigned directly in parseKeypress (not via the
  // keyName map), so the spread above misses them. Without these, ctrl+escape
  // via Kitty/modifyOtherKeys leaks the literal word "escape" as input text
  // (input-event.ts:58 assigns keypress.name when ctrl is set).
  // Bare \n is named "enter" (not via keyName); include it so InputEvent sji /
  // nonAlphanumeric clear does not leave input="\n" for LF Enter.
  'escape',
  'backspace',
  'enter',
  'wheelup',
  'wheeldown',
  'mouse',
]

const isShiftKey = (code: string): boolean => {
  return [
    '[a',
    '[b',
    '[c',
    '[d',
    '[e',
    '[2$',
    '[3$',
    '[5$',
    '[6$',
    '[7$',
    '[8$',
    '[Z',
  ].includes(code)
}

const isCtrlKey = (code: string): boolean => {
  return [
    'Oa',
    'Ob',
    'Oc',
    'Od',
    'Oe',
    '[2^',
    '[3^',
    '[5^',
    '[6^',
    '[7^',
    '[8^',
  ].includes(code)
}

/**
 * Decode XTerm-style modifier value to individual flags.
 * Modifier encoding: 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (super ? 8 : 0)
 *
 * Note: `meta` here means Alt/Option (bit 2). `super` is a distinct
 * modifier (bit 8, i.e. Cmd on macOS / Win key). Most legacy terminal
 * sequences can't express super — it only arrives via kitty keyboard
 * protocol (CSI u) or xterm modifyOtherKeys.
 */
function decodeModifier(modifier: number): {
  shift: boolean
  meta: boolean
  ctrl: boolean
  super: boolean
} {
  const m = modifier - 1
  return {
    shift: !!(m & 1),
    meta: !!(m & 2),
    ctrl: !!(m & 4),
    super: !!(m & 8),
  }
}

/**
 * True for printable Unicode codepoints that should become text input when
 * reported via Kitty CSI u / modifyOtherKeys (MO5-style recovery / name).
 *
 * Official 2.1.210 splits this:
 *   - VXc keycodeToName: only `e >= 160 && e < 55296` (stops before surrogates)
 *   - sig / MO5 recovery: any `e <= 0x10FFFF` via fromCodePoint
 *
 * Fullwidth forms (U+FF00–U+FFEF, e.g. `：` U+FF1A = 65306) sit AFTER the
 * surrogate block, so official VXc does NOT name them — recovery is via MO5
 * on empty name. We intentionally include them here so both name mapping and
 * characterFromCsiUMatch accept IME fullwidth punctuation without relying
 * solely on the empty-name path.
 *
 * Excludes:
 * - ASCII (handled separately with toLowerCase for key names)
 * - Surrogate halves (invalid scalar values)
 * - BMP Private Use Area U+E000–U+F8FF — Kitty functional keys live here
 *   (Caps Lock 57358, KP_0 57399, …)
 * - Supplementary Private Use Areas
 */
function isPrintableUnicodeCodepoint(codepoint: number): boolean {
  if (codepoint <= 126 || codepoint > 0x10ffff) return false
  // Surrogates
  if (codepoint >= 0xd800 && codepoint <= 0xdfff) return false
  // BMP Private Use Area (Kitty functional-key codepoints)
  if (codepoint >= 0xe000 && codepoint <= 0xf8ff) return false
  // Supplementary Private Use Area-A / Area-B
  if (codepoint >= 0xf0000 && codepoint <= 0xffffd) return false
  if (codepoint >= 0x100000 && codepoint <= 0x10fffd) return false
  return true
}

/** First numeric subparameter of a CSI u field (`"58:65306"` → 58). */
function firstSubparam(field: string | undefined): number | undefined {
  if (!field) return undefined
  const n = parseInt(field.split(':')[0]!, 10)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Best character to insert for a Kitty CSI u sequence under progressive
 * enhancement. Preference order mirrors the protocol's text field intent:
 *   1. associated text codepoints (3rd CSI field) — what IME/terminals
 *      report as the produced text (e.g. fullwidth `：`)
 *   2. shifted-key codepoint (2nd subparam of 1st field) when present
 *   3. primary unicode-key-code
 * Only returns printable codepoints (ASCII or non-PUA Unicode).
 */
function characterFromCsiUMatch(match: RegExpExecArray): string | undefined {
  const candidates: number[] = []
  // 3rd field: text-as-codepoints, may be colon-separated multiples
  if (match[3]) {
    for (const part of match[3].split(':')) {
      const n = parseInt(part, 10)
      if (Number.isFinite(n)) candidates.push(n)
    }
  }
  // 1st field: unicode-key-code[:shifted-key[:base-layout-key]]
  if (match[1]) {
    const parts = match[1].split(':')
    // shifted key (index 1) preferred over primary for text insertion when
    // the primary is a bare ASCII key and IME produced a fullwidth form.
    if (parts[1]) {
      const shifted = parseInt(parts[1], 10)
      if (Number.isFinite(shifted)) candidates.push(shifted)
    }
    const primary = parseInt(parts[0]!, 10)
    if (Number.isFinite(primary)) candidates.push(primary)
  }
  for (const codepoint of candidates) {
    if (
      (isPrintableUnicodeCodepoint(codepoint) ||
        (codepoint >= 32 && codepoint <= 126)) &&
      codepoint <= 0x10ffff &&
      !(codepoint >= 0xd800 && codepoint <= 0xdfff)
    ) {
      return String.fromCodePoint(codepoint)
    }
  }
  return undefined
}

/**
 * Recover a Unicode character from a CSI u / modifyOtherKeys sequence.
 * Mirrors official densable MO5, extended for Kitty progressive enhancement
 * (`code:shifted;mods:event;text u`) so IME fullwidth punctuation is not
 * swallowed when the sequence is more than simple `ESC[N;Mu`.
 */
export function unicodeFromExtendedKeySequence(
  sequence: string | undefined,
): string | undefined {
  if (!sequence) return undefined
  const csi = CSI_U_RE.exec(sequence)
  if (csi) {
    // Release events (mods:3) must not insert — InputEvent recovers via this
    // helper when name is empty, so skip here too.
    if (csi[2]?.includes(':')) {
      const eventType = parseInt(csi[2].split(':')[1] ?? '1', 10)
      if (Number.isFinite(eventType) && eventType === 3) return undefined
    }
    return characterFromCsiUMatch(csi)
  }
  const mok = MODIFY_OTHER_KEYS_RE.exec(sequence)
  if (mok) {
    const codepoint = parseInt(mok[2]!, 10)
    if (
      Number.isFinite(codepoint) &&
      codepoint <= 0x10ffff &&
      !(codepoint >= 0xd800 && codepoint <= 0xdfff) &&
      (isPrintableUnicodeCodepoint(codepoint) ||
        (codepoint >= 32 && codepoint <= 126))
    ) {
      return String.fromCodePoint(codepoint)
    }
  }
  return undefined
}

/**
 * Map keycode to key name for modifyOtherKeys/CSI u sequences.
 * Handles both ASCII keycodes and Kitty keyboard protocol functional keys.
 *
 * Numpad codepoints are from Unicode Private Use Area, defined at:
 * https://sw.kovidgoyal.net/kitty/keyboard-protocol/#functional-key-definitions
 *
 * Non-ASCII printable Unicode (CJK, fullwidth punctuation, etc.) is returned
 * as the actual character so InputEvent can insert it. Without this, IME
 * commits of e.g. fullwidth colon (`：`, U+FF1A) arrive as ESC[65306u and
 * are swallowed as "unmapped Kitty functional keys".
 */
function keycodeToName(keycode: number): string | undefined {
  switch (keycode) {
    case 9:
      return 'tab'
    case 13:
      return 'return'
    case 27:
      return 'escape'
    case 32:
      return 'space'
    case 127:
      return 'backspace'
    // Kitty keyboard protocol numpad keys (KP_0 through KP_9)
    case 57399:
      return '0'
    case 57400:
      return '1'
    case 57401:
      return '2'
    case 57402:
      return '3'
    case 57403:
      return '4'
    case 57404:
      return '5'
    case 57405:
      return '6'
    case 57406:
      return '7'
    case 57407:
      return '8'
    case 57408:
      return '9'
    case 57409: // KP_DECIMAL
      return '.'
    case 57410: // KP_DIVIDE
      return '/'
    case 57411: // KP_MULTIPLY
      return '*'
    case 57412: // KP_SUBTRACT
      return '-'
    case 57413: // KP_ADD
      return '+'
    case 57414: // KP_ENTER
      return 'return'
    case 57415: // KP_EQUAL
      return '='
    default:
      // Printable ASCII characters
      if (keycode >= 32 && keycode <= 126) {
        return String.fromCharCode(keycode).toLowerCase()
      }
      // Printable non-ASCII Unicode (CJK, fullwidth punct, emoji base, …)
      if (isPrintableUnicodeCodepoint(keycode)) {
        return String.fromCodePoint(keycode)
      }
      return undefined
  }
}

export type ParsedKey = {
  kind: 'key'
  fn: boolean
  name: string | undefined
  ctrl: boolean
  meta: boolean
  shift: boolean
  option: boolean
  super: boolean
  sequence: string | undefined
  raw: string | undefined
  code?: string
  isPasted: boolean
}

/** A terminal response sequence (DECRPM, DA1, OSC reply, etc.) parsed
 *  out of the input stream. Not user input — consumers should dispatch
 *  to a response handler. */
export type ParsedResponse = {
  kind: 'response'
  /** Raw escape sequence bytes, for debugging/logging */
  sequence: string
  response: TerminalResponse
}

/** SGR mouse event with coordinates. Emitted for clicks, drags, and
 *  releases (wheel events remain ParsedKey). col/row are 1-indexed
 *  from the terminal sequence (CSI < btn;col;row M/m). */
export type ParsedMouse = {
  kind: 'mouse'
  /** Raw SGR button code. Low 2 bits = button (0=left,1=mid,2=right),
   *  bit 5 (0x20) = drag/motion, bit 6 (0x40) = wheel. */
  button: number
  /** 'press' for M terminator, 'release' for m terminator */
  action: 'press' | 'release'
  /** 1-indexed column (from terminal) */
  col: number
  /** 1-indexed row (from terminal) */
  row: number
  sequence: string
}

/** Everything that can come out of the input parser: a user keypress/paste,
 *  a mouse click/drag event, or a terminal response to a query we sent. */
export type ParsedInput = ParsedKey | ParsedMouse | ParsedResponse

/**
 * Parse an SGR mouse event sequence into a ParsedMouse, or null if not a
 * mouse event or if it's a wheel event (wheel stays as ParsedKey for the
 * keybinding system). Button bit 0x40 = wheel, bit 0x20 = drag/motion.
 */
function parseMouseEvent(s: string): ParsedMouse | null {
  const match = SGR_MOUSE_RE.exec(s)
  if (!match) return null
  const button = parseInt(match[1]!, 10)
  // Wheel events (bit 6 set, low bits 0/1 for up/down) stay as ParsedKey
  // so the keybinding system can route them to scroll handlers.
  if ((button & 0x40) !== 0) return null
  return {
    kind: 'mouse',
    button,
    action: match[4] === 'M' ? 'press' : 'release',
    col: parseInt(match[2]!, 10),
    row: parseInt(match[3]!, 10),
    sequence: s,
  }
}

function parseKeypress(s: string = ''): ParsedKey {
  let parts

  const key: ParsedKey = {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: s,
    raw: s,
    isPasted: false,
  }

  key.sequence = key.sequence || s || key.name

  // Handle CSI u (kitty keyboard protocol), including progressive enhancement:
  // ESC [ code[:shifted[:base]] ; mods[:event] ; text-codepoints u
  // Prefer associated text / shifted codepoint for the inserted character so
  // IME fullwidth punctuation (e.g. `：` U+FF1A) is not dropped.
  //
  // Event-type subparam (official progressive enhancement):
  //   mods:event  →  "1:1" press, "1:2" repeat, "1:3" release
  // Only press (1, default) and repeat (2) produce input. Release must not
  // insert, or press+release would double fullwidth characters.
  let match: RegExpExecArray | null
  if ((match = CSI_U_RE.exec(s))) {
    const primary = firstSubparam(match[1]) ?? 0
    // Modifier field may be "2" or "2:1" (mods:event-type); first subparam wins.
    const modifier = firstSubparam(match[2]) ?? 1
    const mods = decodeModifier(modifier)
    const eventTypeField = match[2]?.includes(':')
      ? parseInt(match[2]!.split(':')[1] ?? '1', 10)
      : 1
    const isRelease = Number.isFinite(eventTypeField) && eventTypeField === 3
    // Official NJc/OJc: AltGr (ctrl+meta) printable → plain text key before
    // functional naming so useTextInput does not route through handleCtrl/Meta.
    // Prefer recovered text codepoint (IME fullwidth) over primary physical key.
    if (!isRelease) {
      const textChar = characterFromCsiUMatch(match)
      const altGrCp =
        textChar !== undefined
          ? textChar.codePointAt(0)!
          : isAltGrPrintableCodepoint(primary)
            ? primary
            : undefined
      if (altGrCp !== undefined && shouldRewriteAltGrAsText(mods, altGrCp)) {
        return altGrTextKey(s, altGrCp, mods.shift)
      }
    }
    // Name for keybindings uses primary codepoint (physical key). The text to
    // insert is recovered later in InputEvent via unicodeFromExtendedKeySequence
    // / key name when printable non-ASCII.
    const mapped = keycodeToName(primary)
    const textChar = isRelease ? undefined : characterFromCsiUMatch(match)
    // Functional names (return/escape/tab/space/backspace/numpad labels) are
    // multi-char and must win for keybindings. Otherwise prefer the recovered
    // text character so ESC[58:65306;2u] inserts `：` rather than `:`.
    // On release, keep the functional/primary name for bindings but InputEvent
    // will clear printable insert (empty textChar + nonAlphanumeric / name).
    const name = mapped && mapped.length > 1 ? mapped : (textChar ?? mapped)
    return {
      kind: 'key',
      name: isRelease && !(mapped && mapped.length > 1) ? '' : name,
      fn: false,
      ctrl: mods.ctrl,
      meta: mods.meta,
      shift: mods.shift,
      option: false,
      super: mods.super,
      sequence: s,
      raw: s,
      isPasted: false,
    }
  }

  // Handle xterm modifyOtherKeys: ESC [ 27 ; modifier ; keycode ~
  // Must run before FN_KEY_RE — FN_KEY_RE only allows 2 params before ~ and
  // would leave the tail as garbage if it partially matched.
  if ((match = MODIFY_OTHER_KEYS_RE.exec(s))) {
    const mods = decodeModifier(parseInt(match[1]!, 10))
    const codepoint = parseInt(match[2]!, 10)
    // Official NJc on modifyOtherKeys: same AltGr rewrite as CSI u.
    if (shouldRewriteAltGrAsText(mods, codepoint)) {
      return altGrTextKey(s, codepoint, mods.shift)
    }
    const name = keycodeToName(codepoint)
    return {
      kind: 'key',
      name,
      fn: false,
      ctrl: mods.ctrl,
      meta: mods.meta,
      shift: mods.shift,
      option: false,
      super: mods.super,
      sequence: s,
      raw: s,
      isPasted: false,
    }
  }

  // SGR mouse wheel events. Click/drag/release events are handled
  // earlier by parseMouseEvent and emitted as ParsedMouse, so they
  // never reach here. Mask with 0x43 (bits 6+1+0) to check wheel-flag
  // + direction while ignoring modifier bits (Shift=0x04, Meta=0x08,
  // Ctrl=0x10) — modified wheel events (e.g. Ctrl+scroll, button=80)
  // should still be recognized as wheelup/wheeldown.
  if ((match = SGR_MOUSE_RE.exec(s))) {
    const button = parseInt(match[1]!, 10)
    if ((button & 0x43) === 0x40) return createNavKey(s, 'wheelup', false)
    if ((button & 0x43) === 0x41) return createNavKey(s, 'wheeldown', false)
    // Shouldn't reach here (parseMouseEvent catches non-wheel) but be safe
    return createNavKey(s, 'mouse', false)
  }

  // X10 mouse: CSI M + 3 raw bytes (Cb+32, Cx+32, Cy+32). Terminals that
  // ignore DECSET 1006 (SGR) but honor 1000/1002 emit this legacy encoding.
  // Button bits match SGR: 0x40 = wheel, low bit = direction. Non-wheel
  // X10 events (clicks/drags) are swallowed here — we only enable mouse
  // tracking in alt-screen and only need wheel for ScrollBox.
  if (s.length === 6 && s.startsWith('\x1b[M')) {
    const button = s.charCodeAt(3) - 32
    if ((button & 0x43) === 0x40) return createNavKey(s, 'wheelup', false)
    if ((button & 0x43) === 0x41) return createNavKey(s, 'wheeldown', false)
    return createNavKey(s, 'mouse', false)
  }

  if (s === '\r') {
    key.raw = undefined
    key.name = 'return'
  } else if (s === '\n') {
    key.name = 'enter'
  } else if (s === '\t') {
    key.name = 'tab'
  } else if (s === '\b' || s === '\x1b\b') {
    key.name = 'backspace'
    key.meta = s.charAt(0) === '\x1b'
  } else if (s === '\x7f' || s === '\x1b\x7f') {
    key.name = 'backspace'
    key.meta = s.charAt(0) === '\x1b'
  } else if (s === '\x1b' || s === '\x1b\x1b') {
    key.name = 'escape'
    key.meta = s.length === 2
  } else if (s === ' ' || s === '\x1b ') {
    key.name = 'space'
    key.meta = s.length === 2
  } else if (s === '\x1f') {
    key.name = '_'
    key.ctrl = true
  } else if (s <= '\x1a' && s.length === 1) {
    key.name = String.fromCharCode(s.charCodeAt(0) + 'a'.charCodeAt(0) - 1)
    key.ctrl = true
  } else if (s.length === 1 && s >= '0' && s <= '9') {
    key.name = 'number'
  } else if (s.length === 1 && s >= 'a' && s <= 'z') {
    key.name = s
  } else if (s.length === 1 && s >= 'A' && s <= 'Z') {
    key.name = s.toLowerCase()
    key.shift = true
  } else if ((parts = META_KEY_CODE_RE.exec(s))) {
    key.meta = true
    key.shift = /^[A-Z]$/.test(parts[1]!)
  } else if ((parts = FN_KEY_RE.exec(s))) {
    const segs = [...s]

    if (segs[0] === '\u001b' && segs[1] === '\u001b') {
      key.option = true
    }

    const code = [parts[1], parts[2], parts[4], parts[6]]
      .filter(Boolean)
      .join('')

    const modifier = ((parts[3] || parts[5] || 1) as number) - 1

    key.ctrl = !!(modifier & 4)
    key.meta = !!(modifier & 2)
    key.super = !!(modifier & 8)
    key.shift = !!(modifier & 1)
    key.code = code

    key.name = keyName[code]
    key.shift = isShiftKey(code) || key.shift
    key.ctrl = isCtrlKey(code) || key.ctrl
  }

  // iTerm in natural text editing mode
  if (key.raw === '\x1Bb') {
    key.meta = true
    key.name = 'left'
  } else if (key.raw === '\x1Bf') {
    key.meta = true
    key.name = 'right'
  }

  switch (s) {
    case '\u001b[1~':
      return createNavKey(s, 'home', false)
    case '\u001b[4~':
      return createNavKey(s, 'end', false)
    case '\u001b[5~':
      return createNavKey(s, 'pageup', false)
    case '\u001b[6~':
      return createNavKey(s, 'pagedown', false)
    case '\u001b[1;5D':
      return createNavKey(s, 'left', true)
    case '\u001b[1;5C':
      return createNavKey(s, 'right', true)
  }

  return key
}

function createNavKey(s: string, name: string, ctrl: boolean): ParsedKey {
  return {
    kind: 'key',
    name,
    ctrl,
    meta: false,
    shift: false,
    option: false,
    super: false,
    fn: false,
    sequence: s,
    raw: s,
    isPasted: false,
  }
}
