import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import {
  clearAnthropicProfileCaches,
  getAnthropicConfigDir,
} from '../../anthropicProfile.js'
import type { Command } from '../../../types/command.js'
import { getBootstrapSessionHost } from '../../sessionRoot.js'
import {
  filterCommandsBySkillAllowlist,
  replaceMemoryStoreSkillCommands,
  sessionSkillAllowlist,
} from '../../memoryStoreSkills.js'
import {
  type AncestryFs,
  isWslDistroUnc as ancestryIsWslDistroUnc,
  UNVERIFIED_ANCESTRY,
  walkPluginEvalAncestry,
} from '../pluginEval/pathAncestry.js'
import {
  assertEvalPathScopable,
  isDottedWslUnc,
  isWslDistroUnc,
  PluginEvalPathError,
  vetPluginEvalPath,
} from '../pluginEval/pathVet.js'
import {
  EVAL_CWD_GIT_META_NAMES,
  EVAL_PROC_READ_DENY,
  evalCwdGitMetaWriteDenies,
  expandWholeToolReadGrants,
  extraEvalToolDenies,
  grantEvalAllowedTools,
  isEvalArtifactPublishGranted,
  leftoverEvalBuiltinDenies,
  seedEvalGrowthbookOverrides,
  listEvalFenceDir,
  resolveEvalAddDirs,
  resolveEvalCaseAuthoredFile,
  resolveEvalReadScope,
  toEvalPermissionPath,
  unionEvalPathSpellings,
} from '../pluginEval/evalFence.js'

/** densable leftover `af` `kr` — settings.json paths are `ht(//…)` off Windows. */
function afFsPath(path: string): string {
  return process.platform === 'win32' ? path : toEvalPermissionPath(path)
}
import {
  applyEvalSandboxSettings,
  EVAL_REMOTE_SETTINGS_FILE,
  linkEvalAwsSsoCaches,
  parseWslWindowsMounts,
  writeEvalPolicySnapshot,
} from '../pluginEval/evalSandboxFence.js'
import {
  PROCESS_WRAPPER_ENV_KEY,
  resetProcessWrapperCache,
} from '../../processWrapper.js'
import {
  buildEvalChildArgv,
  buildEvalChildEnv,
  parseEvalChildTrace,
  spawnEvalChild,
  writeEvalChildTrace,
  isEvalConnectionStringEnvKey,
  isEvalHostEntrypoint,
  isEvalInheritedEnvKey,
  isEvalPackageIndexEnvKey,
  isEvalTpeStrippedKey,
  hostManagedEvalEnvDropKeys,
  respellInheritedPackageIndexUrls,
  stripEvalOperatorAuthHeaders,
} from '../pluginEval/spawnEval.js'
import {
  mockCallsWithOnly,
  MockEnterpriseExclusiveError,
  writeRunMocks,
} from '../pluginEval/mocks.js'
import {
  hashEvalMockSpecJson,
  parseEvalMockSpec,
  runEvalMockServer,
} from '../pluginEval/evalMockServer.js'
import {
  addStubPublishListings,
  cwdPlantedEvalArtifacts,
} from '../pluginEval/evalArtifactsFence.js'
import { snapshotEvalCwd } from '../pluginEval/evalCwdWalk.js'
import {
  adviseFileCreateGraders,
  graderChecksCreatedFile,
  keptSandboxRmRecipe,
  resolveEvalNoScaffold,
  runEvalScaffold,
} from '../pluginEval/evalScaffold.js'
import {
  checkMockInit,
  compareAgentMockAnswers,
  compareMockCallLog,
  createMockTraceWatcher,
} from '../pluginEval/mockIntegrity.js'
import type {
  EvalSandbox,
  MockServerBinding,
  ResolvedCase,
} from '../pluginEval/types.js'
import {
  PIN_CAP,
  pinReplayRecordings,
  readPinnedRecording,
  recordingFileName,
  recordingKey,
} from '../pluginEval/replay.js'

const tempDirs: string[] = []

afterEach(async () => {
  replaceMemoryStoreSkillCommands([])
  getBootstrapSessionHost().extensionsConfig.replaceSessionSkillAllowlist(
    undefined,
  )
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

function memorySkill(name: string): Command {
  return {
    type: 'prompt',
    name,
    description: name,
    source: 'memoryStore',
    progressMessage: name,
    contentLength: 1,
    disableModelInvocation: false,
    async getPromptForCommand() {
      return []
    },
  }
}

describe('plugin eval leftover edges densable 2.1.283', () => {
  test('k3 walker lands a local path (Ny uses k3(fh))', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-k3-'))
    tempDirs.push(root)
    await writeFile(join(root, 'file.txt'), 'ok')
    await expect(
      vetPluginEvalPath(root, 'file.txt', 'plugin eval'),
    ).resolves.toBeUndefined()
  })

  test('k3 surfaceNetworkRaw returns symlink-to-/net', async () => {
    const base = resolve('/tmp/plugin-eval-anchor')
    const link = join(base, 'out')
    const fsImpl: AncestryFs = {
      async lstat(path) {
        return { isSymbolicLink: () => path === link }
      },
      async openDirNoFollow() {},
      async readlink() {
        return '/net/evil/x'
      },
    }
    const y = await walkPluginEvalAncestry(fsImpl, link, {
      anchors: [base],
      surfaceNetworkRaw: true,
      unreadableAncestry: 'unverified',
    })
    expect(y).toBe('/net/evil/x')
  })

  test('k3 unreadableAncestry unverified is Uh sentinel', async () => {
    const fsImpl: AncestryFs = {
      async lstat() {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      },
      async openDirNoFollow() {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      },
      async readlink() {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      },
    }
    const y = await walkPluginEvalAncestry(
      fsImpl,
      '/tmp/plugin-eval-unreadable',
      {
        surfaceNetworkRaw: true,
        unreadableAncestry: 'unverified',
      },
    )
    expect(y).toBe(UNVERIFIED_ANCESTRY)
  })

  test('ss/as pin recordings-on-disk and replay a hash hit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-ss-'))
    tempDirs.push(root)
    const replayDir = join(root, 'mocks', '.replay', 'jira')
    await mkdir(replayDir, { recursive: true })
    const prompt = 'stand in'
    const history = [
      {
        tool: 'create',
        input: { ticket: '1' },
        verdict: 'ok',
        output: 'created',
      },
    ]
    const key = recordingKey({
      server: 'jira',
      tool: 'create',
      input: { ticket: '1' },
      mockHash: 'abc',
      prompt,
      history,
    })
    const name = recordingFileName('create', key)
    await writeFile(
      join(replayDir, name),
      JSON.stringify({
        input: { ticket: '1' },
        output: 'pinned-hit',
        verdict: 'ok',
        recordedAt: '2026-09-28T00:00:00.000Z',
        model: null,
      }),
    )
    const notes: string[] = []
    const pinned = await pinReplayRecordings(replayDir, notes)
    expect(pinned[name]).toHaveLength(64)
    const hit = await readPinnedRecording(replayDir, 'create', key, pinned)
    expect(hit).toEqual({ verdict: 'ok', text: 'pinned-hit' })
    expect(PIN_CAP).toBe(2000)
  })

  test('as prune note uses gold first-N pin copy', async () => {
    const src = await readFile(
      join(import.meta.dir, '../pluginEval/replay.ts'),
      'utf8',
    )
    expect(src).toContain(
      'recordings; only the first ${PIN_CAP} are pinned for replay',
    )
    expect(src).toContain('recording name components must be plain segments')
    expect(src).toContain('mock replay recordings')
  })

  test('xMn merges Eae() memory-store and defaults allowlist to Z$()', async () => {
    const commandsSrc = await readFile(
      join(import.meta.dir, '../../../commands.ts'),
      'utf8',
    )
    expect(commandsSrc).toContain('invocableMemoryStoreSkillCommands()')
    expect(commandsSrc).toContain('sessionSkillAllowlist()')
    expect(commandsSrc).toContain(
      'allowlist === undefined ? sessionSkillAllowlist() : allowlist',
    )
    const memory = memorySkill('memories::team-note')
    replaceMemoryStoreSkillCommands([memory])
    getBootstrapSessionHost().extensionsConfig.replaceSessionSkillAllowlist([
      'memories::team-note',
    ])
    expect(sessionSkillAllowlist()).toEqual(['memories::team-note'])
    const other = memorySkill('other')
    expect(
      filterCommandsBySkillAllowlist([memory, other], undefined).map(
        c => c.name,
      ),
    ).toEqual(['memories::team-note', 'other'])
    expect(
      filterCommandsBySkillAllowlist(
        [memory, other],
        sessionSkillAllowlist(),
      ).map(c => c.name),
    ).toEqual(['memories::team-note'])
  })

  test('gold Il polarity: real WSL distro vs dotted host', () => {
    expect(isWslDistroUnc('\\\\wsl$\\Ubuntu\\home\\u')).toBe(true)
    expect(ancestryIsWslDistroUnc('\\\\wsl$\\Ubuntu\\home\\u')).toBe(true)
    expect(isDottedWslUnc('\\\\wsl$\\Ubuntu\\home\\u')).toBe(false)
    expect(isWslDistroUnc('\\\\wsl$\\.')).toBe(false)
    expect(isDottedWslUnc('\\\\wsl$\\.')).toBe(true)
    expect(isWslDistroUnc('\\\\wsl$\\..')).toBe(false)
    expect(isDottedWslUnc('\\\\wsl$\\..')).toBe(true)
  })

  test('Ny refuses dotted WSL UNC as network-reaching', async () => {
    await expect(
      vetPluginEvalPath(
        '/tmp/plugin-eval-anchor',
        '\\\\wsl$\\.',
        'plugin eval',
      ),
    ).rejects.toThrow(/network-reaching/)
  })

  test('Yf strips host tokens from eval child env', () => {
    expect(isEvalInheritedEnvKey('PATH')).toBe(true)
    expect(isEvalInheritedEnvKey('EVAL_FOO')).toBe(true)
    expect(isEvalInheritedEnvKey('ANTHROPIC_API_KEY')).toBe(true)
    expect(isEvalInheritedEnvKey('GITHUB_TOKEN')).toBe(false)
    expect(isEvalInheritedEnvKey('SSH_AUTH_SOCK')).toBe(false)
    expect(isEvalInheritedEnvKey('NPM_TOKEN')).toBe(false)
    expect(isEvalInheritedEnvKey('HOMESHARE')).toBe(false)
    expect(isEvalInheritedEnvKey('CLAUDE_AX_SCREEN_READER')).toBe(true)
    expect(isEvalInheritedEnvKey('GIT_ASKPASS')).toBe(true)
    expect(isEvalInheritedEnvKey('BASH_DEFAULT_TIMEOUT_MS')).toBe(true)
    expect(isEvalInheritedEnvKey('MCP_TIMEOUT')).toBe(true)
    expect(isEvalInheritedEnvKey('NODE_EXTRA_CA_CERTS')).toBe(true)
    expect(isEvalInheritedEnvKey('SSL_CERT_FILE')).toBe(true)
    expect(isEvalInheritedEnvKey('CLAUDE_EFFORT')).toBe(true)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_SUBSCRIPTION_TYPE')).toBe(false)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_RATE_LIMIT_TIER')).toBe(false)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_MEMORY_API_TOKEN')).toBe(false)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_ARTIFACTS_API_BASE_URL')).toBe(
      false,
    )
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_SESSION_ACCESS_TOKEN')).toBe(
      false,
    )
    // leftover Vf `_ne`/`lmn`: secret-shaped CLAUDE_CODE_ except ri/oi keep
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_OAUTH_TOKEN')).toBe(false)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_OAUTH_REFRESH_TOKEN')).toBe(false)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_ARTIFACTS_API_TOKEN')).toBe(false)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_SLACK_TAG_TOKEN')).toBe(false)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_CLIENT_KEY_PASSPHRASE')).toBe(
      false,
    )
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_CLIENT_KEY')).toBe(true)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_API_KEY_HELPER_TTL_MS')).toBe(
      true,
    )
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_PROXY_AUTH_HELPER_TTL_MS')).toBe(
      true,
    )
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER')).toBe(
      true,
    )
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_AUTH_FAIL_EXIT_MS')).toBe(true)
    expect(
      isEvalInheritedEnvKey('CLAUDE_CODE_ENABLE_TOKEN_USAGE_ATTACHMENT'),
    ).toBe(true)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_IDLE_TOKEN_THRESHOLD')).toBe(true)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_RESUME_TOKEN_THRESHOLD')).toBe(
      true,
    )
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_ARG_KEY_SHAPE')).toBe(true)
    expect(isEvalInheritedEnvKey('CLAUDE_CODE_SKIP_GITHUB_AUTH')).toBe(true)
  })

  test('up inherit drops leftover _ne secrets; lmn keeps CLIENT_KEY/TTL/SKIP_*_AUTH', () => {
    const prev = {
      oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      refresh: process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN,
      artifacts: process.env.CLAUDE_CODE_ARTIFACTS_API_TOKEN,
      slack: process.env.CLAUDE_CODE_SLACK_TAG_TOKEN,
      passphrase: process.env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE,
      clientKey: process.env.CLAUDE_CODE_CLIENT_KEY,
      ttl: process.env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS,
      skip: process.env.CLAUDE_CODE_SKIP_GITHUB_AUTH,
    }
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-secret'
    process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = 'refresh-secret'
    process.env.CLAUDE_CODE_ARTIFACTS_API_TOKEN = 'art-secret'
    process.env.CLAUDE_CODE_SLACK_TAG_TOKEN = 'slack-secret'
    process.env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE = 'pass-secret'
    process.env.CLAUDE_CODE_CLIENT_KEY = 'keep-client-key'
    process.env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS = '5000'
    process.env.CLAUDE_CODE_SKIP_GITHUB_AUTH = '1'
    try {
      const sandbox: EvalSandbox = {
        root: '/tmp/e-root',
        cwd: '/tmp/e-root/home/cwd',
        configDir: '/tmp/e-root/config',
        home: '/tmp/e-root/home',
        outDir: '/tmp/e-root/out',
        tmpDir: '/tmp/e-root/tmp',
        operatorConfigDir: '/tmp/operator',
        cleanup: async () => {},
      }
      const case_: ResolvedCase = {
        schema_version: '1.1',
        name: 'alpha',
        tags: [],
        context: { add_dirs: [] },
        execution: {
          max_turns: 3,
          timeout_seconds: 30,
          allowed_tools: ['Read'],
          env: {},
        },
        runs: 1,
        graders: [],
        caseFile: '/tmp/plugin/evals/alpha/case.yaml',
        caseDir: '/tmp/plugin/evals/alpha',
        caseSource: 'case_yaml',
        pluginDirs: ['/tmp/plugin'],
        pluginDirsUnderTest: ['/tmp/plugin'],
        evalDirSegments: ['evals'],
      }
      const env = buildEvalChildEnv(case_, sandbox, false)
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      expect(env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined()
      expect(env.CLAUDE_CODE_ARTIFACTS_API_TOKEN).toBeUndefined()
      expect(env.CLAUDE_CODE_SLACK_TAG_TOKEN).toBeUndefined()
      expect(env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE).toBeUndefined()
      expect(env.CLAUDE_CODE_CLIENT_KEY).toBe('keep-client-key')
      expect(env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS).toBe('5000')
      expect(env.CLAUDE_CODE_SKIP_GITHUB_AUTH).toBe('1')
    } finally {
      if (prev.oauth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = prev.oauth
      if (prev.refresh === undefined)
        delete process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN
      else process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = prev.refresh
      if (prev.artifacts === undefined)
        delete process.env.CLAUDE_CODE_ARTIFACTS_API_TOKEN
      else process.env.CLAUDE_CODE_ARTIFACTS_API_TOKEN = prev.artifacts
      if (prev.slack === undefined)
        delete process.env.CLAUDE_CODE_SLACK_TAG_TOKEN
      else process.env.CLAUDE_CODE_SLACK_TAG_TOKEN = prev.slack
      if (prev.passphrase === undefined)
        delete process.env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE
      else process.env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE = prev.passphrase
      if (prev.clientKey === undefined)
        delete process.env.CLAUDE_CODE_CLIENT_KEY
      else process.env.CLAUDE_CODE_CLIENT_KEY = prev.clientKey
      if (prev.ttl === undefined)
        delete process.env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS
      else process.env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS = prev.ttl
      if (prev.skip === undefined)
        delete process.env.CLAUDE_CODE_SKIP_GITHUB_AUTH
      else process.env.CLAUDE_CODE_SKIP_GITHUB_AUTH = prev.skip
    }
  })

  test('of dt rejects when leftover nf fold throws (gold ue(Me))', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-of-fold-'))
    tempDirs.push(root)
    const plugin = join(root, 'plugin')
    const caseDir = join(plugin, 'evals', 'alpha')
    const sandboxRoot = join(root, 'sandbox')
    const sandbox: EvalSandbox = {
      root: sandboxRoot,
      cwd: join(sandboxRoot, 'home', 'cwd'),
      configDir: join(sandboxRoot, 'config'),
      home: join(sandboxRoot, 'home'),
      outDir: join(sandboxRoot, 'out'),
      tmpDir: join(sandboxRoot, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    await mkdir(caseDir, { recursive: true })
    await mkdir(sandbox.cwd, { recursive: true })
    await mkdir(sandbox.configDir, { recursive: true })
    await mkdir(sandbox.outDir, { recursive: true })
    await mkdir(sandbox.tmpDir, { recursive: true })
    const slug = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const jsonl = join(root, 'trace-lines.jsonl')
    await writeFile(
      jsonl,
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            id: 'm1',
            content: [
              {
                type: 'tool_use',
                id: 'tu_1',
                name: 'Artifact',
                input: { action: 'publish' },
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tu_1' }],
          },
          tool_use_result: { url: `eval-stub://artifact/${slug}` },
        }),
      ].join('\n') + '\n',
    )
    const wrapper = join(root, 'fold-wrapper')
    await writeFile(wrapper, `#!/bin/sh\ncat "${jsonl}"\n`)
    await chmod(wrapper, 0o755)
    const prevWrapper = process.env[PROCESS_WRAPPER_ENV_KEY]
    process.env[PROCESS_WRAPPER_ENV_KEY] = wrapper
    resetProcessWrapperCache()
    try {
      await expect(
        spawnEvalChild({
          case_: {
            schema_version: '1.1',
            name: 'alpha',
            tags: [],
            context: { add_dirs: [] },
            execution: {
              max_turns: 1,
              timeout_seconds: 8,
              allowed_tools: ['Read'],
              env: {},
            },
            runs: 1,
            graders: [],
            caseFile: join(caseDir, 'case.yaml'),
            caseDir,
            caseSource: 'case_yaml',
            pluginDirs: [plugin],
            pluginDirsUnderTest: [plugin],
            evalDirSegments: ['evals'],
          },
          sandbox,
          allowedTools: ['Read'],
          artifactPublishGranted: true,
          verbose: false,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        name: 'PluginEvalPathError',
        code: 'eval: stub publish staging dir missing',
        message: expect.stringContaining(
          'gone although the run published (1 corroborated)',
        ),
      })
    } finally {
      if (prevWrapper === undefined) delete process.env[PROCESS_WRAPPER_ENV_KEY]
      else process.env[PROCESS_WRAPPER_ENV_KEY] = prevWrapper
      resetProcessWrapperCache()
    }
  })

  test('up inherit Uf timeouts/CA; mocks Pi drops MCP_TIMEOUT', () => {
    const prevBash = process.env.BASH_DEFAULT_TIMEOUT_MS
    const prevMcp = process.env.MCP_TIMEOUT
    const prevCa = process.env.NODE_EXTRA_CA_CERTS
    const prevSub = process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE
    process.env.BASH_DEFAULT_TIMEOUT_MS = '64000'
    process.env.MCP_TIMEOUT = '111'
    process.env.NODE_EXTRA_CA_CERTS = '/opt/corp/ca.pem'
    process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE = 'max'
    try {
      const sandbox: EvalSandbox = {
        root: '/tmp/e-root',
        cwd: '/tmp/e-root/home/cwd',
        configDir: '/tmp/e-root/config',
        home: '/tmp/e-root/home',
        outDir: '/tmp/e-root/out',
        tmpDir: '/tmp/e-root/tmp',
        operatorConfigDir: '/tmp/operator',
        cleanup: async () => {},
      }
      const case_: ResolvedCase = {
        schema_version: '1.1',
        name: 'alpha',
        tags: [],
        context: { add_dirs: [] },
        execution: {
          max_turns: 3,
          timeout_seconds: 30,
          allowed_tools: ['Read'],
          env: {},
        },
        runs: 1,
        graders: [],
        caseFile: '/tmp/plugin/evals/alpha/case.yaml',
        caseDir: '/tmp/plugin/evals/alpha',
        caseSource: 'case_yaml',
        pluginDirs: ['/tmp/plugin'],
        pluginDirsUnderTest: ['/tmp/plugin'],
        evalDirSegments: ['evals'],
      }
      const env = buildEvalChildEnv(case_, sandbox, false)
      expect(env.BASH_DEFAULT_TIMEOUT_MS).toBe('64000')
      expect(env.MCP_TIMEOUT).toBe('111')
      expect(env.NODE_EXTRA_CA_CERTS).toBe('/opt/corp/ca.pem')
      expect(env.CLAUDE_CODE_SUBSCRIPTION_TYPE).toBeUndefined()
      const mocked = buildEvalChildEnv(case_, sandbox, false, undefined, true)
      expect(mocked.MCP_TIMEOUT).toBeUndefined()
      expect(mocked.BASH_DEFAULT_TIMEOUT_MS).toBe('64000')
    } finally {
      if (prevBash === undefined) delete process.env.BASH_DEFAULT_TIMEOUT_MS
      else process.env.BASH_DEFAULT_TIMEOUT_MS = prevBash
      if (prevMcp === undefined) delete process.env.MCP_TIMEOUT
      else process.env.MCP_TIMEOUT = prevMcp
      if (prevCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS
      else process.env.NODE_EXTRA_CA_CERTS = prevCa
      if (prevSub === undefined)
        delete process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE
      else process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE = prevSub
    }
  })

  test('of strips operator auth from ANTHROPIC_CUSTOM_HEADERS after inject', () => {
    const oauth = {
      ANTHROPIC_AUTH_TOKEN: 'operator-token',
      ANTHROPIC_CUSTOM_HEADERS:
        'Authorization: Bearer operator-secret\nX-Request-Id: keep',
    }
    stripEvalOperatorAuthHeaders(oauth, { kind: 'oauth' })
    expect(oauth.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(oauth.ANTHROPIC_CUSTOM_HEADERS).toBe('X-Request-Id: keep')
    const gateway = {
      ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer g\nX-Api-Key: leftover',
    }
    stripEvalOperatorAuthHeaders(gateway, { kind: 'gateway' })
    expect(gateway.ANTHROPIC_CUSTOM_HEADERS).toBe('X-Api-Key: leftover')
    const onlyAuth = {
      ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer x',
    }
    stripEvalOperatorAuthHeaders(onlyAuth, { kind: 'oauth' })
    expect(onlyAuth.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  })

  test('HNo respelled U9e URLs drop userinfo and query-as-cred', () => {
    const respelled = respellInheritedPackageIndexUrls({
      NPM_CONFIG_REGISTRY: 'https://user:pat@registry.npmjs.org/pkg/',
      GOPROXY: 'https://user:pat@proxy.golang.org,direct',
      UV_INDEX: 'https://user:pat@pypi.org/simple/',
    })
    expect(respelled.NPM_CONFIG_REGISTRY).toBe(
      'https://registry.npmjs.org/pkg/',
    )
    expect(respelled.GOPROXY).toBe('off')
    expect(respelled.UV_INDEX).toBe('https://pypi.org/simple/')
    expect(respelled.UV_DEFAULT_INDEX).toBe('https://pypi.org/')
  })

  test('Y$e drops host-managed creds when PROVIDER_MANAGED_BY_HOST', () => {
    const prev = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    const prevHeaders = process.env.ANTHROPIC_CUSTOM_HEADERS
    const prevKey = process.env.ANTHROPIC_API_KEY
    const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    const prevProfile = process.env.AWS_PROFILE
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
    process.env.ANTHROPIC_CUSTOM_HEADERS = 'Authorization: Bearer host'
    process.env.ANTHROPIC_API_KEY = 'sk-host'
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.AWS_PROFILE = 'prod'
    try {
      const drop = hostManagedEvalEnvDropKeys(process.env)
      expect(drop).toContain('ANTHROPIC_CUSTOM_HEADERS')
      expect(drop).toContain('ANTHROPIC_API_KEY')
      expect(drop).toContain('AWS_ACCESS_KEY_ID')
      expect(drop).toContain('CLAUDE_CODE_HOST_CREDS_FILE')
      const sandbox: EvalSandbox = {
        root: '/tmp/e-root',
        cwd: '/tmp/e-root/home/cwd',
        configDir: '/tmp/e-root/config',
        home: '/tmp/e-root/home',
        outDir: '/tmp/e-root/out',
        tmpDir: '/tmp/e-root/tmp',
        operatorConfigDir: '/tmp/operator',
        cleanup: async () => {},
      }
      const case_: ResolvedCase = {
        schema_version: '1.1',
        name: 'alpha',
        tags: [],
        context: { add_dirs: [] },
        execution: {
          max_turns: 3,
          timeout_seconds: 30,
          allowed_tools: ['Read'],
          env: {},
        },
        runs: 1,
        graders: [],
        caseFile: '/tmp/plugin/evals/alpha/case.yaml',
        caseDir: '/tmp/plugin/evals/alpha',
        caseSource: 'case_yaml',
        pluginDirs: ['/tmp/plugin'],
        pluginDirsUnderTest: ['/tmp/plugin'],
        evalDirSegments: ['evals'],
      }
      const env = buildEvalChildEnv(case_, sandbox, false)
      expect(env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    } finally {
      if (prev === undefined)
        delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
      else process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = prev
      if (prevHeaders === undefined) delete process.env.ANTHROPIC_CUSTOM_HEADERS
      else process.env.ANTHROPIC_CUSTOM_HEADERS = prevHeaders
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prevKey
      if (prevBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK
      else process.env.CLAUDE_CODE_USE_BEDROCK = prevBedrock
      if (prevProfile === undefined) delete process.env.AWS_PROFILE
      else process.env.AWS_PROFILE = prevProfile
    }
  })

  test('Yf U9e allows package-index env; mUr drops CONN_STR before AZURE_ prefix', () => {
    expect(isEvalPackageIndexEnvKey('NPM_CONFIG_REGISTRY')).toBe(true)
    expect(isEvalPackageIndexEnvKey('INPUT_NPM_CONFIG_REGISTRY')).toBe(true)
    expect(isEvalPackageIndexEnvKey('pip-index-url')).toBe(true)
    expect(isEvalPackageIndexEnvKey('CARGO_REGISTRIES_CRATES_IO_INDEX')).toBe(
      true,
    )
    expect(isEvalInheritedEnvKey('NPM_CONFIG_REGISTRY')).toBe(true)
    expect(isEvalInheritedEnvKey('UV_INDEX')).toBe(true)
    expect(isEvalInheritedEnvKey('PIP_INDEX_URL')).toBe(true)
    expect(
      isEvalConnectionStringEnvKey('AZURE_STORAGE_CONNECTION_STRING'),
    ).toBe(true)
    expect(isEvalInheritedEnvKey('AZURE_STORAGE_CONNECTION_STRING')).toBe(false)
    expect(isEvalInheritedEnvKey('AZURE_SUBSCRIPTION_ID')).toBe(true)
  })

  test('of source-locks process-exit group kill and win taskkill /T', () => {
    const spawnSrc = readFileSync(
      join(import.meta.dir, '../pluginEval/spawnEval.ts'),
      'utf8',
    )
    expect(spawnSrc).toContain("process.on('exit', killGroup)")
    expect(spawnSrc).toContain("process.removeListener('exit', killGroup)")
    expect(spawnSrc).toContain("'taskkill'")
    expect(spawnSrc).toContain("'/T'")
    expect(spawnSrc).toContain("'/F'")
    expect(spawnSrc).toContain("'/PID'")
    expect(spawnSrc).toContain('stripEvalGitIdentity')
  })

  test('tpe post-strip drops session/child keys, keeps ANTHROPIC_MODEL', () => {
    expect(isEvalTpeStrippedKey('CLAUDE_CODE_CHILD_SESSION')).toBe(true)
    expect(isEvalTpeStrippedKey('CLAUDE_CODE_SESSION_ID')).toBe(true)
    expect(isEvalTpeStrippedKey('CLAUDECODE')).toBe(true)
    expect(isEvalTpeStrippedKey('CLAUDE_CODE_SAFE_MODE')).toBe(true)
    expect(isEvalTpeStrippedKey('CLAUDE_CODE_SIMPLE')).toBe(true)
    expect(isEvalTpeStrippedKey('LC_TERMINAL')).toBe(true)
    expect(isEvalTpeStrippedKey('TERM_PROGRAM')).toBe(true)
    expect(isEvalTpeStrippedKey('TMUX')).toBe(true)
    expect(isEvalTpeStrippedKey('FORCE_CODE_TERMINAL')).toBe(true)
    expect(isEvalTpeStrippedKey('ANTHROPIC_MODEL')).toBe(false)
    expect(isEvalTpeStrippedKey('CLAUDE_AX_SCREEN_READER')).toBe(false)
    expect(isEvalTpeStrippedKey('CLAUDE_CODE_RESTRICTED')).toBe(false)
    // gold tpe.filter skips S3 keys (`!(F in S3)`)
    expect(isEvalTpeStrippedKey('GIT_ASKPASS')).toBe(false)
  })

  test('mG drops vscode/desktop CLAUDE_CODE_ENTRYPOINT, keeps others', () => {
    expect(isEvalHostEntrypoint('claude-vscode')).toBe(true)
    expect(isEvalHostEntrypoint('claude-desktop')).toBe(true)
    expect(isEvalHostEntrypoint('claude-desktop-3p')).toBe(true)
    expect(isEvalHostEntrypoint('cli')).toBe(false)
    expect(isEvalHostEntrypoint('local-agent')).toBe(false)
    expect(isEvalHostEntrypoint(undefined)).toBe(false)
  })

  test('up does not copy GITHUB_TOKEN; sf denies Write(pluginDirsUnderTest)', async () => {
    const prev = process.env.GITHUB_TOKEN
    const prevChild = process.env.CLAUDE_CODE_CHILD_SESSION
    const prevSafe = process.env.CLAUDE_CODE_SAFE_MODE
    const prevLc = process.env.LC_TERMINAL
    const prevAx = process.env.CLAUDE_AX_SCREEN_READER
    const prevAsk = process.env.GIT_ASKPASS
    const prevEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    const prevAuthor = process.env.GIT_AUTHOR_NAME
    const prevConn = process.env.AZURE_STORAGE_CONNECTION_STRING
    const prevNpm = process.env.NPM_CONFIG_REGISTRY
    const prevAwsShared = process.env.AWS_SHARED_CREDENTIALS_FILE
    const prevAwsConfig = process.env.AWS_CONFIG_FILE
    const prevGcloud = process.env.CLOUDSDK_CONFIG
    const prevAzure = process.env.AZURE_CONFIG_DIR
    const prevHost = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    delete process.env.AWS_SHARED_CREDENTIALS_FILE
    delete process.env.AWS_CONFIG_FILE
    delete process.env.CLOUDSDK_CONFIG
    delete process.env.AZURE_CONFIG_DIR
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    process.env.GITHUB_TOKEN = 'should-not-leak'
    process.env.GIT_AUTHOR_NAME = 'Eval Operator'
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'AccountKey=secret'
    process.env.NPM_CONFIG_REGISTRY = 'https://registry.npmjs.org/'
    process.env.CLAUDE_CODE_CHILD_SESSION = '1'
    process.env.CLAUDE_CODE_SAFE_MODE = '1'
    process.env.LC_TERMINAL = 'iTerm2'
    process.env.CLAUDE_AX_SCREEN_READER = '1'
    process.env.GIT_ASKPASS = ''
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode'
    try {
      const sandbox: EvalSandbox = {
        root: '/tmp/e-root',
        cwd: '/tmp/e-root/home/cwd',
        configDir: '/tmp/e-root/config',
        home: '/tmp/e-root/home',
        outDir: '/tmp/e-root/out',
        tmpDir: '/tmp/e-root/tmp',
        operatorConfigDir: '/tmp/operator',
        cleanup: async () => {},
      }
      const case_: ResolvedCase = {
        schema_version: '1.1',
        name: 'alpha',
        tags: [],
        context: { add_dirs: [] },
        execution: {
          max_turns: 3,
          timeout_seconds: 30,
          allowed_tools: ['Read'],
          env: {},
        },
        runs: 1,
        graders: [],
        caseFile: '/tmp/plugin/evals/alpha/case.yaml',
        caseDir: '/tmp/plugin/evals/alpha',
        caseSource: 'case_yaml',
        pluginDirs: ['/tmp/plugin'],
        pluginDirsUnderTest: ['/tmp/plugin'],
        evalDirSegments: ['evals'],
      }
      const env = buildEvalChildEnv(case_, sandbox, false)
      expect(env.GITHUB_TOKEN).toBeUndefined()
      expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined()
      expect(env.CLAUDE_CODE_SAFE_MODE).toBeUndefined()
      expect(env.LC_TERMINAL).toBeUndefined()
      expect(env.CLAUDE_AX_SCREEN_READER).toBe('1')
      expect(env.GIT_ASKPASS).toBe('')
      expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
      expect(env.CLAUDE_CODE_EVAL_CONFINED).toBe('1')
      expect(env.GIT_AUTHOR_NAME).toBeUndefined()
      expect(env.AZURE_STORAGE_CONNECTION_STRING).toBeUndefined()
      expect(env.NPM_CONFIG_REGISTRY).toBe('https://registry.npmjs.org/')
      expect(env.GIT_CONFIG_NOSYSTEM).toBe('1')
      expect(env.GIT_CONFIG_KEY_0).toBe('core.pager')
      expect(env.GIT_NO_REPLACE_OBJECTS).toBe('1')
      expect(env.GIT_TERMINAL_PROMPT).toBe('0')
      expect(env.GIT_LFS_SKIP_SMUDGE).toBe('1')
      expect(env.GIT_NO_LAZY_FETCH).toBeUndefined()
      expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe(
        join(homedir(), '.aws', 'credentials'),
      )
      expect(env.AWS_CONFIG_FILE).toBe(join(homedir(), '.aws', 'config'))
      expect(env.AZURE_CONFIG_DIR).toBe(join(homedir(), '.azure'))
      expect(env.CLOUDSDK_CONFIG).toBeDefined()
      const argv = await buildEvalChildArgv(
        case_,
        sandbox,
        ['Read'],
        undefined,
        undefined,
      )
      expect(argv.some(a => a.includes('Write(//tmp/plugin/**)'))).toBe(true)
      expect(
        argv.some(a => a.includes('Write(//tmp/plugin/evals/alpha/**)')),
      ).toBe(true)
      expect(argv.some(a => a.includes('Read(//tmp/e-root/home/**)'))).toBe(
        true,
      )
      expect(argv.some(a => a.includes('Glob(//tmp/e-root/tmp/**)'))).toBe(true)
      // gold mf readRoots = pluginDirsUnderTest (plugin sits outside sandbox home)
      expect(argv.some(a => a.includes('Read(//tmp/plugin/**)'))).toBe(true)
      expect(argv.some(a => a.includes('Glob(//tmp/plugin/**)'))).toBe(true)
      expect(argv.some(a => a.includes('Grep(//tmp/plugin/**)'))).toBe(true)
      expect(argv.some(a => a === `--allowed-tools=Read`)).toBe(false)
      for (const name of EVAL_CWD_GIT_META_NAMES) {
        const path = toEvalPermissionPath(`/tmp/e-root/home/cwd/${name}`)
        expect(argv.some(a => a.includes(`Write(${path})`))).toBe(true)
        expect(argv.some(a => a.includes(`Write(${path}/**)`))).toBe(true)
      }
      if (process.platform !== 'win32') {
        expect(argv.some(a => a.includes(EVAL_PROC_READ_DENY))).toBe(true)
      }
      const denyNames = (
        argv.find(a => a.startsWith('--disallowed-tools=')) ?? ''
      )
        .slice('--disallowed-tools='.length)
        .split(',')
        .map(rule => rule.split('(')[0] ?? rule)
      expect(denyNames).toContain('Bash')
      expect(denyNames).toContain('PowerShell')
      expect(denyNames).toContain('Monitor')
      expect(denyNames).toContain('EnterWorktree')
      expect(denyNames).toContain('ExitWorktree')
      expect(denyNames).toContain('WebFetch')
    } finally {
      if (prev === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = prev
      if (prevChild === undefined) delete process.env.CLAUDE_CODE_CHILD_SESSION
      else process.env.CLAUDE_CODE_CHILD_SESSION = prevChild
      if (prevSafe === undefined) delete process.env.CLAUDE_CODE_SAFE_MODE
      else process.env.CLAUDE_CODE_SAFE_MODE = prevSafe
      if (prevLc === undefined) delete process.env.LC_TERMINAL
      else process.env.LC_TERMINAL = prevLc
      if (prevAx === undefined) delete process.env.CLAUDE_AX_SCREEN_READER
      else process.env.CLAUDE_AX_SCREEN_READER = prevAx
      if (prevAsk === undefined) delete process.env.GIT_ASKPASS
      else process.env.GIT_ASKPASS = prevAsk
      if (prevEntrypoint === undefined)
        delete process.env.CLAUDE_CODE_ENTRYPOINT
      else process.env.CLAUDE_CODE_ENTRYPOINT = prevEntrypoint
      if (prevAuthor === undefined) delete process.env.GIT_AUTHOR_NAME
      else process.env.GIT_AUTHOR_NAME = prevAuthor
      if (prevConn === undefined)
        delete process.env.AZURE_STORAGE_CONNECTION_STRING
      else process.env.AZURE_STORAGE_CONNECTION_STRING = prevConn
      if (prevNpm === undefined) delete process.env.NPM_CONFIG_REGISTRY
      else process.env.NPM_CONFIG_REGISTRY = prevNpm
      if (prevAwsShared === undefined)
        delete process.env.AWS_SHARED_CREDENTIALS_FILE
      else process.env.AWS_SHARED_CREDENTIALS_FILE = prevAwsShared
      if (prevAwsConfig === undefined) delete process.env.AWS_CONFIG_FILE
      else process.env.AWS_CONFIG_FILE = prevAwsConfig
      if (prevGcloud === undefined) delete process.env.CLOUDSDK_CONFIG
      else process.env.CLOUDSDK_CONFIG = prevGcloud
      if (prevAzure === undefined) delete process.env.AZURE_CONFIG_DIR
      else process.env.AZURE_CONFIG_DIR = prevAzure
      if (prevHost === undefined)
        delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
      else process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = prevHost
    }
  })

  test('On refuses whitespace, glob, and UNC before Write interpolation', async () => {
    expect(() => assertEvalPathScopable('/tmp/plugin', 'sandbox')).not.toThrow()
    expect(() =>
      assertEvalPathScopable('/tmp/plugin (copy)', 'plugin/case/add_dirs'),
    ).toThrow(PluginEvalPathError)
    try {
      assertEvalPathScopable('/tmp/plugin*', 'plugin/case/add_dirs')
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PluginEvalPathError)
      expect((error as PluginEvalPathError).code).toBe(
        'eval path unsafe for permission rule',
      )
    }
    try {
      assertEvalPathScopable('//wsl$/Ubuntu/home', 'plugin/case/add_dirs')
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PluginEvalPathError)
      expect((error as PluginEvalPathError).code).toBe('eval path is UNC')
    }
    const sandbox: EvalSandbox = {
      root: '/tmp/e-root',
      cwd: '/tmp/e-root/home/cwd',
      configDir: '/tmp/e-root/config',
      home: '/tmp/e-root/home',
      outDir: '/tmp/e-root/out',
      tmpDir: '/tmp/e-root/tmp',
      operatorConfigDir: '/tmp/operator',
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'star',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: '/tmp/plugin*/evals/alpha/case.yaml',
      caseDir: '/tmp/plugin*/evals/alpha',
      caseSource: 'case_yaml',
      pluginDirs: ['/tmp/plugin*'],
      pluginDirsUnderTest: ['/tmp/plugin*'],
      evalDirSegments: ['evals'],
    }
    await expect(
      buildEvalChildArgv(case_, sandbox, ['Read'], undefined, undefined),
    ).rejects.toMatchObject({
      code: 'eval path unsafe for permission rule',
    })
  })

  test('ht prefixes // so cliArg deny roots at FS /', () => {
    expect(toEvalPermissionPath('/tmp/plugin')).toBe('//tmp/plugin')
    expect(
      expandWholeToolReadGrants(['Read'], ['/tmp/home', '/tmp/tmp']),
    ).toEqual([
      'Read(//tmp/home/**)',
      'Glob(//tmp/home/**)',
      'Grep(//tmp/home/**)',
      'Read(//tmp/tmp/**)',
      'Glob(//tmp/tmp/**)',
      'Grep(//tmp/tmp/**)',
    ])
    expect(expandWholeToolReadGrants(['Read(/tmp/x)'], ['/tmp/home'])).toEqual([
      'Read(/tmp/x)',
    ])
  })

  test('ko refuses history_file symlink escape; keeps in-suite file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-ko-'))
    tempDirs.push(root)
    const plugin = join(root, 'plugin')
    const caseDir = join(plugin, 'evals', 'alpha')
    await mkdir(caseDir, { recursive: true })
    const hist = join(caseDir, 'hist.jsonl')
    await writeFile(hist, '{"type":"user"}\n')
    const outside = join(root, 'outside.jsonl')
    await writeFile(outside, 'nope\n')
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [], history_file: 'hist.jsonl' },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(caseDir, 'case.yaml'),
      caseDir,
      caseSource: 'case_yaml',
      pluginDirs: [plugin],
      pluginDirsUnderTest: [plugin],
      evalDirSegments: ['evals'],
    }
    await expect(
      resolveEvalCaseAuthoredFile(case_, 'hist.jsonl', 'history_file'),
    ).resolves.toBe(await realpath(hist))
    const link = join(caseDir, 'escape.jsonl')
    await symlink(outside, link)
    await expect(
      resolveEvalCaseAuthoredFile(case_, 'escape.jsonl', 'history_file'),
    ).rejects.toMatchObject({
      code: 'eval case file escapes suite via link',
    })
  })

  test('wl grants Read/Glob/Grep for in-suite add_dirs even without whole-tool Read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-wl-'))
    tempDirs.push(root)
    const plugin = join(root, 'plugin')
    const caseDir = join(plugin, 'evals', 'alpha')
    const fixtures = join(caseDir, 'fixtures')
    await mkdir(fixtures, { recursive: true })
    const sandbox: EvalSandbox = {
      root: join(root, 'e-root'),
      cwd: join(root, 'e-root', 'home', 'cwd'),
      configDir: join(root, 'e-root', 'config'),
      home: join(root, 'e-root', 'home'),
      outDir: join(root, 'e-root', 'out'),
      tmpDir: join(root, 'e-root', 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: ['fixtures'] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: [],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(caseDir, 'case.yaml'),
      caseDir,
      caseSource: 'case_yaml',
      pluginDirs: [plugin],
      pluginDirsUnderTest: [plugin],
      evalDirSegments: ['evals'],
    }
    const addDirs = await resolveEvalAddDirs(case_)
    expect(addDirs).toEqual([await realpath(fixtures)])
    const argv = await buildEvalChildArgv(
      case_,
      sandbox,
      [],
      undefined,
      undefined,
    )
    const granted = toEvalPermissionPath(await realpath(fixtures))
    expect(argv.some(a => a.includes(`Read(${granted}/**)`))).toBe(true)
    expect(argv.some(a => a.includes(`Glob(${granted}/**)`))).toBe(true)
    expect(argv.some(a => a.includes(`Grep(${granted}/**)`))).toBe(true)
    // gold extra flatMap is add_dirs only; plugin readRoots only via mf
    const allowedArg = argv.find(a => a.startsWith('--allowed-tools=')) ?? ''
    const pluginGrant = toEvalPermissionPath(await realpath(plugin))
    expect(allowedArg.includes(`Read(${pluginGrant}/**)`)).toBe(false)
  })

  test('mf includes pluginDirsUnderTest as readRoots when whole-tool Read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-mf-'))
    tempDirs.push(root)
    const plugin = join(root, 'plugin')
    const caseDir = join(plugin, 'evals', 'alpha')
    await mkdir(caseDir, { recursive: true })
    const sandbox: EvalSandbox = {
      root: join(root, 'e-root'),
      cwd: join(root, 'e-root', 'home', 'cwd'),
      configDir: join(root, 'e-root', 'config'),
      home: join(root, 'e-root', 'home'),
      outDir: join(root, 'e-root', 'out'),
      tmpDir: join(root, 'e-root', 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(caseDir, 'case.yaml'),
      caseDir,
      caseSource: 'case_yaml',
      pluginDirs: [plugin],
      pluginDirsUnderTest: [plugin],
      evalDirSegments: ['evals'],
    }
    const argv = await buildEvalChildArgv(
      case_,
      sandbox,
      ['Read'],
      undefined,
      undefined,
    )
    const pluginGrant = toEvalPermissionPath(await realpath(plugin))
    expect(argv.some(a => a.includes(`Read(${pluginGrant}/**)`))).toBe(true)
    expect(argv.some(a => a.includes(`Glob(${pluginGrant}/**)`))).toBe(true)
    expect(argv.some(a => a.includes(`Grep(${pluginGrant}/**)`))).toBe(true)
    expect(argv.some(a => a === `--allowed-tools=Read`)).toBe(false)
  })

  test('wl refuses add_dirs whose realpath leaves case/plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-wl-out-'))
    tempDirs.push(root)
    const plugin = join(root, 'plugin')
    const caseDir = join(plugin, 'evals', 'alpha')
    await mkdir(caseDir, { recursive: true })
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(caseDir, 'escape'))
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: ['escape'] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(caseDir, 'case.yaml'),
      caseDir,
      caseSource: 'case_yaml',
      pluginDirs: [plugin],
      pluginDirsUnderTest: [plugin],
      evalDirSegments: ['evals'],
    }
    await expect(resolveEvalAddDirs(case_)).rejects.toMatchObject({
      code: 'add_dirs resolves outside case/plugin',
    })
  })

  test('sn unions original+realpath Write denies for a symlink plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-sn-'))
    tempDirs.push(root)
    const realPlugin = join(root, 'plugin-real')
    const caseDir = join(realPlugin, 'evals', 'alpha')
    await mkdir(caseDir, { recursive: true })
    const link = join(root, 'plugin-link')
    await symlink(realPlugin, link)
    const sandbox: EvalSandbox = {
      root: join(root, 'e-root'),
      cwd: join(root, 'e-root', 'home', 'cwd'),
      configDir: join(root, 'e-root', 'config'),
      home: join(root, 'e-root', 'home'),
      outDir: join(root, 'e-root', 'out'),
      tmpDir: join(root, 'e-root', 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(link, 'evals', 'alpha', 'case.yaml'),
      caseDir: join(link, 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [link],
      pluginDirsUnderTest: [link],
      evalDirSegments: ['evals'],
    }
    const spellings = await unionEvalPathSpellings([
      link,
      join(link, 'evals', 'alpha'),
    ])
    expect(spellings).toContain(link)
    expect(spellings).toContain(await realpath(link))
    expect(spellings).toContain(join(link, 'evals', 'alpha'))
    expect(spellings).toContain(await realpath(join(link, 'evals', 'alpha')))
    const argv = await buildEvalChildArgv(
      case_,
      sandbox,
      ['Read'],
      undefined,
      undefined,
    )
    for (const dir of spellings) {
      expect(
        argv.some(a => a.includes(`Write(${toEvalPermissionPath(dir)}/**)`)),
      ).toBe(true)
    }
  })

  test('_f denies Write of cwd git meta even after df Write(cwd/**)', async () => {
    const cwd = '/tmp/e-root/home/cwd'
    const denies = evalCwdGitMetaWriteDenies(cwd)
    expect(denies).toEqual(
      EVAL_CWD_GIT_META_NAMES.flatMap(name => [
        `Write(${toEvalPermissionPath(join(cwd, name))})`,
        `Write(${toEvalPermissionPath(join(cwd, name))}/**)`,
      ]),
    )
    const sandbox: EvalSandbox = {
      root: '/tmp/e-root',
      cwd,
      configDir: '/tmp/e-root/config',
      home: '/tmp/e-root/home',
      outDir: '/tmp/e-root/out',
      tmpDir: '/tmp/e-root/tmp',
      operatorConfigDir: '/tmp/operator',
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Write'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: '/tmp/plugin/evals/alpha/case.yaml',
      caseDir: '/tmp/plugin/evals/alpha',
      caseSource: 'case_yaml',
      pluginDirs: ['/tmp/plugin'],
      pluginDirsUnderTest: ['/tmp/plugin'],
      evalDirSegments: ['evals'],
    }
    const argv = await buildEvalChildArgv(
      case_,
      sandbox,
      ['Write'],
      undefined,
      undefined,
    )
    expect(argv.some(a => a.includes('Write(//tmp/e-root/home/cwd/**)'))).toBe(
      true,
    )
    for (const name of EVAL_CWD_GIT_META_NAMES) {
      const path = toEvalPermissionPath(`${cwd}/${name}`)
      expect(argv.some(a => a.includes(`Write(${path})`))).toBe(true)
      expect(argv.some(a => a.includes(`Write(${path}/**)`))).toBe(true)
    }
  })

  test('Ai extra-denies ungranted shells and always Monitor/EnterWorktree/ExitWorktree', async () => {
    const sandbox: EvalSandbox = {
      root: '/tmp/e-root',
      cwd: '/tmp/e-root/home/cwd',
      configDir: '/tmp/e-root/config',
      home: '/tmp/e-root/home',
      outDir: '/tmp/e-root/out',
      tmpDir: '/tmp/e-root/tmp',
      operatorConfigDir: '/tmp/operator',
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: '/tmp/plugin/evals/alpha/case.yaml',
      caseDir: '/tmp/plugin/evals/alpha',
      caseSource: 'case_yaml',
      pluginDirs: ['/tmp/plugin'],
      pluginDirsUnderTest: ['/tmp/plugin'],
      evalDirSegments: ['evals'],
    }
    const argv = await buildEvalChildArgv(
      case_,
      sandbox,
      ['Bash'],
      undefined,
      undefined,
    )
    const denyArg = argv.find(a => a.startsWith('--disallowed-tools=')) ?? ''
    const denyNames = denyArg
      .slice('--disallowed-tools='.length)
      .split(',')
      .map(rule => rule.split('(')[0] ?? rule)
    // gold Ai: Bash granted → not extra-denied; PowerShell still denied
    expect(denyNames).not.toContain('Bash')
    expect(denyNames).toContain('PowerShell')
    expect(denyNames).toContain('Monitor')
    expect(denyNames).toContain('EnterWorktree')
    expect(denyNames).toContain('ExitWorktree')
  })

  test('Ai uf leftover-denies WebFetch/Config/ScheduleWakeup on Read-only', async () => {
    const leftover = leftoverEvalBuiltinDenies(['Read'])
    expect(leftover).toContain('WebFetch')
    expect(leftover).toContain('Config')
    expect(leftover).toContain('ScheduleWakeup')
    expect(leftover).not.toContain('Read')
    expect(leftover).not.toContain('Glob')
    expect(leftover).not.toContain('Grep')
    expect(leftover).not.toContain('Skill')
    expect(leftover).not.toContain('Agent')
    expect(leftover).not.toContain('EndConversation')
    const deny = extraEvalToolDenies(['Read'])
    expect(deny).toContain('WebFetch')
    expect(deny).toContain('Bash')
    expect(deny).toContain('Monitor')
  })

  test('vp remaps stream-json sandbox O6 errors to SHELL_UNCONFINED when Bash granted', () => {
    const { SHELL_UNCONFINED: copy } =
      require('../pluginEval/constants.js') as {
        SHELL_UNCONFINED: string
      }
    const parsed = parseEvalChildTrace(
      [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }],
          },
        },
        {
          type: 'result',
          is_error: true,
          permission_denials: [{ tool_use_id: 't1' }],
          errors: [
            'Sandbox required but unavailable. Set sandbox.failIfUnavailable=false to allow unsandboxed execution.',
          ],
        },
      ],
      false,
      { kind: 'exit', code: '1', stderrTail: '' },
      '/tmp/trace.jsonl',
      { shellGranted: true },
    )
    expect(parsed.error).toContain(copy)
    expect(parsed.error).not.toContain('failIfUnavailable=false')
    expect(parsed.toolCalls[0]?.deniedByChild).toBe(true)
  })

  test('vp reconstructs costUsd and numTurns from unique assistant usage when no result', () => {
    type AssistantUsage = {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
    }
    const usage: AssistantUsage = {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    const { calculateUSDCost } = require('../../modelCost.js') as {
      calculateUSDCost: (model: string, usage: AssistantUsage) => number
    }
    const per = calculateUSDCost('claude-sonnet-4-5-20250929', usage)
    const parsed = parseEvalChildTrace(
      [
        {
          type: 'assistant',
          message: {
            id: 'm1',
            model: 'claude-sonnet-4-5-20250929',
            usage,
            content: [{ type: 'text', text: 'one' }],
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'm1',
            model: 'claude-sonnet-4-5-20250929',
            usage,
            content: [{ type: 'text', text: 'dup' }],
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'm2',
            model: 'claude-sonnet-4-5-20250929',
            usage,
            content: [{ type: 'text', text: 'two' }],
          },
        },
      ],
      true,
      { kind: 'error', message: 'timed out after 1s' },
      '/tmp/trace.jsonl',
    )
    expect(parsed.numTurns).toBe(2)
    expect(parsed.costUsd).toBe(per * 2)
    expect(parsed.timedOut).toBe(true)
  })

  test('vp keeps result costUsd/numTurns and ignores reconstructed usage', () => {
    const parsed = parseEvalChildTrace(
      [
        {
          type: 'assistant',
          message: {
            id: 'm1',
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 100, output_tokens: 20 },
            content: [{ type: 'text', text: 'hi' }],
          },
        },
        { type: 'result', num_turns: 4, total_cost_usd: 1.25 },
      ],
      false,
      { kind: 'ok' },
      '/tmp/trace.jsonl',
    )
    expect(parsed.numTurns).toBe(4)
    expect(parsed.costUsd).toBe(1.25)
  })

  test('vp Ei concatenates array tool_result text instead of JSON.stringify', () => {
    const { EVAL_ABORTED_BY_MOCK: prefix } =
      require('../pluginEval/constants.js') as {
        EVAL_ABORTED_BY_MOCK: string
      }
    const parsed = parseEvalChildTrace(
      [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 't1', name: 'mcp__srv__foo', input: {} },
            ],
          },
        },
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 't1',
                is_error: true,
                content: [
                  { type: 'text', text: `${prefix} nonce: srv/foo — reason` },
                ],
              },
            ],
          },
        },
        { type: 'result', num_turns: 1, total_cost_usd: 0 },
      ],
      false,
      { kind: 'ok' },
      '/tmp/trace.jsonl',
    )
    expect(parsed.toolCalls[0]?.output).toBe(
      `${prefix} nonce: srv/foo — reason`,
    )
    expect(parsed.toolCalls[0]?.output).not.toContain('[{')
    expect(parsed.toolCalls[0]?.isError).toBe(true)
  })

  test('of _o dumps stream-json events to trace.jsonl', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-trace-'))
    tempDirs.push(root)
    const path = join(root, 'trace.jsonl')
    const events = [
      { type: 'assistant', message: { content: [] } },
      { type: 'result', total_cost_usd: 0 },
    ]
    await writeEvalChildTrace(path, events)
    expect(await readFile(path, 'utf8')).toBe(
      `${JSON.stringify(events[0])}\n${JSON.stringify(events[1])}`,
    )
  })

  test('af writes sandbox settings.json when Bash is granted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    await mkdir(configDir, { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    await applyEvalSandboxSettings(sandbox, ['Read'], [], case_, {
      isSupportedPlatform: () => true,
      checkDependencies: () => ({ errors: [] }),
      isPlatformInEnabledList: () => true,
      operatorHome: () => join(root, 'operator-home'),
      policySandboxes: () => [],
    })
    await expect(
      readFile(join(configDir, 'settings.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      isSupportedPlatform: () => true,
      checkDependencies: () => ({ errors: [] }),
      isPlatformInEnabledList: () => true,
      operatorHome: () => join(root, 'operator-home'),
      policySandboxes: () => [],
    })
    const written = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as {
      sandbox: {
        enabled: boolean
        failIfUnavailable: boolean
        allowUnsandboxedCommands: boolean
        filesystem: {
          denyWrite: string[]
          denyRead: string[]
        }
        credentials: {
          envVars: Array<{ name: string; mode: string }>
          files: Array<{ path: string; mode: string }>
        }
      }
    }
    expect(written.sandbox.enabled).toBe(true)
    expect(written.sandbox.failIfUnavailable).toBe(true)
    expect(written.sandbox.allowUnsandboxedCommands).toBe(false)
    expect(
      written.sandbox.credentials.envVars.some(
        entry =>
          entry.name === 'AWS_SECRET_ACCESS_KEY' && entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path.endsWith('.aws/credentials') && entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.filesystem.denyWrite.some(path =>
        path.endsWith('.git/hooks'),
      ),
    ).toBe(true)
    expect(
      written.sandbox.filesystem.denyWrite.some(path =>
        path.includes('.eval-artifacts'),
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.envVars.some(
        entry => entry.name === 'HTTPS_PROXY' && entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.envVars.some(
        entry => entry.name === 'NPM_CONFIG_PROXY' && entry.mode === 'deny',
      ),
    ).toBe(true)
  })

  test('af wUr _ne denies inherited AWS_SECURITY_TOKEN and EVAL_API_TOKEN', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-wur-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    await mkdir(configDir, { recursive: true })
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      isSupportedPlatform: () => true,
      checkDependencies: () => ({ errors: [] }),
      isPlatformInEnabledList: () => true,
      operatorHome: () => join(root, 'operator-home'),
      policySandboxes: () => [],
      childEnv: {
        AWS_SECURITY_TOKEN: 'opaque-session-token',
        EVAL_API_TOKEN: 'opaque-eval-token',
        EVAL_SECRET: 'opaque-eval-secret',
        EVAL_FOO: 'not-a-secret-name',
      },
    })
    const written = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as {
      sandbox: {
        credentials: { envVars: Array<{ name: string; mode: string }> }
      }
    }
    const denied = new Set(
      written.sandbox.credentials.envVars
        .filter(entry => entry.mode === 'deny')
        .map(entry => entry.name),
    )
    expect(denied.has('AWS_SECURITY_TOKEN')).toBe(true)
    expect(denied.has('EVAL_API_TOKEN')).toBe(true)
    expect(denied.has('EVAL_SECRET')).toBe(true)
    expect(denied.has('GITHUB_TOKEN')).toBe(true)
    expect(denied.has('GH_TOKEN')).toBe(true)
    expect(denied.has('EVAL_FOO')).toBe(false)
  })

  test('af credentials.files include Qa env-pointer paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-ptr-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    await mkdir(configDir, { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      isSupportedPlatform: () => true,
      checkDependencies: () => ({ errors: [] }),
      isPlatformInEnabledList: () => true,
      operatorHome: () => join(root, 'operator-home'),
      policySandboxes: () => [],
      childEnv: {
        AWS_SHARED_CREDENTIALS_FILE: '/opt/team/creds',
        GOOGLE_APPLICATION_CREDENTIALS: '/opt/team/adc.json',
        ANTHROPIC_CONFIG_DIR: '/opt/anthropic',
        ANTHROPIC_IDENTITY_TOKEN_FILE: '/opt/secrets/oidc.jwt',
        AZURE_AUTH_LOCATION: '/opt/azure/sp.json',
        CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: '/var/secrets/adc.json',
        CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: '/var/lib/ci/gcp-token',
        CLOUDSDK_AUTH_AUTHORIZATION_TOKEN_FILE: '/var/lib/ci/gcp-auth',
        CLAUDE_CODE_FEDERATION_CACHE_DIR: '/opt/fed/cache',
      },
    })
    const written = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as {
      sandbox: {
        filesystem: { denyRead: string[] }
        credentials: { files: Array<{ path: string; mode: string }> }
      }
    }
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path === afFsPath('/opt/team/creds') && entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path === afFsPath('/opt/team/adc.json') &&
          entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path === afFsPath('/opt/anthropic') && entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path === afFsPath('/opt/secrets/oidc.jwt') &&
          entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path === afFsPath('/opt/azure/sp.json') &&
          entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path === afFsPath('/var/secrets/adc.json') &&
          entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path === afFsPath('/var/lib/ci/gcp-token') &&
          entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path === afFsPath('/var/lib/ci/gcp-auth') &&
          entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path === afFsPath('/opt/fed/cache') && entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(written.sandbox.filesystem.denyRead).toContain(
      afFsPath('/opt/fed/cache'),
    )
    const operatorHome = join(root, 'operator-home')
    expect(
      written.sandbox.credentials.files.some(
        entry =>
          entry.path === afFsPath(join(operatorHome, '.kube', 'config')) &&
          entry.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      written.sandbox.credentials.files.some(
        entry => entry.path === afFsPath('/etc/npmrc') && entry.mode === 'deny',
      ),
    ).toBe(true)
  })

  test('af Zn denies gitconfig include/helper/sslKey outside home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-zn-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    const operatorHome = join(root, 'operator-home')
    await mkdir(operatorHome, { recursive: true })
    await mkdir(configDir, { recursive: true })
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    await writeFile(
      join(operatorHome, '.gitconfig'),
      [
        '[include]',
        '  path = /opt/corp/gitconfig',
        '[http]',
        '  sslKey = /opt/certs/client.key',
        '[user]',
        '  signingKey = /opt/keys/git.pub',
        '[credential]',
        '  helper = store --file /opt/secrets/git-credentials',
        '',
      ].join('\n'),
    )
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    const prevGlobal = process.env.GIT_CONFIG_GLOBAL
    const prevParams = process.env.GIT_CONFIG_PARAMETERS
    process.env.GIT_CONFIG_GLOBAL = '/opt/team/gitconfig'
    process.env.GIT_CONFIG_PARAMETERS = `'http.cookieFile'='/opt/cookies/git'`
    try {
      await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
        isSupportedPlatform: () => true,
        checkDependencies: () => ({ errors: [] }),
        isPlatformInEnabledList: () => true,
        operatorHome: () => operatorHome,
        policySandboxes: () => [],
        childEnv: {},
      })
      const written = JSON.parse(
        await readFile(join(configDir, 'settings.json'), 'utf8'),
      ) as {
        sandbox: {
          credentials: { files: Array<{ path: string; mode: string }> }
        }
      }
      const denied = new Set(
        written.sandbox.credentials.files
          .filter(entry => entry.mode === 'deny')
          .map(entry => entry.path),
      )
      expect(denied.has(afFsPath('/opt/certs/client.key'))).toBe(true)
      expect(denied.has(afFsPath('/opt/keys/git'))).toBe(true)
      expect(denied.has(afFsPath('/opt/secrets/git-credentials'))).toBe(true)
      expect(denied.has(afFsPath('/opt/cookies/git'))).toBe(true)
    } finally {
      if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = prevGlobal
      if (prevParams === undefined) delete process.env.GIT_CONFIG_PARAMETERS
      else process.env.GIT_CONFIG_PARAMETERS = prevParams
    }
  })

  test('af Cr denies absolute IdentityFile from operator ssh_config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-cr-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    const operatorHome = join(root, 'operator-home')
    await mkdir(join(operatorHome, '.ssh'), { recursive: true })
    await mkdir(configDir, { recursive: true })
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    await writeFile(
      join(operatorHome, '.ssh', 'config'),
      [
        'Host example',
        '  IdentityFile /opt/keys/id_ed25519',
        '  IdentityFile ~/.ssh/id_rsa',
        '  CertificateFile none',
        '  Include ./extra',
        '',
      ].join('\n'),
    )
    await writeFile(
      join(operatorHome, '.ssh', 'extra'),
      'IdentityFile /opt/keys/extra.pem\n',
    )
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      isSupportedPlatform: () => true,
      checkDependencies: () => ({ errors: [] }),
      isPlatformInEnabledList: () => true,
      operatorHome: () => operatorHome,
      policySandboxes: () => [],
      childEnv: {},
    })
    const written = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as {
      sandbox: {
        credentials: { files: Array<{ path: string; mode: string }> }
      }
    }
    const denied = new Set(
      written.sandbox.credentials.files
        .filter(entry => entry.mode === 'deny')
        .map(entry => entry.path),
    )
    expect(denied.has(afFsPath('/opt/keys/id_ed25519'))).toBe(true)
    expect(denied.has(afFsPath('/opt/keys/extra.pem'))).toBe(true)
    expect(denied.has(afFsPath(join(operatorHome, '.ssh', 'id_rsa')))).toBe(
      true,
    )
  })

  test('af jp denies keytabs named in krb5.conf libdefaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-jp-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    const krb = join(root, 'krb5.conf')
    const included = join(root, 'realm.conf')
    await mkdir(configDir, { recursive: true })
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    await writeFile(
      krb,
      [
        'include ' + included,
        '[libdefaults]',
        '  default_keytab_name = FILE:/etc/krb5.keytab',
        '  default_ccache_name = DIR::/var/krb5/ccache',
        '  default_client_keytab_name = FILE:/var/krb5/client.keytab',
        '',
      ].join('\n'),
    )
    await writeFile(
      included,
      'includedir ' + join(root, 'missing-krb-dir') + '\n',
    )
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    const prevKrb = process.env.KRB5_CONFIG
    process.env.KRB5_CONFIG = krb
    try {
      await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
        isSupportedPlatform: () => true,
        checkDependencies: () => ({ errors: [] }),
        isPlatformInEnabledList: () => true,
        operatorHome: () => join(root, 'operator-home'),
        policySandboxes: () => [],
        childEnv: {},
      })
      const written = JSON.parse(
        await readFile(join(configDir, 'settings.json'), 'utf8'),
      ) as {
        sandbox: {
          credentials: { files: Array<{ path: string; mode: string }> }
        }
      }
      const denied = new Set(
        written.sandbox.credentials.files
          .filter(entry => entry.mode === 'deny')
          .map(entry => entry.path),
      )
      expect(denied.has(afFsPath('/etc/krb5.keytab'))).toBe(true)
      expect(denied.has(afFsPath('/var/krb5/ccache'))).toBe(true)
      expect(denied.has(afFsPath('/var/krb5'))).toBe(true)
      expect(denied.has(afFsPath('/var/krb5/client.keytab'))).toBe(true)
    } finally {
      if (prevKrb === undefined) delete process.env.KRB5_CONFIG
      else process.env.KRB5_CONFIG = prevKrb
    }
  })

  test('af mt denies outside-home system cred files and ke pointers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-mt-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    await mkdir(configDir, { recursive: true })
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    const prevMaven = process.env.MAVEN_HOME
    const prevKrb = process.env.KRB5CCNAME
    process.env.MAVEN_HOME = '/opt/maven'
    process.env.KRB5CCNAME = 'DIR:/var/krb5/cache'
    try {
      await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
        isSupportedPlatform: () => true,
        checkDependencies: () => ({ errors: [] }),
        isPlatformInEnabledList: () => true,
        operatorHome: () => join(root, 'operator-home'),
        policySandboxes: () => [],
        childEnv: {},
      })
      const written = JSON.parse(
        await readFile(join(configDir, 'settings.json'), 'utf8'),
      ) as {
        sandbox: {
          credentials: { files: Array<{ path: string; mode: string }> }
        }
      }
      const denied = new Set(
        written.sandbox.credentials.files
          .filter(entry => entry.mode === 'deny')
          .map(entry => entry.path),
      )
      for (const path of [
        '/etc/pg_service.conf',
        '/etc/postgresql-common/pg_service.conf',
        '/usr/local/bundle/config',
        '/etc/conda/condarc',
        '/var/lib/conda/condarc.d',
        '/etc/wgetrc',
        '/etc/pip.conf',
        '/etc/xdg/pip/pip.conf',
        '/opt/maven/conf/settings.xml',
        '/var/krb5/cache',
      ]) {
        expect(denied.has(afFsPath(path))).toBe(true)
      }
      // gold $l: DIR:/path denies the file only; DIR::/path also denies dirname.
      expect(denied.has(afFsPath(dirname('/var/krb5/cache')))).toBe(false)
    } finally {
      if (prevMaven === undefined) delete process.env.MAVEN_HOME
      else process.env.MAVEN_HOME = prevMaven
      if (prevKrb === undefined) delete process.env.KRB5CCNAME
      else process.env.KRB5CCNAME = prevKrb
    }
  })

  test('af Te denies process.env SOPS/HELM pointers the child bag does not inherit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-proc-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    await mkdir(configDir, { recursive: true })
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    const prevSops = process.env.SOPS_AGE_KEY_FILE
    const prevHelm = process.env.HELM_REGISTRY_CONFIG
    const prevGoenv = process.env.GOENV
    process.env.SOPS_AGE_KEY_FILE = '/opt/secrets/age.keys'
    process.env.HELM_REGISTRY_CONFIG = '/opt/helm/registry.json'
    process.env.GOENV = 'off'
    try {
      await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
        isSupportedPlatform: () => true,
        checkDependencies: () => ({ errors: [] }),
        isPlatformInEnabledList: () => true,
        operatorHome: () => join(root, 'operator-home'),
        policySandboxes: () => [],
        childEnv: {},
      })
      const written = JSON.parse(
        await readFile(join(configDir, 'settings.json'), 'utf8'),
      ) as {
        sandbox: {
          credentials: { files: Array<{ path: string; mode: string }> }
        }
      }
      const files = written.sandbox.credentials.files
      expect(
        files.some(
          entry =>
            entry.path === afFsPath('/opt/secrets/age.keys') &&
            entry.mode === 'deny',
        ),
      ).toBe(true)
      expect(
        files.some(
          entry =>
            entry.path === afFsPath('/opt/helm/registry.json') &&
            entry.mode === 'deny',
        ),
      ).toBe(true)
      expect(files.some(entry => entry.path === afFsPath('off'))).toBe(false)
      const operatorHome = join(root, 'operator-home')
      expect(
        files.some(
          entry =>
            entry.path ===
              afFsPath(
                join(operatorHome, '.config', 'sops', 'age', 'keys.txt'),
              ) && entry.mode === 'deny',
        ),
      ).toBe(true)
    } finally {
      if (prevSops === undefined) delete process.env.SOPS_AGE_KEY_FILE
      else process.env.SOPS_AGE_KEY_FILE = prevSops
      if (prevHelm === undefined) delete process.env.HELM_REGISTRY_CONFIG
      else process.env.HELM_REGISTRY_CONFIG = prevHelm
      if (prevGoenv === undefined) delete process.env.GOENV
      else process.env.GOENV = prevGoenv
    }
  })

  test('af tm denies JAVA_TOOL_OPTIONS with -D password', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-tm-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    await mkdir(configDir, { recursive: true })
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      isSupportedPlatform: () => true,
      checkDependencies: () => ({ errors: [] }),
      isPlatformInEnabledList: () => true,
      operatorHome: () => join(root, 'operator-home'),
      policySandboxes: () => [],
      childEnv: {
        JAVA_TOOL_OPTIONS: '-Djavax.net.ssl.trustStorePassword=secret',
      },
    })
    const written = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as {
      sandbox: {
        credentials: { envVars: Array<{ name: string; mode: string }> }
        filesystem: { denyWrite: string[] }
      }
    }
    expect(
      written.sandbox.credentials.envVars.some(
        entry => entry.name === 'JAVA_TOOL_OPTIONS' && entry.mode === 'deny',
      ),
    ).toBe(true)
    if (process.platform === 'darwin') {
      const uid = process.getuid?.() ?? 0
      // this sandbox lives under os.tmpdir() (/var/folders), so gold Pe
      // still whole-denies /tmp. Named /tmp/claude-$uid is the /private/tmp
      // parent case — covered below.
      expect(written.sandbox.filesystem.denyWrite).toContain(afFsPath('/tmp'))
      expect(written.sandbox.filesystem.denyWrite).not.toContain(
        afFsPath(`/tmp/claude-${uid}`),
      )
    }
  })

  test('af tm JAVA V4n/QC denies sonar.login Bearer PEM; changeit stays off', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-v4n-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    await mkdir(configDir, { recursive: true })
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    const seams = {
      isSupportedPlatform: () => true,
      checkDependencies: () => ({ errors: [] }),
      isPlatformInEnabledList: () => true,
      operatorHome: () => join(root, 'operator-home'),
      policySandboxes: () => [],
    }
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      ...seams,
      childEnv: {
        JAVA_TOOL_OPTIONS: '-Dsonar.login=sqp_secretloginvalue',
      },
    })
    const sonar = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as {
      sandbox: {
        credentials: { envVars: Array<{ name: string; mode: string }> }
      }
    }
    expect(
      sonar.sandbox.credentials.envVars.some(
        entry => entry.name === 'JAVA_TOOL_OPTIONS' && entry.mode === 'deny',
      ),
    ).toBe(true)
    await rm(join(configDir, 'settings.json'))
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      ...seams,
      childEnv: {
        JAVA_TOOL_OPTIONS:
          '-Dhttp.agent="Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"',
      },
    })
    const bearer = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as {
      sandbox: {
        credentials: { envVars: Array<{ name: string; mode: string }> }
      }
    }
    expect(
      bearer.sandbox.credentials.envVars.some(
        entry => entry.name === 'JAVA_TOOL_OPTIONS' && entry.mode === 'deny',
      ),
    ).toBe(true)
    await rm(join(configDir, 'settings.json'))
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      ...seams,
      childEnv: {
        JAVA_TOOL_OPTIONS: '-Dapp.cert="-----BEGIN PRIVATE KEY-----abcdef"',
      },
    })
    const pem = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as {
      sandbox: {
        credentials: { envVars: Array<{ name: string; mode: string }> }
      }
    }
    expect(
      pem.sandbox.credentials.envVars.some(
        entry => entry.name === 'JAVA_TOOL_OPTIONS' && entry.mode === 'deny',
      ),
    ).toBe(true)
    await rm(join(configDir, 'settings.json'))
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      ...seams,
      childEnv: {
        JAVA_TOOL_OPTIONS: '-Djavax.net.ssl.trustStorePassword=changeit',
      },
    })
    const changeit = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as {
      sandbox: {
        credentials: { envVars: Array<{ name: string; mode: string }> }
      }
    }
    expect(
      changeit.sandbox.credentials.envVars.some(
        entry => entry.name === 'JAVA_TOOL_OPTIONS' && entry.mode === 'deny',
      ),
    ).toBe(false)
  })

  test('af tm QC denies userinfo-without-password on ANTHROPIC_BASE_URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-qc-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    await mkdir(configDir, { recursive: true })
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      isSupportedPlatform: () => true,
      checkDependencies: () => ({ errors: [] }),
      isPlatformInEnabledList: () => true,
      operatorHome: () => join(root, 'operator-home'),
      policySandboxes: () => [],
      childEnv: {
        ANTHROPIC_BASE_URL: 'https://sk-ant-secret@proxy.example',
        AWS_ENDPOINT_URL: 'https://AKIAIOSFODNN7EXAMPLE@s3.example',
        ANTHROPIC_API_URL: 'https://api.anthropic.com',
        CLAUDE_CODE_GIT_REMOTE: 'https://alice@github.com/org/repo.git',
      },
    })
    const written = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as {
      sandbox: {
        credentials: { envVars: Array<{ name: string; mode: string }> }
      }
    }
    const denied = new Set(
      written.sandbox.credentials.envVars
        .filter(entry => entry.mode === 'deny')
        .map(entry => entry.name),
    )
    expect(denied.has('ANTHROPIC_BASE_URL')).toBe(true)
    expect(denied.has('AWS_ENDPOINT_URL')).toBe(true)
    expect(denied.has('ANTHROPIC_API_URL')).toBe(false)
    expect(denied.has('CLAUDE_CODE_GIT_REMOTE')).toBe(false)
  })

  test('af macos Pe/Ye realpath aliases /tmp onto /private/tmp parent', async () => {
    if (process.platform !== 'darwin') return
    const root = await mkdtemp('/tmp/e-')
    tempDirs.push(root)
    const realRoot = await realpath(root)
    const configDir = join(realRoot, 'config')
    await mkdir(configDir, { recursive: true })
    await mkdir(join(realRoot, 'plugin', 'evals', 'alpha'), { recursive: true })
    const sandbox: EvalSandbox = {
      root: realRoot,
      cwd: join(realRoot, 'home', 'cwd'),
      configDir,
      home: join(realRoot, 'home'),
      outDir: join(realRoot, 'out'),
      tmpDir: join(realRoot, 'tmp'),
      operatorConfigDir: join(realRoot, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(realRoot, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(realRoot, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(realRoot, 'plugin')],
      pluginDirsUnderTest: [join(realRoot, 'plugin')],
      evalDirSegments: ['evals'],
    }
    await applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
      isSupportedPlatform: () => true,
      checkDependencies: () => ({ errors: [] }),
      isPlatformInEnabledList: () => true,
      operatorHome: () => join(realRoot, 'operator-home'),
      policySandboxes: () => [],
    })
    const written = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as { sandbox: { filesystem: { denyWrite: string[] } } }
    const uid = process.getuid?.() ?? 0
    const deny = written.sandbox.filesystem.denyWrite
    expect(deny).toContain(afFsPath(`/tmp/claude-${uid}`))
    expect(deny).toContain(afFsPath(`/private/tmp/claude-${uid}`))
    expect(deny).not.toContain(afFsPath('/tmp'))
    expect(deny).not.toContain(afFsPath('/private/tmp'))
  })

  test('up j does not overwrite an already-set AWS_SHARED_CREDENTIALS_FILE', () => {
    const prev = process.env.AWS_SHARED_CREDENTIALS_FILE
    const prevHost = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    process.env.AWS_SHARED_CREDENTIALS_FILE = '/opt/team/creds'
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    try {
      const sandbox: EvalSandbox = {
        root: '/tmp/e-root',
        cwd: '/tmp/e-root/home/cwd',
        configDir: '/tmp/e-root/config',
        home: '/tmp/e-root/home',
        outDir: '/tmp/e-root/out',
        tmpDir: '/tmp/e-root/tmp',
        operatorConfigDir: '/tmp/operator',
        cleanup: async () => {},
      }
      const case_: ResolvedCase = {
        schema_version: '1.1',
        name: 'alpha',
        tags: [],
        context: { add_dirs: [] },
        execution: {
          max_turns: 3,
          timeout_seconds: 30,
          allowed_tools: ['Read'],
          env: {},
        },
        runs: 1,
        graders: [],
        caseFile: '/tmp/plugin/evals/alpha/case.yaml',
        caseDir: '/tmp/plugin/evals/alpha',
        caseSource: 'case_yaml',
        pluginDirs: ['/tmp/plugin'],
        pluginDirsUnderTest: ['/tmp/plugin'],
        evalDirSegments: ['evals'],
      }
      const env = buildEvalChildEnv(case_, sandbox, false)
      expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe('/opt/team/creds')
    } finally {
      if (prev === undefined) delete process.env.AWS_SHARED_CREDENTIALS_FILE
      else process.env.AWS_SHARED_CREDENTIALS_FILE = prev
      if (prevHost === undefined)
        delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
      else process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = prevHost
    }
  })

  test('up env-quad pins CLAUDE_CODE_FEDERATION_CACHE_DIR', () => {
    const prevRule = process.env.ANTHROPIC_FEDERATION_RULE_ID
    const prevOrg = process.env.ANTHROPIC_ORGANIZATION_ID
    const prevProfile = process.env.ANTHROPIC_PROFILE
    const prevFed = process.env.CLAUDE_CODE_FEDERATION_CACHE_DIR
    const prevConfig = process.env.ANTHROPIC_CONFIG_DIR
    process.env.ANTHROPIC_FEDERATION_RULE_ID = 'rule-1'
    process.env.ANTHROPIC_ORGANIZATION_ID = 'org-1'
    delete process.env.ANTHROPIC_PROFILE
    delete process.env.CLAUDE_CODE_FEDERATION_CACHE_DIR
    process.env.ANTHROPIC_CONFIG_DIR = '/opt/anthropic'
    clearAnthropicProfileCaches()
    try {
      const sandbox: EvalSandbox = {
        root: '/tmp/e-root',
        cwd: '/tmp/e-root/home/cwd',
        configDir: '/tmp/e-root/config',
        home: '/tmp/e-root/home',
        outDir: '/tmp/e-root/out',
        tmpDir: '/tmp/e-root/tmp',
        operatorConfigDir: '/tmp/operator',
        cleanup: async () => {},
      }
      const case_: ResolvedCase = {
        schema_version: '1.1',
        name: 'alpha',
        tags: [],
        context: { add_dirs: [] },
        execution: {
          max_turns: 3,
          timeout_seconds: 30,
          allowed_tools: ['Read'],
          env: {},
        },
        runs: 1,
        graders: [],
        caseFile: '/tmp/plugin/evals/alpha/case.yaml',
        caseDir: '/tmp/plugin/evals/alpha',
        caseSource: 'case_yaml',
        pluginDirs: ['/tmp/plugin'],
        pluginDirsUnderTest: ['/tmp/plugin'],
        evalDirSegments: ['evals'],
      }
      const env = buildEvalChildEnv(case_, sandbox, false)
      expect(env.CLAUDE_CODE_FEDERATION_CACHE_DIR).toBe(
        join(
          getAnthropicConfigDir(process.env) ?? '',
          'credentials',
          'federation',
        ),
      )
      expect(env.CLAUDE_CODE_FEDERATION_CACHE_DIR).toBe(
        '/opt/anthropic/credentials/federation',
      )
    } finally {
      if (prevRule === undefined)
        delete process.env.ANTHROPIC_FEDERATION_RULE_ID
      else process.env.ANTHROPIC_FEDERATION_RULE_ID = prevRule
      if (prevOrg === undefined) delete process.env.ANTHROPIC_ORGANIZATION_ID
      else process.env.ANTHROPIC_ORGANIZATION_ID = prevOrg
      if (prevProfile === undefined) delete process.env.ANTHROPIC_PROFILE
      else process.env.ANTHROPIC_PROFILE = prevProfile
      if (prevFed === undefined)
        delete process.env.CLAUDE_CODE_FEDERATION_CACHE_DIR
      else process.env.CLAUDE_CODE_FEDERATION_CACHE_DIR = prevFed
      if (prevConfig === undefined) delete process.env.ANTHROPIC_CONFIG_DIR
      else process.env.ANTHROPIC_CONFIG_DIR = prevConfig
      clearAnthropicProfileCaches()
    }
  })

  test('vf parses WSL drvfs mounts', () => {
    expect(
      parseWslWindowsMounts(
        'C:\\ /mnt/c drvfs rw,noatime 0 0\n/dev/sda / ext4 rw 0 0\n',
      ),
    ).toContain('/mnt/c')
  })

  test('af refuses unconfined Bash grant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-refuse-'))
    tempDirs.push(root)
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir: join(root, 'config'),
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: '/tmp/plugin/evals/alpha/case.yaml',
      caseDir: '/tmp/plugin/evals/alpha',
      caseSource: 'case_yaml',
      pluginDirs: ['/tmp/plugin'],
      pluginDirsUnderTest: ['/tmp/plugin'],
      evalDirSegments: ['evals'],
    }
    await expect(
      applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
        isSupportedPlatform: () => false,
        checkDependencies: () => ({ errors: [] }),
        isPlatformInEnabledList: () => true,
        policySandboxes: () => [],
      }),
    ).rejects.toMatchObject({
      code: 'eval shell grant refused: sandbox unavailable',
    })
  })

  test('af refuses glob char in plugin-parent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-glob-'))
    tempDirs.push(root)
    await mkdir(join(root, 'config'), { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir: join(root, 'config'),
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: '/tmp/foo*/plugin/evals/alpha/case.yaml',
      caseDir: '/tmp/foo*/plugin/evals/alpha',
      caseSource: 'case_yaml',
      pluginDirs: ['/tmp/foo*/plugin'],
      pluginDirsUnderTest: ['/tmp/foo*/plugin'],
      evalDirSegments: ['evals'],
    }
    await expect(
      applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
        isSupportedPlatform: () => true,
        checkDependencies: () => ({ errors: [] }),
        isPlatformInEnabledList: () => true,
        operatorHome: () => join(root, 'operator-home'),
        policySandboxes: () => [],
      }),
    ).rejects.toMatchObject({
      code: 'eval shell grant refused: glob char in a sandbox deny root',
    })
  })

  test('af refuses glob char in a credentials pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-af-credglob-'))
    tempDirs.push(root)
    await mkdir(join(root, 'config'), { recursive: true })
    await mkdir(join(root, 'plugin', 'evals', 'alpha'), { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir: join(root, 'config'),
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(root, 'plugin', 'evals', 'alpha', 'case.yaml'),
      caseDir: join(root, 'plugin', 'evals', 'alpha'),
      caseSource: 'case_yaml',
      pluginDirs: [join(root, 'plugin')],
      pluginDirsUnderTest: [join(root, 'plugin')],
      evalDirSegments: ['evals'],
    }
    await expect(
      applyEvalSandboxSettings(sandbox, ['Bash'], [], case_, {
        isSupportedPlatform: () => true,
        checkDependencies: () => ({ errors: [] }),
        isPlatformInEnabledList: () => true,
        operatorHome: () => join(root, 'operator-home'),
        policySandboxes: () => [],
        childEnv: {
          AWS_SHARED_CREDENTIALS_FILE: '/opt/corp/aws*',
        },
      }),
    ).rejects.toMatchObject({
      code: 'eval shell grant refused: glob char in a credential file path',
    })
  })

  test('sp wx-writes remote-settings.json and refuses a different occupant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-sp-'))
    tempDirs.push(root)
    const configDir = join(root, 'config')
    await mkdir(configDir, { recursive: true })
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir,
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    await writeEvalPolicySnapshot(sandbox, {
      policyCache: () => ({
        permissions: { deny: ['Bash'], allow: ['Read'] },
        disableAllHooks: true,
      }),
      policyEligible: () => false,
    })
    const path = join(configDir, EVAL_REMOTE_SETTINGS_FILE)
    const first = JSON.parse(await readFile(path, 'utf8')) as {
      managedSourcesBehavior: string
      permissions: { deny: string[] }
      allowManagedHooksOnly: boolean
    }
    expect(first.managedSourcesBehavior).toBe('merge')
    expect(first.permissions.deny).toEqual(['Bash'])
    expect(first.permissions).not.toHaveProperty('allow')
    expect(first.allowManagedHooksOnly).toBe(true)
    await writeEvalPolicySnapshot(sandbox, {
      policyCache: () => ({
        permissions: { deny: ['Bash'], allow: ['Read'] },
        disableAllHooks: true,
      }),
      policyEligible: () => false,
    })
    await writeFile(path, '{"managedSourcesBehavior":"other"}\n')
    await expect(
      writeEvalPolicySnapshot(sandbox, {
        policyCache: () => ({ permissions: { deny: ['Bash'] } }),
        policyEligible: () => false,
      }),
    ).rejects.toMatchObject({ code: 'eval policy snapshot refused' })
  })

  test('rp junctions AWS SSO cache dirs and always mkdirs git/lib', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-rp-'))
    tempDirs.push(root)
    const operatorHome = join(root, 'operator-home')
    const sso = join(operatorHome, '.aws', 'sso')
    await mkdir(sso, { recursive: true })
    await writeFile(join(sso, 'cache.bin'), 'token')
    const sandbox: EvalSandbox = {
      root,
      cwd: join(root, 'home', 'cwd'),
      configDir: join(root, 'config'),
      home: join(root, 'home'),
      outDir: join(root, 'out'),
      tmpDir: join(root, 'tmp'),
      operatorConfigDir: join(root, 'operator'),
      cleanup: async () => {},
    }
    await mkdir(sandbox.home, { recursive: true })
    await linkEvalAwsSsoCaches(
      sandbox,
      { AWS_CONFIG_FILE: join(operatorHome, '.aws', 'config') },
      { operatorHome: () => operatorHome },
    )
    expect(await realpath(join(sandbox.home, '.aws', 'sso'))).toBe(
      await realpath(sso),
    )
    expect(
      await readFile(join(sandbox.home, '.aws', 'sso', 'cache.bin'), 'utf8'),
    ).toBe('token')
    await stat(join(sandbox.home, '.config', 'git'))
    await stat(join(sandbox.home, '.local', 'lib'))
  })

  test('empty-case still after suite; yPt and --tag fd KEEP', async () => {
    const handler = await readFile(
      join(import.meta.dir, '../../../cli/handlers/pluginEval.ts'),
      'utf8',
    )
    expect(handler).toContain('runPluginEvalSuite')
    expect(handler).toContain('No eval cases found${gt} under')
    expect(handler).toContain(
      "!getFeatureValue_CACHED_MAY_BE_STALE('tengu_sharded_snowflake', false)",
    )
    const discover = await readFile(
      join(import.meta.dir, '../pluginEval/discoverCases.ts'),
      'utf8',
    )
    expect(discover).toContain('tags')
  })

  test('ql writeRunMocks returns nonce+callLogPath; Of identity fail-closes without ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-ql-'))
    tempDirs.push(root)
    const servers: MockServerBinding[] = [
      {
        kind: 'standalone',
        registeredName: 'jira',
        segment: 'jira',
        loaded: {
          dirName: 'jira',
          tools: new Map([['create', { kind: 'fixed', prompt: 'ok' }]]),
          listings: new Map(),
          recordings: {},
        },
      },
    ]
    const prepared = await writeRunMocks(servers, root, { maxTurns: 3 })
    expect(prepared).not.toBeNull()
    if (!prepared) return
    expect(prepared.nonce).toMatch(/^[0-9a-f]{12}$/)
    expect(prepared.callLogPath).toBe(join(root, 'mock-calls.jsonl'))
    expect(prepared.mockedTools).toEqual(['mcp__jira__create'])
    expect(prepared.agentCallBudget).toBe(0)
    const init = {
      type: 'system',
      subtype: 'init',
      mcp_servers: [{ name: 'jira', status: 'connected' }],
      tools: ['mcp__jira__create'],
    }
    const identity = await checkMockInit(init, prepared)
    expect(identity?.kind).toBe('identity')
    expect(identity?.message).toContain(
      "did not identify as this run's mock stand-in",
    )
    await writeFile(
      prepared.callLogPath,
      `${JSON.stringify({ ready: prepared.nonce, server: 'jira' })}\n`,
    )
    expect(await checkMockInit(init, prepared)).toBeNull()
  })

  test('$f refuses grading when the trace outnumbers stand-in records', () => {
    const mocks = {
      configPath: '/tmp/mocks.json',
      callLogPath: '/tmp/mock-calls.jsonl',
      nonce: 'deadbeef',
      mockedTools: ['mcp__jira__create'],
      agentRun: null,
      agentCallBudget: 0,
      servers: [
        {
          dirName: 'jira',
          registeredName: 'jira',
          segment: 'jira',
          kind: 'standalone' as const,
          withheld: false,
          tools: ['create'],
          toolFullNames: { create: 'mcp__jira__create' },
          responderKinds: { create: 'fixed' as const },
          expects: {},
        },
      ],
    }
    const mismatch = compareMockCallLog(
      [
        {
          name: 'mcp__jira__create',
          input: {},
          inputText: '{}',
          output: 'ok',
          isError: false,
        },
      ],
      [],
      mocks,
      null,
    )
    expect(mismatch).toContain('mocked calls to jira/create')
    expect(mismatch).toContain('the run is not graded')
  })

  test('Cf aborts when the model call violates expect', async () => {
    const mocks = {
      configPath: '/tmp/mocks.json',
      callLogPath: '/tmp/mock-calls.jsonl',
      nonce: 'cafebabe',
      mockedTools: ['mcp__jira__create'],
      agentRun: null,
      agentCallBudget: 0,
      servers: [
        {
          dirName: 'jira',
          registeredName: 'jira',
          segment: 'jira',
          kind: 'standalone' as const,
          withheld: false,
          tools: ['create'],
          toolFullNames: { create: 'mcp__jira__create' },
          responderKinds: { create: 'fixed' as const },
          expects: { create: { ticket: '1' } },
        },
      ],
    }
    const watch = createMockTraceWatcher(mocks)
    const verdict = await watch({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'mcp__jira__create',
            input: { ticket: '2' },
          },
        ],
      },
    })
    expect(verdict?.kind).toBe('abort')
    expect(verdict && 'message' in verdict ? verdict.message : '').toContain(
      'stopped by harness:',
    )
  })

  test('runOne source-locks mockSetupFailure skip of gradeRun', async () => {
    const src = await readFile(
      join(import.meta.dir, '../pluginEval/runSuite.ts'),
      'utf8',
    )
    expect(src).toContain('agent.mockSetupFailure !== null')
    expect(src).toContain(
      'agent.aborted !== null || agent.mockSetupFailure !== null',
    )
    const spawn = await readFile(
      join(import.meta.dir, '../pluginEval/spawnEval.ts'),
      'utf8',
    )
    expect(spawn).toContain('createMockTraceWatcher')
    expect(spawn).toContain('applyMockIntegrity')
    expect(spawn).toContain('watchVerdict !== null')
  })

  test('pg mismatch when the trace result is not a harness answer', () => {
    const mocks = {
      configPath: '/tmp/mocks.json',
      callLogPath: '/tmp/mock-calls.jsonl',
      nonce: 'deadbeef',
      mockedTools: ['mcp__jira__create'],
      agentRun: null,
      agentCallBudget: 12,
      servers: [
        {
          dirName: 'jira',
          registeredName: 'jira',
          segment: 'jira',
          kind: 'standalone' as const,
          withheld: false,
          tools: ['create'],
          toolFullNames: { create: 'mcp__jira__create' },
          responderKinds: { create: 'agent' as const },
          expects: {},
        },
      ],
    }
    const compared = compareAgentMockAnswers(
      [
        {
          server: 'jira',
          tool: 'create',
          inputKey: 'abc',
          verdict: 'ok',
          outputKey: 'created',
        },
      ],
      {
        killedInFlight: false,
        toolCalls: [
          {
            name: 'mcp__jira__create',
            input: { ticket: '1' },
            inputText: '{"ticket":"1"}',
            output: 'rewritten-by-hook',
            isError: false,
            mock: { responder: 'agent', verdict: 'ok' },
          },
        ],
      },
      mocks,
    )
    expect(compared.mismatch).toContain(
      'a result in the trace is not one the harness gave',
    )
    expect(compared.absorbedInFlightAnswer).toBe(false)
  })

  test('pg absorbedInFlightAnswer when killed with one leftover answer', () => {
    const mocks = {
      configPath: '/tmp/mocks.json',
      callLogPath: '/tmp/mock-calls.jsonl',
      nonce: 'deadbeef',
      mockedTools: ['mcp__jira__create'],
      agentRun: null,
      agentCallBudget: 12,
      servers: [
        {
          dirName: 'jira',
          registeredName: 'jira',
          segment: 'jira',
          kind: 'standalone' as const,
          withheld: false,
          tools: ['create'],
          toolFullNames: { create: 'mcp__jira__create' },
          responderKinds: { create: 'agent' as const },
          expects: {},
        },
      ],
    }
    const compared = compareAgentMockAnswers(
      [
        {
          server: 'jira',
          tool: 'create',
          inputKey: 'abc',
          verdict: 'ok',
          outputKey: 'created',
        },
      ],
      {
        killedInFlight: true,
        toolCalls: [
          {
            name: 'mcp__jira__create',
            input: { ticket: '1' },
            inputText: '{"ticket":"1"}',
            mock: { responder: 'agent', verdict: 'no_result' },
          },
        ],
      },
      mocks,
    )
    expect(compared.mismatch).toBeNull()
    expect(compared.absorbedInFlightAnswer).toBe(true)
  })

  test('dc refuses a planted .eval-artifacts directory in cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-dc-'))
    tempDirs.push(root)
    await mkdir(join(root, '.eval-artifacts'), { recursive: true })
    await writeFile(join(root, '.eval-artifacts', 'index.html'), 'x')
    const snapshot = new Set(['.eval-artifacts/index.html'])
    await expect(cwdPlantedEvalArtifacts(root, snapshot)).resolves.toBe(true)
  })

  test('dc drops an empty placeholder .eval-artifacts file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-dc-ph-'))
    tempDirs.push(root)
    await writeFile(join(root, '.eval-artifacts'), '')
    const snapshot = new Set(['.eval-artifacts'])
    await expect(cwdPlantedEvalArtifacts(root, snapshot)).resolves.toBe(false)
    expect(snapshot.has('.eval-artifacts')).toBe(false)
  })

  test('runOne source-locks pg + dc before gradeRun', async () => {
    const src = await readFile(
      join(import.meta.dir, '../pluginEval/runSuite.ts'),
      'utf8',
    )
    expect(src).toContain('applyAgentMockAnswerIntegrity')
    expect(src).toContain('cwdPlantedEvalArtifacts')
    expect(src).toContain('PLANTED_EVAL_ARTIFACTS')
    const fence = await readFile(
      join(import.meta.dir, '../pluginEval/evalArtifactsFence.ts'),
      'utf8',
    )
    expect(fence).toContain('the run created ${EVAL_ARTIFACTS_DIR}/')
  })

  test('Ca: shadow-only mocks make ablation mock_calls with-only', () => {
    const shadow: MockServerBinding = {
      kind: 'shadow',
      registeredName: 'jira',
      segment: 'jira',
      loaded: {
        dirName: 'jira',
        tools: new Map([['create', { kind: 'fixed' }]]),
        listings: new Map(),
        recordings: {},
      },
    }
    const withheld: MockServerBinding = {
      kind: 'shadow',
      registeredName: 'dead',
      segment: 'dead',
      withheld: true,
      loaded: {
        dirName: 'dead',
        tools: new Map([['x', { kind: 'fixed' }]]),
        listings: new Map(),
        recordings: {},
      },
    }
    const standalone: MockServerBinding = {
      kind: 'standalone',
      registeredName: 'extra',
      segment: 'extra',
      loaded: {
        dirName: 'extra',
        tools: new Map([['ping', { kind: 'fixed' }]]),
        listings: new Map(),
        recordings: {},
      },
    }
    expect(mockCallsWithOnly([shadow], 'without')).toBe(true)
    expect(mockCallsWithOnly([shadow], 'with')).toBe(true)
    expect(mockCallsWithOnly([shadow, standalone], 'without')).toBe(false)
    expect(mockCallsWithOnly([standalone], 'without')).toBe(false)
    expect(mockCallsWithOnly([withheld], 'without')).toBe(false)
    expect(mockCallsWithOnly([], 'without')).toBe(false)
    expect(mockCallsWithOnly([shadow], undefined)).toBe(false)
  })

  test('Ar/sg lists stub-publishes as .eval-artifacts/${q}', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-ar-'))
    tempDirs.push(root)
    const stub = join(root, 'stub-publishes')
    await mkdir(join(stub, 'pub'), { recursive: true })
    await writeFile(join(stub, 'pub', 'index.html'), 'ok')
    const snapshot = new Set<string>()
    await addStubPublishListings(snapshot, stub)
    expect([...snapshot].sort()).toEqual(['.eval-artifacts/pub/index.html'])
  })

  test('Ar ENOENT leaves snapshot empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-ar-miss-'))
    tempDirs.push(root)
    const snapshot = new Set<string>(['keep'])
    await addStubPublishListings(snapshot, join(root, 'stub-publishes'))
    expect([...snapshot]).toEqual(['keep'])
  })

  test('runOne source-locks Ca + stubPublishDir into gradeRun', async () => {
    const src = await readFile(
      join(import.meta.dir, '../pluginEval/runSuite.ts'),
      'utf8',
    )
    expect(src).toContain(
      'mockCallsWithOnly: mockCallsWithOnly(mockServers, arm)',
    )
    expect(src).toContain('addStubPublishListings(after, stubDir)')
    expect(src).toContain('stubPublishDir: granted ? stubDir : undefined')
    expect(src).toContain('runEvalScaffold')
    expect(src).toContain('snapshotEvalCwd')
    expect(src).toContain('adviseFileCreateGraders')
    expect(src).toContain('keptSandboxRmRecipe')
    expect(src).toContain(
      "cwdPlantedEvalArtifacts(sandbox.cwd, before, 'scaffold')",
    )
  })

  test('Yi refuses a cwd that is a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-yi-'))
    tempDirs.push(root)
    const real = join(root, 'real')
    const link = join(root, 'link')
    await mkdir(real)
    await writeFile(join(real, 'a.txt'), 'x')
    await symlink(real, link)
    await expect(snapshotEvalCwd(link)).rejects.toMatchObject({
      code: 'eval run directory replaced',
    })
  })

  test('Yi lists nested files under a real cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-yi-ok-'))
    tempDirs.push(root)
    const cwd = await realpath(root)
    await mkdir(join(cwd, 'sub'))
    await writeFile(join(cwd, 'a.txt'), 'x')
    await writeFile(join(cwd, 'sub', 'b.txt'), 'y')
    const files = await snapshotEvalCwd(cwd)
    expect([...files].sort()).toEqual(['a.txt', 'sub/b.txt'])
  })

  test('xl advises file_exists exists:true without Write/Edit/Bash', () => {
    const cse: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 1,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        env: {},
      },
      runs: 1,
      graders: [
        {
          type: 'file_exists',
          name: 'wrote',
          path: 'out.txt',
          exists: true,
          weight: 1,
        },
      ],
      caseFile: '/tmp/case.yaml',
      caseDir: '/tmp',
      caseSource: 'case_yaml',
      pluginDirs: [],
      pluginDirsUnderTest: [],
      evalDirSegments: ['evals'],
    }
    expect(graderChecksCreatedFile(cse.graders[0]!, false)).toBe(true)
    const advice = adviseFileCreateGraders(cse, [], {
      scaffolded: false,
      artifactPublishGranted: false,
      mockedTools: [],
    })
    expect(advice[0]?.text).toContain('cannot pass with the granted tools')
    expect(advice[0]?.text).toContain('--allow-tools')
    expect(
      adviseFileCreateGraders(cse, ['Write'], {
        scaffolded: false,
        artifactPublishGranted: false,
        mockedTools: [],
      }),
    ).toEqual([])
  })

  test('xl advises tool_used Bash when Bash is leftover-denied', () => {
    const cse: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 1,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        env: {},
      },
      runs: 1,
      graders: [
        {
          type: 'tool_used',
          name: 'used-bash',
          tool: 'Bash',
          weight: 1,
        },
        {
          type: 'tool_used',
          name: 'used-monitor',
          tool: 'Monitor',
          weight: 1,
        },
        {
          type: 'tool_used',
          name: 'used-artifact',
          tool: 'Artifact',
          weight: 1,
        },
        {
          type: 'tool_used',
          name: 'used-read',
          tool: 'Read',
          weight: 1,
        },
      ],
      caseFile: '/tmp/case.yaml',
      caseDir: '/tmp',
      caseSource: 'case_yaml',
      pluginDirs: [],
      pluginDirsUnderTest: [],
      evalDirSegments: ['evals'],
    }
    const advice = adviseFileCreateGraders(cse, [], {
      scaffolded: false,
      artifactPublishGranted: false,
      mockedTools: [],
    })
    expect(advice.map(row => row.grader)).toEqual([
      'used-bash',
      'used-monitor',
      'used-artifact',
    ])
    expect(advice[0]?.text).toContain('--allow-tools Bash')
    expect(advice[1]?.text).toContain('never available inside an eval run')
    expect(advice[2]?.text).toContain('artifact-publishing opt-in')
    expect(
      adviseFileCreateGraders(cse, ['Bash'], {
        scaffolded: false,
        artifactPublishGranted: true,
        mockedTools: [],
      }).map(row => row.grader),
    ).toEqual(['used-monitor'])
  })

  test('xl tool_used still advises when the case lists the tool without --allow-tools', () => {
    // gold tr: case allowed_tools Bash is denied unless operator grants it.
    const cse: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 1,
        timeout_seconds: 30,
        allowed_tools: ['Bash'],
        env: {},
      },
      runs: 1,
      graders: [
        {
          type: 'tool_used',
          name: 'used-bash',
          tool: 'Bash',
          weight: 1,
        },
      ],
      caseFile: '/tmp/case.yaml',
      caseDir: '/tmp',
      caseSource: 'case_yaml',
      pluginDirs: [],
      pluginDirsUnderTest: [],
      evalDirSegments: ['evals'],
    }
    expect(
      adviseFileCreateGraders(cse, [], {
        scaffolded: false,
        artifactPublishGranted: false,
        mockedTools: [],
      }).map(row => row.grader),
    ).toEqual(['used-bash'])
  })

  test('xl tool_order advises withheld before/after tools; min:0 tool_used does not', () => {
    const cse: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 1,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        env: {},
      },
      runs: 1,
      graders: [
        {
          type: 'tool_order',
          name: 'order',
          before: { tool: 'Bash' },
          after: { tool: 'Read' },
          weight: 1,
        },
        {
          type: 'tool_used',
          name: 'absent-monitor',
          tool: 'Monitor',
          min: 0,
          max: 0,
          weight: 1,
        },
      ],
      caseFile: '/tmp/case.yaml',
      caseDir: '/tmp',
      caseSource: 'case_yaml',
      pluginDirs: [],
      pluginDirsUnderTest: [],
      evalDirSegments: ['evals'],
    }
    const advice = adviseFileCreateGraders(cse, [], {
      scaffolded: false,
      artifactPublishGranted: false,
      mockedTools: [],
    })
    expect(advice.map(row => row.grader)).toEqual(['order'])
    expect(advice[0]?.text).toContain('needs a Bash call')
  })

  test('Wl Im maps .eval-artifacts/ under stub; ungranted is not a cwd join', () => {
    const { evalArtifactsRelPath } =
      require('../pluginEval/graders.js') as typeof import('../pluginEval/graders.js')
    expect(evalArtifactsRelPath('.eval-artifacts/pub.html')).toBe('pub.html')
    expect(evalArtifactsRelPath('.eval-artifacts')).toBe('.')
    expect(evalArtifactsRelPath('out.txt')).toBe(null)
    expect(evalArtifactsRelPath('../escape')).toBe(null)
    const src = readFileSync(
      join(import.meta.dir, '../pluginEval/graders.ts'),
      'utf8',
    )
    expect(src).toContain(
      'artifact publishing was not granted for this run, so nothing was published',
    )
    expect(src).toContain('stubPublishDir')
    expect(src).toContain('getTotalCostUSD() - costBefore')
  })

  test('ng skipPaid is this spawn vs prior spent, then eg adds cost_usd', () => {
    const src = readFileSync(
      join(import.meta.dir, '../pluginEval/runSuite.ts'),
      'utf8',
    )
    expect(src).toContain('agent.costUsd >= params.maxCostUsd - spent.value')
    expect(src).toContain('spent.value += report.cost_usd')
    expect(src).not.toContain('spent.value += agent.costUsd')
  })

  test('rg runs a trusted scaffold_script as bash and captures stderr', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-rg-'))
    tempDirs.push(root)
    const cwd = join(root, 'cwd')
    const home = join(root, 'home')
    const tmpDir = join(root, 'tmp')
    await mkdir(cwd)
    await mkdir(home)
    await mkdir(tmpDir)
    const script = join(root, 'setup.sh')
    await writeFile(script, '#!/bin/bash\necho staged > "$PWD/ok.txt"\n')
    const result = await runEvalScaffold(
      script,
      {
        root,
        cwd,
        configDir: join(root, 'config'),
        home,
        outDir: join(root, 'out'),
        tmpDir,
        operatorConfigDir: join(root, 'op'),
        cleanup: async () => {},
      },
      new AbortController().signal,
    )
    expect(result.code).toBe(0)
    expect(await readFile(join(cwd, 'ok.txt'), 'utf8')).toBe('staged\n')
  })

  test('$R maps Commander --scaffold onto noScaffold=false', () => {
    expect(resolveEvalNoScaffold({})).toBe(true)
    expect(resolveEvalNoScaffold({ noScaffold: true })).toBe(true)
    expect(resolveEvalNoScaffold({ scaffold: true })).toBe(false)
    expect(resolveEvalNoScaffold({ scaffold: false })).toBe(true)
    expect(resolveEvalNoScaffold({ scaffold: true, noScaffold: true })).toBe(
      false,
    )
    const handler = readFileSync(
      join(import.meta.dir, '../../../cli/handlers/pluginEval.ts'),
      'utf8',
    )
    expect(handler).toContain('resolveEvalNoScaffold(options)')
    expect(handler).toContain('if (!noScaffold)')
  })

  test('fc quotes a unix rm recipe; dc scaffold phase does not drop placeholder', async () => {
    expect(keptSandboxRmRecipe('/tmp/e-abc')).toContain('rm -rf')
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-dc-sc-'))
    tempDirs.push(root)
    await writeFile(join(root, '.eval-artifacts'), '')
    const snapshot = new Set(['.eval-artifacts'])
    await expect(
      cwdPlantedEvalArtifacts(root, snapshot, 'scaffold'),
    ).resolves.toBe(true)
    expect(snapshot.has('.eval-artifacts')).toBe(true)
  })

  test('tr withholds case Bash unless operator --allow-tools grants it', () => {
    const bash = grantEvalAllowedTools(['Bash', 'Read'], [])
    expect(bash.allowed).toContain('Read')
    expect(bash.allowed).not.toContain('Bash')
    expect(bash.denied).toContain('Bash')
    const granted = grantEvalAllowedTools(['Bash', 'Read'], ['Bash'])
    expect(granted.allowed).toContain('Bash')
    expect(granted.denied).not.toContain('Bash')
    const src = readFileSync(
      join(import.meta.dir, '../pluginEval/runSuite.ts'),
      'utf8',
    )
    expect(src).toContain('grantEvalAllowedTools')
    expect(src).toContain('not granted (missing --allow-tools grant')
    expect(src).toContain('authBackstopArmed')
    expect(src).toContain("partialReason = 'auth_failed'")
  })

  test('Ji withholds artifact_publish unless operator env or param', () => {
    const cse: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 1,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        artifact_publish: true,
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: '/tmp/case.yaml',
      caseDir: '/tmp',
      caseSource: 'case_yaml',
      pluginDirs: [],
      pluginDirsUnderTest: [],
      evalDirSegments: ['evals'],
    }
    const priorPublish = process.env.CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH
    const priorFlags = process.env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES
    delete process.env.CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH
    delete process.env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES
    try {
      expect(isEvalArtifactPublishGranted(cse, {})).toBe(false)
      expect(isEvalArtifactPublishGranted(cse, { artifactPublish: true })).toBe(
        true,
      )
      expect(
        isEvalArtifactPublishGranted(
          { ...cse, execution: { ...cse.execution, artifact_publish: false } },
          { artifactPublish: true },
        ),
      ).toBe(false)
      process.env.CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH = 'true'
      expect(isEvalArtifactPublishGranted(cse, {})).toBe(true)
      expect(
        isEvalArtifactPublishGranted(cse, { artifactPublish: false }),
      ).toBe(false)
      process.env.CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH = '1'
      expect(isEvalArtifactPublishGranted(cse, {})).toBe(true)
      process.env.CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH = 'false'
      expect(isEvalArtifactPublishGranted(cse, {})).toBe(false)
    } finally {
      if (priorPublish === undefined) {
        delete process.env.CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH
      } else {
        process.env.CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH = priorPublish
      }
      if (priorFlags === undefined) {
        delete process.env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES
      } else {
        process.env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES = priorFlags
      }
    }
    const src = readFileSync(
      join(import.meta.dir, '../pluginEval/runSuite.ts'),
      'utf8',
    )
    expect(src).toContain('isEvalArtifactPublishGranted')
    expect(src).toContain(
      'requests artifact publishing; not granted (operator opt-in required)',
    )
    expect(src).not.toContain(
      'artifactPublishGranted: cse.execution.artifact_publish === true',
    )
    expect(src).toContain('artifact publishing enabled with no --max-cost-usd')
    const handler = readFileSync(
      join(import.meta.dir, '../../../cli/handlers/pluginEval.ts'),
      'utf8',
    )
    expect(handler).not.toContain('artifactPublish:')
  })

  test('lg seeds only allowlisted growthbook_overrides', () => {
    const cse: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 1,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        artifact_publish: true,
        growthbook_overrides: { keep_me: true, drop_me: 1 },
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: '/tmp/case.yaml',
      caseDir: '/tmp',
      caseSource: 'case_yaml',
      pluginDirs: [],
      pluginDirsUnderTest: [],
      evalDirSegments: ['evals'],
    }
    const prior = process.env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES
    delete process.env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES
    try {
      expect(seedEvalGrowthbookOverrides(cse, {})).toEqual({
        declared: { keep_me: true, drop_me: 1 },
        seeded: {},
        dropped: ['keep_me', 'drop_me'],
      })
      expect(
        seedEvalGrowthbookOverrides(cse, { allowFlagOverrides: ['keep_me'] }),
      ).toEqual({
        declared: { keep_me: true, drop_me: 1 },
        seeded: { keep_me: true },
        dropped: ['drop_me'],
      })
      process.env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES = ' keep_me , other '
      expect(seedEvalGrowthbookOverrides(cse, {})).toEqual({
        declared: { keep_me: true, drop_me: 1 },
        seeded: { keep_me: true },
        dropped: ['drop_me'],
      })
      expect(
        seedEvalGrowthbookOverrides(cse, { allowFlagOverrides: [] }),
      ).toEqual({
        declared: { keep_me: true, drop_me: 1 },
        seeded: {},
        dropped: ['keep_me', 'drop_me'],
      })
    } finally {
      if (prior === undefined) {
        delete process.env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES
      } else {
        process.env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES = prior
      }
    }
    const src = readFileSync(
      join(import.meta.dir, '../pluginEval/runSuite.ts'),
      'utf8',
    )
    expect(src).toContain('seedEvalGrowthbookOverrides')
    expect(src).toContain(
      'growthbook_overrides not applied — they seed only a run granted artifact publishing',
    )
    expect(src).toContain('seeding growthbook_overrides')
    expect(src).toContain(
      'growthbook_overrides dropped (operator allowlist required — CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES)',
    )
    expect(src).toContain('growthbookOverrides: grant.seededFlags')
    const sandbox: EvalSandbox = {
      root: '/tmp/e-root',
      cwd: '/tmp/e-root/home/cwd',
      configDir: '/tmp/e-root/config',
      home: '/tmp/e-root/home',
      outDir: '/tmp/e-root/out',
      tmpDir: '/tmp/e-root/tmp',
      operatorConfigDir: '/tmp/operator',
      cleanup: async () => {},
    }
    const denied = buildEvalChildEnv(cse, sandbox, false, { keep_me: true })
    expect(denied.CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR).toBeUndefined()
    expect(denied.CLAUDE_INTERNAL_FC_OVERRIDES).toBeUndefined()
    const seeded = buildEvalChildEnv(cse, sandbox, true, { keep_me: true })
    expect(seeded.CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR).toBe(
      join('/tmp/e-root/out', 'stub-publishes'),
    )
    expect(seeded.CLAUDE_INTERNAL_FC_OVERRIDES).toBe(
      JSON.stringify({ keep_me: true }),
    )
  })

  test('$3o refuses a missing spec and a hash mismatch', async () => {
    await expect(runEvalMockServer(undefined)).rejects.toThrow(
      'missing spec path',
    )
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-mock-spec-'))
    tempDirs.push(root)
    const specPath = join(root, 'spec.json')
    const json = JSON.stringify({
      registeredName: 'echo',
      server: 'echo',
      nonce: 'abc',
      callLogPath: join(root, 'mock-calls.jsonl'),
      tools: ['ping'],
      responders: { ping: { kind: 'fixed', body: 'pong' } },
    })
    await writeFile(specPath, json)
    expect(parseEvalMockSpec(json).server).toBe('echo')
    await expect(runEvalMockServer(specPath, 'deadbeef')).rejects.toThrow(
      'spec file does not match the hash the harness launched this stand-in with',
    )
    expect(hashEvalMockSpecJson(json)).toHaveLength(64)
  })

  test('Aa argv is --eval-mock-server spec hash; $o names exclusive managed-mcp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-aa-'))
    tempDirs.push(root)
    const binding: MockServerBinding = {
      kind: 'standalone',
      registeredName: 'echo',
      segment: 'echo',
      loaded: {
        dirName: 'echo',
        tools: new Map([
          [
            'ping',
            {
              kind: 'fixed',
              prompt: 'pong',
              sourceFile: join(root, 'ping.md'),
            },
          ],
        ]),
        listings: new Map(),
        recordings: {},
      },
    }
    const prepared = await writeRunMocks([binding], root)
    expect(prepared).not.toBeNull()
    const config = JSON.parse(
      await readFile(join(root, 'mocks.json'), 'utf8'),
    ) as {
      mcpServers: Record<string, { command: string; args: string[] }>
    }
    const args = config.mcpServers.echo?.args ?? []
    const flag = args.indexOf('--eval-mock-server')
    expect(flag).toBeGreaterThan(-1)
    expect(args[flag + 1]).toContain('echo.json')
    expect(args[flag + 2]).toHaveLength(64)
    const specJson = await readFile(args[flag + 1]!, 'utf8')
    expect(args[flag + 2]).toBe(hashEvalMockSpecJson(specJson))
    const exclusive = new MockEnterpriseExclusiveError(['echo'])
    expect(exclusive.message).toContain(
      'managed-mcp.json gives the organization exclusive control',
    )
    expect(exclusive.code).toBe(
      'mocks: managed-mcp.json exclusive control blocks stand-ins',
    )
    const cli = readFileSync(
      join(import.meta.dir, '../../../entrypoints/cli.tsx'),
      'utf8',
    )
    expect(cli).toContain("process.argv[2] === '--eval-mock-server'")
    expect(cli).toContain('cli_eval_mock_server_path')
    expect(cli).toContain('runEvalMockServer(process.argv[3], process.argv[4])')
  })

  test('bl refuses undecodable UTF-8 names under evalDir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-bl-'))
    tempDirs.push(root)
    const plugin = join(root, 'plugin')
    const evalDir = join(plugin, 'evals')
    const caseDir = join(evalDir, 'alpha')
    await mkdir(caseDir, { recursive: true })
    await writeFile(join(evalDir, 'ok.yaml'), 'name: x\n')
    await expect(
      listEvalFenceDir(evalDir, false, 'case "alpha"', evalDir),
    ).resolves.toEqual(expect.any(Array))
    const bad = join(evalDir, 'bad�name')
    await writeFile(bad, 'x')
    await expect(
      listEvalFenceDir(evalDir, false, 'case "alpha"', evalDir),
    ).rejects.toMatchObject({
      code: 'eval tree has undecodable name',
    })
    const case_: ResolvedCase = {
      schema_version: '1.1',
      name: 'alpha',
      tags: [],
      context: { add_dirs: [] },
      execution: {
        max_turns: 3,
        timeout_seconds: 30,
        allowed_tools: ['Read'],
        env: {},
      },
      runs: 1,
      graders: [],
      caseFile: join(caseDir, 'case.yaml'),
      caseDir,
      caseSource: 'case_yaml',
      pluginDirs: [plugin],
      pluginDirsUnderTest: [plugin],
      evalDirSegments: ['evals'],
    }
    await expect(resolveEvalReadScope(case_)).rejects.toMatchObject({
      code: 'eval tree has undecodable name',
    })
  })

  test('rf subtracts restoredCostUsd from total_cost_usd', async () => {
    const { restoreEvalHistoryCostUsd } = await import(
      '../pluginEval/evalHistoryCost.js'
    )
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-rf-'))
    tempDirs.push(root)
    const hist = join(root, 'hist.jsonl')
    await writeFile(
      hist,
      `${JSON.stringify({ type: 'user', message: { content: 'hi' } })}\n${JSON.stringify({ type: 'cost-state', sessionId: 's', totalCostUSD: 1.25 })}\n${JSON.stringify({ type: 'cost-state', sessionId: 's', totalCostUSD: 2.5 })}\n`,
    )
    expect(await restoreEvalHistoryCostUsd(hist)).toBe(2.5)
    expect(await restoreEvalHistoryCostUsd(join(root, 'missing.jsonl'))).toBe(0)
    const parsed = parseEvalChildTrace(
      [{ type: 'result', total_cost_usd: 5, num_turns: 1, is_error: false }],
      false,
      { kind: 'ok' },
      join(root, 'trace.jsonl'),
      { restoredCostUsd: 2.5 },
    )
    expect(parsed.costUsd).toBe(2.5)
  })
})
