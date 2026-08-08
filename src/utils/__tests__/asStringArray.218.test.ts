/**
 * densable 2.1.218 #24 — q0 asStringArray coerce for malformed delta attachments.
 */
import { describe, expect, test } from 'bun:test'
import { asStringArray } from '../stringUtils.js'
import { normalizeAttachmentForAPI } from '../messages.js'

describe('densable 2.1.218 #24 asStringArray (q0)', () => {
  test('non-array → []', () => {
    expect(asStringArray(undefined)).toEqual([])
    expect(asStringArray(null)).toEqual([])
    expect(asStringArray('bad')).toEqual([])
    expect(asStringArray({ foo: 1 })).toEqual([])
  })

  test('all-string array passes through', () => {
    const a = ['a', 'b']
    expect(asStringArray(a)).toBe(a)
  })

  test('mixed array filters to strings only', () => {
    expect(asStringArray(['a', 1, 'b', null, 'c'])).toEqual(['a', 'b', 'c'])
  })
})

describe('densable 2.1.218 #24 normalizeAttachmentForAPI delta safety', () => {
  test('malformed deferred_tools_delta does not throw', () => {
    // missing/non-array fields would previously throw on .length / .join
    const out = normalizeAttachmentForAPI({
      type: 'deferred_tools_delta',
      addedLines: null as unknown as string[],
      addedNames: [1, 'x'] as unknown as string[],
      removedNames: undefined as unknown as string[],
    } as never)
    expect(Array.isArray(out)).toBe(true)
  })

  test('malformed agent_listing_delta does not throw', () => {
    const out = normalizeAttachmentForAPI({
      type: 'agent_listing_delta',
      addedLines: 'not-array' as unknown as string[],
      addedTypes: null as unknown as string[],
      removedTypes: [1, 2] as unknown as string[],
      isInitial: false,
      showConcurrencyNote: false,
    } as never)
    expect(Array.isArray(out)).toBe(true)
  })

  test('malformed mcp_instructions_delta does not throw', () => {
    const out = normalizeAttachmentForAPI({
      type: 'mcp_instructions_delta',
      addedBlocks: undefined as unknown as string[],
      addedNames: null as unknown as string[],
      removedNames: { a: 1 } as unknown as string[],
    } as never)
    expect(Array.isArray(out)).toBe(true)
  })
})
