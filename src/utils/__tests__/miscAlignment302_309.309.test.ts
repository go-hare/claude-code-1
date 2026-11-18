import { describe, expect, test } from 'bun:test'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { inspectWorktreeSafetyBeforeShutdownRemoval } from '../gracefulShutdown.js'
import { resolveGitForWindowsDirectExe } from '../windowsPaths.js'

describe('Misc Wave 2 alignment (#987, #1011, #1157)', () => {
  test('#1011 resolveGitForWindowsDirectExe resolves cmd/git.exe to bin/git.exe', () => {
    const resolved = resolveGitForWindowsDirectExe(
      'C:\\Program Files\\Git\\cmd\\git.exe',
      {
        checkExists: p => p === 'C:\\Program Files\\Git\\mingw64\\bin\\git.exe',
        execCommand: cmd =>
          cmd.includes('--exec-path')
            ? 'C:\\Program Files\\Git\\mingw64\\libexec\\git-core'
            : 'git version 2.45.0.windows.1',
        cwdFn: () => 'C:\\Users\\test\\repo',
      },
    )
    expect(resolved).toBe('C:\\Program Files\\Git\\mingw64\\bin\\git.exe')
  })

  test('#987 inspectWorktreeSafetyBeforeShutdownRemoval returns keep: false when no worktree session', async () => {
    const res = await inspectWorktreeSafetyBeforeShutdownRemoval()
    expect(res.keep).toBe(false)
  })

  test('#1157 execFileNoThrowWithCwd handles missing binary without throwing', async () => {
    const res = await execFileNoThrowWithCwd(
      '/nonexistent-binary-for-test-1157',
      [],
    )
    expect(res.code).not.toBe(0)
    if (process.platform === 'linux') {
      expect(res.noChildLeft).toBe(true)
    }
  })
})
