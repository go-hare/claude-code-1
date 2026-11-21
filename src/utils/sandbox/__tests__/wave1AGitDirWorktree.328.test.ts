import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  quarantineUnexpectedGitDirEntries,
  resolveUniqueGitDirs,
  snapshotGitDirBeforeSandboxWrap,
} from '../sandbox-adapter.js'

const tempDirs: string[] = []

afterEach(() => {
  quarantineUnexpectedGitDirEntries()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 1A Sandbox resolveUniqueGitDirs (P1-#30)', () => {
  test('walks up parent directories to discover enclosing .git from subdirectory CWD and quarantines planted symlinks', () => {
    const base = mkdtempSync(join(tmpdir(), 'wave1a-git-subdir-'))
    tempDirs.push(base)
    const repo = join(base, 'repo')
    const gitDir = join(repo, '.git')
    const subdir = join(repo, 'packages', 'app')
    mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true })
    mkdirSync(subdir, { recursive: true })
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')

    const resolved = resolveUniqueGitDirs(subdir)
    expect(resolved.map(p => realpathSync(p))).toContain(realpathSync(gitDir))

    snapshotGitDirBeforeSandboxWrap(subdir)
    const planted = join(gitDir, 'hooks-evil-link')
    symlinkSync('/etc/passwd', planted)
    const result = quarantineUnexpectedGitDirEntries(subdir)
    expect(result.removedSymlinks.length).toBe(1)
    expect(existsSync(planted)).toBe(false)
  })

  test('resolves linked worktree commonDir (.git file -> main/.git/worktrees/<name>) from worktree root and subdirectory', () => {
    const base = mkdtempSync(join(tmpdir(), 'wave1a-git-worktree-'))
    tempDirs.push(base)
    const mainRepo = join(base, 'main')
    const mainGitDir = join(mainRepo, '.git')
    const wtGitDir = join(mainGitDir, 'worktrees', 'wt1')
    const wtRoot = join(base, 'wt1')
    const wtSubdir = join(wtRoot, 'src', 'nested')

    mkdirSync(join(mainGitDir, 'refs', 'heads'), { recursive: true })
    mkdirSync(wtGitDir, { recursive: true })
    mkdirSync(wtSubdir, { recursive: true })
    writeFileSync(join(mainGitDir, 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(wtGitDir, 'HEAD'), 'ref: refs/heads/wt1\n')
    writeFileSync(join(wtRoot, '.git'), `gitdir: ${wtGitDir}\n`)
    writeFileSync(join(wtGitDir, 'gitdir'), `${join(wtRoot, '.git')}\n`)

    // Both worktree root and deep subdirectory inside worktree resolve main commonDir
    expect(resolveUniqueGitDirs(wtRoot).map(p => realpathSync(p))).toContain(
      realpathSync(mainGitDir),
    )
    expect(resolveUniqueGitDirs(wtSubdir).map(p => realpathSync(p))).toContain(
      realpathSync(mainGitDir),
    )

    // Snapshot & quarantine monitors planted symlinks inside linked worktree's commonDir
    snapshotGitDirBeforeSandboxWrap(wtSubdir)
    const plantedInWtAdmin = join(wtGitDir, 'evil-link')
    symlinkSync('/etc/passwd', plantedInWtAdmin)
    const res = quarantineUnexpectedGitDirEntries(wtSubdir)
    expect(res.removedSymlinks.length).toBe(1)
    expect(existsSync(plantedInWtAdmin)).toBe(false)
  })
})
