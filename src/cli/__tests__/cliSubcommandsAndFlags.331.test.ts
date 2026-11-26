import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Command } from '@commander-js/extra-typings'
import { registerMcpXaaIdpCommand } from '../../commands/mcp/xaaIdpCommand.js'
import { registerApplyProjectSettingsCommand } from '../handlers/applyProjectSettings.js'
import { filterAutoModeRulesByLabel } from '../handlers/autoMode.js'
import {
  getCommandWordHint,
  isRetiredCommandWord,
} from '../handlers/cliSubcommandHint.js'
import {
  registerGatewayCommand,
  validateGatewayConfigPath,
} from '../handlers/gateway.js'
import { validateHookEditRequest } from '../handlers/hookEdit.js'
import {
  parseImportCliArgs,
  registerImportCommands,
  rewriteImportCliArgs,
} from '../handlers/importCli.js'
import {
  computeManifestDiff,
  parseExportBundle,
  runImportConversations,
} from '../handlers/importConversations.js'
import { validateMcpServeOptions } from '../handlers/mcp.js'
import { findOrphanAutoInstalledPlugins } from '../handlers/pluginPrune.js'
import {
  buildPluginScaffoldFiles,
  SCAFFOLD_COMPONENTS,
  validateInitPluginName,
  writePluginScaffoldFiles,
} from '../handlers/pluginScaffold.js'
import {
  buildPluginReleaseTag,
  createPluginGitTag,
  formatTagAnnotationMessage,
  planPluginTag,
} from '../handlers/pluginTag.js'
import {
  getSandboxInstallResult,
  getSandboxStatusPayload,
  getSandboxUninstallResult,
  registerSandboxCommands,
} from '../handlers/sandbox.js'
import { registerVscodeExtensionHostCommands } from '../handlers/vscodeExtensionHost.js'
import {
  buildWorkspaceTrustReport,
  registerWorkspaceTrustCommand,
} from '../handlers/workspaceTrust.js'
import {
  checkWorktreeHookRefusal,
  registerWorktreeHookCommand,
  validateWorktreeHookTask,
} from '../handlers/worktreeHook.js'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const MAIN_SRC = readFileSync(join(REPO_ROOT, 'src/main.tsx'), 'utf8')
const CLI_ENTRY_SRC = readFileSync(
  join(REPO_ROOT, 'src/entrypoints/cli.tsx'),
  'utf8',
)
const PKG_JSON = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
) as { version: string }

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Official 2.1.331 Commander subcommand registration', () => {
  test('registers `claude gateway --config <path>` with mandatory --config', () => {
    const program = new Command().exitOverride()
    const cmd = registerGatewayCommand(program)
    expect(cmd.name()).toBe('gateway')
    expect(cmd.description()).toBe('Run the enterprise auth/telemetry gateway')
    const configOpt = cmd.options.find(o => o.long === '--config')
    expect(configOpt).toBeDefined()
    expect(configOpt?.mandatory).toBe(true)
  })

  test('registers hidden `claude sandbox` with install, status, and uninstall --json', () => {
    const program = new Command().exitOverride()
    const sandboxCmd = registerSandboxCommands(program)
    expect(sandboxCmd.name()).toBe('sandbox')
    const helpText = program.helpInformation()
    expect(helpText).not.toContain('sandbox')

    const subNames = sandboxCmd.commands.map(c => c.name())
    expect(subNames).toEqual(['install', 'status', 'uninstall'])

    const uninstallCmd = sandboxCmd.commands.find(c => c.name() === 'uninstall')
    expect(uninstallCmd?.options.some(o => o.long === '--json')).toBe(true)
  })

  test('registers visible `claude import` and hidden `claude import-conversations`', () => {
    const program = new Command().exitOverride()
    const { importCmd, importConversationsCmd } =
      registerImportCommands(program)

    expect(importCmd.name()).toBe('import')
    expect(importCmd.options.map(o => o.long)).toEqual(['--dry-run', '--yes'])
    expect(program.helpInformation()).toContain('import')

    expect(importConversationsCmd.name()).toBe('import-conversations')
    expect(importConversationsCmd.options.map(o => o.long)).toEqual([
      '--cwd',
      '--dry-run',
    ])
    expect(program.helpInformation()).not.toContain('import-conversations')
  })

  test('registers hidden `claude edit-hook --json` alongside existing VS Code commands', () => {
    const program = new Command().exitOverride()
    registerVscodeExtensionHostCommands(program)
    const editHook = program.commands.find(c => c.name() === 'edit-hook')
    expect(editHook).toBeDefined()
    expect(editHook?.description()).toContain('hook edit')
    const jsonOpt = editHook?.options.find(o => o.long === '--json')
    expect(jsonOpt?.mandatory).toBe(true)
    expect(program.helpInformation()).not.toContain('edit-hook')
  })

  test('registers hidden `claude workspace-trust --json`', () => {
    const program = new Command().exitOverride()
    const cmd = registerWorkspaceTrustCommand(program)
    expect(cmd.name()).toBe('workspace-trust')
    expect(cmd.options.find(o => o.long === '--json')?.mandatory).toBe(true)
    expect(program.helpInformation()).not.toContain('workspace-trust')
  })

  test('registers hidden `claude worktree-hook` with mandatory --json and --event choices', () => {
    const program = new Command().exitOverride()
    const cmd = registerWorktreeHookCommand(program)
    expect(cmd.name()).toBe('worktree-hook')
    expect(program.helpInformation()).not.toContain('worktree-hook')

    const optNames = cmd.options.map(o => o.long)
    expect(optNames).toEqual([
      '--json',
      '--event',
      '--name',
      '--path',
      '--trusted-folder',
    ])
    const eventOpt = cmd.options.find(o => o.long === '--event')
    expect(eventOpt?.mandatory).toBe(true)
    expect(eventOpt?.argChoices).toEqual(['create', 'remove'])
  })

  test('registers hidden `claude apply-project-settings`', () => {
    const program = new Command().exitOverride()
    const cmd = registerApplyProjectSettingsCommand(program)
    expect(cmd.name()).toBe('apply-project-settings')
    expect(cmd.summary()).toContain('cloud sessions')
    expect(program.helpInformation()).not.toContain('apply-project-settings')
  })

  test('registers `claude mcp xaa` subcommands (setup, login, show, clear) and flags', () => {
    const mcp = new Command('mcp').exitOverride()
    registerMcpXaaIdpCommand(mcp)
    const xaa = mcp.commands.find(c => c.name() === 'xaa')
    expect(xaa).toBeDefined()
    expect(xaa?.commands.map(c => c.name())).toEqual([
      'setup',
      'login',
      'show',
      'clear',
    ])

    const setupOpts = xaa?.commands
      .find(c => c.name() === 'setup')
      ?.options.map(o => o.long)
    expect(setupOpts).toEqual(
      expect.arrayContaining([
        '--issuer',
        '--client-id',
        '--client-secret',
        '--callback-port',
      ]),
    )

    const loginOpts = xaa?.commands
      .find(c => c.name() === 'login')
      ?.options.map(o => o.long)
    expect(loginOpts).toEqual(expect.arrayContaining(['--force', '--id-token']))
  })
})

describe('Official 2.1.331 `src/main.tsx` and `src/entrypoints/cli.tsx` wiring', () => {
  test('wires all missing official 2.1.331 root Commander flags in src/main.tsx', () => {
    const expectedRootFlags = [
      '--safe-mode',
      '--prompt-suggestions [value]',
      '--append-subagent-system-prompt-file <file>',
      '--plan-mode-instructions <instructions>',
      '--prefill-b64 <b64>',
      '--deep-link-cwd-b64 <b64>',
      '--resume-drops-turn <message id>',
      '--include-unsupported-models',
      '--fast-mode <on|off>',
      '--allow-other-models',
      '--managed-settings-in-initialize',
      '--host-auth-is-org-sign-in',
      '--project-config-root <dir>',
      '--ignore-persisted-trust',
      '--autocompact <auto|tokens>',
      '--proactivity <level>',
      '--agents-view-if-allowed',
      '--bg, --background',
      '--lead-verify-key <time.key>',
      '--runner-declares <names>',
      '--hold-repository-while-parked',
      '--session-began-as-copy <value>',
      '--initialize-fields <names>',
      '--remote-control-session-name-prefix <prefix>',
    ]
    for (const flag of expectedRootFlags) {
      expect(MAIN_SRC).toContain(flag)
    }
    expect(MAIN_SRC).toContain("'iterm2'")
    expect(MAIN_SRC).toContain('.implies({ debug: true })')
  })

  test('wires all missing official 2.1.331 subcommands and nested flags in src/main.tsx', () => {
    const expectedSubcommandTokens = [
      'registerGatewayCommand(program)',
      'registerSandboxCommands(program)',
      'registerImportCommands(program)',
      'registerWorkspaceTrustCommand(program)',
      'registerWorktreeHookCommand(program)',
      'registerApplyProjectSettingsCommand(program)',
      'registerVscodeExtensionHostCommands(program)',
      'registerMcpXaaIdpCommand(mcp)',
      "command('purge [path]',",
      "command('project', { hidden: true })",
      // mcp serve / add
      '--transport <transport>',
      '--port <port>',
      '--result-format <format>',
      '--session-tunnel',
      "'--web'",
      // auth login / logout
      '--gateway-json',
      '--organization-gateway',
      // plugin nested commands & flags
      "command('init <name>')",
      "command('tag [path]')",
      "command('prune')",
      "aliases(['autoremove'])",
      "command('eval [target]')",
      "command('test [dir]', { hidden: true })",
      "command('configure <plugin>')",
      '--profile <name>',
      '--data-size [plugin]',
      '--author <name>',
      '--author-email <email>',
      '--with <components...>',
      '--push',
      '-m, --message <msg>',
      '--interview',
      '--claudeai',
      '--from-link',
      '--resolve-only',
      '--replace',
      '--prune',
      // agents & auto-mode defaults
      '--setting-sources <sources>',
      '--plugin-dir-no-mcp <path>',
      '--managed-settings <json>',
      '--label <prefix>',
    ]
    for (const token of expectedSubcommandTokens) {
      expect(MAIN_SRC).toContain(token)
    }
  })

  test('cli.tsx preserves MACRO.VERSION fallback matching package.json and adds 2.1.331 hints/subcommands', () => {
    expect(CLI_ENTRY_SRC).toContain(
      `process.env.CLAUDE_CODE_VERSION || '${PKG_JSON.version}'`,
    )
    expect(CLI_ENTRY_SRC).not.toContain("'2.1.888'")
    expect(CLI_ENTRY_SRC).toContain('CLAUDE_CODE_SAFE_MODE')
    expect(CLI_ENTRY_SRC).toContain('CLAUDE_CODE_IGNORE_PERSISTED_TRUST')
    expect(CLI_ENTRY_SRC).toContain('getCommandWordHint')
    for (const sub of [
      "'gateway'",
      "'sandbox'",
      "'import-conversations'",
      "'edit-hook'",
      "'workspace-trust'",
      "'worktree-hook'",
      "'apply-project-settings'",
      "'project'",
    ]) {
      expect(CLI_ENTRY_SRC).toContain(sub)
    }
  })
})

describe('Official 2.1.331 CLI handler unit behavior', () => {
  test('gateway: validateGatewayConfigPath checks missing, empty, dir, and valid YAML', async () => {
    const dir = makeTempDir('claude-gw-')
    const missing = await validateGatewayConfigPath(join(dir, 'nope.yaml'))
    expect(missing.ok).toBe(false)

    const dirRes = await validateGatewayConfigPath(dir)
    expect(dirRes.ok).toBe(false)

    const emptyPath = join(dir, 'empty.yaml')
    writeFileSync(emptyPath, '   \n')
    const emptyRes = await validateGatewayConfigPath(emptyPath)
    expect(emptyRes.ok).toBe(false)

    const validPath = join(dir, 'gateway.yaml')
    writeFileSync(validPath, 'listen: 127.0.0.1:8080\n')
    const okRes = await validateGatewayConfigPath(validPath)
    expect(okRes.ok).toBe(true)
    if (okRes.ok) {
      expect(okRes.content).toContain('listen: 127.0.0.1:8080')
    }
  })

  test('sandbox: statusVersion 3 payload, install, and uninstall results are well-formed', () => {
    const install = getSandboxInstallResult()
    expect(install.status).toBe('unavailable')
    expect(install.message.length).toBeGreaterThan(0)

    const status = getSandboxStatusPayload()
    expect(status.statusVersion).toBe(3)
    expect(typeof status.available).toBe('boolean')
    expect(typeof status.installed).toBe('boolean')
    expect(typeof status.supported).toBe('boolean')
    expect(typeof status.enabled).toBe('boolean')
    expect(Array.isArray(status.reasons)).toBe(true)

    const uninstall = getSandboxUninstallResult()
    expect(['unavailable', 'not_installed']).toContain(uninstall.status)
    expect(Array.isArray(uninstall.leftBehind)).toBe(true)
  })

  test('import: parseImportCliArgs and rewriteImportCliArgs match official behavior', () => {
    const parsed = parseImportCliArgs(['import', 'codex', '--dry-run'])
    expect(parsed).toEqual({ prefix: [], rest: ['codex', '--dry-run'] })

    expect(parseImportCliArgs(['--help', 'import', 'codex'])).toBeNull()
    expect(parseImportCliArgs(['import', 'unknown-agent'])).toBeNull()
    expect(
      parseImportCliArgs(['--verbose', 'import', 'cursor', '--yes=abc123']),
    ).toEqual({
      prefix: ['--verbose'],
      rest: ['cursor', '--yes=abc123'],
    })

    expect(rewriteImportCliArgs(parsed!, undefined)).toEqual({
      kind: 'config-error',
    })
    expect(rewriteImportCliArgs(parsed!, false)).toEqual({
      kind: 'not-available',
    })
    expect(rewriteImportCliArgs(parsed!, true)).toEqual({
      kind: 'rewrite',
      argv: ['--', '/import codex --dry-run'],
    })
  })

  test('import-conversations: parses JSON export, runs dry-run & real import, detects manifest diff', async () => {
    const dir = makeTempDir('claude-import-conv-')
    const exportFile = join(dir, 'export.json')
    writeFileSync(
      exportFile,
      JSON.stringify({
        manifest: {
          account_uuid: 'acct-1',
          conversations: [{ uuid: 'conv-1', message_count: 2 }],
          projects: [{ uuid: 'proj-1', doc_count: 1 }],
        },
        projects: [
          {
            uuid: 'proj-1',
            name: 'My Project',
            prompt_template: 'Always be concise.',
            docs: [{ filename: 'notes.md', content: '# Notes' }],
          },
        ],
        conversations: [
          {
            uuid: 'conv-1',
            name: 'First Chat',
            project_uuid: 'proj-1',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:05:00Z',
            chat_messages: [
              { uuid: 'm1', sender: 'human', text: 'hello' },
              {
                uuid: 'm2',
                sender: 'assistant',
                text: 'hi there',
                parent_message_uuid: 'm1',
              },
            ],
          },
        ],
      }),
    )

    const bundle = await parseExportBundle(exportFile)
    expect(bundle.conversations).toHaveLength(1)
    expect(bundle.projects).toHaveLength(1)

    const dryCwd = join(dir, 'archive-dry')
    const drySummary = await runImportConversations(exportFile, {
      cwd: dryCwd,
      dryRun: true,
    })
    expect(drySummary.conversations).toBe(1)
    expect(drySummary.messages).toBe(2)
    expect(drySummary.projects).toBe(1)
    expect(drySummary.docs).toBe(1)
    expect(drySummary.manifestDiff).toEqual([])
    expect(existsSync(dryCwd)).toBe(false)

    const realCwd = join(dir, 'archive-real')
    const realSummary = await runImportConversations(exportFile, {
      cwd: realCwd,
      dryRun: false,
    })
    expect(realSummary.jsonlPaths).toHaveLength(1)
    expect(existsSync(realSummary.jsonlPaths[0]!)).toBe(true)
    expect(
      existsSync(join(realCwd, 'projects', 'My-Project-proj-1', 'notes.md')),
    ).toBe(true)

    const mismatch = computeManifestDiff(
      {
        account_uuid: 'acct-1',
        conversations: [{ uuid: 'conv-1', message_count: 99 }],
        projects: [],
      },
      { conversations: 1, skipped: 0, messages: 2, projects: 0, docs: 0 },
    )
    expect(mismatch).toEqual(['messages: manifest=99 imported=2'])
  })

  test('edit-hook: validateHookEditRequest enforces schema, target, and prototype pollution guards', () => {
    const validAdd = validateHookEditRequest({
      op: 'add',
      source: 'userSettings',
      event: 'PreToolUse',
      matcher: 'Bash',
      hook: { type: 'command', command: 'echo ok' },
    })
    expect(validAdd.ok).toBe(true)

    const badOp = validateHookEditRequest({
      op: 'drop',
      source: 'userSettings',
      event: 'PreToolUse',
    })
    expect(badOp.ok).toBe(false)

    const protoMatcher = validateHookEditRequest({
      op: 'add',
      source: 'userSettings',
      event: 'PreToolUse',
      matcher: 'toString',
      hook: { type: 'command', command: 'echo ok' },
    })
    expect(protoMatcher.ok).toBe(false)

    const protoKeyHook = validateHookEditRequest({
      op: 'add',
      source: 'userSettings',
      event: 'PreToolUse',
      matcher: 'Bash',
      hook: JSON.parse(
        '{"type":"command","command":"echo ok","__proto__":{"polluted":true}}',
      ),
    })
    expect(protoKeyHook.ok).toBe(false)

    const missingTarget = validateHookEditRequest({
      op: 'remove',
      source: 'projectSettings',
      event: 'PreToolUse',
      matcher: 'Bash',
    })
    expect(missingTarget.ok).toBe(false)
  })

  test('workspace-trust: buildWorkspaceTrustReport returns official JSON shape and flags unsafe root', () => {
    const dir = makeTempDir('claude-trust-')
    const report = buildWorkspaceTrustReport(dir)
    expect(report.directory).toBe(dir)
    expect(typeof report.trusted).toBe('boolean')
    expect(typeof report.sandbox_limits_files).toBe('boolean')
    expect(report.may_renew_sign_in).toBe(true)

    const rootReport = buildWorkspaceTrustReport('/')
    expect(rootReport.unsafe_path).toBe(true)
  })

  test('worktree-hook: validateWorktreeHookTask and checkWorktreeHookRefusal enforce safety checks', () => {
    expect(
      validateWorktreeHookTask({ event: 'create', name: 'feat-x' }),
    ).toEqual({ event: 'create', name: 'feat-x' })
    expect(validateWorktreeHookTask({ event: 'create' })).toBeUndefined()
    expect(
      validateWorktreeHookTask({ event: 'remove', path: 'relative/path' }),
    ).toBeUndefined()
    expect(
      validateWorktreeHookTask({ event: 'remove', path: '/tmp/wt-1' }),
    ).toEqual({ event: 'remove', path: '/tmp/wt-1' })

    expect(
      checkWorktreeHookRefusal({
        event: 'create',
        stdoutIsTTY: true,
        childSession: false,
        cwd: '/tmp/repo',
        trustedFolder: '/tmp/repo',
      }),
    ).toBe('stdout_is_tty')

    expect(
      checkWorktreeHookRefusal({
        event: 'create',
        stdoutIsTTY: false,
        childSession: true,
        cwd: '/tmp/repo',
        trustedFolder: '/tmp/repo',
      }),
    ).toBe('spawned_by_session')

    expect(
      checkWorktreeHookRefusal({
        event: 'create',
        stdoutIsTTY: false,
        childSession: false,
        cwd: '/tmp/repo',
      }),
    ).toBe('create_wants_a_trusted_folder')

    expect(
      checkWorktreeHookRefusal({
        event: 'create',
        stdoutIsTTY: false,
        childSession: false,
        cwd: '/tmp/repo',
        trustedFolder: '/tmp/other',
      }),
    ).toBe('trusted_folder_is_not_cwd')

    expect(
      checkWorktreeHookRefusal({
        event: 'create',
        stdoutIsTTY: false,
        childSession: false,
        cwd: '/',
        trustedFolder: '/',
      }),
    ).toBe('unsafe_path')

    expect(
      checkWorktreeHookRefusal({
        event: 'create',
        stdoutIsTTY: false,
        childSession: false,
        cwd: '/tmp/repo',
        trustedFolder: '/tmp/repo',
      }),
    ).toBeUndefined()
  })

  test('plugin init: validates plugin names, scaffolds all --with components, respects --force', async () => {
    expect(validateInitPluginName('my-plugin-1')).toBeNull()
    expect(validateInitPluginName('BadName')).not.toBeNull()
    expect(validateInitPluginName('../escape')).not.toBeNull()
    expect(validateInitPluginName('node_modules')).not.toBeNull()

    const files = buildPluginScaffoldFiles({
      name: 'demo-plug',
      description: 'Demo plugin',
      author: { name: 'Dev', email: 'dev@example.com' },
      with: SCAFFOLD_COMPONENTS,
    })
    const relPaths = files.map(f => f.relPath)
    expect(relPaths).toContain(join('.claude-plugin', 'plugin.json'))
    expect(relPaths).toContain('SKILL.md')
    expect(relPaths).toContain(join('skills', 'example', 'SKILL.md'))
    expect(relPaths).toContain(join('agents', 'example.md'))
    expect(relPaths).toContain(join('hooks', 'hooks.json'))
    expect(relPaths).toContain('.lsp.json')
    expect(relPaths).toContain(join('output-styles', 'demo-plug.md'))
    expect(relPaths).toContain('.mcp.json')
    expect(relPaths).toContain('server.ts')
    expect(relPaths).toContain('package.json')

    const targetDir = join(makeTempDir('claude-plug-init-'), 'demo-plug')
    const firstWrite = await writePluginScaffoldFiles(targetDir, files)
    expect(firstWrite.ok).toBe(true)
    expect(existsSync(join(targetDir, '.claude-plugin', 'plugin.json'))).toBe(
      true,
    )

    const secondWrite = await writePluginScaffoldFiles(targetDir, files)
    expect(secondWrite.ok).toBe(false)

    const forceWrite = await writePluginScaffoldFiles(targetDir, files, {
      force: true,
    })
    expect(forceWrite.ok).toBe(true)
  })

  test('plugin tag: validates semver, marketplace consistency, dirty tree, and creates annotated git tag', async () => {
    expect(buildPluginReleaseTag('my-plug', '1.2.3')).toBe('my-plug--v1.2.3')
    expect(
      formatTagAnnotationMessage({ pluginName: 'my-plug', version: '1.2.3' }),
    ).toBe('my-plug 1.2.3')
    expect(
      formatTagAnnotationMessage(
        { pluginName: 'my-plug', version: '1.2.3' },
        'Release v%s',
      ),
    ).toBe('Release v1.2.3')

    const repoDir = makeTempDir('claude-plug-tag-')
    execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'Test User'], {
      cwd: repoDir,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoDir,
      stdio: 'ignore',
    })

    const pluginDir = join(repoDir, 'plugins', 'alpha')
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'alpha', version: '1.0.0' }),
    )

    // Uncommitted changes rejected without --force
    const dirtyRes = await planPluginTag(pluginDir)
    expect(dirtyRes.ok).toBe(false)
    if (!dirtyRes.ok) {
      expect(dirtyRes.error).toContain('Uncommitted changes')
    }

    execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'init'], {
      cwd: repoDir,
      stdio: 'ignore',
    })

    // Clean tree succeeds
    const cleanRes = await planPluginTag(pluginDir)
    expect(cleanRes.ok).toBe(true)
    if (cleanRes.ok) {
      expect(cleanRes.plan.tag).toBe('alpha--v1.0.0')
      const created = await createPluginGitTag(cleanRes.plan)
      expect(created).toEqual({ ok: true, pushed: false })

      const tagOut = execFileSync('git', ['tag', '-l', 'alpha--v1.0.0'], {
        cwd: repoDir,
        encoding: 'utf8',
      }).trim()
      expect(tagOut).toBe('alpha--v1.0.0')
    }

    // Duplicate tag rejected without --force
    const dupRes = await planPluginTag(pluginDir)
    expect(dupRes.ok).toBe(false)
    if (!dupRes.ok) {
      expect(dupRes.error).toContain('already exists locally')
    }

    // Marketplace version mismatch rejected
    mkdirSync(join(repoDir, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(repoDir, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'alpha', version: '2.0.0' }] }),
    )
    const mismatchRes = await planPluginTag(pluginDir, { force: true })
    expect(mismatchRes.ok).toBe(false)
    if (!mismatchRes.ok) {
      expect(mismatchRes.error).toContain('Version mismatch')
    }
  })

  test('plugin prune: findOrphanAutoInstalledPlugins identifies unreferenced auto-installed deps', () => {
    const scan = findOrphanAutoInstalledPlugins(
      {
        'app@mp': [{ scope: 'user', dependencies: ['dep-needed@mp'] }],
        'dep-needed@mp': [{ scope: 'user', autoInstalled: true }],
        'dep-orphan@mp': [{ scope: 'user', autoInstalled: true }],
        'dep-project@mp': [{ scope: 'project', autoInstalled: true }],
      },
      'user',
    )
    expect(scan.autoCount).toBe(2)
    expect(scan.orphans).toEqual(['dep-orphan@mp'])
  })

  test('mcp serve: validateMcpServeOptions enforces --transport http for --port and --session-tunnel', () => {
    expect(validateMcpServeOptions({})).toEqual({
      ok: true,
      transport: 'stdio',
      port: 0,
      resultFormat: 'raw',
    })
    expect(validateMcpServeOptions({ port: '8080' }).ok).toBe(false)
    expect(
      validateMcpServeOptions({ transport: 'http', port: '99999' }).ok,
    ).toBe(false)
    expect(validateMcpServeOptions({ sessionTunnel: true }).ok).toBe(false)
    expect(
      validateMcpServeOptions({
        transport: 'http',
        port: '28471',
        resultFormat: 'rendered',
        sessionTunnel: true,
      }),
    ).toEqual({
      ok: true,
      transport: 'http',
      port: 28471,
      resultFormat: 'rendered',
    })
  })

  test('auto-mode defaults: filterAutoModeRulesByLabel filters by case-insensitive label prefix', () => {
    const filtered = filterAutoModeRulesByLabel(
      {
        allow: [
          '**Git read**: allow git status',
          '**File edits**: allow editing workspace',
        ],
        soft_deny: ['**Git push**: confirm pushing to main'],
        hard_deny: ['**Credential exfil**: block stealing keys'],
        environment: ['**Git repo**: standard workspace'],
      },
      'git',
    )
    expect(filtered.allow).toEqual(['**Git read**: allow git status'])
    expect(filtered.soft_deny).toEqual([
      '**Git push**: confirm pushing to main',
    ])
    expect(filtered.hard_deny).toEqual([])
    expect(filtered.environment).toEqual(['**Git repo**: standard workspace'])
  })

  test('cliSubcommandHint: returns official 2.1.331 hints for config and retired/non-command words', () => {
    expect(getCommandWordHint('config')).toBe(
      'To see or change settings, run claude at a terminal and type /config, or open your settings files',
    )
    expect(getCommandWordHint('migrate-installer')).toBe(
      'To move to the native installer, run claude install',
    )
    expect(getCommandWordHint('login')).toBe('To log in, run claude auth login')
    expect(getCommandWordHint('unknown-word')).toBeUndefined()
    expect(isRetiredCommandWord('config')).toBe(true)
    expect(isRetiredCommandWord('migrate-installer')).toBe(true)
    expect(isRetiredCommandWord('login')).toBe(false)
  })
})
