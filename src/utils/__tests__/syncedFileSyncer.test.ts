import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  applySyncedFileWrite,
  buildWorkingFilestoreGetPath,
  buildWorkingFilestorePath,
  createWorkingFilestoreTransports,
  downloadAndApplySyncedFile,
  escapesSyncRoot,
  getSyncedFile,
  isRetryableTransport,
  maxWorkingFilestoreBodyBytes,
  pushSyncedFile,
  sha256Hex,
  shouldIgnoreSyncedPath,
  startSyncedFileSyncer,
  stopActiveSyncerForTest,
  MAX_WORKING_FILE_BYTES,
  MAX_SCAN_ENTRIES,
  WORKING_FILESTORE_PREFIX,
  WORKING_FILESTORE_PUT_PATH,
} from '../syncedFileSyncer.js'

describe('syncedFileSyncer densables', () => {
  afterEach(() => {
    stopActiveSyncerForTest()
  })

  test('shouldIgnoreSyncedPath', () => {
    expect(shouldIgnoreSyncedPath('.git/config')).toBe(true)
    expect(shouldIgnoreSyncedPath('foo~')).toBe(true)
    expect(shouldIgnoreSyncedPath('x.swp')).toBe(true)
    expect(shouldIgnoreSyncedPath('a.tmp')).toBe(true)
    expect(shouldIgnoreSyncedPath('src/main.ts')).toBe(false)
  })

  test('escapesSyncRoot', () => {
    expect(escapesSyncRoot('/tmp/root', '../etc/passwd')).toBe(true)
    expect(escapesSyncRoot('/tmp/root', 'ok/file.txt')).toBe(false)
  })

  test('constants', () => {
    expect(MAX_WORKING_FILE_BYTES).toBe(26_214_400)
    expect(MAX_SCAN_ENTRIES).toBe(4096)
  })

  test('startSyncedFileSyncer scans local files', async () => {
    const root = join(
      tmpdir(),
      `cc-synced-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await mkdir(root, { recursive: true })
    try {
      await writeFile(join(root, 'hello.txt'), 'hi')
      await mkdir(join(root, 'sub'), { recursive: true })
      await writeFile(join(root, 'sub', 'a.ts'), 'export {}')
      await writeFile(join(root, '.hidden'), 'skip')

      const handle = await startSyncedFileSyncer(root)
      expect(handle).not.toBeNull()
      await handle!.initialReconcile
      const seen = handle!.getSeenState()
      expect(seen.has('hello.txt')).toBe(true)
      expect(seen.has('sub/a.ts')).toBe(true)
      expect(seen.has('.hidden')).toBe(false)
      handle!.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('lane/etag reconcile densable plan + execute', async () => {
    const {
      planSyncedFileLaneReconcile,
      reconcileSyncedFileLanes,
      laneRowToRelPath,
      buildWorkingFilestoreListPath,
      WORKING_FILESTORE_LIST_PATH,
    } = await import('../syncedFileSyncer.js')

    expect(laneRowToRelPath('working/a.ts')).toBe('a.ts')
    expect(laneRowToRelPath('a.ts')).toBe('a.ts')
    expect(buildWorkingFilestoreListPath()).toContain(
      WORKING_FILESTORE_LIST_PATH,
    )

    const plan = planSyncedFileLaneReconcile({
      remote: [
        { path: 'working/same.ts', content_sha256: 'aaa' },
        { path: 'working/remote-only.ts', content_sha256: 'bbb' },
        { path: 'working/mismatch.ts', content_sha256: 'ccc' },
        { path: 'working/.hidden', content_sha256: 'ddd' },
      ],
      localEtags: {
        'same.ts': 'aaa',
        'mismatch.ts': 'local-ccc',
        'local-only.ts': 'eee',
      },
      localOnly: ['local-only.ts'],
    })
    expect(plan.find(a => a.relPath === 'same.ts')?.action).toBe('skip')
    expect(plan.find(a => a.relPath === 'remote-only.ts')?.action).toBe('pull')
    expect(plan.find(a => a.relPath === 'mismatch.ts')?.action).toBe('pull')
    expect(plan.find(a => a.relPath === '.hidden')?.action).toBe('skip')
    expect(plan.find(a => a.relPath === 'local-only.ts')?.action).toBe('push')

    const conflictPlan = planSyncedFileLaneReconcile({
      remote: [{ path: 'working/m.ts', content_sha256: 'r' }],
      localEtags: { 'm.ts': 'l' },
      preferLocalOnConflict: true,
    })
    expect(conflictPlan[0]?.action).toBe('conflict')

    const root = join(
      tmpdir(),
      `cc-lane-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await mkdir(root, { recursive: true })
    try {
      const etags = new Map<string, string>()
      const result = await reconcileSyncedFileLanes({
        root,
        localEtags: etags,
        list: async () => [
          {
            path: 'working/from-remote.txt',
            content_sha256: sha256Hex(Buffer.from('remote-bytes')),
          },
        ],
        get: async () => ({
          ok: true,
          status: 200,
          data: {
            content: Buffer.from('remote-bytes').toString('base64'),
            content_sha256: sha256Hex(Buffer.from('remote-bytes')),
          },
        }),
      })
      expect(result.pulled).toBe(1)
      expect(result.errors).toBe(0)
      const { readFile } = await import('node:fs/promises')
      expect(await readFile(join(root, 'from-remote.txt'), 'utf8')).toBe(
        'remote-bytes',
      )
      expect(etags.get('from-remote.txt')).toBe(
        sha256Hex(Buffer.from('remote-bytes')),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('filestore densables j6o/J2t/SEf', async () => {
    expect(WORKING_FILESTORE_PREFIX).toBe('working')
    expect(buildWorkingFilestorePath('a/b.ts')).toBe('working/a/b.ts')
    expect(sha256Hex('hi').length).toBe(64)
    expect(isRetryableTransport('timeout')).toBe(true)
    expect(isRetryableTransport('auth')).toBe(false)
    expect(isRetryableTransport('http', 500)).toBe(true)
    expect(isRetryableTransport('http', 400)).toBe(false)
    expect(maxWorkingFilestoreBodyBytes(3)).toBe(Math.ceil((3 * 4) / 3) + 1024)

    const put = await pushSyncedFile({
      relPath: 'x.txt',
      content: 'hello',
      put: async body => {
        expect(body.path).toBe('working/x.txt')
        expect(body.content).toBe(Buffer.from('hello').toString('base64'))
        return {
          ok: true,
          status: 200,
          data: { content_sha256: 'abc' },
        }
      },
    })
    expect(put).toEqual({ kind: 'ok', content_sha256: 'abc' })

    const conflict = await pushSyncedFile({
      relPath: 'x.txt',
      content: 'hello',
      put: async () => ({ ok: true, status: 409 }),
    })
    expect(conflict).toEqual({ kind: 'conflict' })

    const noTransport = await pushSyncedFile({
      relPath: 'x.txt',
      content: 'hello',
    })
    expect(noTransport.kind).toBe('error')

    const got = await getSyncedFile({
      relPath: 'x.txt',
      get: async path => {
        expect(path).toBe('working/x.txt')
        return {
          ok: true,
          status: 200,
          data: {
            content: Buffer.from('hi').toString('base64'),
            content_sha256: 'h',
          },
        }
      },
    })
    expect(got.kind).toBe('ok')
    if (got.kind === 'ok') {
      expect(got.buf.toString()).toBe('hi')
      expect(got.content_sha256).toBe('h')
    }

    const missing = await getSyncedFile({
      relPath: 'x.txt',
      get: async () => ({ ok: true, status: 404 }),
    })
    expect(missing).toEqual({ kind: 'not_found' })
  })

  test('createWorkingFilestoreTransports densable', async () => {
    expect(WORKING_FILESTORE_PUT_PATH).toBe('/worker/synced_file')
    expect(buildWorkingFilestoreGetPath('a/b.ts')).toBe(
      '/worker/synced_file?path=working%2Fa%2Fb.ts',
    )
    const calls: Array<{ method: string; path: string; body?: unknown }> = []
    const transport = createWorkingFilestoreTransports({
      request: async args => {
        calls.push({
          method: args.method,
          path: args.path,
          body: args.body,
        })
        if (args.method === 'put') {
          return {
            ok: true,
            status: 200,
            data: { content_sha256: 'hash1' },
          }
        }
        return {
          ok: true,
          status: 200,
          data: {
            content: Buffer.from('hi').toString('base64'),
            content_sha256: 'hash2',
          },
        }
      },
    })
    const put = await pushSyncedFile({
      relPath: 'n.txt',
      content: 'n',
      put: transport.put,
    })
    expect(put).toEqual({ kind: 'ok', content_sha256: 'hash1' })
    expect(calls[0]?.method).toBe('put')
    expect(calls[0]?.path).toBe('/worker/synced_file')
    const got = await getSyncedFile({
      relPath: 'n.txt',
      get: transport.get,
    })
    expect(got.kind).toBe('ok')
    if (got.kind === 'ok') {
      expect(got.buf.toString()).toBe('hi')
    }
    expect(calls[1]?.method).toBe('get')
    expect(calls[1]?.path).toContain('path=working%2Fn.txt')
  })

  test('applySyncedFileWrite + downloadAndApplySyncedFile J2t densable', async () => {
    const root = join(
      tmpdir(),
      `cc-apply-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await mkdir(root, { recursive: true })
    try {
      const applied = await applySyncedFileWrite({
        root,
        relPath: 'sub/out.txt',
        content: 'hello-apply',
      })
      expect(applied.kind).toBe('ok')
      if (applied.kind === 'ok') {
        expect(applied.bytes).toBe(Buffer.byteLength('hello-apply'))
        const { readFile } = await import('node:fs/promises')
        expect(await readFile(applied.absPath, 'utf8')).toBe('hello-apply')
      }
      expect(
        (
          await applySyncedFileWrite({
            root,
            relPath: '.hidden',
            content: 'x',
          })
        ).kind,
      ).toBe('skipped')
      expect(
        (
          await applySyncedFileWrite({
            root,
            relPath: '../escape.txt',
            content: 'x',
          })
        ).kind,
      ).toBe('error')

      const dl = await downloadAndApplySyncedFile({
        root,
        relPath: 'from-remote.txt',
        get: async () => ({
          ok: true,
          status: 200,
          data: {
            content: Buffer.from('remote-body').toString('base64'),
            content_sha256: 'r',
          },
        }),
      })
      expect(dl.kind).toBe('ok')
      if (dl.kind === 'ok') {
        const { readFile } = await import('node:fs/promises')
        expect(await readFile(dl.absPath, 'utf8')).toBe('remote-body')
      }
      const missing = await downloadAndApplySyncedFile({
        root,
        relPath: 'nope.txt',
        get: async () => ({ ok: true, status: 404 }),
      })
      expect(missing).toEqual({ kind: 'not_found' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('pushSyncedFile treats 409 as conflict densable', async () => {
    const conflict = await pushSyncedFile({
      relPath: 'c.txt',
      content: 'c',
      put: async () => ({
        ok: false,
        status: 409,
        reason: 'conflict',
      }),
    })
    expect(conflict).toEqual({ kind: 'conflict' })
  })

  test('startSyncedFileSyncer optional put transport densable', async () => {
    const root = join(
      tmpdir(),
      `cc-synced-put-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await mkdir(root, { recursive: true })
    try {
      await writeFile(join(root, 'push-me.txt'), 'payload')
      const puts: string[] = []
      const handle = await startSyncedFileSyncer(root, {
        put: async body => {
          puts.push(body.path)
          return {
            ok: true,
            status: 200,
            data: { content_sha256: 'etag-push' },
          }
        },
      })
      expect(handle).not.toBeNull()
      await handle!.initialReconcile
      expect(puts).toContain('working/push-me.txt')
      expect(handle!.getSeenState().has('push-me.txt')).toBe(true)
      handle!.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
