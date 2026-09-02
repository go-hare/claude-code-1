import { afterEach, describe, expect, test } from 'bun:test'
import {
  getContextWindowForModel,
  isRecognizedModelForWindowEnforcement,
} from '../../context.js'
import {
  DEEPSEEK_V4_CONTEXT_WINDOW,
  getDeepSeekModelContextWindow,
} from '../deepseekModels.js'

const savedDisable1m = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT

afterEach(() => {
  if (savedDisable1m === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  } else {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = savedDisable1m
  }
})

describe('getDeepSeekModelContextWindow', () => {
  test('deepseek-v4 family is 1M', () => {
    expect(getDeepSeekModelContextWindow('deepseek-v4')).toBe(
      DEEPSEEK_V4_CONTEXT_WINDOW,
    )
    expect(getDeepSeekModelContextWindow('deepseek-v4-pro')).toBe(
      DEEPSEEK_V4_CONTEXT_WINDOW,
    )
    expect(getDeepSeekModelContextWindow('deepseek-v4-flash')).toBe(
      DEEPSEEK_V4_CONTEXT_WINDOW,
    )
    expect(getDeepSeekModelContextWindow('deepseek-v4-flash-vision-exp')).toBe(
      DEEPSEEK_V4_CONTEXT_WINDOW,
    )
  })

  test('provider-prefixed ids use the last path segment', () => {
    expect(getDeepSeekModelContextWindow('deepseek/deepseek-v4-pro')).toBe(
      DEEPSEEK_V4_CONTEXT_WINDOW,
    )
  })

  test('version-boundary: deepseek-v40 is not deepseek-v4', () => {
    expect(getDeepSeekModelContextWindow('deepseek-v40')).toBeUndefined()
  })

  test('unlisted deepseek ids stay undefined (no invented window)', () => {
    expect(getDeepSeekModelContextWindow('deepseek-chat')).toBeUndefined()
    expect(getDeepSeekModelContextWindow('deepseek-reasoner')).toBeUndefined()
  })

  test('non-deepseek ids are undefined', () => {
    expect(getDeepSeekModelContextWindow('kimi-k3')).toBeUndefined()
    expect(getDeepSeekModelContextWindow('gpt-5.6-sol')).toBeUndefined()
  })
})

describe('DeepSeek window wiring through getContextWindowForModel', () => {
  test('deepseek-v4-pro is recognized at 1M', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(isRecognizedModelForWindowEnforcement('deepseek-v4-pro')).toBe(true)
    expect(getContextWindowForModel('deepseek-v4-pro')).toBe(
      DEEPSEEK_V4_CONTEXT_WINDOW,
    )
  })

  test('deepseek-v4-flash-vision-exp is recognized at 1M', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(
      isRecognizedModelForWindowEnforcement('deepseek-v4-flash-vision-exp'),
    ).toBe(true)
    expect(getContextWindowForModel('deepseek-v4-flash-vision-exp')).toBe(
      DEEPSEEK_V4_CONTEXT_WINDOW,
    )
  })

  test('unlisted deepseek-chat stays unknown 200k', () => {
    expect(isRecognizedModelForWindowEnforcement('deepseek-chat')).toBe(false)
    expect(getContextWindowForModel('deepseek-chat')).toBe(200_000)
  })

  test('DISABLE_1M clamps deepseek-v4-flash 1M to 200k', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    expect(getContextWindowForModel('deepseek-v4-flash')).toBe(200_000)
  })
})
