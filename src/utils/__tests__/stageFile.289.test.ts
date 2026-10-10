/**
 * densable 2.1.289 print stageFile / addDirectoryDestFromMountPath unique English.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { DEFAULT_STAGE_FILE_ROOT } from '../syncedFileSyncer.js'
import {
  addDirectoryDestFromMountPath,
  STAGE_FILE_OUTPUTS_MOUNT_PREFIX,
  STAGE_TMP_PREFIX,
  stageFile,
  stageFileWireResult,
  resolveStageMount,
} from '../stageFile.js'

describe('densable 2.1.289 stageFile unique English', () => {
  afterEach(() => {
    delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    delete process.env.CLAUDE_STAGE_FILE_ROOT
  })

  test('Q rejects null bytes, relative, .., tmp names, and non-upload mounts', () => {
    expect(() => resolveStageMount('/uploads/a\0b')).toThrow(
      'mount_path contains null bytes',
    )
    expect(() => resolveStageMount('uploads/a')).toThrow(
      'mount_path must be absolute',
    )
    expect(() => resolveStageMount('/uploads/../etc/passwd')).toThrow(
      'mount_path must not contain ".." segments',
    )
    expect(() => resolveStageMount(`/uploads/${STAGE_TMP_PREFIX}x`)).toThrow(
      'mount_path names a reserved temporary-file name',
    )
    expect(() => resolveStageMount('/tmp/x')).toThrow(
      'mount_path must be under /uploads/ or /outputs/',
    )
  })

  test('uploads map onto STAGE_FILE_ROOT; outputs need a managed remote session', () => {
    const upload = resolveStageMount('/uploads/pkg/a.txt')
    expect(upload.readOnly).toBe(true)
    expect(upload.dest).toBe(join(DEFAULT_STAGE_FILE_ROOT, 'pkg', 'a.txt'))
    expect(() =>
      resolveStageMount(`${STAGE_FILE_OUTPUTS_MOUNT_PREFIX}/x`),
    ).toThrow(
      'staging under /outputs/ is only supported on managed remote sessions',
    )
  })

  test('Ycs add_directory dest is uploads-only and not .home', () => {
    expect(addDirectoryDestFromMountPath('/uploads/extra')).toBe(
      join(DEFAULT_STAGE_FILE_ROOT, 'extra'),
    )
    expect(() =>
      addDirectoryDestFromMountPath(`${STAGE_FILE_OUTPUTS_MOUNT_PREFIX}/x`),
    ).toThrow('add_directory mount_path must be under /uploads/')
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'sess'
    process.env.CLAUDE_CODE_ENVIRONMENT_KIND = 'remote'
    expect(() => addDirectoryDestFromMountPath('/uploads/.home/x')).toThrow(
      'add_directory mount_path must be under /uploads/ and not under /uploads/.home/',
    )
  })

  test('Xcs without remote session id matches gold first return', async () => {
    const result = await stageFile({ mount_path: '/uploads/a.txt' })
    expect(result).toEqual({
      ok: false,
      error: 'CLAUDE_CODE_REMOTE_SESSION_ID unset',
    })
  })

  test('print.ts hosts stage_file and add_directory unique English', async () => {
    const src = await Bun.file(
      new URL('../../cli/print.ts', import.meta.url),
    ).text()
    expect(src).toContain("req.subtype === 'stage_file'")
    expect(src).toContain('stage_file failed')
    expect(src).toContain("req.subtype === 'add_directory'")
    expect(src).toContain('add_directory dest:')
    expect(src).toContain(
      'add_directory requires CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD to be set in the container environment',
    )
    expect(src).toContain('add_directory stage:')
    expect(src).toContain('add_directory staged:')
    expect(src).toContain('staged_path:')
  })

  test('Kcs omits undefined noop', () => {
    expect(stageFileWireResult({ ok: true })).toEqual({ ok: true })
    expect(stageFileWireResult({ ok: true, noop: 'already_present' })).toEqual({
      ok: true,
      noop: 'already_present',
    })
  })
})
