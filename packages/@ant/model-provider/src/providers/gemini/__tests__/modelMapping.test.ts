import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resolveGeminiModel } from '../modelMapping.js'

describe('resolveGeminiModel', () => {
  const envKeys = [
    'GEMINI_MODEL',
    'GEMINI_MODEL_MAP',
    'GEMINI_DEFAULT_HAIKU_MODEL',
    'GEMINI_DEFAULT_SONNET_MODEL',
    'GEMINI_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
  ] as const

  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
  })

  test('GEMINI_MODEL env var overrides family mappings', () => {
    process.env.GEMINI_MODEL = 'gemini-2.5-pro'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'gemini-2.5-flash'

    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('gemini-2.5-pro')
  })

  test('GEMINI_DEFAULT_*_MODEL takes precedence over ANTHROPIC_DEFAULT_*', () => {
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-2.5-flash-priority'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'gemini-2.5-flash-fallback'

    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe(
      'gemini-2.5-flash-priority',
    )
  })

  test('resolves sonnet model from GEMINI_DEFAULT_SONNET_MODEL', () => {
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-2.5-flash'
    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('gemini-2.5-flash')
  })

  test('resolves haiku model from GEMINI_DEFAULT_HAIKU_MODEL', () => {
    process.env.GEMINI_DEFAULT_HAIKU_MODEL = 'gemini-2.5-flash-lite'
    expect(resolveGeminiModel('claude-haiku-4-5-20251001')).toBe(
      'gemini-2.5-flash-lite',
    )
  })

  test('resolves opus model from GEMINI_DEFAULT_OPUS_MODEL', () => {
    process.env.GEMINI_DEFAULT_OPUS_MODEL = 'gemini-2.5-pro'
    expect(resolveGeminiModel('claude-opus-4-6')).toBe('gemini-2.5-pro')
  })

  test('falls back to ANTHROPIC_DEFAULT_* when GEMINI_DEFAULT_* not set', () => {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'gemini-2.5-flash'
    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('gemini-2.5-flash')
  })

  test('resolves haiku from ANTHROPIC_DEFAULT_HAIKU_MODEL as fallback', () => {
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'gemini-2.5-flash-lite'
    expect(resolveGeminiModel('claude-haiku-4-5-20251001')).toBe(
      'gemini-2.5-flash-lite',
    )
  })

  test('resolves opus from ANTHROPIC_DEFAULT_OPUS_MODEL as fallback', () => {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'gemini-2.5-pro'
    expect(resolveGeminiModel('claude-opus-4-6')).toBe('gemini-2.5-pro')
  })

  test('uses backward compatible family override', () => {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'legacy-gemini-sonnet'
    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('legacy-gemini-sonnet')
  })

  test('strips [1m] suffix before resolving', () => {
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-2.5-flash'
    expect(resolveGeminiModel('claude-sonnet-4-6[1m]')).toBe('gemini-2.5-flash')
  })

  test('passes through explicit Gemini model names even when GEMINI_MODEL is set', () => {
    process.env.GEMINI_MODEL = 'gemini-2.5-pro'

    expect(resolveGeminiModel('gemini-4-argon')).toBe('gemini-4-argon')
    expect(resolveGeminiModel('gemini-3.8-flash')).toBe('gemini-3.8-flash')
    expect(resolveGeminiModel('gemini-3.1-flash-lite-preview')).toBe(
      'gemini-3.1-flash-lite-preview',
    )
  })

  test('maps claude-fable-5-1 and fable to opus family', () => {
    expect(resolveGeminiModel('claude-fable-5-1')).toBe('gemini-4-argon')
    expect(resolveGeminiModel('fable')).toBe('gemini-4-argon')

    process.env.GEMINI_DEFAULT_OPUS_MODEL = 'gemini-2.5-pro'
    expect(resolveGeminiModel('claude-fable-5-1')).toBe('gemini-2.5-pro')
  })

  test('GEMINI_MODEL_MAP exact key overrides GEMINI_MODEL and family defaults', () => {
    process.env.GEMINI_MODEL = 'gemini-2.5-pro'
    process.env.GEMINI_MODEL_MAP = JSON.stringify({
      'claude-sonnet-4-6': 'gemini-exact-sonnet',
      'gemini-3.8-flash': 'gemini-3.8-flash-pinned',
    })

    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('gemini-exact-sonnet')
    expect(resolveGeminiModel('claude-sonnet-4-6[1m]')).toBe(
      'gemini-exact-sonnet',
    )
    expect(resolveGeminiModel('gemini-3.8-flash')).toBe(
      'gemini-3.8-flash-pinned',
    )
    expect(resolveGeminiModel('claude-opus-4-7')).toBe('gemini-2.5-pro')
  })

  test('GEMINI_MODEL_MAP family key resolves when GEMINI_MODEL is not set', () => {
    process.env.GEMINI_MODEL_MAP = JSON.stringify({
      sonnet: 'gemini-map-sonnet',
      opus: 'gemini-map-opus',
    })
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-env-sonnet'

    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('gemini-map-sonnet')
    expect(resolveGeminiModel('claude-fable-5-1')).toBe('gemini-map-opus')
  })

  test('falls back to default family map when nothing is configured', () => {
    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('gemini-3.8-flash')
    expect(resolveGeminiModel('claude-opus-4-7')).toBe('gemini-4-argon')
    expect(resolveGeminiModel('claude-haiku-4-5-20251001')).toBe(
      'gemini-3.8-flash',
    )
  })
})
