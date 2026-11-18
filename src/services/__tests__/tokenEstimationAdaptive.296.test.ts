import { describe, expect, test } from 'bun:test'
import { getTokenCountThinkingConfig } from '../tokenEstimation.js'

describe('v2.1.296 #498 adaptive thinking token counting', () => {
  test('uses adaptive thinking for claude-haiku-5-5', () => {
    expect(getTokenCountThinkingConfig('claude-haiku-5-5')).toEqual({
      type: 'adaptive',
    })
    expect(getTokenCountThinkingConfig('claude-haiku-5-5-20260501')).toEqual({
      type: 'adaptive',
    })
  })

  test('uses adaptive thinking for claude-opus-4-6 and budget thinking for haiku-4-5', () => {
    expect(getTokenCountThinkingConfig('claude-opus-4-6')).toEqual({
      type: 'adaptive',
    })
    expect(getTokenCountThinkingConfig('claude-haiku-4-5')).toEqual({
      type: 'enabled',
      budget_tokens: 1024,
    })
  })
})
