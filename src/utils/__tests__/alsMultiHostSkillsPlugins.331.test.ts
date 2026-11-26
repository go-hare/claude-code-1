import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
} from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  clearPromptCache,
  getLimitedSkillToolCommands,
  getPrompt,
} from '@claude-code/builtin-tools/tools/SkillTool/prompt.js'
import { SkillTool } from '@claude-code/builtin-tools/tools/SkillTool/SkillTool.js'
import {
  getRegisteredHooks,
  resetStateForTests,
  setInlinePlugins,
} from '../../bootstrap/state.js'
import {
  builtInCommandNames,
  clearCommandMemoizationCaches,
  clearCommandsCache,
  getBuiltinCommands,
  getCommands,
  getSkillToolCommands,
  getSlashCommandToolSkills,
} from '../../commands.js'
import {
  activateConditionalSkillsForPaths,
  addSkillDirectories,
  clearDynamicSkills,
  clearSkillCaches,
  createSkillCommand,
  discoverSkillDirsForPaths,
  getDynamicSkills,
  getInMemorySyncedSkills,
  getSkillDirCommands,
  isNestedSkillDiscoveryWithheld,
  parseSkillFrontmatterFields,
  recordFailedSyncedSkillLanding,
  resetNestedDiscoveryWithheldForTesting,
  retainInMemorySyncedSkill,
  shouldSkipSyncedSkillDownload,
} from '../../skills/loadSkillsDir.js'
import { loadMarkdownFilesForSubdir } from '../markdownConfigLoader.js'
import {
  clearPluginAgentCache,
  loadPluginAgents,
} from '../plugins/loadPluginAgents.js'
import {
  clearPluginCommandCache,
  clearPluginSkillsCache,
  getPluginCommands,
  getPluginSkills,
} from '../plugins/loadPluginCommands.js'
import {
  clearPluginHookCache,
  getPluginHookRegistration,
  loadPluginHooks,
} from '../plugins/loadPluginHooks.js'
import {
  clearPluginOutputStyleCache,
  loadPluginOutputStyles,
} from '../plugins/loadPluginOutputStyles.js'
import {
  beginInitialPluginLoad,
  clearPluginCache,
  isInitialPluginLoadPending,
  loadAllPlugins,
  loadAllPluginsCacheOnly,
  markInitialPluginsLoaded,
  waitForInitialPluginsLoaded,
} from '../plugins/pluginLoader.js'
import {
  getSessionAlsStore,
  runWithNewHostSession,
  runWithSession,
} from '../sessionContextAls.js'
import { registerSessionContextReader } from '../sessionRoot.js'

const tick = (ms = 4): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

function writeFileWithDirs(filePath: string, content: string): void {
  const idx = filePath.lastIndexOf('/')
  if (idx > 0) {
    mkdirSync(filePath.slice(0, idx), { recursive: true })
  }
  writeFileSync(filePath, content, 'utf-8')
}

function createPluginFixture(
  baseDir: string,
  prefix: 'alpha' | 'beta',
): string {
  const pluginDir = join(baseDir, `plugin-${prefix}`)
  writeFileWithDirs(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: `${prefix}-plug`,
      version: '1.0.0',
      description: `Plugin for ${prefix}`,
    }),
  )
  writeFileWithDirs(
    join(pluginDir, 'commands', `${prefix}-cmd.md`),
    `---\ndescription: ${prefix} plugin command\n---\nRun ${prefix} plugin command.`,
  )
  writeFileWithDirs(
    join(pluginDir, 'skills', `${prefix}-plug-skill`, 'SKILL.md'),
    `---\ndescription: ${prefix} plugin skill\n---\nInstructions for ${prefix} plugin skill.`,
  )
  writeFileWithDirs(
    join(pluginDir, 'agents', `${prefix}-plug-agent.md`),
    `---\nname: ${prefix}-plug-agent\ndescription: ${prefix} plugin agent\n---\nYou are the ${prefix} plugin agent.`,
  )
  writeFileWithDirs(
    join(pluginDir, 'output-styles', `${prefix}-style.md`),
    `---\nname: ${prefix}-style\ndescription: ${prefix} output style\n---\nUse ${prefix} output formatting.`,
  )
  writeFileWithDirs(
    join(pluginDir, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: `echo ${prefix}-hook`,
              },
            ],
          },
        ],
      },
    }),
  )
  return pluginDir
}

function createProjectFixture(
  rootTemp: string,
  prefix: 'alpha' | 'beta',
  sharedSkillsPluginEnabled: boolean,
): string {
  const projDir = join(rootTemp, `proj-${prefix}`)
  mkdirSync(join(projDir, '.git'), { recursive: true })

  // Unconditional project skill
  writeFileWithDirs(
    join(projDir, '.claude', 'skills', `${prefix}-only`, 'SKILL.md'),
    `---\ndescription: ${prefix} project skill\n---\nFollow ${prefix}-only workflow.`,
  )

  // Conditional path-scoped project skill
  writeFileWithDirs(
    join(projDir, '.claude', 'skills', `${prefix}-cond`, 'SKILL.md'),
    `---\ndescription: ${prefix} conditional skill\npaths: "src/${prefix}/**"\n---\nFollow ${prefix}-cond workflow.`,
  )

  // Nested package skill discovered dynamically below cwd
  writeFileWithDirs(
    join(
      projDir,
      'packages',
      'nested',
      '.claude',
      'skills',
      `${prefix}-nested`,
      'SKILL.md',
    ),
    `---\ndescription: ${prefix} nested dynamic skill\n---\nFollow ${prefix}-nested workflow.`,
  )
  writeFileWithDirs(
    join(projDir, 'packages', 'nested', 'index.ts'),
    `export const name = '${prefix}'\n`,
  )

  // Skills-as-plugin under .claude/skills/<name>/.claude-plugin/plugin.json
  // controlled per-project via .claude/settings.json enabledPlugins!
  writeFileWithDirs(
    join(
      projDir,
      '.claude',
      'skills',
      'project-toggle-pack',
      '.claude-plugin',
      'plugin.json',
    ),
    JSON.stringify({
      name: 'project-toggle-pack',
      version: '1.0.0',
      description: 'Project-scoped toggleable skills-dir plugin',
    }),
  )
  writeFileWithDirs(
    join(
      projDir,
      '.claude',
      'skills',
      'project-toggle-pack',
      'skills',
      'toggle-skill',
      'SKILL.md',
    ),
    `---\ndescription: Toggleable skill in ${prefix}\n---\nToggle skill body for ${prefix}.`,
  )
  writeFileWithDirs(
    join(projDir, '.claude', 'settings.json'),
    JSON.stringify({
      enabledPlugins: {
        'project-toggle-pack@skills-dir': sharedSkillsPluginEnabled,
      },
    }),
  )

  // Custom project agent
  writeFileWithDirs(
    join(projDir, '.claude', 'agents', `${prefix}-agent.md`),
    `---\nname: ${prefix}-agent\ndescription: Custom agent for ${prefix}\n---\nYou are ${prefix}-agent.`,
  )

  return projDir
}

describe('2.1.331 multi-host Skills, Plugins, Commands, and Agent Definitions isolation', () => {
  const tempRoots: string[] = []
  let prevClaudeConfigDir: string | undefined
  let prevNativeSearch: string | undefined
  let prevHooksSameThread: string | undefined

  beforeEach(() => {
    prevClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    prevNativeSearch = process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH
    prevHooksSameThread = process.env.CLAUDE_CODE_HOOKS_SAME_THREAD
    const isolatedHome = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-331-home-')),
    )
    tempRoots.push(isolatedHome)
    process.env.CLAUDE_CONFIG_DIR = isolatedHome
    process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = '1'
    process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = '1'

    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    loadMarkdownFilesForSubdir.cache?.clear?.()
  })

  afterEach(() => {
    loadMarkdownFilesForSubdir.cache?.clear?.()
    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()

    if (prevClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = prevClaudeConfigDir
    }
    if (prevNativeSearch === undefined) {
      delete process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH
    } else {
      process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = prevNativeSearch
    }
    if (prevHooksSameThread === undefined) {
      delete process.env.CLAUDE_CODE_HOOKS_SAME_THREAD
    } else {
      process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = prevHooksSameThread
    }

    for (const dir of tempRoots.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('concurrent runWithNewHostSession hosts isolate project skills, conditional/dynamic skills, enabled plugins, SkillTool.prompt, and custom agents', async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'als-331-ws-')))
    tempRoots.push(workspace)

    const projAlpha = createProjectFixture(workspace, 'alpha', true)
    const projBeta = createProjectFixture(workspace, 'beta', false)
    const pluginAlphaDir = createPluginFixture(workspace, 'alpha')
    const pluginBetaDir = createPluginFixture(workspace, 'beta')

    const [alphaSnap, betaSnap] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'host-alpha',
          originalCwd: projAlpha,
          projectRoot: projAlpha,
          cwd: projAlpha,
          isInteractive: false,
        },
        async sessionAlpha => {
          setInlinePlugins([pluginAlphaDir])

          // Retain an in-memory synced skill and record a failed landing in Alpha only
          const syncedParsed = parseSkillFrontmatterFields(
            { description: 'Alpha synced skill' },
            'Synced body for alpha',
            'alpha-synced',
          )
          retainInMemorySyncedSkill(
            'sync-id-alpha',
            createSkillCommand({
              ...syncedParsed,
              skillName: 'alpha-synced',
              markdownContent: 'Synced body for alpha',
              source: 'userSettings',
              baseDir: undefined,
              loadedFrom: 'syncedSkills',
              paths: undefined,
            }),
          )
          recordFailedSyncedSkillLanding('sync-landing-alpha', 'v1', 1_000)

          await tick(3)

          // Initial command + skill + agent + plugin load BEFORE activating conditional/dynamic skills
          const initialCommands = await getCommands(projAlpha)
          const initialCommandNames = initialCommands.map(c => c.name)
          expect(initialCommandNames).toContain('alpha-only')
          expect(initialCommandNames).toContain('alpha-synced')
          expect(initialCommandNames).not.toContain('alpha-cond')
          expect(initialCommandNames).not.toContain('alpha-nested')
          expect(initialCommandNames).not.toContain('beta-only')
          expect(initialCommandNames).not.toContain('beta-cond')
          expect(initialCommandNames).not.toContain('beta-nested')

          // Prime getSkillToolCommands & getSlashCommandToolSkills before activation
          const preToolCommands = await getSkillToolCommands(projAlpha)
          expect(preToolCommands.map(c => c.name)).toContain('alpha-only')
          expect(preToolCommands.map(c => c.name)).not.toContain('alpha-cond')

          await tick(5)

          // Activate conditional skill + discover nested dynamic skill in Alpha!
          const activated = activateConditionalSkillsForPaths(
            ['src/alpha/feature.ts'],
            projAlpha,
          )
          expect(activated).toEqual(['alpha-cond'])

          const discoveredDirs = await discoverSkillDirsForPaths(
            [join(projAlpha, 'packages', 'nested', 'index.ts')],
            projAlpha,
          )
          expect(discoveredDirs).toEqual([
            join(projAlpha, 'packages', 'nested', '.claude', 'skills'),
          ])
          await addSkillDirectories(discoveredDirs)

          await tick(3)

          const [
            afterCommands,
            skillToolCommands,
            limitedSkillToolCommands,
            slashSkills,
            toolPrompt,
            zeroArgPrompt,
            agentsResult,
            pluginCommands,
            pluginSkills,
            pluginAgents,
            pluginStyles,
            pluginsLoaded,
          ] = await Promise.all([
            getCommands(projAlpha),
            getSkillToolCommands(projAlpha),
            getLimitedSkillToolCommands(projAlpha),
            getSlashCommandToolSkills(projAlpha),
            SkillTool.prompt({
              getToolPermissionContext: async () => ({
                mode: 'default',
                additionalWorkingDirectories: new Map(),
                alwaysAllowRules: {},
                alwaysDenyRules: {},
                alwaysAskRules: {},
                isBypassPermissionsModeAvailable: false,
              }),
              tools: [],
              agents: [],
            }),
            getPrompt(),
            getAgentDefinitionsWithOverrides(projAlpha),
            getPluginCommands(),
            getPluginSkills(),
            loadPluginAgents(),
            loadPluginOutputStyles(),
            loadAllPluginsCacheOnly(),
          ])

          await loadPluginHooks()
          const sessionStartHooks = (
            getRegisteredHooks()?.SessionStart ?? []
          ).map(m => ('pluginName' in m ? m.pluginName : 'callback'))

          // Verify fork via runWithSession shares Alpha's SessionHost!
          const forkAlpha = sessionAlpha.withProject({
            cwd: join(projAlpha, 'packages', 'nested'),
          })
          const forkDynamicNames = await runWithSession(forkAlpha, async () =>
            getDynamicSkills().map(s => s.name),
          )
          expect(forkDynamicNames).toContain('alpha-cond')
          expect(forkDynamicNames).toContain('alpha-nested')

          return {
            commandNames: afterCommands.map(c => c.name),
            skillToolNames: skillToolCommands.map(c => c.name),
            limitedSkillToolNames: limitedSkillToolCommands.map(c => c.name),
            slashSkillNames: slashSkills.map(c => c.name),
            dynamicSkillNames: getDynamicSkills().map(s => s.name),
            syncedSkillNames: getInMemorySyncedSkills().map(s => s.name),
            skipAlphaLanding: shouldSkipSyncedSkillDownload(
              'sync-landing-alpha',
              'v1',
              2_000,
            ),
            agentTypes: agentsResult.activeAgents.map(a => a.agentType),
            pluginCommandNames: pluginCommands.map(c => c.name),
            pluginSkillNames: pluginSkills.map(c => c.name),
            pluginAgentTypes: pluginAgents.map(a => a.agentType),
            pluginStyleNames: pluginStyles.map(s => s.name),
            enabledPluginNames: pluginsLoaded.enabled.map(p => p.name),
            toolPrompt,
            zeroArgPrompt,
            promptCacheKeys: [...getPrompt.cache.keys()],
            sessionStartHooks,
            hookRegSettled:
              getPluginHookRegistration().hookRegistration !== undefined,
          }
        },
      ),

      runWithNewHostSession(
        {
          id: 'host-beta',
          originalCwd: projBeta,
          projectRoot: projBeta,
          cwd: projBeta,
          isInteractive: true,
        },
        async () => {
          setInlinePlugins([pluginBetaDir])

          await tick(2)
          const firstCommands = await getCommands(projBeta)
          await tick(6)

          // Re-query AFTER Alpha activated conditional, dynamic, and synced skills!
          const [
            commands,
            skillToolCommands,
            limitedSkillToolCommands,
            slashSkills,
            toolPrompt,
            zeroArgPrompt,
            agentsResult,
            pluginCommands,
            pluginSkills,
            pluginAgents,
            pluginStyles,
            pluginsLoaded,
          ] = await Promise.all([
            getCommands(projBeta),
            getSkillToolCommands(projBeta),
            getLimitedSkillToolCommands(projBeta),
            getSlashCommandToolSkills(projBeta),
            SkillTool.prompt({
              getToolPermissionContext: async () => ({
                mode: 'default',
                additionalWorkingDirectories: new Map(),
                alwaysAllowRules: {},
                alwaysDenyRules: {},
                alwaysAskRules: {},
                isBypassPermissionsModeAvailable: false,
              }),
              tools: [],
              agents: [],
            }),
            getPrompt(),
            getAgentDefinitionsWithOverrides(projBeta),
            getPluginCommands(),
            getPluginSkills(),
            loadPluginAgents(),
            loadPluginOutputStyles(),
            loadAllPluginsCacheOnly(),
          ])

          await loadPluginHooks()
          const sessionStartHooks = (
            getRegisteredHooks()?.SessionStart ?? []
          ).map(m => ('pluginName' in m ? m.pluginName : 'callback'))

          return {
            firstCommandNames: firstCommands.map(c => c.name),
            commandNames: commands.map(c => c.name),
            skillToolNames: skillToolCommands.map(c => c.name),
            limitedSkillToolNames: limitedSkillToolCommands.map(c => c.name),
            slashSkillNames: slashSkills.map(c => c.name),
            dynamicSkillNames: getDynamicSkills().map(s => s.name),
            syncedSkillNames: getInMemorySyncedSkills().map(s => s.name),
            skipAlphaLanding: shouldSkipSyncedSkillDownload(
              'sync-landing-alpha',
              'v1',
              2_000,
            ),
            agentTypes: agentsResult.activeAgents.map(a => a.agentType),
            pluginCommandNames: pluginCommands.map(c => c.name),
            pluginSkillNames: pluginSkills.map(c => c.name),
            pluginAgentTypes: pluginAgents.map(a => a.agentType),
            pluginStyleNames: pluginStyles.map(s => s.name),
            enabledPluginNames: pluginsLoaded.enabled.map(p => p.name),
            toolPrompt,
            zeroArgPrompt,
            promptCacheKeys: [...getPrompt.cache.keys()],
            sessionStartHooks,
            hookRegSettled:
              getPluginHookRegistration().hookRegistration !== undefined,
          }
        },
      ),
    ])

    // --- Host Alpha assertions ---
    expect(alphaSnap.commandNames).toContain('alpha-only')
    expect(alphaSnap.commandNames).toContain('alpha-cond')
    expect(alphaSnap.commandNames).toContain('alpha-nested')
    expect(alphaSnap.commandNames).toContain('alpha-synced')
    expect(alphaSnap.commandNames).toContain('alpha-plug:alpha-cmd')
    expect(alphaSnap.commandNames).toContain('alpha-plug:alpha-plug-skill')
    expect(alphaSnap.commandNames).toContain('project-toggle-pack:toggle-skill')
    expect(alphaSnap.commandNames).not.toContain('beta-only')
    expect(alphaSnap.commandNames).not.toContain('beta-cond')
    expect(alphaSnap.commandNames).not.toContain('beta-nested')
    expect(alphaSnap.commandNames).not.toContain('beta-plug:beta-cmd')
    expect(alphaSnap.commandNames).not.toContain('beta-plug:beta-plug-skill')

    expect(alphaSnap.skillToolNames).toContain('alpha-only')
    expect(alphaSnap.skillToolNames).toContain('alpha-cond')
    expect(alphaSnap.skillToolNames).toContain('alpha-nested')
    expect(alphaSnap.skillToolNames).not.toContain('beta-only')
    expect(alphaSnap.limitedSkillToolNames).toContain('alpha-only')
    expect(alphaSnap.limitedSkillToolNames).toContain('alpha-cond')
    expect(alphaSnap.limitedSkillToolNames).not.toContain('beta-only')
    expect(alphaSnap.slashSkillNames).toContain('alpha-only')
    expect(alphaSnap.slashSkillNames).toContain('alpha-cond')
    expect(alphaSnap.slashSkillNames).not.toContain('beta-only')

    expect(alphaSnap.dynamicSkillNames).toEqual(
      expect.arrayContaining(['alpha-cond', 'alpha-nested']),
    )
    expect(alphaSnap.syncedSkillNames).toEqual(['alpha-synced'])
    expect(alphaSnap.skipAlphaLanding).toBe(true)

    expect(alphaSnap.agentTypes).toContain('alpha-agent')
    expect(alphaSnap.agentTypes).toContain('alpha-plug:alpha-plug-agent')
    expect(alphaSnap.agentTypes).not.toContain('beta-agent')
    expect(alphaSnap.agentTypes).not.toContain('beta-plug:beta-plug-agent')

    expect(alphaSnap.enabledPluginNames).toContain('alpha-plug')
    expect(alphaSnap.enabledPluginNames).toContain('project-toggle-pack')
    expect(alphaSnap.enabledPluginNames).not.toContain('beta-plug')
    expect(alphaSnap.pluginCommandNames).toEqual(['alpha-plug:alpha-cmd'])
    expect(alphaSnap.pluginSkillNames).toEqual(
      expect.arrayContaining([
        'alpha-plug:alpha-plug-skill',
        'project-toggle-pack:toggle-skill',
      ]),
    )
    expect(alphaSnap.pluginAgentTypes).toContain('alpha-plug:alpha-plug-agent')
    expect(alphaSnap.pluginAgentTypes).not.toContain(
      'beta-plug:beta-plug-agent',
    )
    expect(alphaSnap.pluginStyleNames).toEqual(['alpha-plug:alpha-style'])
    expect(alphaSnap.promptCacheKeys).toEqual([projAlpha])
    expect(alphaSnap.toolPrompt).toBe(alphaSnap.zeroArgPrompt)
    expect(alphaSnap.sessionStartHooks).toEqual(['alpha-plug'])
    expect(alphaSnap.hookRegSettled).toBe(true)

    // --- Host Beta assertions (ZERO leakage from Alpha!) ---
    expect(betaSnap.commandNames).toContain('beta-only')
    expect(betaSnap.commandNames).toContain('beta-plug:beta-cmd')
    expect(betaSnap.commandNames).toContain('beta-plug:beta-plug-skill')
    expect(betaSnap.commandNames).not.toContain('beta-cond')
    expect(betaSnap.commandNames).not.toContain('beta-nested')
    expect(betaSnap.commandNames).not.toContain('alpha-only')
    expect(betaSnap.commandNames).not.toContain('alpha-cond')
    expect(betaSnap.commandNames).not.toContain('alpha-nested')
    expect(betaSnap.commandNames).not.toContain('alpha-synced')
    expect(betaSnap.commandNames).not.toContain('alpha-plug:alpha-cmd')
    expect(betaSnap.commandNames).not.toContain('alpha-plug:alpha-plug-skill')
    // Beta disabled project-toggle-pack@skills-dir in its .claude/settings.json!
    expect(betaSnap.commandNames).not.toContain(
      'project-toggle-pack:toggle-skill',
    )

    expect(betaSnap.skillToolNames).toContain('beta-only')
    expect(betaSnap.skillToolNames).not.toContain('alpha-only')
    expect(betaSnap.skillToolNames).not.toContain('alpha-cond')
    expect(betaSnap.skillToolNames).not.toContain('alpha-nested')
    expect(betaSnap.limitedSkillToolNames).toContain('beta-only')
    expect(betaSnap.limitedSkillToolNames).not.toContain('alpha-only')
    expect(betaSnap.slashSkillNames).toContain('beta-only')
    expect(betaSnap.slashSkillNames).not.toContain('alpha-only')

    expect(betaSnap.dynamicSkillNames).toEqual([])
    expect(betaSnap.syncedSkillNames).toEqual([])
    expect(betaSnap.skipAlphaLanding).toBe(false)

    expect(betaSnap.agentTypes).toContain('beta-agent')
    expect(betaSnap.agentTypes).toContain('beta-plug:beta-plug-agent')
    expect(betaSnap.agentTypes).not.toContain('alpha-agent')
    expect(betaSnap.agentTypes).not.toContain('alpha-plug:alpha-plug-agent')

    expect(betaSnap.enabledPluginNames).toContain('beta-plug')
    expect(betaSnap.enabledPluginNames).not.toContain('alpha-plug')
    expect(betaSnap.enabledPluginNames).not.toContain('project-toggle-pack')
    expect(betaSnap.pluginCommandNames).toEqual(['beta-plug:beta-cmd'])
    expect(betaSnap.pluginSkillNames).toEqual(['beta-plug:beta-plug-skill'])
    expect(betaSnap.pluginAgentTypes).toContain('beta-plug:beta-plug-agent')
    expect(betaSnap.pluginAgentTypes).not.toContain(
      'alpha-plug:alpha-plug-agent',
    )
    expect(betaSnap.pluginStyleNames).toEqual(['beta-plug:beta-style'])
    expect(betaSnap.promptCacheKeys).toEqual([projBeta])
    expect(betaSnap.sessionStartHooks).toEqual(['beta-plug'])
    expect(betaSnap.hookRegSettled).toBe(true)

    // --- Default bootstrap host was never polluted by either Alpha or Beta ---
    expect(getDynamicSkills()).toEqual([])
    expect(getInMemorySyncedSkills()).toEqual([])
    expect(getSkillDirCommands.cache.size).toBe(0)
    expect(loadAllPluginsCacheOnly.cache.size).toBe(0)
    expect(getPrompt.cache.size).toBe(0)
    expect(getAgentDefinitionsWithOverrides.cache.size).toBe(0)
  })

  test('dynamic .cache getters and cache-clear helpers only clear the active host caches', async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'als-331-cc-')))
    tempRoots.push(workspace)

    const projAlpha = createProjectFixture(workspace, 'alpha', true)
    const projBeta = createProjectFixture(workspace, 'beta', true)
    const pluginAlphaDir = createPluginFixture(workspace, 'alpha')
    const pluginBetaDir = createPluginFixture(workspace, 'beta')

    let alphaDonePriming!: () => void
    const alphaPrimed = new Promise<void>(r => {
      alphaDonePriming = r
    })
    let betaDonePriming!: () => void
    const betaPrimed = new Promise<void>(r => {
      betaDonePriming = r
    })
    let alphaCleared!: () => void
    const waitForAlphaClear = new Promise<void>(r => {
      alphaCleared = r
    })

    await Promise.all([
      runWithNewHostSession(
        {
          id: 'cache-host-alpha',
          originalCwd: projAlpha,
          projectRoot: projAlpha,
          cwd: projAlpha,
        },
        async () => {
          setInlinePlugins([pluginAlphaDir])
          getBuiltinCommands()
          builtInCommandNames()
          const [, , , , , pluginsAlpha] = await Promise.all([
            getCommands(projAlpha),
            getSkillToolCommands(projAlpha),
            getSlashCommandToolSkills(projAlpha),
            getPrompt(),
            getAgentDefinitionsWithOverrides(projAlpha),
            loadAllPluginsCacheOnly(),
            loadPluginAgents(),
            loadPluginOutputStyles(),
            loadPluginHooks(),
          ])
          loadAllPlugins.cache.set(undefined, Promise.resolve(pluginsAlpha))

          expect(getSkillDirCommands.cache.size).toBe(1)
          expect(loadAllPlugins.cache.has(undefined)).toBe(true)
          expect(loadAllPluginsCacheOnly.cache.has(undefined)).toBe(true)
          expect(getPluginCommands.cache.has(undefined)).toBe(true)
          expect(getPluginSkills.cache.has(undefined)).toBe(true)
          expect(loadPluginAgents.cache.has(undefined)).toBe(true)
          expect(loadPluginOutputStyles.cache.has(undefined)).toBe(true)
          expect(loadPluginHooks.cache.has(undefined)).toBe(true)
          expect(builtInCommandNames.cache.has(undefined)).toBe(true)
          expect(getSkillToolCommands.cache.has(projAlpha)).toBe(true)
          expect(getSlashCommandToolSkills.cache.has(projAlpha)).toBe(true)
          expect(getPrompt.cache.has(projAlpha)).toBe(true)
          expect(getAgentDefinitionsWithOverrides.cache.has(projAlpha)).toBe(
            true,
          )

          alphaDonePriming()
          await betaPrimed

          // Clear every cache inside Host Alpha ONLY!
          clearCommandsCache()
          clearCommandMemoizationCaches()
          clearSkillCaches()
          clearDynamicSkills()
          clearPluginCache('alpha-test-clear')
          clearPluginCommandCache()
          clearPluginSkillsCache()
          clearPluginAgentCache()
          clearPluginOutputStyleCache()
          clearPluginHookCache()
          clearAgentDefinitionsCache()
          clearPromptCache()

          expect(getSkillDirCommands.cache.size).toBe(0)
          expect(loadAllPlugins.cache.size).toBe(0)
          expect(loadAllPluginsCacheOnly.cache.size).toBe(0)
          expect(getPluginCommands.cache.size).toBe(0)
          expect(getPluginSkills.cache.size).toBe(0)
          expect(loadPluginAgents.cache.size).toBe(0)
          expect(loadPluginOutputStyles.cache.size).toBe(0)
          expect(loadPluginHooks.cache.size).toBe(0)
          expect(builtInCommandNames.cache.size).toBe(0)
          expect(getSkillToolCommands.cache.size).toBe(0)
          expect(getSlashCommandToolSkills.cache.size).toBe(0)
          expect(getPrompt.cache.size).toBe(0)
          expect(getAgentDefinitionsWithOverrides.cache.size).toBe(0)

          alphaCleared()
        },
      ),

      runWithNewHostSession(
        {
          id: 'cache-host-beta',
          originalCwd: projBeta,
          projectRoot: projBeta,
          cwd: projBeta,
        },
        async () => {
          setInlinePlugins([pluginBetaDir])
          getBuiltinCommands()
          builtInCommandNames()
          const [, , , , , pluginsBeta] = await Promise.all([
            getCommands(projBeta),
            getSkillToolCommands(projBeta),
            getSlashCommandToolSkills(projBeta),
            getPrompt(),
            getAgentDefinitionsWithOverrides(projBeta),
            loadAllPluginsCacheOnly(),
            loadPluginAgents(),
            loadPluginOutputStyles(),
            loadPluginHooks(),
          ])
          loadAllPlugins.cache.set(undefined, Promise.resolve(pluginsBeta))

          const betaSkillDirPromise = [...getSkillDirCommands.cache.values()][0]
          const betaPluginsPromise = loadAllPlugins.cache.get(undefined)
          const betaPluginsCacheOnlyPromise =
            loadAllPluginsCacheOnly.cache.get(undefined)
          const betaAgentsPromise =
            getAgentDefinitionsWithOverrides.cache.get(projBeta)
          const betaPromptPromise = getPrompt.cache.get(projBeta)

          betaDonePriming()
          await alphaPrimed
          await waitForAlphaClear

          // Every single cache in Host Beta MUST still be populated with the exact same promises!
          expect(getSkillDirCommands.cache.size).toBe(1)
          expect([...getSkillDirCommands.cache.values()][0]).toBe(
            betaSkillDirPromise,
          )
          expect(loadAllPlugins.cache.get(undefined)).toBe(betaPluginsPromise)
          expect(loadAllPluginsCacheOnly.cache.get(undefined)).toBe(
            betaPluginsCacheOnlyPromise,
          )
          expect(getPluginCommands.cache.has(undefined)).toBe(true)
          expect(getPluginSkills.cache.has(undefined)).toBe(true)
          expect(loadPluginAgents.cache.has(undefined)).toBe(true)
          expect(loadPluginOutputStyles.cache.has(undefined)).toBe(true)
          expect(loadPluginHooks.cache.has(undefined)).toBe(true)
          expect(builtInCommandNames.cache.has(undefined)).toBe(true)
          expect(getSkillToolCommands.cache.has(projBeta)).toBe(true)
          expect(getSlashCommandToolSkills.cache.has(projBeta)).toBe(true)
          expect(getPrompt.cache.get(projBeta)).toBe(betaPromptPromise)
          expect(getAgentDefinitionsWithOverrides.cache.get(projBeta)).toBe(
            betaAgentsPromise,
          )
        },
      ),
    ])
  })

  test('initialPluginsLoaded readiness barrier and nestedDiscoveryWithheld are isolated per host', async () => {
    let resolveAlphaLoad!: () => void
    const alphaPendingPromise = new Promise<void>(r => {
      resolveAlphaLoad = r
    })

    await Promise.all([
      runWithNewHostSession(
        { id: 'gate-host-alpha', cwd: '/tmp/gate-alpha' },
        async () => {
          beginInitialPluginLoad(alphaPendingPromise)
          expect(isInitialPluginLoadPending()).toBe(true)
          expect(waitForInitialPluginsLoaded()).toBeDefined()

          await tick(5)
          resolveAlphaLoad()
          await waitForInitialPluginsLoaded()
          expect(isInitialPluginLoadPending()).toBe(false)
          expect(waitForInitialPluginsLoaded()).toBeUndefined()
        },
      ),
      runWithNewHostSession(
        { id: 'gate-host-beta', cwd: '/tmp/gate-beta' },
        async () => {
          await tick(1)
          // Host Beta never started an initial plugin load, so it must NOT block on Alpha!
          expect(isInitialPluginLoadPending()).toBe(false)
          expect(waitForInitialPluginsLoaded()).toBeUndefined()
          markInitialPluginsLoaded()
          expect(isInitialPluginLoadPending()).toBe(false)
          expect(isNestedSkillDiscoveryWithheld()).toBe(false)
          resetNestedDiscoveryWithheldForTesting()
        },
      ),
    ])
  })

  test('SkillTool getPrompt() with 0 arguments keys per (SessionHost, getCwd()) instead of global undefined', async () => {
    const [alphaPrompt, betaPrompt] = await Promise.all([
      runWithNewHostSession(
        { id: 'prompt-host-alpha', cwd: '/tmp/prompt-alpha' },
        async () => {
          getPrompt.cache.set(
            '/tmp/prompt-alpha',
            Promise.resolve('ALPHA_CUSTOM_CACHED_PROMPT'),
          )
          await tick(4)
          // Calling getPrompt() with 0 args resolves against getCwd() ('/tmp/prompt-alpha') on Host Alpha!
          return getPrompt()
        },
      ),
      runWithNewHostSession(
        { id: 'prompt-host-beta', cwd: '/tmp/prompt-beta' },
        async () => {
          await tick(2)
          // Calling getPrompt() with 0 args on Host Beta NEVER hits Host Alpha's cache!
          const p = await getPrompt()
          expect([...getPrompt.cache.keys()]).toEqual(['/tmp/prompt-beta'])
          return p
        },
      ),
    ])

    expect(alphaPrompt).toBe('ALPHA_CUSTOM_CACHED_PROMPT')
    expect(betaPrompt).not.toBe('ALPHA_CUSTOM_CACHED_PROMPT')
    expect(betaPrompt).toContain('Invoke a skill.')
  })
})
