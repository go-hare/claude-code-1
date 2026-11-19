import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DISK_FULL_ROLLBACK_CODES,
  writeFileSyncAndFlush_DEPRECATED,
} from '../../../../../../src/utils/file.js'
import {
  resolveRealParentDir,
  safeUnlinkTrackedFile,
  verifyParentDirectoryIdentity,
} from '../../../../../../src/utils/fileHistory.js'
import {
  decoupleSlicedString,
  readFileInRange,
} from '../../../../../../src/utils/readFileInRange.js'
import {
  clearTimedOutRenameTargetsForTesting,
  hasTimedOutRenameTarget,
  RENAME_EXTENDED_RETRY_DELAYS_MS,
  RENAME_LONG_RETRY_DELAYS_MS,
  renameSyncWithAdaptiveRetry,
  renameWithAdaptiveRetry,
  renameWithLongRetry,
} from '../../../../../../src/utils/renameRetry.js'
import { FileStateCache } from '../../../../../../src/utils/fileStateCache.js'
import type { ToolUseContext } from '../../../../../../src/Tool.js'
import { FileEditTool } from '../FileEditTool.js'
import {
  checkUnchangedImageRereadLimit,
  noteImageMediaStripped,
  resetImageRereadState,
  UNCHANGED_IMAGE_REREAD_LIMIT,
  UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE,
  UNCHANGED_IMAGE_REREAD_REFUSAL_REASON,
} from '../../FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../../FileWriteTool/FileWriteTool.js'
import {
  NotebookEditExecutionError,
  NotebookEditTool,
  resolveNotebookCellIndex,
} from '../../NotebookEditTool/NotebookEditTool.js'

function makeToolContext(readFileState: FileStateCache): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-5',
      tools: [],
      verbose: false,
      maxThinkingTokens: 0,
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
    },
    abortController: new AbortController(),
    readFileState,
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
        fileHistory: {
          snapshots: [],
          trackedFiles: new Set<string>(),
        },
      }) as never,
    setAppState: () => {},
    setToolJSX: () => {},
    addNotification: () => {},
    messages: [],
  } as unknown as ToolUseContext
}

describe('Wave 319-321 File Tools & File Utils (#1739 #1740 #1744 #1775 #1792 #1854 #1855 #1879 #1914 #1929)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wave321-filetools-'))
    clearTimedOutRenameTargetsForTesting()
    resetImageRereadState()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    clearTimedOutRenameTargetsForTesting()
    resetImageRereadState()
  })

  test('#1739 DISK_FULL_ROLLBACK_CODES covers ENOSPC/EIO/EDQUOT/EFBIG and writeFileSyncAndFlush_DEPRECATED writes cleanly', () => {
    expect(DISK_FULL_ROLLBACK_CODES.has('ENOSPC')).toBe(true)
    expect(DISK_FULL_ROLLBACK_CODES.has('EIO')).toBe(true)
    expect(DISK_FULL_ROLLBACK_CODES.has('EDQUOT')).toBe(true)
    expect(DISK_FULL_ROLLBACK_CODES.has('EFBIG')).toBe(true)

    const target = join(tmpDir, 'atomic.txt')
    writeFileSync(target, 'initial-content', 'utf8')
    writeFileSyncAndFlush_DEPRECATED(target, 'updated-content', {
      encoding: 'utf8',
    })
    expect(readFileSync(target, 'utf8')).toBe('updated-content')
  })

  test('#1740 FileWriteTool.call converts non-ENOENT read failure (EISDIR) into recoverable ToolExecutionError', async () => {
    const dirTarget = join(tmpDir, 'a-directory')
    mkdirSync(dirTarget, { recursive: true })
    writeFileSync(join(dirTarget, 'child.txt'), 'x', 'utf8')

    const readFileState = new FileStateCache(50, 1024 * 1024)
    const ctx = makeToolContext(readFileState)

    let caught: unknown
    try {
      await FileWriteTool.call(
        { file_path: dirTarget, content: 'hello' },
        ctx,
        {} as never,
        {} as never,
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe('ToolExecutionError')
    expect((caught as Error).message).toContain('Could not read existing file')
  })

  test('#1854 resolveNotebookCellIndex refuses missing cell_id on delete/replace instead of defaulting to cell 0', () => {
    const cells = [
      { id: 'c0', cell_type: 'code' as const, source: 'x = 1', metadata: {} },
      { id: 'c1', cell_type: 'code' as const, source: 'y = 2', metadata: {} },
    ]
    expect(resolveNotebookCellIndex(cells, undefined, 'insert')).toBe(0)
    const delRes = resolveNotebookCellIndex(cells, undefined, 'delete')
    expect(typeof delRes).toBe('object')
    expect((delRes as { errorCode: number }).errorCode).toBe(7)
    const repRes = resolveNotebookCellIndex(cells, undefined, 'replace')
    expect(typeof repRes).toBe('object')
    expect((repRes as { errorCode: number }).errorCode).toBe(7)
    expect(resolveNotebookCellIndex(cells, 'c1', 'delete')).toBe(1)
    expect(resolveNotebookCellIndex(cells, 'c0', 'insert')).toBe(1)
  })

  test('#1744 #1854 #1914 NotebookEditTool.call throws ToolExecutionError on mtime drift, missing cell_id, and invalid JSON', async () => {
    const nbPath = join(tmpDir, 'test.ipynb')
    const validNb = JSON.stringify({
      cells: [
        {
          id: 'cell-a',
          cell_type: 'code',
          source: ['print(1)'],
          metadata: {},
          outputs: [],
          execution_count: null,
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    })
    writeFileSync(nbPath, validNb, 'utf8')

    const readFileState = new FileStateCache(50, 1024 * 1024)
    const ctx = makeToolContext(readFileState)

    // #1854 + #1914: delete without cell_id throws ToolExecutionError (and preserves cell 0)
    let errMissingId: unknown
    try {
      await NotebookEditTool.call(
        {
          notebook_path: nbPath,
          new_source: '',
          edit_mode: 'delete',
        },
        ctx,
        {} as never,
        {} as never,
      )
    } catch (err) {
      errMissingId = err
    }
    expect(errMissingId).toBeInstanceOf(NotebookEditExecutionError)
    expect((errMissingId as Error).name).toBe('ToolExecutionError')
    expect(JSON.parse(readFileSync(nbPath, 'utf8')).cells.length).toBe(1)

    // #1744: mtime re-check in call() rejects stale readFileState
    const actualMtime = statSync(nbPath).mtimeMs
    readFileState.set(nbPath, {
      content: validNb,
      timestamp: actualMtime - 60_000,
      offset: undefined,
      limit: undefined,
    })
    let errMtime: unknown
    try {
      await NotebookEditTool.call(
        {
          notebook_path: nbPath,
          cell_id: 'cell-a',
          new_source: 'print(2)',
          edit_mode: 'replace',
        },
        ctx,
        {} as never,
        {} as never,
      )
    } catch (err) {
      errMtime = err
    }
    expect(errMtime).toBeInstanceOf(NotebookEditExecutionError)
    expect((errMtime as Error).name).toBe('ToolExecutionError')
    expect((errMtime as Error).message).toContain(
      'File has been modified since read',
    )

    // #1914: corrupt JSON throws ToolExecutionError instead of returning data.error
    const badNbPath = join(tmpDir, 'corrupt.ipynb')
    writeFileSync(badNbPath, '{not valid json', 'utf8')
    let errCorrupt: unknown
    try {
      await NotebookEditTool.call(
        {
          notebook_path: badNbPath,
          cell_id: 'cell-a',
          new_source: 'x',
          edit_mode: 'replace',
        },
        ctx,
        {} as never,
        {} as never,
      )
    } catch (err) {
      errCorrupt = err
    }
    expect(errCorrupt).toBeInstanceOf(NotebookEditExecutionError)
    expect((errCorrupt as Error).name).toBe('ToolExecutionError')
  })

  test('#1855 FileEditTool.call re-checks .ipynb refusal, empty old_string overwrite, and non-unique match', async () => {
    const readFileState = new FileStateCache(50, 1024 * 1024)
    const ctx = makeToolContext(readFileState)

    // .ipynb refusal inside call()
    const nbFile = join(tmpDir, 'book.ipynb')
    writeFileSync(nbFile, '{"cells":[]}', 'utf8')
    await expect(
      FileEditTool.call(
        {
          file_path: nbFile,
          old_string: 'cells',
          new_string: 'items',
        },
        ctx,
        {} as never,
        {} as never,
      ),
    ).rejects.toThrow(/NotebookEdit/)

    // empty old_string on existing non-empty file refused inside call()
    const txtFile = join(tmpDir, 'existing.txt')
    writeFileSync(txtFile, 'foo bar foo', 'utf8')
    await expect(
      FileEditTool.call(
        {
          file_path: txtFile,
          old_string: '',
          new_string: 'overwrite',
        },
        ctx,
        {} as never,
        {} as never,
      ),
    ).rejects.toThrow(/Cannot create new file - file already exists/)

    // ambiguous non-replace_all match refused inside call()
    readFileState.set(txtFile, {
      content: 'foo bar foo',
      timestamp: statSync(txtFile).mtimeMs,
      offset: undefined,
      limit: undefined,
    })
    await expect(
      FileEditTool.call(
        {
          file_path: txtFile,
          old_string: 'foo',
          new_string: 'baz',
          replace_all: false,
        },
        ctx,
        {} as never,
        {} as never,
      ),
    ).rejects.toThrow(/Found 2 matches/)
  })

  test('#1775 fileHistory resolves real parent dir, rejects dangling symlink, verifies dev/ino, and safely unlinks', async () => {
    const realSub = join(tmpDir, 'real-sub')
    const otherSub = join(tmpDir, 'other-sub')
    mkdirSync(realSub, { recursive: true })
    mkdirSync(otherSub, { recursive: true })
    writeFileSync(join(realSub, 'keep.txt'), 'ok', 'utf8')

    // Resolve through nested non-existent directory beneath a real ancestor
    const resolved = await resolveRealParentDir(
      join(realSub, 'future-a', 'future-b', 'file.txt'),
    )
    expect(resolved.endsWith(join('future-a', 'future-b'))).toBe(true)

    // Dangling symlink in ancestor chain is rejected
    const danglingLink = join(tmpDir, 'dangling-dir')
    symlinkSync(join(tmpDir, 'does-not-exist-target'), danglingLink)
    await expect(
      resolveRealParentDir(join(danglingLink, 'sub', 'file.txt')),
    ).rejects.toThrow(/dangling symlink/i)

    // verifyParentDirectoryIdentity checks dev & ino against expectedRealParentDir
    const targetFile = join(realSub, 'tracked.txt')
    writeFileSync(targetFile, 'hello', 'utf8')
    const expectedRealParent = await resolveRealParentDir(targetFile)
    expect(
      await verifyParentDirectoryIdentity(targetFile, expectedRealParent),
    ).toEqual({ ok: true })
    const mismatch = await verifyParentDirectoryIdentity(targetFile, otherSub)
    expect(mismatch.ok).toBe(false)

    // safeUnlinkTrackedFile unlinks regular file cleanly
    expect(await safeUnlinkTrackedFile(targetFile, expectedRealParent)).toBe(
      'deleted',
    )
    expect(() => lstatSync(targetFile)).toThrow()

    // safeUnlinkTrackedFile refuses when parent directory is a symlink
    const symDir = join(tmpDir, 'sym-dir')
    symlinkSync(realSub, symDir)
    const viaSym = join(symDir, 'keep.txt')
    const symRes = await safeUnlinkTrackedFile(viaSym, expectedRealParent)
    expect(typeof symRes).toBe('object')
    expect(readFileSync(join(realSub, 'keep.txt'), 'utf8')).toBe('ok')
  })

  test('#1792 renameRetry extended/long backoff constants and timed-out target cache', async () => {
    expect(RENAME_EXTENDED_RETRY_DELAYS_MS).toEqual([100, 200, 400])
    expect(RENAME_LONG_RETRY_DELAYS_MS).toEqual([100, 500, 2000])

    const target = join(tmpDir, 'locked-file.txt')
    writeFileSync(target, 'existing-content', 'utf8')
    const busyErr = Object.assign(new Error('EBUSY'), { code: 'EBUSY' })

    // Exhaust extended backoff -> caches targetPath in timedOutRenameTargets
    const delays1: number[] = []
    let attempts = 0
    await expect(
      renameWithAdaptiveRetry(
        `${target}.tmp`,
        target,
        async () => {
          attempts++
          throw busyErr
        },
        false,
        async ms => {
          delays1.push(ms)
        },
      ),
    ).rejects.toThrow('EBUSY')
    expect(attempts).toBe(5) // 1 initial + 50ms + [100, 200, 400]
    expect(delays1).toEqual([50, 100, 200, 400])
    expect(hasTimedOutRenameTarget(target)).toBe(true)

    // Second call on known timed-out target drops extended backoff to short fallback [50, 50]
    const delays2: number[] = []
    await expect(
      renameWithAdaptiveRetry(
        `${target}.tmp`,
        target,
        async () => {
          throw busyErr
        },
        false,
        async ms => {
          delays2.push(ms)
        },
      ),
    ).rejects.toThrow('EBUSY')
    expect(delays2).toEqual([50, 50, 50])

    // Sync adaptive retry succeeds cleanly when lock clears
    let syncAttempts = 0
    renameSyncWithAdaptiveRetry(
      `${target}.tmp`,
      target,
      () => {
        syncAttempts++
      },
      () => {},
    )
    expect(syncAttempts).toBe(1)

    // renameWithLongRetry uses [100, 500, 2000] and succeeds on 3rd attempt
    let longCalls = 0
    await renameWithLongRetry(`${target}.tmp`, target, async () => {
      longCalls++
      if (longCalls < 2) throw busyErr
    })
    expect(longCalls).toBe(2)
  })

  test('#1879 readFileInRange decoupleSlicedString detaches single-line UTF-16 slices cleanly', async () => {
    const bigLine = `alpha-${'x'.repeat(200)}-omega-🚀`
    const decoupled = decoupleSlicedString(bigLine)
    expect(decoupled).toBe(bigLine)

    const p = join(tmpDir, 'lines.txt')
    writeFileSync(p, `line1\n${bigLine}\nline3\n`, 'utf8')
    const res = await readFileInRange(p, 1, 1)
    expect(res.content).toBe(bigLine)
    expect(res.lineCount).toBe(1)
  })

  test('#1929 FileReadTool unchanged image re-read limit refuses past 3 unchanged reads when media was stripped', () => {
    expect(UNCHANGED_IMAGE_REREAD_LIMIT).toBe(3)
    expect(UNCHANGED_IMAGE_REREAD_REFUSAL_REASON).toBe(
      'Read of an unchanged image refused past its limit',
    )

    const imgPath = join(tmpDir, 'diagram.png')
    const imgBase64 = Buffer.from('fake-png-bytes-unchanged').toString('base64')
    const agentId = 'agent-img-test'

    // Before media strip, even 50 repeats are allowed
    for (let i = 0; i < 50; i++) {
      expect(
        checkUnchangedImageRereadLimit(agentId, imgPath, imgBase64),
      ).toBeUndefined()
    }

    // Once media stripping is reported, the next unchanged read is refused
    noteImageMediaStripped(agentId, 2)
    const refusal = checkUnchangedImageRereadLimit(agentId, imgPath, imgBase64)
    expect(refusal).toBe(UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE)

    // Modified image content has a fresh hash and is allowed
    const modifiedBase64 = Buffer.from('fake-png-bytes-modified').toString(
      'base64',
    )
    expect(
      checkUnchangedImageRereadLimit(agentId, imgPath, modifiedBase64),
    ).toBeUndefined()
  })
})
