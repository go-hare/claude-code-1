/**
 * Official Claude Code 2.1.331 Wave 4 Fixer 3 multi-host tests:
 *
 * 1. Live `managed-settings.json` (`policySettings`) updates invalidate
 *    `SettingsOwner.parsedFiles` across all live hosts (`resetAllLiveHostSettingsCaches`)
 *    and immediately update `getHooksConfigFromSnapshot()` (`disableAllHooks: true`).
 * 2. `withProject` fork initializing `hooksConfigSnapshot`, `loadPluginHooks`, and
 *    `fileChangedWatcher` captures `WeakRef(session.root)` so GC'ing the transient
 *    fork never breaks root-session hot-reload or watcher callbacks.
 * 3. Per-host `HostSlot` isolation for `remoteSettingsState`, `internalWrites`,
 *    `localSettingsGitTracked`, `pluginOnlyPolicy` (including live managed revocation
 *    clearing isolated host skill caches outside ALS), `mdm/settings`, `settings.ts`
 *    managed reread state, and `markdownConfigLoader`.
 * 4. `claudemd.ts`: `registerClaudeMdPermissionContextSource` cleanup clears
 *    `ownerSession`'s `getMemoryFiles` cache even when called outside `ownerSession`'s
 *    ALS, and `getMemoryFiles` includes the permission hold signature in its cache key
 *    so two `withProject` forks on the same root session never thrash each other.
 * 5. `commands.ts`, `loadSkillsDir.ts`, and `skillChangeDetector.ts`: `getCommands(cwd)`
 *    subscribes to dynamic skill invalidation (clearing skill caches and `clearSkillIndexCache`),
 *    `onDynamicSkillsLoaded` supports both per-host and `{ scope: 'global' }` listeners,
 *    and `skillChangeDetector` isolates watcher state per `SessionHost`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getRegisteredHooks,
  registerHookCallbacks,
  resetStateForTests,
  setInlinePlugins,
  setSessionTrustAccepted,
} from '../../bootstrap/state.js'
import {
  getCommands,
  getSkillToolCommands,
  getSlashCommandToolSkills,
} from '../../commands.js'
import {
  addSkillDirectories,
  clearDynamicSkills,
  clearSkillCaches,
  getDynamicSkills,
  getSkillDirCommands,
  onDynamicSkillsLoaded,
} from '../../skills/loadSkillsDir.js'
import {
  clearMemoryFileCaches,
  getMemoryFiles,
  registerClaudeMdPermissionContextSource,
} from '../claudemd.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  initializeFileChangedWatcher,
  resetFileChangedWatcherForTesting,
  setEnvHookNotifier,
} from '../hooks/fileChangedWatcher.js'
import {
  captureHooksConfigSnapshot,
  getHooksConfigFromSnapshot,
  resetHooksConfigSnapshot,
} from '../hooks/hooksConfigSnapshot.js'
import { loadMarkdownFilesForSubdir } from '../markdownConfigLoader.js'
import {
  clearPluginHookCache,
  loadPluginHooks,
  resetHotReloadState,
  setupPluginHookHotReload,
} from '../plugins/loadPluginHooks.js'
import { clearPluginCache } from '../plugins/pluginLoader.js'
import {
  getSessionAlsStore,
  runWithNewHostSession,
  runWithSession,
} from '../sessionContextAls.js'
import { getBootstrapSession, getBootstrapSessionHost } from '../sessionHost.js'
import { registerSessionContextReader, type Session } from '../sessionRoot.js'
import { settingsChangeDetector } from '../settings/changeDetector.js'
import {
  clearInternalWrites,
  consumeInternalWrite,
  forgetFirstReads,
  getFirstReadStat,
  getOwnWriteBeforeFirstCheck,
  markInternalWrite,
  recordFirstReadStat,
} from '../settings/internalWrites.js'
import {
  isLocalSettingsGitTracked,
  resetLocalSettingsGitTrackedCache,
} from '../settings/localSettingsGitTracked.js'
import {
  getManagedFilePath,
  getManagedSettingsDropInDir,
} from '../settings/managedPath.js'
import {
  clearMdmSettingsCache,
  getHkcuSettings,
  getMdmSettings,
  setMdmSettingsCache,
} from '../settings/mdm/settings.js'
import {
  isRestrictedToPluginOnly,
  notifyStrictPluginOnlyPolicyIfChanged,
  registerStrictPluginOnlyChangeCallback,
} from '../settings/pluginOnlyPolicy.js'
import {
  bumpRemoteSettingsLoadEpoch,
  getActiveRemoteSettings,
  getRemoteSettingsLoadStatus,
  onRemoteSettingsLoadStatusChanged,
  resetRemoteSettingsStateForTesting,
  setRemoteSettingsLoadStatus,
  setVerifiedRemoteSettingsForTesting,
} from '../settings/remoteSettingsState.js'
import {
  beginManagedReread,
  getSettingsForSource,
  giveUpManagedReread,
  managedRereadGivenUp,
  managedRereadInFlight,
  resetManagedRereadStateForTesting,
} from '../settings/settings.js'
import {
  getSettingsOwner,
  resetAllLiveHostSettingsCaches,
  resetSettingsCache,
} from '../settings/settingsCache.js'
import { skillChangeDetector } from '../skills/skillChangeDetector.js'

const tick = (ms = 10): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

function writeJsonFile(filePath: string, value: unknown): void {
  const idx = filePath.lastIndexOf('/')
  if (idx > 0) {
    mkdirSync(filePath.slice(0, idx), { recursive: true })
  }
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeTextFile(filePath: string, content: string): void {
  const idx = filePath.lastIndexOf('/')
  if (idx > 0) {
    mkdirSync(filePath.slice(0, idx), { recursive: true })
  }
  writeFileSync(filePath, content, 'utf8')
}

function createRepo(workspace: string, name: string): string {
  const dir = join(workspace, name)
  mkdirSync(join(dir, '.git'), { recursive: true })
  return dir
}

function createInlinePluginWithHook(
  workspace: string,
  name: string,
  commandText: string,
): string {
  const pluginDir = join(workspace, `plugin-${name}`)
  writeJsonFile(join(pluginDir, '.claude-plugin', 'plugin.json'), {
    name: `${name}-plug`,
    version: '1.0.0',
    description: `Plugin ${name}`,
  })
  writeJsonFile(join(pluginDir, 'hooks', 'hooks.json'), {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: commandText }],
        },
      ],
    },
  })
  return pluginDir
}

function forceGc(): void {
  if (typeof Bun !== 'undefined' && typeof Bun.gc === 'function') {
    Bun.gc(true)
  }
}

describe('2.1.331 Wave 4 Fixer 3 — Settings Pipeline, Policy Hot-Reload, Hooks, ClaudeMd & Skills isolation', () => {
  const tempDirs: string[] = []
  let savedConfigDir: string | undefined
  let savedManagedPath: string | undefined
  let savedUserType: string | undefined
  let savedNativeSearch: string | undefined
  let savedHooksSameThread: string | undefined
  let managedDir = ''
  let configDir = ''

  beforeEach(async () => {
    savedConfigDir = process.env.CLAUDE_CONFIG_DIR
    savedManagedPath = process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
    savedUserType = process.env.USER_TYPE
    savedNativeSearch = process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH
    savedHooksSameThread = process.env.CLAUDE_CODE_HOOKS_SAME_THREAD

    const root = realpathSync(mkdtempSync(join(tmpdir(), 'als-wave4-f3-')))
    tempDirs.push(root)
    configDir = join(root, 'claude-home')
    managedDir = join(root, 'managed')
    mkdirSync(configDir, { recursive: true })
    mkdirSync(managedDir, { recursive: true })

    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH = managedDir
    process.env.USER_TYPE = 'ant'
    process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = '1'
    process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = '1'

    getClaudeConfigHomeDir.cache?.clear?.()
    getManagedFilePath.cache?.clear?.()
    getManagedSettingsDropInDir.cache?.clear?.()

    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    resetAllLiveHostSettingsCaches()
    resetHooksConfigSnapshot()
    resetHotReloadState()
    resetFileChangedWatcherForTesting()
    resetRemoteSettingsStateForTesting()
    resetManagedRereadStateForTesting()
    clearInternalWrites()
    resetLocalSettingsGitTrackedCache()
    clearMdmSettingsCache()
    clearMemoryFileCaches()
    clearSkillCaches()
    clearDynamicSkills()
    loadMarkdownFilesForSubdir.cache?.clear?.()
    await settingsChangeDetector.resetForTesting()
    await skillChangeDetector.resetForTesting()
  })

  afterEach(async () => {
    await settingsChangeDetector.resetForTesting()
    await skillChangeDetector.resetForTesting()
    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    resetAllLiveHostSettingsCaches()
    resetHooksConfigSnapshot()
    resetHotReloadState()
    resetFileChangedWatcherForTesting()
    resetRemoteSettingsStateForTesting()
    resetManagedRereadStateForTesting()
    clearInternalWrites()
    resetLocalSettingsGitTrackedCache()
    clearMdmSettingsCache()
    clearMemoryFileCaches()
    clearSkillCaches()
    clearDynamicSkills()
    loadMarkdownFilesForSubdir.cache?.clear?.()

    if (savedConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = savedConfigDir
    }
    if (savedManagedPath === undefined) {
      delete process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
    } else {
      process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH = savedManagedPath
    }
    if (savedUserType === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = savedUserType
    }
    if (savedNativeSearch === undefined) {
      delete process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH
    } else {
      process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = savedNativeSearch
    }
    if (savedHooksSameThread === undefined) {
      delete process.env.CLAUDE_CODE_HOOKS_SAME_THREAD
    } else {
      process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = savedHooksSameThread
    }

    getClaudeConfigHomeDir.cache?.clear?.()
    getManagedFilePath.cache?.clear?.()
    getManagedSettingsDropInDir.cache?.clear?.()

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('[P0] live managed-settings.json (policySettings) update invalidates parsedFiles & disables hooks immediately on isolated ALS hosts', async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'als-p0-pol-')))
    tempDirs.push(workspace)
    const repoA = createRepo(workspace, 'repo-a')
    const repoB = createRepo(workspace, 'repo-b')

    writeJsonFile(join(repoA, '.claude', 'settings.json'), {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo host-a-hook' }],
          },
        ],
      },
    })
    writeJsonFile(join(repoB, '.claude', 'settings.json'), {
      env: { HOST_B_FLAG: 'before' },
    })

    // Initial managed-settings.json allows hooks
    const managedFile = join(managedDir, 'managed-settings.json')
    writeJsonFile(managedFile, { disableAllHooks: false })

    let readyA!: () => void
    const hostAReady = new Promise<void>(r => {
      readyA = r
    })
    let readyB!: () => void
    const hostBReady = new Promise<void>(r => {
      readyB = r
    })
    let policyUpdated!: () => void
    const policyDone = new Promise<void>(r => {
      policyUpdated = r
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'p0-host-a',
          originalCwd: repoA,
          projectRoot: repoA,
          cwd: repoA,
          isInteractive: false,
        },
        async () => {
          captureHooksConfigSnapshot()
          const beforeHooks = getHooksConfigFromSnapshot()
          const hadParsedBefore = getSettingsOwner().parsedFiles.size > 0
          readyA()
          await policyDone

          const afterHooks = getHooksConfigFromSnapshot()
          const afterPolicy = getSettingsForSource('policySettings')
          return { beforeHooks, hadParsedBefore, afterHooks, afterPolicy }
        },
      ),
      // Host B reads settings BEFORE any changeDetector subscription exists on Host B
      runWithNewHostSession(
        {
          id: 'p0-host-b-unsubscribed',
          originalCwd: repoB,
          projectRoot: repoB,
          cwd: repoB,
          isInteractive: false,
        },
        async () => {
          const beforePolicy = getSettingsForSource('policySettings')
          readyB()
          await policyDone

          // Must see fresh disk policy immediately via resetAllLiveHostSettingsCaches()!
          const afterPolicy = getSettingsForSource('policySettings')
          return { beforePolicy, afterPolicy }
        },
      ),
      (async () => {
        await Promise.all([hostAReady, hostBReady])
        // Rewrite managed-settings.json on disk and notify OUTSIDE both isolated hosts' ALS
        writeJsonFile(managedFile, { disableAllHooks: true })
        settingsChangeDetector.notifyChange('policySettings')
        policyUpdated()
      })(),
    ])

    expect(resA.hadParsedBefore).toBe(true)
    expect(resA.beforeHooks?.PreToolUse).toHaveLength(1)
    expect(resA.afterPolicy?.disableAllHooks).toBe(true)
    expect(resA.afterHooks).toEqual({})

    expect(resB.beforePolicy?.disableAllHooks).toBe(false)
    expect(resB.afterPolicy?.disableAllHooks).toBe(true)
  })

  test('[P0/P1] withProject fork initializing hooksConfigSnapshot, loadPluginHooks, and fileChangedWatcher keeps root session hot-reload alive after fork GC', async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'als-fork-gc-')))
    tempDirs.push(workspace)
    const repo = createRepo(workspace, 'repo-root')
    const forkSubdir = join(repo, 'nested-fork')
    mkdirSync(forkSubdir, { recursive: true })

    const pluginDir = createInlinePluginWithHook(
      workspace,
      'forktest',
      'echo plugin-hook',
    )
    const cmdPrintSystemMsg = (msg: string): string =>
      `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
        `console.log(JSON.stringify({ systemMessage: ${JSON.stringify(msg)} }))`,
      )}`

    writeJsonFile(join(repo, '.claude', 'settings.json'), {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo root-pre-hook' }],
          },
        ],
        FileChanged: [
          {
            matcher: '.envrc',
            hooks: [
              {
                type: 'command',
                command: cmdPrintSystemMsg('fork-gc-file-event'),
              },
            ],
          },
        ],
      },
    })
    const managedFile = join(managedDir, 'managed-settings.json')
    writeJsonFile(managedFile, { disableAllHooks: false })

    // Helper allocates transient withProject fork in its own stack frame so it
    // can be garbage collected once returned.
    function initializeSubsystemsOnTransientFork(
      rootSession: Session,
      cwd: string,
    ): WeakRef<Session> {
      const fork = rootSession.withProject({ cwd })
      runWithSession(fork, () => {
        captureHooksConfigSnapshot()
        setupPluginHookHotReload()
        initializeFileChangedWatcher(cwd)
      })
      return new WeakRef(fork)
    }

    let initializedReady!: () => void
    const waitInitialized = new Promise<void>(r => {
      initializedReady = r
    })
    let updatedReady!: () => void
    const waitUpdated = new Promise<void>(r => {
      updatedReady = r
    })

    const watcherEvents: Array<{ text: string; isRoot: boolean }> = []

    const [hostResult] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'fork-gc-root-session',
          originalCwd: repo,
          projectRoot: repo,
          cwd: repo,
          isInteractive: false,
        },
        async rootSession => {
          try {
            setInlinePlugins([pluginDir])
            await loadPluginHooks()
            expect(loadPluginHooks.cache.size).toBe(1)

            registerHookCallbacks({
              FileChanged: [
                {
                  matcher: '.envrc',
                  hooks: [
                    {
                      type: 'callback',
                      callback: async () => ({
                        systemMessage: 'fork-gc-file-event',
                      }),
                    },
                  ],
                },
              ],
            })
            setEnvHookNotifier(text => {
              watcherEvents.push({
                text,
                isRoot: getBootstrapSession() === rootSession,
              })
            })

            const forkRef = initializeSubsystemsOnTransientFork(
              rootSession,
              forkSubdir,
            )

            // Encourage GC of the transient fork while rootSession remains live
            for (let i = 0; i < 4; i++) {
              forceGc()
              await tick(5)
            }

            const beforeHooks = getHooksConfigFromSnapshot()
            expect(beforeHooks?.PreToolUse).toHaveLength(1)

            // Wait for chokidar watcher to arm, then create watched .envrc to trigger FileChanged
            await tick(200)
            writeTextFile(join(forkSubdir, '.envrc'), 'export INIT=2_changed\n')
            const watchDeadline = Date.now() + 3000
            while (
              !watcherEvents.some(e => e.text === 'fork-gc-file-event') &&
              Date.now() < watchDeadline
            ) {
              await tick(40)
            }

            initializedReady()
            await waitUpdated
            // Allow fire-and-forget loadPluginHooks() reload microtasks to settle
            await tick(40)

            const afterHooks = getHooksConfigFromSnapshot()
            const registeredAfter = getRegisteredHooks()
            return {
              forkCollected: forkRef.deref() === undefined,
              afterHooks,
              hasPluginHookAfter:
                (registeredAfter?.PreToolUse?.length ?? 0) > 0,
              watcherEvents: [...watcherEvents],
            }
          } finally {
            resetFileChangedWatcherForTesting()
            resetHotReloadState()
            resetHooksConfigSnapshot()
            clearPluginCache('test cleanup')
            clearPluginHookCache()
          }
        },
      ),
      (async () => {
        await waitInitialized
        // Trigger both hooksConfigSnapshot policy hot-reload and loadPluginHooks hot-reload
        // from OUTSIDE the isolated host's ALS!
        writeJsonFile(managedFile, {
          disableAllHooks: true,
          blockedMarketplaces: [
            { source: 'github', repo: 'evil/blocked-marketplace' },
          ],
        })
        settingsChangeDetector.notifyChange('policySettings')
        updatedReady()
      })(),
    ])

    // Regardless of whether JSC reclaimed the fork yet, rootSession MUST have
    // received BOTH the policy hot-reload AND the FileChanged watcher event!
    expect(hostResult.afterHooks).toEqual({})
    expect(hostResult.hasPluginHookAfter).toBe(true)
    expect(
      hostResult.watcherEvents.some(
        e => e.text === 'fork-gc-file-event' && e.isRoot,
      ),
    ).toBe(true)
  })

  test('[P1] remoteSettingsState, internalWrites, localSettingsGitTracked, mdm/settings, and settings reread state isolate strictly per HostSlot', async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'als-pipe-iso-')))
    tempDirs.push(workspace)

    // Create two git repos: repoTracked commits .claude/settings.local.json; repoUntracked does not
    const repoTracked = join(workspace, 'repo-tracked')
    const repoUntracked = join(workspace, 'repo-untracked')
    mkdirSync(join(repoTracked, '.claude'), { recursive: true })
    mkdirSync(join(repoUntracked, '.claude'), { recursive: true })
    writeJsonFile(join(repoTracked, '.claude', 'settings.local.json'), {
      env: { TRACKED: '1' },
    })
    writeJsonFile(join(repoUntracked, '.claude', 'settings.local.json'), {
      env: { UNTRACKED: '1' },
    })
    const gitEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    }
    spawnSync('git', ['init'], { cwd: repoTracked, env: gitEnv })
    spawnSync('git', ['add', '-f', '.claude/settings.local.json'], {
      cwd: repoTracked,
      env: gitEnv,
    })
    spawnSync('git', ['init'], { cwd: repoUntracked, env: gitEnv })

    const sharedFile = join(workspace, 'shared-settings.json')
    let hostAEvents = 0
    let hostBEvents = 0

    let hostASeeded!: () => void
    const waitHostASeeded = new Promise<void>(r => {
      hostASeeded = r
    })
    let hostBChecked!: () => void
    const waitHostBChecked = new Promise<void>(r => {
      hostBChecked = r
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'pipe-host-a',
          originalCwd: repoTracked,
          projectRoot: repoTracked,
          cwd: repoTracked,
        },
        async () => {
          setSessionTrustAccepted(true)

          // remoteSettingsState
          const unsubA = onRemoteSettingsLoadStatusChanged(() => {
            hostAEvents++
          })
          setVerifiedRemoteSettingsForTesting({ model: 'claude-host-a' })
          setRemoteSettingsLoadStatus({ state: 'ok', hasSettings: true })
          const epochA = bumpRemoteSettingsLoadEpoch()

          // internalWrites
          recordFirstReadStat(sharedFile, { mtimeMs: 100, size: 10 })
          markInternalWrite(sharedFile, '{"from":"host-a"}')

          // localSettingsGitTracked
          const trackedA = isLocalSettingsGitTracked({
            onIndeterminate: 'tracked',
          })

          // mdm/settings
          setMdmSettingsCache(
            { settings: { model: 'mdm-a' }, errors: [] },
            { settings: { language: 'fr' }, errors: [] },
          )

          // settings.ts managed reread state
          const inFlightA = Promise.resolve(true)
          beginManagedReread(inFlightA)
          giveUpManagedReread()

          hostASeeded()
          await waitHostBChecked

          // Host B's resets/mutations must NOT have touched Host A!
          const activeRemoteA = getActiveRemoteSettings()
          const loadStatusA = getRemoteSettingsLoadStatus()
          const firstStatA = getFirstReadStat(sharedFile)
          const ownWriteA = getOwnWriteBeforeFirstCheck(sharedFile)
          const consumedA = consumeInternalWrite(sharedFile, 60_000)
          const mdmA = getMdmSettings()
          const hkcuA = getHkcuSettings()
          const rereadInFlightSameA = managedRereadInFlight() === inFlightA
          const rereadGivenUpA = managedRereadGivenUp()

          unsubA()
          resetManagedRereadStateForTesting()
          return {
            epochA,
            activeRemoteA,
            loadStatusA,
            firstStatA,
            ownWriteA,
            consumedA,
            trackedA,
            mdmA,
            hkcuA,
            rereadInFlightSameA,
            rereadGivenUpA,
          }
        },
      ),
      runWithNewHostSession(
        {
          id: 'pipe-host-b',
          originalCwd: repoUntracked,
          projectRoot: repoUntracked,
          cwd: repoUntracked,
        },
        async () => {
          setSessionTrustAccepted(true)
          await waitHostASeeded

          const unsubB = onRemoteSettingsLoadStatusChanged(() => {
            hostBEvents++
          })

          // Host B sees clean initial state — zero leakage from Host A
          const initialRemoteB = getActiveRemoteSettings()
          const initialStatusB = getRemoteSettingsLoadStatus()
          const initialFirstStatB = getFirstReadStat(sharedFile)
          const initialConsumedB = consumeInternalWrite(sharedFile, 60_000)
          const initialMdmB = getMdmSettings()
          const initialRereadInFlightB = managedRereadInFlight()
          const initialRereadGivenUpB = managedRereadGivenUp()

          // Mutate & clear everything in Host B
          setVerifiedRemoteSettingsForTesting({ model: 'claude-host-b' })
          setRemoteSettingsLoadStatus({ state: 'ineligible' })
          resetRemoteSettingsStateForTesting()
          forgetFirstReads()
          clearInternalWrites()
          const trackedB = isLocalSettingsGitTracked({
            onIndeterminate: 'tracked',
          })
          resetLocalSettingsGitTrackedCache()
          clearMdmSettingsCache()
          resetManagedRereadStateForTesting()

          unsubB()
          hostBChecked()
          return {
            initialRemoteB,
            initialStatusB,
            initialFirstStatB,
            initialConsumedB,
            initialMdmB,
            initialRereadInFlightB,
            initialRereadGivenUpB,
            trackedB,
          }
        },
      ),
    ])

    expect(hostAEvents).toBe(2) // setRemoteSettingsLoadStatus + bumpRemoteSettingsLoadEpoch only
    expect(hostBEvents).toBe(1) // setRemoteSettingsLoadStatus only

    expect(resA.epochA).toBe(1)
    expect(resA.activeRemoteA).toEqual({ model: 'claude-host-a' })
    expect(resA.loadStatusA).toEqual({ state: 'ok', hasSettings: true })
    expect(resA.firstStatA).toEqual({ mtimeMs: 100, size: 10 })
    expect(resA.ownWriteA).toBeDefined()
    expect(resA.consumedA).toBe(resA.ownWriteA?.contentHash)
    expect(resA.trackedA).toBe(true)
    expect(resA.mdmA.settings).toEqual({ model: 'mdm-a' })
    expect(resA.hkcuA.settings).toEqual({ language: 'fr' })
    expect(resA.rereadInFlightSameA).toBe(true)
    expect(resA.rereadGivenUpA).toBe(true)

    expect(resB.initialRemoteB).toBeNull()
    expect(resB.initialStatusB).toBeUndefined()
    expect(resB.initialFirstStatB).toBeUndefined()
    expect(resB.initialConsumedB).toBeUndefined()
    expect(resB.initialMdmB.settings).toEqual({})
    expect(resB.initialRereadInFlightB).toBeUndefined()
    expect(resB.initialRereadGivenUpB).toBe(false)
    expect(resB.trackedB).toBe(false)
  })

  test('[P1] pluginOnlyPolicy live revocation outside ALS clears isolated host skill & markdown caches, and markdownConfigLoader isolates .cache per host', async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'als-pol-md-')))
    tempDirs.push(workspace)
    const repoA = createRepo(workspace, 'repo-a')
    const repoB = createRepo(workspace, 'repo-b')

    writeTextFile(
      join(repoA, '.claude', 'skills', 'proj-alpha-skill', 'SKILL.md'),
      '---\ndescription: Alpha skill\n---\nAlpha skill body\n',
    )
    writeTextFile(
      join(repoA, '.claude', 'agents', 'alpha-agent.md'),
      '---\nname: alpha-agent\ndescription: Alpha agent\n---\nAlpha agent body\n',
    )
    writeTextFile(
      join(repoB, '.claude', 'agents', 'beta-agent.md'),
      '---\nname: beta-agent\ndescription: Beta agent\n---\nBeta agent body\n',
    )

    // 1. Verify markdownConfigLoader.loadMarkdownFilesForSubdir.cache is host-isolated
    //    and Host A's clearSkillCaches() never wipes Host B's cached entries!
    let hostAWarmedMd!: () => void
    const waitAWarmedMd = new Promise<void>(r => {
      hostAWarmedMd = r
    })
    let hostBWarmedMd!: () => void
    const waitBWarmedMd = new Promise<void>(r => {
      hostBWarmedMd = r
    })
    let hostAClearedMd!: () => void
    const waitAClearedMd = new Promise<void>(r => {
      hostAClearedMd = r
    })

    await Promise.all([
      runWithNewHostSession(
        { id: 'md-host-a', originalCwd: repoA, projectRoot: repoA, cwd: repoA },
        async () => {
          const filesA = await loadMarkdownFilesForSubdir('agents', repoA)
          expect(filesA.some(f => f.filePath.includes('alpha-agent.md'))).toBe(
            true,
          )
          expect(loadMarkdownFilesForSubdir.cache.has(`agents:${repoA}`)).toBe(
            true,
          )
          hostAWarmedMd()
          await waitBWarmedMd

          clearSkillCaches()
          expect(loadMarkdownFilesForSubdir.cache.size).toBe(0)
          hostAClearedMd()
        },
      ),
      runWithNewHostSession(
        { id: 'md-host-b', originalCwd: repoB, projectRoot: repoB, cwd: repoB },
        async () => {
          const promiseB = loadMarkdownFilesForSubdir('agents', repoB)
          const filesB = await promiseB
          expect(filesB.some(f => f.filePath.includes('beta-agent.md'))).toBe(
            true,
          )
          hostBWarmedMd()
          await waitAWarmedMd
          await waitAClearedMd

          // Host B's markdownConfigLoader cache MUST remain intact!
          expect(loadMarkdownFilesForSubdir.cache.get(`agents:${repoB}`)).toBe(
            promiseB,
          )
        },
      ),
    ])

    // 2. Verify live strictPluginOnlyCustomization revocation notified OUTSIDE ALS
    //    clears prohibited user/project skills cached on an isolated live host!
    const managedFile = join(managedDir, 'managed-settings.json')
    writeJsonFile(managedFile, {})

    const observedHostsOnCallback: object[] = []
    const unsubCb = registerStrictPluginOnlyChangeCallback(() => {
      observedHostsOnCallback.push(getBootstrapSessionHost())
    })

    let skillHostPrimed!: () => void
    const waitSkillHostPrimed = new Promise<void>(r => {
      skillHostPrimed = r
    })
    let policyRevoked!: () => void
    const waitPolicyRevoked = new Promise<void>(r => {
      policyRevoked = r
    })

    try {
      const [skillHostRes] = await Promise.all([
        runWithNewHostSession(
          {
            id: 'policy-revocation-host',
            originalCwd: repoA,
            projectRoot: repoA,
            cwd: repoA,
          },
          async session => {
            // Load skills BEFORE managed policy restricts them
            const beforeSkills = await getSkillDirCommands(repoA)
            expect(beforeSkills.map(s => s.name)).toContain('proj-alpha-skill')
            expect(getSkillDirCommands.cache.size).toBe(1)
            expect(isRestrictedToPluginOnly('skills')).toBe(false)

            skillHostPrimed()
            await waitPolicyRevoked

            // Live revocation MUST have already cleared Host A's skill cache!
            const cacheSizeRightAfterRevocation = getSkillDirCommands.cache.size
            const afterSkills = await getSkillDirCommands(repoA)
            return {
              hostObj: session.host,
              cacheSizeRightAfterRevocation,
              afterSkillNames: afterSkills.map(s => s.name),
              restrictedAfter: isRestrictedToPluginOnly('skills'),
            }
          },
        ),
        (async () => {
          await waitSkillHostPrimed
          // Admin writes strictPluginOnlyCustomization: ['skills'] and notifies OUTSIDE ALS!
          writeJsonFile(managedFile, {
            strictPluginOnlyCustomization: ['skills'],
          })
          settingsChangeDetector.notifyChange('policySettings')
          policyRevoked()
        })(),
      ])

      expect(skillHostRes.cacheSizeRightAfterRevocation).toBe(0)
      expect(skillHostRes.restrictedAfter).toBe(true)
      expect(skillHostRes.afterSkillNames).not.toContain('proj-alpha-skill')
      expect(observedHostsOnCallback).toContain(skillHostRes.hostObj)
    } finally {
      unsubCb()
      // Reset policy snapshot for default host
      writeJsonFile(managedFile, {})
      resetAllLiveHostSettingsCaches()
      notifyStrictPluginOnlyPolicyIfChanged(undefined)
    }
  })

  test('[P1] claudemd: permission context cleanup clears ownerSession getMemoryFiles cache even outside ownerSession ALS, and withProject forks with different holds never thrash each other', async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'als-cmd-hold-')))
    tempDirs.push(workspace)
    const repoA = createRepo(workspace, 'repo-a')
    const repoB = createRepo(workspace, 'repo-b')
    const forkDir1 = join(repoA, 'pkg-1')
    const forkDir2 = join(repoA, 'pkg-2')
    mkdirSync(forkDir1, { recursive: true })
    mkdirSync(forkDir2, { recursive: true })

    writeTextFile(join(repoA, 'CLAUDE.md'), '# Root Repo A\nROOT_A_RULE\n')
    writeTextFile(join(forkDir1, 'CLAUDE.md'), '# Fork 1\nFORK_1_RULE\n')
    writeTextFile(join(forkDir2, 'CLAUDE.md'), '# Fork 2\nFORK_2_RULE\n')
    writeTextFile(join(repoB, 'CLAUDE.md'), '# Root Repo B\nROOT_B_RULE\n')

    let unregisterA!: () => void
    let ownerReady!: () => void
    const waitOwnerReady = new Promise<void>(r => {
      ownerReady = r
    })
    let cleanedOutside!: () => void
    const waitCleanedOutside = new Promise<void>(r => {
      cleanedOutside = r
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'claudemd-owner-a',
          originalCwd: repoA,
          projectRoot: repoA,
          cwd: repoA,
        },
        async sessionA => {
          // 1. Register a permission context that denies reading CLAUDE.md
          unregisterA = registerClaudeMdPermissionContextSource(() => ({
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: { userSettings: ['Read'] },
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          }))

          const deniedFiles = await getMemoryFiles()
          expect(deniedFiles.some(f => f.content.includes('ROOT_A_RULE'))).toBe(
            false,
          )
          expect(getMemoryFiles.cache.size).toBe(1)

          ownerReady()
          await waitCleanedOutside

          // Cleanup ran from Host B's ALS, yet MUST have cleared sessionA's cache!
          const cacheSizeAfterOutsideCleanup = getMemoryFiles.cache.size
          const permittedFiles = await getMemoryFiles()

          // 2. Verify two withProject forks on the same root session with different
          //    permission hold signatures do NOT thrash each other's cached entries!
          getMemoryFiles.cache.clear()
          const unregisterPerForkPerm = registerClaudeMdPermissionContextSource(
            () => {
              const current = getBootstrapSession().project.cwd
              return {
                mode: 'default',
                additionalWorkingDirectories: new Map(),
                alwaysAllowRules: {},
                // Distinct non-blocking Read deny rule per fork -> distinct hold signatures!
                alwaysDenyRules: {
                  userSettings: [
                    current === forkDir1
                      ? 'Read(/nonexistent-fork-1)'
                      : 'Read(/nonexistent-fork-2)',
                  ],
                },
                alwaysAskRules: {},
                isBypassPermissionsModeAvailable: false,
              }
            },
          )
          try {
            const fork1 = sessionA.withProject({
              originalCwd: forkDir1,
              cwd: forkDir1,
            })
            const fork2 = sessionA.withProject({
              originalCwd: forkDir2,
              cwd: forkDir2,
            })

            const p1First = runWithSession(fork1, () => getMemoryFiles())
            const f1 = await p1First
            const p2First = runWithSession(fork2, () => getMemoryFiles())
            const f2 = await p2First
            // Calling fork1 & fork2 again MUST hit the exact same cached promises without thrashing!
            const p1Second = runWithSession(fork1, () => getMemoryFiles())
            const p2Second = runWithSession(fork2, () => getMemoryFiles())

            return {
              cacheSizeAfterOutsideCleanup,
              permittedHasRootA: permittedFiles.some(f =>
                f.content.includes('ROOT_A_RULE'),
              ),
              fork1HasRule: f1.some(f => f.content.includes('FORK_1_RULE')),
              fork2HasRule: f2.some(f => f.content.includes('FORK_2_RULE')),
              fork1CacheHit: p1First === p1Second,
              fork2CacheHit: p2First === p2Second,
              forkCacheSize: getMemoryFiles.cache.size,
            }
          } finally {
            unregisterPerForkPerm()
          }
        },
      ),
      runWithNewHostSession(
        {
          id: 'claudemd-other-b',
          originalCwd: repoB,
          projectRoot: repoB,
          cwd: repoB,
        },
        async () => {
          const pB = getMemoryFiles()
          await pB
          expect(getMemoryFiles.cache.size).toBe(1)

          await waitOwnerReady
          // Invoke Host A's cleanup function from INSIDE Host B's ALS!
          unregisterA()
          cleanedOutside()

          // Host B's own cache MUST remain completely untouched!
          return {
            hostBCacheSizeAfterCleanupA: getMemoryFiles.cache.size,
            hostBCacheStillSame: getMemoryFiles() === pB,
          }
        },
      ),
    ])

    expect(resA.cacheSizeAfterOutsideCleanup).toBe(0)
    expect(resA.permittedHasRootA).toBe(true)
    expect(resA.fork1HasRule).toBe(true)
    expect(resA.fork2HasRule).toBe(true)
    expect(resA.fork1CacheHit).toBe(true)
    expect(resA.fork2CacheHit).toBe(true)
    expect(resA.forkCacheSize).toBe(2)

    expect(resB.hostBCacheSizeAfterCleanupA).toBe(1)
    expect(resB.hostBCacheStillSame).toBe(true)
  })

  test('[P1] commands.getCommands(cwd) subscribes to dynamic skills invalidation, loadSkillsDir supports global+host listeners, and skillChangeDetector isolates per host', async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'als-dyn-cmd-')))
    tempDirs.push(workspace)
    const repoA = createRepo(workspace, 'repo-a')
    const repoB = createRepo(workspace, 'repo-b')

    const nestedSkillsA = join(repoA, 'packages', 'sub', '.claude', 'skills')
    writeTextFile(
      join(nestedSkillsA, 'dynamic-alpha', 'SKILL.md'),
      '---\ndescription: Dynamic alpha skill\n---\nDynamic alpha instructions\n',
    )

    const globalObservedHosts: object[] = []
    const unsubGlobal = onDynamicSkillsLoaded(
      () => {
        globalObservedHosts.push(getBootstrapSessionHost())
      },
      { scope: 'global' },
    )

    let hostBNotified = 0
    let hostANotified = 0

    try {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession(
          {
            id: 'dyn-cmd-host-a',
            originalCwd: repoA,
            projectRoot: repoA,
            cwd: repoA,
          },
          async sessionA => {
            // Subscribe host-scoped dynamic skills listener and skillChangeDetector
            let hostAListenerCount = 0
            const unsubHostA = onDynamicSkillsLoaded(() => {
              hostAListenerCount++
            })
            const unsubSkillDetA = skillChangeDetector.subscribe(() => {
              hostANotified++
            })

            // Call ONLY getCommands(repoA) — NOT getSkillToolCommands / getSlashCommandToolSkills!
            await getCommands(repoA)

            // Seed getSkillToolCommands & getSlashCommandToolSkills caches manually
            // to prove getCommands(repoA) wired up dynamic skills invalidation!
            getSkillToolCommands.cache.set(repoA, Promise.resolve([]))
            getSlashCommandToolSkills.cache.set(repoA, Promise.resolve([]))
            expect(getSkillToolCommands.cache.size).toBe(1)
            expect(getSlashCommandToolSkills.cache.size).toBe(1)

            // Load dynamic skills -> triggers onDynamicSkillsLoaded synchronously inside Host A
            await addSkillDirectories([nestedSkillsA])

            const skillToolCacheSizeAfter = getSkillToolCommands.cache.size
            const slashSkillsCacheSizeAfter =
              getSlashCommandToolSkills.cache.size
            const dynamicNames = getDynamicSkills().map(s => s.name)
            const candidateDirsA = (
              await import('../skills/skillChangeDetector.js')
            ).getCandidateSkillDirs()

            unsubHostA()
            unsubSkillDetA()
            return {
              hostObj: sessionA.host,
              hostAListenerCount,
              skillToolCacheSizeAfter,
              slashSkillsCacheSizeAfter,
              dynamicNames,
              candidateDirsA,
            }
          },
        ),
        runWithNewHostSession(
          {
            id: 'dyn-cmd-host-b',
            originalCwd: repoB,
            projectRoot: repoB,
            cwd: repoB,
          },
          async () => {
            let hostBListenerCount = 0
            const unsubHostB = onDynamicSkillsLoaded(() => {
              hostBListenerCount++
            })
            const unsubSkillDetB = skillChangeDetector.subscribe(() => {
              hostBNotified++
            })
            getSkillToolCommands.cache.set(repoB, Promise.resolve([]))
            await tick(25)

            // Host B's per-host listeners & caches must NOT be triggered by Host A
            const hostBCacheStillSeeded = getSkillToolCommands.cache.has(repoB)
            const candidateDirsB = (
              await import('../skills/skillChangeDetector.js')
            ).getCandidateSkillDirs()

            unsubHostB()
            unsubSkillDetB()
            return {
              hostBListenerCount,
              hostBCacheStillSeeded,
              candidateDirsB,
            }
          },
        ),
      ])

      expect(resA.hostAListenerCount).toBe(1)
      expect(resA.skillToolCacheSizeAfter).toBe(0)
      expect(resA.slashSkillsCacheSizeAfter).toBe(0)
      expect(resA.dynamicNames).toContain('dynamic-alpha')
      expect(resA.candidateDirsA).toContain(join(repoA, '.claude', 'skills'))
      expect(resA.candidateDirsA).not.toContain(
        join(repoB, '.claude', 'skills'),
      )

      expect(resB.hostBListenerCount).toBe(0)
      expect(resB.hostBCacheStillSeeded).toBe(true)
      expect(resB.candidateDirsB).toContain(join(repoB, '.claude', 'skills'))
      expect(resB.candidateDirsB).not.toContain(
        join(repoA, '.claude', 'skills'),
      )
      expect(hostANotified).toBe(0)
      expect(hostBNotified).toBe(0)

      // Global listener fired inside Host A's ALS context!
      expect(globalObservedHosts).toEqual([resA.hostObj])
    } finally {
      unsubGlobal()
    }
  })

  test('[P1] getSkillIndex(cwd) -> getCommands(cwd) invalidates clearSkillIndexCache when dynamic skills load under EXPERIMENTAL_SKILL_SEARCH', async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'als-skidx-')))
    tempDirs.push(workspace)
    const repo = createRepo(workspace, 'repo-idx')
    const nestedDir = join(repo, 'packages', 'dyn', '.claude', 'skills')
    writeTextFile(
      join(nestedDir, 'late-discovered-skill', 'SKILL.md'),
      '---\ndescription: Late discovered dynamic skill for search index\n---\nInstructions\n',
    )

    const script = `
      import { getSkillIndex } from './src/services/skillSearch/localSearch.ts'
      import { addSkillDirectories } from './src/skills/loadSkillsDir.ts'
      import { getSessionAlsStore, runWithNewHostSession } from './src/utils/sessionContextAls.ts'
      import { registerSessionContextReader } from './src/utils/sessionRoot.ts'

      registerSessionContextReader(getSessionAlsStore)
      const repo = process.env.TEST_REPO!
      const nestedDir = process.env.TEST_NESTED_DIR!
      const out = await runWithNewHostSession(
        { id: 'skidx-host', originalCwd: repo, projectRoot: repo, cwd: repo },
        async () => {
          const before = await getSkillIndex(repo)
          await addSkillDirectories([nestedDir])
          const after = await getSkillIndex(repo)
          return {
            beforeHas: before.some(e => e.name === 'late-discovered-skill'),
            afterHas: after.some(e => e.name === 'late-discovered-skill'),
          }
        },
      )
      console.log(JSON.stringify(out))
    `
    const proc = Bun.spawn(
      [
        process.execPath,
        '--feature',
        'EXPERIMENTAL_SKILL_SEARCH',
        '-e',
        script,
      ],
      {
        cwd: join(import.meta.dir, '../../..'),
        env: {
          ...process.env,
          TEST_REPO: repo,
          TEST_NESTED_DIR: nestedDir,
          CLAUDE_CONFIG_DIR: configDir,
          CLAUDE_CODE_MANAGED_SETTINGS_PATH: managedDir,
          CLAUDE_CODE_USE_NATIVE_FILE_SEARCH: '1',
          USER_TYPE: 'ant',
          DISABLE_TELEMETRY: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    const parsed = JSON.parse(stdout.trim()) as {
      beforeHas: boolean
      afterHas: boolean
    }
    expect(parsed.beforeHas).toBe(false)
    expect(parsed.afterHas).toBe(true)
  }, 15000)
})
