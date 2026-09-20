/**
 * densable 2.1.247 #11 — LZ spares a denyWrite settings.json symlink
 * whose hops sit outside every sandbox write root.
 * Gold: gold-11-unk-247-LZ.txt / gold-11-unk-fn-247-Zt-210375224.txt
 */
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getPlatform } from '../../platform.js'
import { detectWorktreeMainRepoPath } from '../sandbox-adapter.js'
import {
  getStagingDirIdentity,
  recordStagingDirIdentity,
  resetStagingDirIdentities,
} from '../wrapPreflight.js'
import {
  clearSymlinkedDenyLists,
  getDenyLiteralSymlinkCandidates,
  getSymlinkedDenyScrubPaths,
  hopsIntersectWriteRoots,
  hopSetsEqual,
  promoteDenyLiteralSymlinkTargets,
  recordSymlinkedDenyPath,
  resetSymlinkedDenyScrubState,
  scrubSymlinkedDenyPaths,
} from '../symlinkedDenyScrub.js'

function canSymlink(dir: string): boolean {
  const target = join(dir, 't')
  const link = join(dir, 'l')
  try {
    writeFileSync(target, 'x')
    symlinkSync(target, link)
    return readlinkSync(link).length > 0
  } catch {
    return false
  }
}

describe('densable 2.1.247 #11 LZ settings-symlink scrub', () => {
  const prevSandbox = process.env.IS_SANDBOX
  let root: string

  beforeEach(() => {
    delete process.env.IS_SANDBOX
    resetSymlinkedDenyScrubState()
    root = join(
      tmpdir(),
      `sbx-set-247-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    if (prevSandbox === undefined) delete process.env.IS_SANDBOX
    else process.env.IS_SANDBOX = prevSandbox
    resetSymlinkedDenyScrubState()
    rmSync(root, { recursive: true, force: true })
  })

  test('pv: null hops intersect (do not spare)', () => {
    expect(hopsIntersectWriteRoots(null, ['/tmp'])).toBe(true)
    expect(hopsIntersectWriteRoots(['/nix/store/a'], null)).toBe(true)
  })

  test('pv: hops outside write roots do not intersect', () => {
    expect(
      hopsIntersectWriteRoots(
        ['/nix/store/abc', '/nix/store'],
        ['/home/u/proj'],
      ),
    ).toBe(false)
  })

  test('pv: hop under write root intersects', () => {
    expect(
      hopsIntersectWriteRoots(['/home/u/proj/.claude'], ['/home/u/proj']),
    ).toBe(true)
  })

  test('$Z hop-set equality', () => {
    expect(hopSetsEqual(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(hopSetsEqual(['a'], ['a', 'b'])).toBe(false)
    expect(hopSetsEqual(null, ['a'])).toBe(false)
  })

  test('Zt records a regular file as a literal candidate, not a scrub entry', () => {
    const file = join(root, 'settings.json')
    writeFileSync(file, '{}')
    expect(recordSymlinkedDenyPath(file)).toBe(file)
    expect(getSymlinkedDenyScrubPaths()).toEqual([])
  })

  test('LZ no-ops on an empty scrub list', () => {
    clearSymlinkedDenyLists()
    scrubSymlinkedDenyPaths({
      getConfig: () => ({
        filesystem: { allowWrite: ['.'], denyWrite: [] },
      }),
      updateConfig: () => {
        throw new Error('should not update')
      },
    })
  })

  test('Zt+LZ keep an unchanged settings.json symlink', () => {
    if (!canSymlink(root)) return
    const outside = join(root, 'nix-store', 'settings.json')
    const link = join(root, '.claude', 'settings.json')
    mkdirSync(join(root, 'nix-store'), { recursive: true })
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(outside, '{"theme":"dark"}')
    symlinkSync(outside, link)

    const resolved = recordSymlinkedDenyPath(link)
    expect(resolved).not.toBe(link)
    expect(getSymlinkedDenyScrubPaths()).toHaveLength(1)
    expect(getSymlinkedDenyScrubPaths()[0]!.literal).toBe(link)
    expect(getSymlinkedDenyScrubPaths()[0]!.danglingBaseline).toBe(false)

    scrubSymlinkedDenyPaths({
      getConfig: () => ({
        filesystem: { allowWrite: ['.'], denyWrite: [resolved] },
      }),
      updateConfig: () => {
        throw new Error('unchanged symlink must not update denyWrite')
      },
    })
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(outside)
  })

  test('LZ spares a retarget whose hops stay outside write roots', () => {
    // official bu() returns null on windows; spare arm is unix-only
    if (getPlatform() === 'windows') return
    if (!canSymlink(root)) return
    const first = join(root, 'nix-a', 'settings.json')
    const second = join(root, 'nix-b', 'settings.json')
    const workspace = join(root, 'proj')
    const link = join(root, 'home', '.claude', 'settings.json')
    mkdirSync(join(root, 'nix-a'), { recursive: true })
    mkdirSync(join(root, 'nix-b'), { recursive: true })
    mkdirSync(workspace, { recursive: true })
    mkdirSync(join(root, 'home', '.claude'), { recursive: true })
    writeFileSync(first, '{"a":1}')
    writeFileSync(second, '{"b":2}')
    symlinkSync(first, link)

    recordSymlinkedDenyPath(link)
    rmSync(link)
    symlinkSync(second, link)

    scrubSymlinkedDenyPaths({
      getConfig: () => ({
        filesystem: { allowWrite: [workspace], denyWrite: [] },
      }),
      updateConfig: () => {},
    })
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(second)
  })

  test('LZ removes a plant that replaced the symlink inside a write root', () => {
    // pv()/bu() split hops on '/' — official unix contract. Skip on win32.
    if (process.platform === 'win32') return
    if (!canSymlink(root)) return
    const outside = join(root, 'nix-store', 'settings.json')
    const workspace = join(root, 'proj')
    const link = join(workspace, '.claude', 'settings.json')
    mkdirSync(join(root, 'nix-store'), { recursive: true })
    mkdirSync(join(workspace, '.claude'), { recursive: true })
    writeFileSync(outside, '{"a":1}')
    symlinkSync(outside, link)
    recordSymlinkedDenyPath(link)

    rmSync(link)
    closeSync(openSync(link, 'w'))

    scrubSymlinkedDenyPaths({
      getConfig: () => ({
        filesystem: { allowWrite: [workspace], denyWrite: [] },
      }),
      updateConfig: () => {},
    })
    expect(() => lstatSync(link)).toThrow()
  })

  test('VZ leaves a still-regular-file candidate on the list', () => {
    const file = join(root, 'settings.json')
    writeFileSync(file, '{}')
    expect(recordSymlinkedDenyPath(file)).toBe(file)
    expect(getDenyLiteralSymlinkCandidates()).toEqual([file])
    let updated = false
    promoteDenyLiteralSymlinkTargets({
      getConfig: () => ({
        filesystem: { allowWrite: ['.'], denyWrite: [file] },
      }),
      updateConfig: () => {
        updated = true
      },
    })
    expect(updated).toBe(false)
    expect(getDenyLiteralSymlinkCandidates()).toEqual([file])
  })

  test('VZ promotes a candidate that became a symlink into denyWrite', () => {
    if (!canSymlink(root)) return
    const file = join(root, '.claude', 'settings.json')
    const outside = join(root, 'nix-store', 'settings.json')
    mkdirSync(join(root, '.claude'), { recursive: true })
    mkdirSync(join(root, 'nix-store'), { recursive: true })
    writeFileSync(file, '{}')
    writeFileSync(outside, '{"theme":"dark"}')
    expect(recordSymlinkedDenyPath(file)).toBe(file)
    rmSync(file)
    symlinkSync(outside, file)
    let denyWrite: string[] = []
    promoteDenyLiteralSymlinkTargets({
      getConfig: () => ({
        filesystem: { allowWrite: ['.'], denyWrite: [file] },
      }),
      updateConfig: cfg => {
        denyWrite = cfg.filesystem.denyWrite
      },
    })
    expect(getDenyLiteralSymlinkCandidates()).toEqual([])
    expect(denyWrite).toContain(realpathSync(file))
    expect(denyWrite).toContain(file)
  })

  test('wrapWithSandbox calls fN, pN, VZ, FZ after init', () => {
    const wrapSrc = readFileSync(
      fileURLToPath(new URL('../sandbox-adapter.ts', import.meta.url)),
      'utf8',
    )
    const start = wrapSrc.indexOf('async function wrapWithSandbox')
    const end = wrapSrc.indexOf('async function initialize')
    const wrap = wrapSrc.slice(start, end)
    const fN = wrap.indexOf('ensureBridgeSpawnRootDirForWrap')
    const pN = wrap.indexOf('ensureAtomicWriteStagingDirs')
    const vz = wrap.indexOf('promoteDenyLiteralSymlinkTargets')
    const fz = wrap.indexOf('recordWrapWriteRoots')
    expect(fN).toBeGreaterThan(-1)
    expect(pN).toBeGreaterThan(fN)
    expect(vz).toBeGreaterThan(pN)
    expect(fz).toBeGreaterThan(vz)
  })

  test('windows init calls pN then fN; convert Nu is false', () => {
    const adapterSrc = readFileSync(
      fileURLToPath(new URL('../sandbox-adapter.ts', import.meta.url)),
      'utf8',
    )
    const init = adapterSrc.slice(
      adapterSrc.indexOf('async function initialize'),
    )
    expect(init).toContain("getPlatform() === 'windows'")
    expect(init.indexOf('ensureAtomicWriteStagingDirs()')).toBeLessThan(
      init.indexOf('await ensureBridgeSpawnRootDirForWrap()'),
    )
    expect(adapterSrc).toContain('rememberBuiltConfigAllowlist(config, false)')
    const scrubSrc = readFileSync(
      fileURLToPath(new URL('../symlinkedDenyScrub.ts', import.meta.url)),
      'utf8',
    )
    expect(scrubSrc).toContain('builtConfigEnforcesAllowlist')
    expect(scrubSrc).toContain('applySandboxRuntimeConfig(')
  })

  test('WZ returns the main .git dir, not the repo root', () => {
    const main = join(root, 'main')
    const worktree = join(root, 'wt')
    const mainGit = join(main, '.git')
    const wtGitdir = join(mainGit, 'worktrees', 'wt')
    mkdirSync(wtGitdir, { recursive: true })
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, '.git'), `gitdir: ${wtGitdir}\n`)
    writeFileSync(join(wtGitdir, 'gitdir'), `${join(worktree, '.git')}\n`)
    expect(detectWorktreeMainRepoPath(worktree)).toBe(mainGit)
    expect(detectWorktreeMainRepoPath(worktree)).not.toBe(main)
    mkdirSync(join(root, 'plain', '.git'), { recursive: true })
    expect(detectWorktreeMainRepoPath(join(root, 'plain'))).toBeNull()
  })

  test('WZ Vm rejects a symlink .git pointer file', () => {
    if (!canSymlink(root)) return
    const main = join(root, 'main')
    const worktree = join(root, 'wt')
    const mainGit = join(main, '.git')
    const wtGitdir = join(mainGit, 'worktrees', 'wt')
    mkdirSync(wtGitdir, { recursive: true })
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(root, 'gitfile'), `gitdir: ${wtGitdir}\n`)
    symlinkSync(join(root, 'gitfile'), join(worktree, '.git'))
    writeFileSync(join(wtGitdir, 'gitdir'), `${join(worktree, '.git')}\n`)
    expect(detectWorktreeMainRepoPath(worktree)).toBeNull()
  })

  test('WZ Ji rejects a UNC gitdir pointer', () => {
    const worktree = join(root, 'unc-wt')
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, '.git'), 'gitdir: //evil/share/worktrees/x\n')
    expect(detectWorktreeMainRepoPath(worktree)).toBeNull()
  })

  test('WZ Qi rejects a gitdir hop that is a symlink to UNC', () => {
    if (!canSymlink(root)) return
    const worktree = join(root, 'hop-wt')
    mkdirSync(worktree, { recursive: true })
    symlinkSync('//evil/share', join(worktree, 'hop'))
    writeFileSync(join(worktree, '.git'), 'gitdir: hop/worktrees/x\n')
    expect(detectWorktreeMainRepoPath(worktree)).toBeNull()
  })

  test('Ue record replaces fd and reset closes it', () => {
    const path = join(root, 'stage')
    mkdirSync(path)
    const fd1 = openSync(path, 'r')
    const fd2 = openSync(path, 'r')
    recordStagingDirIdentity(path, 1, 2, fd1)
    expect(getStagingDirIdentity(path)).toEqual({ dev: 1, ino: 2, fd: fd1 })
    recordStagingDirIdentity(path, 3, 4, fd2)
    expect(getStagingDirIdentity(path)).toEqual({ dev: 3, ino: 4, fd: fd2 })
    resetStagingDirIdentities()
    expect(getStagingDirIdentity(path)).toBeUndefined()
  })

  test('pN fires kv / Rt; WZ Qi is xe hop-walk', () => {
    const wrap = readFileSync(
      fileURLToPath(new URL('../wrapPreflight.ts', import.meta.url)),
      'utf8',
    )
    const gitignore = readFileSync(
      fileURLToPath(new URL('../../git/gitignore.ts', import.meta.url)),
      'utf8',
    )
    const wz = readFileSync(
      fileURLToPath(new URL('../sandbox-adapter.ts', import.meta.url)),
      'utf8',
    )
    const pN = wrap.slice(
      wrap.indexOf('export function ensureAtomicWriteStagingDirs'),
    )
    expect(pN).toContain('stagingDirGitignoreFired')
    expect(pN).toContain('addFileGlobRuleToGitignore')
    expect(pN).toContain('`.claude/${CLAUDE_ATOMIC_STAGING_LEAF}/`')
    expect(pN).toContain('getOriginalCwd()')
    expect(pN).toContain('gitignore_global_rule')
    expect(pN).toContain('recordStagingDirIdentity')
    expect(wrap).toContain('export function recordStagingDirIdentity')
    expect(gitignore).toContain(
      'export async function addFileGlobRuleToGitignore',
    )
    expect(gitignore).toContain('git config')
    expect(gitignore).toContain('core.excludesfile')
    expect(gitignore).toContain('ls-files')
    expect(gitignore).toContain('already_tracked')
    expect(wz).toContain('isWorktreePathNetworkRelativeToCwd')
    expect(wz).toContain('worktreeGitAdminKindUnsafe')
    expect(wz).toContain('gitdirPointerHopUnsafe')
    expect(wz).toContain('gitAdminHopUnsafe')
  })
})
