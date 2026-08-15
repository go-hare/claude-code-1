/**
 * densable 2.1.233 #4 — CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS ($J_ / C9s).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getWebFetchCacheTtlMs,
  resetWebFetchCacheTtlMsForTests,
} from '../utils.js'

describe('getWebFetchCacheTtlMs densable C9s/J_', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS
    resetWebFetchCacheTtlMsForTests()
  })

  afterEach(() => {
    delete process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS
    resetWebFetchCacheTtlMsForTests()
  })

  test('default is densable $J_ = 900000 (15 min)', () => {
    expect(getWebFetchCacheTtlMs()).toBe(900_000)
  })

  test('env override positive number', () => {
    process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS = '60000'
    resetWebFetchCacheTtlMsForTests()
    expect(getWebFetchCacheTtlMs()).toBe(60_000)
  })

  test('invalid env falls back to default', () => {
    process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS = 'nope'
    resetWebFetchCacheTtlMsForTests()
    expect(getWebFetchCacheTtlMs()).toBe(900_000)
  })

  test('memoizes first resolved value', () => {
    expect(getWebFetchCacheTtlMs()).toBe(900_000)
    process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS = '1'
    // still memoized until reset
    expect(getWebFetchCacheTtlMs()).toBe(900_000)
  })
})
