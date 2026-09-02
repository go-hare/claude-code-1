import { afterEach, describe, expect, test } from 'bun:test'
import {
  getContextWindowForModel,
  isRecognizedModelForWindowEnforcement,
} from '../../context.js'
import {
  KIMI_K27_CONTEXT_WINDOW,
  KIMI_K3_CONTEXT_WINDOW,
  getKimiModelContextWindow,
} from '../kimiModels.js'

const savedDisable1m = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT

afterEach(() => {
  if (savedDisable1m === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  } else {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = savedDisable1m
  }
})

describe('getKimiModelContextWindow', () => {
  test('kimi-k3 is 1M', () => {
    expect(getKimiModelContextWindow('kimi-k3')).toBe(KIMI_K3_CONTEXT_WINDOW)
  })

  test('kimi-k2.7 family is 262144', () => {
    expect(getKimiModelContextWindow('kimi-k2.7')).toBe(KIMI_K27_CONTEXT_WINDOW)
    expect(getKimiModelContextWindow('kimi-k2.7-code')).toBe(
      KIMI_K27_CONTEXT_WINDOW,
    )
    expect(getKimiModelContextWindow('kimi-k2.7-code-highspeed')).toBe(
      KIMI_K27_CONTEXT_WINDOW,
    )
  })

  test('provider-prefixed ids use the last path segment', () => {
    expect(getKimiModelContextWindow('moonshot/kimi-k3')).toBe(
      KIMI_K3_CONTEXT_WINDOW,
    )
  })

  test('strips [1m] suffix before lookup', () => {
    expect(getKimiModelContextWindow('kimi-k3[1m]')).toBe(
      KIMI_K3_CONTEXT_WINDOW,
    )
  })

  test('kimi-k3-256k is not the 1M flagship window', () => {
    expect(getKimiModelContextWindow('kimi-k3-256k')).toBeUndefined()
  })

  test('unlisted kimi ids stay undefined (no invented window)', () => {
    expect(getKimiModelContextWindow('kimi-k2.6')).toBeUndefined()
    expect(getKimiModelContextWindow('kimi-k2.5')).toBeUndefined()
    expect(getKimiModelContextWindow('kimi-custom')).toBeUndefined()
  })

  test('non-kimi ids are undefined', () => {
    expect(getKimiModelContextWindow('grok-4.6')).toBeUndefined()
    expect(getKimiModelContextWindow('deepseek-v4-pro')).toBeUndefined()
  })
})

describe('Kimi window wiring through getContextWindowForModel', () => {
  test('kimi-k3 is recognized at 1M', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(isRecognizedModelForWindowEnforcement('kimi-k3')).toBe(true)
    expect(getContextWindowForModel('kimi-k3')).toBe(KIMI_K3_CONTEXT_WINDOW)
  })

  test('kimi-k2.7-code is recognized at 262144', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(isRecognizedModelForWindowEnforcement('kimi-k2.7-code')).toBe(true)
    expect(getContextWindowForModel('kimi-k2.7-code')).toBe(
      KIMI_K27_CONTEXT_WINDOW,
    )
  })

  test('unlisted kimi-k2.6 stays unknown 200k', () => {
    expect(isRecognizedModelForWindowEnforcement('kimi-k2.6')).toBe(false)
    expect(getContextWindowForModel('kimi-k2.6')).toBe(200_000)
  })

  test('DISABLE_1M clamps kimi-k3 1M to 200k', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    expect(getContextWindowForModel('kimi-k3')).toBe(200_000)
  })
})
