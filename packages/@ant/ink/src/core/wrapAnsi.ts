import wrapAnsiNpm from 'wrap-ansi'

type WrapAnsiOptions = {
  hard?: boolean
  wordWrap?: boolean
  trim?: boolean
}

const wrapAnsiBun =
  typeof Bun !== 'undefined' && typeof Bun.wrapAnsi === 'function'
    ? Bun.wrapAnsi
    : null

const wrapAnsiCore: (
  input: string,
  columns: number,
  options?: WrapAnsiOptions,
) => string = wrapAnsiBun ?? wrapAnsiNpm

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
    const params = match[1] ?? ''
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
 * densable `DH` — `Bun.wrapAnsi` then `pAb` when the *input* has 256/truecolor
 * SGR and wrap produced a newline. columns ≤ 0 returns the original string.
 */
const wrapAnsi: (
  input: string,
  columns: number,
  options?: WrapAnsiOptions,
) => string = (input, columns, options) => {
  if (!(columns > 0)) return input
  const wrapped = wrapAnsiCore(input, columns, options)
  if (TRUECOLOR_OR_256_SGR.test(input) && wrapped.includes('\n')) {
    return reattachTruecolorAcrossNewlines(wrapped)
  }
  return wrapped
}

export { wrapAnsi }
