import { describe, expect, test } from 'bun:test'
import { classifyCopyOnSelectSettle } from '../useCopyOnSelect.js'

describe('useCopyOnSelect densable 2.1.234 (#15)', () => {
  test('y8i settle matrix: drag / clear / spurious / skip / whitespace / copy', () => {
    expect(
      classifyCopyOnSelectSettle({
        isDragging: true,
        hasSelection: true,
        alreadyCopied: false,
        copyOnSelect: true,
        text: 'abc',
      }),
    ).toEqual({ kind: 'reset' })

    expect(
      classifyCopyOnSelectSettle({
        isDragging: false,
        hasSelection: false,
        alreadyCopied: true,
        copyOnSelect: true,
        text: 'abc',
      }),
    ).toEqual({ kind: 'reset' })

    expect(
      classifyCopyOnSelectSettle({
        isDragging: false,
        hasSelection: true,
        alreadyCopied: true,
        copyOnSelect: true,
        text: 'abc',
      }),
    ).toEqual({ kind: 'spurious' })

    expect(
      classifyCopyOnSelectSettle({
        isDragging: false,
        hasSelection: true,
        alreadyCopied: false,
        copyOnSelect: false,
        text: 'abc',
      }),
    ).toEqual({ kind: 'skip' })

    expect(
      classifyCopyOnSelectSettle({
        isDragging: false,
        hasSelection: true,
        alreadyCopied: false,
        copyOnSelect: true,
        text: '   ',
      }),
    ).toEqual({ kind: 'whitespace' })

    expect(
      classifyCopyOnSelectSettle({
        isDragging: false,
        hasSelection: true,
        alreadyCopied: false,
        copyOnSelect: true,
        text: 'hello',
      }),
    ).toEqual({ kind: 'copy', text: 'hello' })
  })
})
