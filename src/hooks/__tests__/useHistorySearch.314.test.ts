import { describe, expect, test } from 'bun:test'
import {
  expandHistoryEntryForSearch,
  findHistoryMatchCursorOffset,
} from '../useHistorySearch.js'

describe('#1423 useHistorySearch pastedContents matching', () => {
  test('expandHistoryEntryForSearch expands [Pasted text #N] pills for search matching', () => {
    const display = 'check this error [Pasted text #1 +3 lines]'
    const pastedContents = {
      1: {
        id: 1,
        type: 'text' as const,
        content: 'TypeError: Cannot read properties of undefined (reading foo)',
      },
    }
    const expanded = expandHistoryEntryForSearch(display, pastedContents)
    expect(expanded).toContain('Cannot read properties of undefined')
  })

  test('expandHistoryEntryForSearch caps each pasted text entry at 32768 chars', () => {
    const huge = 'a'.repeat(40000) + 'NEEDLE'
    const expanded = expandHistoryEntryForSearch('[Pasted text #1]', {
      1: { id: 1, type: 'text', content: huge },
    })
    expect(expanded.length).toBe(32768)
    expect(expanded).not.toContain('NEEDLE')
  })

  test('findHistoryMatchCursorOffset returns direct match index in value when present', () => {
    const offset = findHistoryMatchCursorOffset(
      'run tests for auth [Pasted text #1]',
      { 1: { id: 1, type: 'text', content: 'auth failure' } },
      'auth',
    )
    expect(offset).toBe(14)
  })

  test('findHistoryMatchCursorOffset falls back to [Pasted text #N] placeholder offset when match is inside pill', () => {
    const value = 'debug [Pasted text #1 +2 lines] please'
    const offset = findHistoryMatchCursorOffset(
      value,
      {
        1: {
          id: 1,
          type: 'text',
          content: 'ECONNREFUSED 127.0.0.1:5432',
        },
      },
      'econnrefused',
    )
    expect(offset).toBe(value.indexOf('[Pasted text #1 +2 lines]'))
  })
})
