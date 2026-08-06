/**
 * densable 2.1.212 #30 — Eio at-mention already_read only when HOe full-enough.
 * Partial / isPartialView / offset>1 cache must re-read (not empty attachment).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFileStateCacheWithSizeLimit } from '../fileStateCache.js'
import { generateFileAttachment } from '../attachments.js'
import type { ToolUseContext } from '../../Tool.js'

function makeCtx(
  cache: ReturnType<typeof createFileStateCacheWithSizeLimit>,
): ToolUseContext {
  return {
    readFileState: cache,
    getAppState: () =>
      ({
        toolPermissionContext: {
          mode: 'default',
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: false,
        },
      }) as ReturnType<ToolUseContext['getAppState']>,
    abortController: new AbortController(),
    options: {
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      commands: [],
      debug: false,
      verbose: false,
      slowAndCapableModel: 'claude-sonnet-4-6',
    },
  } as unknown as ToolUseContext
}

describe('densable #30 Eio generateFileAttachment at-mention', () => {
  let dir: string

  afterEach(() => {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  test('partial isPartialView cache does not short-circuit to already_read', async () => {
    dir = mkdtempSync(join(tmpdir(), 'eio-partial-'))
    const file = join(dir, 'partial.txt')
    const body = 'line1\nline2\nline3\nline4\nline5\n'
    writeFileSync(file, body)

    const { getFileModificationTimeAsync } = await import('../file.js')
    const mtime = await getFileModificationTimeAsync(file)

    const cache = createFileStateCacheWithSizeLimit(10)
    // Prior limited / token-cap partial view
    cache.set(file, {
      content: 'line1\nline2',
      timestamp: mtime,
      offset: 1,
      limit: 2,
      isPartialView: true,
    })

    const att = await generateFileAttachment(
      file,
      makeCtx(cache),
      'tengu_test_ok',
      'tengu_test_err',
      'at-mention',
    )
    // densable: HOe false → re-read → type file with full content, not empty already_read
    expect(att).not.toBeNull()
    expect(att!.type).toBe('file')
    if (att!.type === 'file' && att!.content.type === 'text') {
      expect(att!.content.file.content).toContain('line5')
    }
  })

  test('full-enough cache with matching mtime returns already_read_file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'eio-full-'))
    const file = join(dir, 'full.txt')
    const body = 'alpha\nbeta\ngamma\n'
    writeFileSync(file, body)

    const { getFileModificationTimeAsync } = await import('../file.js')
    const mtime = await getFileModificationTimeAsync(file)

    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set(file, {
      content: body,
      timestamp: mtime,
      offset: 1,
      limit: undefined,
    })

    const att = await generateFileAttachment(
      file,
      makeCtx(cache),
      'tengu_test_ok',
      'tengu_test_err',
      'at-mention',
    )
    expect(att).not.toBeNull()
    expect(att!.type).toBe('already_read_file')
    if (att!.type === 'already_read_file' && att!.content.type === 'text') {
      expect(att!.content.file.content).toBe(body)
    }
  })

  test('offset>1 cache is not full enough → re-read', async () => {
    dir = mkdtempSync(join(tmpdir(), 'eio-offset-'))
    const file = join(dir, 'off.txt')
    const body = 'a\nb\nc\nd\n'
    writeFileSync(file, body)

    const { getFileModificationTimeAsync } = await import('../file.js')
    const mtime = await getFileModificationTimeAsync(file)

    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set(file, {
      content: 'c\nd',
      timestamp: mtime,
      offset: 3,
      limit: 10,
    })

    const att = await generateFileAttachment(
      file,
      makeCtx(cache),
      'tengu_test_ok',
      'tengu_test_err',
      'at-mention',
    )
    expect(att).not.toBeNull()
    expect(att!.type).toBe('file')
  })
})
