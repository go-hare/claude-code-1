/**
 * densable 2.1.247 — TCt / uXo leftovers: T4n, $4n/x4n, cXo, wXo/vXo,
 * U4n/B4n, JS/eo, He/nI, Bc. Skip $e / Zn Ie/cn / j() / J3c / pn.
 */
import { describe, expect, test } from 'bun:test'
import { constants } from 'fs'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getPlatform } from '../../platform.js'
import { clipSeedGitError } from '../seedDisplay.js'
import { probeSeedGitLayout, storeStamps } from '../seedGitLayout.js'
import {
  bundleHeadsRefuse,
  commitHasParent,
  configListsPartialClone,
  formatSeedRelabelFail,
  gitSupportsPartialCloneBundle,
  makePrivateBundleFile,
  parseGitVersion,
  readSeedBundleFile,
  readShallowOids,
  relabelSeedBundle,
  reviewBundleHeads,
  SEED_PARTIAL_CLONE_OLD_GIT,
  SEED_SHALLOW_NOTE,
  SEED_STAMP_DRIFT_ERROR,
  seedBundleTmpDir,
  seedGitHe,
  seedGitNI,
  seedLayoutStampOk,
  washSeedStderr,
} from '../seedGitBundleUxo.js'

describe('densable T4n / $4n / wXo / vXo / U4n / JS', () => {
  test('ro/Z4n: CLAUDE_CODE_TMPDIR wins; macos ignores TMPDIR', () => {
    expect(seedBundleTmpDir({ CLAUDE_CODE_TMPDIR: 'D:\\seed-tmp' })).toBe(
      'D:\\seed-tmp',
    )
    if (getPlatform() === 'windows') {
      expect(seedBundleTmpDir({ TEMP: 'C:\\Temp', TMP: 'C:\\Tmp' })).toBe(
        'C:\\Temp',
      )
    }
    if (getPlatform() === 'macos') {
      expect(seedBundleTmpDir({ TMPDIR: '/var/folders/x' })).toBe('/tmp')
    }
  })

  test('T4n makes prefix- dir + out.bundle and dispose removes it', async () => {
    const made = await makePrivateBundleFile('claude-seed', seedBundleTmpDir())
    expect(made.path.replaceAll('\\', '/')).toMatch(
      /claude-seed-.*\/out\.bundle$/,
    )
    await writeFile(made.path, 'bundle')
    expect(await readFile(made.path, 'utf8')).toBe('bundle')
    await made.dispose()
    await expect(readFile(made.path)).rejects.toThrow()
  })

  test('Y4n / vXo / kXo git version gate', () => {
    expect(parseGitVersion('git version 2.45.1')).toEqual({
      major: 2,
      minor: 45,
      patch: 1,
    })
    expect(gitSupportsPartialCloneBundle('git version 2.45.0')).toBe(true)
    expect(gitSupportsPartialCloneBundle('git version 2.39.4')).toBe(true)
    expect(gitSupportsPartialCloneBundle('git version 2.39.3')).toBe(false)
    expect(gitSupportsPartialCloneBundle('git version 2.44.1')).toBe(true)
    expect(gitSupportsPartialCloneBundle('git version 2.44.0')).toBe(false)
    expect(gitSupportsPartialCloneBundle('git version 3.0.0')).toBe(true)
    expect(gitSupportsPartialCloneBundle('git version 1.9.0')).toBe(false)
    expect(gitSupportsPartialCloneBundle('not a version')).toBe(false)
  })

  test('lYn treats list fail keys as partial clone', () => {
    expect(configListsPartialClone('extensions.partialclone\norigin\0')).toBe(
      true,
    )
    expect(
      configListsPartialClone('remote.origin.partialclonefilter\nblob:none\0'),
    ).toBe(true)
    expect(configListsPartialClone('remote.origin.promisor\ntrue\0')).toBe(true)
    expect(configListsPartialClone('remote.origin.promisor\nfalse\0')).toBe(
      false,
    )
    expect(configListsPartialClone('core.bare\nfalse\0')).toBe(false)
  })

  test('aXo parent line; $4n relabels this-run stash to nQ', async () => {
    expect(commitHasParent('tree abc\nparent def\n\nmsg\n')).toBe(true)
    expect(commitHasParent('tree abc\n\nmsg\n')).toBe(false)
    const dir = await mkdtemp(join(tmpdir(), 'seed-relabel-'))
    const src = join(dir, 'in.bundle')
    const dest = join(dir, 'out.bundle')
    const oid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const stash = 'refs/seed/1-0123456789abcdef/stash'
    await writeFile(
      src,
      `# v2 git bundle\n${oid} ${stash}\n${oid} refs/heads/main\n\nPACK`,
    )
    const copied = await relabelSeedBundle(
      src,
      dest,
      new Map([[stash, 'refs/seed/stash']]),
    )
    expect(copied.ok).toBe(true)
    if (copied.ok) {
      expect(await readFile(dest, 'utf8')).toBe(
        `# v2 git bundle\n${oid} refs/seed/stash\n${oid} refs/heads/main\n\nPACK`,
      )
    }
    await rm(dir, { recursive: true, force: true })
  })

  test('B4n / _Xo / j4n refuse copy + L4n', () => {
    expect(
      bundleHeadsRefuse({
        missing: [],
        foreign: [],
        unlisted: 'exit 128',
      })?.failReason,
    ).toBe('git_error')
    expect(
      bundleHeadsRefuse({
        missing: ['refs/seed/stash'],
        foreign: [],
      })?.error,
    ).toContain('left out or altered')
    expect(
      bundleHeadsRefuse({
        missing: [],
        foreign: ['refs/heads/other'],
      })?.failReason,
    ).toBe('git_dir_tampered')
    expect(
      bundleHeadsRefuse({
        missing: [],
        foreign: [],
        notHeld: ['HEAD'],
      })?.error,
    ).toContain('object store does not hold')
    expect(formatSeedRelabelFail('disk full')).toContain(
      'second copy of the bundle',
    )
    expect(SEED_PARTIAL_CLONE_OLD_GIT).toContain('partial clone')
    expect(SEED_STAMP_DRIFT_ERROR).toContain(
      'git directory changed while the upload was being prepared',
    )
    expect(SEED_SHALLOW_NOTE.unborn_cut).toContain('git fetch --unshallow')
  })

  test('He/nI: JVb = O_RDONLY|KVb; windows KVb=0', () => {
    if (getPlatform() === 'windows') {
      expect(seedGitNI()).toBe(0)
      expect(seedGitHe()).toBe(constants.O_RDONLY)
    } else {
      expect(seedGitNI()).toBe(constants.O_NOFOLLOW | constants.O_NONBLOCK)
      expect(seedGitHe()).toBe(
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
    }
  })

  test('Bc first-line wash; $I stays clip not Bc', () => {
    expect(washSeedStderr('fatal: x\nwarning: y\n')).toBe('fatal: x')
    expect(washSeedStderr('one line')).toBe('one line')
    expect(washSeedStderr('')).toBe('')
    expect(
      reviewBundleHeads(
        { code: 128, stdout: '', stderr: 'fatal: x\nwarning: y\n' },
        ['HEAD'],
        {},
      ).unlisted,
    ).toBe('fatal: x')
    expect(
      reviewBundleHeads(
        { code: 128, stdout: '', stderr: '   \n' },
        ['HEAD'],
        {},
      ).unlisted,
    ).toBe('exit 128')
    const raw = `${'a'.repeat(210)}\u0001`
    expect(clipSeedGitError(raw, false)).toBe(raw.slice(0, 200))
  })

  test('U4n missing vs expected oid; foreign vs shown', () => {
    const listed = {
      code: 0,
      stdout: 'aaa refs/seed/stash\nbbb HEAD\n',
      stderr: '',
    }
    expect(
      reviewBundleHeads(listed, ['refs/seed/stash', 'HEAD'], {
        'refs/seed/stash': 'aaa',
      }).missing,
    ).toEqual([])
    expect(
      reviewBundleHeads(listed, ['refs/seed/stash'], {
        'refs/seed/stash': 'zzz',
      }).missing,
    ).toEqual(['refs/seed/stash'])
    expect(
      reviewBundleHeads(
        listed,
        ['HEAD'],
        { HEAD: 'bbb' },
        new Map([['HEAD', 'bbb']]),
      ).foreign,
    ).toEqual(['refs/seed/stash'])
  })

  test('JS/eo accepts this checkout; We/Ue commonDir match', async () => {
    const probed = await probeSeedGitLayout(process.cwd())
    if (probed.kind !== 'read') return
    expect(
      await seedLayoutStampOk(probed.layout, [
        'refs/seed/1-0123456789abcdef/stash',
      ]),
    ).toBe(true)
    expect(
      await seedLayoutStampOk(
        { ...probed.layout, commonDir: join(probed.layout.gitDir, 'nope') },
        [],
      ),
    ).toBe(false)
    expect(probed.layout.storeStamps).toBeDefined()
    expect(probed.layout.storeStamps).toEqual(
      await storeStamps(probed.layout.commonDir),
    )
    expect(
      await seedLayoutStampOk(
        {
          ...probed.layout,
          storeStamps: {
            info: 'x',
            pack: 'x',
            alternates: 'x',
            httpAlternates: 'x',
          },
        },
        [],
      ),
    ).toBe(false)
  })

  test('$I clips hardened via bp($l) and legacy via slice', () => {
    const raw = `${'a'.repeat(210)}\u0001`
    expect(clipSeedGitError(raw, false)).toBe(raw.slice(0, 200))
    expect(clipSeedGitError('short', true)).toBe('short')
    expect(clipSeedGitError(raw, true)).toContain('… [+')
    expect(clipSeedGitError(raw, true)).not.toContain('\u0001')
  })

  test('E4n reads a single file and refuses oversize', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seed-e4n-'))
    const path = join(dir, 'out.bundle')
    await writeFile(path, 'bundle-bytes')
    const read = await readSeedBundleFile(path, 100)
    expect(read.kind).toBe('read')
    if (read.kind === 'read') {
      expect(read.content.toString()).toBe('bundle-bytes')
    }
    expect((await readSeedBundleFile(path, 3)).kind).toBe('too_large')
    if (getPlatform() !== 'windows') {
      const link = join(dir, 'link.bundle')
      await symlink(path, link)
      expect((await readSeedBundleFile(link, 100)).kind).toBe('unreadable')
    }
    await rm(dir, { recursive: true, force: true })
  })

  test('iXo reads oid lines and refuses junk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seed-ixo-'))
    const path = join(dir, 'shallow')
    const oid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    await writeFile(path, `${oid}\n`)
    expect(await readShallowOids(path)).toEqual([oid])
    await writeFile(path, 'not-an-oid\n')
    expect(await readShallowOids(path)).toBeNull()
    await rm(dir, { recursive: true, force: true })
  })

  test('gitBundle host wires T4n/$4n/cXo/wXo/U4n/JS', async () => {
    const src = await Bun.file(
      new URL('../gitBundle.ts', import.meta.url),
    ).text()
    expect(src).toContain('makePrivateBundleFile')
    expect(src).toContain("'claude-seed'")
    expect(src).toContain('seedBundleTmpDir()')
    expect(src).toContain("generateTempFilePath('ccr-seed', '.bundle')")
    expect(src).toContain('relabelSeedBundle')
    expect(src).toContain('refs/seed/stash')
    expect(src).toContain("'bundle', 'list-heads'")
    expect(src).toContain('classifySeedShallow')
    expect(src).toContain("config', '-z', '--list'")
    expect(src).toContain('gitSupportsPartialCloneBundle')
    expect(src).toContain('SEED_PARTIAL_CLONE_OLD_GIT')
    expect(src).toContain('reviewBundleHeads')
    expect(src).toContain('bundleHeadsRefuse')
    expect(src).toContain("'cat-file', '--batch-check'")
    expect(src).toContain('seedLayoutStampOk')
    expect(src).toContain('SEED_STAMP_DRIFT_ERROR')
    expect(src.indexOf('seedLayoutStampOk(gated')).toBeLessThan(
      src.indexOf("config', '-z', '--list'"),
    )
    expect(src.indexOf("config', '-z', '--list'")).toBeLessThan(
      src.indexOf('refuseSeedSteerEnv(seedLayout)'),
    )
    expect(src).toContain("shallow === 'complete' || shallow === 'cut'")
    expect(src).toContain('readSeedBundleFile')
    expect(src).toContain('The bundle could not be read back for upload')
    expect(src).toContain('resolveHardenedHeadTree')
    expect(src).toContain('HEAD names no commit')
    expect(src).toContain('clipSeedGitError')
    expect(src).toContain("failReason: 'unsupported_layout'")
    expect(src).toContain("layoutKind: 'partial_clone_old_git'")
  })

  test('gold + source lock He/nI JVb and Bc Pzd', async () => {
    const he = await Bun.file(
      new URL(
        '../../../../docs/upstream-extraction/v2.1.247/snippets/gold-forged-He-nI.txt',
        import.meta.url,
      ),
    ).text()
    expect(he).toContain('function m(){return o.O_RDONLY|d()}')
    expect(he).toContain(
      'function d(){if(i()==="windows")return 0;return o.O_NOFOLLOW|o.O_NONBLOCK}',
    )
    expect(he).toContain('m as JVb,d as KVb')
    expect(he).toContain('JVb as nI')
    expect(he).toContain('$3o(e,nI())')
    expect(he).toContain('Z3o(e,nI())')
    const bc = await Bun.file(
      new URL(
        '../../../../docs/upstream-extraction/v2.1.247/snippets/gold-forged-Bc.txt',
        import.meta.url,
      ),
    ).text()
    expect(bc).toContain(
      'function C(t,n){let e=t.indexOf(n);return e===-1?t:t.slice(0,e)}',
    )
    expect(bc).toContain('function R(t){return C(t,')
    expect(bc).toContain('Pzd as Bc')
    expect(bc).toContain('unlisted:Bc(s.stderr.trim())')
    expect(bc).toContain('bp($l(Bc(T.detail)),yCt)')
    const src = await Bun.file(
      new URL('../seedGitBundleUxo.ts', import.meta.url),
    ).text()
    expect(src).toContain('open(path, seedGitHe())')
    expect(src).toContain('washSeedStderr(listed.stderr.trim())')
    expect(src).not.toContain("open(path, 'r')")
  })
})
