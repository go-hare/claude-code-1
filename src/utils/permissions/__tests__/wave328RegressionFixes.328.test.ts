import { afterEach, describe, expect, test } from 'bun:test'
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { ENTER_WORKTREE_TOOL_NAME } from '@claude-code/builtin-tools/tools/EnterWorktreeTool/constants.js'
import { EXIT_WORKTREE_TOOL_NAME } from '@claude-code/builtin-tools/tools/ExitWorktreeTool/constants.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import { WebFetchTool } from '@claude-code/builtin-tools/tools/WebFetchTool/WebFetchTool.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  getAllowedSettingSources,
  getOriginalCwd,
  setAdditionalDirectoriesForClaudeMd,
  setAllowedSettingSources,
  setOriginalCwd,
} from '../../../bootstrap/state.js'
import type { Tool, ToolPermissionContext } from '../../../Tool.js'
import { FileStateCache, isFullEnoughFileRead } from '../../fileStateCache.js'
import { expandPath } from '../../path.js'
import {
  _resetSandboxHeldStateForTesting,
  convertToSandboxRuntimeConfig,
  ensureInitializedForWrap,
} from '../../sandbox/sandbox-adapter.js'
import { buildShellSpawnEnv } from '../../Shell.js'
import type { SettingSource } from '../../settings/constants.js'
import { getManagedSettingsDropInDir } from '../../settings/managedPath.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import {
  checkBlockWritesOutsideWorkingDirectories,
  checkWritePermissionForTool,
  isClaudeSignInFilePath,
} from '../filesystem.js'
import { hasBypassImmuneNonClassifierAlsoBreaker } from '../nhoGates.js'
import {
  checkBashArgvUnderOutsideReadsBlock,
  isOutsideReadsBlockedReason,
  stripOutsideReadsWrapperCommands,
} from '../outsideReads.js'
import { applyPermissionUpdate } from '../PermissionUpdate.js'
import {
  applyBlockWritesOutsideWorkingDirectories,
  initializeToolPermissionContext,
} from '../permissionSetup.js'
import { syncPermissionRulesFromDisk } from '../permissions.js'

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
const origCwd = getOriginalCwd()
const origAddDirs = [...getAdditionalDirectoriesForClaudeMd()]

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete savedEnv[k]
  }
  setAllowedSettingSources([...origSources])
  setOriginalCwd(origCwd)
  setAdditionalDirectoriesForClaudeMd([...origAddDirs])
  resetSettingsCache()
  _resetSandboxHeldStateForTesting()
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

function makeEmptyPermissionContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

describe('Regression Fix Agent 1 (P0/P1/P2 fixes)', () => {
  test('P0-1: sandbox blockReadsOutsideWorkingDirectories reopens cwd & subdirs without exposing bare claudeDir', () => {
    const configDir = makeTempDir('reg1-claude-cfg-')
    setEnv('CLAUDE_CONFIG_DIR', configDir)
    setAllowedSettingSources(['userSettings'])
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({
        permissions: { blockReadsOutsideWorkingDirectories: true },
      }),
    )
    resetSettingsCache()

    const cfg = convertToSandboxRuntimeConfig({})
    const allowRead = cfg.filesystem.allowRead ?? []
    // originalCwd must be reopened (existingDenies snapshot taken BEFORE fenceRoots)
    expect(allowRead).toContain(getOriginalCwd())
    // Explicit subdirs are reopened, NOT bare claudeDir (protects ~/.claude/.credentials.json)
    expect(allowRead).toContain(join(configDir, 'skills'))
    expect(allowRead).toContain(join(configDir, 'shell-snapshots'))
    expect(allowRead).not.toContain(configDir)
  })

  test('P0-2: blockWritesOutsideWorkingDirectories wires into init & reload and allows regular .json files inside cwd', async () => {
    const configDir = makeTempDir('reg2-claude-cfg-')
    setEnv('CLAUDE_CONFIG_DIR', configDir)
    setAllowedSettingSources(['userSettings'])
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({
        permissions: { blockWritesOutsideWorkingDirectories: true },
      }),
    )
    resetSettingsCache()

    // Direct helper mirrors official jLo (`[uT, AZ]` = EnterWorktree / ExitWorktree)
    const narrowed = applyBlockWritesOutsideWorkingDirectories(
      makeEmptyPermissionContext(),
    )
    expect(narrowed.blockWritesOutsideWorkingDirectories).toBe(true)
    expect(narrowed.alwaysDenyRules.toolsNarrowing).toContain(
      ENTER_WORKTREE_TOOL_NAME,
    )
    expect(narrowed.alwaysDenyRules.toolsNarrowing).toContain(
      EXIT_WORKTREE_TOOL_NAME,
    )
    expect(narrowed.alwaysDenyRules.toolsNarrowing).not.toContain(
      BASH_TOOL_NAME,
    )
    expect(narrowed.alwaysDenyRules.toolsNarrowing).not.toContain(
      POWERSHELL_TOOL_NAME,
    )

    // Init path wires blockWritesOutsideWorkingDirectories + toolsNarrowing
    const initResult = await initializeToolPermissionContext({
      allowedToolsCli: [],
      disallowedToolsCli: [],
      baseToolsCli: undefined,
      permissionMode: 'default',
      allowDangerouslySkipPermissions: false,
      addDirs: [],
    })
    expect(
      initResult.toolPermissionContext.blockWritesOutsideWorkingDirectories,
    ).toBe(true)
    expect(
      initResult.toolPermissionContext.alwaysDenyRules.toolsNarrowing,
    ).toContain(ENTER_WORKTREE_TOOL_NAME)
    expect(
      initResult.toolPermissionContext.alwaysDenyRules.toolsNarrowing,
    ).toContain(EXIT_WORKTREE_TOOL_NAME)
    expect(
      initResult.toolPermissionContext.alwaysDenyRules.toolsNarrowing,
    ).not.toContain(BASH_TOOL_NAME)
    expect(
      initResult.toolPermissionContext.alwaysDenyRules.toolsNarrowing,
    ).not.toContain(POWERSHELL_TOOL_NAME)

    // Reload path (`syncPermissionRulesFromDisk`) also applies it
    const synced = syncPermissionRulesFromDisk(makeEmptyPermissionContext(), [])
    expect(synced.blockWritesOutsideWorkingDirectories).toBe(true)
    expect(synced.alwaysDenyRules.toolsNarrowing).toContain(
      ENTER_WORKTREE_TOOL_NAME,
    )
    expect(synced.alwaysDenyRules.toolsNarrowing).toContain(
      EXIT_WORKTREE_TOOL_NAME,
    )
    expect(synced.alwaysDenyRules.toolsNarrowing).not.toContain(BASH_TOOL_NAME)
    expect(synced.alwaysDenyRules.toolsNarrowing).not.toContain(
      POWERSHELL_TOOL_NAME,
    )

    // Regular `.json` inside cwd is NOT blocked; `.claude/settings.json` and managed drop-in `.json` ARE blocked
    const cwd = getOriginalCwd()
    expect(
      checkBlockWritesOutsideWorkingDirectories(
        join(cwd, 'package.json'),
        synced,
      ),
    ).toBeUndefined()
    expect(
      checkBlockWritesOutsideWorkingDirectories(
        join(cwd, 'tsconfig.json'),
        synced,
      ),
    ).toBeUndefined()
    expect(
      checkBlockWritesOutsideWorkingDirectories(
        join(cwd, '.claude', 'settings.json'),
        synced,
      ),
    ).toContain('Writes to Claude Code settings files are blocked')
    expect(
      checkBlockWritesOutsideWorkingDirectories(
        join(getManagedSettingsDropInDir(), 'policy.json'),
        synced,
      ),
    ).toBeDefined()
  })

  test('P0-3: ensureInitializedForWrap attempts initialize() regardless of keepsSandboxOn', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../sandbox/sandbox-adapter.ts'),
      'utf-8',
    )
    const start = src.indexOf('export async function ensureInitializedForWrap')
    const end = src.indexOf('async function wrapWithSandbox', start)
    const body = src.slice(start, end)
    const initIfBlock = body.slice(0, body.indexOf('await initialize('))
    expect(initIfBlock).not.toContain('keepsSandboxOn !== false')
    // keepsSandboxOn is still checked when deciding whether failed init disables sandbox
    const postInit = body.slice(body.indexOf('await initialize('))
    expect(postInit).toContain('keepsSandboxOn !== false')
  })

  test('P0-4: headless PermissionRequest hook checks accountMemory rewrite and checkRuleBasedPermissions BEFORE recordSandboxStateAtHookRewrite', () => {
    const src = readFileSync(
      join(import.meta.dir, '../permissions.ts'),
      'utf-8',
    )
    const start = src.indexOf(
      'async function runPermissionRequestHooksForHeadlessAgent',
    )
    const end = src.indexOf("if (decision.behavior === 'deny')", start)
    const allowBlock = src.slice(start, end)
    const idxAcctMem = allowBlock.indexOf('didAccountMemoryHookRewriteInput')
    const idxRuleCheck = allowBlock.indexOf('checkRuleBasedPermissions(')
    const idxCrashOpt = allowBlock.indexOf('crashIsObjection: true')
    const idxRecordSandbox = allowBlock.indexOf(
      'recordSandboxStateAtHookRewrite(',
    )
    expect(idxAcctMem).toBeGreaterThan(-1)
    expect(idxRuleCheck).toBeGreaterThan(idxAcctMem)
    expect(idxCrashOpt).toBeGreaterThan(idxRuleCheck)
    expect(idxRecordSandbox).toBeGreaterThan(idxCrashOpt)
  })

  test('P1-6: hasBypassImmuneNonClassifierAlsoBreaker detects bypass-immune non-classifier secondary breakers', () => {
    expect(
      hasBypassImmuneNonClassifierAlsoBreaker({
        also: ['outsideReadsBlocked'],
      }),
    ).toBe(true)
    expect(
      hasBypassImmuneNonClassifierAlsoBreaker({
        also: ['dangerousRemoval'],
      }),
    ).toBe(false)
    expect(hasBypassImmuneNonClassifierAlsoBreaker({})).toBe(false)
  })

  test('P1-8: WebFetchTool checks deny/ask/allow rules before preapproved host and respects CLAUDE_CODE_EVAL_CONFINED', async () => {
    const makeCtx = (ctx: ToolPermissionContext) =>
      ({
        getAppState: () => ({ toolPermissionContext: ctx }),
      }) as never

    // Explicit deny beats preapproved host
    const denied = await WebFetchTool.checkPermissions(
      { url: 'https://docs.claude.com/en/home', prompt: 'read' },
      makeCtx(
        makeEmptyPermissionContext({
          alwaysDenyRules: {
            userSettings: ['WebFetch(domain:docs.claude.com)'],
          },
        }),
      ),
    )
    expect(denied.behavior).toBe('deny')

    // Explicit ask beats preapproved host
    const asked = await WebFetchTool.checkPermissions(
      { url: 'https://docs.claude.com/en/home', prompt: 'read' },
      makeCtx(
        makeEmptyPermissionContext({
          alwaysAskRules: {
            userSettings: ['WebFetch(domain:docs.claude.com)'],
          },
        }),
      ),
    )
    expect(asked.behavior).toBe('ask')

    // CLAUDE_CODE_EVAL_CONFINED disables preapproved host auto-allow
    setEnv('CLAUDE_CODE_EVAL_CONFINED', '1')
    const confined = await WebFetchTool.checkPermissions(
      { url: 'https://docs.claude.com/en/home', prompt: 'read' },
      makeCtx(makeEmptyPermissionContext()),
    )
    expect(confined.behavior).toBe('ask')
  })

  test('P1-9: isClaudeSignInFilePath catches hard links and checkWritePermissionForTool emits claudeSettingsFile safetyCheck', () => {
    const configDir = makeTempDir('reg9-signin-')
    setEnv('CLAUDE_CONFIG_DIR', configDir)
    const credsPath = join(configDir, '.credentials.json')
    writeFileSync(credsPath, '{"token":"secret"}')
    const hardlinkPath = join(configDir, 'not-creds.txt')
    linkSync(credsPath, hardlinkPath)

    expect(isClaudeSignInFilePath(hardlinkPath)).toBe(true)

    const fakeWriteTool = {
      name: 'Write',
      getPath: (input: { file_path: string }) => input.file_path,
    } as unknown as Tool
    const decision = checkWritePermissionForTool(
      fakeWriteTool,
      { file_path: hardlinkPath },
      makeEmptyPermissionContext(),
    )
    expect(decision.behavior).toBe('deny')
    expect(decision.decisionReason).toMatchObject({
      type: 'safetyCheck',
      classifierApprovable: false,
      circuitBreaker: 'claudeSettingsFile',
    })
  })

  test('P1-10: applyPermissionUpdate removeRules for allow also removes downgraded session rule', () => {
    const rule = {
      toolName: 'Bash',
      ruleContent: 'curl https://secret.example',
    }
    const ctx = makeEmptyPermissionContext({
      alwaysAllowRules: {
        localSettings: ['Bash(curl https://secret.example)'],
        session: ['Bash(curl https://secret.example)'],
      },
    })
    const updated = applyPermissionUpdate(ctx, {
      type: 'removeRules',
      rules: [rule],
      behavior: 'allow',
      destination: 'localSettings',
    })
    expect(updated.alwaysAllowRules.localSettings ?? []).not.toContain(
      'Bash(curl https://secret.example)',
    )
    expect(updated.alwaysAllowRules.session ?? []).not.toContain(
      'Bash(curl https://secret.example)',
    )
  })

  test('P1-11: FileStateCache persists fullFileRead before stripping >4 KiB content', () => {
    const cache = new FileStateCache(10, 1024 * 1024)
    const bigContent = `${'x'.repeat(100)}\n`.repeat(60) // ~6 KiB, 61 lines
    cache.set('/tmp/big-full.txt', {
      content: bigContent,
      timestamp: 1,
      offset: 1,
      limit: 2000,
    })
    const fullEntry = cache.get('/tmp/big-full.txt')!
    expect(fullEntry.content).toBe('')
    expect(fullEntry.fullFileRead).toBe(true)
    expect(isFullEnoughFileRead(fullEntry)).toBe(true)

    cache.set('/tmp/big-partial.txt', {
      content: bigContent,
      timestamp: 1,
      offset: 1,
      limit: 50,
    })
    const partialEntry = cache.get('/tmp/big-partial.txt')!
    expect(partialEntry.content).toBe('')
    expect(partialEntry.fullFileRead).toBe(false)
    expect(isFullEnoughFileRead(partialEntry)).toBe(false)
  })

  test('P1-12: buildShellSpawnEnv deletes SHELLOPTS and sandbox BASH_ENV/ENV after merging envOverrides', () => {
    const env = buildShellSpawnEnv({
      shellType: 'bash',
      binShell: '/bin/bash',
      shouldUseSandbox: true,
      envOverrides: {
        SHELLOPTS: 'errexit:pipefail',
        BASH_ENV: '/tmp/evil-bash-env.sh',
        ENV: '/tmp/evil-env.sh',
        SAFE_VAR: 'kept',
      },
    })
    expect(env.SHELLOPTS).toBeUndefined()
    expect(env.BASH_ENV).toBeUndefined()
    expect(env.ENV).toBeUndefined()
    expect(env.SAFE_VAR).toBe('kept')
  })

  test('Final Polish A-2: sandbox blockReadsOutsideWorkingDirectories fences ~/ & /Users/, reopens /Users/apple/proj even with Read(.env) deny, and blocks reopening under /Users/apple/secrets deny', () => {
    const configDir = makeTempDir('reg-a2-cfg-')
    setEnv('CLAUDE_CONFIG_DIR', configDir)
    setAllowedSettingSources(['userSettings'])
    setOriginalCwd('/Users/apple/proj')
    setAdditionalDirectoriesForClaudeMd([
      '/Users/apple/extra-cli-dir',
      '/Users/apple/secrets/sub',
    ])
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({
        permissions: {
          blockReadsOutsideWorkingDirectories: true,
          deny: ['Read(//Users/apple/proj/.env)'],
        },
        sandbox: {
          filesystem: {
            denyRead: ['/Users/apple/secrets', '~/private-vault'],
          },
        },
      }),
    )
    resetSettingsCache()

    const cfg = convertToSandboxRuntimeConfig({})
    const denyRead = cfg.filesystem.denyRead ?? []
    const allowRead = cfg.filesystem.allowRead ?? []

    // Pre-existing Read(.env) deny inside cwd IS present in denyRead
    expect(denyRead).toContain('/Users/apple/proj/.env')

    // Fence roots ~/ and /Users/ MUST be added to denyRead (not skipped just because cwd is inside them!)
    expect(denyRead).toContain(expandPath('~/'))
    expect(denyRead).toContain(expandPath('/Users/'))
    expect(denyRead).toContain(homedir())

    // /Users/apple/proj and CLI --add-dir /Users/apple/extra-cli-dir MUST be reopened
    // even though Read(/Users/apple/proj/.env) is an existing deny inside cwd
    expect(allowRead).toContain('/Users/apple/proj')
    expect(allowRead).toContain('/Users/apple/extra-cli-dir')

    // Pre-existing deny on /Users/apple/secrets MUST block reopening /Users/apple/secrets/sub
    expect(allowRead).not.toContain('/Users/apple/secrets/sub')

    // Also verify tilde-prefixed existing deny (~/private-vault) blocks reopening a subdir under it
    setAdditionalDirectoriesForClaudeMd([
      join(homedir(), 'private-vault', 'nested'),
    ])
    const cfg2 = convertToSandboxRuntimeConfig({})
    expect(cfg2.filesystem.allowRead ?? []).not.toContain(
      join(homedir(), 'private-vault', 'nested'),
    )
  })

  test('Final Polish A-3a: outsideReads strips wrapper commands before interpreter/xargs/git checks', () => {
    const ctx = makeEmptyPermissionContext({
      mode: 'bypassPermissions',
      isBypassPermissionsModeAvailable: true,
      blockReadsOutsideWorkingDirectories: true,
    })

    // Direct stripOutsideReadsWrapperCommands checks
    expect(
      stripOutsideReadsWrapperCommands([
        'env',
        'CI=1',
        'python3',
        '-c',
        'print(1)',
      ]),
    ).toEqual(['python3', '-c', 'print(1)'])
    expect(
      stripOutsideReadsWrapperCommands([
        'timeout',
        '-k',
        '2',
        '5s',
        'python3',
        '-c',
        'print(1)',
      ]),
    ).toEqual(['python3', '-c', 'print(1)'])
    expect(
      stripOutsideReadsWrapperCommands([
        'nohup',
        'time',
        'nice',
        '-n',
        '10',
        'stdbuf',
        '-o0',
        'command',
        '-p',
        'noglob',
        'builtin',
        'python3',
        '-c',
        'print(1)',
      ]),
    ).toEqual(['python3', '-c', 'print(1)'])

    const wrappedInlineCases: string[][] = [
      ['env', 'python3', '-c', "open('/etc/passwd').read()"],
      ['env', 'CI=1', 'python3', '-c', "open('/etc/passwd').read()"],
      ['/usr/bin/env', 'CI=1', 'node', '-e', 'console.log(1)'],
      ['timeout', '5', 'python3', '-c', "open('/etc/passwd').read()"],
      ['timeout', '--signal=TERM', '10s', 'ruby', '-e', 'puts 1'],
      ['nice', '-n', '5', 'perl', '-e', 'print 1'],
      ['nohup', 'python3', '-c', 'print(1)'],
      ['time', 'sh', '-c', 'cat /etc/passwd'],
      ['stdbuf', '-o0', 'python3', '-c', 'print(1)'],
      ['command', '-p', 'python3', '-c', 'print(1)'],
      ['noglob', 'python3', '-c', 'print(1)'],
      ['env', 'CI=1', 'xargs', 'cat'],
    ]
    for (const argv of wrappedInlineCases) {
      const res = checkBashArgvUnderOutsideReadsBlock(argv, '/work', ctx)
      expect(res?.behavior).toBe('ask')
      if (res?.behavior === 'ask') {
        expect(isOutsideReadsBlockedReason(res.decisionReason)).toBe(true)
      }
    }

    // Wrapped `git -C /etc status` still checks -C target
    const outsideDir = makeTempDir('reg-a3-outside-')
    const gitRes = checkBashArgvUnderOutsideReadsBlock(
      ['timeout', '5', 'git', '-C', outsideDir, 'status'],
      '/work',
      ctx,
    )
    expect(gitRes?.behavior).toBe('ask')
    if (gitRes?.behavior === 'ask') {
      expect(isOutsideReadsBlockedReason(gitRes.decisionReason)).toBe(true)
    }
  })

  test('Final Polish A-3b: outsideReads checkNamedPath walks symlinks against read/edit deny rules (#504)', () => {
    const workDir = makeTempDir('reg-a3-sym-cwd-')
    const secretFile = join(workDir, '.env')
    writeFileSync(secretFile, 'API_KEY=secret\n')
    const linkInsideCwd = join(workDir, 'innocent.txt')
    symlinkSync(secretFile, linkInsideCwd)

    const outsideSecretDir = makeTempDir('reg-a3-sym-secret-')
    const outsideSecretFile = join(outsideSecretDir, 'token.txt')
    writeFileSync(outsideSecretFile, 'tok\n')
    const linkToSecretDir = join(workDir, 'linked-dir')
    symlinkSync(outsideSecretDir, linkToSecretDir)

    const ctx = makeEmptyPermissionContext({
      mode: 'bypassPermissions',
      isBypassPermissionsModeAvailable: true,
      blockReadsOutsideWorkingDirectories: true,
      additionalWorkingDirectories: new Map([
        [workDir, { path: workDir, source: 'cliArg' }],
      ]),
      alwaysDenyRules: {
        userSettings: [
          `Read(//${secretFile.replace(/^\/+/, '')})`,
          `Edit(//${outsideSecretDir.replace(/^\/+/, '')}/**)`,
        ],
      },
    })

    // Symlink inside cwd pointing to denied .env MUST be denied (not allowed as inside-cwd!)
    const fileRes = checkBashArgvUnderOutsideReadsBlock(
      ['strings', 'innocent.txt'],
      workDir,
      ctx,
    )
    expect(fileRes?.behavior).toBe('deny')

    // Symlink dir inside cwd pointing to edit-denied dir MUST be denied on glob prefix too
    const dirGlobRes = checkBashArgvUnderOutsideReadsBlock(
      ['strings', 'linked-dir/*.txt'],
      workDir,
      ctx,
    )
    expect(dirGlobRes?.behavior).toBe('deny')
  })

  test('Final Polish A-5: ensureInitializedForWrap returns cleanly when sandbox is disabled', async () => {
    const configDir = makeTempDir('reg-a5-nosbx-')
    setEnv('CLAUDE_CONFIG_DIR', configDir)
    setAllowedSettingSources(['userSettings'])
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ sandbox: { enabled: false } }),
    )
    resetSettingsCache()

    await expect(
      ensureInitializedForWrap({ keepsSandboxOn: true }),
    ).resolves.toBeUndefined()
    await expect(
      ensureInitializedForWrap({ keepsSandboxOn: false }),
    ).resolves.toBeUndefined()
  })
})
