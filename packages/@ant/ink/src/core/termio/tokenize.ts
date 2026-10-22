/**
 * Input Tokenizer - Escape sequence boundary detection
 *
 * densable `$me` / `D`. Gold: official-289 SEA @180290924.
 */

import { C0, ESC_TYPE, isEscFinal } from './ansi.js'
import { isCSIFinal, isCSIIntermediate, isCSIParam } from './csi.js'

export type Token =
  | { type: 'text'; value: string }
  | { type: 'sequence'; value: string }

type State =
  | 'ground'
  | 'escape'
  | 'escapeIntermediate'
  | 'csi'
  | 'ss3'
  | 'osc'
  | 'dcs'
  | 'apc'
  | 'pm'
  | 'sos'

export type Tokenizer = {
  feed(input: string): Token[]
  flush(): Token[]
  reset(): void
  buffer(): string
}

export type TokenizerOptions = {
  x10Mouse?: boolean
  forOutput?: boolean
  /**
   * densable `escPrefixedKeyIsAlt` — gold `px` (`Wy()==="rxvt"`).
   * When true, ESC ESC + CSI/SS3 arrow is a lone ESC (alt prefix), not a restart.
   */
  escPrefixedKeyIsAlt?: () => boolean
  /**
   * densable `stringsEndAtLineFeed` — gold Lu wrap path. OSC-8 at LF emits ST.
   */
  stringsEndAtLineFeed?: boolean
}

/** densable `K`. */
const INCOMPLETE_X10_BEFORE_DEL_RE = /^\[M[\x60-\x7f][\u0020-\uffff]?$/
/** densable `C`. */
const KITTY_GRAPHICS_APC_PREFIX = 'Gi='
/** densable `G`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal OSC-8
const OSC8_AT_LF_RE = /^\x1b\]8(?:;|\r?$)/
/** densable `Y`. */
const OSC8_ST = '\x1b]8;;\x1b\\'
/** densable `z`. */
const RXVT_ALT_KEY_RE =
  /^(?:\[(?:\d{1,2}(?:;\d{1,2})?[~^$@]|(?:1;\d{1,2})?[A-DFHa-d])|O[A-DFHa-d])/

/** densable `A` — `$me({forOutput:!0})` then feed+flush. */
export function tokenizeForOutput(input: string): Token[] {
  const tokenizer = createTokenizer({ forOutput: true })
  const tokens = tokenizer.feed(input)
  tokens.push(...tokenizer.flush())
  return tokens
}

export function createTokenizer(options?: TokenizerOptions): Tokenizer {
  let currentState: State = 'ground'
  let currentBuffer = ''
  const x10Mouse = options?.x10Mouse ?? false
  const forOutput = options?.forOutput ?? false
  const escPrefixedKeyIsAlt = options?.escPrefixedKeyIsAlt
  const stringsEndAtLineFeed = options?.stringsEndAtLineFeed ?? false

  return {
    feed(input: string): Token[] {
      const result = tokenize(
        input,
        currentState,
        currentBuffer,
        false,
        x10Mouse,
        forOutput,
        escPrefixedKeyIsAlt?.() ?? false,
        stringsEndAtLineFeed,
      )
      currentState = result.state.state
      currentBuffer = result.state.buffer
      return result.tokens
    },

    flush(): Token[] {
      const result = tokenize(
        '',
        currentState,
        currentBuffer,
        true,
        x10Mouse,
        forOutput,
        escPrefixedKeyIsAlt?.() ?? false,
        stringsEndAtLineFeed,
      )
      currentState = result.state.state
      currentBuffer = result.state.buffer
      return result.tokens
    },

    reset(): void {
      currentState = 'ground'
      currentBuffer = ''
    },

    buffer(): string {
      return currentBuffer
    },
  }
}

type InternalState = {
  state: State
  buffer: string
}

function tokenize(
  input: string,
  initialState: State,
  initialBuffer: string,
  flush: boolean,
  x10Mouse: boolean,
  forOutput: boolean,
  escPrefixedKeyIsAlt: boolean,
  stringsEndAtLineFeed: boolean,
): { tokens: Token[]; state: InternalState } {
  const tokens: Token[] = []
  const result: InternalState = {
    state: initialState,
    buffer: '',
  }

  const data = initialBuffer + input
  let i = 0
  let textStart = 0
  let seqStart = 0

  const flushText = (): void => {
    if (i > textStart) {
      const text = data.slice(textStart, i)
      if (text) tokens.push({ type: 'text', value: text })
    }
    textStart = i
  }

  const emitSequence = (seq: string): void => {
    if (seq) tokens.push({ type: 'sequence', value: seq })
    result.state = 'ground'
    textStart = i
  }

  while (i < data.length) {
    const code = data.charCodeAt(i)
    switch (result.state) {
      case 'ground':
        if (code === C0.ESC) {
          flushText()
          seqStart = i
          result.state = 'escape'
          i++
        } else if (code === C0.DEL) {
          if (INCOMPLETE_X10_BEFORE_DEL_RE.test(data.slice(textStart, i))) {
            i++
          } else {
            flushText()
            i++
            tokens.push({ type: 'text', value: '\x7f' })
            textStart = i
          }
        } else if (
          !forOutput &&
          code < 32 &&
          (data.length < 64 || code === C0.BS)
        ) {
          flushText()
          i++
          if (code === C0.CR && data.charCodeAt(i) === C0.LF) i++
          tokens.push({ type: 'text', value: String.fromCharCode(code) })
          textStart = i
        } else {
          i++
        }
        break

      case 'escape':
        if (code === ESC_TYPE.CSI) {
          result.state = 'csi'
          i++
        } else if (code === ESC_TYPE.OSC) {
          result.state = 'osc'
          i++
        } else if (code === ESC_TYPE.DCS) {
          result.state = 'dcs'
          i++
        } else if (
          code === ESC_TYPE.APC &&
          (!x10Mouse ||
            i + 1 >= data.length ||
            data[i + 1] === KITTY_GRAPHICS_APC_PREFIX[0])
        ) {
          result.state = 'apc'
          i++
        } else if (!x10Mouse && code === ESC_TYPE.PM) {
          result.state = 'pm'
          i++
        } else if (!x10Mouse && (code === ESC_TYPE.SOS || code === 107)) {
          result.state = 'sos'
          i++
        } else if (code === 0x4f) {
          result.state = 'ss3'
          i++
        } else if (
          x10Mouse &&
          (code === 32 || code === 13 || code === 10 || code === 9)
        ) {
          i++
          tokens.push({ type: 'text', value: data.slice(seqStart, i) })
          result.state = 'ground'
          textStart = i
        } else if (x10Mouse && isCSIIntermediate(code)) {
          tokens.push({ type: 'text', value: data.slice(seqStart, i) })
          result.state = 'ground'
          textStart = i
        } else if (isCSIIntermediate(code)) {
          result.state = 'escapeIntermediate'
          i++
        } else if (code === C0.DEL) {
          i++
          tokens.push({ type: 'text', value: data.slice(seqStart, i) })
          result.state = 'ground'
          textStart = i
        } else if (isEscFinal(code)) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (
          code === C0.ESC &&
          escPrefixedKeyIsAlt &&
          i === seqStart + 1 &&
          RXVT_ALT_KEY_RE.test(data.slice(i + 1, i + 1 + 8))
        ) {
          i++
        } else if (code === C0.ESC) {
          emitSequence(data.slice(seqStart, i))
          seqStart = i
          result.state = 'escape'
          i++
        } else if (code < 32) {
          i++
          tokens.push({ type: 'text', value: data.slice(seqStart, i) })
          result.state = 'ground'
          textStart = i
        } else {
          result.state = 'ground'
          textStart = seqStart
        }
        break

      case 'escapeIntermediate':
        if (isCSIIntermediate(code)) i++
        else if (isEscFinal(code)) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else {
          result.state = 'ground'
          textStart = seqStart
        }
        break

      case 'csi':
        if (
          x10Mouse &&
          code === 0x4d &&
          i - seqStart === 2 &&
          (i + 1 >= data.length || data.charCodeAt(i + 1) >= 32) &&
          (i + 2 >= data.length || data.charCodeAt(i + 2) >= 32) &&
          (i + 3 >= data.length || data.charCodeAt(i + 3) >= 32)
        ) {
          if (i + 4 <= data.length) {
            i += 4
            emitSequence(data.slice(seqStart, i))
          } else {
            i = data.length
          }
          break
        }
        if (isCSIFinal(code)) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (isCSIParam(code) || isCSIIntermediate(code)) {
          i++
        } else {
          result.state = 'ground'
          textStart = seqStart
        }
        break

      case 'ss3':
        if (code >= 0x40 && code <= 0x7e) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else {
          result.state = 'ground'
          textStart = seqStart
        }
        break

      case 'osc':
      case 'dcs':
      case 'apc':
      case 'pm':
      case 'sos':
        if (
          x10Mouse &&
          result.state === 'apc' &&
          i >= seqStart + 2 &&
          i - seqStart - 2 < KITTY_GRAPHICS_APC_PREFIX.length &&
          data[i] !== KITTY_GRAPHICS_APC_PREFIX[i - seqStart - 2]
        ) {
          emitSequence(data.slice(seqStart, seqStart + 2))
          textStart = seqStart + 2
        } else if (
          code === C0.BEL &&
          result.state !== 'pm' &&
          result.state !== 'sos'
        ) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (code === C0.ESC && i + 1 < data.length) {
          if (data.charCodeAt(i + 1) === ESC_TYPE.ST) {
            i += 2
            emitSequence(data.slice(seqStart, i))
          } else {
            emitSequence(data.slice(seqStart, i))
            seqStart = i
            result.state = 'escape'
            i++
          }
        } else if (code === C0.CAN || code === C0.SUB) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (stringsEndAtLineFeed && code === C0.LF) {
          emitSequence(
            OSC8_AT_LF_RE.test(data.slice(seqStart, Math.min(i, seqStart + 5)))
              ? OSC8_ST
              : '',
          )
        } else {
          i++
        }
        break
    }
  }

  if (result.state === 'ground') {
    flushText()
  } else if (flush) {
    const remaining = data.slice(seqStart)
    if (remaining) tokens.push({ type: 'sequence', value: remaining })
    result.state = 'ground'
  } else {
    result.buffer = data.slice(seqStart)
  }

  return { tokens, state: result }
}
