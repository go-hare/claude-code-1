import { afterEach, describe, expect, test } from 'bun:test'
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import securityReviewCommand from '../../commands/security-review.js'
import {
  checkDeviceOrProcPathRefusal,
  isDeviceOrProcPath,
  readUnsizedFileBytes,
} from '../file.js'
import {
  FileStateCache,
  fileStateContentMatches,
  MAX_INLINE_FILE_STATE_BYTES,
} from '../fileStateCache.js'
import {
  _resetAutofsMapRootCacheForTesting,
  isAutofsMapRoot,
  isAutomountMapRoot,
} from '../fsOperations.js'
import { gitSubprocessEnv } from '../git.js'
import { isPlansDirectoryContained } from '../plans.js'
import {
  detectBareGitIndicators,
  shouldWithholdSkillInlineGitGrants,
} from '../promptShellExecution.js'
import {
  internalToolSubprocessEnv,
  stripClaudeAuthEnvVars,
} from '../subprocessEnv.js'
import { orderWindowsSameDirCandidatesByPathExt } from '../windowsPaths.js'
import {
  assertGitRefTargetPlain,
  resolveWorktreeExitTargetDir,
} from '../worktree.js'
import {
  formatSendUserFileUploadError,
  UPLOAD_ABORTED_ERROR,
} from '../../../packages/builtin-tools/src/tools/SendUserFileTool/SendUserFileTool.js'
import {
  getWebFetchDisabledReason,
  WebFetchTool,
} from '../../../packages/builtin-tools/src/tools/WebFetchTool/WebFetchTool.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  _resetAutofsMapRootCacheForTesting()
  for (const d of tempDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe('Wave 323 Files, Worktree, Plans, Env & Tools (#1982, #1985, #1988, #2014, #2065, #2077, #2136, #2161, #2163, #2169, #2196)', () => {
  test('#1982: FileStateCache stores >4KiB entries as hash-only while preserving content match checks', () => {
    const cache = new FileStateCache(10, 1024 * 1024)
    const largeContent = 'A'.repeat(MAX_INLINE_FILE_STATE_BYTES + 1024)
    cache.set('/tmp/big.txt', {
      content: largeContent,
      timestamp: 1000,
      offset: undefined,
      limit: undefined,
    })

    const entry = cache.get('/tmp/big.txt')
    expect(entry).toBeDefined()
    expect(entry!.content).toBe('')
    expect(entry!.contentLength).toBe(largeContent.length)
    expect(entry!.contentHash).toBeDefined()
    expect(fileStateContentMatches(entry!, largeContent)).toBe(true)
    expect(fileStateContentMatches(entry!, `${largeContent}x`)).toBe(false)
  })

  test('#1985: device/proc path guard and readUnsizedFileBytes refuse /proc & /dev special files', async () => {
    expect(isDeviceOrProcPath('/dev/zero')).toBe(true)
    expect(isDeviceOrProcPath('/proc/self/mem')).toBe(true)
    expect(isDeviceOrProcPath('/proc/1/maps')).toBe(true)
    expect(isDeviceOrProcPath('/tmp/regular.txt')).toBe(false)
    expect(checkDeviceOrProcPathRefusal('/dev/zero', '/dev/zero')).toContain(
      'device or process file',
    )

    await expect(
      readUnsizedFileBytes('/dev/zero', {
        refusesName: p => p === '/dev/zero',
      }),
    ).rejects.toThrow(/Not a regular file/)
  })

  test('#1988: resolveWorktreeExitTargetDir falls back cleanly when originalCwd was deleted', () => {
    const parent = makeTempDir('w323-wtexit-')
    const deletedChild = join(parent, 'deleted-dir')
    const worktreeDir = join(parent, 'wt-1')
    mkdirSync(worktreeDir)

    const res = resolveWorktreeExitTargetDir({
      originalCwd: deletedChild,
      worktreePath: worktreeDir,
    })
    expect(res.fellBackFromDeletedOriginalCwd).toBe(true)
    expect(res.targetDir).toBe(parent)
  })

  test('#2014: isPlansDirectoryContained rejects symlinks escaping project root', () => {
    const project = makeTempDir('w323-plan-proj-')
    const canonicalProject = realpathSync(project)
    const outside = makeTempDir('w323-plan-out-')
    const escapingPlans = join(project, 'plans-link')
    symlinkSync(outside, escapingPlans)

    expect(
      isPlansDirectoryContained(
        join(project, 'plans'),
        project,
        canonicalProject,
      ),
    ).toBe(true)
    expect(
      isPlansDirectoryContained(escapingPlans, project, canonicalProject),
    ).toBe(false)
    expect(
      isPlansDirectoryContained(
        join(project, '..', 'outside'),
        project,
        canonicalProject,
      ),
    ).toBe(false)
  })

  test('#2065: WebFetchTool dynamically rechecks CLAUDE_CODE_DISABLE_WEB_FETCH on every call', async () => {
    const prev = process.env.CLAUDE_CODE_DISABLE_WEB_FETCH
    try {
      process.env.CLAUDE_CODE_DISABLE_WEB_FETCH = '1'
      expect(getWebFetchDisabledReason()).toContain(
        'CLAUDE_CODE_DISABLE_WEB_FETCH',
      )
      const valid = await WebFetchTool.validateInput!({
        url: 'https://example.com',
        prompt: 'summarize',
      })
      expect(valid.result).toBe(false)
      if (!valid.result) {
        expect(valid.message).toContain('CLAUDE_CODE_DISABLE_WEB_FETCH')
      }
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_WEB_FETCH
      } else {
        process.env.CLAUDE_CODE_DISABLE_WEB_FETCH = prev
      }
    }
  })

  test('#2077: SendUserFileTool formats interrupted uploads as turn-stopped, not size/network error', () => {
    const controller = new AbortController()
    controller.abort()
    const msg = formatSendUserFileUploadError(UPLOAD_ABORTED_ERROR, {
      signal: controller.signal,
    })
    expect(msg).toContain('the turn was stopped before the upload finished')
    expect(msg).toContain('which says nothing about the file or the network')
  })

  test('#2136: orderWindowsSameDirCandidatesByPathExt prefers git.exe over git.cmd/git.bat in same folder', () => {
    const ordered = orderWindowsSameDirCandidatesByPathExt([
      'C:\\Git\\cmd\\git.bat',
      'C:\\Git\\cmd\\git.cmd',
      'C:\\Git\\cmd\\git.exe',
      'D:\\Other\\git.exe',
    ])
    expect(ordered).toEqual([
      'C:\\Git\\cmd\\git.exe',
      'C:\\Git\\cmd\\git.bat',
      'C:\\Git\\cmd\\git.cmd',
      'D:\\Other\\git.exe',
    ])
  })

  test('#2161: autofs map root detection recognizes AUTOFS_SUPER_MAGIC and CLAUDE_CODE_AUTOMOUNT_ROOTS', () => {
    expect(
      isAutofsMapRoot('/home', {
        platform: 'linux',
        statfsSyncFn: () => ({ type: 0x0187 }),
      }),
    ).toBe(true)
    expect(
      isAutofsMapRoot('/home/alice', {
        platform: 'linux',
        statfsSyncFn: () => ({ type: 0x0187 }),
      }),
    ).toBe(false)
    expect(
      isAutomountMapRoot('/mnt/corp/users', {
        envValue: '/mnt/corp/users:/net/share',
        platform: 'linux',
        statfsSyncFn: () => ({ type: 0xef53 }),
      }),
    ).toBe(true)
  })

  test('#2163: /security-review exposes allowedTools (asks before model run) and bare repo withholds inline git grants', async () => {
    const cmdWithTools = securityReviewCommand as unknown as {
      allowedTools?: string[]
    }
    expect(Array.isArray(cmdWithTools.allowedTools)).toBe(true)
    expect(cmdWithTools.allowedTools!.length).toBeGreaterThan(0)

    const bareDir = makeTempDir('w323-bare-')
    writeFileSync(join(bareDir, 'HEAD'), 'ref: refs/heads/main\n')
    mkdirSync(join(bareDir, 'objects'))
    mkdirSync(join(bareDir, 'refs'))
    const nested = join(bareDir, 'worktree-sub')
    mkdirSync(nested)

    expect(detectBareGitIndicators(nested)).toBe('bare-indicators')
    expect(await shouldWithholdSkillInlineGitGrants('git status', nested)).toBe(
      true,
    )
    expect(await shouldWithholdSkillInlineGitGrants('echo hi', nested)).toBe(
      false,
    )
  })

  test('#2169: internalToolSubprocessEnv and gitSubprocessEnv strip Claude sign-in tokens and API keys', () => {
    const scrubbed = stripClaudeAuthEnvVars({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-ant-123',
      ANTHROPIC_AUTH_TOKEN: 'tok-123',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-123',
      INPUT_ANTHROPIC_API_KEY: 'sk-ant-dup',
      SAFE_VAR: 'keep',
    })
    expect(scrubbed.ANTHROPIC_API_KEY).toBeUndefined()
    expect(scrubbed.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(scrubbed.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(scrubbed.INPUT_ANTHROPIC_API_KEY).toBeUndefined()
    expect(scrubbed.SAFE_VAR).toBe('keep')

    const prevKey = process.env.ANTHROPIC_API_KEY
    try {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
      expect(internalToolSubprocessEnv().ANTHROPIC_API_KEY).toBeUndefined()
      expect(gitSubprocessEnv().ANTHROPIC_API_KEY).toBeUndefined()
    } finally {
      if (prevKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY
      } else {
        process.env.ANTHROPIC_API_KEY = prevKey
      }
    }
  })

  test('#2196: assertGitRefTargetPlain refuses symlinked .git, symlinked worktrees, and hard-linked cp -al files', async () => {
    const root = makeTempDir('w323-gitplain-')
    const gitDir = join(root, '.git')
    mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true })
    mkdirSync(join(gitDir, 'worktrees'), { recursive: true })
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    const packedRefs = join(gitDir, 'packed-refs')
    writeFileSync(packedRefs, '# pack-refs\n')

    expect(
      (await assertGitRefTargetPlain(gitDir, 'worktree-a', { repoRoot: root }))
        .ok,
    ).toBe(true)

    // #2196 P0-3 regression: `.git/logs/refs/stash` is a regular reflog file created by `git stash`,
    // NOT a directory — repos with a plain stash reflog must still pass, while symlinked/hardlinked
    // `.git/logs/refs/stash` must be rejected.
    mkdirSync(join(gitDir, 'logs', 'refs'), { recursive: true })
    writeFileSync(
      join(gitDir, 'refs', 'stash'),
      '0123456789abcdef0123456789abcdef01234567\n',
    )
    const stashLog = join(gitDir, 'logs', 'refs', 'stash')
    writeFileSync(
      stashLog,
      '0000000000000000000000000000000000000000 0123456789abcdef0123456789abcdef01234567 Dev <d@example.com> 1700000000 +0000\tWIP on main\n',
    )
    expect(
      (await assertGitRefTargetPlain(gitDir, 'worktree-a', { repoRoot: root }))
        .ok,
    ).toBe(true)

    const stashLogHardLink = join(root, 'stash-log-hardlink')
    linkSync(stashLog, stashLogHardLink)
    expect(
      (await assertGitRefTargetPlain(gitDir, 'worktree-a', { repoRoot: root }))
        .ok,
    ).toBe(false)
    rmSync(stashLogHardLink)
    expect(
      (await assertGitRefTargetPlain(gitDir, 'worktree-a', { repoRoot: root }))
        .ok,
    ).toBe(true)

    // Symlinked `.git/logs/refs/stash` must be rejected
    rmSync(stashLog)
    const outsideLog = join(root, 'outside-stash-log')
    writeFileSync(outsideLog, 'evil\n')
    symlinkSync(outsideLog, stashLog)
    expect(
      (await assertGitRefTargetPlain(gitDir, 'worktree-a', { repoRoot: root }))
        .ok,
    ).toBe(false)
    rmSync(stashLog)

    // Hard link (simulates `cp -al`)
    const hardLinkCopy = join(root, 'packed-refs-hardlink')
    linkSync(packedRefs, hardLinkCopy)
    const hardLinkRes = await assertGitRefTargetPlain(gitDir, 'worktree-a', {
      repoRoot: root,
    })
    expect(hardLinkRes.ok).toBe(false)

    // Symlinked `.git` folder (simulates git-new-workdir / linked repo)
    const symRoot = makeTempDir('w323-gitsym-')
    symlinkSync(gitDir, join(symRoot, '.git'))
    const symRes = await assertGitRefTargetPlain(
      join(symRoot, '.git'),
      'worktree-a',
      { repoRoot: symRoot },
    )
    expect(symRes.ok).toBe(false)
  })
})
