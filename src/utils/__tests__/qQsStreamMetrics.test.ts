import { describe, expect, test } from 'bun:test'
import {
  estimateThinkingTokensFromText,
  extractMessageDeltaOutputTokens,
  thinkingSignatureMetricChars,
} from '../messages.js'

describe('densable qQs metrics helpers', () => {
  test('Ula estimateThinkingTokensFromText', () => {
    expect(estimateThinkingTokensFromText('abcd')).toBe(1)
    expect(estimateThinkingTokensFromText('abcde')).toBe(2)
    expect(estimateThinkingTokensFromText('')).toBe(0)
  })

  test('gmn thinkingSignatureMetricChars', () => {
    expect(thinkingSignatureMetricChars(100)).toBe(75)
    expect(thinkingSignatureMetricChars(1)).toBe(1)
  })

  test('ATb extractMessageDeltaOutputTokens', () => {
    expect(
      extractMessageDeltaOutputTokens({ usage: { output_tokens: 42 } }),
    ).toBe(42)
    expect(extractMessageDeltaOutputTokens({ usage: {} })).toBeNull()
    expect(extractMessageDeltaOutputTokens(null)).toBeNull()
  })
})
