/**
 * Vim Operator Functions
 *
 * Pure functions for executing vim operators (delete, change, yank, etc.)
 */

import { Cursor, isVimWhitespace } from '@anthropic/ink'
import {
  firstGrapheme,
  getGraphemeSegmenter,
  lastGrapheme,
} from '../utils/intl.js'
import { countCharInString } from '../utils/stringUtils.js'
import {
  isInclusiveMotion,
  isLinewiseMotion,
  resolveMotion,
} from './motions.js'
import { findTextObject } from './textObjects.js'
import type {
  FindType,
  Operator,
  RecordedChange,
  TextObjScope,
} from './types.js'

/**
 * Context for operator execution.
 */
export type OperatorContext = {
  cursor: Cursor
  text: string
  setText: (text: string) => void
  setOffset: (offset: number) => void
  enterInsert: (offset: number) => void
  getRegister: () => string
  /** densable #20: explicit linewise flag (not inferred from trailing \\n). */
  getRegisterIsLinewise: () => boolean
  setRegister: (content: string, linewise: boolean) => void
  getLastFind: () => { type: FindType; char: string } | null
  setLastFind: (type: FindType, char: string) => void
  recordChange: (change: RecordedChange) => void
}

/**
 * Execute an operator with a simple motion.
 */
export function executeOperatorMotion(
  op: Operator,
  motion: string,
  count: number,
  ctx: OperatorContext,
): void {
  const target = resolveMotion(motion, ctx.cursor, count)
  if (target.equals(ctx.cursor) && !isInclusiveMotion(motion)) {
    const changeWordAtEnd =
      op === 'change' &&
      (motion === 'w' || motion === 'W') &&
      count > 0 &&
      ctx.cursor.isAtEnd()
    if (motion === '0' || motion === '^' || changeWordAtEnd) {
      if (op === 'yank') ctx.setRegister('', false)
      else if (op === 'change') ctx.enterInsert(ctx.cursor.offset)
      recordNonYankChange(ctx, { type: 'operator', op, motion, count })
    }
    return
  }

  const range = getOperatorRange(ctx.cursor, target, motion, op, count)
  if (range.from === range.to) {
    if (op === 'change' || op === 'yank') ctx.setRegister('', false)
    if (op === 'change') {
      ctx.enterInsert(range.from)
      recordNonYankChange(ctx, { type: 'operator', op, motion, count })
    }
    return
  }
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  recordNonYankChange(ctx, { type: 'operator', op, motion, count })
}

/**
 * Execute an operator with a find motion.
 */
export function executeOperatorFind(
  op: Operator,
  findType: FindType,
  char: string,
  count: number,
  ctx: OperatorContext,
): void {
  const targetOffset = ctx.cursor.findCharacter(char, findType, count)
  if (targetOffset === null) return

  const target = new Cursor(ctx.cursor.measuredText, targetOffset)
  const range = getOperatorRangeForFind(ctx.cursor, target, findType)

  applyOperator(op, range.from, range.to, ctx)
  ctx.setLastFind(findType, char)
  recordNonYankChange(ctx, {
    type: 'operatorFind',
    op,
    find: findType,
    char,
    count,
  })
}

/**
 * Execute an operator with a text object.
 */
export function executeOperatorTextObj(
  op: Operator,
  scope: TextObjScope,
  objType: string,
  count: number,
  ctx: OperatorContext,
): void {
  const range = findTextObject(
    ctx.text,
    ctx.cursor.offset,
    objType,
    scope === 'inner',
  )
  if (!range) return

  applyOperator(op, range.start, range.end, ctx)
  recordNonYankChange(ctx, {
    type: 'operatorTextObj',
    op,
    objType,
    scope,
    count,
  })
}

/**
 * Execute a line operation (dd, cc, yy).
 */
export function executeLineOp(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  // Calculate logical line by counting newlines before cursor offset
  // (cursor.getPosition() returns wrapped line which is wrong for this)
  const currentLine = countCharInString(text.slice(0, ctx.cursor.offset), '\n')
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const lineStart = ctx.cursor.startOfLogicalLine().offset
  let lineEnd = lineStart
  for (let i = 0; i < linesToAffect; i++) {
    const nextNewline = text.indexOf('\n', lineEnd)
    lineEnd = nextNewline === -1 ? text.length : nextNewline + 1
  }

  let content = text.slice(lineStart, lineEnd)
  // Ensure linewise content ends with newline for paste detection
  if (!content.endsWith('\n')) {
    content = content + '\n'
  }
  ctx.setRegister(content, true)

  if (op === 'yank') {
    ctx.setOffset(lineStart)
  } else if (op === 'delete') {
    let deleteStart = lineStart
    const deleteEnd = lineEnd

    // If deleting to end of file and there's a preceding newline, include it
    // This ensures deleting the last line doesn't leave a trailing newline
    if (
      deleteEnd === text.length &&
      deleteStart > 0 &&
      text[deleteStart - 1] === '\n'
    ) {
      deleteStart -= 1
    }

    const newText = text.slice(0, deleteStart) + text.slice(deleteEnd)
    ctx.setText(newText || '')
    const maxOff = Math.max(
      0,
      newText.length - (lastGrapheme(newText).length || 1),
    )
    ctx.setOffset(Math.min(deleteStart, maxOff))
  } else if (op === 'change') {
    // For single line, just clear it
    if (lines.length === 1) {
      ctx.setText('')
      ctx.enterInsert(0)
    } else {
      // Delete all affected lines, replace with single empty line, enter insert
      const beforeLines = lines.slice(0, currentLine)
      const afterLines = lines.slice(currentLine + linesToAffect)
      const newText = [...beforeLines, '', ...afterLines].join('\n')
      ctx.setText(newText)
      ctx.enterInsert(lineStart)
    }
  }

  recordNonYankChange(ctx, { type: 'operator', op, motion: op[0]!, count })
}

/**
 * Execute delete character (x command).
 */
export function executeX(count: number, ctx: OperatorContext): void {
  const from = ctx.cursor.offset

  if (from >= ctx.text.length) return

  // Advance by graphemes, not code units
  let endCursor = ctx.cursor
  for (let i = 0; i < count && !endCursor.isAtEnd(); i++) {
    endCursor = endCursor.right()
  }
  const to = endCursor.offset

  const deleted = ctx.text.slice(from, to)
  const newText = ctx.text.slice(0, from) + ctx.text.slice(to)

  ctx.setRegister(deleted, false)
  ctx.setText(newText)
  const maxOff = Math.max(
    0,
    newText.length - (lastGrapheme(newText).length || 1),
  )
  ctx.setOffset(Math.min(from, maxOff))
  ctx.recordChange({ type: 'x', count })
}

/**
 * Execute replace character (r command).
 */
export function executeReplace(
  char: string,
  count: number,
  ctx: OperatorContext,
): void {
  let offset = ctx.cursor.offset
  let newText = ctx.text

  for (let i = 0; i < count && offset < newText.length; i++) {
    const graphemeLen = firstGrapheme(newText.slice(offset)).length || 1
    newText =
      newText.slice(0, offset) + char + newText.slice(offset + graphemeLen)
    offset += char.length
  }

  ctx.setText(newText)
  ctx.setOffset(Math.max(0, offset - char.length))
  ctx.recordChange({ type: 'replace', char, count })
}

/**
 * Execute toggle case (~ command).
 */
export function executeToggleCase(count: number, ctx: OperatorContext): void {
  const columns = ctx.cursor.measuredText.columns
  const startOffset = ctx.cursor.offset

  if (startOffset >= ctx.text.length) return

  let newText = ctx.text
  let offset = startOffset
  let toggled = 0

  while (
    offset < newText.length &&
    newText[offset] !== '\n' &&
    toggled < count
  ) {
    const grapheme = firstGrapheme(newText.slice(offset))
    const graphemeLen = grapheme.length

    const toggledGrapheme = (
      grapheme === grapheme.toUpperCase()
        ? grapheme.toLowerCase()
        : grapheme.toUpperCase()
    ).normalize('NFC')

    newText =
      newText.slice(0, offset) +
      toggledGrapheme +
      newText.slice(offset + graphemeLen)
    offset += toggledGrapheme.length
    toggled++
  }

  if (toggled === 0) return

  const newCursor = Cursor.fromText(newText, columns)
  ctx.setText(newText)
  ctx.setOffset(clampVimNormalOffset(newCursor, offset))
  ctx.recordChange({ type: 'toggleCase', count })
}

/**
 * Execute join lines (J command).
 */
export function executeJoin(count: number, ctx: OperatorContext): void {
  const text = ctx.text
  const lines = text.split('\n')
  const currentLine = getLogicalLineIndex(ctx.cursor.text, ctx.cursor.offset)

  if (currentLine >= lines.length - 1) return

  const linesToJoin = Math.min(count, lines.length - currentLine - 1)
  let joinedLine = lines[currentLine]!
  const cursorPos = joinedLine.length

  for (let i = 1; i <= linesToJoin; i++) {
    const nextLine = (lines[currentLine + i] ?? '').trimStart()
    if (nextLine.length > 0) {
      if (!joinedLine.endsWith(' ') && joinedLine.length > 0) {
        joinedLine += ' '
      }
      joinedLine += nextLine
    }
  }

  const newLines = [
    ...lines.slice(0, currentLine),
    joinedLine,
    ...lines.slice(currentLine + linesToJoin + 1),
  ]

  const newText = newLines.join('\n')
  ctx.setText(newText)
  ctx.setOffset(getLineStartOffset(newLines, currentLine) + cursorPos)
  ctx.recordChange({ type: 'join', count })
}

/**
 * Execute paste (p/P command).
 */
export function executePaste(
  after: boolean,
  count: number,
  ctx: OperatorContext,
): void {
  const register = ctx.getRegister()
  if (!register) return

  // densable Hmn: record paste for dot-repeat before mutating buffer
  ctx.recordChange({ type: 'paste', after, count })

  // densable 2.1.221 #20: prefer shared registerIsLinewise; trailing \\n
  // remains a content convention for linewise yanks (slice it off when set).
  const isLinewise = ctx.getRegisterIsLinewise() || register.endsWith('\n')
  const content =
    isLinewise && register.endsWith('\n') ? register.slice(0, -1) : register

  if (isLinewise) {
    const text = ctx.text
    const lines = text.split('\n')
    const currentLine = getLogicalLineIndex(ctx.cursor.text, ctx.cursor.offset)

    const insertLine = after ? currentLine + 1 : currentLine
    const contentLines = content.split('\n')
    const repeatedLines: string[] = []
    for (let i = 0; i < count; i++) {
      repeatedLines.push(...contentLines)
    }

    const newLines = [
      ...lines.slice(0, insertLine),
      ...repeatedLines,
      ...lines.slice(insertLine),
    ]

    const newText = newLines.join('\n')
    ctx.setText(newText)
    ctx.setOffset(getLineStartOffset(newLines, insertLine))
  } else {
    const textToInsert = content.repeat(count)
    const insertPoint =
      after && ctx.cursor.offset < ctx.text.length
        ? ctx.cursor.measuredText.nextOffset(ctx.cursor.offset)
        : ctx.cursor.offset

    const newText =
      ctx.text.slice(0, insertPoint) +
      textToInsert +
      ctx.text.slice(insertPoint)
    const lastGr = lastGrapheme(textToInsert)
    const newOffset = insertPoint + textToInsert.length - (lastGr.length || 1)

    ctx.setText(newText)
    ctx.setOffset(Math.max(insertPoint, newOffset))
  }
}

/**
 * Execute indent (>> command).
 */
export function executeIndent(
  dir: '>' | '<',
  count: number,
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  const currentLine = getLogicalLineIndex(ctx.cursor.text, ctx.cursor.offset)
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const indent = '  ' // Two spaces

  for (let i = 0; i < linesToAffect; i++) {
    const lineIdx = currentLine + i
    const line = lines[lineIdx] ?? ''

    if (dir === '>') {
      lines[lineIdx] = indent + line
    } else if (line.startsWith(indent)) {
      lines[lineIdx] = line.slice(indent.length)
    } else if (line.startsWith('\t')) {
      lines[lineIdx] = line.slice(1)
    } else {
      // Remove as much leading whitespace as possible up to indent length
      let removed = 0
      let idx = 0
      while (
        idx < line.length &&
        removed < indent.length &&
        /\s/.test(line[idx]!)
      ) {
        removed++
        idx++
      }
      lines[lineIdx] = line.slice(idx)
    }
  }

  const newText = lines.join('\n')
  const currentLineText = lines[currentLine] ?? ''
  const firstNonBlank = firstNonBlankIndex(currentLineText)

  ctx.setText(newText)
  ctx.setOffset(getLineStartOffset(lines, currentLine) + firstNonBlank)
  ctx.recordChange({ type: 'indent', dir, count })
}

/**
 * Execute open line (o/O command).
 */
export function executeOpenLine(
  direction: 'above' | 'below',
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  const currentLine = getLogicalLineIndex(ctx.cursor.text, ctx.cursor.offset)

  const insertLine = direction === 'below' ? currentLine + 1 : currentLine
  const newLines = [
    ...lines.slice(0, insertLine),
    '',
    ...lines.slice(insertLine),
  ]

  const newText = newLines.join('\n')
  ctx.setText(newText)
  ctx.enterInsert(getLineStartOffset(newLines, insertLine))
  ctx.recordChange({ type: 'openLine', direction })
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** densable `$e` — logical line index by counting newlines before offset. */
function getLogicalLineIndex(text: string, offset: number): number {
  return countCharInString(text.slice(0, offset), '\n')
}

/** densable `rt` (@197415050) — yank must not overwrite `.` dot-repeat. */
function recordNonYankChange(
  ctx: OperatorContext,
  change: Extract<
    RecordedChange,
    { type: 'operator' | 'operatorFind' | 'operatorTextObj' | 'visualOp' }
  >,
): void {
  if (change.op !== 'yank') {
    ctx.recordChange(change)
  }
}

/**
 * Calculate the offset of a line's start position.
 */
function getLineStartOffset(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).join('\n').length + (lineIndex > 0 ? 1 : 0)
}

function getOperatorRange(
  cursor: Cursor,
  target: Cursor,
  motion: string,
  op: Operator,
  count: number,
): { from: number; to: number; linewise: boolean } {
  let from = Math.min(cursor.offset, target.offset)
  let to = Math.max(cursor.offset, target.offset)
  let linewise = false

  // Special case: cw/cW changes to end of word, not start of next word
  const isChangeWord = op === 'change' && (motion === 'w' || motion === 'W')
  const curChar = cursor.text[cursor.offset]
  const onPlainWhitespace =
    (curChar === ' ' || curChar === '\t' || curChar === '\n') &&
    cursor.snapOutOfPlaceholder(cursor.offset, 'start') === cursor.offset

  if (isChangeWord && onPlainWhitespace) {
    let wordCursor = cursor
    for (let i = 0; i < count - 1; i++) {
      const next =
        motion === 'w' ? wordCursor.nextVimWord() : wordCursor.nextWORD()
      if (next.offset === wordCursor.offset) break
      wordCursor = next
    }
    to = Math.min(to, wordCursor.endOfLogicalLine().offset)
    if (to > from && cursor.text[to - 1] === '\n') {
      to -= 1
      const lineStart = cursor.startOfLogicalLine().offset
      if (/^[ \t]*$/.test(cursor.text.slice(lineStart, from))) {
        from = lineStart
        linewise = true
      }
    }
  } else if (isChangeWord) {
    // For cw with count, move forward (count-1) words, then find end of that word
    let wordCursor = cursor
    for (let i = 0; i < count - 1; i++) {
      wordCursor =
        motion === 'w' ? wordCursor.nextVimWord() : wordCursor.nextWORD()
    }
    let wordEnd =
      motion === 'w' ? wordCursor.endOfVimWord() : wordCursor.endOfWORD()
    const nextOff = cursor.measuredText.nextOffset(wordCursor.offset)
    const nextWord =
      motion === 'w' ? wordCursor.nextVimWord() : wordCursor.nextWORD()
    if (
      (nextOff >= cursor.text.length ||
        isVimWhitespace(cursor.text[nextOff] ?? '') ||
        nextWord.offset === nextOff) &&
      !isVimWhitespace(cursor.text[cursor.offset] ?? '') &&
      !isVimWhitespace(cursor.text[wordCursor.offset] ?? '')
    ) {
      wordEnd = wordCursor
    }
    to = cursor.measuredText.nextOffset(wordEnd.offset)
  } else if (isLinewiseMotion(motion)) {
    // Linewise motions extend to include entire lines
    linewise = true
    const text = cursor.text
    const nextNewline = text.indexOf('\n', to)
    if (nextNewline === -1) {
      // Deleting to end of file - include the preceding newline if exists
      to = text.length
      if (from > 0 && text[from - 1] === '\n') {
        from -= 1
      }
    } else {
      to = nextNewline + 1
    }
  } else if (
    isInclusiveMotion(motion) &&
    cursor.offset <= target.offset &&
    cursor.text[to] !== '\n'
  ) {
    to = cursor.measuredText.nextOffset(to)
  }

  // Word motions can land inside a placeholder chip; extend the range to
  // cover the whole chip so dw/cw/yw never leave a partial placeholder.
  from = cursor.snapOutOfPlaceholder(from, 'start')
  to = cursor.snapOutOfPlaceholder(to, 'end')

  return { from, to, linewise }
}

/**
 * Get the range for a find-based operator.
 * Note: _findType is unused because Cursor.findCharacter already adjusts
 * the offset for t/T motions. All find types are treated as inclusive here.
 */
function getOperatorRangeForFind(
  cursor: Cursor,
  target: Cursor,
  _findType: FindType,
): { from: number; to: number } {
  const maxOffset = Math.max(cursor.offset, target.offset)
  const from = cursor.snapOutOfPlaceholder(
    Math.min(cursor.offset, target.offset),
    'start',
  )
  const to = cursor.snapOutOfPlaceholder(
    cursor.measuredText.nextOffset(maxOffset),
    'end',
  )
  return { from, to }
}

function applyOperator(
  op: Operator,
  from: number,
  to: number,
  ctx: OperatorContext,
  linewise: boolean = false,
): void {
  let content = ctx.text.slice(from, to)
  // Ensure linewise content ends with newline for paste detection
  if (linewise && !content.endsWith('\n')) {
    content = content + '\n'
  }
  ctx.setRegister(content, linewise)

  if (op === 'yank') {
    ctx.setOffset(from)
  } else if (op === 'delete') {
    const newText = ctx.text.slice(0, from) + ctx.text.slice(to)
    ctx.setText(newText)
    const maxOff = Math.max(
      0,
      newText.length - (lastGrapheme(newText).length || 1),
    )
    ctx.setOffset(Math.min(from, maxOff))
  } else if (op === 'change') {
    const newText = ctx.text.slice(0, from) + ctx.text.slice(to)
    ctx.setText(newText)
    ctx.enterInsert(from)
  }
}

export function executeOperatorG(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  // count=1 means no count given, target = end of file
  // otherwise target = line N
  const target =
    count === 1 ? ctx.cursor.startOfLastLine() : ctx.cursor.goToLine(count)

  if (target.equals(ctx.cursor)) return

  const range = getOperatorRange(ctx.cursor, target, 'G', op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  recordNonYankChange(ctx, { type: 'operator', op, motion: 'G', count })
}

export function executeOperatorGg(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  // count=1 means no count given, target = first line
  // otherwise target = line N
  const target =
    count === 1 ? ctx.cursor.startOfFirstLine() : ctx.cursor.goToLine(count)

  if (target.equals(ctx.cursor)) return

  const range = getOperatorRange(ctx.cursor, target, 'gg', op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  recordNonYankChange(ctx, { type: 'operator', op, motion: 'gg', count })
}

// ============================================================================
// Visual Mode & Clamping Helpers (densable 2.1.292-295)
// ============================================================================

/**
 * densable `cbe` / `$te`: clamp a vim NORMAL offset so it never lands on a
 * trailing `\n` (unless the line is empty) or past the end of a non-newline-
 * terminated buffer, and never lands inside a placeholder.
 */
export function clampVimNormalOffset(
  cursor: Cursor,
  offset: number,
  text: string = cursor.text,
): number {
  let clamped = offset
  if (text[clamped] === '\n' && clamped > 0 && text[clamped - 1] !== '\n') {
    clamped = clamped - (lastGrapheme(text.slice(0, clamped)).length || 1)
  } else if (clamped >= text.length && !text.endsWith('\n')) {
    clamped = Math.max(0, text.length - (lastGrapheme(text).length || 1))
  }
  return cursor.snapOutOfPlaceholder(clamped, 'start') === clamped
    ? clamped
    : offset
}

/**
 * densable `ge`: index of first non-blank grapheme in a line, or the index of
 * the last blank grapheme if the line is all spaces/tabs (0 for empty line).
 * Prevents `>>`/`<<` on an all-whitespace line from placing the cursor past
 * the end of the line.
 */
export function firstNonBlankIndex(line: string): number {
  let idx = 0
  for (const { segment, index } of getGraphemeSegmenter().segment(line)) {
    idx = index
    if (segment !== ' ' && segment !== '\t') break
  }
  return idx
}

function findLogicalLineStartInText(text: string, offset: number): number {
  if (offset === 0) return 0
  const prev = text.lastIndexOf('\n', offset - 1)
  return prev === -1 ? 0 : prev + 1
}

function getVisualRange(
  anchor: number,
  cursor: Cursor,
  linewise: boolean,
): { from: number; to: number } {
  const start = Math.min(anchor, cursor.offset)
  const end = Math.max(anchor, cursor.offset)
  if (!linewise) {
    const endLine = cursor.text.indexOf('\n', end)
    const nextOffset =
      end < cursor.text.length && endLine !== end
        ? cursor.measuredText.nextOffset(end)
        : end
    return { from: start, to: nextOffset }
  }
  const from = findLogicalLineStartInText(cursor.text, start)
  const nlAfterEnd = cursor.text.indexOf('\n', end)
  const to = nlAfterEnd === -1 ? cursor.text.length : nlAfterEnd + 1
  return { from, to }
}

function countVisualSpan(slice: string, linewise: boolean): number {
  if (linewise) {
    const newlines = countCharInString(slice, '\n')
    return slice.endsWith('\n') ? newlines : newlines + 1
  }
  let count = 0
  for (const _ of getGraphemeSegmenter().segment(slice)) count++
  return count
}

function getSpanRange(
  ctx: OperatorContext,
  span: number,
  linewise: boolean,
): { from: number; to: number } {
  const text = ctx.text
  if (linewise) {
    const from = findLogicalLineStartInText(text, ctx.cursor.offset)
    let to = from
    for (let i = 0; i < span; i++) {
      const nl = text.indexOf('\n', to)
      if (nl === -1) {
        to = text.length
        break
      }
      to = nl + 1
    }
    return { from, to }
  }
  const from = ctx.cursor.offset
  let to = from
  for (let i = 0; i < span && to < text.length; i++) {
    to = ctx.cursor.measuredText.nextOffset(to)
  }
  return { from, to }
}

function applyVisualRangeOp(
  op: Operator,
  from: number,
  to: number,
  ctx: OperatorContext,
  linewise: boolean,
  trailingEmptyLine: boolean = false,
): void {
  if (linewise && op === 'change') {
    const raw = ctx.text.slice(from, to)
    const reg = raw.endsWith('\n') ? raw : raw + '\n'
    ctx.setRegister(reg, true)
    const before = ctx.text.slice(0, from)
    const after = ctx.text.slice(to)
    const needNewline =
      after !== '' || (raw.endsWith('\n') && !trailingEmptyLine)
    ctx.setText(before + (needNewline ? '\n' : '') + after)
    ctx.enterInsert(from)
    return
  }

  if (linewise && op === 'delete') {
    const raw = ctx.text.slice(from, to)
    const reg = raw.endsWith('\n') ? raw : raw + '\n'
    ctx.setRegister(reg, true)
    let cutFrom = from
    if (to === ctx.text.length && from > 0 && ctx.text[from - 1] === '\n') {
      cutFrom -= 1
    }
    const hasFollowing = to < ctx.text.length
    const newText = ctx.text.slice(0, cutFrom) + ctx.text.slice(to)
    ctx.setText(newText)

    const lineStart = hasFollowing
      ? from
      : findLogicalLineStartInText(newText, newText.length)
    const lineEndIdx = newText.indexOf('\n', lineStart)
    const lineEnd = lineEndIdx === -1 ? newText.length : lineEndIdx
    const lineText = newText.slice(lineStart, lineEnd)
    const lineCursor = Cursor.fromText(
      lineText,
      ctx.cursor.measuredText.columns + 1,
    )
    const firstNonBlank = firstNonBlankIndex(lineText)
    const landing =
      lineCursor.placeholderStartingAt(firstNonBlank) === null
        ? firstNonBlank
        : firstNonBlank > 0 || hasFollowing
          ? 0
          : clampVimNormalOffset(lineCursor, lineText.length)
    const onTrailingPlaceholder =
      !hasFollowing && lineCursor.placeholderStartingAt(landing) !== null
    ctx.setOffset(
      onTrailingPlaceholder
        ? clampVimNormalOffset(ctx.cursor, newText.length, newText)
        : lineStart + landing,
    )
    return
  }

  applyOperator(op, from, to, ctx, linewise)
}

/**
 * Execute a visual mode operator (e.g. `V` + `d`) and record for `.` repeat.
 */
export function executeVisualOp(
  op: Operator,
  anchor: number,
  ctx: OperatorContext,
  linewise: boolean,
): void {
  const { from, to } = getVisualRange(anchor, ctx.cursor, linewise)
  const span = countVisualSpan(ctx.text.slice(from, to), linewise)
  const trailingEmpty =
    linewise &&
    ctx.text.endsWith('\n') &&
    Math.max(anchor, ctx.cursor.offset) >= ctx.text.length
  applyVisualRangeOp(op, from, to, ctx, linewise, trailingEmpty)
  recordNonYankChange(ctx, { type: 'visualOp', op, span, linewise })
}

/**
 * Repeat a recorded visual mode operator (`.` after `V` + `d`, etc.) on the
 * current cursor's line/position.
 */
export function repeatVisualOp(
  op: Operator,
  span: number,
  linewise: boolean,
  ctx: OperatorContext,
): void {
  const { from, to } = getSpanRange(ctx, span, linewise)
  if (from === to && !(linewise && ctx.text.length > 0)) return
  applyVisualRangeOp(op, from, to, ctx, linewise)
}
