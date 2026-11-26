import { afterEach, describe, expect, spyOn, test } from 'bun:test'
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
  getFlagSettingsInline,
  getIsInteractive,
  getIsRemoteMode,
  isSessionPersistenceDisabled,
  memoryToggledOff,
  replaceMemoryToggledOff,
  setFlagSettingsInline,
  setIsInteractive,
  setIsRemoteMode,
  setSessionPersistenceDisabled,
} from '../../bootstrap/state.js'
import {
  BRIDGE_SAFE_COMMANDS,
  REMOTE_SAFE_COMMANDS,
  clearCommandMemoizationCaches,
  getBuiltinCommands,
  isBridgeSafeCommand,
} from '../../commands.js'
import type { Command, LocalJSXCommandContext } from '../../types/command.js'
import * as authUtils from '../../utils/auth.js'
import * as providersUtils from '../../utils/model/providers.js'
import accessCommand from '../access/index.js'
import {
  call as callAccess,
  fetchMemberPrograms,
  setMemberProgramsFetcherForTesting,
} from '../access/access.js'
import backgroundCommand from '../background/index.js'
import { call as callBackground } from '../background/background.js'
import cloudPluginsCommand from '../cloud-plugins/index.js'
import {
  decideCloudPlugins,
  readCloudPluginsConsent,
} from '../cloud-plugins/cloud-plugins.js'
import importCommand, { importNonInteractive } from '../import/index.js'
import { runImportNonInteractive } from '../import/import-noninteractive.js'
import {
  computeImportScanDigest,
  getAutoImportHoldReason,
  hasShellExecMarker,
  isAutoImportSafe,
  isPathStrictlyInside,
  sanitizeImportedName,
  scanForeignAgentConfigs,
} from '../import/scanner.js'
import pauseMemoryCommand from '../pause-memory/index.js'
import {
  call as callPauseMemory,
  canResumeMemoryInSession,
} from '../pause-memory/pause-memory.js'
import powerupCommand from '../powerup/index.js'
import {
  POWERUP_LESSONS,
  loadUnlockedPowerups,
  saveUnlockedPowerups,
} from '../powerup/lessons.js'
import { call as callPowerup } from '../powerup/powerup.js'
import proTrialExpiredCommand from '../pro-trial-expired/index.js'
import { call as callProTrialExpired } from '../pro-trial-expired/pro-trial-expired.js'
import projectCommand from '../project/index.js'
import {
  call as callProject,
  extractProjectIdInput,
} from '../project/project.js'
import remoteWorkflowCommand from '../remote-workflow/index.js'
import { call as callRemoteWorkflow } from '../remote-workflow/remote-workflow.js'
import { formatRemoteWorkflowError } from '../remote-workflow/remoteWorkflowRunner.js'
import setupVertexCommand from '../setup-vertex/index.js'
import { call as callSetupVertex } from '../setup-vertex/setup-vertex.js'
import {
  buildVertexSettingsEnv,
  discoverGcloudProjects,
  verifyVertexWizardCredentials,
} from '../setup-vertex/vertexVerify.js'
import stopCommand, { stopNonInteractive } from '../stop/index.js'
import { call as callStop } from '../stop/stop.js'
import { call as callStopNonInteractive } from '../stop/stop-noninteractive.js'
import { setActiveAttachHandle } from '../stop/stopCore.js'
import useCaseCommand from '../use-case/index.js'
import { call as callUseCase } from '../use-case/use-case.js'
import {
  resetProgramUseCaseStoreForTesting,
  setProgramUseCaseChoices,
} from '../use-case/useCaseStore.js'
import wellbeingCommand from '../wellbeing/index.js'
import {
  WRITE_DELAY_MS,
  call as callWellbeing,
} from '../wellbeing/wellbeing.js'
import workflowLaunchExecCommand from '../workflow-launch-exec/index.js'
import {
  NO_PENDING_HANDOFF_MESSAGE,
  call as callWorkflowLaunchExec,
  clearWorkflowLaunchHandoffsForTests,
  registerWorkflowLaunchHandoff,
} from '../workflow-launch-exec/workflow-launch-exec.js'

const ROOT = join(import.meta.dir, '../../..')

const ENV_KEYS_TO_RESTORE = [
  'CLAUDE_CODE_DISABLE_AGENT_VIEW',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_DISABLE_PLUGIN_FORWARDING',
  'CLAUDE_CODE_PROGRAM_USE_CASE_ID',
  'CLAUDE_CODE_ATTRIBUTION_HEADER',
  'CLAUDE_CODE_ATTRIBUTION_PROJECT',
  'CLAUDE_CODE_DISABLE_WORKFLOWS',
  'CLAUDE_REMOTE_WORKFLOW_SCRIPT',
  'CLAUDE_REMOTE_WORKFLOW_ARGS',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_KIND',
  'IS_DEMO',
] as const

const savedEnv: Record<string, string | undefined> = {}
for (const key of ENV_KEYS_TO_RESTORE) {
  savedEnv[key] = process.env[key]
}
const savedIsInteractive = getIsInteractive()
const savedIsRemoteMode = getIsRemoteMode()
const savedSessionPersistenceDisabled = isSessionPersistenceDisabled()

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function makeStubContext(
  overrides?: Partial<LocalJSXCommandContext>,
): LocalJSXCommandContext {
  return {
    messages: [],
    options: {
      isNonInteractiveSession: false,
      ideInstallationStatus: null,
      theme: 'dark',
    },
    getAppState: () => ({ tasks: {} }),
    setMessages: () => {},
    onChangeAPIKey: () => {},
    ...overrides,
  } as unknown as LocalJSXCommandContext
}

afterEach(() => {
  for (const key of ENV_KEYS_TO_RESTORE) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  replaceMemoryToggledOff(false)
  setFlagSettingsInline(null)
  setIsInteractive(savedIsInteractive)
  setIsRemoteMode(savedIsRemoteMode)
  setSessionPersistenceDisabled(savedSessionPersistenceDisabled)
  setActiveAttachHandle(null)
  setMemberProgramsFetcherForTesting(null)
  resetProgramUseCaseStoreForTesting()
  clearWorkflowLaunchHandoffsForTests()
  clearCommandMemoizationCaches()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Official 2.1.331 slash commands registry & visibility alignment', () => {
  test('all 14 missing builtin slash commands are registered in getBuiltinCommands() and mcp__ stays dynamic', () => {
    clearCommandMemoizationCaches()
    const builtins = getBuiltinCommands()
    const byName = new Map(builtins.map(c => [c.name, c]))

    const expectedBuiltins = [
      'import',
      'pause-memory',
      'powerup',
      'project',
      'setup-vertex',
      'background',
      'stop',
      'access',
      'cloud-plugins',
      'use-case',
      'wellbeing',
      'pro-trial-expired',
      '__remote-workflow',
      'workflow-launch-exec',
    ]
    for (const name of expectedBuiltins) {
      expect(byName.has(name)).toBe(true)
    }

    // mcp__ is NOT a static builtin command; it is dynamically constructed per MCP server prompt
    expect(byName.has('mcp__')).toBe(false)
    const mcpClientSrc = readFileSync(
      join(ROOT, 'src/services/mcp/client.ts'),
      'utf8',
    )
    expect(mcpClientSrc).toContain(
      "'mcp__' + normalizeNameForMCP(client.name) + '__' + prompt.name",
    )
  })

  test('gated and hidden commands do not clutter interactive `/` menu when their gates are off', () => {
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW

    // Hidden / internal commands
    expect(remoteWorkflowCommand.isHidden).toBe(true)
    expect(remoteWorkflowCommand.disableModelInvocation).toBe(true)
    expect(workflowLaunchExecCommand.isHidden).toBe(true)
    expect(workflowLaunchExecCommand.disableModelInvocation).toBe(true)
    expect(proTrialExpiredCommand.isHidden).toBe(true)

    // Compile-time disabled in external 2.1.331
    expect(wellbeingCommand.isEnabled?.()).toBe(false)
    expect(pauseMemoryCommand.isEnabled?.()).toBe(false)

    // Feature-gated commands default OFF without GrowthBook flags
    expect(importCommand.isEnabled?.()).toBe(false)
    expect(importCommand.isHidden).toBe(true)
    expect(importNonInteractive.isEnabled?.()).toBe(false)
    expect(accessCommand.isEnabled?.()).toBe(false)
    expect(cloudPluginsCommand.isEnabled?.()).toBe(false)
    expect(useCaseCommand.isEnabled?.()).toBe(false)
    expect(useCaseCommand.isHidden).toBe(true)
    expect(projectCommand.isEnabled?.()).toBe(false)

    // setup-vertex is hidden unless CLAUDE_CODE_USE_VERTEX is truthy
    expect(setupVertexCommand.isHidden).toBe(true)
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(setupVertexCommand.isHidden).toBe(false)

    // stop is disabled in non-bg sessions
    expect(stopCommand.isEnabled?.()).toBe(false)
    expect(stopNonInteractive.isEnabled?.()).toBe(false)

    // powerup & background are visible/enabled by default
    expect((powerupCommand as Command).isHidden).toBeFalsy()
    expect(powerupCommand.requires).toEqual({ ink: true })
    expect(backgroundCommand.isEnabled?.()).toBe(true)
    expect(backgroundCommand.aliases).toEqual(['bg'])
  })

  test('fleetBackground registration respects CLAUDE_CODE_DISABLE_AGENT_VIEW', () => {
    process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW = '1'
    clearCommandMemoizationCaches()
    const names = new Set(getBuiltinCommands().map(c => c.name))
    expect(names.has('background')).toBe(false)
    expect(names.has('stop')).toBe(false)

    delete process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW
    clearCommandMemoizationCaches()
    const namesEnabled = new Set(getBuiltinCommands().map(c => c.name))
    expect(namesEnabled.has('background')).toBe(true)
    expect(namesEnabled.has('stop')).toBe(true)
  })

  test('REMOTE_SAFE_COMMANDS and BRIDGE_SAFE_COMMANDS match official 2.1.331 sets', () => {
    expect(REMOTE_SAFE_COMMANDS.has(cloudPluginsCommand)).toBe(true)
    expect(REMOTE_SAFE_COMMANDS.has(pauseMemoryCommand)).toBe(true)
    expect(REMOTE_SAFE_COMMANDS.has(powerupCommand)).toBe(true)
    expect(REMOTE_SAFE_COMMANDS.has(wellbeingCommand)).toBe(true)
    expect(BRIDGE_SAFE_COMMANDS.has(stopNonInteractive)).toBe(true)
    expect(isBridgeSafeCommand(stopNonInteractive)).toBe(true)
  })
})

describe('/import — foreign agent config scanner & digest-bound apply', () => {
  test('sanitizes names, checks containment, and detects shell-exec markers', () => {
    expect(sanitizeImportedName('../evil---name')).toBe('___evil___name')
    expect(sanitizeImportedName('--leading')).toBe('_leading')
    expect(sanitizeImportedName('CON')).toBe('_CON')
    expect(isPathStrictlyInside('/tmp/root', '/tmp/root/sub/file.md')).toBe(
      true,
    )
    expect(isPathStrictlyInside('/tmp/root', '/tmp/root/../escape.md')).toBe(
      false,
    )
    expect(hasShellExecMarker('safe text')).toBe(false)
    expect(hasShellExecMarker('run !`rm -rf /` now')).toBe(true)
    expect(hasShellExecMarker('```!\necho hi\n```')).toBe(true)

    expect(isAutoImportSafe({ scope: 'user', kind: 'mcp' })).toBe(true)
    expect(isAutoImportSafe({ scope: 'project', kind: 'mcp' })).toBe(false)
    expect(isAutoImportSafe({ scope: 'user', kind: 'skill' })).toBe(false)
    expect(
      isAutoImportSafe({ scope: 'user', kind: 'command', warning: 'warn' }),
    ).toBe(false)
    expect(getAutoImportHoldReason({ scope: 'project', kind: 'mcp' })).toBe(
      'project',
    )
    expect(getAutoImportHoldReason({ scope: 'user', kind: 'skill' })).toBe(
      'warned',
    )
  })

  test('scans codex/gemini/cursor, binds digest on --yes, and imports user-level items non-destructively', async () => {
    const homeDir = makeTempDir('imp-home-')
    const cwd = makeTempDir('imp-cwd-')
    const claudeDir = makeTempDir('imp-claude-')

    // Seed Codex user AGENTS.md + project AGENTS.md + unmappable config.toml
    mkdirSync(join(homeDir, '.codex'), { recursive: true })
    writeFileSync(join(homeDir, '.codex', 'AGENTS.md'), '# Codex user rules\n')
    writeFileSync(join(homeDir, '.codex', 'config.toml'), 'model = "o3"\n')
    writeFileSync(join(cwd, 'AGENTS.md'), '# Project instructions\n')

    // Seed Gemini MCP server + TOML command
    mkdirSync(join(homeDir, '.gemini', 'commands'), { recursive: true })
    writeFileSync(
      join(homeDir, '.gemini', 'settings.json'),
      JSON.stringify({
        mcpServers: {
          myServer: { command: 'node', args: ['server.js'] },
        },
      }),
    )
    writeFileSync(
      join(homeDir, '.gemini', 'commands', 'hello.toml'),
      'prompt = "Say hello to {{args}}"\n',
    )

    // Unknown source returns exact official error
    const badSource = await runImportNonInteractive('unknown-agent', {
      homeDir,
      cwd,
      claudeConfigDir: claudeDir,
    })
    expect(badSource.type).toBe('text')
    if (badSource.type === 'text') {
      expect(badSource.value).toContain('Unknown source "unknown-agent"')
    }

    // Preview returns query with 32-hex digest
    const preview = await runImportNonInteractive('', {
      homeDir,
      cwd,
      claudeConfigDir: claudeDir,
    })
    expect(preview.type).toBe('query')
    const { scans } = await scanForeignAgentConfigs({
      homeDir,
      cwd,
      claudeConfigDir: claudeDir,
    })
    const digest = computeImportScanDigest(scans)
    expect(digest).toMatch(/^[0-9a-f]{32}$/)
    if (preview.type === 'query') {
      expect(preview.value).toContain(digest)
      expect(preview.prompt).toContain(`--yes=${digest}`)
      expect(preview.prompt).toContain('Project-level config: 1 item')
    }

    // --yes without digest is refused
    const missingDigest = await runImportNonInteractive('--yes', {
      homeDir,
      cwd,
      claudeConfigDir: claudeDir,
    })
    expect(missingDigest.type).toBe('text')
    if (missingDigest.type === 'text') {
      expect(missingDigest.value).toContain('needs the scan digest')
    }

    // --yes with stale digest is refused
    const wrongDigest = await runImportNonInteractive(
      '--yes=00000000000000000000000000000000',
      { homeDir, cwd, claudeConfigDir: claudeDir },
    )
    expect(wrongDigest.type).toBe('text')
    if (wrongDigest.type === 'text') {
      expect(wrongDigest.value).toContain('Refusing:')
    }

    // --yes=<digest> --dry-run previews without writing
    const dry = await runImportNonInteractive(`--yes=${digest} --dry-run`, {
      homeDir,
      cwd,
      claudeConfigDir: claudeDir,
    })
    expect(dry.type).toBe('text')
    if (dry.type === 'text') {
      expect(dry.value).toContain('Dry run — would import')
    }

    // --yes=<digest> writes user-level safe items + fallback skill, holds back project item
    const applied = await runImportNonInteractive(`--yes=${digest}`, {
      homeDir,
      cwd,
      claudeConfigDir: claudeDir,
    })
    expect(applied.type).toBe('text')
    if (applied.type === 'text') {
      expect(applied.value).toContain('Imported 3 items:')
      expect(applied.value).toContain('project-level item held back')
      expect(applied.value).toContain('/import-to-claude-code')
    }

    expect(readFileSync(join(claudeDir, 'CLAUDE.md'), 'utf8')).toContain(
      'Codex user rules',
    )
    expect(
      readFileSync(join(claudeDir, 'commands', 'hello.md'), 'utf8'),
    ).toContain('$ARGUMENTS')
    const settingsJson = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    ) as { mcpServers: Record<string, unknown> }
    expect(settingsJson.mcpServers.myServer).toBeDefined()
    expect(
      readFileSync(
        join(claudeDir, 'skills', 'import-to-claude-code', 'SKILL.md'),
        'utf8',
      ),
    ).toContain('config.toml')
  })

  test('refuses symlink escape on target write', async () => {
    const homeDir = makeTempDir('imp-sym-home-')
    const cwd = makeTempDir('imp-sym-cwd-')
    const claudeDir = makeTempDir('imp-sym-claude-')
    const outsideDir = makeTempDir('imp-sym-outside-')

    mkdirSync(join(homeDir, '.codex'), { recursive: true })
    writeFileSync(join(homeDir, '.codex', 'AGENTS.md'), '# test\n')
    symlinkSync(join(outsideDir, 'CLAUDE.md'), join(claudeDir, 'CLAUDE.md'))

    const { scans } = await scanForeignAgentConfigs({
      from: 'codex',
      homeDir,
      cwd,
      claudeConfigDir: claudeDir,
    })
    const item = scans[0]?.result.items.find(
      i => i.id === 'codex:user:instructions',
    )
    expect(item).toBeDefined()
    const res = await item!.apply({ dryRun: false })
    expect(typeof res).toBe('object')
    if (typeof res === 'object') {
      expect(res.skipped).toContain('symlink')
    }
  })
})

describe('/pause-memory — session memory toggle & resume guard', () => {
  test('toggles memoryToggledOff on and off with official copy and enforces resume guard', async () => {
    expect(pauseMemoryCommand.aliases).toEqual([
      'memory-pause',
      'toggle-memory',
    ])
    expect(pauseMemoryCommand.userFacingName?.()).toBe('pause-memory')
    expect(pauseMemoryCommand.description).toContain('account memory')

    process.env.CLAUDE_CODE_REMOTE = '1'
    expect(pauseMemoryCommand.description).toBe(
      'Pause auto-memory for this session',
    )
    delete process.env.CLAUDE_CODE_REMOTE

    process.env.IS_DEMO = '1'
    expect(pauseMemoryCommand.isHidden).toBe(true)
    delete process.env.IS_DEMO

    const ctx = makeStubContext()
    expect(memoryToggledOff()).toBe(false)

    const paused = await callPauseMemory('', ctx)
    expect(memoryToggledOff()).toBe(true)
    expect(paused.type).toBe('text')
    if (paused.type === 'text') {
      expect(paused.value).toContain('Memory paused for this session')
    }

    // Subordinate child session cannot resume memory
    process.env.CLAUDE_CODE_CHILD_SESSION = '1'
    expect(canResumeMemoryInSession()).toBe(false)
    const refused = await callPauseMemory('', ctx)
    expect(memoryToggledOff()).toBe(true)
    if (refused.type === 'text') {
      expect(refused.value).toContain('Memory stays paused')
    }

    // Normal session can resume memory
    delete process.env.CLAUDE_CODE_CHILD_SESSION
    const resumed = await callPauseMemory('', ctx)
    expect(memoryToggledOff()).toBe(false)
    if (resumed.type === 'text') {
      expect(resumed.value).toContain('Memory resumed')
    }
  })
})

describe('/powerup — 10 official lessons & progress persistence', () => {
  test('contains all 10 official lessons, persists unlocked state, and renders dialog', async () => {
    expect(POWERUP_LESSONS.map(l => l.id)).toEqual([
      'at-mentions',
      'modes',
      'undo',
      'background',
      'memory',
      'mcp',
      'automate',
      'subagents',
      'cross-device',
      'model-dial',
    ])

    const cfgDir = makeTempDir('powerup-cfg-')
    expect(loadUnlockedPowerups(cfgDir).size).toBe(0)
    expect(
      saveUnlockedPowerups(
        new Set(['at-mentions', 'modes', 'not-a-real-lesson']),
        cfgDir,
      ),
    ).toBe(true)
    const reloaded = loadUnlockedPowerups(cfgDir)
    expect([...reloaded].sort()).toEqual(['at-mentions', 'modes'])

    const node = await callPowerup(() => {})
    expect(node).not.toBeNull()
  })
})

describe('/project — attribution Project resolution, set & clear', () => {
  test('extracts IDs from URLs and sets/clears inline flag attributionProject', async () => {
    expect(
      extractProjectIdInput(
        'https://claude.ai/project/claude_proj_0111111111111111111111?tab=1',
      ),
    ).toBe('claude_proj_0111111111111111111111')
    expect(
      extractProjectIdInput(
        'https://claude.ai/code/project/00000000-0000-0000-0000-000000000001/',
      ),
    ).toBe('00000000-0000-0000-0000-000000000001')

    const subSpy = spyOn(authUtils, 'isClaudeAISubscriber').mockReturnValue(
      true,
    )
    const urlSpy = spyOn(
      providersUtils,
      'isFirstPartyAnthropicBaseUrl',
    ).mockReturnValue(true)

    try {
      const ctx = makeStubContext()

      const invalid = await callProject('not-a-valid-project', ctx)
      expect(invalid.type).toBe('text')
      if (invalid.type === 'text') {
        expect(invalid.value).toContain("isn't a Project /project can use")
      }

      const validId = '00000000-0000-0000-0000-000000000042'
      const setRes = await callProject(validId, ctx)
      expect(setRes.type).toBe('text')
      if (setRes.type === 'text') {
        expect(setRes.value).toContain(
          `This session now names claude.ai Project ${validId} for usage reports`,
        )
      }
      expect(getFlagSettingsInline()?.attributionProject).toBe(validId)

      const statusRes = await callProject('', ctx)
      if (statusRes.type === 'text') {
        expect(statusRes.value).toContain(validId)
      }

      // --save is refused in non-interactive sessions
      const nonInteractiveCtx = makeStubContext({
        options: {
          isNonInteractiveSession: true,
          ideInstallationStatus: null,
          theme: 'dark',
        },
      } as unknown as Partial<LocalJSXCommandContext>)
      const saveDenied = await callProject(
        `${validId} --save`,
        nonInteractiveCtx,
      )
      if (saveDenied.type === 'text') {
        expect(saveDenied.value).toContain("--save isn't available")
      }

      const clearRes = await callProject('clear', ctx)
      expect(getFlagSettingsInline()?.attributionProject).toBeUndefined()
      if (clearRes.type === 'text') {
        expect(clearRes.value).toContain(
          'Removed the Project set with /project.',
        )
      }

      // Ineligible when CLAUDE_CODE_ATTRIBUTION_HEADER=0
      process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'
      const ineligible = await callProject('', ctx)
      if (ineligible.type === 'text') {
        expect(ineligible.value).toContain("can't name a Project")
      }
    } finally {
      subSpy.mockRestore()
      urlSpy.mockRestore()
    }
  })
})

describe('/setup-vertex — gcloud discovery, verification & env builder', () => {
  test('discovers gcloud projects, verifies service account JSON, builds env patch, and renders wizard', async () => {
    const gcloudDir = makeTempDir('gcloud-cfg-')
    writeFileSync(
      join(gcloudDir, 'config_default'),
      '[core]\nproject = my-vertex-proj\n',
    )
    expect(discoverGcloudProjects(gcloudDir)).toContain('my-vertex-proj')

    const keyDir = makeTempDir('vertex-key-')
    const goodKey = join(keyDir, 'sa.json')
    writeFileSync(
      goodKey,
      JSON.stringify({
        client_email: 'claude@my-vertex-proj.iam.gserviceaccount.com',
        private_key:
          '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
      }),
    )

    const ok = await verifyVertexWizardCredentials({
      authMethod: 'serviceAccount',
      projectId: 'my-vertex-proj',
      region: 'global',
      keyFile: goodKey,
    })
    expect(ok.status).toBe('ok')
    if (ok.status === 'ok') {
      expect(ok.identity).toBe('claude@my-vertex-proj.iam.gserviceaccount.com')
    }

    const bad = await verifyVertexWizardCredentials({
      authMethod: 'serviceAccount',
      projectId: 'my-vertex-proj',
      region: 'global',
      keyFile: join(keyDir, 'missing.json'),
    })
    expect(bad.status).toBe('error')

    const env = buildVertexSettingsEnv({
      authMethod: 'serviceAccount',
      projectId: 'my-vertex-proj',
      region: 'us-east5',
      keyFile: goodKey,
      pinSonnet: 'claude-sonnet-4-5@20250929',
    })
    expect(env.CLAUDE_CODE_USE_VERTEX).toBe('1')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.ANTHROPIC_VERTEX_PROJECT_ID).toBe('my-vertex-proj')
    expect(env.CLOUD_ML_REGION).toBe('us-east5')
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe(goodKey)
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(
      'claude-sonnet-4-5@20250929',
    )

    const node = await callSetupVertex(() => {}, makeStubContext(), '')
    expect(node).not.toBeNull()
  })
})

describe('/background and /stop — background session lifecycle', () => {
  test('/background handles persistence-disabled, empty session, and prompt handoff cleanly', async () => {
    expect(
      typeof backgroundCommand.immediate === 'function'
        ? backgroundCommand.immediate('')
        : false,
    ).toBe(true)
    expect(
      typeof backgroundCommand.immediate === 'function'
        ? backgroundCommand.immediate('continue work')
        : true,
    ).toBe(false)

    // Persistence disabled
    setSessionPersistenceDisabled(true)
    let doneMsg: string | undefined
    const res1 = await callBackground(
      msg => {
        doneMsg = msg
      },
      makeStubContext(),
      '',
    )
    expect(res1).toBeNull()
    expect(doneMsg).toContain("isn't being saved")

    // Empty session with no prompt
    setSessionPersistenceDisabled(false)
    let doneMsg2: string | undefined
    const res2 = await callBackground(
      msg => {
        doneMsg2 = msg
      },
      makeStubContext({ messages: [] }),
      '',
    )
    expect(res2).toBeNull()
    expect(doneMsg2).toBe('Nothing to background yet. Send a message first.')

    // With explicit prompt returns runner element
    const res3 = await callBackground(
      () => {},
      makeStubContext({ messages: [] }),
      'run full tests',
    )
    expect(res3).not.toBeNull()
  })

  test('/stop and stopNonInteractive close active attach handle when attached', async () => {
    let closedCount = 0
    setActiveAttachHandle({
      close: () => {
        closedCount++
      },
    })
    expect(stopCommand.isEnabled?.()).toBe(true)

    let doneCalled = false
    const jsxRes = await callStop(() => {
      doneCalled = true
    }, makeStubContext())
    expect(jsxRes).toBeNull()
    expect(doneCalled).toBe(true)
    expect(closedCount).toBe(1)

    const localRes = await callStopNonInteractive('', makeStubContext())
    expect(localRes).toEqual({ type: 'skip' })
    expect(closedCount).toBe(2)
  })
})

describe('/access, /cloud-plugins, /use-case, /wellbeing, /pro-trial-expired', () => {
  test('/access renders dialog and uses program fetcher cleanly', async () => {
    setMemberProgramsFetcherForTesting(async () => [
      {
        name: 'Research Preview',
        lines: [{ text: 'Active', variant: 'neutral' }],
      },
    ])
    const programs = await fetchMemberPrograms()
    expect(Array.isArray(programs)).toBe(true)
    const node = await callAccess(() => {}, makeStubContext())
    expect(node).not.toBeNull()
  })

  test('/cloud-plugins respects CLAUDE_CODE_DISABLE_PLUGIN_FORWARDING and persists consent choices', async () => {
    process.env.CLAUDE_CODE_DISABLE_PLUGIN_FORWARDING = '1'
    expect(cloudPluginsCommand.isEnabled?.()).toBe(false)

    const cfgDir = makeTempDir('cloud-plugins-cfg-')
    expect(readCloudPluginsConsent(cfgDir)).toBe('unset')

    const notNowMsg = await decideCloudPlugins('not_now', { configDir: cfgDir })
    expect(notNowMsg).toContain('Nothing decided')
    expect(readCloudPluginsConsent(cfgDir)).toBe('unset')

    const acceptMsg = await decideCloudPlugins('accepted', {
      configDir: cfgDir,
    })
    expect(acceptMsg).toContain('Saved: cloud sessions from this machine use')
    expect(readCloudPluginsConsent(cfgDir)).toBe('accepted')

    const declineMsg = await decideCloudPlugins('declined', {
      configDir: cfgDir,
    })
    expect(declineMsg).toContain(
      'your plugins stay on this machine from now on',
    )
    expect(readCloudPluginsConsent(cfgDir)).toBe('declined')
  })

  test('/use-case handles env lock, 0/1/per_grant/multi choices, and direct argument matching', async () => {
    const ctx = makeStubContext()
    let doneMsg: string | undefined
    const onDone = (m?: string) => {
      doneMsg = m
    }

    // 0 choices
    setProgramUseCaseChoices([])
    expect(await callUseCase(onDone, ctx, '')).toBeNull()
    expect(doneMsg).toContain('No Life Sciences use cases are available')

    // 1 choice
    setProgramUseCaseChoices([{ id: 'uc_1', name: 'Genomics' }])
    expect(await callUseCase(onDone, ctx, '')).toBeNull()
    expect(doneMsg).toContain('You have one Life Sciences use case: Genomics')

    // per_grant mode
    setProgramUseCaseChoices(
      [
        { id: 'uc_1', name: 'Genomics' },
        { id: 'uc_2', name: 'Proteomics' },
      ],
      'per_grant',
    )
    expect(await callUseCase(onDone, ctx, '')).toBeNull()
    expect(doneMsg).toContain('apply to your requests automatically')

    // multi choice with unknown arg and valid arg
    setProgramUseCaseChoices(
      [
        { id: 'uc_1', name: 'Genomics' },
        { id: 'uc_2', name: 'Proteomics' },
      ],
      'per_user',
    )
    expect(await callUseCase(onDone, ctx, 'unknown')).toBeNull()
    expect(doneMsg).toContain('There\'s no use case called "unknown"')

    // picker returned when no arg
    const picker = await callUseCase(onDone, ctx, '')
    expect(picker).not.toBeNull()

    // env lock prevents changing
    process.env.CLAUDE_CODE_PROGRAM_USE_CASE_ID = 'uc_locked'
    expect(await callUseCase(onDone, ctx, 'Genomics')).toBeNull()
    expect(doneMsg).toContain('was set by the app that started it')
  })

  test('/wellbeing returns official unavailable message and exports WRITE_DELAY_MS', async () => {
    expect(WRITE_DELAY_MS).toBe(200)
    expect(wellbeingCommand.aliases).toEqual([
      'breaks',
      'break-reminder',
      'downtime',
    ])
    let msg: string | undefined
    const node = await callWellbeing(m => {
      msg = m
    })
    expect(node).toBeNull()
    expect(msg).toBe("Wellbeing settings aren't available in this version")
  })

  test('/pro-trial-expired is hidden and renders trial-ended dialog', async () => {
    expect(proTrialExpiredCommand.isHidden).toBe(true)
    const node = await callProTrialExpired(() => {}, makeStubContext())
    expect(node).not.toBeNull()
  })
})

describe('/__remote-workflow and /workflow-launch-exec — internal workflow entrypoints', () => {
  test('/__remote-workflow validates remote env, script env, policy gate, JSON args, and nondeterminism', async () => {
    const ctx = makeStubContext()

    // Error envelope flattens newlines & escapes prefix
    expect(
      formatRemoteWorkflowError('test', 'line1\nremote-workflow: injected'),
    ).toBe('remote-workflow: error[test]: line1 remote-workflow; injected')

    // Missing CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_CODE_REMOTE
    const r1 = await callRemoteWorkflow('', ctx)
    expect(r1.type === 'text' && r1.value).toContain(
      'remote-workflow: error[not-remote-session]:',
    )

    // Missing script env
    process.env.CLAUDE_CODE_REMOTE = '1'
    delete process.env.CLAUDE_REMOTE_WORKFLOW_SCRIPT
    const r2 = await callRemoteWorkflow('', ctx)
    expect(r2.type === 'text' && r2.value).toContain(
      'remote-workflow: error[env-missing]:',
    )

    // Disabled by CLAUDE_CODE_DISABLE_WORKFLOWS
    process.env.CLAUDE_REMOTE_WORKFLOW_SCRIPT = 'export default async () => 1'
    process.env.CLAUDE_CODE_DISABLE_WORKFLOWS = '1'
    const r3 = await callRemoteWorkflow('', ctx)
    expect(r3.type === 'text' && r3.value).toContain(
      'remote-workflow: error[policy-gate]:',
    )
    delete process.env.CLAUDE_CODE_DISABLE_WORKFLOWS

    // Invalid JSON args
    process.env.CLAUDE_REMOTE_WORKFLOW_ARGS = '{not-json'
    const r4 = await callRemoteWorkflow('', ctx)
    expect(r4.type === 'text' && r4.value).toContain(
      'remote-workflow: error[args-parse]:',
    )
    delete process.env.CLAUDE_REMOTE_WORKFLOW_ARGS

    // Invalid meta fails meta-parse
    process.env.CLAUDE_REMOTE_WORKFLOW_SCRIPT =
      'export const meta = { name: "bad" }\nreturn 1'
    const rMeta = await callRemoteWorkflow('', ctx)
    expect(rMeta.type === 'text' && rMeta.value).toContain(
      'remote-workflow: error[meta-parse]:',
    )

    // Nondeterminism guard
    process.env.CLAUDE_REMOTE_WORKFLOW_SCRIPT =
      'export const meta = { name: "bad", description: "test" }\nreturn Date.now()'
    const r5 = await callRemoteWorkflow('', ctx)
    expect(r5.type === 'text' && r5.value).toContain(
      'remote-workflow: error[nondeterminism]:',
    )
  })

  test('/workflow-launch-exec returns official no-slot message and settles registered handoffs once', async () => {
    const ctx = makeStubContext()
    const empty = await callWorkflowLaunchExec('missing-token', ctx)
    expect(empty).toEqual({
      type: 'text',
      value: NO_PENDING_HANDOFF_MESSAGE,
    })

    let settledOk: boolean | undefined
    let postedLine: string | undefined
    registerWorkflowLaunchHandoff('tok-1', {
      script:
        'export const meta = { name: "x", description: "test" }\nreturn Math.random()',
      onRunSettled: ok => {
        settledOk = ok
      },
      postResultLine: line => {
        postedLine = line
      },
    })

    const first = await callWorkflowLaunchExec('tok-1', ctx)
    expect(first.type).toBe('text')
    expect(settledOk).toBe(false)
    expect(postedLine).toContain('remote-workflow: error[nondeterminism]:')
    if (first.type === 'text') {
      expect(first.value).toBe(postedLine ?? '')
    }

    // Replaying the same token returns no-slot (single-use handoff)
    const replay = await callWorkflowLaunchExec('tok-1', ctx)
    expect(replay).toEqual({
      type: 'text',
      value: NO_PENDING_HANDOFF_MESSAGE,
    })
  })
})
