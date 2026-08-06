import { describe, expect, test } from 'bun:test'
import {
  fileStateContentHash,
  fileStateContentMatches,
  isFullEnoughFileRead,
  type FileState,
} from '../fileStateCache.js'

function state(partial: Partial<FileState> & { content: string }): FileState {
  return {
    timestamp: 1,
    offset: undefined,
    limit: undefined,
    ...partial,
  }
}

describe('isFullEnoughFileRead densable HOe', () => {
  test('offset > 1 is not full enough', () => {
    expect(isFullEnoughFileRead(state({ content: 'a\nb\nc', offset: 2 }))).toBe(
      false,
    )
  })

  test('isPartialView is not full enough', () => {
    expect(
      isFullEnoughFileRead(
        state({ content: 'a\nb', offset: 1, isPartialView: true }),
      ),
    ).toBe(false)
  })

  test('no limit is full enough when offset at start', () => {
    expect(isFullEnoughFileRead(state({ content: 'whole', offset: 1 }))).toBe(
      true,
    )
    expect(
      isFullEnoughFileRead(state({ content: 'whole', offset: undefined })),
    ).toBe(true)
  })

  test('limit with content shorter than limit (line count) is full enough', () => {
    // 3 lines, limit 10 → Tu+1=3 < 10
    expect(
      isFullEnoughFileRead(state({ content: 'a\nb\nc', offset: 1, limit: 10 })),
    ).toBe(true)
  })

  test('limit equal to line count is NOT full enough', () => {
    // densable: newlines+1 < limit (strict)
    expect(
      isFullEnoughFileRead(state({ content: 'a\nb\nc', offset: 1, limit: 3 })),
    ).toBe(false)
  })

  test('empty content with limit is not full enough', () => {
    expect(
      isFullEnoughFileRead(state({ content: '', offset: 1, limit: 10 })),
    ).toBe(false)
  })
})

describe('fileStateContentMatches densable xOe', () => {
  test('string equality when no contentHash', () => {
    const s = state({ content: 'hello' })
    expect(fileStateContentMatches(s, 'hello')).toBe(true)
    expect(fileStateContentMatches(s, 'other')).toBe(false)
  })

  test('contentHash path prefers hash', () => {
    const content = 'hashed-body'
    const s = state({
      content: 'stale-stored',
      contentHash: fileStateContentHash(content),
    })
    expect(fileStateContentMatches(s, content)).toBe(true)
    expect(fileStateContentMatches(s, 'nope')).toBe(false)
  })
})
