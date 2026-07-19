import { describe, expect, test } from 'bun:test'
import {
  FILE_STATE_KEEP_CONTENT_MAX_BYTES,
  FileStateCache,
  cloneFileStateCache,
  createFileStateCacheWithSizeLimit,
  fileStateContentMatches,
  hashFileStateContent,
} from '../fileStateCache.js'
import type { FileState } from '../fileStateCache.js'

function makeEntry(content: string, extra?: Partial<FileState>): FileState {
  return {
    content,
    timestamp: Date.now(),
    offset: undefined,
    limit: undefined,
    ...extra,
  }
}

/**
 * Mirrors coerceToolContentToString from queryHelpers.ts — not exported,
 * so we replicate it here to test the pattern.
 */
function coerceToolContentToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

describe('FileStateCache LRU eviction', () => {
  test('evicts oldest entries when max entries exceeded', () => {
    const cache = new FileStateCache(3, 1024 * 1024)
    cache.set('a', makeEntry('content-a'))
    cache.set('b', makeEntry('content-b'))
    cache.set('c', makeEntry('content-c'))
    cache.set('d', makeEntry('content-d')) // should evict 'a'

    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
    expect(cache.size).toBe(3)
  })

  test('evicts entries when maxSizeBytes exceeded', () => {
    // Small size limit: 100 bytes
    const cache = new FileStateCache(100, 100)
    cache.set('a', makeEntry('x'.repeat(50))) // ~50 bytes
    cache.set('b', makeEntry('y'.repeat(50))) // ~50 bytes
    cache.set('c', makeEntry('z'.repeat(50))) // ~50 bytes, should evict 'a'

    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
    expect(cache.has('c')).toBe(true)
    expect(cache.calculatedSize).toBeLessThanOrEqual(100)
  })

  test('sizeCalculation handles string content', () => {
    const cache = new FileStateCache(100, 1000)
    cache.set('a', makeEntry('hello'))
    expect(cache.calculatedSize).toBeGreaterThan(0)
  })

  test('sizeCalculation handles object content via JSON.stringify', () => {
    const cache = new FileStateCache(100, 10000)
    const obj = { nested: { deep: 'value' } }
    cache.set('a', makeEntry(JSON.stringify(obj)))
    const size = cache.calculatedSize
    expect(size).toBeGreaterThan(0)
    // The JSON string should match the object's serialized length
    expect(size).toBe(Buffer.byteLength(JSON.stringify(obj), 'utf8'))
  })

  test('sizeCalculation handles null/undefined content', () => {
    const cache = new FileStateCache(100, 10000)
    cache.set('a', {
      content: null as unknown as string,
      timestamp: 0,
      offset: undefined,
      limit: undefined,
    })
    expect(cache.calculatedSize).toBe(1) // Math.max(1, 0) = 1
  })

  test('clear removes all entries', () => {
    const cache = new FileStateCache(100, 10000)
    cache.set('a', makeEntry('a'))
    cache.set('b', makeEntry('b'))
    cache.clear()
    expect(cache.size).toBe(0)
  })

  test('delete removes specific entry', () => {
    const cache = new FileStateCache(100, 10000)
    cache.set('a', makeEntry('a'))
    cache.set('b', makeEntry('b'))
    expect(cache.delete('a')).toBe(true)
    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
  })

  test('normalizes path keys', () => {
    const cache = new FileStateCache(100, 10000)
    cache.set('/foo/../bar/baz.txt', makeEntry('content'))
    expect(cache.get('/bar/baz.txt')).toBeDefined()
    expect(cache.has('/bar/baz.txt')).toBe(true)
  })
})

describe('createFileStateCacheWithSizeLimit', () => {
  test('creates cache with default 25MB size limit', () => {
    const cache = createFileStateCacheWithSizeLimit(100)
    expect(cache.max).toBe(100)
    expect(cache.maxSize).toBe(25 * 1024 * 1024)
  })

  test('creates cache with custom size limit', () => {
    const cache = createFileStateCacheWithSizeLimit(50, 1024)
    expect(cache.max).toBe(50)
    expect(cache.maxSize).toBe(1024)
  })
})

describe('FileStateCache densable keepContent / contentHash / ALe', () => {
  test('set auto-hashes and keeps small bodies', () => {
    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set('/small.ts', makeEntry('hello'))
    const e = cache.get('/small.ts')
    expect(e?.content).toBe('hello')
    expect(e?.contentHash).toBe(hashFileStateContent('hello'))
    expect(e?.contentLength).toBe(5)
  })

  test('large non-keep strips body but retains hash', () => {
    const cache = createFileStateCacheWithSizeLimit(10, 50 * 1024 * 1024)
    const big = 'x'.repeat(FILE_STATE_KEEP_CONTENT_MAX_BYTES + 100)
    cache.set('/big.ts', makeEntry(big))
    const e = cache.get('/big.ts')
    expect(e?.content).toBe('')
    expect(e?.contentHash).toBe(hashFileStateContent(big))
    expect(e?.contentLength).toBe(big.length)
    expect(fileStateContentMatches(e!, big)).toBe(true)
    expect(fileStateContentMatches(e!, big + 'y')).toBe(false)
  })

  test('keepContent retains large body', () => {
    const cache = createFileStateCacheWithSizeLimit(10, 50 * 1024 * 1024)
    const big = 'y'.repeat(FILE_STATE_KEEP_CONTENT_MAX_BYTES + 50)
    cache.set('/seed.md', makeEntry(big, { keepContent: true }))
    expect(cache.get('/seed.md')?.content).toBe(big)
    expect(cache.get('/seed.md')?.keepContent).toBe(true)
  })

  test('keepContent sticky + empty content restores prior body', () => {
    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set('/a.ts', makeEntry('body', { keepContent: true }))
    const hash = cache.get('/a.ts')!.contentHash!
    cache.set('/a.ts', {
      content: '',
      timestamp: Date.now(),
      offset: undefined,
      limit: undefined,
      contentHash: hash,
    })
    expect(cache.get('/a.ts')?.content).toBe('body')
    expect(cache.get('/a.ts')?.keepContent).toBe(true)
  })
})

describe('cloneFileStateCache densable qwe stripSeededFromContext', () => {
  test('clone without options preserves seededFromContext', () => {
    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set('/seeded.md', makeEntry('body', { seededFromContext: true }))
    const cloned = cloneFileStateCache(cache)
    expect(cloned.get('/seeded.md')?.seededFromContext).toBe(true)
  })

  test('stripSeededFromContext clears seed flag on clone only', () => {
    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set(
      '/seeded.md',
      makeEntry('body', { seededFromContext: true, isPartialView: false }),
    )
    cache.set('/normal.md', makeEntry('other', { seededFromContext: false }))
    const cloned = cloneFileStateCache(cache, { stripSeededFromContext: true })
    expect(cloned.get('/seeded.md')?.seededFromContext).toBe(false)
    expect(cloned.get('/seeded.md')?.content).toBe('body')
    expect(cloned.get('/normal.md')?.seededFromContext).toBe(false)
    // parent cache must keep seed flag (dump mutation must not rewrite parent value)
    expect(cache.get('/seeded.md')?.seededFromContext).toBe(true)
  })

  test('seed producers + FileRead + $io source anchors', () => {
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const attachments = readFileSync(
      join(import.meta.dir, '../attachments.ts'),
      'utf8',
    )
    expect(attachments).toContain('seededFromContext: true')
    expect(attachments).toContain('getFileModificationTime(memoryFile.path)')
    expect(attachments).toContain('keepContent: true')
    expect(attachments).toContain('fileStateContentMatches')
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).toContain('seededFromContext: true')
    expect(repl).toContain('keepContent: true')
    const fileRead = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/FileReadTool/FileReadTool.ts',
      ),
      'utf8',
    )
    expect(fileRead).toContain('existingState.seededFromContext')
    expect(fileRead).toContain("source: 'seeded'")
    const forked = readFileSync(
      join(import.meta.dir, '../forkedAgent.ts'),
      'utf8',
    )
    expect(forked).toContain('stripSeededFromContext: true')
    const runAgent = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/AgentTool/runAgent.ts',
      ),
      'utf8',
    )
    expect(runAgent).toContain('stripSeededFromContext: true')
    const runner = readFileSync(
      join(import.meta.dir, '../swarm/inProcessRunner.ts'),
      'utf8',
    )
    expect(runner).toContain('stripSeededFromContext: true')
    const edit = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/FileEditTool/FileEditTool.ts',
      ),
      'utf8',
    )
    expect(edit).toContain('fileStateContentMatches')
    const write = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.ts',
      ),
      'utf8',
    )
    expect(write).toContain('fileStateContentMatches')
  })
})

describe('coerceToolContentToString', () => {
  test('returns string as-is', () => {
    expect(coerceToolContentToString('hello')).toBe('hello')
  })

  test('returns empty string for null', () => {
    expect(coerceToolContentToString(null)).toBe('')
  })

  test('returns empty string for undefined', () => {
    expect(coerceToolContentToString(undefined)).toBe('')
  })

  test('stringifies objects', () => {
    expect(coerceToolContentToString({ key: 'value' })).toBe('{"key":"value"}')
  })

  test('converts numbers to string', () => {
    expect(coerceToolContentToString(42)).toBe('42')
  })

  test('stringifies nested objects', () => {
    const nested = { a: { b: [1, 2, 3] } }
    expect(coerceToolContentToString(nested)).toBe('{"a":{"b":[1,2,3]}}')
  })
})
