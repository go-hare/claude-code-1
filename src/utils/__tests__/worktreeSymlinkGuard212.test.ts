/**
 * densable 2.1.212 #8:
 * worktree create must not follow a repository-committed symlink at
 * `.claude`, `.claude/worktrees`, or the target path.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  assertWorktreeCreateContainment,
  assertWorktreeCreatePathsNotSymlinked,
} from '../worktree.js'

const temps: string[] = []

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wt-symlink-guard-'))
  temps.push(dir)
  return dir
}

/**
 * Create a dir symlink (or Windows junction) without requiring admin.
 * Returns false when the platform cannot create one (skip those cases).
 */
function tryLinkDir(target: string, linkPath: string): boolean {
  try {
    if (process.platform === 'win32') {
      // Junctions do not need elevated privileges; lstat reports isSymbolicLink.
      symlinkSync(target, linkPath, 'junction')
    } else {
      symlinkSync(target, linkPath, 'dir')
    }
    return lstatSync(linkPath).isSymbolicLink()
  } catch {
    return false
  }
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

describe('assertWorktreeCreatePathsNotSymlinked densable xqi (#8)', () => {
  test('allows missing .claude / worktrees / target (ENOENT)', async () => {
    const repo = tempRepo()
    const target = join(repo, '.claude', 'worktrees', 'slug-a')
    await expect(
      assertWorktreeCreatePathsNotSymlinked(repo, target),
    ).resolves.toBeUndefined()
  })

  test('allows real directories for .claude and worktrees', async () => {
    const repo = tempRepo()
    mkdirSync(join(repo, '.claude', 'worktrees'), { recursive: true })
    const target = join(repo, '.claude', 'worktrees', 'slug-b')
    await expect(
      assertWorktreeCreatePathsNotSymlinked(repo, target),
    ).resolves.toBeUndefined()
  })

  test('rejects when .claude is a symlink', async () => {
    const repo = tempRepo()
    const outside = join(repo, 'outside')
    mkdirSync(outside, { recursive: true })
    if (!tryLinkDir(outside, join(repo, '.claude'))) {
      // No symlink privilege / junction support in this environment.
      return
    }
    const target = join(repo, '.claude', 'worktrees', 'slug-c')
    await expect(
      assertWorktreeCreatePathsNotSymlinked(repo, target),
    ).rejects.toThrow(/is a symlink/)
    await expect(
      assertWorktreeCreatePathsNotSymlinked(repo, target),
    ).rejects.toThrow(/redirect worktree creation outside the repository/)
  })

  test('rejects when .claude/worktrees is a symlink', async () => {
    const repo = tempRepo()
    mkdirSync(join(repo, '.claude'), { recursive: true })
    const outside = join(repo, 'evil-worktrees')
    mkdirSync(outside, { recursive: true })
    if (!tryLinkDir(outside, join(repo, '.claude', 'worktrees'))) {
      return
    }
    const target = join(repo, '.claude', 'worktrees', 'slug-d')
    await expect(
      assertWorktreeCreatePathsNotSymlinked(repo, target),
    ).rejects.toThrow(/is a symlink/)
  })

  test('rejects when target worktree path is a symlink', async () => {
    const repo = tempRepo()
    mkdirSync(join(repo, '.claude', 'worktrees'), { recursive: true })
    const outside = join(repo, 'evil-target')
    mkdirSync(outside, { recursive: true })
    const target = join(repo, '.claude', 'worktrees', 'slug-e')
    if (!tryLinkDir(outside, target)) {
      return
    }
    await expect(
      assertWorktreeCreatePathsNotSymlinked(repo, target),
    ).rejects.toThrow(/is a symlink/)
  })
})

describe('assertWorktreeCreateContainment densable post-add (#8)', () => {
  test('allows realpath that matches expected path', async () => {
    const repo = tempRepo()
    const path = join(repo, 'wt')
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'marker'), 'ok')
    await expect(assertWorktreeCreateContainment(path)).resolves.toBeUndefined()
  })

  test('rejects missing path (realpath failed)', async () => {
    const repo = tempRepo()
    const missing = join(repo, 'no-such-worktree')
    await expect(assertWorktreeCreateContainment(missing)).rejects.toThrow(
      /failed to verify containment/,
    )
  })
})
