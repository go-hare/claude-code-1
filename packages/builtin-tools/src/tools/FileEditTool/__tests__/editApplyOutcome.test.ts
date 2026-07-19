/**
 * densable EKi / Fyu residual helpers for Edit validateInput analytics.
 */
import { describe, expect, test } from 'bun:test'
import {
  classifyEditApplyOutcome,
  editWouldHaveResultForAnalytics,
} from '../utils'

describe('classifyEditApplyOutcome densable EKi', () => {
  test('empty old_string → no_match', () => {
    expect(classifyEditApplyOutcome('abc', '', false)).toBe('no_match')
  })

  test('missing string → no_match', () => {
    expect(classifyEditApplyOutcome('hello world', 'zzz', false)).toBe(
      'no_match',
    )
  })

  test('unique match → applies', () => {
    expect(classifyEditApplyOutcome('hello world', 'world', false)).toBe(
      'applies',
    )
  })

  test('duplicate match without replace_all → ambiguous', () => {
    expect(classifyEditApplyOutcome('aa aa aa', 'aa', false)).toBe('ambiguous')
  })

  test('duplicate match with replace_all → applies', () => {
    expect(classifyEditApplyOutcome('aa aa aa', 'aa', true)).toBe('applies')
  })
})

describe('editWouldHaveResultForAnalytics densable Fyu', () => {
  test('maps densable codes', () => {
    expect(editWouldHaveResultForAnalytics('no_match')).toBe('errorCode8')
    expect(editWouldHaveResultForAnalytics('ambiguous')).toBe('errorCode9')
    expect(editWouldHaveResultForAnalytics('applies')).toBe('success')
  })
})
