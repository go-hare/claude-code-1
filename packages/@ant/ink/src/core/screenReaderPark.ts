/**
 * Official computeScreenReaderPark densable (pure) + screen-reader frame plan
 * + onRenderScreenReader ANSI materialization.
 *
 * Maps a declared cursor (node start index in the full screen-reader text +
 * relativeX/Y) onto a {row, col} in the rendered screen-reader line list,
 * accounting for soft-wrap at `columns`.
 *
 * densable 2.1.219 #15: prevScreenReaderAnchor + xuy grapheme-boundary suffix
 * append so typing only echoes the new character(s) instead of rewriting the
 * whole input line (erase + rewrite from common prefix).
 */

import { stringWidth as cellWidth } from './stringWidth.js'
import { expandTabsForWrap } from './tabstops.js'
import { getGraphemeSegmenter } from './utils/grapheme.js'
import { wrapAnsi } from './wrapAnsi.js'
import type { RowPrefixRange } from './screenReaderTree.js'

/** densable `fv` for `Ko` — ambiguous-as-wide, not layout `stringWidth`. */
const KO_OPTS = { ambiguousIsNarrow: false } as const
const bunKo =
  typeof Bun !== 'undefined' && typeof Bun.stringWidth === 'function'
    ? (s: string) => Bun.stringWidth(s, KO_OPTS)
    : cellWidth

export type ScreenReaderPark = {
  row: number
  col: number
}

/**
 * densable prevScreenReaderAnchor — tracks whether the physical SR cursor is
 * known to sit at a stable line boundary so suffix-append is safe.
 * - clean: full frame rewrite covered the viewport
 * - lastRowAnchored: partial rewrite left us parked on the last row
 * - broken: unknown / scrolled / mid-frame — force full rewrite
 */
export type ScreenReaderAnchor = 'clean' | 'lastRowAnchored' | 'broken'

/**
 * densable xuy(e, t) — true when `offset` is a grapheme cluster boundary in
 * `text` (or ≤0 / past end). Used so we never split a multi-codepoint
 * grapheme when appending a typed suffix.
 */
export function isGraphemeBoundary(text: string, offset: number): boolean {
  if (offset <= 0) return true
  for (const r of getGraphemeSegmenter().segment(text)) {
    if (r.index === offset) return true
    if (r.index > offset) return false
  }
  return offset >= text.length
}

export type ScreenReaderCursorDeclaration = {
  /** Absolute character offset of the declared node start in fullText. */
  nodeStartIndex: number
  relativeX: number
  relativeY: number
}

/**
 * Count of newline characters in text (official Mu(s, "\n")).
 */
export function countNewlines(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++
  }
  return n
}

/**
 * densable 2.1.218: merge overlapping preserveRanges, sorted by start.
 */
export function mergePreserveRanges(
  ranges: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const [s, e] of sorted) {
    const last = out.at(-1)
    if (last !== undefined && s <= last[1]) {
      last[1] = Math.max(last[1], e)
    } else {
      out.push([s, e])
    }
  }
  return out
}

/**
 * Official onRenderScreenReader line materialization densable:
 * split fullText on newlines, hard-wrap each logical line (wrapAnsi hard),
 * track lineBaseRows.
 *
 * densable 2.1.218 #13: when a logical line's trailing whitespace falls inside
 * a preserveRange, keep trailing spaces on the last hard-wrapped segment so
 * VoiceOver does not treat the caret-as-space as a "new line".
 */
const UNREADABLE_PLACEHOLDERS = ['[unreadable text]', '[unreadable]', '[?]']
const MARK_CONTROL_FORMAT = /^[\p{M}\p{Cc}\p{Cf}]?$/u
const EMOJI_OR_UNASSIGNED = /[\p{Cn}\p{Emoji}]/u

/** densable `Ko` — max of per-codepoint sum vs whole-string width. */
export function wrapCellWidth(text: string): number {
  let summed = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    summed +=
      cp > 127 && EMOJI_OR_UNASSIGNED.test(ch)
        ? 2
        : Math.max(1, bunKo(cp >= 0xd800 && cp <= 0xdfff ? '�' : ch))
  }
  return Math.max(summed, bunKo(text))
}

/**
 * densable `hv` — wrap by cell width, inserting an unreadable placeholder
 * when a grapheme is wider than the remaining columns.
 */
export function wrapScreenReaderLineByCells(
  text: string,
  columns: number,
): string[] {
  const placeholder =
    UNREADABLE_PLACEHOLDERS.find(p => wrapCellWidth(p) <= columns) ?? '?'
  const marker = { text: placeholder, cells: wrapCellWidth(placeholder) }
  const tokens: Array<{ text: string; cells: number }> = []
  for (const { segment } of getGraphemeSegmenter().segment(
    expandTabsForWrap(text),
  )) {
    const cells = wrapCellWidth(segment)
    if (cells <= columns) {
      tokens.push({ text: segment, cells })
      continue
    }
    const chars = Array.from(segment)
    const combiningAt = chars.findIndex(
      ch => Array.from(getGraphemeSegmenter().segment(`${ch}a`)).length > 1,
    )
    const combining = chars[combiningAt] ?? ''
    const combiningCells = wrapCellWidth(combining)
    const keepCombining =
      !MARK_CONTROL_FORMAT.test(combining) && combiningCells <= columns
    if ((!keepCombining || combiningAt > 0) && tokens.at(-1) !== marker) {
      tokens.push(marker)
    }
    if (keepCombining) {
      tokens.push({ text: combining, cells: combiningCells })
      if (combiningAt < chars.length - 1) tokens.push(marker)
    }
  }
  const lines: string[] = []
  let i = 0
  while (i < tokens.length) {
    let end = i
    let used = 0
    let spaceBreak = i
    while (end < tokens.length && used + tokens[end]!.cells <= columns) {
      used += tokens[end]!.cells
      end++
      if (tokens[end - 1]!.text === ' ') spaceBreak = end
    }
    if (end === i) end++
    else if (
      end < tokens.length &&
      tokens[end]!.text !== ' ' &&
      spaceBreak > i
    ) {
      end = spaceBreak
    }
    lines.push(
      tokens
        .slice(i, end)
        .map(t => t.text)
        .join(''),
    )
    i = end
  }
  return lines
}

export function materializeScreenReaderLines(
  fullText: string,
  columns: number,
  preserveRanges: ReadonlyArray<readonly [number, number]> = [],
  rowPrefixRanges: ReadonlyArray<RowPrefixRange> = [],
): { lines: string[]; lineBaseRows: number[] } {
  const merged = mergePreserveRanges(preserveRanges)
  const logical = fullText === '' ? [] : fullText.split('\n')
  const lines: string[] = []
  const lineBaseRows: number[] = []
  let charPos = 0
  for (const logicalLine of logical) {
    const lineEnd = charPos + logicalLine.length
    const trimmedLen = logicalLine.trimEnd().length
    const hasTrailing =
      charPos + trimmedLen < lineEnd &&
      merged.some(([s, e]) => s < lineEnd && lineEnd <= e)
    const prefix =
      rowPrefixRanges.find(([s, e]) =>
        logicalLine === ''
          ? s <= charPos && charPos <= e
          : s < lineEnd && charPos < e,
      )?.[2] ?? ''
    const usablePrefix = columns - wrapCellWidth(prefix) >= 2 ? prefix : ''
    const trimmedPrefix = usablePrefix.trimEnd()
    lineBaseRows.push(lines.length)
    if (logicalLine === '') {
      lines.push(trimmedPrefix)
    } else {
      const segs =
        prefix === '' || columns < 2
          ? wrapAnsi(logicalLine, columns, { trim: false, hard: true }).split(
              '\n',
            )
          : wrapScreenReaderLineByCells(
              expandTabsForWrap(logicalLine),
              columns - wrapCellWidth(usablePrefix),
            )
      for (let p = 0; p < segs.length; p++) {
        const seg = segs[p]!
        const kept = hasTrailing && p === segs.length - 1 ? seg : seg.trimEnd()
        lines.push(kept === '' ? trimmedPrefix : usablePrefix + kept)
      }
    }
    charPos = lineEnd + 1
  }
  return { lines, lineBaseRows }
}

/**
 * Official computeScreenReaderPark pure densable.
 *
 * @param fullText Entire screen-reader text for the frame
 * @param lineBaseRows For each logical line index, the starting row in the
 *   rendered line list (official `t` array)
 * @param renderedLineCount Official `r.length`
 * @param columns Terminal width used for soft-wrap (official `n`)
 * @param cursor Declaration; null → null
 * @param stringWidth Display-width function (official Lt)
 */
export function computeScreenReaderPark(
  fullText: string,
  lineBaseRows: readonly number[],
  renderedLineCount: number,
  columns: number,
  cursor: ScreenReaderCursorDeclaration | null,
  stringWidth: (s: string) => number = s => s.length,
): ScreenReaderPark | null {
  if (cursor === null) return null
  const nodeStart = cursor.nodeStartIndex
  if (nodeStart < 0 || nodeStart > fullText.length) return null

  const before = fullText.slice(0, nodeStart)
  const logicalLine = countNewlines(before) + cursor.relativeY
  if (logicalLine < 0 || logicalLine >= lineBaseRows.length) return null

  const lineStart = before.lastIndexOf('\n') + 1
  const prefixWidth =
    cursor.relativeY === 0
      ? stringWidth(fullText.slice(lineStart, nodeStart))
      : 0
  const displayCol = prefixWidth + cursor.relativeX
  const wrapRows = columns > 0 ? Math.floor(displayCol / columns) : 0
  const baseRow = lineBaseRows[logicalLine] ?? 0
  const row = Math.min(baseRow + wrapRows, Math.max(0, renderedLineCount - 1))
  const col = columns > 0 ? displayCol % columns : displayCol
  return {
    row: Math.max(0, row),
    col: Math.max(0, col),
  }
}

export type ScreenReaderFramePlan = {
  /** Official early return when lines + park unchanged. */
  skip: boolean
  park: ScreenReaderPark
  /**
   * Common prefix length after optional viewport clamp (official `l` after
   * g>l && g<n.length → l=g).
   */
  rewriteFrom: number
  /** Lines to rewrite: newLines.slice(rewriteFrom). */
  rewriteLines: readonly string[]
  /** Previous last row index (official f) — for cursor home relative move. */
  prevLastRow: number
  /** Previous park (official d) — home move starts from here. */
  prevPark: ScreenReaderPark
  /** Previous line count (official i.length) — s3n arg base. */
  prevLineCount: number
  /** Last row of new frame (official s). */
  lastRow: number
  /** Whether park changed vs previous. */
  parkChanged: boolean
  /** Whether lines are identical to previous. */
  linesUnchanged: boolean
  /**
   * densable 2.1.219 #15 suffix-append fast path: only write the new chars on
   * the first differing line (no erase / full-line rewrite). When set,
   * materialize writes move-to-suffix + suffix + park, and callers should
   * keep the previous anchor (suffix path does not re-evaluate it).
   */
  suffixAppend?: {
    /** Line index of the append (official `f` / common). */
    lineIndex: number
    /** Display width of the previous line content (CHA target base). */
    prevWidth: number
    /** New text after prev line prefix (official `L`). */
    suffix: string
  }
  /**
   * densable 2.1.222 #15 suffix-delete (EOL backspace) fast path: park was at
   * EOL, deleted a pure suffix (no mid-line edit). Materialize CHA + CSI K
   * (erase to end of line) so screen readers only hear the deleted region
   * clear — not a full-line rewrite.
   */
  suffixDelete?: {
    /** Line index of the delete (official `f` / common). */
    lineIndex: number
    /** Display width of the remaining (new) line content (CHA before EL). */
    keepWidth: number
  }
  /**
   * densable prevScreenReaderAnchor after this plan is applied.
   * Undefined when skip or suffixAppend/suffixDelete (keep previous).
   */
  nextAnchor?: ScreenReaderAnchor
  /**
   * Gold `K` after `N` announcement clamp, before the viewport empty-line walk.
   * Parent `$to` CHA pre-park: `!J && K<x.length && N===-1 && !srPreParked`.
   */
  commonPrefixLength?: number
  /** Gold `x.length` — new frame line count (`K<x.length` uses this, not lastRow+1). */
  lineCount?: number
  /**
   * Gold `Ae` after viewport clamp: `ce>K || (Ee && ce===K)`.
   * Erase-only extra CUU is skipped when true; anchor may go broken when
   * `Ae && se<terminalRows`.
   */
  brokenByScroll?: boolean
  /** Gold `this.terminalRows` — `evt(Math.min(B.length-K, terminalRows))`. */
  terminalRows?: number
}

/**
 * Official onRenderScreenReader frame-diff densable (no stdout write).
 * Callers write returned ANSI via materializeScreenReaderFrameAnsi.
 */
export function planScreenReaderFrameUpdate(input: {
  fullText: string
  columns: number
  prevLines: readonly string[]
  prevPark: ScreenReaderPark
  terminalRows: number
  cursor: ScreenReaderCursorDeclaration | null
  stringWidth?: (s: string) => number
  /** densable 2.1.218 preserveRanges from xYr */
  preserveRanges?: ReadonlyArray<readonly [number, number]>
  /** densable `$l` `rowPrefixRanges` — blockquote `"> "` per-row prefix. */
  rowPrefixRanges?: ReadonlyArray<RowPrefixRange>
  /**
   * densable GJc announcements already appended to fullText before planning.
   * When set, clamp rewriteFrom so announcements are always spoken (not skipped
   * as common prefix). Index is the first announcement line in `lines`.
   */
  announcementStartLine?: number
  /**
   * densable prevScreenReaderAnchor (default clean). Required for #15
   * suffix-append / #222 suffix-delete fast path safety.
   */
  prevAnchor?: ScreenReaderAnchor
  /**
   * densable prevScreenReaderParkDeclared — previous frame had a declared
   * cursor. Required for 2.1.222 #15 EOL delete fast path.
   */
  prevParkDeclared?: boolean
  /**
   * Gold `this.srPreParked` — CHA pre-park already wrote `$to` this rewrite.
   * Suffix-append / suffix-delete require `!srPreParked`.
   */
  srPreParked?: boolean
}): ScreenReaderFramePlan {
  const sw = input.stringWidth ?? ((s: string) => s.length)
  const { lines, lineBaseRows } = materializeScreenReaderLines(
    input.fullText,
    input.columns,
    input.preserveRanges,
    input.rowPrefixRanges,
  )
  const lastRow = Math.max(0, lines.length - 1)
  const park = computeScreenReaderPark(
    input.fullText,
    lineBaseRows,
    lines.length,
    input.columns,
    input.cursor,
    sw,
  ) ?? {
    row: lastRow,
    col: sw(lines[lastRow] ?? ''),
  }

  // Gold K / J / N: common prefix, then `if(N!==-1&&K>N)K=N`, then
  // `J=K===B.length&&K===x.length`.
  let common = 0
  const maxCommon = Math.min(input.prevLines.length, lines.length)
  while (common < maxCommon && input.prevLines[common] === lines[common]) {
    common++
  }
  const announcementStart = input.announcementStartLine
  if (
    announcementStart !== undefined &&
    announcementStart >= 0 &&
    common > announcementStart
  ) {
    common = announcementStart
  }
  const linesUnchanged =
    common === input.prevLines.length && common === lines.length
  const parkChanged =
    park.row !== input.prevPark.row || park.col !== input.prevPark.col
  const prevLastRow = Math.max(0, input.prevLines.length - 1)
  const lineCount = lines.length
  if (linesUnchanged && !parkChanged) {
    return {
      skip: true,
      park,
      rewriteFrom: common,
      rewriteLines: [],
      prevLastRow,
      prevPark: input.prevPark,
      prevLineCount: input.prevLines.length,
      lastRow,
      parkChanged: false,
      linesUnchanged: true,
      commonPrefixLength: common,
      lineCount,
      terminalRows: input.terminalRows,
    }
  }

  const prevAnchor = input.prevAnchor ?? 'clean'
  const prevPark = input.prevPark
  const srPreParked = input.srPreParked === true
  // Gold suffix: `!J && N===-1 && !srPreParked && (clean | lastRowAnchored…)`.
  const suffixFastPathGate =
    !linesUnchanged &&
    announcementStart === undefined &&
    !srPreParked &&
    (prevAnchor === 'clean' ||
      (prevAnchor === 'lastRowAnchored' &&
        common === input.prevLines.length - 1 &&
        prevPark.row === common &&
        park.row === common)) &&
    input.prevLines.length === lines.length &&
    common >= input.prevLines.length - input.terminalRows

  // densable 2.1.219 #15 suffix-append: also requires prevPark.row in viewport.
  if (
    suffixFastPathGate &&
    prevPark.row >= input.prevLines.length - input.terminalRows
  ) {
    const prevLine = input.prevLines[common] ?? ''
    const nextLine = lines[common] ?? ''
    if (nextLine.startsWith(prevLine) && !nextLine.includes('\t')) {
      let restSame = true
      for (let b = common + 1; b < input.prevLines.length; b++) {
        if (input.prevLines[b] !== lines[b]) {
          restSame = false
          break
        }
      }
      const suffix = restSame ? nextLine.slice(prevLine.length) : ''
      const prevWidth = suffix === '' ? 0 : sw(prevLine)
      if (
        suffix !== '' &&
        sw(String.fromCodePoint(suffix.codePointAt(0)!)) > 0 &&
        prevWidth + sw(suffix) === sw(nextLine) &&
        isGraphemeBoundary(nextLine, prevLine.length)
      ) {
        return {
          skip: false,
          park,
          rewriteFrom: common,
          rewriteLines: lines.slice(common),
          prevLastRow,
          prevPark: input.prevPark,
          prevLineCount: input.prevLines.length,
          lastRow,
          parkChanged,
          linesUnchanged: false,
          suffixAppend: {
            lineIndex: common,
            prevWidth,
            suffix,
          },
          commonPrefixLength: common,
          lineCount,
          terminalRows: input.terminalRows,
        }
      }
    }
  }

  // densable 2.1.222 #15 EOL delete: separate if — NO prevPark.row viewport gate.
  if (suffixFastPathGate) {
    const prevLine = input.prevLines[common] ?? ''
    const nextLine = lines[common] ?? ''
    if (prevLine.startsWith(nextLine) && !prevLine.includes('\t')) {
      let restSame = true
      for (let b = common + 1; b < input.prevLines.length; b++) {
        if (input.prevLines[b] !== lines[b]) {
          restSame = false
          break
        }
      }
      const deleted = restSame ? prevLine.slice(nextLine.length) : ''
      const keepWidth = deleted === '' ? 0 : sw(nextLine)
      const prevParkDeclared = input.prevParkDeclared === true
      if (
        deleted !== '' &&
        sw(String.fromCodePoint(deleted.codePointAt(0)!)) > 0 &&
        keepWidth + sw(deleted) === sw(prevLine) &&
        isGraphemeBoundary(prevLine, nextLine.length) &&
        (!/\s/.test(deleted) || /^\s+$/.test(deleted)) &&
        input.cursor !== null &&
        prevParkDeclared &&
        prevPark.row === common &&
        prevPark.col === sw(prevLine)
      ) {
        return {
          skip: false,
          park,
          rewriteFrom: common,
          rewriteLines: lines.slice(common),
          prevLastRow,
          prevPark: input.prevPark,
          prevLineCount: input.prevLines.length,
          lastRow,
          parkChanged,
          linesUnchanged: false,
          suffixDelete: {
            lineIndex: common,
            keepWidth,
          },
          commonPrefixLength: common,
          lineCount,
          terminalRows: input.terminalRows,
        }
      }
    }
  }

  // Gold after `$to` arm: empty-line walk may advance K to `ce`.
  // (`$to` itself stays in ink.tsx.)
  let rewriteFrom = common
  const viewportStart = input.prevLines.length - input.terminalRows
  if (viewportStart > rewriteFrom && viewportStart < lines.length) {
    let prevIdx = rewriteFrom
    let nextIdx = rewriteFrom
    while (nextIdx < viewportStart) {
      if (lines[nextIdx] === '') {
        nextIdx++
        continue
      }
      while (prevIdx < viewportStart && input.prevLines[prevIdx] === '') {
        prevIdx++
      }
      if (
        prevIdx === viewportStart ||
        input.prevLines[prevIdx] !== lines[nextIdx]
      ) {
        break
      }
      prevIdx++
      nextIdx++
    }
    if (nextIdx === viewportStart) rewriteFrom = viewportStart
  }
  // Gold `Ee` / `Ae`: `ce>K || (Ee && ce===K)` — not `ce>=x.length`.
  const pureShrinkAtEnd = rewriteFrom === lines.length && rewriteFrom > 0
  const brokenByScroll =
    viewportStart > rewriteFrom ||
    (pureShrinkAtEnd && viewportStart === rewriteFrom)

  const nextAnchor = computeNextScreenReaderAnchor({
    prevAnchor,
    rewriteFrom,
    newLineCount: lines.length,
    prevLineCount: input.prevLines.length,
    park,
    lastRow,
    prevPark,
    prevLastRow,
    brokenByScroll,
    terminalRows: input.terminalRows,
    linesUnchanged,
  })

  return {
    skip: false,
    park,
    rewriteFrom,
    rewriteLines: lines.slice(rewriteFrom),
    prevLastRow,
    prevPark: input.prevPark,
    prevLineCount: input.prevLines.length,
    lastRow,
    parkChanged,
    linesUnchanged,
    nextAnchor,
    commonPrefixLength: common,
    lineCount,
    brokenByScroll,
    terminalRows: input.terminalRows,
  }
}

/**
 * densable post-write prevScreenReaderAnchor update.
 *
 * Full rewrite path (`!g`): C / M>=viewport / M>0 cascade.
 * Park-only path (`g`): lastRowAnchored breaks if park left prev last row.
 * Suffix-append path does not call this (anchor unchanged).
 */
export function computeNextScreenReaderAnchor(input: {
  prevAnchor: ScreenReaderAnchor
  rewriteFrom: number
  newLineCount: number
  prevLineCount: number
  park: ScreenReaderPark
  lastRow: number
  prevPark: ScreenReaderPark
  prevLastRow: number
  brokenByScroll: boolean
  terminalRows: number
  /** densable `g` — lines identical; only park may have moved. */
  linesUnchanged?: boolean
}): ScreenReaderAnchor {
  // densable else if(g): lastRowAnchored && (y.row!==prevLast || p.row!==d)
  if (input.linesUnchanged) {
    if (
      input.prevAnchor === 'lastRowAnchored' &&
      (input.prevPark.row !== Math.max(0, input.prevLineCount - 1) ||
        input.park.row !== input.lastRow)
    ) {
      return 'broken'
    }
    return input.prevAnchor
  }

  // Gold se = x.length-K
  const rewritten = input.newLineCount - input.rewriteFrom
  const parkOnLast = input.park.row === input.newLineCount - 1
  const shrunk = input.newLineCount < input.prevLineCount
  const prevFitInViewport = input.prevLineCount <= input.terminalRows

  // Gold: if(Ae&&se<this.terminalRows) broken — not Ae alone.
  if (input.brokenByScroll && rewritten < input.terminalRows) {
    return 'broken'
  }

  // else if(se>=Math.min(x.length,this.terminalRows)) clean
  if (rewritten >= Math.min(input.newLineCount, input.terminalRows)) {
    return 'clean'
  }

  if (rewritten > 0) {
    if (input.prevAnchor === 'broken') {
      return parkOnLast ? 'lastRowAnchored' : 'broken'
    }
    // Gold lastRowAnchored: if(!ue) broken — else keep lastRowAnchored
    if (input.prevAnchor === 'lastRowAnchored') {
      return parkOnLast ? 'lastRowAnchored' : 'broken'
    }
    // clean (or unknown): only shrink+overflow flips to lastRowAnchored/broken
    if (shrunk && !prevFitInViewport) {
      return parkOnLast ? 'lastRowAnchored' : 'broken'
    }
    return input.prevAnchor
  }

  // M===0 densable:
  //   else if(lastRowAnchored) broken
  //   else if(N&&clean&&!P) L?lastRowAnchored:broken
  if (input.prevAnchor === 'lastRowAnchored') return 'broken'
  if (shrunk && input.prevAnchor === 'clean' && !prevFitInViewport) {
    return parkOnLast ? 'lastRowAnchored' : 'broken'
  }
  return input.prevAnchor
}

/** CSI helpers matching official _S / AEc / aki / i3n / OEe / TCh. */
function csi(...parts: Array<number | string>): string {
  return `\x1b[${parts.join('')}`
}
function cuu(n: number): string {
  return n === 0 ? '' : csi(n, 'A')
}
function cud(n: number): string {
  return n === 0 ? '' : csi(n, 'B')
}
function cha(col: number): string {
  return csi(col, 'G')
}
/** Official MHe(dx, dy) — horizontal then vertical relative move. */
function cursorMoveRel(dx: number, dy: number): string {
  let r = ''
  if (dx < 0) r += csi(-dx, 'D')
  else if (dx > 0) r += csi(dx, 'C')
  if (dy < 0) r += cuu(-dy)
  else if (dy > 0) r += cud(dy)
  return r
}
/**
 * Official s3n(e) — erase e lines upward from current row:
 * for each of e lines: EL entire (CSI 2K); between lines CUU 1; finally CHA 1.
 */
export function eraseScreenReaderLinesUp(count: number): string {
  if (count <= 0) return ''
  let t = ''
  for (let r = 0; r < count; r++) {
    t += csi(2, 'K')
    if (r < count - 1) t += cuu(1)
  }
  t += cha(1) // TCh
  return t
}

/**
 * Official onRenderScreenReader ANSI materialization densable (no stdout write).
 *
 * Official sequence:
 *   m = park→prevLastRow vertical home (MHe(0, f-d.row))
 *   y = s3n(prevLineCount - rewriteFrom) when rewriting mid-frame
 *   S = content rewrite (append / erase-only / erase+write)
 *   b = CHA(park.col+1) + MHe(0, park.row-lastRow)
 *   write(m+S+b)
 */
export function materializeScreenReaderFrameAnsi(
  plan: ScreenReaderFramePlan,
): string {
  if (plan.skip) return ''

  // densable 2.1.219 #15: B+L+G — move to end of prev line content, write
  // suffix only, then park. No erase / full-line rewrite.
  if (plan.suffixAppend) {
    const { lineIndex, prevWidth, suffix } = plan.suffixAppend
    const toLine =
      lineIndex !== plan.prevPark.row
        ? cursorMoveRel(0, lineIndex - plan.prevPark.row)
        : ''
    const toCol = cha(prevWidth + 1)
    const parkCol = Math.max(0, plan.park.col) + 1
    const parkSeq =
      cha(parkCol) +
      (plan.park.row !== lineIndex
        ? cursorMoveRel(0, plan.park.row - lineIndex)
        : '')
    return toLine + toCol + suffix + parkSeq
  }

  // densable 2.1.222 #15: CHA(keepWidth+1) + CSI K (EL) + park.
  // Park was required at EOL of the same line, so no vertical move to line.
  if (plan.suffixDelete) {
    const { lineIndex, keepWidth } = plan.suffixDelete
    const toCol = cha(keepWidth + 1)
    // densable tAo = PA("K") → CSI K (erase from cursor to end of line)
    const eraseToEol = csi('K')
    const parkCol = Math.max(0, plan.park.col) + 1
    const parkSeq =
      cha(parkCol) +
      (plan.park.row !== lineIndex
        ? cursorMoveRel(0, plan.park.row - lineIndex)
        : '')
    return toCol + eraseToEol + parkSeq
  }

  // m: home from previous park to previous last row (vertical only).
  const home =
    plan.prevPark.row !== plan.prevLastRow
      ? cursorMoveRel(0, plan.prevLastRow - plan.prevPark.row)
      : ''

  const rewriteFrom = plan.rewriteFrom
  const joined = plan.rewriteLines.join('\n')
  // newLineCount = rewriteFrom + rewriteLines.length (by construction)
  const newLineCount = rewriteFrom + plan.rewriteLines.length
  // Gold `evt(Math.min(B.length-K, this.terminalRows))` — cap erase to viewport.
  const eraseCount = Math.min(
    plan.prevLineCount - rewriteFrom,
    plan.terminalRows ?? plan.prevLineCount - rewriteFrom,
  )
  let content: string
  if (plan.linesUnchanged) {
    // Park-only update: no content rewrite.
    content = ''
  } else if (rewriteFrom === plan.prevLineCount) {
    // Pure append at end of previous frame.
    content = rewriteFrom > 0 ? `\n${joined}` : joined
  } else if (rewriteFrom === newLineCount) {
    // Gold K===x.length: pe, extra CUU only when K>0 && !Ae
    const erase = eraseScreenReaderLinesUp(eraseCount)
    content =
      rewriteFrom > 0 && plan.brokenByScroll !== true
        ? erase + cursorMoveRel(0, -1)
        : erase
  } else {
    // Mid-frame rewrite: erase upward then write joined rewrite lines.
    const erase = eraseScreenReaderLinesUp(eraseCount)
    content = erase + joined
  }

  // Park: CHA to 1-based col, then relative vertical from lastRow.
  const parkCol = Math.max(0, plan.park.col) + 1
  let parkSeq = cha(parkCol)
  if (plan.park.row !== plan.lastRow) {
    parkSeq += cursorMoveRel(0, plan.park.row - plan.lastRow)
  }

  return home + content + parkSeq
}

/**
 * Plan + materialize densable convenience: fullText → ANSI (or empty if skip).
 * Also returns next prevLines for callers that track frame state.
 */
export function planAndMaterializeScreenReaderFrame(input: {
  fullText: string
  columns: number
  prevLines: readonly string[]
  prevPark: ScreenReaderPark
  terminalRows: number
  cursor: ScreenReaderCursorDeclaration | null
  stringWidth?: (s: string) => number
}): {
  plan: ScreenReaderFramePlan
  ansi: string
  lines: string[]
} {
  const { lines } = materializeScreenReaderLines(input.fullText, input.columns)
  const plan = planScreenReaderFrameUpdate(input)
  return {
    plan,
    ansi: materializeScreenReaderFrameAnsi(plan),
    lines,
  }
}
