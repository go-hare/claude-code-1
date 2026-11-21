import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  KEPT_FOLDER_PREFIX,
  stageFile,
  stageFileWireResult,
} from '../stageFile.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  delete process.env.CLAUDE_STAGE_FILE_ROOT
  delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
  delete process.env.CLAUDE_CODE_SESSION_INGRESS_URL
  delete process.env.CLAUDE_CODE_SDK_URL
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('stageFile Wave 1E (P0-21 — fetch + atomic publish + kept protection)', () => {
  test('stages new upload file as read-only and returns already_present when !force', async () => {
    const root = makeTempDir('stage-root-')
    process.env.CLAUDE_STAGE_FILE_ROOT = root
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'sess_1'

    let fetchCalls = 0
    const res1 = await stageFile(
      { mount_path: '/uploads/docs/notes.md' },
      undefined,
      'off',
      {
        fetchContent: async mountPath => {
          fetchCalls++
          expect(mountPath).toBe('/uploads/docs/notes.md')
          return { ok: true, data: Buffer.from('hello v1\n', 'utf8') }
        },
      },
    )

    expect(res1).toEqual({ ok: true })
    if (res1.ok) {
      expect(stageFileWireResult(res1)).toEqual({ ok: true })
    }
    expect(fetchCalls).toBe(1)

    const dest = join(root, 'docs', 'notes.md')
    expect(readFileSync(dest, 'utf8')).toBe('hello v1\n')
    if (process.platform !== 'win32') {
      expect(statSync(dest).mode & 0o777).toBe(0o444)
    }

    // Second call without force skips fetch and returns already_present.
    const res2 = await stageFile(
      { mount_path: '/uploads/docs/notes.md', force: false },
      undefined,
      'off',
      {
        fetchContent: async () => {
          fetchCalls++
          return { ok: true, data: Buffer.from('should not run', 'utf8') }
        },
      },
    )
    expect(res2).toEqual({ ok: true, noop: 'already_present' })
    expect(fetchCalls).toBe(1)
  })

  test('force re-stage moves Claude-edited file into .kept- folder instead of clobbering', async () => {
    const root = makeTempDir('stage-kept-')
    process.env.CLAUDE_STAGE_FILE_ROOT = root
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'sess_2'

    const dest = join(root, 'report.md')
    writeFileSync(dest, 'claude edited version\n', 'utf8')

    const res = await stageFile(
      { mount_path: '/uploads/report.md', force: true },
      undefined,
      'off',
      {
        fetchContent: async () => ({
          ok: true,
          data: Buffer.from('user re-sent version\n', 'utf8'),
        }),
      },
    )

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.movedAsideTo).toBeDefined()
      expect(res.movedAsideTo!.startsWith(KEPT_FOLDER_PREFIX)).toBe(true)
      expect(
        readFileSync(join(root, res.movedAsideTo!, 'report.md'), 'utf8'),
      ).toBe('claude edited version\n')
    }
    expect(readFileSync(dest, 'utf8')).toBe('user re-sent version\n')
    // Make file writable again so rmSync succeeds on all platforms.
    chmodSync(dest, 0o644)
  })

  test('force re-stage with identical bytes returns already_present noop', async () => {
    const root = makeTempDir('stage-same-')
    process.env.CLAUDE_STAGE_FILE_ROOT = root
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'sess_3'

    const dest = join(root, 'same.txt')
    writeFileSync(dest, 'identical bytes\n', 'utf8')

    const res = await stageFile(
      { mount_path: '/uploads/same.txt', force: true },
      undefined,
      'off',
      {
        fetchContent: async () => ({
          ok: true,
          data: Buffer.from('identical bytes\n', 'utf8'),
        }),
      },
    )

    expect(res).toEqual({ ok: true, noop: 'already_present' })
  })

  test('rejects symlink parent directory escaping stage root', async () => {
    if (process.platform === 'win32') return
    const root = makeTempDir('stage-escape-root-')
    const outside = makeTempDir('stage-escape-outside-')
    process.env.CLAUDE_STAGE_FILE_ROOT = root
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'sess_4'

    symlinkSync(outside, join(root, 'escape'))

    const res = await stageFile(
      { mount_path: '/uploads/escape/pwn.txt' },
      undefined,
      'off',
      {
        fetchContent: async () => ({
          ok: true,
          data: Buffer.from('nope', 'utf8'),
        }),
      },
    )

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('escaped stage root')
    }
  })

  test('surfaces real credential/sdk-url errors instead of unconditional REMOTE_SESSION_ID stub', async () => {
    const root = makeTempDir('stage-cred-')
    process.env.CLAUDE_STAGE_FILE_ROOT = root
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'sess_5'

    // Without sdkUrl or credential -> official ccr-session error (NOT "CLAUDE_CODE_REMOTE_SESSION_ID unset")
    const noSdk = await stageFile({ mount_path: '/uploads/a.txt' })
    expect(noSdk.ok).toBe(false)
    if (!noSdk.ok) {
      expect(noSdk.error).toBe('ccr-session host requires --sdk-url')
    }

    // With incomplete credential -> official incomplete credential error
    const badCred = await stageFile(
      { mount_path: '/uploads/a.txt' },
      { filestore_jwt: '' },
    )
    expect(badCred.ok).toBe(false)
    if (!badCred.ok) {
      expect(badCred.error).toBe('list returned incomplete credential')
    }
  })
})
