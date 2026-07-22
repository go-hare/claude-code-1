import { describe, expect, test } from 'bun:test'
import { countEditLines } from '../focusTranscript.js'

describe('countEditLines', () => {
  test('FileEdit top-level new/old string uses newline-span counts', () => {
    expect(
      countEditLines('Edit', {
        old_string: 'a\nb',
        new_string: 'a\nb\nc',
      }),
    ).toEqual({ added: 3, removed: 2 })
  })

  test('FileEdit multi-hunk edits[] sums per-hunk newline spans', () => {
    expect(
      countEditLines('Edit', {
        edits: [
          { old_string: 'a', new_string: 'a\nb' },
          { old_string: 'x\ny', new_string: 'z' },
        ],
      }),
    ).toEqual({
      // two hunks summed
      added: 3,
      removed: 3,
    })
  })

  test('FileEdit empty / non-object input → 0', () => {
    expect(countEditLines('Edit', null)).toEqual({ added: 0, removed: 0 })
    expect(countEditLines('Edit', {})).toEqual({ added: 0, removed: 0 })
    expect(countEditLines('Edit', { new_string: '', old_string: '' })).toEqual({
      added: 0,
      removed: 0,
    })
  })

  test('Write counts content lines, removed 0', () => {
    expect(countEditLines('Write', { content: 'one\ntwo\nthree' })).toEqual({
      added: 3,
      removed: 0,
    })
  })

  test('NotebookEdit counts new_source, removed 0', () => {
    expect(
      countEditLines('NotebookEdit', { new_source: 'cell\nline' }),
    ).toEqual({ added: 2, removed: 0 })
  })

  test('unknown tool → 0', () => {
    expect(countEditLines('Bash', { command: 'ls' })).toEqual({
      added: 0,
      removed: 0,
    })
  })

  test('edits[] wins over top-level when both present', () => {
    // edits[] branch first
    expect(
      countEditLines('Edit', {
        old_string: 'ignored',
        new_string: 'also ignored',
        edits: [{ old_string: 'a', new_string: 'b\nc' }],
      }),
    ).toEqual({ added: 2, removed: 1 })
  })
})
