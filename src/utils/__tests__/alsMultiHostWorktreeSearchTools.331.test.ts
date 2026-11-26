import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _resetStoredDbAccessRulesForTesting,
  ArtifactTool,
  PUBLISH_REFUSED_PREFIX,
  recordStoredDbAccessRules,
} from '@claude-code/builtin-tools/tools/ArtifactTool/ArtifactTool.js'
import {
  isArtifactDamsonToolset,
  resetArtifactToolsetLatchForTests,
} from '@claude-code/builtin-tools/tools/ArtifactTool/quickstartCatalog.js'
import {
  clearQuickstartSession,
  getQuickstartGuidanceToolUseId,
  getQuickstartRan,
  recordQuickstartRan,
  setQuickstartGuidanceToolUseId,
} from '@claude-code/builtin-tools/tools/ArtifactTool/quickstartSession.js'
import { EnterWorktreeTool } from '@claude-code/builtin-tools/tools/EnterWorktreeTool/EnterWorktreeTool.js'
import { ExitWorktreeTool } from '@claude-code/builtin-tools/tools/ExitWorktreeTool/ExitWorktreeTool.js'
import {
  getDefaultQueuedNotificationsRegistry,
  resetDefaultQueuedNotificationsRegistryForTests,
} from '@claude-code/builtin-tools/tools/ReadNotificationsTool/notificationQueue.js'
import { ReadNotificationsTool } from '@claude-code/builtin-tools/tools/ReadNotificationsTool/ReadNotificationsTool.js'
import {
  clearPendingWakeupOnFire,
  ScheduleWakeupTool,
} from '@claude-code/builtin-tools/tools/ScheduleWakeupTool/ScheduleWakeupTool.js'
import {
  clearSearchExtraToolsDescriptionCache,
  getToolDescriptionMemoized,
  SearchExtraToolsTool,
} from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/SearchExtraToolsTool.js'
import {
  hasPendingMcpServers,
  isWaitForMcpServersDeclared,
  isWaitForMcpServersEnabled,
  resetWaitForMcpServersStateForTests,
  setLiveMcpClientsForWait,
  setWaitForMcpServersDeclared,
  WaitForMcpServersTool,
} from '@claude-code/builtin-tools/tools/WaitForMcpServersTool/WaitForMcpServersTool.js'
import { getOriginalCwd, resetStateForTests } from '../../bootstrap/state.js'
import {
  clearCommandsCache,
  getSkillToolCommands,
  getSlashCommandToolSkills,
} from '../../commands.js'
import type { LSPServerInstance } from '../../services/lsp/LSPServerInstance.js'
import type { LSPServerManager } from '../../services/lsp/LSPServerManager.js'
import {
  getInitializationStatus,
  getLspServerManager,
  hasEverConnected,
  isLspConnected,
  resetLspManagerForTests,
  setLspManagerForTests,
  shouldDeferLspTool,
  shutdownLspServerManager,
} from '../../services/lsp/manager.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import {
  clearSearchExtraToolsSessionTrackingForTests,
  getSearchExtraToolsPrefetchSnapshot,
  startSearchExtraToolsPrefetch,
  subscribeToSearchExtraToolsPrefetch,
} from '../../services/searchExtraTools/prefetch.js'
import {
  clearToolIndexCache,
  getToolIndex,
} from '../../services/searchExtraTools/toolIndex.js'
import {
  clearSkillIndexCache,
  getSkillIndex,
} from '../../services/skillSearch/localSearch.js'
import {
  clearSkillDiscoveryPrefetchSessionForTests,
  getTurnZeroSkillDiscovery,
  startSkillDiscoveryPrefetch,
} from '../../services/skillSearch/prefetch.js'
import {
  activateConditionalSkillsForPaths,
  clearDynamicSkills,
  onDynamicSkillsLoaded,
} from '../../skills/loadSkillsDir.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolUseContext,
} from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { runCleanupFunctions } from '../cleanupRegistry.js'
import {
  releaseSchedulerLock,
  tryAcquireSchedulerLock,
} from '../cronTasksLock.js'
import { getCwd, runWithCwd } from '../cwd.js'
import { loadMarkdownFilesForSubdir } from '../markdownConfigLoader.js'
import {
  exitSessionContext,
  getSessionAlsStore,
  runWithNewHostSession,
  runWithSession,
} from '../sessionContextAls.js'
import { registerSessionContextReader } from '../sessionRoot.js'
import {
  getCurrentWorktreeSession,
  getWorktreeExtensionRoot,
  restoreWorktreeSession,
} from '../worktree.js'

const tick = (ms = 5): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

function writeFileWithDirs(filePath: string, content: string): void {
  const idx = filePath.lastIndexOf('/')
  if (idx > 0) {
    mkdirSync(filePath.slice(0, idx), { recursive: true })
  }
  writeFileSync(filePath, content, 'utf-8')
}

function initGitRepo(dir: string, label: string): string {
  mkdirSync(dir, { recursive: true })
  const real = realpathSync(dir)
  execFileSync('git', ['init', '-b', 'main'], { cwd: real, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', `${label}@example.test`], {
    cwd: real,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', `Test ${label}`], {
    cwd: real,
    stdio: 'ignore',
  })
  writeFileSync(join(real, 'README.md'), `# ${label}\n`, 'utf-8')
  execFileSync('git', ['add', 'README.md'], { cwd: real, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', `init ${label}`], {
    cwd: real,
    stdio: 'ignore',
  })
  return real
}

function makeToolUseContext(
  overrides: { tools?: Tool[] } = {},
): ToolUseContext {
  const { tools = [] } = overrides
  return {
    abortController: new AbortController(),
    options: {
      tools,
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    getAppState: () =>
      ({
        mcp: { clients: [], commands: [], tools: [] },
        tasks: {},
        toolPermissionContext: getEmptyToolPermissionContext(),
      }) as unknown as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
  } as unknown as ToolUseContext
}

function makeDeferredMcpTool(name: string, promptText: string): Tool {
  return {
    name,
    isMcp: true,
    alwaysLoad: undefined,
    shouldDefer: true,
    searchHint: 'synchronize records',
    prompt: async () => promptText,
    description: async () => promptText,
    inputSchema: {} as Tool['inputSchema'],
    isEnabled: () => true,
  } as unknown as Tool
}

function makeUserMessages(text: string): Message[] {
  return [
    {
      type: 'user',
      content: [{ type: 'text', text }],
      uuid: '00000000-0000-0000-0000-000000000001',
    } as unknown as Message,
  ]
}

function makeFakeLspServer(
  state: LSPServerInstance['state'],
): LSPServerInstance {
  return {
    name: 'ts-lsp',
    config: {
      command: ['true'],
      extensionToLanguage: { '.ts': 'typescript' },
      scope: 'dynamic',
      source: 'test',
    } as unknown as LSPServerInstance['config'],
    state,
    startTime: undefined,
    lastError: undefined,
    restartCount: 0,
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    isHealthy: () => state === 'running',
    sendRequest: async () => undefined as never,
    sendNotification: async () => {},
    onNotification: () => {},
    onRequest: () => {},
  }
}

function makeFakeLspManager(
  servers: Map<string, LSPServerInstance>,
  onShutdown?: () => void,
): LSPServerManager {
  return {
    initialize: async () => {},
    shutdown: async () => {
      onShutdown?.()
    },
    getServerForFile: () => undefined,
    ensureServerStarted: async () => undefined,
    sendRequest: async () => undefined,
    getAllServers: () => servers,
    openFile: async () => {},
    changeFile: async () => {},
    saveFile: async () => {},
    closeFile: async () => {},
    isFileOpen: () => false,
    closeAllFiles: async () => {},
    didLastConfigLoadFail: () => false,
  }
}

const DUMMY_HTTP_MCP_CONFIG: ScopedMcpServerConfig = {
  type: 'http',
  url: 'https://mcp.example.test',
  scope: 'user',
}

describe('2.1.331 multi-host ALS isolation: Worktree, SkillSearch, SearchExtraTools, CronLock, Tools & LSP', () => {
  const tempRoots: string[] = []
  const savedEnv: Record<string, string | undefined> = {}
  const envKeys = [
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_JOB_DIR',
    'CLAUDE_SKILL_LEARNING_HOME',
    'SKILL_SEARCH_ENABLED',
    'SKILL_LEARNING_ENABLED',
    'CLAUDE_CODE_USE_NATIVE_FILE_SEARCH',
    'CLAUDE_CODE_HOOKS_SAME_THREAD',
    'CLAUDE_CODE_ARTIFACT_TOOLSET',
    'ANTHROPIC_API_KEY',
  ]

  beforeEach(() => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k]
    }
    const isolatedHome = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-331-wt-home-')),
    )
    tempRoots.push(isolatedHome)
    process.env.CLAUDE_CONFIG_DIR = isolatedHome
    process.env.CLAUDE_SKILL_LEARNING_HOME = join(isolatedHome, 'learning')
    process.env.SKILL_SEARCH_ENABLED = '1'
    process.env.SKILL_LEARNING_ENABLED = '1'
    process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = '1'
    process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = '1'
    process.env.ANTHROPIC_API_KEY = 'test-key'

    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    restoreWorktreeSession(null)
    loadMarkdownFilesForSubdir.cache?.clear?.()
    clearCommandsCache()
    clearDynamicSkills()
    clearSkillIndexCache()
    clearSkillDiscoveryPrefetchSessionForTests()
    clearToolIndexCache()
    clearSearchExtraToolsSessionTrackingForTests()
    clearSearchExtraToolsDescriptionCache()
    resetDefaultQueuedNotificationsRegistryForTests()
    resetWaitForMcpServersStateForTests()
    clearQuickstartSession()
    _resetStoredDbAccessRulesForTesting()
    resetArtifactToolsetLatchForTests()
    resetLspManagerForTests()
  })

  afterEach(async () => {
    await shutdownLspServerManager()
    loadMarkdownFilesForSubdir.cache?.clear?.()
    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    restoreWorktreeSession(null)
    clearCommandsCache()
    clearDynamicSkills()
    clearSkillIndexCache()
    clearSkillDiscoveryPrefetchSessionForTests()
    clearToolIndexCache()
    clearSearchExtraToolsSessionTrackingForTests()
    clearSearchExtraToolsDescriptionCache()
    resetDefaultQueuedNotificationsRegistryForTests()
    resetWaitForMcpServersStateForTests()
    clearQuickstartSession()
    _resetStoredDbAccessRulesForTesting()
    resetArtifactToolsetLatchForTests()
    resetLspManagerForTests()

    for (const k of envKeys) {
      if (savedEnv[k] === undefined) {
        delete process.env[k]
      } else {
        process.env[k] = savedEnv[k]
      }
    }

    for (const dir of tempRoots.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('worktree.ts + EnterWorktreeTool + ExitWorktreeTool isolate currentWorktreeSession per host and never mutate process.cwd() inside ALS / runWithCwd', async () => {
    const workspace = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-331-wt-repos-')),
    )
    tempRoots.push(workspace)
    const repoAlpha = initGitRepo(join(workspace, 'tenant-alpha'), 'alpha')
    const repoBeta = initGitRepo(join(workspace, 'tenant-beta'), 'beta')

    const initialProcessCwd = process.cwd()

    let alphaEnteredBarrier!: () => void
    const alphaEntered = new Promise<void>(resolve => {
      alphaEnteredBarrier = resolve
    })
    let betaVerifiedNoLeakBarrier!: () => void
    const betaVerifiedNoLeak = new Promise<void>(resolve => {
      betaVerifiedNoLeakBarrier = resolve
    })

    const [alphaOutcome, betaOutcome] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'wt-host-alpha',
          originalCwd: repoAlpha,
          projectRoot: repoAlpha,
          cwd: repoAlpha,
          isInteractive: false,
        },
        async () => {
          const ctx = makeToolUseContext()
          expect(getCurrentWorktreeSession()).toBeNull()

          const entered = await EnterWorktreeTool.call(
            { name: 'alpha-feat' },
            ctx,
            async () => ({ behavior: 'allow', updatedInput: {} }),
            undefined as never,
          )
          const wtPath = realpathSync(entered.data.worktreePath)
          expect(process.cwd()).toBe(initialProcessCwd)
          expect(getCwd()).toBe(wtPath)
          expect(getOriginalCwd()).toBe(wtPath)
          expect(getCurrentWorktreeSession()?.worktreeName).toBe('alpha-feat')
          expect(getWorktreeExtensionRoot()).toBe(repoAlpha)

          // Re-entering without path is rejected in Host Alpha
          const reenterCheck = await EnterWorktreeTool.validateInput!(
            { name: 'alpha-second' },
            ctx,
          )
          expect(reenterCheck.result).toBe(false)

          alphaEnteredBarrier()
          await betaVerifiedNoLeak

          // Host Alpha's worktree was NOT deleted or touched by Host Beta's ExitWorktree attempt
          expect(existsSync(wtPath)).toBe(true)
          expect(getCurrentWorktreeSession()?.worktreeName).toBe('alpha-feat')

          // Exit and remove Host Alpha's worktree cleanly without mutating process.cwd()
          const exited = await ExitWorktreeTool.call(
            { action: 'remove' },
            ctx,
            async () => ({ behavior: 'allow', updatedInput: {} }),
            undefined as never,
          )
          expect(process.cwd()).toBe(initialProcessCwd)
          expect(getCurrentWorktreeSession()).toBeNull()
          expect(getCwd()).toBe(repoAlpha)
          expect(getOriginalCwd()).toBe(repoAlpha)
          expect(existsSync(wtPath)).toBe(false)
          return { wtPath, exitedAction: exited.data.action }
        },
      ),
      runWithNewHostSession(
        {
          id: 'wt-host-beta',
          originalCwd: repoBeta,
          projectRoot: repoBeta,
          cwd: repoBeta,
          isInteractive: false,
        },
        async () => {
          await alphaEntered
          const ctx = makeToolUseContext()

          // Host Alpha is inside its worktree right now — Host Beta must see null!
          expect(getCurrentWorktreeSession()).toBeNull()
          expect(getWorktreeExtensionRoot()).toBeUndefined()
          expect(getCwd()).toBe(repoBeta)
          expect(process.cwd()).toBe(initialProcessCwd)

          // Host Beta calling ExitWorktree validateInput & call refuses instead of deleting Alpha's worktree or escaping into /tenant-alpha
          const exitCheck = await ExitWorktreeTool.validateInput!(
            { action: 'remove', discard_changes: true },
            ctx,
          )
          expect(exitCheck.result).toBe(false)
          await expect(
            ExitWorktreeTool.call(
              { action: 'remove', discard_changes: true },
              ctx,
              async () => ({ behavior: 'allow', updatedInput: {} }),
              undefined as never,
            ),
          ).rejects.toThrow('Not in a worktree session')

          // Host Beta can enter its own worktree independently
          const enterCheck = await EnterWorktreeTool.validateInput!(
            { name: 'beta-feat' },
            ctx,
          )
          expect(enterCheck.result).toBe(true)

          betaVerifiedNoLeakBarrier()

          const enteredBeta = await EnterWorktreeTool.call(
            { name: 'beta-feat' },
            ctx,
            async () => ({ behavior: 'allow', updatedInput: {} }),
            undefined as never,
          )
          const betaWtPath = realpathSync(enteredBeta.data.worktreePath)
          expect(process.cwd()).toBe(initialProcessCwd)
          expect(getCwd()).toBe(betaWtPath)
          expect(getCurrentWorktreeSession()?.worktreeName).toBe('beta-feat')

          const keptBeta = await ExitWorktreeTool.call(
            { action: 'keep' },
            ctx,
            async () => ({ behavior: 'allow', updatedInput: {} }),
            undefined as never,
          )
          expect(process.cwd()).toBe(initialProcessCwd)
          expect(getCurrentWorktreeSession()).toBeNull()
          expect(getCwd()).toBe(repoBeta)
          expect(existsSync(betaWtPath)).toBe(true)
          return { betaWtPath, keptAction: keptBeta.data.action }
        },
      ),
    ])

    expect(alphaOutcome.exitedAction).toBe('remove')
    expect(betaOutcome.keptAction).toBe('keep')
    expect(process.cwd()).toBe(initialProcessCwd)

    // Also verify runWithCwd guard outside runWithNewHostSession leaves process.cwd() untouched
    await runWithCwd(repoAlpha, async () => {
      const ctx = makeToolUseContext()
      const entered = await EnterWorktreeTool.call(
        { name: 'scoped-cwd-wt' },
        ctx,
        async () => ({ behavior: 'allow', updatedInput: {} }),
        undefined as never,
      )
      expect(process.cwd()).toBe(initialProcessCwd)
      expect(getCwd()).toBe(realpathSync(entered.data.worktreePath))
      await ExitWorktreeTool.call(
        { action: 'remove' },
        ctx,
        async () => ({ behavior: 'allow', updatedInput: {} }),
        undefined as never,
      )
      expect(process.cwd()).toBe(initialProcessCwd)
    })
  })

  test('skillSearch/prefetch, localSearch, loadSkillsDir skillsLoaded, and commands.ts dynamic skill invalidation isolate across hosts', async () => {
    const workspace = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-331-skillsearch-')),
    )
    tempRoots.push(workspace)

    const projAlpha = join(workspace, 'proj-alpha')
    const projBeta = join(workspace, 'proj-beta')
    mkdirSync(join(projAlpha, '.git'), { recursive: true })
    mkdirSync(join(projBeta, '.git'), { recursive: true })

    // Same-named skill in both projects with tenant-specific content + conditional skills
    writeFileWithDirs(
      join(projAlpha, '.claude', 'skills', 'deploy-cluster', 'SKILL.md'),
      [
        '---',
        'name: deploy-cluster',
        'description: Deploy cluster release pipeline for tenant workloads',
        '---',
        'ALPHA_TENANT_DEPLOY_PIPELINE',
      ].join('\n'),
    )
    writeFileWithDirs(
      join(projAlpha, '.claude', 'skills', 'alpha-cond', 'SKILL.md'),
      [
        '---',
        'name: alpha-cond',
        'description: Alpha conditional path skill',
        'paths: "src/alpha/**"',
        '---',
        'Alpha conditional workflow.',
      ].join('\n'),
    )

    writeFileWithDirs(
      join(projBeta, '.claude', 'skills', 'deploy-cluster', 'SKILL.md'),
      [
        '---',
        'name: deploy-cluster',
        'description: Deploy cluster release pipeline for tenant workloads',
        '---',
        'BETA_TENANT_DEPLOY_PIPELINE',
      ].join('\n'),
    )
    writeFileWithDirs(
      join(projBeta, '.claude', 'skills', 'beta-cond', 'SKILL.md'),
      [
        '---',
        'name: beta-cond',
        'description: Beta conditional path skill',
        'paths: "src/beta/**"',
        '---',
        'Beta conditional workflow.',
      ].join('\n'),
    )

    let alphaDiscoveredFirst!: () => void
    const alphaDiscoveredPromise = new Promise<void>(resolve => {
      alphaDiscoveredFirst = resolve
    })
    let alphaPrimedCommands!: () => void
    const alphaPrimedPromise = new Promise<void>(resolve => {
      alphaPrimedCommands = resolve
    })

    let alphaSignalCount = 0
    let betaSignalCount = 0

    const [alphaRes, betaRes] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'skill-host-alpha',
          originalCwd: projAlpha,
          projectRoot: projAlpha,
          cwd: projAlpha,
          isInteractive: false,
        },
        async sessionAlpha => {
          const unsub = onDynamicSkillsLoaded(() => {
            alphaSignalCount++
          })
          try {
            // Prime getSkillToolCommands & getSlashCommandToolSkills in Alpha FIRST
            const preSkills = await getSkillToolCommands(projAlpha)
            expect(preSkills.map(c => c.name)).toContain('deploy-cluster')
            expect(preSkills.map(c => c.name)).not.toContain('alpha-cond')
            alphaPrimedCommands()

            // ToolUseContext intentionally has NO .cwd or .sessionId — exercises getCwd() + getSessionId()
            const ctx = makeToolUseContext()
            const first = await startSkillDiscoveryPrefetch(
              'deploy cluster release pipeline',
              [],
              ctx,
            )
            expect(first).toHaveLength(1)
            const firstSkills = (
              first[0] as unknown as {
                skills: Array<{ name: string; content?: string }>
              }
            ).skills
            expect(firstSkills[0]?.name).toBe('deploy-cluster')
            expect(firstSkills[0]?.content).toContain(
              'ALPHA_TENANT_DEPLOY_PIPELINE',
            )

            // Second prefetch in Alpha is deduplicated via RootSessionSlot
            const second = await startSkillDiscoveryPrefetch(
              'deploy cluster release pipeline',
              [],
              ctx,
            )
            expect(second).toEqual([])

            // Forked session shares RootSessionSlot dedup set
            const forkChild = sessionAlpha.withProject({
              originalCwd: projAlpha,
              projectRoot: projAlpha,
              cwd: projAlpha,
            })
            const forkPrefetch = await runWithSession(forkChild, () =>
              startSkillDiscoveryPrefetch(
                'deploy cluster release pipeline',
                [],
                ctx,
              ),
            )
            expect(forkPrefetch).toEqual([])

            // Turn-zero unmatched prompt records gap with Alpha's sessionId & cwd
            const gapAtt = await getTurnZeroSkillDiscovery(
              'zzzzunmatchedquasarfluxprompt',
              [],
              ctx,
            )
            expect(gapAtt?.type).toBe('skill_discovery')

            alphaDiscoveredFirst()
            await tick(15)

            const alphaIndex = await getSkillIndex(projAlpha)
            return {
              indexHasAlpha: alphaIndex.some(e => e.name === 'deploy-cluster'),
              skillRoots: alphaIndex
                .filter(e => e.name === 'deploy-cluster')
                .map(e => e.skillRoot),
            }
          } finally {
            unsub()
          }
        },
      ),
      runWithNewHostSession(
        {
          id: 'skill-host-beta',
          originalCwd: projBeta,
          projectRoot: projBeta,
          cwd: projBeta,
          isInteractive: false,
        },
        async () => {
          await alphaPrimedPromise
          const unsub = onDynamicSkillsLoaded(() => {
            betaSignalCount++
          })
          try {
            // Prime getSkillToolCommands & getSlashCommandToolSkills in Beta SECOND
            // (verifies dynamicSkillsInvalidationSubscribed is per-host, not a single global boolean!)
            const preToolCmds = await getSkillToolCommands(projBeta)
            const preSlashSkills = await getSlashCommandToolSkills(projBeta)
            expect(preToolCmds.map(c => c.name)).toContain('deploy-cluster')
            expect(preToolCmds.map(c => c.name)).not.toContain('beta-cond')
            expect(preSlashSkills.map(c => c.name)).not.toContain('beta-cond')

            // Wait until Alpha has already added 'deploy-cluster' to its discoveredThisSession
            await alphaDiscoveredFirst
            await alphaDiscoveredPromise

            // Beta MUST still discover 'deploy-cluster' and load BETA's SKILL.md via getCwd() fallback!
            const ctx = makeToolUseContext()
            const betaPrefetch = await startSkillDiscoveryPrefetch(
              'deploy cluster release pipeline',
              [],
              ctx,
            )
            expect(betaPrefetch).toHaveLength(1)
            const betaSkills = (
              betaPrefetch[0] as unknown as {
                skills: Array<{ name: string; content?: string }>
              }
            ).skills
            expect(betaSkills[0]?.name).toBe('deploy-cluster')
            expect(betaSkills[0]?.content).toContain(
              'BETA_TENANT_DEPLOY_PIPELINE',
            )

            // Activate conditional skill in Beta: must emit ONLY on Beta's skillsLoaded signal
            // and invalidate Beta's getSkillToolCommands / getSlashCommandToolSkills caches!
            const activated = activateConditionalSkillsForPaths(
              ['src/beta/index.ts'],
              projBeta,
            )
            expect(activated).toEqual(['beta-cond'])

            const postToolCmds = await getSkillToolCommands(projBeta)
            const postSlashSkills = await getSlashCommandToolSkills(projBeta)
            expect(postToolCmds.map(c => c.name)).toContain('beta-cond')
            expect(postSlashSkills.map(c => c.name)).toContain('beta-cond')

            // Clear Beta's localSearch index cache (in non-bundled bun test, feature('EXPERIMENTAL_SKILL_SEARCH') is off in commands.ts)
            // and verify clearing Beta's cache rebuilds Beta's index without clearing Alpha's index!
            clearSkillIndexCache()
            const betaIndex = await getSkillIndex(projBeta)
            return {
              skillRoots: betaIndex
                .filter(e => e.name === 'deploy-cluster')
                .map(e => e.skillRoot),
              postHasBetaCond: betaIndex.some(e => e.name === 'beta-cond'),
            }
          } finally {
            unsub()
          }
        },
      ),
    ])

    expect(alphaRes.indexHasAlpha).toBe(true)
    expect(alphaRes.skillRoots[0]).toContain('proj-alpha')
    expect(betaRes.skillRoots[0]).toContain('proj-beta')
    expect(betaRes.postHasBetaCond).toBe(true)
    expect(alphaSignalCount).toBe(0)
    expect(betaSignalCount).toBe(1)
  })

  test('searchExtraTools/prefetch, toolIndex, and SearchExtraToolsTool isolate session discovery and same-named tool descriptions across hosts', async () => {
    const alphaTools = [
      makeDeferredMcpTool(
        'mcp__tenant__sync_records',
        'Synchronize alpha warehouse invoices and billing ledgers',
      ),
      makeDeferredMcpTool(
        'mcp__aux__healthcheck',
        'Check auxiliary cluster ping status',
      ),
    ]
    const betaTools = [
      makeDeferredMcpTool(
        'mcp__tenant__sync_records',
        'Synchronize beta observability traces and metrics spans',
      ),
      makeDeferredMcpTool(
        'mcp__aux__healthcheck',
        'Check auxiliary cluster ping status',
      ),
    ]

    let alphaPrefetchDone!: () => void
    const alphaPrefetchPromise = new Promise<void>(resolve => {
      alphaPrefetchDone = resolve
    })

    let alphaNotifications = 0
    let betaNotifications = 0

    await Promise.all([
      runWithNewHostSession(
        { id: 'tools-host-alpha', isInteractive: false },
        async () => {
          const unsub = subscribeToSearchExtraToolsPrefetch(() => {
            alphaNotifications++
          })
          try {
            const first = await startSearchExtraToolsPrefetch(
              alphaTools,
              makeUserMessages('synchronize warehouse invoices'),
            )
            expect(first).toHaveLength(1)
            const snapshot = getSearchExtraToolsPrefetchSnapshot()
            expect(snapshot).toHaveLength(1)
            expect(snapshot[0]?.name).toBe('mcp__tenant__sync_records')
            expect(snapshot[0]?.description).toContain('warehouse invoices')

            // Second prefetch for same tool in Alpha is suppressed by Alpha's discoveredToolsThisSession
            const second = await startSearchExtraToolsPrefetch(
              alphaTools,
              makeUserMessages('synchronize warehouse invoices'),
            )
            expect(second).toEqual([])

            alphaPrefetchDone()
            await tick(10)

            // Keyword search via SearchExtraToolsTool uses Alpha's memoized description
            const ctx = makeToolUseContext({ tools: alphaTools })
            const hitAlpha = await SearchExtraToolsTool.call(
              { query: '+warehouse', max_results: 5 },
              ctx,
            )
            expect(hitAlpha.data.matches).toEqual(['mcp__tenant__sync_records'])

            const missBetaTerm = await SearchExtraToolsTool.call(
              { query: '+observability', max_results: 5 },
              ctx,
            )
            expect(missBetaTerm.data.matches).toEqual([])
            expect(
              await getToolDescriptionMemoized.cache.get(
                'mcp__tenant__sync_records',
              ),
            ).toContain('warehouse invoices')
          } finally {
            unsub()
          }
        },
      ),
      runWithNewHostSession(
        { id: 'tools-host-beta', isInteractive: false },
        async () => {
          const unsub = subscribeToSearchExtraToolsPrefetch(() => {
            betaNotifications++
          })
          try {
            await alphaPrefetchPromise

            // Before Beta runs prefetch, Beta's snapshot is still empty (not polluted by Alpha)
            expect(getSearchExtraToolsPrefetchSnapshot()).toEqual([])

            // Beta's getToolIndex has the EXACT same sorted tool name key ('mcp__tenant__sync_records')
            // as Alpha, yet must build its own index with Beta's prompt description!
            const betaIdx = await getToolIndex(betaTools)
            const betaSyncEntry = betaIdx.find(
              e => e.name === 'mcp__tenant__sync_records',
            )
            expect(betaSyncEntry?.description).toContain('observability traces')

            // Beta MUST still auto-discover 'mcp__tenant__sync_records' (not suppressed by Alpha!)
            const betaPrefetch = await startSearchExtraToolsPrefetch(
              betaTools,
              makeUserMessages('synchronize observability traces'),
            )
            expect(betaPrefetch).toHaveLength(1)
            expect(
              getSearchExtraToolsPrefetchSnapshot()[0]?.description,
            ).toContain('observability traces')

            // Keyword search via SearchExtraToolsTool uses Beta's memoized description
            const ctx = makeToolUseContext({ tools: betaTools })
            const hitBeta = await SearchExtraToolsTool.call(
              { query: '+observability', max_results: 5 },
              ctx,
            )
            expect(hitBeta.data.matches).toEqual(['mcp__tenant__sync_records'])

            const missAlphaTerm = await SearchExtraToolsTool.call(
              { query: '+warehouse', max_results: 5 },
              ctx,
            )
            expect(missAlphaTerm.data.matches).toEqual([])
            expect(
              await getToolDescriptionMemoized.cache.get(
                'mcp__tenant__sync_records',
              ),
            ).toContain('observability traces')
          } finally {
            unsub()
          }
        },
      ),
    ])

    expect(alphaNotifications).toBe(1)
    expect(betaNotifications).toBe(1)
  })

  test('cronTasksLock: concurrent hosts in /repo-a and /repo-b retain independent exit cleanups and release cleanly outside ALS', async () => {
    const workspace = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-331-cronlock-')),
    )
    tempRoots.push(workspace)
    const repoA = join(workspace, 'repo-a')
    const repoB = join(workspace, 'repo-b')
    mkdirSync(repoA, { recursive: true })
    mkdirSync(repoB, { recursive: true })

    const lockPathA = join(repoA, '.claude', 'scheduled_tasks.lock')
    const lockPathB = join(repoB, '.claude', 'scheduled_tasks.lock')

    const [sessionAlpha, sessionBeta] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'cron-owner-alpha',
          originalCwd: repoA,
          projectRoot: repoA,
          cwd: repoA,
          isInteractive: false,
        },
        async session => {
          // Acquire with NO opts — must eagerly capture resolvedDir = getProjectRoot() (repoA)
          expect(await tryAcquireSchedulerLock()).toBe(true)
          return session
        },
      ),
      runWithNewHostSession(
        {
          id: 'cron-owner-beta',
          originalCwd: repoB,
          projectRoot: repoB,
          cwd: repoB,
          isInteractive: false,
        },
        async session => {
          expect(await tryAcquireSchedulerLock()).toBe(true)
          return session
        },
      ),
    ])

    expect(existsSync(lockPathA)).toBe(true)
    expect(existsSync(lockPathB)).toBe(true)
    expect(JSON.parse(readFileSync(lockPathA, 'utf8')).sessionId).toBe(
      'cron-owner-alpha',
    )
    expect(JSON.parse(readFileSync(lockPathB, 'utf8')).sessionId).toBe(
      'cron-owner-beta',
    )

    // A passive host in the SAME repoA must be blocked and its releaseSchedulerLock()
    // must NOT delete repoA's lock or clobber Alpha's registered cleanup!
    await runWithNewHostSession(
      {
        id: 'cron-passive-alpha',
        originalCwd: repoA,
        projectRoot: repoA,
        cwd: repoA,
        isInteractive: false,
      },
      async () => {
        expect(await tryAcquireSchedulerLock()).toBe(false)
        await releaseSchedulerLock()
      },
    )
    expect(existsSync(lockPathA)).toBe(true)

    // Drain Host Alpha's cleanup bag while exiting ALS inside the callback execution:
    // runCleanupFunctions looks up Alpha's DrainBag, and even if process exit runs outside ALS,
    // the closure holds { dir: repoA, lockIdentity: 'cron-owner-alpha' }!
    await runWithSession(sessionAlpha, () => runCleanupFunctions())
    expect(existsSync(lockPathA)).toBe(false)
    // Host Beta's lock & cleanup were NOT clobbered when Host Alpha acquired or drained!
    expect(existsSync(lockPathB)).toBe(true)

    // Also test explicit release outside ALS using { dir, lockIdentity }
    await exitSessionContext(async () => {
      await runWithSession(sessionBeta, () => runCleanupFunctions())
    })
    expect(existsSync(lockPathB)).toBe(false)
  })

  test('notificationQueue, WaitForMcpServersTool, ScheduleWakeupTool, ArtifactTool quickstart/dbRules/catalog, and lsp/manager isolate across hosts', async () => {
    const workspace = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-331-latches-')),
    )
    tempRoots.push(workspace)
    const jobDirAlpha = join(workspace, 'bg-job-alpha')
    const jobDirBeta = join(workspace, 'bg-job-beta')
    mkdirSync(jobDirAlpha, { recursive: true })
    mkdirSync(jobDirBeta, { recursive: true })

    const htmlAlpha = join(workspace, 'alpha-page.html')
    writeFileSync(htmlAlpha, '<h1>Alpha</h1>', 'utf8')

    let alphaShutdownCount = 0
    let betaShutdownCount = 0

    await Promise.all([
      runWithNewHostSession(
        {
          id: 'latch-host-alpha',
          originalCwd: workspace,
          projectRoot: workspace,
          cwd: workspace,
          isInteractive: false,
        },
        async sessionAlpha => {
          // 1. notificationQueue
          getDefaultQueuedNotificationsRegistry().enqueue({
            notificationId: 'notif-alpha-1',
            origin: 'github_webhook',
            queuedAt: '2026-01-01T00:00:00Z',
            content: 'Alpha PR comment',
          })

          // 2. WaitForMcpServersTool
          setLiveMcpClientsForWait([
            {
              name: 'alpha-pending-mcp',
              type: 'pending',
              config: DUMMY_HTTP_MCP_CONFIG,
            },
          ])
          setWaitForMcpServersDeclared(true)

          // 3. ScheduleWakeupTool (call without toolUseId -> arms unpersisted lastArmedWakeupMeta in RootSessionSlot)
          const wakeupOut = await ScheduleWakeupTool.call({
            delaySeconds: 120,
            reason: 'poll alpha deploy',
            prompt: 'check alpha deploy',
          } as never)
          expect(wakeupOut.data.scheduledFor).toBeGreaterThan(0)

          // 4. ArtifactTool quickstartSession + storedDbAccessRules + quickstartCatalog latch
          recordQuickstartRan('deck-slug', {
            toolUseId: 'tu-alpha',
            listed: true,
          })
          setQuickstartGuidanceToolUseId('guid-alpha')
          recordStoredDbAccessRules('shared-artifact-slug', [
            { path: 'items', read: 'anyone' },
          ])
          process.env.CLAUDE_CODE_ARTIFACT_TOOLSET = '1'
          expect(isArtifactDamsonToolset()).toBe(true)

          // 5. lsp/manager
          setLspManagerForTests({
            manager: makeFakeLspManager(
              new Map([['ts', makeFakeLspServer('running')]]),
              () => {
                alphaShutdownCount++
              },
            ),
            status: 'success',
          })
          expect(isLspConnected()).toBe(true)
          expect(hasEverConnected()).toBe(true)
          expect(shouldDeferLspTool({ isLsp: true })).toBe(false)

          await tick(15)

          // Verify Host Beta's concurrent actions did NOT touch Host Alpha's state:
          expect(isWaitForMcpServersDeclared()).toBe(true)
          expect(hasPendingMcpServers()).toBe(true)
          expect(WaitForMcpServersTool.isEnabled()).toBe(true)
          expect(getQuickstartRan('deck-slug')?.toolUseId).toBe('tu-alpha')
          expect(getQuickstartGuidanceToolUseId()).toBe('guid-alpha')
          expect(isArtifactDamsonToolset()).toBe(true)

          // Forked child session shares RootSessionSlot quickstart state
          const forkAlpha = sessionAlpha.withProject({
            originalCwd: workspace,
            projectRoot: workspace,
            cwd: workspace,
          })
          expect(
            runWithSession(forkAlpha, () => getQuickstartGuidanceToolUseId()),
          ).toBe('guid-alpha')

          // ScheduleWakeupTool mapToolResultToToolResultBlockParam persists Alpha's pending wakeup
          // even after Beta called clearPendingWakeupOnFire()!
          process.env.CLAUDE_JOB_DIR = jobDirAlpha
          ScheduleWakeupTool.mapToolResultToToolResultBlockParam(
            wakeupOut.data,
            'tu-wakeup-alpha',
          )
          await tick(10)
          expect(
            JSON.parse(
              readFileSync(join(jobDirAlpha, '.pending-wakeup'), 'utf8'),
            ).toolUseId,
          ).toBe('tu-wakeup-alpha')

          // Drain ReadNotificationsTool in Alpha -> receives ONLY Alpha's notification
          const notifRes = await ReadNotificationsTool.call(
            {},
            makeToolUseContext(),
          )
          expect(
            notifRes.data.notifications.map(n => n.notification_id),
          ).toEqual(['notif-alpha-1'])

          // Republishing 'shared-artifact-slug' in Alpha with db:true and no rules is refused
          const alphaPublishRefusal = await ArtifactTool.call({
            file_path: htmlAlpha,
            hash: 'shared-artifact-slug',
            capabilities: { db: true },
          } as never)
          expect(alphaPublishRefusal.data.error).toBeDefined()
          expect(String(alphaPublishRefusal.data.error)).toContain(
            're-sends db without its rules',
          )
          expect(String(alphaPublishRefusal.data.error)).toContain('items')
          void PUBLISH_REFUSED_PREFIX

          // Shutting down LSP inside Host Alpha shuts down ONLY Alpha's LSP manager
          await shutdownLspServerManager()
          expect(alphaShutdownCount).toBe(1)
          expect(betaShutdownCount).toBe(0)
          expect(getLspServerManager()).toBeUndefined()
        },
      ),
      runWithNewHostSession(
        {
          id: 'latch-host-beta',
          originalCwd: workspace,
          projectRoot: workspace,
          cwd: workspace,
          isInteractive: false,
        },
        async () => {
          await tick(5)

          // 1. notificationQueue: Alpha's queued notification is invisible in Beta
          expect(getDefaultQueuedNotificationsRegistry().pendingCount()).toBe(0)
          getDefaultQueuedNotificationsRegistry().enqueue({
            notificationId: 'notif-beta-1',
            origin: 'trigger_fire',
            queuedAt: '2026-01-01T00:00:00Z',
            content: 'Beta scheduled trigger',
          })

          // 2. WaitForMcpServersTool: Alpha's pending MCP server & sticky latch do NOT leak to Beta
          expect(hasPendingMcpServers()).toBe(false)
          expect(isWaitForMcpServersDeclared()).toBe(false)
          expect(isWaitForMcpServersEnabled()).toBe(false)
          expect(WaitForMcpServersTool.isEnabled()).toBe(false)

          // 3. ScheduleWakeupTool: clearing wakeup in Beta does NOT clear Alpha's lastArmedWakeupMeta
          process.env.CLAUDE_JOB_DIR = jobDirBeta
          await clearPendingWakeupOnFire()

          // 4. ArtifactTool quickstartSession + storedDbAccessRules + quickstartCatalog latch
          expect(getQuickstartRan('deck-slug')).toBeUndefined()
          expect(getQuickstartGuidanceToolUseId()).toBeUndefined()
          process.env.CLAUDE_CODE_ARTIFACT_TOOLSET = '0'
          expect(isArtifactDamsonToolset()).toBe(false)

          // Republishing 'shared-artifact-slug' in Beta is NOT blocked by Alpha's storedDbAccessRules
          // (fails at network uploadUrl/token check instead of db_rules_reset_refused)
          const betaPublishRes = await ArtifactTool.call({
            file_path: htmlAlpha,
            hash: 'shared-artifact-slug',
            capabilities: { db: true },
          } as never)
          expect(String(betaPublishRes.data.error ?? '')).not.toContain(
            're-sends db without its rules',
          )

          // 5. lsp/manager: Beta has pending LSP with 0 connected servers while Alpha is connected
          setLspManagerForTests({
            manager: makeFakeLspManager(new Map(), () => {
              betaShutdownCount++
            }),
            status: 'pending',
          })
          expect(getInitializationStatus().status).toBe('pending')
          expect(isLspConnected()).toBe(false)
          expect(hasEverConnected()).toBe(false)
          expect(shouldDeferLspTool({ isLsp: true })).toBe(true)

          await tick(20)
          // Even after Alpha ran shutdownLspServerManager() inside Alpha's ALS, Beta's manager is still alive!
          expect(betaShutdownCount).toBe(0)
          expect(getLspServerManager()).toBeDefined()

          const notifRes = await ReadNotificationsTool.call(
            {},
            makeToolUseContext(),
          )
          expect(
            notifRes.data.notifications.map(n => n.notification_id),
          ).toEqual(['notif-beta-1'])
        },
      ),
    ])

    // Process-exit shutdownLspServerManager() outside ALS shuts down remaining live host managers via WeakRef set!
    expect(betaShutdownCount).toBe(0)
    await exitSessionContext(() => shutdownLspServerManager())
    expect(betaShutdownCount).toBe(1)
  })
})
