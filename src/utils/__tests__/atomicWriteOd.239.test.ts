/**
 * densable 2.1.239 od / KGo — default arm, in-place, snapshot, exactMode/flush.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { closeSync, ftruncateSync, openSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  annotateAtomicWriteError,
  ATOMIC_WRITE_SNAPSHOT_MAX_BYTES,
  KGo,
  od,
  restoreAtomicWriteSnapshot,
  snapshotAtomicWriteTarget,
} from '../atomicWriteOd.js'

const tmpDirs: string[] = []

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kgo-239-'))
  tmpDirs.push(dir)
  return dir
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code })
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

describe('densable 2.1.239 od / KGo', () => {
  test('od default arm writes via FDn wx + kw rename (no leftover tmp)', async () => {
    const dir = await scratch()
    const target = join(dir, 'key')
    await od(target, '{"peerToken":"ab"}', 0o600)
    expect(await readFile(target, 'utf8')).toBe('{"peerToken":"ab"}')
    expect(await readdir(dir)).toEqual(['key'])
    expect((await stat(target)).mode & 0o400).toBe(0o400)
  })

  test('KGo in-place truncate when rename hits AZ EXDEV', async () => {
    const dir = await scratch()
    const target = join(dir, 'key')
    await writeFile(target, 'OLD')
    await KGo(target, 'NEW', {
      mode: 0o600,
      renameFn: async () => {
        throw errno('EXDEV')
      },
    })
    expect(await readFile(target, 'utf8')).toBe('NEW')
    expect(await readdir(dir)).toEqual(['key'])
  })

  test('KGo in-place when rename hits AZ EPERM', async () => {
    const dir = await scratch()
    const target = join(dir, 'key')
    await writeFile(target, 'OLD')
    await KGo(target, 'NEW', {
      mode: 0o600,
      renameFn: async () => {
        throw errno('EPERM')
      },
    })
    expect(await readFile(target, 'utf8')).toBe('NEW')
    expect(await readdir(dir)).toEqual(['key'])
  })

  test('KGo does not in-place when rename is EACCES (not AZ)', async () => {
    const dir = await scratch()
    const target = join(dir, 'key')
    await writeFile(target, 'OLD')
    await expect(
      KGo(target, 'NEW', {
        mode: 0o600,
        renameFn: async () => {
          throw errno('EACCES')
        },
      }),
    ).rejects.toMatchObject({ code: 'EACCES' })
    expect(await readFile(target, 'utf8')).toBe('OLD')
    expect(await readdir(dir)).toEqual(['key'])
  })

  test('KGo refuses in-place on a directory target (ENXIO)', async () => {
    const dir = await scratch()
    const target = join(dir, 'key')
    await mkdir(target)
    await expect(
      KGo(target, 'NEW', {
        mode: 0o600,
        renameFn: async () => {
          throw errno('EXDEV')
        },
      }),
    ).rejects.toMatchObject({
      code: 'ENXIO',
      message: 'refusing the in-place arm on a non-regular target',
    })
    expect((await stat(target)).isDirectory()).toBe(true)
    expect((await readdir(dir)).filter(name => name.includes('.tmp.'))).toEqual(
      [],
    )
  })

  test('KGo exactMode arm writes then renames', async () => {
    const dir = await scratch()
    const target = join(dir, 'key')
    await KGo(target, 'EXACT', { exactMode: 0o640 })
    expect(await readFile(target, 'utf8')).toBe('EXACT')
    expect(await readdir(dir)).toEqual(['key'])
    if (process.platform !== 'win32') {
      expect((await stat(target)).mode & 0o777).toBe(0o640)
    }
  })

  test('KGo flush arm fsyncs staging then renames', async () => {
    const dir = await scratch()
    const target = join(dir, 'key')
    await KGo(target, 'FLUSH', { mode: 0o600, flush: true })
    expect(await readFile(target, 'utf8')).toBe('FLUSH')
    expect(await readdir(dir)).toEqual(['key'])
  })

  test('KGo restores the TY_ snapshot when in-place write fails after truncate', async () => {
    const dir = await scratch()
    const target = join(dir, 'key')
    await writeFile(target, 'ORIGINAL')
    const probe = await open(target, 'r')
    const proto = Object.getPrototypeOf(probe) as {
      writeFile: (...args: unknown[]) => Promise<unknown>
    }
    await probe.close()
    const orig = proto.writeFile
    proto.writeFile = async function patchedWriteFile(
      this: unknown,
      data: unknown,
      ...rest: unknown[]
    ) {
      if (data === 'NEW') {
        throw errno('EIO')
      }
      return orig.call(this, data, ...rest)
    }
    try {
      const err = await KGo(target, 'NEW', {
        mode: 0o600,
        renameFn: async () => {
          throw errno('EXDEV')
        },
      }).then(
        () => null,
        e => e as Error & { targetOutcome?: string; preservedTmp?: string },
      )
      expect(err).toBeTruthy()
      expect(err!.targetOutcome).toBe('restored')
      expect(err!.message).toContain('original target restored')
      expect(err!.preservedTmp).toMatch(/\.tmp\.[0-9a-f]{8}$/)
      expect(await readFile(target, 'utf8')).toBe('ORIGINAL')
      expect(await readFile(err!.preservedTmp!, 'utf8')).toBe('NEW')
    } finally {
      proto.writeFile = orig
    }
  })

  test('TY_ snapshots a regular file and kY_ restores it', async () => {
    const dir = await scratch()
    const target = join(dir, 'key')
    await writeFile(target, 'ORIGINAL', { mode: 0o600 })
    const snap = await snapshotAtomicWriteTarget(target)
    expect(snap.kind).toBe('snapshot')
    if (snap.kind !== 'snapshot') return
    expect(Buffer.from(snap.bytes).toString('utf8')).toBe('ORIGINAL')
    await writeFile(target, 'TORN')
    expect(await restoreAtomicWriteSnapshot(target, snap)).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('ORIGINAL')
  })

  test('TY_ absent when the target is missing', async () => {
    const dir = await scratch()
    expect(await snapshotAtomicWriteTarget(join(dir, 'missing'))).toEqual({
      kind: 'absent',
    })
  })

  test('TY_ unavailable for a directory', async () => {
    const dir = await scratch()
    expect(await snapshotAtomicWriteTarget(dir)).toEqual({
      kind: 'unavailable',
    })
  })

  test('TY_ unavailable when the file is larger than o5u', async () => {
    const dir = await scratch()
    const target = join(dir, 'big')
    const fd = openSync(target, 'w')
    try {
      ftruncateSync(fd, ATOMIC_WRITE_SNAPSHOT_MAX_BYTES + 1)
    } finally {
      closeSync(fd)
    }
    expect(await snapshotAtomicWriteTarget(target)).toEqual({
      kind: 'unavailable',
    })
  })

  test('Jer annotates restored / partial / preservedTmp', () => {
    const restored = annotateAtomicWriteError(
      new Error('EIO'),
      '/tmp/a.tmp.deadbeef',
      'restored',
    ) as Error & { preservedTmp?: string; targetOutcome?: string }
    expect(restored.message).toBe(
      'EIO; new contents preserved at /tmp/a.tmp.deadbeef; original target restored',
    )
    expect(restored.preservedTmp).toBe('/tmp/a.tmp.deadbeef')
    expect(restored.targetOutcome).toBe('restored')

    const partial = annotateAtomicWriteError(
      new Error('ENOSPC'),
      undefined,
      'partial',
    ) as Error & { preservedTmp?: string; targetOutcome?: string }
    expect(partial.message).toBe(
      'ENOSPC; target left partial — treat contents as torn',
    )
    expect(partial.preservedTmp).toBeUndefined()
    expect(partial.targetOutcome).toBe('partial')
  })

  if (process.platform !== 'win32') {
    test('inPlaceOnTempCreateRefused writes the existing target after EACCES staging', async () => {
      const dir = await scratch()
      const target = join(dir, 'key')
      await writeFile(target, 'OLD', { mode: 0o600 })
      await chmod(dir, 0o500)
      try {
        await KGo(target, 'NEW', {
          mode: 0o600,
          inPlaceOnTempCreateRefused: true,
        })
        expect(await readFile(target, 'utf8')).toBe('NEW')
      } finally {
        await chmod(dir, 0o700)
      }
    })
  }
})
