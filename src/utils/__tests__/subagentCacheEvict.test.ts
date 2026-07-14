import { describe, expect, test } from 'bun:test'
import {
  isEvictableMediaBlock,
  isSubagentCacheEvictEnabled,
} from '../subagentCacheEvict.js'

describe('isSubagentCacheEvictEnabled', () => {
  test('prereq false', () => {
    expect(
      isSubagentCacheEvictEnabled({
        prerequisitesMet: false,
        env: { CLAUDE_CODE_SUBAGENT_CACHE_EVICT: '1' },
      }),
    ).toBe(false)
  })
  test('env forces on', () => {
    expect(
      isSubagentCacheEvictEnabled({
        prerequisitesMet: true,
        env: { CLAUDE_CODE_SUBAGENT_CACHE_EVICT: '1' },
        gbValue: false,
      }),
    ).toBe(true)
  })
  test('gb when env unset', () => {
    expect(
      isSubagentCacheEvictEnabled({
        prerequisitesMet: true,
        env: {},
        gbValue: true,
      }),
    ).toBe(true)
  })
})

describe('isEvictableMediaBlock', () => {
  test('image/document only', () => {
    expect(isEvictableMediaBlock({ type: 'image' })).toBe(true)
    expect(isEvictableMediaBlock({ type: 'document' })).toBe(true)
    expect(isEvictableMediaBlock({ type: 'text' })).toBe(false)
  })
})
