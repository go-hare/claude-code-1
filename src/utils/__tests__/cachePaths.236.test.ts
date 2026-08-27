/**
 * densable 2.1.236 #4 — IHn: cache paths fall back to $n() when cwd() throws.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { CACHE_PATHS, getCachePathCwd } from '../cachePaths.js'
import {
  getFsImplementation,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../fsOperations.js'

afterEach(() => {
  setOriginalFsImplementation()
})

describe('densable IHn cache-path cwd (236 #4)', () => {
  test('getCachePathCwd returns live fs cwd when it works', () => {
    expect(getCachePathCwd()).toBe(getFsImplementation().cwd())
  })

  test('getCachePathCwd falls back to getOriginalCwd when cwd() throws', () => {
    const real = getFsImplementation()
    setFsImplementation({
      ...real,
      cwd() {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      },
    })
    expect(getCachePathCwd()).toBe(getOriginalCwd())
  })

  test('CACHE_PATHS.errors/mcpLogs do not throw when cwd() throws', () => {
    const real = getFsImplementation()
    setFsImplementation({
      ...real,
      cwd() {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      },
    })
    expect(() => CACHE_PATHS.errors()).not.toThrow()
    expect(() => CACHE_PATHS.mcpLogs('stdio-server')).not.toThrow()
    expect(CACHE_PATHS.errors()).toContain('errors')
    expect(CACHE_PATHS.mcpLogs('stdio-server')).toContain('mcp-logs-')
  })
})
