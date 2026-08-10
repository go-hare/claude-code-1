/**
 * densable 2.1.222 #15 — --ax-screen-reader EOL backspace only echoes
 * deleted region (CSI K), not full-line rewrite.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  materializeScreenReaderFrameAnsi,
  planScreenReaderFrameUpdate,
} from '../screenReaderPark.js'

/** Non-null cursor with invalid nodeStart → park falls back to last-line EOL. */
const declaredCursor = {
  nodeStartIndex: -1,
  relativeX: 0,
  relativeY: 0,
}

describe('densable 2.1.222 #15 suffix-delete (EOL backspace)', () => {
  test('clean + park at EOL + declared → suffixDelete, no full-line rewrite', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hell',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: declaredCursor,
      prevAnchor: 'clean',
      prevParkDeclared: true,
      stringWidth: s => s.length,
    })
    expect(plan.skip).toBe(false)
    expect(plan.suffixDelete).toEqual({
      lineIndex: 0,
      keepWidth: 4,
    })
    expect(plan.suffixAppend).toBeUndefined()
    expect(plan.nextAnchor).toBeUndefined()

    const ansi = materializeScreenReaderFrameAnsi(plan)
    // densable tAo = CSI K (erase to end of line) — not CSI 2K full-line erase
    expect(ansi).toContain('\x1b[K')
    expect(ansi).not.toContain('\x1b[2K')
    // CHA to keepWidth+1 = 5
    expect(ansi).toContain('\x1b[5G')
    // must not re-emit remaining text (only EL clears deleted chars)
    expect(ansi).not.toContain('hell')
  })

  test('without prevParkDeclared falls back to full rewrite', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hell',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: declaredCursor,
      prevAnchor: 'clean',
      prevParkDeclared: false,
      stringWidth: s => s.length,
    })
    expect(plan.suffixDelete).toBeUndefined()
    const ansi = materializeScreenReaderFrameAnsi(plan)
    expect(ansi).toContain('\x1b[2K')
  })

  test('null cursor (no declaration) cannot suffixDelete', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hell',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: null,
      prevAnchor: 'clean',
      prevParkDeclared: true,
      stringWidth: s => s.length,
    })
    expect(plan.suffixDelete).toBeUndefined()
  })

  test('park not at EOL cannot suffixDelete', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hell',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 3 }, // mid-line
      terminalRows: 24,
      cursor: declaredCursor,
      prevAnchor: 'clean',
      prevParkDeclared: true,
      stringWidth: s => s.length,
    })
    expect(plan.suffixDelete).toBeUndefined()
  })

  test('mid-line delete (not pure suffix) cannot suffixDelete', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'helo', // deleted 'l' from middle of hello
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: declaredCursor,
      prevAnchor: 'clean',
      prevParkDeclared: true,
      stringWidth: s => s.length,
    })
    expect(plan.suffixDelete).toBeUndefined()
  })

  test('all-space delete suffix is allowed (densable whitespace rule)', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hi',
      columns: 80,
      prevLines: ['hi  '],
      prevPark: { row: 0, col: 4 },
      terminalRows: 24,
      cursor: declaredCursor,
      prevAnchor: 'clean',
      prevParkDeclared: true,
      stringWidth: s => s.length,
    })
    expect(plan.suffixDelete).toEqual({
      lineIndex: 0,
      keepWidth: 2,
    })
  })

  test('mixed space+letter delete is rejected', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hi',
      columns: 80,
      prevLines: ['hi x'],
      prevPark: { row: 0, col: 4 },
      terminalRows: 24,
      cursor: declaredCursor,
      prevAnchor: 'clean',
      prevParkDeclared: true,
      stringWidth: s => s.length,
    })
    // deleted = " x" — has space but not all-space → densable rejects
    expect(plan.suffixDelete).toBeUndefined()
  })

  test('wire-up: ink tracks prevScreenReaderParkDeclared', () => {
    const src = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
    expect(src).toContain('prevScreenReaderParkDeclared')
    expect(src).toContain('prevParkDeclared:')
  })
})
