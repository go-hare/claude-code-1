/**
 * densable Llo residual — PostToolUse Edit/Write file resync (behavior only).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import { getFileModificationTime } from 'src/utils/file.js'
import { resyncReadFileStateAfterPostToolUse } from '../postToolUseFileResync.js'

describe('resyncReadFileStateAfterPostToolUse densable Llo', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      dir = undefined
    }
  })

  test('non Edit/Write returns null', () => {
    const cache = createFileStateCacheWithSizeLimit(4)
    expect(
      resyncReadFileStateAfterPostToolUse(
        'Bash',
        'tu1',
        { file_path: '/x' },
        cache,
      ),
    ).toBeNull()
  })

  test('formatter rewrite after Edit re-seeds cache and emits context', () => {
    dir = mkdtempSync(join(tmpdir(), 'llo-resync-'))
    const filePath = join(dir, 'a.ts')
    writeFileSync(filePath, 'const x = 1\n')
    const ts0 = getFileModificationTime(filePath)
    utimesSync(filePath, new Date(ts0), new Date(ts0))
    const ts = getFileModificationTime(filePath)

    const cache = createFileStateCacheWithSizeLimit(4)
    cache.set(filePath, {
      content: 'const x = 1\n',
      timestamp: ts,
      offset: undefined,
      limit: undefined,
    })

    // simulate formatter rewrite with newer mtime
    writeFileSync(filePath, 'const x = 1;\n')
    const later = ts + 2000
    utimesSync(filePath, new Date(later), new Date(later))

    const att = resyncReadFileStateAfterPostToolUse(
      'Edit',
      'toolu_1',
      { file_path: filePath },
      cache,
    )
    expect(att).not.toBeNull()
    expect(att?.type).toBe('hook_additional_context')
    expect(cache.get(filePath)?.content).toBe('const x = 1;\n')
    expect(cache.get(filePath)?.timestamp).toBeGreaterThan(ts)
  })

  test('mtime bump with identical content re-seeds but no attachment', () => {
    dir = mkdtempSync(join(tmpdir(), 'llo-same-'))
    const filePath = join(dir, 'b.ts')
    writeFileSync(filePath, 'same\n')
    const ts0 = getFileModificationTime(filePath)
    utimesSync(filePath, new Date(ts0), new Date(ts0))
    const ts = getFileModificationTime(filePath)

    const cache = createFileStateCacheWithSizeLimit(4)
    cache.set(filePath, {
      content: 'same\n',
      timestamp: ts,
      offset: undefined,
      limit: undefined,
    })

    // touch only
    const later = ts + 2000
    utimesSync(filePath, new Date(later), new Date(later))

    const att = resyncReadFileStateAfterPostToolUse(
      'Write',
      'toolu_2',
      { file_path: filePath },
      cache,
    )
    expect(att).toBeNull()
    expect(cache.get(filePath)?.timestamp).toBeGreaterThan(ts)
    expect(cache.get(filePath)?.content).toBe('same\n')
  })

  test('partial prior read (offset set) is ignored', () => {
    dir = mkdtempSync(join(tmpdir(), 'llo-partial-'))
    const filePath = join(dir, 'c.ts')
    writeFileSync(filePath, 'old\n')
    const ts = getFileModificationTime(filePath)
    const cache = createFileStateCacheWithSizeLimit(4)
    cache.set(filePath, {
      content: 'old\n',
      timestamp: ts,
      offset: 1,
      limit: 10,
    })
    writeFileSync(filePath, 'new\n')
    utimesSync(filePath, new Date(ts + 3000), new Date(ts + 3000))
    expect(
      resyncReadFileStateAfterPostToolUse(
        'Edit',
        't',
        { file_path: filePath },
        cache,
      ),
    ).toBeNull()
  })
})
