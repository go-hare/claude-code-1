/**
 * Vim Motion Functions
 *
 * Pure functions for resolving vim motions to cursor positions.
 */

import { Cursor } from '@anthropic/ink'
import { findTextObject } from './textObjects.js'

function findMatchingBracket(text: string, offset: number): number | null {
  const lineEnd = text.indexOf('\n', offset)
  const end = lineEnd === -1 ? text.length : lineEnd
  const rel = text.slice(offset, end).search(/[()[\]{}]/)
  if (rel === -1) return null
  const bracketOffset = offset + rel
  const range = findTextObject(text, bracketOffset, text[bracketOffset]!, false)
  if (!range) return null
  return range.start === bracketOffset ? range.end - 1 : range.start
}

/**
 * Resolve a motion to a target cursor position.
 * Does not modify anything - pure calculation.
 */
export function resolveMotion(
  key: string,
  cursor: Cursor,
  count: number,
): Cursor {
  let result = cursor
  for (let i = 0; i < count; i++) {
    const next = applySingleMotion(key, result)
    if (next.equals(result)) break
    result = next
  }
  return result
}

/**
 * Apply a single motion step.
 */
function applySingleMotion(key: string, cursor: Cursor): Cursor {
  switch (key) {
    case 'h':
      return cursor.left()
    case 'l':
    case ' ':
      return cursor.right()
    case 'j':
      return cursor.downLogicalLine()
    case 'k':
      return cursor.upLogicalLine()
    case 'gj':
      return cursor.down()
    case 'gk':
      return cursor.up()
    case 'w':
      return cursor.nextVimWord()
    case 'b':
      return cursor.prevVimWord()
    case 'e':
      return cursor.endOfVimWord()
    case 'W':
      return cursor.nextWORD()
    case 'B':
      return cursor.prevWORD()
    case 'E':
      return cursor.endOfWORD()
    case '0':
      return cursor.startOfLogicalLine()
    case '^':
      return cursor.firstNonBlankInLogicalLine()
    case '$':
      return cursor.lastCharInLogicalLine()
    case 'G':
      return cursor.startOfLastLine()
    case '%': {
      const matchOffset = findMatchingBracket(cursor.text, cursor.offset)
      return matchOffset === null
        ? cursor
        : new Cursor(cursor.measuredText, matchOffset)
    }
    default:
      return cursor
  }
}

/**
 * Check if a motion is inclusive (includes character at destination).
 */
export function isInclusiveMotion(key: string): boolean {
  return 'eE$%'.includes(key)
}

/**
 * Check if a motion is linewise (operates on full lines when used with operators).
 * Note: gj/gk are characterwise exclusive per `:help gj`, not linewise.
 */
export function isLinewiseMotion(key: string): boolean {
  return 'jkG'.includes(key) || key === 'gg'
}
