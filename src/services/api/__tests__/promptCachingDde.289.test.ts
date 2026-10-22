/**
 * densable 2.1.289 Dde — DISABLE_PROMPT_CACHING_FABLE / _MYTHOS.
 * Gold @189266434: FABLE is Rfe (`claude-fable-`) || nY (env default);
 * MYTHOS is nbt (`claude-mythos-`).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { getPromptCachingEnabled } from '../claude.js'

const KEYS = [
  'DISABLE_PROMPT_CACHING',
  'DISABLE_PROMPT_CACHING_FABLE',
  'DISABLE_PROMPT_CACHING_MYTHOS',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
] as const

afterEach(() => {
  for (const key of KEYS) delete process.env[key]
})

describe('densable 2.1.289 Dde FABLE/MYTHOS', () => {
  test('DISABLE_PROMPT_CACHING_FABLE disables claude-fable- ids', () => {
    process.env.DISABLE_PROMPT_CACHING_FABLE = '1'
    expect(getPromptCachingEnabled('claude-fable-5')).toBe(false)
    expect(getPromptCachingEnabled('claude-opus-4-6')).toBe(true)
  })

  test('DISABLE_PROMPT_CACHING_FABLE disables ANTHROPIC_DEFAULT_FABLE_MODEL', () => {
    process.env.DISABLE_PROMPT_CACHING_FABLE = '1'
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'claude-fable-5-20251101'
    expect(getPromptCachingEnabled('claude-fable-5')).toBe(false)
  })

  test('DISABLE_PROMPT_CACHING_MYTHOS disables claude-mythos- ids', () => {
    process.env.DISABLE_PROMPT_CACHING_MYTHOS = '1'
    expect(getPromptCachingEnabled('claude-mythos-5')).toBe(false)
    expect(getPromptCachingEnabled('claude-opus-4-6')).toBe(true)
  })

  test('source: Dde arms FABLE then MYTHOS after OPUS', async () => {
    const src = await Bun.file(new URL('../claude.ts', import.meta.url)).text()
    const idx = src.indexOf('export function getPromptCachingEnabled')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 1800)
    expect(slice).toContain('DISABLE_PROMPT_CACHING_OPUS')
    expect(slice).toContain('DISABLE_PROMPT_CACHING_FABLE')
    expect(slice).toContain("model.includes('claude-fable-')")
    expect(slice).toContain('ANTHROPIC_DEFAULT_FABLE_MODEL')
    expect(slice).toContain('DISABLE_PROMPT_CACHING_MYTHOS')
    expect(slice).toContain("model.includes('claude-mythos-')")
    expect(slice.indexOf('DISABLE_PROMPT_CACHING_FABLE')).toBeGreaterThan(
      slice.indexOf('DISABLE_PROMPT_CACHING_OPUS'),
    )
    expect(slice.indexOf('DISABLE_PROMPT_CACHING_MYTHOS')).toBeGreaterThan(
      slice.indexOf('DISABLE_PROMPT_CACHING_FABLE'),
    )
  })
})
