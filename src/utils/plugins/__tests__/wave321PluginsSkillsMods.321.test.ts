import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatRestoreSetAsideResultMessage } from '../../../cli/handlers/plugins.js'
import {
  clearDynamicSkills,
  discoverSkillDirsForPaths,
  resetNestedDiscoveryWithheldForTesting,
} from '../../../skills/loadSkillsDir.js'
import type { LoadedPlugin } from '../../../types/plugin.js'
import { SandboxManager } from '../../sandbox/sandbox-adapter.js'
import * as settingsMod from '../../settings/settings.js'
import {
  _getMissingDirsForTest,
  _simulateUnlinkDirForTest,
  initialize as initSkillChangeDetector,
  resetForTesting as resetSkillChangeDetector,
  subscribe as subscribeSkillChanges,
} from '../../skills/skillChangeDetector.js'
import {
  evaluateClaudeAuthoredModLoadPolicy,
  wrapCanUseToolForPluginModCall,
} from '../functionHooksModules.js'
import {
  filterKnownMarketplacesForManagedTakeover,
  isMarketplaceNameBlockedByManagedDeclaration,
  listSetAsidePluginData,
  listSetAsidePluginIds,
  pruneExpiredSetAsideData,
  reconcileManagedMarketplaceTakeover,
  restoreSetAsidePluginOptionsAndSecrets,
  setAsidePluginDataDir,
  setAsidePluginOptionsAndSecrets,
} from '../marketplaceHelpers.js'
import { dedupeInstallationsByScope } from '../pluginAutoupdate.js'
import {
  filterWatchedModDirs,
  isPluginDirWatchDisabledByEnv,
  isPluginDirWatchEnabledByDefault,
  layPluginDirTypes,
  selectPluginDirTypeTargets,
} from '../pluginDevMods.js'

const tempDirs: string[] = []
async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  delete process.env.CLAUDE_CODE_PLUGIN_DIR_WATCH
  delete process.env.CLAUDE_CONFIG_DIR
  resetNestedDiscoveryWithheldForTesting()
  clearDynamicSkills()
  await resetSkillChangeDetector()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Wave 321 — Plugins / Skills / Mods / Managed Marketplaces alignment', () => {
  test('#1858: --plugin-dir lays .claude-plugin/types/ and excludes isBuiltin plugins', async () => {
    const root = await makeTmpDir('plugin-dir-types-')
    const userPluginDir = join(root, 'my-mod')
    await mkdir(userPluginDir, { recursive: true })

    const userPlugin = {
      name: 'my-mod',
      path: userPluginDir,
      source: 'my-mod@inline',
      enabled: true,
      isBuiltin: false,
      manifest: { name: 'my-mod' },
    } as unknown as LoadedPlugin
    const builtinPlugin = {
      name: 'builtin-helper',
      path: join(root, 'builtin'),
      source: 'builtin-helper@builtin',
      enabled: true,
      isBuiltin: true,
      manifest: { name: 'builtin-helper' },
    } as unknown as LoadedPlugin

    const targets = selectPluginDirTypeTargets(
      [userPlugin, builtinPlugin],
      [root, join(root, 'builtin')],
    )
    expect(targets.map(p => p.name)).toEqual(['my-mod'])

    // Built-in plugin must never get types laid
    expect(
      await layPluginDirTypes(builtinPlugin, [userPlugin, builtinPlugin]),
    ).toBeUndefined()

    // Non-builtin plugin gets .claude-plugin/types/ without referencing builtin peers
    const laid = await layPluginDirTypes(
      userPlugin,
      [userPlugin, builtinPlugin],
      {
        version: '2.1.321',
      },
    )
    expect(laid).toBeDefined()
    const tsconfigRaw = await readFile(
      join(userPluginDir, '.claude-plugin', 'types', 'tsconfig.json'),
      'utf8',
    )
    const tsconfig = JSON.parse(tsconfigRaw) as {
      compilerOptions: { types: string[] }
    }
    expect(tsconfig.compilerOptions.types).toEqual(['claude-code'])
    expect(tsconfig.compilerOptions.types).not.toContain('builtin-helper')
  })

  test('#1861: pluginAutoupdate deduplicates installations by scope across worktrees', () => {
    const deduped = dedupeInstallationsByScope([
      { scope: 'project', projectPath: '/repo/wt-1' },
      { scope: 'project', projectPath: '/repo/wt-2' },
      { scope: 'local', projectPath: '/repo/wt-1' },
      { scope: 'local', projectPath: '/repo/wt-3' },
      { scope: 'user' },
    ])
    expect(deduped).toEqual(['project', 'local', 'user'])
  })

  test('#1863: skillChangeDetector tracks unlinkDir, polls for directory recovery, rebuilds watcher, and reloads', async () => {
    const root = await realpath(await makeTmpDir('skill-recover-'))
    const projectSkills = join(root, '.claude', 'skills')
    await mkdir(projectSkills, { recursive: true })
    const origCwd = process.cwd()
    process.chdir(root)
    let dirPresent = false
    let reloadCount = 0
    try {
      await resetSkillChangeDetector({
        chokidarInterval: 25,
        reloadDebounce: 10,
        stabilityThreshold: 10,
        pollInterval: 10,
        dirExists: async () => dirPresent,
        getFingerprint: async () => new Map([['s1', String(reloadCount)]]),
      })
      const unsub = subscribeSkillChanges(() => {
        reloadCount++
      })
      await initSkillChangeDetector()

      // Simulate git stash removing .claude/skills
      const recorded = _simulateUnlinkDirForTest(projectSkills)
      expect(recorded).toBe(true)
      expect(_getMissingDirsForTest().has(projectSkills)).toBe(true)

      // Directory reappears (git stash pop)
      dirPresent = true
      await new Promise(r => setTimeout(r, 150))

      expect(_getMissingDirsForTest().size).toBe(0)
      expect(reloadCount).toBeGreaterThanOrEqual(1)
      unsub()
    } finally {
      process.chdir(origCwd)
    }
  })

  test('#1938: Claude-authored mods auto-enable in auto & bypassPermissions, never load in dontAsk', () => {
    expect(evaluateClaudeAuthoredModLoadPolicy('bypassPermissions')).toBe(
      'auto-enable',
    )
    expect(
      evaluateClaudeAuthoredModLoadPolicy('auto', {
        isAutoCircuitBroken: false,
      }),
    ).toBe('auto-enable')
    expect(
      evaluateClaudeAuthoredModLoadPolicy('auto', {
        isAutoCircuitBroken: true,
      }),
    ).toBe('ask')
    expect(evaluateClaudeAuthoredModLoadPolicy('dontAsk')).toBe(
      'block-dont-ask',
    )
    expect(evaluateClaudeAuthoredModLoadPolicy('default')).toBe('ask')
  })

  test('#1939: $.tool.call / $.mcp.call promote ask and dontAsk-mode-deny to allow, while preserving deny rules & org policy', async () => {
    let seenForceDecisions: unknown[] = []
    const baseCanUseTool = async (
      _tool: unknown,
      input: Record<string, unknown>,
      _ctx: unknown,
      _msg: unknown,
      _id: string,
      forceDecision?: unknown,
    ) => {
      seenForceDecisions.push(forceDecision)
      if (forceDecision) return forceDecision
      return {
        behavior: 'ask',
        updatedInput: input,
        message: 'would prompt',
      }
    }
    const wrapped = wrapCanUseToolForPluginModCall(baseCanUseTool as never) as (
      tool: { name: string },
      input: Record<string, unknown>,
      ctx: Record<string, unknown>,
      msg: unknown,
      id: string,
      force?: Record<string, unknown>,
    ) => Promise<{ behavior: string }>

    // 1. Pre-evaluated ask -> promoted to allow without prompting
    const r1 = await wrapped(
      { name: 'Bash' },
      { command: 'ls' },
      { hookCaller: 'my-mod' },
      {},
      'id1',
      { behavior: 'ask', updatedInput: { command: 'ls' } },
    )
    expect(r1.behavior).toBe('allow')

    // 2. dontAsk mode conversion of ask -> promoted to allow
    const r2 = await wrapped(
      { name: 'mcp__srv__do' },
      { x: 1 },
      { hookCaller: 'my-mod' },
      {},
      'id2',
      {
        behavior: 'deny',
        decisionReason: { type: 'mode', mode: 'dontAsk' },
      },
    )
    expect(r2.behavior).toBe('allow')

    // 3. Explicit deny rule / org policy -> MUST remain denied
    const r3 = await wrapped(
      { name: 'Bash' },
      { command: 'rm -rf /' },
      { hookCaller: 'my-mod' },
      {},
      'id3',
      {
        behavior: 'deny',
        decisionReason: { type: 'rule', rule: { ruleContent: 'rm' } },
      },
    )
    expect(r3.behavior).toBe('deny')

    // 4. AskUserQuestion is not auto-promoted
    seenForceDecisions = []
    const r4 = await wrapped(
      { name: 'AskUserQuestion' },
      {},
      { hookCaller: 'my-mod' },
      {},
      'id4',
      { behavior: 'ask' },
    )
    expect(r4.behavior).toBe('ask')
    expect(seenForceDecisions.length).toBe(1)
  })

  test('#1942: nested skill discovery excludes .claude/skills under ~/.claude/plugins (direct & symlink)', async () => {
    const fakeHome = await makeTmpDir('fake-claude-home-')
    process.env.CLAUDE_CONFIG_DIR = fakeHome
    const pluginsDir = join(fakeHome, 'plugins')
    const pluginSkillsDir = join(
      pluginsDir,
      'cache',
      'foo',
      '.claude',
      'skills',
    )
    await mkdir(pluginSkillsDir, { recursive: true })
    const fileInPlugins = join(pluginsDir, 'cache', 'foo', 'index.ts')
    await writeFile(fileInPlugins, 'export {}')

    // Also test a symlink outside ~/.claude/plugins pointing into ~/.claude/plugins
    const outsideSub = join(fakeHome, 'workspace', 'sub', '.claude')
    await mkdir(outsideSub, { recursive: true })
    await symlink(pluginSkillsDir, join(outsideSub, 'skills'))
    const fileInOutside = join(fakeHome, 'workspace', 'sub', 'main.ts')
    await writeFile(fileInOutside, 'export {}')

    const spySandbox = spyOn(
      SandboxManager,
      'isSandboxingEnabled',
    ).mockReturnValue(false)
    try {
      const dirs1 = await discoverSkillDirsForPaths([fileInPlugins], fakeHome)
      expect(dirs1).toEqual([])

      const dirs2 = await discoverSkillDirsForPaths([fileInOutside], fakeHome)
      expect(dirs2).toEqual([])
    } finally {
      spySandbox.mockRestore()
    }
  })

  test('#1948 & #1960: managed extraKnownMarketplaces blocks other sources, hides displaced entries, sets aside data/options/secrets, and restores or discards', async () => {
    const spyPolicy = spyOn(
      settingsMod,
      'getSettingsForSource',
    ).mockImplementation(source => {
      if (source === 'policySettings') {
        return {
          extraKnownMarketplaces: {
            corp: {
              source: { source: 'github', repo: 'corp-org/official-mkt' },
            },
          },
        } as never
      }
      return null
    })

    try {
      // #1948: cannot add declared name from another source
      expect(
        isMarketplaceNameBlockedByManagedDeclaration('corp', {
          source: 'github',
          repo: 'attacker/fake-mkt',
        }),
      ).toBe(true)
      expect(
        isMarketplaceNameBlockedByManagedDeclaration('corp', {
          source: 'github',
          repo: 'corp-org/official-mkt',
        }),
      ).toBe(false)

      // #1948: displaced known_marketplaces entry is hidden
      const filtered = filterKnownMarketplacesForManagedTakeover({
        corp: {
          source: { source: 'github', repo: 'attacker/fake-mkt' },
        },
        personal: {
          source: { source: 'github', repo: 'me/personal-mkt' },
        },
      })
      expect(Object.keys(filtered.visible)).toEqual(['personal'])
      expect(Object.keys(filtered.hidden)).toEqual(['corp'])
    } finally {
      spyPolicy.mockRestore()
    }

    // #1960: data set-aside + expiry pruning + options/secrets set-aside + restore/discard
    const pluginsDir = await makeTmpDir('plugins-set-aside-')
    const dataDir = join(pluginsDir, 'data', 'tool_corp')
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'state.json'), '{"v":1}')

    let userConfigs: Record<string, unknown> = {
      'tool@corp': { options: { region: 'us-east' } },
    }
    let secretsStore: Record<string, unknown> = {
      'tool@corp': { apiKey: 'secret-123' },
    }
    const seams = {
      readUserPluginConfigs: () => userConfigs,
      writeUserPluginConfigs: async (patch: Record<string, unknown>) => {
        const next = { ...userConfigs }
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete next[k]
          else next[k] = v
        }
        userConfigs = next
        return { error: null }
      },
      readSecrets: async () => secretsStore,
      writeSecrets: async (next: Record<string, unknown>) => {
        secretsStore = next
        return true
      },
    }

    const reinstalled: string[] = []
    const rec = await reconcileManagedMarketplaceTakeover({
      marketplaceName: 'corp',
      previousSource: { source: 'github', repo: 'old/mkt' },
      managedSource: { source: 'github', repo: 'corp-org/official-mkt' },
      installedPluginIds: ['tool@corp', 'unlisted@corp'],
      declaredMarketplacePluginNames: ['tool'],
      getDataDir: id =>
        id === 'tool@corp'
          ? dataDir
          : join(pluginsDir, 'data', 'unlisted_corp'),
      reinstallPlugin: async id => {
        reinstalled.push(id)
        return true
      },
      pluginsDir,
      seams,
    })
    expect(rec.takenOver).toBe(true)
    expect(rec.setAsidePluginIds).toEqual(['tool@corp', 'unlisted@corp'])
    expect(rec.reinstalledPluginIds).toEqual(['tool@corp'])
    expect(reinstalled).toEqual(['tool@corp'])

    // Saved data moved under .set-aside/
    const listedData = await listSetAsidePluginData({ pluginsDir })
    expect(listedData.holders.length).toBe(1)

    // Options & secrets moved under .set-aside/<token>/...
    expect(userConfigs['tool@corp']).toBeUndefined()
    expect(secretsStore['tool@corp']).toBeUndefined()
    expect(await listSetAsidePluginIds(seams)).toEqual(['tool@corp'])

    // Restore brings them back
    const restored = await restoreSetAsidePluginOptionsAndSecrets('tool@corp', {
      discard: false,
      seams,
    })
    expect(restored).toEqual({ options: 1, secrets: 1 })
    expect(userConfigs['tool@corp']).toEqual({ options: { region: 'us-east' } })
    expect(secretsStore['tool@corp']).toEqual({ apiKey: 'secret-123' })
    expect(
      formatRestoreSetAsideResultMessage('tool@corp', restored, false).message,
    ).toContain('Restored the options and secrets set aside for tool@corp')

    // Set aside again and --discard deletes them
    await setAsidePluginOptionsAndSecrets('tool@corp', { seams })
    const discarded = await restoreSetAsidePluginOptionsAndSecrets(
      'tool@corp',
      { discard: true, seams },
    )
    expect(discarded).toEqual({ options: 1, secrets: 1 })
    expect(userConfigs['tool@corp']).toBeUndefined()
    expect(secretsStore['tool@corp']).toBeUndefined()
    expect(
      formatRestoreSetAsideResultMessage('tool@corp', discarded, true).message,
    ).toContain('Discarded the options and secrets set aside for tool@corp')

    // Prune expired set-aside data older than cleanupPeriodDays
    const oldData = join(pluginsDir, 'data', 'old_corp')
    await mkdir(oldData, { recursive: true })
    await writeFile(join(oldData, 'x'), '1')
    await setAsidePluginDataDir(oldData, {
      pluginsDir,
      token: '2020-01-01T00-00-00Z.abcdef012345',
    })
    const removed = await pruneExpiredSetAsideData(30, {
      pluginsDir,
      nowMs: Date.UTC(2026, 0, 1),
    })
    expect(removed.some(p => p.includes('2020-01-01T00-00-00Z'))).toBe(true)
  })

  test('#1952: headless sessions watch .claude/skills mod dirs by default, disabled by CLAUDE_CODE_PLUGIN_DIR_WATCH=0', () => {
    const dirs = ['/proj/.claude/skills', '/proj/extra-plugin']
    const skillDirs = ['/proj/.claude/skills']

    // Headless default: only .claude/skills mod dirs are watched
    expect(isPluginDirWatchEnabledByDefault(true)).toBe(false)
    expect(
      filterWatchedModDirs(dirs, {
        skillModDirs: skillDirs,
        isNonInteractive: true,
      }),
    ).toEqual(['/proj/.claude/skills'])

    // Interactive default: all non-excluded dirs watched
    expect(isPluginDirWatchEnabledByDefault(false)).toBe(true)
    expect(
      filterWatchedModDirs(dirs, {
        skillModDirs: skillDirs,
        isNonInteractive: false,
      }),
    ).toEqual(dirs)

    // CLAUDE_CODE_PLUGIN_DIR_WATCH=0 disables watching even for .claude/skills
    process.env.CLAUDE_CODE_PLUGIN_DIR_WATCH = '0'
    expect(isPluginDirWatchDisabledByEnv()).toBe(true)
    expect(
      filterWatchedModDirs(dirs, {
        skillModDirs: skillDirs,
        isNonInteractive: true,
      }),
    ).toEqual([])
  })
})
