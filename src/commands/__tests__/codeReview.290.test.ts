import { describe, expect, test } from 'bun:test'
import {
  codeReviewEffortCell,
  codeReviewModelEffort,
  codeReviewModelFamily,
} from '../codeReview.js'

describe('v2.1.290 codeReview medium effort alignment (#153)', () => {
  test('default family maps medium to o48-high-v1', () => {
    expect(codeReviewModelFamily(undefined)).toBe('default')
    expect(codeReviewEffortCell(undefined, 'medium')).toBe('o48-high-v1')
    expect(codeReviewEffortCell('claude-sonnet-4-6', 'medium')).toBe(
      'o48-high-v1',
    )
  })

  test('claude-opus-5 maps medium and high to o5-bmin', () => {
    expect(codeReviewEffortCell('claude-opus-5', 'medium')).toBe('o5-bmin')
    expect(codeReviewEffortCell('claude-opus-5', 'high')).toBe('o5-bmin')
  })

  test('codeReviewModelEffort elevates claude-sonnet-5 low to medium', () => {
    expect(codeReviewModelEffort('claude-sonnet-5', 'low')).toBe('medium')
    expect(codeReviewModelEffort('claude-sonnet-5', 'medium')).toBe('medium')
    expect(codeReviewModelEffort('claude-opus-4-8', 'low')).toBe('low')
  })
})
