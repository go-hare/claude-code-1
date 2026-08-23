import { describe, expect, test } from 'bun:test'
import { Cursor } from '../Cursor.js'

describe('Cursor.backspaceH densable 2.1.238', () => {
  test('deletes one grapheme before cursor', () => {
    const c = Cursor.fromText('abc', 80, 3)
    const next = c.backspaceH()
    expect(next.text).toBe('ab')
    expect(next.offset).toBe(2)
  })

  test('no-op at start', () => {
    const c = Cursor.fromText('abc', 80, 0)
    const next = c.backspaceH()
    expect(next).toBe(c)
  })

  test('backspace() alias equals backspaceH()', () => {
    const a = Cursor.fromText('xy', 80, 2).backspaceH()
    const b = Cursor.fromText('xy', 80, 2).backspace()
    expect(a.text).toBe(b.text)
    expect(a.offset).toBe(b.offset)
  })
})
