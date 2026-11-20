import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  isBetasSwitchSetAside,
  isOldModelForBedrockMantleClassifier,
  serverClassifierBetasEligible,
} from '../../../services/api/autoModeClassifierTransport.js'
import { autoModeClassifierBillingNoticeCopy } from '../../../services/api/autoModeServerFallbackNotice.js'
import {
  redactSecrets,
  redactSecretsForDisplay,
  redactUrlUserinfoLinear,
  SECRET_REDACTION_OOM_FALLBACK,
  scanForSecrets,
  setSecretScannerErrorReporter,
  setSecretScannerMemoryProbeForTest,
} from '../../../services/teamMemorySync/secretScanner.js'
import { planModelSupportsAutoMode } from '../../betas.js'
import {
  cloneFileStateCache,
  FileStateCache,
  isFullEnoughFileRead,
} from '../../fileStateCache.js'
import {
  type FsOperations,
  getFsImplementation,
  isOpaqueSymlinkTarget,
  resolveDeepestExistingAncestorSync,
  walkPermissionPaths,
} from '../../fsOperations.js'
import { mapNotebookCellsToToolResult, readNotebook } from '../../notebook.js'
import { FileTooLargeError, readFileInRange } from '../../readFileInRange.js'
import {
  _resetSandboxHeldStateForTesting,
  _setSandboxInitFailureForTesting,
  ensureInitializedForWrap,
  isEscapingGitRefFile,
  isSandboxDisabledThisSession,
  SandboxInitFailedError,
  SandboxManager,
} from '../../sandbox/sandbox-adapter.js'
import {
  normalizeBroadRuleContent,
  normalizeBroadRuleProg,
} from '../broadRuleFilter.js'
import { CROSS_PLATFORM_CODE_EXEC } from '../dangerousPatterns.js'
import { pathInWorkingPath } from '../filesystem.js'
import {
  buildOutsideReadRuntimePathAsk,
  buildOutsideReadUnanalyzableAsk,
  checkBashArgvUnderOutsideReadsBlock,
  isOutsideReadsBlockedReason,
  isStdinCodeInterpreterArgv,
} from '../outsideReads.js'
import {
  extractParenthesizedDisallowedRules,
  parseDisallowedToolListFromCLI,
  parsePermissionRuleShape,
  splitToolListBalanced,
} from '../permissionRuleParser.js'
import {
  _resetWorktreeAddDirPinStateForTesting,
  applyRepinnedWorktreeAddDirsToPermissionContext,
  isDangerousBashPermission,
  pinAddDirsForWorktreeLaunch,
  repinAddDirsAfterWorktreeEnter,
  resolveWorktreeAddDirEntry,
  rewriteAddDirForBgWorktree,
} from '../permissionSetup.js'
import {
  getAllowedSettingSources,
  setAdditionalDirectoriesForClaudeMd,
  setAllowedSettingSources,
} from '../../../bootstrap/state.js'
import type { SettingSource } from '../../settings/constants.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import {
  getAllowRules,
  getDenyRules,
  getRuleByContentsForToolName,
} from '../permissions.js'
import type { ToolPermissionContext } from '../../../Tool.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const savedEnv: Record<string, string | undefined> = {}
function setEnv(key: string, val: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key]
  if (val === undefined) delete process.env[key]
  else process.env[key] = val
}

const origSources: SettingSource[] = [...getAllowedSettingSources()]

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete savedEnv[k]
  }
  setAllowedSettingSources([...origSources])
  resetSettingsCache()
  setSecretScannerMemoryProbeForTest(undefined)
  setSecretScannerErrorReporter(undefined)
  _resetSandboxHeldStateForTesting()
  _resetWorktreeAddDirPinStateForTesting()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 327-328 Permissions, Sandbox, Files & SecretScanner', () => {
  test('#384: --disallowedTools parses rules with parentheses in content', () => {
    const raw = [
      'Bash(echo $(whoami) test),Edit(/tmp/a(1).txt),WebFetch(domain:example.com)',
    ]
    expect(splitToolListBalanced(raw[0]!)).toEqual([
      'Bash(echo $(whoami) test)',
      'Edit(/tmp/a(1).txt)',
      'WebFetch(domain:example.com)',
    ])
    expect(parsePermissionRuleShape('Bash(echo $(whoami) test)')).toEqual({
      kind: 'call',
      toolName: 'Bash',
      rawContent: 'echo $(whoami) test',
    })
    expect(extractParenthesizedDisallowedRules(raw)).toContain(
      'Bash(echo $(whoami) test)',
    )
    const parsed = parseDisallowedToolListFromCLI(raw)
    expect(parsed).toContain('Bash(echo $(whoami) test)')
    expect(parsed).toContain('Edit(/tmp/a(1).txt)')
    expect(parsed).toContain('WebFetch(domain:example.com)')
  })

  test('#413: FileStateCache preserves unchanged full reads across compaction & clone', () => {
    const cache = new FileStateCache(10, 1024 * 1024)
    const extPath = '/outside/project/file.txt'
    cache.set(extPath, {
      content: 'hello world',
      timestamp: 12345,
      offset: undefined,
      limit: undefined,
    })
    cache.clearForCompaction()
    expect(cache.get(extPath)).toBeUndefined()
    expect(cache.readBeforeCompaction(extPath)).toBeDefined()

    const cloned = cloneFileStateCache(cache)
    expect(cloned.readBeforeCompaction(extPath)).toBeDefined()
  })

  test('#415: Jupyter notebook Read skips unknown/null outputs without throwing', async () => {
    const dir = makeTempDir('wave328-ipynb-')
    const nbPath = join(dir, 'unknown-output.ipynb')
    writeFileSync(
      nbPath,
      JSON.stringify({
        cells: [
          {
            cell_type: 'code',
            source: ['print(1)'],
            execution_count: 1,
            metadata: {},
            outputs: [
              null,
              { output_type: 'stream', name: 'stdout', text: ['1\n'] },
              { output_type: 'custom_unknown_type', data: {} },
            ],
          },
        ],
        metadata: { language_info: { name: 'python' } },
        nbformat: 4,
        nbformat_minor: 5,
      }),
    )
    const cells = await readNotebook(nbPath)
    const block = mapNotebookCellsToToolResult(cells, 'toolu_nb_1')
    const texts = (Array.isArray(block.content) ? block.content : [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')
    expect(texts).toContain('1')
    expect(texts).toContain('Outputs of an unknown type are not shown.')
  })

  test('#417: readFileInRange reports real file size on FileTooLargeError instead of 512KB', async () => {
    const dir = makeTempDir('wave328-read-')
    const bigFile = join(dir, 'big.txt')
    // 1.2 MB of lines so streaming hits a 200KB byte cap well before EOF
    const chunk = `${'a'.repeat(1023)}\n`
    writeFileSync(bigFile, chunk.repeat(1200))
    let caught: unknown
    try {
      await readFileInRange(bigFile, 0, undefined, 200_000)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(FileTooLargeError)
    const err = caught as FileTooLargeError
    expect(err.sizeInBytes).toBeGreaterThanOrEqual(1_200_000)
  })

  test('#441: WeakMap-cached rule buckets handle 20,000+ connector permissions quickly', () => {
    const manyRules = Array.from(
      { length: 20_000 },
      (_, i) => `mcp__connector__tool_${i}(read:*)`,
    )
    const ctx: ToolPermissionContext = {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: { policySettings: manyRules },
      alwaysDenyRules: { policySettings: ['Bash(rm -rf /:*)'] },
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    }
    const first = getAllowRules(ctx)
    const second = getAllowRules(ctx)
    expect(first.length).toBe(20_000)
    // WeakMap cache returns identical cached array for same rules object
    expect(second.length).toBe(first.length)
    const byContent = getRuleByContentsForToolName(
      ctx,
      'mcp__connector__tool_19999',
      'allow',
    )
    expect(byContent.has('read:*')).toBe(true)
    expect(getDenyRules(ctx).length).toBe(1)
  })

  test('#489: binary-search deepest ancestor on deeply nested missing POSIX paths & linear URL secret redaction', () => {
    const dir = makeTempDir('wave328-deep-')
    const missingSegs = Array.from({ length: 120 }, (_, i) => `missing_${i}`)
    const deepMissing = join(dir, ...missingSegs)
    const resolved = resolveDeepestExistingAncestorSync(
      getFsImplementation(),
      deepMissing,
    )
    expect(resolved).toBe(join(realpathSync(dir), ...missingSegs))

    // Very long text with URL-like scheme should redact in linear time (no ReDoS)
    const longFiller = 'a'.repeat(150_000)
    const text = `https://user:supersecretpass@example.com/path ${longFiller} https://notuserinfo`
    const start = performance.now()
    const redacted = redactSecrets(text)
    const elapsedMs = performance.now() - start
    expect(redacted).not.toContain('supersecretpass')
    expect(elapsedMs).toBeLessThan(500)
  })

  test('#501: opaque symlink targets and >32 symlink hops mark permission path walk unresolved', () => {
    expect(isOpaqueSymlinkTarget('/proc/self/root/etc/passwd')).toBe(true)
    expect(isOpaqueSymlinkTarget('/dev/fd/3')).toBe(true)
    expect(isOpaqueSymlinkTarget('bad\uFFFDname')).toBe(true)
    expect(isOpaqueSymlinkTarget('/tmp/normal/file.txt')).toBe(false)

    const dir = makeTempDir('wave328-sym-')
    // Create a chain of 35 symlinks (> MAX_SYMLINK_HOPS = 32)
    const target = join(dir, 'target.txt')
    writeFileSync(target, 'ok')
    let prev = target
    for (let i = 0; i < 35; i++) {
      const link = join(dir, `link_${i}`)
      symlinkSync(prev, link)
      prev = link
    }
    const walked = walkPermissionPaths(prev)
    expect(walked.unresolved).toBe(true)
  })

  test('#502: pathInWorkingPath disables folderIdentity fallback by default', () => {
    const dir = makeTempDir('wave328-wd-')
    const realSub = join(dir, 'real')
    const linkSub = join(dir, 'alias')
    mkdirSync(realSub)
    symlinkSync(realSub, linkSub)
    const viaLink = join(linkSub, 'file.ts')
    // By default (folderIdentity not opted in), lexical mismatch returns false
    expect(pathInWorkingPath(viaLink, realSub)).toBe(false)
    // Explicit folderIdentity: true allows inode match
    expect(pathInWorkingPath(viaLink, realSub, { folderIdentity: true })).toBe(
      true,
    )
  })

  test('#503 & #504: outsideReads helpers build bypass-immune circuit-breaker asks', () => {
    const runtimeAsk = buildOutsideReadRuntimePathAsk('env PATH=/tmp foo')
    expect(runtimeAsk.behavior).toBe('ask')
    expect(isOutsideReadsBlockedReason(runtimeAsk.decisionReason)).toBe(true)

    const unanalyzable = buildOutsideReadUnanalyzableAsk('too complex')
    expect(unanalyzable.behavior).toBe('ask')
    expect(isOutsideReadsBlockedReason(unanalyzable.decisionReason)).toBe(true)
  })

  test('#505: auto mode server fallback billing notice mentions upcoming removal', () => {
    const notice = autoModeClassifierBillingNoticeCopy({
      gatewayHost: undefined,
    })
    const joined = notice.paragraphs.join('\n')
    expect(joined).toContain('An upcoming release removes this fallback.')
    expect(joined).toContain(
      'In sessions like this one, each checked action will then be asked about or denied.',
    )
  })

  test('#506: auto mode ignores more package-runner allow rules & path/version forms', () => {
    expect(CROSS_PLATFORM_CODE_EXEC).toContain('pnpm dlx')
    expect(CROSS_PLATFORM_CODE_EXEC).toContain('yarn dlx')
    expect(CROSS_PLATFORM_CODE_EXEC).toContain('bun x')
    expect(normalizeBroadRuleProg('/usr/bin/python3.11')).toBe('python')
    expect(normalizeBroadRuleContent('/usr/bin/npm run:*')).toBe('npm run:*')
    expect(isDangerousBashPermission('Bash', 'pnpm dlx *')).toBe(true)
    expect(isDangerousBashPermission('Bash', '/usr/bin/npm run:*')).toBe(true)
    expect(
      isDangerousBashPermission('Bash', '/usr/local/bin/python3.12:*'),
    ).toBe(true)
  })

  test('#511 & #512: --worktree relative --add-dir beside vs above launch folder', () => {
    const launchFolder = '/repo/app'
    const worktreeDir = '/repo/.claude/worktrees/feat-1'

    // #511: relative beside launch folder -> resolves against launch folder, NOT worktree
    const beside = resolveWorktreeAddDirEntry(
      '../sibling',
      launchFolder,
      true,
      rel => join(worktreeDir, rel),
    )
    expect(beside).toBe(resolve(launchFolder, '../sibling'))

    // Relative inside launch folder -> maps inside worktree
    const inside = resolveWorktreeAddDirEntry(
      './extra',
      launchFolder,
      true,
      rel => join(worktreeDir, rel),
    )
    expect(inside).toBe(join(worktreeDir, 'extra'))

    // #512: relative ABOVE launch folder (`..`) -> collapses to ONLY the worktree
    const above = resolveWorktreeAddDirEntry('..', launchFolder, true, rel =>
      join(worktreeDir, rel),
    )
    expect(above).toBe(worktreeDir)

    // #512 for `--bg` child CLI: `..` collapses to worktree-local `.` (`./`)
    const bgAbove = rewriteAddDirForBgWorktree('..', launchFolder, true)
    expect(bgAbove === '.' || bgAbove === './').toBe(true)
  })

  test('#541 & #662: Opus 4.6 and Sonnet 4.6 support auto mode on 3P providers', () => {
    for (const provider of ['bedrock', 'vertex', 'foundry'] as const) {
      expect(planModelSupportsAutoMode('claude-opus-4-6', provider)).toBe(true)
      expect(planModelSupportsAutoMode('claude-sonnet-4-6', provider)).toBe(
        true,
      )
    }
    expect(isOldModelForBedrockMantleClassifier('claude-opus-4-6')).toBe(false)
    expect(isOldModelForBedrockMantleClassifier('claude-sonnet-4-6')).toBe(
      false,
    )
    expect(isOldModelForBedrockMantleClassifier('claude-opus-4-5')).toBe(true)
  })

  test('#565: CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS disables server classifier betas on 3P outside Claude Desktop', () => {
    setEnv('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', '1')
    setEnv('CLAUDE_CODE_ENTRYPOINT', 'cli')
    setEnv('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', undefined)
    setEnv('CLAUDE_CODE_AUTO_MODE_SERVER', undefined)
    setEnv('CLAUDE_CODE_USE_BEDROCK', '1')

    expect(isBetasSwitchSetAside()).toBe(false)
    expect(serverClassifierBetasEligible()).toBe(false)
    setEnv('CLAUDE_CODE_USE_BEDROCK', undefined)
    setEnv('CLAUDE_CODE_USE_VERTEX', '1')
    expect(serverClassifierBetasEligible()).toBe(false)
    setEnv('CLAUDE_CODE_USE_VERTEX', undefined)
    setEnv('CLAUDE_CODE_USE_FOUNDRY', '1')
    expect(serverClassifierBetasEligible()).toBe(false)
  })

  test('#627: secretScanner gracefully falls back on OOM instead of crashing', () => {
    const reported: unknown[] = []
    setSecretScannerErrorReporter(err => reported.push(err))
    setSecretScannerMemoryProbeForTest(() => {
      throw new RangeError('Out of memory')
    })

    expect(redactSecrets('sk-ant-api03-abcdefghijklmnopqrstuv')).toBe(
      SECRET_REDACTION_OOM_FALLBACK,
    )
    expect(redactSecretsForDisplay('sk-ant-api03-abcdefghijklmnopqrstuv')).toBe(
      SECRET_REDACTION_OOM_FALLBACK,
    )
    expect(scanForSecrets('sk-ant-api03-abcdefghijklmnopqrstuv')).toEqual([])
    expect(reported.length).toBeGreaterThan(0)
  })

  test('#628: isEscapingGitRefFile allows non-UTF-8 branch names on Linux/WSL', () => {
    const dir = makeTempDir('wave328-githead-')
    const headFile = join(dir, 'HEAD')
    // Non-UTF-8 bytes (0x80 0xFF) inside a valid refs/heads/ branch name
    writeFileSync(
      headFile,
      Buffer.concat([
        Buffer.from('ref: refs/heads/feat-'),
        Buffer.from([0x80, 0xff]),
        Buffer.from('\n'),
      ]),
    )
    // On Linux/WSL (allowNonUtf8=true), non-UTF-8 branch name is NOT treated as escaping
    expect(isEscapingGitRefFile(headFile, true)).toBe(false)
    // Escaping symref target (`../config`) is still detected as escaping on Linux/WSL
    const escapeFile = join(dir, 'BAD_HEAD')
    writeFileSync(escapeFile, 'ref: refs/heads/../../config\n')
    expect(isEscapingGitRefFile(escapeFile, true)).toBe(true)
  })

  test('#676: failed sandbox init refuses next command and disables sandbox for session when not required', async () => {
    const configDir = makeTempDir('wave328-sbx-fail-')
    setEnv('CLAUDE_CONFIG_DIR', configDir)
    setAllowedSettingSources(['userSettings'])
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ sandbox: { enabled: true } }),
    )
    resetSettingsCache()
    _setSandboxInitFailureForTesting('bwrap missing')

    // Internal command (keepsSandboxOn: true) keeps sandbox on
    let internalErr: unknown
    try {
      await ensureInitializedForWrap({ keepsSandboxOn: true })
    } catch (err) {
      internalErr = err
    }
    expect(internalErr).toBeInstanceOf(SandboxInitFailedError)
    expect((internalErr as Error).message).toContain(
      "This command of Claude Code's own was not run; the sandbox stays on",
    )
    expect(isSandboxDisabledThisSession()).toBe(false)

    // User/model Bash command (keepsSandboxOn: false) disables sandbox for rest of session
    let bashErr: unknown
    try {
      await ensureInitializedForWrap({ keepsSandboxOn: false })
    } catch (err) {
      bashErr = err
    }
    expect(bashErr).toBeInstanceOf(SandboxInitFailedError)
    expect((bashErr as Error).message).toContain(
      'Sandboxing is disabled for the rest of this session; restart to retry.',
    )
    expect(isSandboxDisabledThisSession()).toBe(true)
    expect(SandboxManager.isSandboxingEnabled()).toBe(false)

    // Once disabled for the session, ensureInitializedForWrap returns cleanly without throwing
    await expect(
      ensureInitializedForWrap({ keepsSandboxOn: false }),
    ).resolves.toBeUndefined()
  })

  test('#489 regression: redactUrlUserinfoLinear redacts nested URL userinfo after query param', () => {
    const nested = 'https://proxy?next=https://user:secret@internal.corp'
    const redacted = redactUrlUserinfoLinear(nested)
    expect(redacted).toBe('https://proxy?next=https://[REDACTED]@internal.corp')
    expect(redacted).not.toContain('secret')
    expect(redactSecrets(nested)).toBe(
      'https://proxy?next=https://[REDACTED]@internal.corp',
    )
  })

  test('#503/#504 regression: interpreter stdin and compound cd relative path under read block', () => {
    const ctx: ToolPermissionContext = {
      mode: 'bypassPermissions',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: true,
      blockReadsOutsideWorkingDirectories: true,
    }
    // Official 2.1.328 (`KYr` + `UYr`): per-subcommand `checkBashArgvUnderOutsideReadsBlock`
    // checks explicit `-` (stdin) so `python3 --version`/`node --version` are not falsely
    // blocked; `isStdinCodeInterpreterArgv` (`UYr`) detects bare/flag-only interpreters when
    // stdin is supplied (`<<`, `<<<`, or piped `|`).
    expect(isStdinCodeInterpreterArgv(['python3'])).toBe(true)
    expect(isStdinCodeInterpreterArgv(['python3', '-u'])).toBe(true)
    expect(
      checkBashArgvUnderOutsideReadsBlock(
        ['python3', '--version'],
        '/work',
        ctx,
      ),
    ).toBeUndefined()

    const dashStdinPy = checkBashArgvUnderOutsideReadsBlock(
      ['python3', '-'],
      '/work',
      ctx,
    )
    expect(dashStdinPy?.behavior).toBe('ask')
    if (dashStdinPy?.behavior === 'ask') {
      expect(isOutsideReadsBlockedReason(dashStdinPy.decisionReason)).toBe(true)
    }

    // `cd /etc && strings passwd` -> hasCdInCompound: true with relative 'passwd'
    const cdStrings = checkBashArgvUnderOutsideReadsBlock(
      ['strings', 'passwd'],
      '/work',
      ctx,
      { hasCdInCompound: true },
    )
    expect(cdStrings?.behavior).toBe('ask')
    if (cdStrings?.behavior === 'ask') {
      expect(isOutsideReadsBlockedReason(cdStrings.decisionReason)).toBe(true)
    }
  })

  test('#511/#512 regression: post-worktree reconcile removes pre-worktree CLI add-dirs and keeps sibling', async () => {
    const root = makeTempDir('wave328-wt-reconcile-')
    const launchDir = join(root, 'app')
    const launchSub = join(launchDir, 'sub')
    const siblingDir = join(root, 'sibling')
    const worktreeDir = join(root, 'wt')
    const worktreeSub = join(worktreeDir, 'sub')
    mkdirSync(launchSub, { recursive: true })
    mkdirSync(siblingDir, { recursive: true })
    mkdirSync(worktreeSub, { recursive: true })

    setAdditionalDirectoriesForClaudeMd(['..', './sub', '../sibling'])
    const prevPinned = pinAddDirsForWorktreeLaunch(launchDir, true, launchDir)
    expect(prevPinned).toEqual([launchDir, launchSub, siblingDir])

    const preContext: ToolPermissionContext = {
      mode: 'default',
      additionalWorkingDirectories: new Map([
        [launchDir, { path: launchDir, source: 'cliArg' }],
        [launchSub, { path: launchSub, source: 'cliArg' }],
        [siblingDir, { path: siblingDir, source: 'cliArg' }],
      ]),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    }

    const repinned = repinAddDirsAfterWorktreeEnter(worktreeDir)
    expect(repinned).toEqual([worktreeDir, worktreeSub, siblingDir])

    const { toolPermissionContext: updated } =
      await applyRepinnedWorktreeAddDirsToPermissionContext(
        preContext,
        prevPinned,
        repinned,
      )
    // Stale pre-worktree launchDir / launchSub removed; siblingDir & worktree entries retained
    expect(updated.additionalWorkingDirectories.has(launchDir)).toBe(false)
    expect(updated.additionalWorkingDirectories.has(launchSub)).toBe(false)
    expect(updated.additionalWorkingDirectories.has(siblingDir)).toBe(true)
    expect(updated.additionalWorkingDirectories.has(root)).toBe(false)
    setAdditionalDirectoriesForClaudeMd([])
  })

  test('#565 regression: isBetasSwitchSetAside returns false behind custom gateway or unix socket even in Claude Desktop', () => {
    setEnv('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', '1')
    setEnv('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', '1')
    setEnv('CLAUDE_CODE_ENTRYPOINT', 'claude-desktop')
    setEnv('CLAUDE_CODE_USE_BEDROCK', undefined)
    setEnv('CLAUDE_CODE_USE_VERTEX', undefined)
    setEnv('CLAUDE_CODE_USE_FOUNDRY', undefined)
    setEnv('CLAUDE_CODE_SIMULATE_PROXY_USAGE', undefined)
    setEnv('CLAUDE_CODE_AUTO_MODE_SERVER', undefined)

    // Custom gateway URL on firstParty -> must NOT set aside CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
    setEnv('ANTHROPIC_BASE_URL', 'https://custom-gateway.internal.corp')
    setEnv('ANTHROPIC_UNIX_SOCKET', undefined)
    expect(isBetasSwitchSetAside()).toBe(false)

    // Unix socket on firstParty -> must NOT set aside
    setEnv('ANTHROPIC_BASE_URL', undefined)
    setEnv('ANTHROPIC_UNIX_SOCKET', '/tmp/anthropic.sock')
    expect(isBetasSwitchSetAside()).toBe(false)
  })

  test('#489/#501 regression: binary-search EACCES fallback & relative opaque dangling symlink target', () => {
    // 1. Relative opaque target like `../../\\server\share` on a dangling symlink
    //    must mark walkPermissionPaths unresolved (not neutralized by path.resolve).
    const dir = makeTempDir('wave328-rel-opaque-')
    const nestedDir = join(dir, 'a', 'b')
    mkdirSync(nestedDir, { recursive: true })
    const badLink = join(nestedDir, 'badlink')
    symlinkSync('../../\\\\server\\share', badLink)
    const walked = walkPermissionPaths(join(badLink, 'child.txt'))
    expect(walked.unresolved).toBe(true)

    // 2. Binary search encountering EACCES at mid-depth falls back to linear walk-up
    //    and still resolves an existing symlink ancestor above the EACCES prefix.
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const mockFs = {
      lstatSync(p: string) {
        if (p === '/a/b/c') {
          return { isSymbolicLink: () => true } as ReturnType<
            FsOperations['lstatSync']
          >
        }
        if (p === '/a/b/c/d/e/f') {
          throw eacces
        }
        throw enoent
      },
      readlinkSync(p: string) {
        if (p === '/a/b/c') return '/real/target'
        throw enoent
      },
      realpathSync(p: string) {
        if (p === '/a/b/c') return '/real/target'
        throw enoent
      },
    } as unknown as FsOperations
    const deep = '/a/b/c/d/e/f/g/h/i/j/k/l'
    expect(resolveDeepestExistingAncestorSync(mockFs, deep)).toBe(
      '/real/target/d/e/f/g/h/i/j/k/l',
    )
  })

  test('#627 regression: secretScanner memory headroom probe runs once per lazy rule compilation', () => {
    let probeCalls = 0
    setSecretScannerMemoryProbeForTest(() => {
      probeCalls++
    })
    redactSecrets('hello world 1')
    redactSecrets('hello world 2')
    redactSecrets('hello world 3')
    expect(probeCalls).toBe(1)
  })

  test('#413 regression: FileStateCache marks refreshedBehindModel not full-enough and skips compaction retention', () => {
    const cache = new FileStateCache(10, 1024 * 1024)
    const p = '/tmp/refreshed.ts'
    cache.set(p, {
      content: 'const x = 1',
      timestamp: Date.now(),
      offset: undefined,
      limit: undefined,
      refreshedBehindModel: true,
    })
    expect(isFullEnoughFileRead(cache.get(p)!)).toBe(false)
    cache.clearForCompaction()
    expect(cache.readBeforeCompaction(p)).toBeUndefined()
  })
})
