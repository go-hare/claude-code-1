import { describe, expect, test } from 'bun:test'
import { Cursor, MeasuredText } from '@anthropic/ink'
import { isInclusiveMotion, resolveMotion } from '../motions.js'
import { SIMPLE_MOTIONS } from '../types.js'

describe('2.1.301 #845 vim % matching bracket motion', () => {
  test('SIMPLE_MOTIONS includes % and isInclusiveMotion("%") is true', () => {
    expect(SIMPLE_MOTIONS.has('%')).toBe(true)
    expect(isInclusiveMotion('%')).toBe(true)
  })

  test('% jumps from opening to closing bracket and back', () => {
    const text = 'foo(bar[baz])'
    const mt = new MeasuredText(text, 80)
    const atOpen = new Cursor(mt, 3) // '('
    const jumpedToClose = resolveMotion('%', atOpen, 1)
    expect(jumpedToClose.offset).toBe(12) // ')'
    const jumpedBack = resolveMotion('%', jumpedToClose, 1)
    expect(jumpedBack.offset).toBe(3)
  })

  test('% scans forward on current line to find first bracket', () => {
    const text = 'hello (world)\nnext'
    const mt = new MeasuredText(text, 80)
    const start = new Cursor(mt, 0)
    expect(resolveMotion('%', start, 1).offset).toBe(12)
  })

  test('% is a no-op when no bracket exists on current line', () => {
    const text = 'hello world\n(next)'
    const mt = new MeasuredText(text, 80)
    const start = new Cursor(mt, 0)
    expect(resolveMotion('%', start, 1).offset).toBe(0)
  })
})
