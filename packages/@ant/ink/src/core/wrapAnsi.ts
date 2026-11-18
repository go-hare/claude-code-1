import stripAnsi from 'strip-ansi'
import { stringWidth } from './stringWidth.js'
import { tokenizeForOutput } from './termio/tokenize.js'
import { getGraphemeSegmenter } from './utils/grapheme.js'
import sliceAnsiFallback from './utils/sliceAnsi.js'

type WrapAnsiOptions = {
  hard?: boolean
  wordWrap?: boolean
  trim?: boolean
}

const sgrPattern = (sep: string): string => `\\x1b\\[[0-9${sep}]*m`

// biome-ignore lint/suspicious/noControlCharactersInRegex: official SGR regex
const SGR_GLOBAL_RE = new RegExp(sgrPattern(';:'), 'g')
// biome-ignore lint/suspicious/noControlCharactersInRegex: official OSC 8 sticky regex
const OSC8_STICKY_RE = /\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/y
// biome-ignore lint/suspicious/noControlCharactersInRegex: official CR+SGR+LF regex
const CR_SGR_LF_RE = new RegExp(`\\r((?:${sgrPattern(';')})+)\\n`, 'g')
// biome-ignore lint/suspicious/noControlCharactersInRegex: official control/escape gate
const CONTROL_CHAR_RE = /[\x1b\x90\x98\x9b\x9d-\x9f]/
const SAFE_ANSI_SEQ_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: official ANSI sequence matcher
  /^\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x00-\x1f\x7f-\x9f]*(?:\x07|\x1b\\))$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: official joinable SGR/OSC8 sequence
const JOINABLE_SEQ_RE = new RegExp(`^(?:${sgrPattern(';')}$|\\x1b\\]8;)`)
// biome-ignore lint/suspicious/noControlCharactersInRegex: official extended SGR matcher
const EXTENDED_COLOR_SGR_RE = /^\x1b\[[34]8;(?:5;\d+|2;\d+;\d+;\d+)m$/

const LINE_BREAK_RE = /\r\n?|\n/

/**
 * Official `Y` — characters outside the fast-path ranges that may form
 * multi-codepoint combining/ZWJ/skin-tone/RI grapheme clusters needing
 * `Intl.Segmenter` protection before `Bun.wrapAnsi`.
 */
const NON_FAST_PATH =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: official Y fast-path gate
  /[^\x00-\u02FF\u0370-\u0482\u048A-\u052F\u2000-\u200B\u2010-\u205F\u2070-\u20CF\u2100-\u2BFF\u2E80-\u3029\u3030-\u3098\u309B-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFF01-\uFF9D\uFFE0-\uFFEE\u{1f000}-\u{1f1e5}\u{1f200}-\u{1f3fa}\u{1f400}-\u{1faff}]/gu

/** Official `q` / `j` — PUA stand-ins for width-1 / width-2 combining clusters. */
const WIDTH1_STANDIN = '\u{F0000}'
const WIDTH2_STANDIN = '\u{2FA1D}'
const STANDIN_RE = /[\u{F0000}\u{2FA1D}]/gu

const SGR_RESET_CODES = [22, 22, 23, 23, 24, 25, 27, 28, 29, 39, 49, 54, 55, 75]
const SGR_FG_SLOT = 9
const SGR_BG_SLOT = 10
const SGR_SLOT_MAP = new Map<number, number>([
  [1, 0],
  [2, 1],
  [3, 2],
  [20, 3],
  [4, 4],
  [21, 4],
  [5, 5],
  [6, 5],
  [7, 6],
  [8, 7],
  [9, 8],
  [51, 11],
  [52, 11],
  [53, 12],
  [73, 13],
  [74, 13],
])

function isLineBreakCode(code: number): boolean {
  return code === 10 || code === 13
}

function isWhitespaceOrNewline(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13)
}

function createSgrState(): string[] {
  return SGR_RESET_CODES.map(() => '')
}

function applySgrParam(code: number, state: string[]): void {
  const slot =
    (code >= 30 && code <= 37) || (code >= 90 && code <= 97)
      ? SGR_FG_SLOT
      : (code >= 40 && code <= 47) || (code >= 100 && code <= 107)
        ? SGR_BG_SLOT
        : SGR_SLOT_MAP.get(code)
  if (slot !== undefined) {
    state[slot] = String(code)
  } else if (code === 0) {
    state.fill('')
  } else {
    for (let i = 0; i < state.length; i++) {
      if (SGR_RESET_CODES[i] === code) state[i] = ''
    }
  }
}

function updateSgrState(seq: string, state: string[]): void {
  if (!seq.endsWith('m')) return
  if (EXTENDED_COLOR_SGR_RE.test(seq)) {
    state[seq.charCodeAt(2) === 51 ? SGR_FG_SLOT : SGR_BG_SLOT] = seq.slice(
      2,
      -1,
    )
    return
  }
  const tens = seq.length === 5 ? seq.charCodeAt(2) - 48 : 0
  const ones = seq.charCodeAt(seq.length - 2) - 48
  if (
    (seq.length === 4 || seq.length === 5) &&
    tens >= 0 &&
    tens <= 9 &&
    ones >= 0 &&
    ones <= 9
  ) {
    applySgrParam(tens * 10 + ones, state)
    return
  }
  const parts = seq.slice(2, -1).split(';')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    const val = part === '' ? 0 : parseInt(part, 10)
    if (val === 38 || val === 48 || val === 58) {
      const next = parseInt(parts[i + 1] ?? '', 10)
      const consume = part.includes(':')
        ? 1
        : next === 5
          ? 3
          : next === 2
            ? 5
            : 1
      if (val !== 58 && (consume > 1 || part.includes(':'))) {
        if (i + consume <= parts.length) {
          state[val === 38 ? SGR_FG_SLOT : SGR_BG_SLOT] = parts
            .slice(i, i + consume)
            .join(';')
        }
      }
      i += consume - 1
    } else if (val === 4 && part.includes(':')) {
      const slot = SGR_SLOT_MAP.get(4)!
      state[slot] = part === '4:0' ? '' : /^4:[1-5]$/.test(part) ? part : '4'
    } else {
      applySgrParam(val, state)
    }
  }
}

function scanIgnorableRun(
  str: string,
  start: number,
  offsets: number[],
  tokens: Array<number | string>,
): number {
  let count = 0
  let pos = start
  for (; ; count++) {
    const code = str.charCodeAt(pos)
    OSC8_STICKY_RE.lastIndex = pos
    const osc = code === 27 ? OSC8_STICKY_RE.exec(str) : null
    if (osc === null && !isWhitespaceOrNewline(code)) break
    offsets[count] = pos
    tokens[count] = osc !== null ? osc[0] : code === 13 ? 10 : code
    pos +=
      osc !== null
        ? osc[0].length
        : code === 13 && str.charCodeAt(pos + 1) === 10
          ? 2
          : 1
  }
  offsets[count] = pos
  return count
}

/**
 * Official `Z` uses `Bun.wrapAnsi`. Node `dist/cli.js` has no Bun; hard-wrap
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

type ProtectionBag = {
  starts: number[]
  ends: number[]
  handedAs: string[]
  restoredAs: string[]
}

function multiUnitWidth(cluster: string): number {
  const firstUnits = cluster.codePointAt(0)! > 65535 ? 2 : 1
  return cluster.length > firstUnits ? stringWidth(cluster) : 0
}

function standinForWidth(width: number): string {
  return width === 1 ? WIDTH1_STANDIN : width === 2 ? WIDTH2_STANDIN : ''
}

function splitClusterParts(cluster: string, totalWidth: number): string[] {
  const parts: string[] = []
  let buf = ''
  let accWidth = 0
  for (const ch of cluster) {
    const w = stringWidth(ch)
    if (w > 0 && accWidth > 0) {
      parts.push(buf)
      buf = ''
    }
    buf += ch
    accWidth += w
  }
  parts.push(buf)
  return accWidth === totalWidth ? parts : []
}

function pushMultiWidthCluster(
  bag: ProtectionBag,
  offset: number,
  cluster: string,
): void {
  const width = multiUnitWidth(cluster)
  if (width <= 2) return
  let pos = offset
  for (const part of splitClusterParts(cluster, width)) {
    const standin = standinForWidth(multiUnitWidth(part))
    if (standin !== '') {
      bag.starts.push(pos)
      bag.ends.push(pos + part.length)
      bag.handedAs.push(standin)
      bag.restoredAs.push(part)
    }
    pos += part.length
  }
}

function protectSlice(
  plain: string,
  from: number,
  to: number,
  bag: ProtectionBag,
): void {
  const slice = plain.slice(from, to)
  if (slice.search(NON_FAST_PATH) === -1) return
  for (const { segment, index } of getGraphemeSegmenter().segment(slice)) {
    const standin = standinForWidth(multiUnitWidth(segment))
    if (standin !== '') {
      bag.starts.push(from + index)
      bag.ends.push(from + index + segment.length)
      bag.handedAs.push(standin)
      bag.restoredAs.push(segment)
    } else {
      pushMultiWidthCluster(bag, from + index, segment)
    }
  }
}

function pushPlainWithStandins(
  parts: string[],
  saved: string[],
  slice: string,
  hasStandinInInput: boolean,
): void {
  if (slice === '') return
  if (hasStandinInInput) {
    for (const standin of slice.match(STANDIN_RE) ?? []) {
      saved.push(standin)
    }
  }
  parts.push(slice)
}

/**
 * Official `Te` (@280066650): break an overflowing wrapped line at `columns`
 * without dropping trailing CJK/Latin segments or emitting blank rows.
 * When `!forceWidth1 && stringWidth(cur) > columns` (e.g. columns=1 with a
 * 2-cell CJK/emoji), recurses with `forceWidth1 = true` so each codepoint
 * occupies at least 1 cell.
 */
function breakOverflowingLine(
  line: string,
  columns: number,
  forceWidth1: boolean,
  out: string[],
): void {
  let cur = ''
  let curWidth = 0
  const flush = () => {
    if (!forceWidth1 && stringWidth(cur) > columns) {
      breakOverflowingLine(cur, columns, true, out)
    } else {
      out.push(cur)
    }
    cur = ''
    curWidth = 0
  }
  const pushPiece = (piece: string, width: number) => {
    if (curWidth > 0 && width > 0 && curWidth + width > columns) {
      flush()
    }
    cur += piece
    curWidth += width
  }
  const segmenter = getGraphemeSegmenter()
  for (const token of tokenizeForOutput(line)) {
    if (token.type === 'sequence') {
      cur += token.value
      continue
    }
    for (const { segment } of segmenter.segment(token.value)) {
      const w = stringWidth(segment)
      if (w > columns && w > 2) {
        for (const ch of segment) {
          const cw = stringWidth(ch)
          pushPiece(ch, forceWidth1 ? Math.max(cw, 1) : cw)
        }
      } else if (forceWidth1) {
        let sw = 0
        for (const ch of segment) sw += Math.max(stringWidth(ch), 1)
        pushPiece(segment, sw)
      } else {
        pushPiece(segment, w)
      }
    }
  }
  flush()
}

/**
 * Official `Z` (@280066400): post-process `Bun.wrapAnsi` output when hard-wrap
 * leaves CJK/emoji + Latin lines overflowing `columns` or drops/creates blank
 * rows at narrow widths (including `columns === 1`).
 */
function fixWrappedOverflow(
  wrapped: string,
  origInput: string,
  columns: number,
  options?: WrapAnsiOptions,
): string {
  if (!options?.hard || columns < 1) return wrapped
  const lines = wrapped.split('\n')
  if (lines.every(line => stringWidth(line) <= columns)) return wrapped
  const origLines = origInput.split(LINE_BREAK_RE)
  const cleanFlags: boolean[] = []
  for (const origLine of origLines) {
    let clean = true
    for (const tok of tokenizeForOutput(origLine)) {
      if (
        tok.type === 'sequence'
          ? !SAFE_ANSI_SEQ_RE.test(tok.value)
          : CONTROL_CHAR_RE.test(tok.value)
      ) {
        clean = false
        break
      }
    }
    cleanFlags.push(clean)
  }
  if (!cleanFlags.includes(true)) return wrapped
  if (cleanFlags.includes(false)) {
    return origLines
      .map(origLine => wrapProtectingGraphemes(origLine, columns, options))
      .join('\n')
  }
  const out: string[] = []
  for (const line of lines) {
    if (stringWidth(line) <= columns) {
      out.push(line)
      continue
    }
    breakOverflowingLine(line, columns, false, out)
  }
  const hasEmptyOrig = origLines.some(l => l === '')
  return (!hasEmptyOrig ? out.filter(l => l !== '') : out).join('\n')
}

/**
 * Official `j` (@280065430) — protect combining / wide graphemes (including
 * emoji with internal SGR/OSC8 color changes) from wrapAnsiEngine splits via
 * PUA stand-ins, then restore and run `fixWrappedOverflow`.
 */
function wrapProtectingGraphemes(
  input: string,
  columns: number,
  options?: WrapAnsiOptions,
  allowJoinSeq = true,
): string {
  if (input.search(NON_FAST_PATH) === -1) {
    return fixWrappedOverflow(
      wrapAnsiEngine(input, columns, options),
      input,
      columns,
      options,
    )
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

  const bag: ProtectionBag = {
    starts: [],
    ends: [],
    handedAs: [],
    restoredAs: [],
  }
  const segmenter = getGraphemeSegmenter()
  let seqIdx = 0
  let joinedSeq = false

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
    let endLineSeq = seqIdx
    let safeLine = !CONTROL_CHAR_RE.test(lineText)
    while (
      endLineSeq < seqOffsets.length &&
      seqOffsets[endLineSeq]! <= lineEnd
    ) {
      safeLine = SAFE_ANSI_SEQ_RE.test(seqs[endLineSeq]!) && safeLine
      endLineSeq++
    }
    if (!safeLine && endLineSeq > seqIdx) {
      let pos = lineStart
      for (
        ;
        seqIdx < seqOffsets.length && seqOffsets[seqIdx]! < lineEnd;
        seqIdx++
      ) {
        if (seqOffsets[seqIdx]! > pos) {
          protectSlice(plain, pos, seqOffsets[seqIdx]!, bag)
          pos = seqOffsets[seqIdx]!
        }
      }
      protectSlice(plain, pos, lineEnd, bag)
      continue
    }

    for (const { segment, index } of segmenter.segment(lineText)) {
      if (segment.length === 1) continue
      const absStart = lineStart + index
      const absEnd = absStart + segment.length
      const standin = standinForWidth(multiUnitWidth(segment))
      while (seqIdx < seqOffsets.length && seqOffsets[seqIdx]! <= absStart) {
        seqIdx++
      }
      let endSeqIdx = seqIdx
      while (endSeqIdx < seqOffsets.length && seqOffsets[endSeqIdx]! < absEnd) {
        endSeqIdx++
      }
      if (endSeqIdx === seqIdx) {
        if (standin !== '') {
          bag.starts.push(absStart)
          bag.ends.push(absEnd)
          bag.handedAs.push(standin)
          bag.restoredAs.push(segment)
        } else {
          pushMultiWidthCluster(bag, absStart, segment)
        }
        continue
      }
      if (
        standin === '' ||
        stringWidth(plain.slice(absStart, seqOffsets[seqIdx]!)) === 0
      ) {
        for (let k = seqIdx; k <= endSeqIdx; k++) {
          const segStart = k === seqIdx ? absStart : seqOffsets[k - 1]!
          const segEnd = k === endSeqIdx ? absEnd : seqOffsets[k]!
          protectSlice(plain, segStart, segEnd, bag)
        }
        continue
      }
      let handed = standin
      let restored = ''
      let pos = absStart
      for (let k = seqIdx; k < endSeqIdx; k++) {
        const seq = seqs[k]!
        restored += plain.slice(pos, seqOffsets[k]!)
        pos = seqOffsets[k]!
        if (allowJoinSeq && JOINABLE_SEQ_RE.test(seq)) {
          handed += seq
          joinedSeq = true
        } else {
          restored += seq
        }
      }
      bag.starts.push(absStart)
      bag.ends.push(absEnd)
      bag.handedAs.push(handed)
      bag.restoredAs.push(restored + plain.slice(pos, absEnd))
    }
  }

  const { starts, ends, handedAs, restoredAs } = bag
  if (starts.length === 0) {
    return fixWrappedOverflow(
      wrapAnsiEngine(input, columns, options),
      input,
      columns,
      options,
    )
  }

  const saved: string[] = []
  const parts: string[] = []
  const hasStandinInInput = input.search(STANDIN_RE) !== -1
  let plainPos = 0
  let sIdx = 0
  for (let m = 0; m <= starts.length; m++) {
    const limit = m < starts.length ? starts[m]! : plain.length
    for (; sIdx < seqs.length && seqOffsets[sIdx]! <= limit; sIdx++) {
      pushPlainWithStandins(
        parts,
        saved,
        plain.slice(plainPos, seqOffsets[sIdx]!),
        hasStandinInInput,
      )
      parts.push(seqs[sIdx]!)
      plainPos = seqOffsets[sIdx]!
    }
    pushPlainWithStandins(
      parts,
      saved,
      plain.slice(plainPos, limit),
      hasStandinInInput,
    )
    if (m === starts.length) break
    parts.push(handedAs[m]!)
    saved.push(restoredAs[m]!)
    plainPos = ends[m]!
    while (sIdx < seqs.length && seqOffsets[sIdx]! < plainPos) sIdx++
  }

  const masked = parts.join('')
  if (
    joinedSeq &&
    masked.split(LINE_BREAK_RE).every(line => stringWidth(line) <= columns)
  ) {
    return wrapProtectingGraphemes(input, columns, options, false)
  }

  const wrapped = wrapAnsiEngine(masked, columns, options)
  if (wrapped === masked) {
    return fixWrappedOverflow(input, input, columns, options)
  }

  let restored = ''
  let i = 0
  for (const token of tokenizeForOutput(wrapped)) {
    restored +=
      token.type === 'sequence'
        ? token.value
        : token.value.replace(STANDIN_RE, c => saved[i++] ?? c)
  }
  return fixWrappedOverflow(restored, input, columns, options)
}

/**
 * Official `yu` (@280061500): strip SGR sequences before wrapping, wrap via
 * `wrapProtectingGraphemes`, then re-attach SGR and close/reopen all active
 * SGR attributes (bold, italic, underline, fg/bg, 256/truecolor) across every
 * newline so nested styles neither leak over borders nor get lost on wrapped rows.
 */
const wrapAnsi: (
  input: string,
  columns: number,
  options?: WrapAnsiOptions,
) => string = (input, columns, options) => {
  if (!(columns > 0)) return input
  if (!input.includes('\x1b[')) {
    return wrapProtectingGraphemes(input, columns, options)
  }

  const stripped = input.replace(SGR_GLOBAL_RE, '')
  if (
    stripped.length < input.length &&
    stripped.includes('\x1b') &&
    stripAnsi(stripped) !== stripAnsi(input)
  ) {
    return wrapProtectingGraphemes(
      input.replace(CR_SGR_LF_RE, '$1\r\n'),
      columns,
      options,
    )
  }

  const wrapped = wrapProtectingGraphemes(stripped, columns, options)
  if (wrapped === stripped && !wrapped.includes('\n')) {
    return input
  }

  const sgrMatches = input.match(SGR_GLOBAL_RE)
  if (sgrMatches === null) return wrapped

  const plainParts = input.split(SGR_GLOBAL_RE)
  const sgrOffsets: number[] = []
  let acc = 0
  for (let i = 0; i < sgrMatches.length; i++) {
    acc += plainParts[i]!.length
    sgrOffsets.push(acc)
  }

  const sgrState = createSgrState()
  const out: string[] = []
  let sgrIdx = 0
  let appliedIdx = 0
  let closeSeq = ''
  let reopenSeq = ''
  let needReopen = true
  let pendingReopen = false
  let ok = true
  let origPos = 0
  let outPos = 0
  let emitPos = 0
  let nextNewlineOut = -1
  let nextEscOut = -1
  let nextEscOrig = -1

  const outOffsets: number[] = []
  const outTokens: Array<number | string> = []
  const origOffsets: number[] = []
  const origTokens: Array<number | string> = []
  const matchedOutIdx: number[] = []
  const sgrTargetIdx: number[] = []

  for (;;) {
    const origCount = scanIgnorableRun(
      stripped,
      origPos,
      origOffsets,
      origTokens,
    )
    const outCount = scanIgnorableRun(wrapped, outPos, outOffsets, outTokens)
    const origEnd = origOffsets[origCount]!
    const outEnd = outOffsets[outCount]!

    for (let i = 0; i < origCount; i++) matchedOutIdx[i] = -1
    let origCur = origCount - 1
    const specialIdx: number[] = []
    let specialCount = 0
    for (let j = outCount - 1; j >= -1 && ok; j--) {
      const tok = j < 0 ? -1 : outTokens[j]!
      if (tok === 10 || typeof tok === 'string') {
        specialIdx[specialCount++] = j
        continue
      }
      let scan = origCur
      while (scan >= 0 && origTokens[scan] !== tok) scan--
      ok = j < 0 || scan >= 0
      for (let specStart = 0; origCur > scan; origCur--) {
        const origTok = origTokens[origCur]!
        let si =
          origTok === 10 || typeof origTok === 'string'
            ? specStart
            : specialCount
        while (si < specialCount && outTokens[specialIdx[si]!] !== origTok) {
          si++
        }
        if (si < specialCount) {
          matchedOutIdx[origCur] = specialIdx[si]!
          specStart = si + 1
        }
      }
      if (scan >= 0) {
        matchedOutIdx[scan] = j
        origCur = scan - 1
      }
      specialCount = 0
    }
    if (!ok) break

    const baseSgr = sgrIdx
    let endSgr = sgrIdx - 1
    for (
      let i = 0;
      endSgr + 1 < sgrOffsets.length && sgrOffsets[endSgr + 1]! <= origEnd;
    ) {
      const target = sgrOffsets[++endSgr]!
      while (
        i < origCount &&
        (origOffsets[i]! < target || matchedOutIdx[i]! < 0)
      ) {
        i++
      }
      sgrTargetIdx[endSgr - baseSgr] =
        target <= origPos ? 0 : i < origCount ? matchedOutIdx[i]! : outCount
    }

    for (let j = 0; j <= outCount; j++) {
      const charOff = outOffsets[j]!
      const emitSgrHere =
        sgrIdx <= endSgr && sgrTargetIdx[sgrIdx - baseSgr]! <= j
      const isNewline = j < outCount && outTokens[j] === 10

      if (pendingReopen && (emitSgrHere || (j < outCount && !isNewline))) {
        pendingReopen = false
        if (reopenSeq !== '') {
          out.push(wrapped.slice(emitPos, charOff), reopenSeq)
          emitPos = charOff
          needReopen = true
        }
      }
      if (emitSgrHere) {
        out.push(wrapped.slice(emitPos, charOff))
        emitPos = charOff
        while (sgrIdx <= endSgr && sgrTargetIdx[sgrIdx - baseSgr]! <= j) {
          out.push(sgrMatches[sgrIdx++]!)
        }
        needReopen = true
      }
      if (isNewline) {
        if (appliedIdx < sgrIdx) {
          while (appliedIdx < sgrIdx) {
            updateSgrState(sgrMatches[appliedIdx++]!, sgrState)
          }
          closeSeq = ''
          reopenSeq = ''
          let lastReset = 0
          for (let slot = 0; slot < sgrState.length; slot++) {
            if (sgrState[slot] === '') continue
            reopenSeq += `\x1b[${sgrState[slot]}m`
            const reset = SGR_RESET_CODES[slot]!
            if (reset !== lastReset) {
              lastReset = reset
              closeSeq = `\x1b[${reset}m${closeSeq}`
            }
          }
        }
        if (needReopen && closeSeq !== '') {
          out.push(wrapped.slice(emitPos, charOff), closeSeq)
          emitPos = charOff
        }
        needReopen = false
        pendingReopen = true
      }
    }

    origPos = origEnd
    outPos = outEnd
    if (outPos >= wrapped.length) {
      ok = origPos >= stripped.length
      break
    }
    if (pendingReopen) {
      pendingReopen = false
      if (reopenSeq !== '') {
        out.push(wrapped.slice(emitPos, outPos), reopenSeq)
        emitPos = outPos
        needReopen = true
      }
    }
    if (nextNewlineOut < outPos) {
      nextNewlineOut = wrapped.indexOf('\n', outPos)
      if (nextNewlineOut === -1) nextNewlineOut = wrapped.length
    }
    if (nextEscOut < outPos) {
      nextEscOut = wrapped.indexOf('\x1b', outPos)
      if (nextEscOut === -1) nextEscOut = wrapped.length
    }
    if (nextEscOrig < origPos) {
      nextEscOrig = stripped.indexOf('\x1b', origPos)
      if (nextEscOrig === -1) nextEscOrig = stripped.length
    }
    let chunk = Math.min(
      nextNewlineOut - outPos,
      nextEscOut - outPos,
      nextEscOrig - origPos,
      sgrIdx < sgrOffsets.length
        ? sgrOffsets[sgrIdx]! - origPos
        : stripped.length,
    )
    while (
      chunk > 0 &&
      isWhitespaceOrNewline(stripped.charCodeAt(origPos + chunk - 1))
    ) {
      chunk--
    }
    if (
      chunk < 1 ||
      !wrapped.startsWith(stripped.slice(origPos, origPos + chunk), outPos)
    ) {
      chunk = 1
      if (stripped.charCodeAt(origPos) !== wrapped.charCodeAt(outPos)) {
        ok = false
        break
      }
    }
    origPos += chunk
    outPos += chunk
  }

  if (!ok) return wrapProtectingGraphemes(input, columns, options)
  out.push(wrapped.slice(emitPos))
  return out.join('')
}

export { wrapAnsi }
