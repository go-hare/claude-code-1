import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { getOriginalCwd, setOriginalCwd } from '../../../bootstrap/state.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import {
  addDirHelpMessage,
  validateDirectoryForWorkspace,
  zk,
} from '../validation.js'

const emptyContext = {
  additionalWorkingDirectories: new Map(),
} as ToolPermissionContext

describe('workspace directory validate (251 #34 mbe/gbe)', () => {
  let suiteRoot = ''
  let previousOriginalCwd = ''

  beforeEach(() => {
    suiteRoot = mkdtempSync(join(tmpdir(), 'add-dir-251-'))
    previousOriginalCwd = getOriginalCwd()
    setOriginalCwd(suiteRoot)
  })

  afterEach(() => {
    setOriginalCwd(previousOriginalCwd)
    rmSync(suiteRoot, { recursive: true, force: true })
  })

  test('a null-byte path is invalidPath with containsNullByte', async () => {
    const result = await validateDirectoryForWorkspace(
      '/tmp/bad\0dir',
      emptyContext,
    )
    expect(result).toEqual({
      resultType: 'invalidPath',
      directoryPath: '/tmp/bad\0dir',
      containsNullByte: true,
    })
    expect(addDirHelpMessage(result)).toContain('null character')
  })

  test('gbe names the null-character sentence', () => {
    const nullByte = addDirHelpMessage({
      resultType: 'invalidPath',
      directoryPath: '/tmp/x',
      containsNullByte: true,
    })
    expect(nullByte).toContain('null character')
    expect(nullByte).toContain('/tmp/x')
    const unresolved = addDirHelpMessage({
      resultType: 'invalidPath',
      directoryPath: '/tmp/x',
      containsNullByte: false,
    })
    expect(unresolved).toContain("couldn't be resolved")
    expect(unresolved).toContain('/tmp/x')
  })

  test('gbe alreadyInWorkingDirectory exact original cwd', () => {
    expect(
      addDirHelpMessage({
        resultType: 'alreadyInWorkingDirectory',
        directoryPath: '/tmp/x',
        workingDir: '/tmp/x',
        isExactMatch: true,
        isOriginalCwd: true,
      }),
    ).toContain('is already the current working directory.')
  })

  test('gbe alreadyInWorkingDirectory exact additional dir', () => {
    expect(
      addDirHelpMessage({
        resultType: 'alreadyInWorkingDirectory',
        directoryPath: '/tmp/extra',
        workingDir: '/tmp/extra',
        isExactMatch: true,
        isOriginalCwd: false,
      }),
    ).toContain('is already added as a working directory.')
  })

  test('gbe alreadyInWorkingDirectory nested under cwd', () => {
    const message = addDirHelpMessage({
      resultType: 'alreadyInWorkingDirectory',
      directoryPath: '/tmp/x/nested',
      workingDir: '/tmp/x',
      isExactMatch: false,
      isOriginalCwd: true,
    })
    expect(message).toContain(
      'already accessible within the current working directory',
    )
    expect(message).toContain('/tmp/x')
  })

  test('gbe alreadyInWorkingDirectory nested under additional dir', () => {
    const message = addDirHelpMessage({
      resultType: 'alreadyInWorkingDirectory',
      directoryPath: '/tmp/extra/nested',
      workingDir: '/tmp/extra',
      isExactMatch: false,
      isOriginalCwd: false,
    })
    expect(message).toContain(
      'already accessible within the additional working directory',
    )
    expect(message).toContain('/tmp/extra')
  })

  test('gbe emptyPath / pathNotFound / notADirectory / success', () => {
    expect(addDirHelpMessage({ resultType: 'emptyPath' })).toBe(
      'Please provide a directory path.',
    )
    expect(
      addDirHelpMessage({
        resultType: 'pathNotFound',
        directoryPath: '/tmp/missing',
        absolutePath: '/abs/missing',
      }),
    ).toContain('/abs/missing')
    expect(
      addDirHelpMessage({
        resultType: 'notADirectory',
        directoryPath: '/tmp/file',
        absolutePath: '/tmp/file',
      }),
    ).toContain('is not a directory')
    expect(
      addDirHelpMessage({
        resultType: 'success',
        absolutePath: '/tmp/ok',
      }),
    ).toContain('/tmp/ok')
  })

  test('emptyPath from mbe when the directory string is empty', async () => {
    expect(await validateDirectoryForWorkspace('', emptyContext)).toEqual({
      resultType: 'emptyPath',
    })
  })

  test('zk is exact Error.message, not a substring', () => {
    expect(
      zk(new Error('Path contains null bytes'), 'Path contains null bytes'),
    ).toBe(true)
    expect(
      zk(
        new Error('Path contains null bytes extra'),
        'Path contains null bytes',
      ),
    ).toBe(false)
    expect(zk('Path contains null bytes', 'Path contains null bytes')).toBe(
      false,
    )
  })

  test('mbe pathNotFound for a missing directory', async () => {
    const missing = join(suiteRoot, 'does-not-exist')
    const result = await validateDirectoryForWorkspace(missing, emptyContext)
    expect(result.resultType).toBe('pathNotFound')
    if (result.resultType !== 'pathNotFound') return
    expect(result.absolutePath).toBe(resolve(missing))
  })

  test('mbe notADirectory for a regular file', async () => {
    const filePath = join(suiteRoot, 'file.txt')
    writeFileSync(filePath, 'x')
    const result = await validateDirectoryForWorkspace(filePath, emptyContext)
    expect(result).toEqual({
      resultType: 'notADirectory',
      directoryPath: filePath,
      absolutePath: resolve(filePath),
    })
  })

  test('mbe alreadyInWorkingDirectory exact original cwd', async () => {
    const result = await validateDirectoryForWorkspace(suiteRoot, emptyContext)
    expect(result).toEqual({
      resultType: 'alreadyInWorkingDirectory',
      directoryPath: suiteRoot,
      workingDir: suiteRoot,
      isExactMatch: true,
      isOriginalCwd: true,
    })
  })

  test('mbe alreadyInWorkingDirectory nested under original cwd', async () => {
    const nested = join(suiteRoot, 'nested')
    mkdirSync(nested)
    const result = await validateDirectoryForWorkspace(nested, emptyContext)
    expect(result).toEqual({
      resultType: 'alreadyInWorkingDirectory',
      directoryPath: nested,
      workingDir: suiteRoot,
      isExactMatch: false,
      isOriginalCwd: true,
    })
  })

  test('mbe alreadyInWorkingDirectory exact additional working dir', async () => {
    const extra = mkdtempSync(join(tmpdir(), 'add-dir-extra-'))
    try {
      const context = {
        additionalWorkingDirectories: new Map([
          [extra, { path: extra, source: 'session' as const }],
        ]),
      } as ToolPermissionContext
      const result = await validateDirectoryForWorkspace(extra, context)
      expect(result).toEqual({
        resultType: 'alreadyInWorkingDirectory',
        directoryPath: extra,
        workingDir: extra,
        isExactMatch: true,
        isOriginalCwd: false,
      })
    } finally {
      rmSync(extra, { recursive: true, force: true })
    }
  })

  test('mbe success for a directory outside all working dirs', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'add-dir-outside-'))
    try {
      const result = await validateDirectoryForWorkspace(outside, emptyContext)
      expect(result).toEqual({
        resultType: 'success',
        absolutePath: resolve(outside),
      })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
