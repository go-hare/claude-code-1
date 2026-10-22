/**
 * densable `Vse` / `sor` / `Ua` / `Va` — 8-col tab expand for output tokens.
 * Gold: official-289 SEA @180665452 (`iwt=8`).
 */

import { stringWidth } from './stringWidth.js'
import { createTokenizer } from './termio/tokenize.js'

const DEFAULT_TAB_INTERVAL = 8

/** densable `Pft` — ALM + bidi embeddings/isolates. */
const BIDI_RANGES = Object.freeze([
  [1564, 1564],
  [8234, 8238],
  [8294, 8297],
] as const)
const BIDI_CLASS = new RegExp(
  `[${BIDI_RANGES.map(
    ([start, end]) =>
      `\\u{${start.toString(16)}}${end > start ? `-\\u{${end.toString(16)}}` : ''}`,
  ).join('')}]`,
  'u',
)
const BIDI_REPLACE = new RegExp(BIDI_CLASS.source, 'gu')

const TAB_OR_LF = /(\t|\n)/
// biome-ignore lint/suspicious/noControlCharactersInRegex: densable uR ESC/CSI
const ESC_OR_CSI = /[\x1b\x9b]/g
const C1_STRING = /[\x90\x98\x9d-\x9f]/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: densable pR
const HAS_ESC_OR_C1 = /[\x1b\x90\x98\x9b\x9d-\x9f]/
// biome-ignore lint/suspicious/noControlCharactersInRegex: densable _R leftover seq
const LEFTOVER_SEQ = /^\x1b[P\]X^_k]/
// biome-ignore lint/suspicious/noControlCharactersInRegex: densable mR DCS/APC ST
const DCS_OR_APC_ST = /^\x1b[P_].*\x07$|\x9c/s

type OutputToken = { type: 'text' | 'sequence'; value: string }

/** densable `La`. */
function replaceC1String(text: string): string {
  return text.replace(C1_STRING, '�')
}

/**
 * densable `Ua` — `$me({forOutput:!0})` feed, leftover buffer as sequence
 * when last segment and not `_R`, else text. Gold does not `flush()`.
 */
function tokenizeForTabExpand(text: string, last: boolean): OutputToken[] {
  const tokenizer = createTokenizer({ forOutput: true })
  const tokens: OutputToken[] = tokenizer.feed(text)
  const leftover = tokenizer.buffer()
  if (leftover !== '') {
    tokens.push({
      type: last && !LEFTOVER_SEQ.test(leftover) ? 'sequence' : 'text',
      value: leftover,
    })
  }
  return tokens
}

/**
 * densable `Va` — expand tabs inside text / newline sequences / DCS-ST /
 * ESC k titles. Other sequences pass through unchanged.
 */
function tabExpandableText(token: OutputToken): string | undefined {
  if (
    token.type === 'text' ||
    token.value.includes('\n') ||
    DCS_OR_APC_ST.test(token.value)
  ) {
    return replaceC1String(token.value.replace(ESC_OR_CSI, '\x18'))
  }
  if (token.value.startsWith('\x1Bk')) {
    return replaceC1String(token.value.replace(/\x9b/g, '\x18'))
  }
  return undefined
}

/** densable `$Yr`. */
export function hasEscOrC1(text: string): boolean {
  return HAS_ESC_OR_C1.test(text)
}

/** densable `Ya`. */
export function sanitizeBidiControls(text: string): string {
  return BIDI_CLASS.test(text) ? text.replace(BIDI_REPLACE, '�') : text
}

/**
 * densable `UYr` — some line has ESC/C1 and a token `Va` rewrites.
 */
function needsSequenceTabExpand(lines: readonly string[]): boolean {
  return lines.some((line, i) => {
    if (!hasEscOrC1(line)) return false
    const last = i === lines.length - 1
    return tokenizeForTabExpand(line, last).some(token => {
      const rewritten = tabExpandableText(token)
      return (rewritten ?? token.value) !== token.value
    })
  })
}

/** densable `sor`. */
function expandTabLines(
  lines: readonly string[],
  interval = DEFAULT_TAB_INTERVAL,
): string[] {
  let column = 0
  return lines.map((line, i) => {
    let out = ''
    for (const token of tokenizeForTabExpand(line, i === lines.length - 1)) {
      const expandable = tabExpandableText(token)
      if (expandable === undefined) {
        out += token.value
        continue
      }
      for (const part of expandable.split(TAB_OR_LF)) {
        if (part === '\t') {
          const spaces = interval - (column % interval)
          out += ' '.repeat(spaces)
          column += spaces
        } else if (part === '\n') {
          out += part
          column = 0
        } else {
          out += part
          column += stringWidth(part)
        }
      }
    }
    return out
  })
}

/** densable `Hc`. */
function expandSequenceTabLines(
  lines: readonly string[],
): string[] | undefined {
  if (!needsSequenceTabExpand(lines)) return undefined
  return expandTabLines(lines.map(sanitizeBidiControls))
}

/**
 * densable `Oc` — join lines, optionally keep bidi (`ja` wrap modes),
 * then `sor` when the joined string has tabs.
 */
export function expandTabsJoin(
  lines: readonly string[],
  keepBidi = false,
): string {
  const sequenced = expandSequenceTabLines(lines)
  if (sequenced !== undefined) return sequenced.join('')
  const joined = keepBidi
    ? lines.join('')
    : sanitizeBidiControls(lines.join(''))
  return joined.includes('\t') ? expandTabLines([joined]).join('') : joined
}

/** densable `r7`. */
export function expandTabsForWrap(text: string): string {
  return expandTabsJoin([text], false)
}

/** densable `Vse`. */
export function expandTabs(
  text: string,
  interval = DEFAULT_TAB_INTERVAL,
): string {
  if (text.includes('\t') || needsSequenceTabExpand([text])) {
    return expandTabLines([text], interval).join('')
  }
  return text
}

/**
 * densable `nf.width(n,u,f)` software path — display cells of `text` when
 * painted at column `column` (tab stops are 8-col from that column).
 */
function measureLineCellsWidth(text: string, column: number): number {
  if (!text.includes('\t') && !needsSequenceTabExpand([text])) {
    return stringWidth(text)
  }
  let col = column
  let out = ''
  for (const token of tokenizeForTabExpand(text, true)) {
    const expandable = tabExpandableText(token)
    if (expandable === undefined) {
      out += token.value
      continue
    }
    for (const part of expandable.split(TAB_OR_LF)) {
      if (part === '\t') {
        const spaces = DEFAULT_TAB_INTERVAL - (col % DEFAULT_TAB_INTERVAL)
        out += ' '.repeat(spaces)
        col += spaces
      } else if (part === '\n') {
        out += part
        col = 0
      } else {
        out += part
        col += stringWidth(part)
      }
    }
  }
  return stringWidth(out)
}

/**
 * densable `nf` — gold `new nf(stylePool, charPool)` then `width(n,u,f)`.
 * Native `Es(Pft)` segmenter is SEA-only; width BODY is the software path.
 */
export class LineCells {
  constructor(_stylePool?: unknown, _charPool?: unknown) {}

  /** densable `nf.width(n,u,f)` — `f` is gold `ef()` reorder flag. */
  width(text: string, column: number, _reorder = false): number {
    return measureLineCellsWidth(text, column)
  }
}
