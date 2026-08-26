/**
 * densable 2.1.239 leftover — official YHp / eC / KHp.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  formatWebFetchCacheTtl,
  getWebFetchPrompt,
  isLeanWebFetchPrompt,
} from '../prompt.js'

const saved = {
  simple: process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT,
  ttl: process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS,
}

afterEach(() => {
  if (saved.simple === undefined)
    delete process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT
  else process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT = saved.simple
  if (saved.ttl === undefined)
    delete process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS
  else process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS = saved.ttl
})

describe('densable 2.1.239 YHp leftover', () => {
  test('eC is false when model is missing — official QEv !e', () => {
    process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT = '1'
    expect(isLeanWebFetchPrompt(undefined)).toBe(false)
    expect(isLeanWebFetchPrompt('')).toBe(false)
  })

  test('long prompt is the default for dense models', () => {
    delete process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT
    const out = getWebFetchPrompt('claude-sonnet-4-5')
    expect(out.startsWith('IMPORTANT: WebFetch WILL FAIL')).toBe(true)
    expect(out).toContain('entries expire after 15 minutes')
    expect(out).not.toContain('Exception: claude.ai/code/artifact')
  })

  test('lean prompt when SIMPLE_SYSTEM_PROMPT is on and model is present', () => {
    process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT = '1'
    const out = getWebFetchPrompt('claude-mythos-5')
    expect(out.startsWith('Fetches a URL, converts the page to markdown')).toBe(
      true,
    )
    expect(out).toContain('cached for 15 minutes per URL')
  })

  test('artifact exception copy is in both arms', () => {
    delete process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT
    expect(getWebFetchPrompt('claude-sonnet-4-5', true)).toContain(
      'claude.ai/code/artifact/{uuid}',
    )
    process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT = '1'
    expect(getWebFetchPrompt('claude-mythos-5', true)).toContain(
      'ARE fetchable via your claude.ai login',
    )
  })

  test('KHp uses TTL minutes', () => {
    delete process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS
    expect(formatWebFetchCacheTtl()).toBe('15 minutes')
    process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS = '60000'
    expect(formatWebFetchCacheTtl()).toBe('1 minute')
  })
})
