/**
 * densable 2.1.216 #9 — refuse resume of a leftover worktree directory that
 * belongs to a different repository (gitdir parent dev/ino mismatch).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'
import {
  assertWorktreeNotForeignRepo,
  worktreeBranchName,
} from '../worktree.js'
import { clearResolveGitDirCache } from '../git/gitFilesystem.js'

const temps: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix))
  temps.push(d)
  return d
}

afterEach(async () => {
  clearResolveGitDirCache()
  while (temps.length) {
    const d = temps.pop()
    if (d) await rm(d, { recursive: true, force: true })
  }
})

describe('assertWorktreeNotForeignRepo densable DXi (2.1.216 #9)', () => {
  test('same-repo worktree (matching worktrees dir) is allowed', async () => {
    const repo = await tempDir('wt-same-')
    const gitDir = join(repo, '.git')
    const worktrees = join(gitDir, 'worktrees')
    const slug = 'feature'
    const wtGit = join(worktrees, slug)
    const wtPath = join(repo, '.claude', 'worktrees', slug)
    await mkdir(wtGit, { recursive: true })
    await mkdir(wtPath, { recursive: true })
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(join(wtPath, '.git'), `gitdir: ${wtGit}\n`)
    await expect(
      assertWorktreeNotForeignRepo(repo, wtPath),
    ).resolves.toBeUndefined()
  })

  test('foreign gitdir parent → densable error + telemetry name', async () => {
    const repoA = await tempDir('wt-a-')
    const repoB = await tempDir('wt-b-')
    // Repo A is the "selected project" — empty worktrees dir may or may not exist
    const gitA = join(repoA, '.git')
    await mkdir(gitA, { recursive: true })
    await writeFile(join(gitA, 'HEAD'), 'ref: refs/heads/main\n')
    // Leftover worktree dir under A's .claude/worktrees, but gitdir points into B
    const slug = 'shared-slug'
    const wtPath = join(repoA, '.claude', 'worktrees', slug)
    const foreignGit = join(repoB, '.git', 'worktrees', slug)
    await mkdir(foreignGit, { recursive: true })
    await mkdir(wtPath, { recursive: true })
    await writeFile(join(wtPath, '.git'), `gitdir: ${foreignGit}\n`)

    await expect(assertWorktreeNotForeignRepo(repoA, wtPath)).rejects.toThrow(
      /belongs to a different repository \(registered under /,
    )
    await expect(assertWorktreeNotForeignRepo(repoA, wtPath)).rejects.toThrow(
      /expected under /,
    )
    await expect(assertWorktreeNotForeignRepo(repoA, wtPath)).rejects.toThrow(
      /Remove that directory or choose a different worktree name/,
    )
  })

  test('missing .git pointer is a no-op (not foreign)', async () => {
    const repo = await tempDir('wt-nop-')
    const gitDir = join(repo, '.git')
    await mkdir(gitDir, { recursive: true })
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    const wtPath = join(repo, '.claude', 'worktrees', 'empty')
    await mkdir(wtPath, { recursive: true })
    await expect(
      assertWorktreeNotForeignRepo(repo, wtPath),
    ).resolves.toBeUndefined()
  })

  test('source contracts', () => {
    const src = readFileSync(join(import.meta.dir, '../worktree.ts'), 'utf8')
    expect(src).toContain('git_worktree_resume_foreign_repo')
    expect(src).toContain('assertWorktreeNotForeignRepo')
    expect(src).toContain('belongs to a different repository (registered under')
    expect(src).toContain(
      'await assertWorktreeNotForeignRepo(repoRoot, worktreePath)',
    )
    // branch naming still densable Pkt
    expect(worktreeBranchName('a/b')).toContain('worktree-')
  })

  test('readWorktreeGitDir is exported for OGr parity', async () => {
    const { readWorktreeGitDir } = await import('../git/gitFilesystem.js')
    const repo = await tempDir('wt-og-')
    const wt = join(repo, 'wt')
    const gd = join(repo, '.git', 'worktrees', 'wt')
    await mkdir(gd, { recursive: true })
    await mkdir(wt, { recursive: true })
    await writeFile(join(wt, '.git'), `gitdir: ${gd}\n`)
    const resolved = await readWorktreeGitDir(wt)
    expect(resolved).toBe(gd)
  })
})
