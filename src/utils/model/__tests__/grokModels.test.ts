import { afterEach, describe, expect, test } from 'bun:test'
import {
  getContextWindowForModel,
  isRecognizedModelForWindowEnforcement,
} from '../../context.js'
import {
  GROK_1M_CONTEXT_WINDOW,
  GROK_500K_CONTEXT_WINDOW,
  getGrokModelContextWindow,
} from '../grokModels.js'

const savedDisable1m = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT

afterEach(() => {
  if (savedDisable1m === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  } else {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = savedDisable1m
  }
})

describe('getGrokModelContextWindow', () => {
  test('grok-4.6 is 500k', () => {
    expect(getGrokModelContextWindow('grok-4.6')).toBe(GROK_500K_CONTEXT_WINDOW)
  })

  test('grok-4.5 is 500k', () => {
    expect(getGrokModelContextWindow('grok-4.5')).toBe(GROK_500K_CONTEXT_WINDOW)
  })

  test('grok-4.20 family is 1M', () => {
    expect(getGrokModelContextWindow('grok-4.20')).toBe(GROK_1M_CONTEXT_WINDOW)
    expect(getGrokModelContextWindow('grok-4.20-reasoning')).toBe(
      GROK_1M_CONTEXT_WINDOW,
    )
    expect(getGrokModelContextWindow('grok-4.20-0309-reasoning')).toBe(
      GROK_1M_CONTEXT_WINDOW,
    )
    expect(getGrokModelContextWindow('grok-4.20-multi-agent')).toBe(
      GROK_1M_CONTEXT_WINDOW,
    )
    expect(getGrokModelContextWindow('grok-4.20-multi-agent-0309')).toBe(
      GROK_1M_CONTEXT_WINDOW,
    )
  })

  test('grok-4.3 is 1M', () => {
    expect(getGrokModelContextWindow('grok-4.3')).toBe(GROK_1M_CONTEXT_WINDOW)
  })

  test('provider-prefixed ids use the last path segment', () => {
    expect(getGrokModelContextWindow('x-ai/grok-4.6')).toBe(
      GROK_500K_CONTEXT_WINDOW,
    )
    expect(getGrokModelContextWindow('openrouter/x-ai/grok-4.20')).toBe(
      GROK_1M_CONTEXT_WINDOW,
    )
  })

  test('strips [1m] suffix before lookup', () => {
    expect(getGrokModelContextWindow('grok-4.6[1m]')).toBe(
      GROK_500K_CONTEXT_WINDOW,
    )
  })

  test('version-boundary: grok-4.60 is not grok-4.6', () => {
    expect(getGrokModelContextWindow('grok-4.60')).toBeUndefined()
  })

  test('unlisted grok ids stay undefined (no invented window)', () => {
    expect(getGrokModelContextWindow('grok-3-mini-fast')).toBeUndefined()
    expect(getGrokModelContextWindow('grok-4')).toBeUndefined()
    expect(getGrokModelContextWindow('grok-custom')).toBeUndefined()
  })

  test('non-grok ids are undefined', () => {
    expect(getGrokModelContextWindow('claude-opus-5')).toBeUndefined()
    expect(getGrokModelContextWindow('gpt-5.6-sol')).toBeUndefined()
  })
})

describe('Grok window wiring through getContextWindowForModel', () => {
  test('grok-4.6 is recognized at 500k', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(isRecognizedModelForWindowEnforcement('grok-4.6')).toBe(true)
    expect(getContextWindowForModel('grok-4.6')).toBe(GROK_500K_CONTEXT_WINDOW)
  })

  test('grok-4.20 is recognized at 1M', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(isRecognizedModelForWindowEnforcement('grok-4.20-reasoning')).toBe(
      true,
    )
    expect(getContextWindowForModel('grok-4.20-reasoning')).toBe(
      GROK_1M_CONTEXT_WINDOW,
    )
  })

  test('unlisted grok-3-mini-fast stays unknown 200k', () => {
    expect(isRecognizedModelForWindowEnforcement('grok-3-mini-fast')).toBe(
      false,
    )
    expect(getContextWindowForModel('grok-3-mini-fast')).toBe(200_000)
  })

  test('DISABLE_1M clamps grok-4.6 500k to 200k', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    expect(getContextWindowForModel('grok-4.6')).toBe(200_000)
  })
})
