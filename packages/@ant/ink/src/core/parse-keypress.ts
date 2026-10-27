/**
 * Keyboard input parser - converts terminal input to key events
 *
 * Uses the termio tokenizer for escape sequence boundary detection,
 * then interprets sequences as keypresses.
 */
import { Buffer } from 'buffer'
import { familyFromTerm } from './terminalCapabilities.js'
import { attacherCaps } from './termio/osc.js'
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
// Gold `gs`: ESC [ code[:shifted[:base]] ; mods u
//   ESC[58:65306;2u  primary ":" (58), shifted U+FF1A, shift
// Field 1 has exactly three slots. There is no third `;text` field.
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const CSI_U_RE = /^\x1b\[(\d+)(?::(\d*)(?::(\d+))?)?(?:;(\d+))?u/

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
// XTWINOPS cell size: CSI 6 ; height ; width t  — answer to CSI 16 t.
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const CELL_SIZE_RE = /^\x1b\[6;(\d+);(\d+)t$/
// densable theme notify: CSI ? 997 ; 1 n (dark) / CSI ? 997 ; 2 n (light)
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const THEME_NOTIFY_RE = /^\x1b\[\?997;([12])n$/
// OSC response: OSC code ; data (BEL|ST)
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const OSC_RESPONSE_RE = /^\x1b\](\d+);(.*?)(?:\x07|\x1b\\)$/s
// XTVERSION: DCS > | name ST  — terminal name/version string (answer to CSI > 0 q).
// xterm.js replies "xterm.js(X.Y.Z)"; Ghostty, kitty, iTerm2, etc. reply with
// their own name. Unlike TERM_PROGRAM, this survives SSH since the query/reply
// goes through the pty, not the environment.
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const XTVERSION_RE = /^\x1bP>\|(.*?)(?:\x07|\x1b\\)$/s
// densable `rx` — kitty APC graphics reply ESC _ G … i=id … ; message ST
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const KITTY_GRAPHICS_RE = /^\x1b_G(?:[^;]*,)?i=(\d+)[^;]*;(.*?)\x1b\\$/s
// SGR mouse event: CSI < button ; col ; row M (press) or m (release)
// Button codes: 64=wheel-up, 65=wheel-down (0x40 | wheel-bit).
// Button 32=left-drag (0x20 | motion-bit). Plain 0/1/2 = left/mid/right click.
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(-?\d+);(-?\d+)([Mm])$/
// densable 2.1.239 Qpr / Xyf / mwS / hwS — split mouse reports across writes.
// Incomplete ESC[ < digits;  prefix is held (not flushed as typed keys).
// Completed prefix is dropped (changelog "35;150;7M"), not pendingSgr invent.
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const INCOMPLETE_SGR_MOUSE_PREFIX_RE = /^\x1b\[<[\d;-]*$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const COMPLETED_SGR_MOUSE_PREFIX_RE = /^\x1b\[<[\d;-]*[Mm]/
/** densable hwS — max length still treated as a held incomplete SGR prefix. */
const HELD_SGR_MOUSE_PREFIX_MAX = 32
/** densable 2.1.247 jM — completed SGR after flushed ESC / ESC[. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const FLUSHED_ESCAPE_MOUSE_COMPLETE_RE = /^\x1b\[<\d+;-?\d+;-?\d+[Mm]/
// densable 2.1.228 kTd text-branch orphan mouse recovery (was ZXc):
// whole-token only — not prefix peel, not multi-event burst, not embedded.
//   /^\[<\d+;\d+;\d+[Mm]$/   SGR
//   /^\[M[\x60-\x7f][\x20-\uffff]{2}$/  X10 wheel payload
// Bursts / incomplete / param residue stay one text key.
const ORPHAN_SGR_WHOLE_TOKEN_RE = /^\[<\d+;-?\d+;-?\d+[Mm]$/
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
 * Gold `Vy` / jog — codepoints that may be AltGr text or the CSI-u shifted
 * slot. Printable ASCII, or 160 ≤ n < 55296 (stops before surrogates).
 * Fullwidth (U+FF00–) is NOT in this range; IME commits arrive as UTF-8.
 */
function isAltGrPrintableCodepoint(codepoint: number): boolean {
  return (
    (codepoint > 32 && codepoint < 127) ||
    (codepoint >= 160 && codepoint < 55296)
  )
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
  }
}

function createPaste(content: string): ParsedPaste {
  return { kind: 'paste', text: content }
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
  /** densable theme notify — DEC 2031 report. `dark` is true for `?997;1n`. */
  | { type: 'themeNotify'; dark: boolean }
  /** OSC response: generic operating-system-command reply (e.g. OSC 11 bg color) */
  | { type: 'osc'; code: number; data: string }
  /** XTVERSION: terminal name/version string (answer to CSI > 0 q).
   *  Example values: "xterm.js(5.5.0)", "ghostty 1.2.0", "iTerm2 3.6". */
  | { type: 'xtversion'; name: string }
  /** densable `cellSize` — XTWINOPS CSI 16 t reply (`CSI 6 ; height ; width t`). */
  | { type: 'cellSize'; height: number; width: number }
  /** densable `kittyGraphics` — APC `_G` query reply (`igo` id=31). */
  | { type: 'kittyGraphics'; id: number; message: string }

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

    if ((m = THEME_NOTIFY_RE.exec(s))) {
      return { type: 'themeNotify', dark: m[1] === '1' }
    }

    if ((m = CELL_SIZE_RE.exec(s))) {
      return {
        type: 'cellSize',
        height: parseInt(m[1]!, 10),
        width: parseInt(m[2]!, 10),
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

  // densable APC `_G` kitty graphics query reply
  if (s.startsWith('\x1b_')) {
    const m = KITTY_GRAPHICS_RE.exec(s)
    if (m) {
      return {
        type: 'kittyGraphics',
        id: parseInt(m[1]!, 10),
        message: m[2]!,
      }
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
  /**
   * densable 2.1.247 flushedEscapePrefix — ESC / ESC[ parked on flush.
   * Next text is prepended so `<35;150;7M` completes SGR instead of typing.
   */
  flushedEscapePrefix: string
  /**
   * densable `win32HighSurrogate` — gold `Hy` holds a UTF-16 high surrogate
   * until the matching low-surrogate CSI _ arrives.
   */
  win32HighSurrogate?: string
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
  flushedEscapePrefix: '',
  win32HighSurrogate: '',
}

/** densable `vd`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const INCOMPLETE_SGR_MOUSE_CSI_RE = /^\x1b\[<[\d;-]*$/
/** densable `ux`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const INCOMPLETE_CSI_GENERIC_RE = /^\x1b\[(?:[0-9:;]+|[<=>?][0-9:;]*[ -/]*)$/
/** densable `cx`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const INCOMPLETE_OSC_DCS_APC_RE = /^\x1b(?:\][0-9]|P[0-9>|$+=!]|_G)[^\x07]*$/s
const INCOMPLETE_OSC_MAX = 256
const INCOMPLETE_CSI_GENERIC_MAX = 64

/** densable `md` / `zl` — hold incomplete CSI/OSC, not only Qpr SGR. */
export function isHeldIncompleteSequence(value: string): boolean {
  if (INCOMPLETE_SGR_MOUSE_CSI_RE.test(value)) {
    return value.length <= HELD_SGR_MOUSE_PREFIX_MAX
  }
  if (INCOMPLETE_OSC_DCS_APC_RE.test(value)) {
    return value.length <= INCOMPLETE_OSC_MAX
  }
  return (
    value.length <= INCOMPLETE_CSI_GENERIC_MAX &&
    INCOMPLETE_CSI_GENERIC_RE.test(value)
  )
}

/** densable Qpr — SGR subset of `zl`. */
function isHeldSgrMousePrefix(value: string): boolean {
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

/** densable `Wy` — `nu()?.keyDialect ?? gst(TERM)`. */
function Wy(): string | null {
  const dialect = attacherCaps()?.keyDialect
  if (dialect !== undefined) return dialect
  return familyFromTerm(process.env.TERM)
}

/** densable `mx` — `Wy()==="st"`. */
function isStTerm(): boolean {
  return Wy() === 'st'
}

/** densable `px` — `Wy()==="rxvt"`. */
function isRxvtEscPrefixedAlt(): boolean {
  return Wy() === 'rxvt'
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
    code = parseInt(csi[1]!, 10)
    mods = csi[4] === undefined ? undefined : parseInt(csi[4], 10)
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
  return code
}

export function parseMultipleKeypresses(
  prevState: KeyParseState,
  input: Buffer | string | null = '',
): [ParsedInput[], KeyParseState] {
  const isFlush = input === null
  const inputString = isFlush ? '' : inputToString(input)

  // densable Qyf: `$me({x10Mouse:!0,escPrefixedKeyIsAlt:px})`
  const tokenizer =
    prevState._tokenizer ??
    createTokenizer({
      x10Mouse: true,
      escPrefixedKeyIsAlt: isRxvtEscPrefixedAlt,
    })
  let droppedMousePrefix = prevState.droppedMousePrefix ?? ''
  // densable 2.1.247 qb: f is only written on flush; m is the working copy.
  let flushedEscapePrefix = isFlush ? (prevState.flushedEscapePrefix ?? '') : ''
  let flushedEscapeWorking = prevState.flushedEscapePrefix ?? ''
  let tokens: Token[]
  if (isFlush && prevState.mode !== 'IN_PASTE') {
    const held = tokenizer.buffer()
    if (isHeldIncompleteSequence(held)) {
      tokens = []
    } else if (INCOMPLETE_SGR_MOUSE_PREFIX_RE.test(held)) {
      tokenizer.reset()
      droppedMousePrefix = held
      tokens = []
    } else {
      if (held === '\x1b' || held === '\x1b[') {
        flushedEscapePrefix = held
      }
      tokens = tokenizer.flush()
    }
  } else {
    tokens = isFlush ? tokenizer.flush() : tokenizer.feed(inputString)
  }

  const keys: ParsedInput[] = []
  let inPaste = prevState.mode === 'IN_PASTE'
  let pasteBuffer = prevState.pasteBuffer
  // Gold `qy` keeps the same array identity until a high-byte run mutates it.
  // `Ed` uses `g.pendingByteEvents!==R.pendingByteEvents` to extend Fl.
  let pendingByteEvents: PendingByteEvent[] = prevState.pendingByteEvents
  let win32HighSurrogate = prevState.win32HighSurrogate ?? ''

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
      // densable 2.1.247 qb: sequence also clears flushedEscape working copy.
      droppedMousePrefix = ''
      flushedEscapeWorking = ''
      if (token.value === PASTE_START) {
        flushPendingBytes()
        inPaste = true
        pasteBuffer = ''
      } else if (token.value === PASTE_END) {
        flushPendingBytes()
        // Always emit a paste key, even for empty pastes (clipboard image path).
        keys.push(createPaste(pasteBuffer))
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
        const win32Keys = parseWin32Input(token.value, win32HighSurrogate)
        if (win32Keys) {
          flushPendingBytes()
          win32HighSurrogate = win32Keys.highSurrogate
          for (const seq of win32Keys.sequences) {
            keys.push(parseKeypress(seq))
          }
          continue
        }
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
        if (token.value === FOCUS_IN || token.value === FOCUS_OUT) {
          keys.push({ kind: 'focus', focused: token.value === FOCUS_IN })
          continue
        }
        // densable: incomplete CSI flush becomes a sequence → U_n (parseKeypress).
        // Qpr hold is on flush (above), not here.
        keys.push(parseKeypress(token.value))
      }
    } else if (token.type === 'text') {
      // densable: d() before text.
      flushPendingBytes()
      let text = token.value
      if (!inPaste && flushedEscapeWorking) {
        const combined = flushedEscapeWorking + text
        flushedEscapeWorking = ''
        const completed = FLUSHED_ESCAPE_MOUSE_COMPLETE_RE.exec(combined)
        if (completed) {
          const mouse = parseMouseEvent(completed[0])
          keys.push(mouse ?? parseKeypress(completed[0]))
          text = combined.slice(completed[0].length)
          if (!text) continue
        }
      }
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
        emitParsedTextKeys(keys, text)
      }
    }
  }

  // densable: if(r) d(); if(r&&a) emit paste.
  if (isFlush) {
    flushPendingBytes()
    if (inPaste && pasteBuffer) {
      keys.push(createPaste(pasteBuffer))
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
    flushedEscapePrefix,
    win32HighSurrogate,
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
 * densable 2.1.243 `zb` — kitty / modifyOtherKeys report Ctrl+[ / Ctrl+M /
 * Ctrl+I / Ctrl+H as `ctrl` + printable instead of the historical terminal
 * equivalent (Escape / Return / Tab / Backspace). Remap only for bare Ctrl
 * (no shift/meta/super) so vim INSERT can leave on Ctrl+[.
 */
export function traditionalCtrlAliasName(
  mods: { ctrl: boolean; shift: boolean; meta: boolean; super: boolean },
  keycode: number,
): string | undefined {
  if (!mods.ctrl || mods.shift || mods.meta || mods.super) return undefined
  switch (keycode) {
    case 91:
      return 'escape'
    case 109:
    case 77:
      return 'return'
    case 105:
    case 73:
      return 'tab'
    case 104:
    case 72:
      return 'backspace'
    default:
      return undefined
  }
}

/**
 * Gold `Xy`: shifted slot (field 1, subparam 2) only when `Vy`.
 * `Vy` stops before surrogates, so U+FF0C is not this slot.
 * IME fullwidth commits arrive as UTF-8 (KeyboardEvent length 1) under `>5u`.
 */
export function shiftedKeyFromCsiUSequence(
  sequence: string | undefined,
): string | undefined {
  if (!sequence) return undefined
  const match = CSI_U_RE.exec(sequence)
  if (!match?.[2]) return undefined
  const codepoint = parseInt(match[2], 10)
  if (!isAltGrPrintableCodepoint(codepoint)) return undefined
  return String.fromCodePoint(codepoint)
}

/**
 * Gold `Rx`: paste converts CSI u / modifyOtherKeys to the primary codepoint.
 * Any scalar ≤ U+10FFFF, including the private-use area. Surrogates are not
 * scalars; gold `fromCodePoint` throws, this returns the original sequence.
 * Unparsed input is returned unchanged.
 */
export function unicodeFromExtendedKeySequence(
  sequence: string | undefined,
): string | undefined {
  if (!sequence) return undefined
  const csi = CSI_U_RE.exec(sequence)
  const mok = csi ? null : MODIFY_OTHER_KEYS_RE.exec(sequence)
  if (!csi && !mok) return sequence
  const codepoint = csi ? parseInt(csi[1]!, 10) : parseInt(mok![2]!, 10)
  const mods = csi
    ? csi[4] === undefined
      ? 1
      : parseInt(csi[4], 10)
    : parseInt(mok![1]!, 10)
  if (!Number.isFinite(codepoint) || codepoint > 0x10ffff) return sequence
  if (codepoint >= 0xd800 && codepoint <= 0xdfff) return sequence
  const decoded = decodeModifier(Number.isFinite(mods) && mods >= 1 ? mods : 1)
  if (decoded.ctrl) {
    switch (codepoint) {
      case 105:
      case 73:
        return '\t'
      case 106:
      case 74:
        return '\n'
      case 109:
      case 77:
        return '\r'
    }
  }
  return String.fromCodePoint(codepoint)
}

/**
 * Map keycode to key name for modifyOtherKeys/CSI u sequences.
 * Handles both ASCII keycodes and Kitty keyboard protocol functional keys.
 *
 * Numpad codepoints are from Unicode Private Use Area, defined at:
 * https://sw.kovidgoyal.net/kitty/keyboard-protocol/#functional-key-definitions
 *
 * Gold `Fy` names printable non-ASCII only for 160 ≤ n < 55296.
 * Fullwidth (U+FF00–) is unnamed. A nameless ESC sequence does not insert.
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
    case 57416: // KP_SEPARATOR
      return ','
    case 57417:
      return 'left'
    case 57418:
      return 'right'
    case 57419:
      return 'up'
    case 57420:
      return 'down'
    case 57421:
      return 'pageup'
    case 57422:
      return 'pagedown'
    case 57423:
      return 'home'
    case 57424:
      return 'end'
    case 57425:
      return 'insert'
    case 57426:
      return 'delete'
    default:
      // Printable ASCII characters
      if (keycode >= 32 && keycode <= 126) {
        return String.fromCharCode(keycode).toLowerCase()
      }
      // Gold Fy: printable non-ASCII stops before surrogates. Fullwidth
      // (U+FF00–) and emoji are unnamed here; the shifted slot carries them.
      if (keycode >= 160 && keycode < 55296) {
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
  /**
   * densable SGR wheel `col` — 1-indexed. Pixel reports stay raw until App `S1`.
   */
  col?: number
  /** densable SGR wheel `row` — 1-indexed. */
  row?: number
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
export type ParsedPaste = {
  kind: 'paste'
  text: string
}

export type ParsedFocus = {
  kind: 'focus'
  focused: boolean
}

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
  /**
   * densable `fine` — unfloored cell-space coords after App `b1`/`Fd`.
   * Parser itself does not convert; SGR-Pixels still fills col/row as the
   * three CSI fields (pixels when DEC 1016 is live).
   */
  fine?: { col: number; row: number }
}

/** Everything that can come out of the input parser: a user keypress/paste,
 *  a mouse click/drag event, a focus report, or a terminal response. */
export type ParsedInput =
  | ParsedKey
  | ParsedMouse
  | ParsedResponse
  | ParsedPaste
  | ParsedFocus

/**
 * Parse an SGR mouse event sequence into a ParsedMouse, or null if not a
 * mouse event or if it's a wheel event (wheel stays as ParsedKey for the
 * keybinding system). Button bit 0x40 = wheel, bit 0x20 = drag/motion.
 */
/**
 * densable `Hy` — Windows conhost CSI _ (`ESC [ vk ; sc ; uc ; kd ; cs ; rc _`).
 * Gold: official-289 SEA @193225902.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequence parsing
const WIN32_INPUT_RE = /^\x1b\[(\d*(?:;\d*){0,5})_$/
const WIN32_SHIFT_BITS = 1 | 2
const WIN32_CTRL_BITS = 4 | 8
const WIN32_ALT_BIT = 16
const WIN32_VK_BACK = 8
const WIN32_VK_TAB = 9
const WIN32_VK_RETURN = 13
const WIN32_VK_CONTROL = 18
const WIN32_VK_ESCAPE = 27
const WIN32_VK_SPACE = 32
const WIN32_VK_F1 = 112
const WIN32_VK_F4 = 115
const WIN32_VK_F5 = 116
const WIN32_VK_F12 = 123
const WIN32_REPEAT_MAX = 8
const WIN32_NAMED_VK: Record<
  number,
  { code: number; final: string } | undefined
> = {
  33: { code: 5, final: '~' },
  34: { code: 6, final: '~' },
  35: { code: 1, final: 'F' },
  36: { code: 1, final: 'H' },
  37: { code: 1, final: 'D' },
  38: { code: 1, final: 'A' },
  39: { code: 1, final: 'C' },
  40: { code: 1, final: 'B' },
  45: { code: 2, final: '~' },
  46: { code: 3, final: '~' },
}
const WIN32_F5_CODES = [15, 17, 18, 19, 20, 21, 23, 24]

function win32Param(parts: string[], index: number, fallback: number): number {
  const raw = parts[index]
  return raw === undefined || raw === '' ? fallback : parseInt(raw, 10)
}

function win32Repeat(
  count: number,
  sequence: string,
): {
  sequences: string[]
  highSurrogate: string
} {
  return { sequences: Array(count).fill(sequence), highSurrogate: '' }
}

/** densable `Xa` — params joined with `;`, final byte appended. */
function win32Csi(...parts: Array<number | string>): string {
  const final = parts.at(-1) ?? ''
  const params = parts.slice(0, -1)
  return `\x1b[${params.join(';')}${final}`
}

function win32CtrlChar(code: number): number {
  if (code < 32) return code
  if ((code >= 64 && code <= 95) || (code >= 97 && code <= 122))
    return code & 31
  switch (code) {
    case 32:
    case 50:
      return 0
    case 51:
    case 52:
    case 53:
    case 54:
    case 55:
      return code - 51 + 27
    case 56:
    case 63:
      return 127
    case 47:
      return 31
    default:
      return code
  }
}

function parseWin32Input(
  sequence: string,
  highSurrogate: string,
): { sequences: string[]; highSurrogate: string } | null {
  const match = WIN32_INPUT_RE.exec(sequence)
  if (!match) return null
  const parts = match[1]!.split(';')
  const vk = win32Param(parts, 0, 0)
  const unicode = win32Param(parts, 2, 0)
  const keyDown = win32Param(parts, 3, 0) !== 0
  const controlState = win32Param(parts, 4, 0)
  const repeat = Math.min(
    Math.max(win32Param(parts, 5, 1), 1),
    WIN32_REPEAT_MAX,
  )
  if (!keyDown) {
    if (vk === WIN32_VK_CONTROL && unicode !== 0) {
      return { sequences: [String.fromCharCode(unicode)], highSurrogate: '' }
    }
    return { sequences: [], highSurrogate }
  }
  const shift = (controlState & WIN32_SHIFT_BITS) !== 0
  const ctrl = (controlState & WIN32_CTRL_BITS) !== 0
  const alt = (controlState & WIN32_ALT_BIT) !== 0
  const ctrlShiftLetter = shift && ctrl && unicode > 32 && unicode !== 127
  const ctrlOnly = ctrl && !ctrlShiftLetter
  const shiftOnly = shift && !ctrlShiftLetter
  const mods = 1 + (alt ? 1 : 0) + (shiftOnly ? 2 : 0) + (ctrlOnly ? 4 : 0)
  const named = WIN32_NAMED_VK[vk]
  if (named) {
    if (named.final === '~') {
      return win32Repeat(
        repeat,
        mods === 1
          ? win32Csi(named.code, '~')
          : win32Csi(named.code, mods, '~'),
      )
    }
    return win32Repeat(
      repeat,
      mods === 1 ? win32Csi(named.final) : win32Csi(1, mods, named.final),
    )
  }
  if (vk >= WIN32_VK_F1 && vk <= WIN32_VK_F4) {
    const letter = String.fromCharCode(80 + (vk - WIN32_VK_F1))
    return win32Repeat(
      repeat,
      mods === 1 ? `\x1bO${letter}` : win32Csi(1, mods, letter),
    )
  }
  if (vk >= WIN32_VK_F5 && vk <= WIN32_VK_F12) {
    const code = WIN32_F5_CODES[vk - WIN32_VK_F5]!
    return win32Repeat(
      repeat,
      mods === 1 ? win32Csi(code, '~') : win32Csi(code, mods, '~'),
    )
  }
  const meta = shiftOnly ? '\x1b' : ''
  switch (vk) {
    case WIN32_VK_BACK:
      return win32Repeat(repeat, meta + (ctrlOnly ? '\b' : '\x7f'))
    case WIN32_VK_TAB:
      return win32Repeat(repeat, meta + (alt ? win32Csi('Z') : '\t'))
    case WIN32_VK_RETURN:
      return win32Repeat(repeat, meta + (ctrlOnly ? '\n' : '\r'))
    case WIN32_VK_ESCAPE:
      return win32Repeat(repeat, meta + '\x1b')
    default:
      break
  }
  let charCode = unicode
  if (ctrlOnly && vk === WIN32_VK_SPACE) charCode = 0
  else if (charCode === 0) {
    const isLetter = vk >= 65 && vk <= 90
    const isDigit = vk >= 48 && vk <= 57
    if (!(ctrlOnly || shiftOnly) || !(isLetter || isDigit)) {
      return { sequences: [], highSurrogate }
    }
    charCode = isLetter && !alt ? vk + 32 : vk
    if (ctrlOnly) charCode = win32CtrlChar(charCode)
  } else if (ctrlOnly) {
    charCode = win32CtrlChar(charCode)
  }
  if (charCode >= 0xd800 && charCode <= 0xdbff) {
    return { sequences: [], highSurrogate: String.fromCharCode(charCode) }
  }
  let chars = String.fromCharCode(charCode)
  if (charCode >= 0xdc00 && charCode <= 0xdfff) {
    if (!highSurrogate) return { sequences: [], highSurrogate: '' }
    chars = highSurrogate + chars
  }
  return win32Repeat(repeat, meta + chars)
}

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

/**
 * Tokenizer only peels C0 when the whole chunk is under 64 bytes (gold D).
 * A long read of text plus CR stays one text token; split CR/LF so
 * parseKeypress still sees a lone CR/LF and names return/enter.
 */
function emitParsedTextKeys(keys: ParsedInput[], text: string): void {
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code !== 13 && code !== 10) continue
    if (i > start) keys.push(parseKeypress(text.slice(start, i)))
    if (code === 13 && text.charCodeAt(i + 1) === 10) {
      keys.push(parseKeypress('\r'))
      i++
    } else {
      keys.push(parseKeypress(text[i]!))
    }
    start = i + 1
  }
  if (start < text.length) keys.push(parseKeypress(text.slice(start)))
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
  }

  key.sequence = key.sequence || s || key.name

  // Gold `ko` CSI u: ESC [ code[:shifted[:base]] ; mods u
  // Name is Fy(primary), or the base-layout key under Ctrl. The shifted
  // glyph (「，」) is not the name — KeyboardEvent.key reads it via Xy.
  let match: RegExpExecArray | null
  if ((match = CSI_U_RE.exec(s))) {
    const primary = parseInt(match[1]!, 10)
    const modifier = match[4] === undefined ? 1 : parseInt(match[4], 10)
    const mods = decodeModifier(Number.isFinite(modifier) ? modifier : 1)
    if (shouldRewriteAltGrAsText(mods, primary)) {
      return altGrTextKey(s, primary, mods.shift)
    }
    const baseLayoutKey = match[3] ? parseInt(match[3], 10) : undefined
    const usedBaseLayoutKey =
      mods.ctrl &&
      primary > 127 &&
      baseLayoutKey !== undefined &&
      Number.isFinite(baseLayoutKey)
    const namedCode = usedBaseLayoutKey ? baseLayoutKey : primary
    const remapped = traditionalCtrlAliasName(mods, namedCode)
    const name = remapped ?? keycodeToName(namedCode)
    return {
      kind: 'key',
      name,
      fn: false,
      ctrl: remapped === undefined && mods.ctrl,
      meta: mods.meta,
      shift: mods.shift,
      option: false,
      super: mods.super,
      sequence: s,
      raw: s,
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
    const remapped = traditionalCtrlAliasName(mods, codepoint)
    const name = remapped ?? keycodeToName(codepoint)
    return {
      kind: 'key',
      name,
      fn: false,
      ctrl: remapped === undefined && mods.ctrl,
      meta: mods.meta,
      shift: mods.shift,
      option: false,
      super: mods.super,
      sequence: s,
      raw: s,
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
    const col = parseInt(match[2]!, 10)
    const row = parseInt(match[3]!, 10)
    if ((button & 0x43) === 0x40) {
      return createNavKey(s, 'wheelup', false, col, row)
    }
    if ((button & 0x43) === 0x41) {
      return createNavKey(s, 'wheeldown', false, col, row)
    }
    // Shouldn't reach here (parseMouseEvent catches non-wheel) but be safe
    return createNavKey(s, 'mouse', false, col, row)
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

    // densable: `g==="[P"&&x===0&&mx()?"delete":Ex[g]`
    key.name =
      code === '[P' && modifier === 0 && isStTerm() ? 'delete' : keyName[code]
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

function createNavKey(
  s: string,
  name: string,
  ctrl: boolean,
  col?: number,
  row?: number,
): ParsedKey {
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
    ...(col !== undefined && row !== undefined ? { col, row } : {}),
  }
}
