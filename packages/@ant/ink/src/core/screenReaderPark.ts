/**
 * Official computeScreenReaderPark densable (pure) + screen-reader frame plan
 * + onRenderScreenReader ANSI materialization.
 *
 * Maps a declared cursor (node start index in the full screen-reader text +
 * relativeX/Y) onto a {row, col} in the rendered screen-reader line list,
 * accounting for soft-wrap at `columns`.
 */

import { wrapAnsi } from './wrapAnsi.js'

export type ScreenReaderPark = {
  row: number
  col: number
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
 * Hard-wrap a single logical line to `columns` (official cq hard wrap subset).
 * Empty input yields one empty segment so empty logical lines still occupy a row.
 */
export function hardWrapScreenReaderLine(
  line: string,
  columns: number,
): string[] {
  if (line === '') return ['']
  if (columns <= 0) return [line]
  const out: string[] = []
  for (let i = 0; i < line.length; i += columns) {
    out.push(line.slice(i, i + columns))
  }
  return out
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
export function materializeScreenReaderLines(
  fullText: string,
  columns: number,
  preserveRanges: ReadonlyArray<readonly [number, number]> = [],
): { lines: string[]; lineBaseRows: number[] } {
  const merged = mergePreserveRanges(preserveRanges)
  const logical = fullText === '' ? [] : fullText.split('\n')
  const lines: string[] = []
  const lineBaseRows: number[] = []
  let charPos = 0
  for (const logicalLine of logical) {
    const lineEnd = charPos + logicalLine.length
    // densable L: trailing whitespace of this logical line is in a preserve range
    const trimmedLen = logicalLine.trimEnd().length
    const hasTrailing =
      charPos + trimmedLen < lineEnd &&
      merged.some(([s, e]) => s < lineEnd && lineEnd <= e)
    lineBaseRows.push(lines.length)
    if (logicalLine === '') {
      lines.push('')
    } else if (columns <= 0) {
      lines.push(logicalLine)
    } else {
      // Official cq(v, t, {trim:false, hard:true}) then split + trimEnd
      // (except last segment when trailing whitespace is preserved)
      const wrapped = wrapAnsi(logicalLine, columns, {
        trim: false,
        hard: true,
      })
      const segs = wrapped.split('\n')
      for (let p = 0; p < segs.length; p++) {
        const seg = segs[p]!
        lines.push(hasTrailing && p === segs.length - 1 ? seg : seg.trimEnd())
      }
    }
    // densable: a = O + 1  (logical line length + newline separator)
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
  /**
   * densable GJc announcements already appended to fullText before planning.
   * When set, clamp rewriteFrom so announcements are always spoken (not skipped
   * as common prefix). Index is the first announcement line in `lines`.
   */
  announcementStartLine?: number
}): ScreenReaderFramePlan {
  const { lines, lineBaseRows } = materializeScreenReaderLines(
    input.fullText,
    input.columns,
    input.preserveRanges,
  )
  const lastRow = Math.max(0, lines.length - 1)
  const park = computeScreenReaderPark(
    input.fullText,
    lineBaseRows,
    lines.length,
    input.columns,
    input.cursor,
    input.stringWidth,
  ) ?? {
    row: lastRow,
    col: (input.stringWidth ?? (s => s.length))(lines[lastRow] ?? ''),
  }

  let common = 0
  const maxCommon = Math.min(input.prevLines.length, lines.length)
  while (common < maxCommon && input.prevLines[common] === lines[common]) {
    common++
  }
  // densable: if(c!==-1&&f>c)f=c — announcements force rewrite from their line
  if (
    input.announcementStartLine !== undefined &&
    input.announcementStartLine >= 0 &&
    common > input.announcementStartLine
  ) {
    common = input.announcementStartLine
  }
  const linesUnchanged =
    common === input.prevLines.length &&
    common === lines.length &&
    input.announcementStartLine === undefined
  const parkChanged =
    park.row !== input.prevPark.row || park.col !== input.prevPark.col
  const prevLastRow = Math.max(0, input.prevLines.length - 1)
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
    }
  }

  // Official: if scrolled viewport starts after common prefix, clamp rewriteFrom.
  let rewriteFrom = common
  const scrolledAway = input.prevLines.length - input.terminalRows
  if (scrolledAway > rewriteFrom && scrolledAway < lines.length) {
    rewriteFrom = scrolledAway
  }

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
  }
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

  // m: home from previous park to previous last row (vertical only).
  const home =
    plan.prevPark.row !== plan.prevLastRow
      ? cursorMoveRel(0, plan.prevLastRow - plan.prevPark.row)
      : ''

  const rewriteFrom = plan.rewriteFrom
  const joined = plan.rewriteLines.join('\n')
  // newLineCount = rewriteFrom + rewriteLines.length (by construction)
  const newLineCount = rewriteFrom + plan.rewriteLines.length
  let content: string
  if (plan.linesUnchanged) {
    // Park-only update: no content rewrite.
    content = ''
  } else if (rewriteFrom === plan.prevLineCount) {
    // Pure append at end of previous frame.
    content = rewriteFrom > 0 ? `\n${joined}` : joined
  } else if (rewriteFrom === newLineCount) {
    // Official l===n.length → erase trailing old lines only (y + optional CUU 1)
    const erase = eraseScreenReaderLinesUp(plan.prevLineCount - rewriteFrom)
    content = rewriteFrom > 0 ? erase + cursorMoveRel(0, -1) : erase
  } else {
    // Mid-frame rewrite: erase upward then write joined rewrite lines.
    const erase = eraseScreenReaderLinesUp(plan.prevLineCount - rewriteFrom)
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
