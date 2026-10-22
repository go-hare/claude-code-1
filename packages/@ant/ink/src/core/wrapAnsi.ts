import { stringWidth } from './stringWidth.js'
import { tokenizeForOutput } from './termio/tokenize.js'
import { getGraphemeSegmenter } from './utils/grapheme.js'
import sliceAnsiFallback from './utils/sliceAnsi.js'

type WrapAnsiOptions = {
  hard?: boolean
  wordWrap?: boolean
  trim?: boolean
}

/**
 * densable `cAb` — 256-color / truecolor SGR (`38;5`/`38;2`/`48;5`/`48;2`).
 * Only these sequences need pAb reattach after wrap inserts a newline.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: densable cAb ESC CSI
const TRUECOLOR_OR_256_SGR = /\x1b\[[34]8;[25];/

/** densable `ksa` — any SGR. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: densable ksa ESC CSI
const ANSI_SGR = /\x1b\[([\d;]*)m/g

/** densable `uAb` — standard FG (not 38). */
const STANDARD_FG = /^(3[0-79]|9[0-7])$/

/** densable `dAb` — standard BG (not 48). */
const STANDARD_BG = /^(4[0-79]|10[0-7])$/

/** densable `V`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: densable V ASCII gate
const HAS_NON_ASCII = /[^\x00-\x7f]/

/** densable `q` / `j` — PUA stand-ins for width-1 / width-2 combining clusters. */
const WIDTH1_STANDIN = '\u{F0000}'
const WIDTH2_STANDIN = '\u{2FA1D}'
/** densable `k`. */
const STANDIN_RE = /[\u{F0000}\u{2FA1D}]/gu

/**
 * densable `SId` — close then reopen tracked 256/truecolor around each newline
 * so wrap-inserted line breaks do not leak color onto the next row.
 */
function splitColorSpan(chunk: string, fg: string, bg: string): string {
  if (chunk === '' || (fg === '' && bg === '')) return chunk
  let out = ''
  let last = 0
  for (let i = 0; i < chunk.length; i++) {
    if (chunk.charCodeAt(i) === 10) {
      out += chunk.slice(last, i)
      if (fg) out += '\x1B[39m'
      if (bg) out += '\x1B[49m'
      out += `\n${fg}${bg}`
      last = i + 1
    }
  }
  out += chunk.slice(last)
  return out
}

/**
 * densable `pAb` — walk SGR in the wrapped string; for 38;/48; truecolor keep
 * the opener across wrap newlines; standard 3x/4x FG/BG clears the tracker.
 */
function reattachTruecolorAcrossNewlines(wrapped: string): string {
  let out = ''
  let fg = ''
  let bg = ''
  let last = 0
  ANSI_SGR.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ANSI_SGR.exec(wrapped)) !== null) {
    out += splitColorSpan(wrapped.slice(last, match.index), fg, bg)
    out += match[0]
    last = ANSI_SGR.lastIndex
    const params = match[1]!
    if (params === '' || params === '0') {
      fg = ''
      bg = ''
    } else if (params.startsWith('38;')) {
      fg = match[0]
    } else if (STANDARD_FG.test(params)) {
      fg = ''
    } else if (params.startsWith('48;')) {
      bg = match[0]
    } else if (STANDARD_BG.test(params)) {
      bg = ''
    }
  }
  out += splitColorSpan(wrapped.slice(last), fg, bg)
  return out
}

/**
 * densable `Z` uses `Bun.wrapAnsi`. Node `dist/cli.js` has no Bun; hard-wrap
 * with sliceAnsi so the first wrap does not throw ReferenceError.
 */
function wrapAnsiEngine(
  input: string,
  columns: number,
  options?: WrapAnsiOptions,
): string {
  const bunWrap =
    typeof Bun !== 'undefined' && typeof Bun.wrapAnsi === 'function'
      ? Bun.wrapAnsi
      : undefined
  if (bunWrap) return bunWrap(input, columns, options)
  const trim = options?.trim !== false
  const hard = options?.hard === true
  const lines = input.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const raw = trim ? line.trimEnd() : line
    if (raw === '') {
      out.push('')
      continue
    }
    if (stringWidth(raw) <= columns) {
      out.push(raw)
      continue
    }
    if (!hard) {
      out.push(raw)
      continue
    }
    let rest = raw
    while (stringWidth(rest) > columns) {
      out.push(sliceAnsiFallback(rest, 0, columns))
      rest = sliceAnsiFallback(rest, columns)
    }
    if (rest !== '') out.push(rest)
  }
  return out.join('\n')
}

/**
 * densable `Z` — protect combining / wide graphemes from wrapAnsiEngine splits
 * via PUA stand-ins, then restore.
 */
function wrapProtectingGraphemes(
  input: string,
  columns: number,
  options?: WrapAnsiOptions,
): string {
  if (!HAS_NON_ASCII.test(input)) return wrapAnsiEngine(input, columns, options)
  const saved: string[] = []
  let masked = ''
  let substituted = false
  for (const token of tokenizeForOutput(input)) {
    if (token.type === 'sequence') {
      masked += token.value
      continue
    }
    for (const { segment } of getGraphemeSegmenter().segment(token.value)) {
      const firstUnits = segment.codePointAt(0)! > 65535 ? 2 : 1
      const width = segment.length > firstUnits ? stringWidth(segment) : 0
      if (width === 1 || width === 2) {
        saved.push(segment)
        masked += width === 1 ? WIDTH1_STANDIN : WIDTH2_STANDIN
        substituted = true
        continue
      }
      for (const standin of segment.match(STANDIN_RE) ?? []) {
        saved.push(standin)
      }
      masked += segment
    }
  }
  if (!substituted) return wrapAnsiEngine(input, columns, options)
  let restored = ''
  let i = 0
  for (const token of tokenizeForOutput(
    wrapAnsiEngine(masked, columns, options),
  )) {
    restored +=
      token.type === 'sequence'
        ? token.value
        : token.value.replace(STANDIN_RE, c => saved[i++] ?? c)
  }
  return restored
}

/**
 * densable `DH` / `Lu` — `Z` then `pAb` when the *input* has 256/truecolor
 * SGR and wrap produced a newline. columns ≤ 0 returns the original string.
 */
const wrapAnsi: (
  input: string,
  columns: number,
  options?: WrapAnsiOptions,
) => string = (input, columns, options) => {
  if (!(columns > 0)) return input
  const wrapped = wrapProtectingGraphemes(input, columns, options)
  if (TRUECOLOR_OR_256_SGR.test(input) && wrapped.includes('\n')) {
    return reattachTruecolorAcrossNewlines(wrapped)
  }
  return wrapped
}

export { wrapAnsi }
