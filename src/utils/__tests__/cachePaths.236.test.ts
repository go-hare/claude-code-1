/**
 * densable 2.1.236 #4 — IHn: cache paths fall back to $n() when cwd() throws.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { CACHE_PATHS, getCachePathCwd, tryProcessCwd } from '../cachePaths.js'
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

  test('tryProcessCwd returns live process.cwd when it works', () => {
    expect(tryProcessCwd()).toBe(process.cwd())
  })

  test('clipboard/bg spawn sites use tryProcessCwd not bare process.cwd', () => {
    const files = [
      join(import.meta.dir, '../execFileNoThrow.ts'),
      join(import.meta.dir, '../../cli/bg.ts'),
      join(import.meta.dir, '../../daemon/xSeSpawn.ts'),
      join(import.meta.dir, '../../daemon/daemonLock.ts'),
      join(import.meta.dir, '../../daemon/main.ts'),
      join(import.meta.dir, '../../daemon/ptyHost.ts'),
      join(import.meta.dir, '../bgCheckpoint.ts'),
    ]
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      expect(src).toContain('tryProcessCwd')
    }
  })
})
