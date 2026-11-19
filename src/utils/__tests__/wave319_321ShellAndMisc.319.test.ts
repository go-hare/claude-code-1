import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawn } from 'child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  hasUnsafeFilenameCharacters,
  resolveAttachments,
  validateAttachmentPaths,
} from '../../../packages/builtin-tools/src/tools/BriefTool/attachments.js'
import {
  postBriefUploadWithRetry,
  RETRYABLE_UPLOAD_HTTP_STATUSES,
} from '../../../packages/builtin-tools/src/tools/BriefTool/upload.js'
import {
  normalizeSendUserFilePaths,
  SendUserFileTool,
} from '../../../packages/builtin-tools/src/tools/SendUserFileTool/SendUserFileTool.js'
import {
  TASK_STOP_COMMAND_HEAD_CHARS,
  TASK_STOP_COMMAND_MAX_CHARS,
  TASK_STOP_COMMAND_TAIL_CHARS,
  truncateTaskCommandForDisplay,
} from '../../../packages/builtin-tools/src/tools/TaskStopTool/TaskStopTool.js'
import {
  createPgrepPidwaitIgnoreAncestorsShellIntegration,
  createPkillSelfGuardShellIntegration,
} from '../bash/ShellSnapshot.js'
import {
  isBlockedMonitorHostname,
  MonitorWsPreconditionError,
  resolveMonitorWsUrl,
} from '../monitorWsSpawn.js'
import { preserveWindowsDriveLetterCase } from '../Shell.js'
import { wrapSpawn } from '../ShellCommand.js'
import { TaskOutput } from '../task/TaskOutput.js'
import {
  clearWindowsPathCacheForTesting,
  findGitBashPathOrNullWithDeps,
  isUnsafeWindowsPathEntry,
  resolveWindowsExecutableOnPath,
} from '../windowsPaths.js'
import {
  assertGitRefTargetPlain,
  formatWorktreeResumeSkipNotice,
} from '../worktree.js'

describe('Wave 319-321 Shell, Worktree, Windows, Monitor, Brief, SendUserFile, TaskStop (#1741 #1747 #1768 #1780 #1857 #1865 #1895 #1898 #1925 #1934 #1944 #1956)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wave319-shellmisc-'))
    clearWindowsPathCacheForTesting()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    clearWindowsPathCacheForTesting()
    delete process.env.CLAUDE_CODE_PROXY_RESOLVES_HOSTS
    delete process.env.CLAUDE_CODE_REMOTE
  })

  test('#1741 ShellCommand outputEnded drains and background() flushes instant-exit output to taskOutput', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'console.log("instant-hello")'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const ac = new AbortController()
    const taskId = `task-instant-${Date.now()}`
    const taskOutput = new TaskOutput(taskId, null)
    const cmd = wrapSpawn(child, ac.signal, 5000, taskOutput)

    // Wait for fast command to complete completely before calling background()
    const res = await cmd.result
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('instant-hello')
    await cmd.outputEnded

    // Backgrounding an already-completed command spills & flushes captured pipe output to disk
    const bg = cmd.background(taskId)
    expect(bg).toBe(false)
    await taskOutput.flush()
    expect(readFileSync(taskOutput.path, 'utf8')).toContain('instant-hello')
    cmd.cleanup()
  })

  test('#1747 monitorWsSpawn blocks loopback/metadata hostnames even behind proxy and delegates DNS only with proxy + CLAUDE_CODE_PROXY_RESOLVES_HOSTS + EAI_AGAIN/ENOTFOUND', async () => {
    expect(isBlockedMonitorHostname('localhost')).toBe(true)
    expect(isBlockedMonitorHostname('foo.localhost')).toBe(true)
    expect(isBlockedMonitorHostname('metadata.google.internal')).toBe(true)
    expect(isBlockedMonitorHostname('169.254.169.254')).toBe(true)
    expect(isBlockedMonitorHostname('::1')).toBe(true)
    expect(isBlockedMonitorHostname('ws.example.com')).toBe(false)

    const enotfoundLookup = (async () => {
      throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
    }) as never
    const econnrefusedLookup = (async () => {
      throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })
    }) as never

    // Blocked hostname is rejected even when proxy + CLAUDE_CODE_PROXY_RESOLVES_HOSTS are set
    process.env.CLAUDE_CODE_PROXY_RESOLVES_HOSTS = '1'
    await expect(
      resolveMonitorWsUrl(
        'wss://metadata.google.internal/ws',
        { proxy: 'http://corp-proxy:8080' },
        enotfoundLookup,
      ),
    ).rejects.toBeInstanceOf(MonitorWsPreconditionError)

    // Allowed hostname + proxy + CLAUDE_CODE_PROXY_RESOLVES_HOSTS + ENOTFOUND delegates to proxy
    const proxied = await resolveMonitorWsUrl(
      'wss://events.example.com/stream',
      { proxy: 'http://corp-proxy:8080' },
      enotfoundLookup,
    )
    expect(proxied.url).toBe('wss://events.example.com/stream')

    // Without CLAUDE_CODE_PROXY_RESOLVES_HOSTS, ENOTFOUND must NOT delegate to proxy
    delete process.env.CLAUDE_CODE_PROXY_RESOLVES_HOSTS
    await expect(
      resolveMonitorWsUrl(
        'wss://events.example.com/stream',
        { proxy: 'http://corp-proxy:8080' },
        enotfoundLookup,
      ),
    ).rejects.toBeInstanceOf(MonitorWsPreconditionError)

    // With CLAUDE_CODE_PROXY_RESOLVES_HOSTS but non-ENO/EAI error (e.g. ECONNREFUSED), do NOT delegate
    process.env.CLAUDE_CODE_PROXY_RESOLVES_HOSTS = '1'
    await expect(
      resolveMonitorWsUrl(
        'wss://events.example.com/stream',
        { proxy: 'http://corp-proxy:8080' },
        econnrefusedLookup,
      ),
    ).rejects.toBeInstanceOf(MonitorWsPreconditionError)
  })

  test('#1768 #1898 SendUserFileTool normalizes files string/array + file_path and rejects bidi/control filenames', async () => {
    expect(normalizeSendUserFilePaths({ file_path: 'a.txt' })).toEqual([
      'a.txt',
    ])
    expect(normalizeSendUserFilePaths({ files: 'b.txt' })).toEqual(['b.txt'])
    expect(normalizeSendUserFilePaths({ files: ['b.txt', 'c.txt'] })).toEqual([
      'b.txt',
      'c.txt',
    ])
    expect(
      normalizeSendUserFilePaths({
        file_path: 'a.txt',
        files: ['a.txt', 'b.txt'],
      }),
    ).toEqual(['a.txt', 'b.txt'])

    const bidiName = `report-\u202Egpj.exe`
    const ctrlName = `report-\u0007bell.txt`
    expect(hasUnsafeFilenameCharacters(bidiName)).toBe(true)
    expect(hasUnsafeFilenameCharacters(ctrlName)).toBe(true)
    expect(hasUnsafeFilenameCharacters('normal-report_v2.pdf')).toBe(false)

    // BriefTool attachments reject bidi/control filenames
    const vRes = await validateAttachmentPaths([join(tmpDir, bidiName)])
    expect(vRes.result).toBe(false)
    if (!vRes.result) {
      expect(vRes.message).toMatch(/control|bidirectional/i)
    }
    await expect(
      resolveAttachments([join(tmpDir, ctrlName)], {
        replBridgeEnabled: false,
      }),
    ).rejects.toThrow(/control|bidirectional/i)

    // SendUserFileTool.call refuses bidi filename cleanly
    const sendRes = await SendUserFileTool.call(
      { files: [join(tmpDir, bidiName)] },
      {
        getAppState: () => ({ replBridgeEnabled: false }),
      } as never,
    )
    expect(sendRes.data.sent).toBe(false)
    expect(sendRes.data.error).toMatch(/control|bidirectional/i)
  })

  test('#1780 worktree assertGitRefTargetPlain rejects symlinked ref and formatWorktreeResumeSkipNotice formats ref_target_not_plain', async () => {
    const gitDir = join(tmpDir, '.git')
    const headsDir = join(gitDir, 'refs', 'heads')
    mkdirSync(headsDir, { recursive: true })
    const secretFile = join(tmpDir, 'secret.txt')
    writeFileSync(secretFile, 'deadbeef\n', 'utf8')

    // Symlink ref target -> rejected as ref_target_not_plain
    symlinkSync(secretFile, join(headsDir, 'worktree-evil'))
    const bad = await assertGitRefTargetPlain(gitDir, 'worktree-evil')
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.reason).toBe('ref_target_not_plain')
    }

    // Plain regular ref target -> accepted
    writeFileSync(join(headsDir, 'worktree-good'), '0123456789abcdef\n', 'utf8')
    const good = await assertGitRefTargetPlain(gitDir, 'worktree-good')
    expect(good.ok).toBe(true)

    const notice = formatWorktreeResumeSkipNotice(
      'evil',
      'ref_target_not_plain',
    )
    expect(notice).toContain('Resumed worktree "evil"')
    expect(notice).toContain('git could write outside this repository')
  })

  test('#1857 preserveWindowsDriveLetterCase preserves session cwd drive letter case', () => {
    expect(
      preserveWindowsDriveLetterCase('c:\\Users\\dev\\proj', 'C:\\Users\\dev'),
    ).toBe('C:\\Users\\dev\\proj')
    expect(
      preserveWindowsDriveLetterCase('C:\\Users\\dev\\proj', 'c:\\Users\\dev'),
    ).toBe('c:\\Users\\dev\\proj')
    // Different drive letter -> untouched
    expect(preserveWindowsDriveLetterCase('d:\\work', 'C:\\Users\\dev')).toBe(
      'd:\\work',
    )
    // POSIX path -> untouched
    expect(preserveWindowsDriveLetterCase('/Users/dev', '/Users')).toBe(
      '/Users/dev',
    )
  })

  test('#1865 ShellSnapshot injects --ignore-ancestors for pkill/pgrep/pidwait in CLAUDE_CODE_REMOTE sessions', () => {
    delete process.env.CLAUDE_CODE_REMOTE
    expect(createPgrepPidwaitIgnoreAncestorsShellIntegration()).toBeNull()
    expect(createPkillSelfGuardShellIntegration()).not.toContain(
      '--ignore-ancestors',
    )

    process.env.CLAUDE_CODE_REMOTE = '1'
    const pgrepSnippet = createPgrepPidwaitIgnoreAncestorsShellIntegration()
    expect(pgrepSnippet).not.toBeNull()
    expect(pgrepSnippet).toContain('function pgrep')
    expect(pgrepSnippet).toContain('function pidwait')
    expect(pgrepSnippet).toContain('--ignore-ancestors')
    expect(createPkillSelfGuardShellIntegration()).toContain(
      '--ignore-ancestors',
    )
  })

  test('#1895 BriefTool upload includes HTTP 507 in RETRYABLE_UPLOAD_HTTP_STATUSES and retries on 507', async () => {
    expect(RETRYABLE_UPLOAD_HTTP_STATUSES.has(507)).toBe(true)
    const filePath = join(tmpDir, 'payload.txt')
    writeFileSync(filePath, 'hello brief', 'utf8')

    let attempts = 0
    const outcome = await postBriefUploadWithRetry({
      url: 'https://example.invalid/api/oauth/file_upload',
      body: Buffer.from('hello brief'),
      token: 'test-token',
      boundary: '----TestBoundary',
      fullPath: filePath,
      size: 11,
      retryDelayMs: 0,
      postFn: (async () => {
        attempts++
        if (attempts === 1) {
          return { status: 507, data: 'Insufficient Storage' }
        }
        return { status: 201, data: { file_uuid: 'uuid-after-507' } }
      }) as never,
    })
    expect(attempts).toBe(2)
    expect('fileUuid' in outcome && outcome.fileUuid).toBe('uuid-after-507')
  })

  test('#1925 #1944 windowsPaths resolveWindowsExecutableOnPath caches PATH+PATHEXT, skips relative/UNC entries, and picks up settingsPathEnv', () => {
    expect(isUnsafeWindowsPathEntry('')).toBe(true)
    expect(isUnsafeWindowsPathEntry('.')).toBe(true)
    expect(isUnsafeWindowsPathEntry('relative\\bin')).toBe(true)
    expect(isUnsafeWindowsPathEntry('\\\\fileserver\\share\\bin')).toBe(true)
    expect(isUnsafeWindowsPathEntry('//fileserver/share/bin')).toBe(true)
    expect(isUnsafeWindowsPathEntry('C:\\Tools\\bin')).toBe(false)

    const dirEntries: Record<string, string[]> = {
      'C:\\Tools\\bin': ['mytool.exe', 'netlink.exe'],
      'D:\\SettingsBin': ['custom.cmd'],
    }
    const deps = {
      pathEnv: '.;\\\\evil\\share;C:\\Tools\\bin',
      settingsPathEnv: 'D:\\SettingsBin',
      pathExtEnv: '.EXE;.CMD',
      cwd: 'C:\\Work',
      readdirFn: (d: string) => dirEntries[d] ?? [],
      lstatFn: (p: string) => ({
        isDirectory: () => false,
        isSymbolicLink: () => p.endsWith('netlink.exe'),
      }),
      realpathFn: (p: string) =>
        p.endsWith('netlink.exe')
          ? '\\\\untrusted-host\\share\\netlink.exe'
          : p,
    }

    // Finds executable in safe PATH entry and skips '.' and UNC entry
    expect(resolveWindowsExecutableOnPath('mytool', deps)).toBe(
      'C:\\Tools\\bin\\mytool.exe',
    )

    // Picks up executable from settings.env.PATH (#1944)
    expect(resolveWindowsExecutableOnPath('custom', deps)).toBe(
      'D:\\SettingsBin\\custom.cmd',
    )

    // Skips symlink pointing to a UNC network share
    expect(resolveWindowsExecutableOnPath('netlink', deps)).toBeNull()
  })

  test('#1934 findGitBashPathOrNullWithDeps prioritizes Program Files\\Git\\bin\\bash.exe before where.exe', () => {
    let execCalled = false
    const found = findGitBashPathOrNullWithDeps({
      cwdFn: () => 'C:\\work',
      checkExists: p => p === 'C:\\Program Files\\Git\\bin\\bash.exe',
      execCommand: () => {
        execCalled = true
        return 'C:\\Other\\bash.exe'
      },
      envOverride: undefined,
    })
    expect(found).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
    expect(execCalled).toBe(false)
  })

  test('#1956 TaskStopTool truncateTaskCommandForDisplay keeps 500 head + 300 tail for >1000-char commands', () => {
    expect(TASK_STOP_COMMAND_MAX_CHARS).toBe(1000)
    expect(TASK_STOP_COMMAND_HEAD_CHARS).toBe(500)
    expect(TASK_STOP_COMMAND_TAIL_CHARS).toBe(300)

    const shortCmd = 'echo hello'
    expect(truncateTaskCommandForDisplay(shortCmd)).toBe(shortCmd)

    const exact1000 = 'a'.repeat(1000)
    expect(truncateTaskCommandForDisplay(exact1000)).toBe(exact1000)

    const longCmd = `${'H'.repeat(500)}${'M'.repeat(400)}${'T'.repeat(300)}`
    const truncated = truncateTaskCommandForDisplay(longCmd)
    expect(truncated).toBeDefined()
    expect(truncated!.startsWith('H'.repeat(500))).toBe(true)
    expect(truncated!.endsWith('T'.repeat(300))).toBe(true)
    expect(truncated!).toContain('400 chars omitted')
    expect(truncated!.length).toBeLessThan(longCmd.length)
  })
})
