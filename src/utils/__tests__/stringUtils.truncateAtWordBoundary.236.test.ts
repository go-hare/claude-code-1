import { describe, expect, test } from 'bun:test'
import { truncateAtWordBoundary } from '../stringUtils.js'

describe('truncateAtWordBoundary (densable edu / Hbm)', () => {
  test('returns unchanged when under max', () => {
    expect(truncateAtWordBoundary('hello world', 40)).toBe('hello world')
  })

  test('caps at word boundary with ellipsis', () => {
    const text =
      'The user is building a feature and next should verify the tests carefully now'
    const capped = truncateAtWordBoundary(text, 40)
    expect(capped.endsWith('…')).toBe(true)
    expect(capped.length).toBeLessThanOrEqual(40)
    expect(capped.includes(' ')).toBe(true)
  })
})
