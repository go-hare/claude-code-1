import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _resetUnsandboxedCommandsDisabledForTesting,
  clearSandboxStateAtCheck,
  disableUnsandboxedCommandsForMcpServe,
  isUnsandboxedCommandsDisabled,
  recordSandboxStateAtCheck,
  shouldKeepRewrittenCommandInSandbox,
} from '../../../../packages/builtin-tools/src/tools/BashTool/shouldUseSandbox.js'
import {
  cleanupLinuxSandboxPlaceholderFiles,
  clearSandboxRootMoveHold,
  collectSensitiveHomeDenyWritePaths,
  DEFAULT_SENSITIVE_HOME_DENY_WRITE_PATHS,
  filterLinuxNetSymlinkDenyRead,
  getActiveGitDirSnapshotCountForTesting,
  getSandboxRootMoveHold,
  isLinuxNetAutofsPath,
  isSandboxHeldOnByRootMove,
  precreateMissingLinuxAddDirs,
  quarantineUnexpectedGitDirEntries,
  serializeSandboxRootMoveHoldEnv,
  snapshotGitDirBeforeSandboxWrap,
} from '../sandbox-adapter.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  clearSandboxRootMoveHold()
  _resetUnsandboxedCommandsDisabledForTesting()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 326 Group 1 — Sandbox & MCP Serve Alignment', () => {
  test('#22 Linux /net autofs symlink denyRead filter detects /net paths on linux/wsl', () => {
    expect(isLinuxNetAutofsPath('/net/server/home/user', 'linux')).toBe(true)
    expect(isLinuxNetAutofsPath('/home/user', 'linux')).toBe(false)
    expect(isLinuxNetAutofsPath('/net/server/home/user', 'macos')).toBe(false)

    // When no config/home resolves under /net, keep all denyRead entries
    const untouched = filterLinuxNetSymlinkDenyRead(
      ['/net', '/etc/shadow'],
      '/home/user',
      '/home/user/.claude',
      'linux',
    )
    expect(untouched).toEqual(['/net', '/etc/shadow'])
  })

  test('#23 cleanupLinuxSandboxPlaceholderFiles removes empty placeholders (e.g. .git/config.lock) and preserves non-empty files', () => {
    const dir = makeTempDir('sandbox-placeholder-')
    const gitDir = join(dir, '.git')
    mkdirSync(gitDir, { recursive: true })
    const emptyLock = join(gitDir, 'config.lock')
    const nonEmptyLock = join(gitDir, 'HEAD.lock')
    writeFileSync(emptyLock, '')
    writeFileSync(nonEmptyLock, 'ref: refs/heads/main\n')

    const removed = cleanupLinuxSandboxPlaceholderFiles([
      emptyLock,
      nonEmptyLock,
    ])
    expect(removed).toContain(emptyLock)
    expect(existsSync(emptyLock)).toBe(false)
    expect(existsSync(nonEmptyLock)).toBe(true)
  })

  test('#300 collectSensitiveHomeDenyWritePaths protects sensitive home folders and only honors trusted allowWrite overrides', () => {
    expect(DEFAULT_SENSITIVE_HOME_DENY_WRITE_PATHS.length).toBeGreaterThan(0)
    const base = collectSensitiveHomeDenyWritePaths('/Users/tester', [])
    expect(base).toContain('/Users/tester/.ssh')
    expect(base).toContain('/Users/tester/.aws')
    expect(base).toContain('/Users/tester/.claude/state')

    // User/policy allowWrite can unlock non-.claude sensitive home dirs
    const unlocked = collectSensitiveHomeDenyWritePaths('/Users/tester', [
      '~/.aws',
      '~/.claude/state',
    ])
    expect(unlocked).not.toContain('/Users/tester/.aws')
    expect(unlocked).toContain('/Users/tester/.ssh')
    // .claude/state cannot be unlocked via allowWrite
    expect(unlocked).toContain('/Users/tester/.claude/state')
  })

  test('#301 snapshotGitDirBeforeSandboxWrap + quarantineUnexpectedGitDirEntries preserves regular git metadata, removes planted symlinks & escaping ref files, and cleans up snapshot map', () => {
    const repo = makeTempDir('sandbox-git-quarantine-')
    const gitDir = join(repo, '.git')
    mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true })
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')

    snapshotGitDirBeforeSandboxWrap(repo)
    expect(getActiveGitDirSnapshotCountForTesting()).toBeGreaterThan(0)

    // Legitimate regular git metadata files & dirs MUST NOT be touched
    const rebaseHead = join(gitDir, 'REBASE_HEAD')
    writeFileSync(rebaseHead, '0123456789abcdef0123456789abcdef01234567\n')
    const worktreesDir = join(gitDir, 'worktrees', 'wt-1')
    mkdirSync(worktreesDir, { recursive: true })
    const validSymref = join(gitDir, 'refs', 'heads', 'alias')
    writeFileSync(validSymref, 'ref: refs/heads/main\n')

    // Planted symlink and escaping `ref:` symref file MUST be removed/quarantined
    const plantedLink = join(gitDir, 'evil-link')
    if (process.platform !== 'win32') {
      symlinkSync('/etc/passwd', plantedLink)
    }
    const escapingRef = join(gitDir, 'refs', 'heads', 'escape')
    writeFileSync(escapingRef, 'ref: ../../../etc/passwd\n')

    const { quarantined, removedSymlinks } =
      quarantineUnexpectedGitDirEntries(repo)

    // Regular git metadata preserved
    expect(existsSync(rebaseHead)).toBe(true)
    expect(existsSync(worktreesDir)).toBe(true)
    expect(existsSync(validSymref)).toBe(true)
    expect(quarantined).not.toContain(rebaseHead)
    expect(quarantined).not.toContain(validSymref)

    // Escaping ref file quarantined
    expect(quarantined).toContain(escapingRef)
    expect(existsSync(escapingRef)).toBe(false)

    // Planted symlink removed
    if (process.platform !== 'win32') {
      expect(removedSymlinks).toContain(plantedLink)
      expect(existsSync(plantedLink)).toBe(false)
    }

    // Snapshot entry cleaned up (no Map leak)
    expect(getActiveGitDirSnapshotCountForTesting()).toBe(0)
  })

  test('#302 precreateMissingLinuxAddDirs creates missing directories on linux/wsl', () => {
    const root = makeTempDir('sandbox-add-dir-')
    const target = join(root, 'nested', 'added-dir')
    expect(existsSync(target)).toBe(false)
    const created = precreateMissingLinuxAddDirs([target], 'linux')
    expect(created).toContain(target)
    expect(existsSync(target)).toBe(true)
  })

  test('#299 SandboxRootMoveHold serialize/clear helpers work cleanly', () => {
    expect(isSandboxHeldOnByRootMove()).toBe(false)
    expect(getSandboxRootMoveHold()).toBeUndefined()
    expect(serializeSandboxRootMoveHoldEnv()).toEqual({})
    clearSandboxRootMoveHold()
    expect(isSandboxHeldOnByRootMove()).toBe(false)
  })

  test('#303 hook/SDK rewritten commands stay in sandbox unless approver explicitly sets dangerouslyDisableSandbox: true', () => {
    const toolUseId = 'tu-303-test'
    recordSandboxStateAtCheck(
      toolUseId,
      { command: 'echo safe', dangerouslyDisableSandbox: false },
      true,
    )

    // Hook rewrote command without disabling sandbox -> keep in sandbox
    expect(
      shouldKeepRewrittenCommandInSandbox(toolUseId, {
        command: 'echo rewritten-by-hook',
        dangerouslyDisableSandbox: false,
      }),
    ).toBe(true)

    // PermissionRequest hook re-running checkPermissions with rewritten input
    // that is NOT sandboxed must NOT overwrite the initial 'counted as sandboxed' record
    recordSandboxStateAtCheck(
      toolUseId,
      { command: 'docker ps', dangerouslyDisableSandbox: false },
      false,
    )
    expect(
      shouldKeepRewrittenCommandInSandbox(toolUseId, {
        command: 'docker ps',
        dangerouslyDisableSandbox: false,
      }),
    ).toBe(true)

    // Approver explicitly adds dangerouslyDisableSandbox: true -> allow unsandboxed
    expect(
      shouldKeepRewrittenCommandInSandbox(toolUseId, {
        command: 'echo rewritten-by-hook',
        dangerouslyDisableSandbox: true,
      }),
    ).toBe(false)

    clearSandboxStateAtCheck(toolUseId)
    expect(
      shouldKeepRewrittenCommandInSandbox(toolUseId, {
        command: 'echo after-clear',
      }),
    ).toBe(false)
  })

  test('#304 disableUnsandboxedCommandsForMcpServe toggles MCP serve unsandboxed refusal', () => {
    expect(isUnsandboxedCommandsDisabled()).toBe(false)
    disableUnsandboxedCommandsForMcpServe()
    expect(isUnsandboxedCommandsDisabled()).toBe(true)
    _resetUnsandboxedCommandsDisabledForTesting()
    expect(isUnsandboxedCommandsDisabled()).toBe(false)
  })
})
