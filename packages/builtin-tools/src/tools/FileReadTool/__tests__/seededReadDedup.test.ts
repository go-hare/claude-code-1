/**
 * densable FileRead seededFromContext full-file dedup residual (behavior only).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import { getFileModificationTime } from 'src/utils/file.js'

// Isolate growthbook killswitch + analytics for this file
mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => false,
}))
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))
mock.module('src/services/analytics/metadata.js', () => ({
  getFileExtensionForAnalytics: () => 'md',
}))

const { FileReadTool } = await import('../FileReadTool.js')

describe('FileRead densable seededFromContext dedup', () => {
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

  test('full re-read of non-partial seed returns file_unchanged source=seeded', async () => {
    dir = mkdtempSync(join(tmpdir(), 'seeded-read-'))
    const filePath = join(dir, 'CLAUDE.md')
    writeFileSync(filePath, '# project\n')
    const mtime = getFileModificationTime(filePath)
    // stabilize mtime floor for race-free assert
    utimesSync(filePath, new Date(mtime), new Date(mtime))
    const ts = getFileModificationTime(filePath)

    const readFileState = createFileStateCacheWithSizeLimit(10)
    readFileState.set(filePath, {
      content: '# project\n',
      timestamp: ts,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
      seededFromContext: true,
    })

    const result = await FileReadTool.call(
      { file_path: filePath },
      {
        readFileState,
        fileReadingLimits: undefined,
        abortController: new AbortController(),
        nestedMemoryAttachmentTriggers: new Set(),
      } as never,
    )

    expect(result.data).toEqual({
      type: 'file_unchanged',
      file: { filePath },
      source: 'seeded',
    })
  })

  test('partial seed does not short-circuit full read', async () => {
    dir = mkdtempSync(join(tmpdir(), 'seeded-read-partial-'))
    const filePath = join(dir, 'CLAUDE.md')
    writeFileSync(filePath, '# project\nline2\n')
    const ts = getFileModificationTime(filePath)

    const readFileState = createFileStateCacheWithSizeLimit(10)
    readFileState.set(filePath, {
      content: '# project\nline2\n',
      timestamp: ts,
      offset: undefined,
      limit: undefined,
      isPartialView: true,
      seededFromContext: true,
    })

    const result = await FileReadTool.call(
      { file_path: filePath },
      {
        readFileState,
        fileReadingLimits: undefined,
        abortController: new AbortController(),
        nestedMemoryAttachmentTriggers: new Set(),
      } as never,
    )

    expect(result.data.type).toBe('text')
  })
})
