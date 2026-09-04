import { afterEach, describe, expect, test } from 'bun:test'

import {
  isMainPromptCacheQuerySource,
  querySourceMatchesAllowlist,
  resolvePromptCacheTtlOverride,
} from '../promptCacheTtl.js'

const ENV_KEYS = [
  'FORCE_PROMPT_CACHING_5M',
  'CLAUDE_CODE_PROMPT_CACHE_TTL',
  'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL',
  'ENABLE_PROMPT_CACHING_1H',
  'ENABLE_PROMPT_CACHING_1H_BEDROCK',
] as const

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
})

describe('promptCacheTtl 243 sFr', () => {
  test('_zt treats repl_main_thread and sdk as main', () => {
    expect(isMainPromptCacheQuerySource('repl_main_thread')).toBe(true)
    expect(isMainPromptCacheQuerySource('repl_main_thread:compact')).toBe(true)
    expect(isMainPromptCacheQuerySource('sdk')).toBe(true)
    expect(isMainPromptCacheQuerySource('auto_mode')).toBe(true)
    expect(isMainPromptCacheQuerySource('agent:explore')).toBe(false)
  })

  test('FORCE_PROMPT_CACHING_5M wins', () => {
    process.env.FORCE_PROMPT_CACHING_5M = '1'
    process.env.CLAUDE_CODE_PROMPT_CACHE_TTL = '1h'
    expect(resolvePromptCacheTtlOverride('repl_main_thread')).toEqual({
      ttl: '5m',
      reason: 'force_5m_env',
    })
  })

  test('main env TTL beats settings-less default', () => {
    process.env.CLAUDE_CODE_PROMPT_CACHE_TTL = '1h'
    expect(resolvePromptCacheTtlOverride('repl_main_thread')).toEqual({
      ttl: '1h',
      reason: 'env',
    })
    expect(resolvePromptCacheTtlOverride('agent:explore')).toBeUndefined()
  })

  test('subagent env TTL only applies off the main allowlist', () => {
    process.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL = '5m'
    expect(resolvePromptCacheTtlOverride('agent:explore')).toEqual({
      ttl: '5m',
      reason: 'env',
    })
    expect(resolvePromptCacheTtlOverride('sdk')).toBeUndefined()
  })

  test('ENABLE_PROMPT_CACHING_1H is the last override', () => {
    process.env.ENABLE_PROMPT_CACHING_1H = '1'
    expect(resolvePromptCacheTtlOverride('agent:explore')).toEqual({
      ttl: '1h',
      reason: 'enable_1h_env',
    })
  })

  test('allowlist prefix star matches official bzt', () => {
    expect(
      querySourceMatchesAllowlist('repl_main_thread:foo', [
        'repl_main_thread*',
      ]),
    ).toBe(true)
    expect(querySourceMatchesAllowlist('sdk', ['repl_main_thread*'])).toBe(
      false,
    )
  })
})
