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

/**
 * Official `Y` — characters outside the fast-path ranges that may form
 * multi-codepoint combining/ZWJ/skin-tone/RI grapheme clusters needing
 * `Intl.Segmenter` protection before `Bun.wrapAnsi`.
 * Excludes ASCII, Latin-1/Extended, Cyrillic, spaces, dashes (\u2010-\u205F),
 * arrows/box-drawing (\u2100-\u2BFF), CJK, Hangul, Katakana/Hiragana, and
 * base emoji blocks without modifiers.
 */
const NON_FAST_PATH =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: official Y fast-path gate
  /[^\x00-\u02FF\u0370-\u0482\u048A-\u052F\u2000-\u200B\u2010-\u205F\u2070-\u20CF\u2100-\u2BFF\u2E80-\u3029\u3030-\u3098\u309B-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFF01-\uFF9D\uFFE0-\uFFEE\u{1f000}-\u{1f1e5}\u{1f200}-\u{1f3fa}\u{1f400}-\u{1faff}]/gu

function isLineBreakCode(code: number): boolean {
  return code === 10 || code === 13
}

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
 * Official `j` — protect combining / wide graphemes from wrapAnsiEngine splits
 * via PUA stand-ins, then restore. Only runs `Intl.Segmenter` on lines that
 * actually contain `NON_FAST_PATH` characters.
 */
function wrapProtectingGraphemes(
  input: string,
  columns: number,
  options?: WrapAnsiOptions,
): string {
  if (input.search(NON_FAST_PATH) === -1) {
    return wrapAnsiEngine(input, columns, options)
  }

  let plain = ''
  const seqs: string[] = []
  const seqOffsets: number[] = []
  for (const token of tokenizeForOutput(input)) {
    if (token.type === 'sequence') {
      seqs.push(token.value)
      seqOffsets.push(plain.length)
    } else {
      plain += token.value
    }
  }

  const starts: number[] = []
  const ends: number[] = []
  const handedAs: string[] = []
  const restoredAs: string[] = []
  const segmenter = getGraphemeSegmenter()
  let seqIdx = 0

  const pushCluster = (start: number, end: number, cluster: string) => {
    const firstUnits = cluster.codePointAt(0)! > 65535 ? 2 : 1
    const width = cluster.length > firstUnits ? stringWidth(cluster) : 0
    if (width === 1 || width === 2) {
      starts.push(start)
      ends.push(end)
      handedAs.push(width === 1 ? WIDTH1_STANDIN : WIDTH2_STANDIN)
      restoredAs.push(cluster)
    }
  }

  NON_FAST_PATH.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NON_FAST_PATH.exec(plain)) !== null) {
    let lineStart = match.index
    while (lineStart > 0 && !isLineBreakCode(plain.charCodeAt(lineStart - 1))) {
      lineStart--
    }
    let lineEnd = match.index
    while (
      lineEnd < plain.length &&
      !isLineBreakCode(plain.charCodeAt(lineEnd))
    ) {
      lineEnd++
    }
    NON_FAST_PATH.lastIndex = lineEnd

    while (seqIdx < seqOffsets.length && seqOffsets[seqIdx]! < lineStart) {
      seqIdx++
    }
    const lineText = plain.slice(lineStart, lineEnd)
    for (const { segment, index } of segmenter.segment(lineText)) {
      if (segment.length === 1) continue
      const absStart = lineStart + index
      const absEnd = absStart + segment.length
      while (seqIdx < seqOffsets.length && seqOffsets[seqIdx]! <= absStart) {
        seqIdx++
      }
      let endSeqIdx = seqIdx
      while (endSeqIdx < seqOffsets.length && seqOffsets[endSeqIdx]! < absEnd) {
        endSeqIdx++
      }
      if (endSeqIdx === seqIdx) {
        pushCluster(absStart, absEnd, segment)
      } else {
        for (let k = seqIdx; k <= endSeqIdx; k++) {
          const segStart = k === seqIdx ? absStart : seqOffsets[k - 1]!
          const segEnd = k === endSeqIdx ? absEnd : seqOffsets[k]!
          const slice = plain.slice(segStart, segEnd)
          if (slice.search(NON_FAST_PATH) === -1) continue
          for (const sub of segmenter.segment(slice)) {
            pushCluster(
              segStart + sub.index,
              segStart + sub.index + sub.segment.length,
              sub.segment,
            )
          }
        }
      }
    }
  }

  if (starts.length === 0) return wrapAnsiEngine(input, columns, options)

  const saved: string[] = []
  const parts: string[] = []
  const hasStandinInInput = input.search(STANDIN_RE) !== -1
  const pushPlain = (slice: string) => {
    if (slice === '') return
    if (hasStandinInInput) {
      for (const standin of slice.match(STANDIN_RE) ?? []) {
        saved.push(standin)
      }
    }
    parts.push(slice)
  }

  let plainPos = 0
  let sIdx = 0
  for (let m = 0; m <= starts.length; m++) {
    const limit = m < starts.length ? starts[m]! : plain.length
    for (; sIdx < seqs.length && seqOffsets[sIdx]! <= limit; sIdx++) {
      pushPlain(plain.slice(plainPos, seqOffsets[sIdx]!))
      parts.push(seqs[sIdx]!)
      plainPos = seqOffsets[sIdx]!
    }
    pushPlain(plain.slice(plainPos, limit))
    if (m === starts.length) break
    parts.push(handedAs[m]!)
    saved.push(restoredAs[m]!)
    plainPos = ends[m]!
    while (sIdx < seqs.length && seqOffsets[sIdx]! < plainPos) sIdx++
  }

  const masked = parts.join('')
  const wrapped = wrapAnsiEngine(masked, columns, options)
  if (wrapped === masked) return input

  let restored = ''
  let i = 0
  for (const token of tokenizeForOutput(wrapped)) {
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
