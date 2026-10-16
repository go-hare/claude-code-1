/**
 * densable He write lane / w5 / DLe / Lp (2.1.289) — artifact save stash and
 * pinned write.
 */
// outDirPaths → filesystem → … → restApis → outDirPaths cycles unless the
// permissions module is loaded first, as it is in the running CLI.
import 'src/utils/permissions/filesystem.js'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, realpathSync } from 'fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getPathsForPermissionCheck } from 'src/utils/fsOperations.js'
import { getBootstrapSession } from 'src/utils/sessionRoot.js'
import {
  ARTIFACT_WRITE_STASH_EVICTED,
  ArtifactSaveWriteError,
  artifactWritePermissionStash,
  PartialKeptError,
  renameIntoPlace,
  writeThroughApprovedPin,
} from '../readPerm/writeStash.js'

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

const roots: string[] = []

afterEach(async () => {
  const stash = getBootstrapSession().writePermissionStash
  stash.pathsByToolUse.clear()
  stash.evicted.clear()
  stash.poisoned = false
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function tmp(): Promise<string> {
  const d = realpathSync(await mkdtemp(join(tmpdir(), 'artifact-ws-')))
  roots.push(d)
  return d
}

describe('artifactWritePermissionStash (densable He write lane)', () => {
  test('stash then consume returns spellings and clears the toolUseId', () => {
    const s = artifactWritePermissionStash
    s.stash('tu1', '/a/x', ['/a/x', '/b/x'])
    s.stash('tu1', '/a/y', ['/a/y'])
    expect(s.holds('tu1', '/a/x')).toBe(true)
    expect(s.consume('tu1', '/a/x')).toEqual(['/a/x', '/b/x'])
    expect(s.holds('tu1', '/a/y')).toBe(false)
    expect(s.consume('tu1', '/a/y')).toBeUndefined()
  })

  test('re-stash keeps the intersection', () => {
    const s = artifactWritePermissionStash
    s.stash('tu2', '/d', ['/d', '/e', '/f'])
    s.stash('tu2', '/d', ['/f', '/d'])
    expect(s.consume('tu2', '/d')).toEqual(['/d', '/f'])
  })

  test('undefined toolUseId neither stashes nor holds', () => {
    const s = artifactWritePermissionStash
    s.stash(undefined, '/d', ['/d'])
    expect(s.holds(undefined, '/d')).toBe(false)
    expect(s.consume(undefined, '/d')).toBeUndefined()
  })

  test('evicted entry consumes as GGe', () => {
    const s = artifactWritePermissionStash
    for (let i = 0; i <= 256; i++) s.stash(`t${i}`, '/p', ['/p'])
    expect(s.holds('t0', '/p')).toBe(false)
    expect(s.consume('t0', '/p')).toBe(ARTIFACT_WRITE_STASH_EVICTED)
  })

  test('shares the session store FileWrite stashes into', () => {
    getBootstrapSession().writePermissionStash.stash('tu3', '/q', ['/q'])
    expect(artifactWritePermissionStash.holds('tu3', '/q')).toBe(true)
  })
})

describe('renameIntoPlace (densable DLe)', () => {
  test('plain rename', async () => {
    const d = await tmp()
    await writeFile(join(d, 'a.tmp'), 'x')
    await renameIntoPlace(join(d, 'a.tmp'), join(d, 'a'))
    expect(await readFile(join(d, 'a'), 'utf8')).toBe('x')
  })

  test('AA error unlinks dest and retries once', async () => {
    const d = await tmp()
    await writeFile(join(d, 'dest'), 'old')
    const calls: string[] = []
    await renameIntoPlace('/staged', join(d, 'dest'), async (from, to) => {
      calls.push(`${from}->${to}`)
      if (calls.length === 1) throw errno('EXDEV')
    })
    expect(calls).toHaveLength(2)
    expect(existsSync(join(d, 'dest'))).toBe(false)
  })

  test('failed retry keeps the staged bytes, removedEarlier tracks unlink', async () => {
    const d = await tmp()
    await writeFile(join(d, 'dest'), 'old')
    const fail = async (): Promise<void> => {
      throw errno('EBUSY')
    }
    const removed = await renameIntoPlace('/s', join(d, 'dest'), fail).catch(
      e => e,
    )
    expect(removed).toBeInstanceOf(PartialKeptError)
    expect(removed.partial).toBe('/s')
    expect(removed.removedEarlier).toBe(true)
    const absent = await renameIntoPlace('/s', join(d, 'none'), fail).catch(
      e => e,
    )
    expect(absent).toBeInstanceOf(PartialKeptError)
    expect(absent.removedEarlier).toBe(false)
  })

  test('non-AA error rethrows without unlinking', async () => {
    const d = await tmp()
    await writeFile(join(d, 'dest'), 'old')
    const err = await renameIntoPlace('/s', join(d, 'dest'), async () => {
      throw errno('ENOSPC')
    }).catch(e => e)
    expect(err.code).toBe('ENOSPC')
    expect(await readFile(join(d, 'dest'), 'utf8')).toBe('old')
  })
})

describe('writeThroughApprovedPin (densable Lp / read_asset write)', () => {
  test('read_file save creates parents and lands the bytes', async () => {
    const d = await tmp()
    const dest = join(d, 'out', 'nested', 'f.txt')
    await writeThroughApprovedPin({
      kind: 'file',
      pinPath: dest,
      dest,
      bytes: Buffer.from('hello'),
      spellings: [dest],
    })
    expect(await readFile(dest, 'utf8')).toBe('hello')
    expect(await readdir(join(d, 'out', 'nested'))).toEqual(['f.txt'])
  })

  test('replaces an existing file', async () => {
    const d = await tmp()
    const dest = join(d, 'f.txt')
    await writeFile(dest, 'old')
    await writeThroughApprovedPin({
      kind: 'file',
      pinPath: dest,
      dest,
      bytes: Buffer.from('new'),
      spellings: [dest],
    })
    expect(await readFile(dest, 'utf8')).toBe('new')
  })

  test('Ia-style spellings through a symlinked tmpdir are accepted', async () => {
    const raw = await mkdtemp(join(tmpdir(), 'artifact-ws-raw-'))
    roots.push(raw)
    const dest = join(raw, 'sub', 'g.txt')
    await writeThroughApprovedPin({
      kind: 'file',
      pinPath: dest,
      dest,
      bytes: Buffer.from('ok'),
      spellings: getPathsForPermissionCheck(dest),
    })
    expect(await readFile(dest, 'utf8')).toBe('ok')
  })

  test('read_asset pins the stem and writes stem+ext beside it', async () => {
    const d = await tmp()
    const stem = join(d, 'assets', '0123456789abcdef0123456789abcdef')
    const dest = `${stem}.png`
    await writeThroughApprovedPin({
      kind: 'asset',
      pinPath: stem,
      dest,
      bytes: Buffer.from([1, 2, 3]),
      spellings: [stem],
    })
    expect([...(await readFile(dest))]).toEqual([1, 2, 3])
    expect(existsSync(stem)).toBe(false)
  })

  test('unapproved destination is write_moved and leaves nothing', async () => {
    const d = await tmp()
    const dest = join(d, 'f.txt')
    for (const kind of ['file', 'asset'] as const) {
      const err = await writeThroughApprovedPin({
        kind,
        pinPath: dest,
        dest,
        bytes: Buffer.from('x'),
        spellings: [join(d, 'elsewhere.txt')],
      }).catch(e => e)
      expect(err).toBeInstanceOf(ArtifactSaveWriteError)
      expect(err.outcome).toBe('write_moved')
      expect(err.code).toBe(
        kind === 'file' ? 'file_read_write_moved' : 'asset_read_write_moved',
      )
      expect(err.message).toBe(
        kind === 'file'
          ? 'out_dir no longer resolves where it did when the save was approved \u2014 the file was fetched but not saved; retry so it is checked again'
          : 'the destination folder no longer resolves where it did when the save was approved \u2014 the asset was fetched but not saved; retry so it is checked again',
      )
    }
    expect(await readdir(d)).toEqual([])
  })

  test('rename failure keeps the staged bytes (write_kept)', async () => {
    const d = await tmp()
    const dest = join(d, 'f.txt')
    await writeFile(dest, 'old')
    const err = await writeThroughApprovedPin({
      kind: 'file',
      pinPath: dest,
      dest,
      bytes: Buffer.from('new'),
      spellings: [dest],
      renameFn: async () => {
        throw errno('EPERM')
      },
    }).catch(e => e)
    expect(err).toBeInstanceOf(ArtifactSaveWriteError)
    expect(err.code).toBe('file_read_write_kept')
    const kept = (await readdir(d)).filter(n => n.startsWith('f.txt.tmp.'))
    expect(kept).toHaveLength(1)
    expect(await readFile(join(d, kept[0] as string), 'utf8')).toBe('new')
    expect(err.message).toBe(
      `the earlier copy at f.txt was removed but the fetched file could not be moved into its place (EPERM) \u2014 the bytes are kept at ${join(d, kept[0] as string)}; move or delete that file`,
    )
  })

  test('non-AA rename failure cleans the staged file (write_error)', async () => {
    const d = await tmp()
    const dest = join(d, 'f.txt')
    const err = await writeThroughApprovedPin({
      kind: 'asset',
      pinPath: dest,
      dest,
      bytes: Buffer.from('x'),
      spellings: [dest],
      renameFn: async () => {
        throw errno('ENOSPC')
      },
    }).catch(e => e)
    expect(err.code).toBe('asset_read_write_error')
    expect(err.message).toBe(
      'the asset was fetched but could not be saved (ENOSPC)',
    )
    expect(await readdir(d)).toEqual([])
  })
})
