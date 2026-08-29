import { describe, expect, test } from 'bun:test'
import {
  canonicalizeGoalCondition,
  expandTabs,
  flattenNewlines,
  sliceUtf16Safe,
  truncateGoalConditionForRender,
} from '../canonicalize.js'

describe('ProposeGoal canonicalize (Cen / Y4r / $ci / So / Y4t)', () => {
  test('flattenNewlines maps CR/LF/NEL/LS/PS runs to a single space', () => {
    expect(flattenNewlines('a\r\nb')).toBe('a b')
    expect(flattenNewlines('a\u0085b\u2028c\u2029d')).toBe('a b c d')
    expect(flattenNewlines('a\n\n\nb')).toBe('a b')
  })

  test('expandTabs uses tabstop 8', () => {
    expect(expandTabs('a\tb')).toBe('a       b')
    expect(expandTabs('abcd\tx')).toBe('abcd    x')
    expect(expandTabs('no-tabs')).toBe('no-tabs')
  })

  test('canonicalize strips ZWSP/bidi then expands tabs', () => {
    expect(canonicalizeGoalCondition('\u200Bvisible\u200B')).toBe('visible')
    expect(canonicalizeGoalCondition('a\tb')).toBe('a       b')
    expect(canonicalizeGoalCondition('  keep  spaces  ')).toBe(
      '  keep  spaces  ',
    )
  })

  test('sliceUtf16Safe does not cut a high surrogate', () => {
    const pair = 'a\u{1F600}b'
    expect(sliceUtf16Safe(pair, 2)).toBe('a')
    expect(sliceUtf16Safe('abcdef', 3)).toBe('abc')
  })

  test('truncateGoalConditionForRender appends Y4t suffix past max', () => {
    const input = 'x'.repeat(10)
    expect(truncateGoalConditionForRender(input, 200)).toBe(input)
    expect(truncateGoalConditionForRender(input, 4)).toBe(
      'xxxx … (6 more characters follow that are NOT shown in this message)',
    )
  })
})
