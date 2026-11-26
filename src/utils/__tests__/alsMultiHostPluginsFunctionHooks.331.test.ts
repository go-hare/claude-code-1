/**
 * Official Claude Code 2.1.331 single-process multi-host `HostSlot` / `RootSessionSlot`
 * & `AsyncLocalStorage` isolation tests covering all 18 migrated plugin & hook modules:
 *
 *  1. `src/utils/plugins/installedPluginsManager.ts`
 *  2. `src/utils/plugins/pluginToolRegistry.ts`
 *  3. `src/utils/plugins/pluginToolSessionHost.ts`
 *  4. `src/utils/plugins/pluginToolList.ts`
 *  5. `src/utils/plugins/pluginToolLoopbackRegistrar.ts`
 *  6. `src/utils/plugins/pluginMonitors.ts`
 *  7. `src/utils/plugins/pluginSiteHold.ts`
 *  8. `src/utils/plugins/pluginOptionsStorage.ts`
 *  9. `src/utils/plugins/marketplaceManager.ts`
 * 10. `src/utils/plugins/orphanedPluginFilter.ts`
 * 11. `src/utils/plugins/pluginFlagging.ts`
 * 12. `src/utils/plugins/commandProducerDirs.ts`
 * 13. `src/utils/plugins/functionHooksClient.ts`
 * 14. `src/utils/plugins/functionHooksModules.ts`
 * 15. `src/utils/hooks/postSamplingHooks.ts`
 * 16. `src/utils/hooks/pluginHookRunner.ts`
 * 17. `src/utils/hooks/hookAsyncRewake.ts`
 * 18. `src/utils/hooks/resolveHookCwd.ts`
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetStateForTests } from '../../bootstrap/state.js'
import type { ToolUseContext } from '../../Tool.js'
import * as debugMod from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  executeInBackground,
  resetBrokenAsyncRewakeForTests,
} from '../hooks/hookAsyncRewake.js'
import {
  clearHookEventState,
  type HookExecutionEvent,
  registerHookEventHandler,
  setAllHookEventsEnabled,
} from '../hooks/hookEvents.js'
import {
  getPluginHookRunner,
  type PluginHookRunner,
  setPluginHookRunner,
} from '../hooks/pluginHookRunner.js'
import {
  clearPostSamplingHooks,
  executePostSamplingHooks,
  registerPostSamplingHook,
} from '../hooks/postSamplingHooks.js'
import {
  resetHookCwdFallbackWarningsForTests,
  resolveHookCwd,
} from '../hooks/resolveHookCwd.js'
import { dequeueAll, getCommandQueueSnapshot } from '../messageQueueManager.js'
import {
  clearCommandProducerDirsDeniedForTests,
  denyCommandProducerDir,
  emitCommandProducerDirsChanged,
  getCommandProducerDirsDenied,
  isPathUnderDeniedCommandProducer,
  subscribeCommandProducerDirsChanged,
} from '../plugins/commandProducerDirs.js'
import {
  acquirePluginClient,
  type ClientFaultReport,
  type ClientPressBridge,
  clientTerminalStamp,
  disposePluginClients,
  forgetPluginSurfaceModules,
  getPluginSurfaceModules,
  setClientFaultReporter,
  setClientMessageCancelHandler,
  setClientMessagePostHandler,
  setClientPressBridge,
  setClientTerminalSize,
  setPluginSurfaceModules,
} from '../plugins/functionHooksClient.js'
import {
  cancelClientMessage,
  clearSessionStoppedForPluginInput,
  enqueueClientMessage,
  focusPane,
  getClientMessagesDispatched,
  getHooksPassedByLines,
  getLoadedFunctionHooksModules,
  getPanesState,
  getPluginFieldSeatGenerationStore,
  getPluginInputSeatStore,
  getPluginSelectSeatStore,
  getRecordedPresses,
  getSessionTheme,
  hasMatchingFunctionHook,
  holdPress,
  invokePress,
  type LoadedFunctionHooksModule,
  markSessionStoppedForPluginInput,
  offerPlacement,
  recordHooksPassedBy,
  recordPress,
  releasePresses,
  resetHooksPassedByForTests,
  resetSessionThemeForTests,
  setLaterLoadedSessionStart,
  setLoadedFunctionHooksModules,
  setPanesState,
  settlePanesTerminalColumns,
  setToolCallHandler,
  setUiStatusHandler,
  showPane,
  subscribePanes,
  subscribeSessionTheme,
} from '../plugins/functionHooksModules.js'
import {
  addPluginInstallation,
  clearInstalledPluginsCache,
  getInFlightManagedExternalPluginFetch,
  getInMemoryInstalledPlugins,
  resetInMemoryState,
  resetMigrationState,
  scheduleManagedExternalPluginBackgroundFetch,
} from '../plugins/installedPluginsManager.js'
import {
  clearMarketplacesCache,
  getMarketplace,
} from '../plugins/marketplaceManager.js'
import {
  clearPluginCacheExclusions,
  getGlobExclusionsForPluginCache,
} from '../plugins/orphanedPluginFilter.js'
import {
  addFlaggedPlugin,
  getFlaggedPlugins,
  loadFlaggedPlugins,
  removeFlaggedPlugin,
} from '../plugins/pluginFlagging.js'
import {
  emitSkillInvoked,
  getSessionArmedMonitorKeys,
  resetSessionArmedMonitorKeysForTests,
  subscribeSkillInvoked,
} from '../plugins/pluginMonitors.js'
import {
  clearPluginOptionsCache,
  loadPluginOptions,
  loadPluginOptionsNw,
} from '../plugins/pluginOptionsStorage.js'
import {
  askedOnScreenOf,
  heldRowsOf,
  noteHeldRows,
  rememberAskedOnScreen,
  resetSiteHoldNotes,
} from '../plugins/pluginSiteHold.js'
import {
  applyPluginToolListDenyRules,
  applyPluginToolListFilter,
  getPluginToolListState,
  invalidatePluginToolList,
  recordPluginToolListAnswer,
  resetPluginToolListState,
  settlePluginToolList,
} from '../plugins/pluginToolList.js'
import {
  clearPluginToolRegistrarForTests,
  createBunPluginToolRegistrar,
  getPluginToolRegistrar,
  installPluginToolRegistrar,
} from '../plugins/pluginToolLoopbackRegistrar.js'
import {
  clearPluginToolRegistryForTests,
  forgetPluginRegisteredTools,
  getPluginRegisteredTool,
  getPluginToolServerKey,
  listPluginRegisteredTools,
  setPluginRegisteredTool,
  setPluginToolServerKey,
} from '../plugins/pluginToolRegistry.js'
import {
  getPluginToolSessionHost,
  type PluginToolSessionHost,
  setPluginToolSessionHost,
} from '../plugins/pluginToolSessionHost.js'
import type { PluginMarketplace } from '../plugins/schemas.js'
import type { ShellCommand } from '../ShellCommand.js'
import {
  getSessionAlsStore,
  runWithNewHostSession,
} from '../sessionContextAls.js'
import { registerSessionContextReader } from '../sessionRoot.js'
import type { SystemPrompt } from '../systemPromptType.js'

const tick = (ms = 8): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

function writeFileWithDirs(filePath: string, content: string): void {
  const idx = filePath.lastIndexOf('/')
  if (idx > 0) {
    mkdirSync(filePath.slice(0, idx), { recursive: true })
  }
  writeFileSync(filePath, content, 'utf8')
}

function makeFakeShellCommand(opts: {
  stdout?: string
  stderr?: string
  exitCode?: number
}): {
  shell: ShellCommand
  resolveExit: (code?: number) => void
} {
  let resolveResult!: (value: { code: number; interrupted: boolean }) => void
  const resultPromise = new Promise<{ code: number; interrupted: boolean }>(
    resolve => {
      resolveResult = resolve
    },
  )
  const stdout = opts.stdout ?? ''
  const stderr = opts.stderr ?? ''
  let status: 'running' | 'completed' | 'killed' = 'running'

  const shell = {
    get status() {
      return status
    },
    set status(next: 'running' | 'completed' | 'killed') {
      status = next
    },
    result: resultPromise,
    taskOutput: {
      getStdout: async () => stdout,
      getStderr: () => stderr,
    },
    kill: () => {
      status = 'killed'
    },
    cleanup: () => {},
  } as unknown as ShellCommand

  return {
    shell,
    resolveExit: (code = opts.exitCode ?? 0) => {
      status = 'completed'
      resolveResult({ code, interrupted: false })
    },
  }
}

describe('2.1.331 multi-host Plugins, Function Hooks & Deep Hook Utilities isolation', () => {
  const tempDirs: string[] = []
  let savedConfigDir: string | undefined

  beforeEach(() => {
    savedConfigDir = process.env.CLAUDE_CONFIG_DIR
    const isolatedHome = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-331-plug-fh-')),
    )
    tempDirs.push(isolatedHome)
    process.env.CLAUDE_CONFIG_DIR = isolatedHome
    getClaudeConfigHomeDir.cache?.clear?.()

    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
  })

  afterEach(() => {
    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    if (savedConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = savedConfigDir
    }
    getClaudeConfigHomeDir.cache?.clear?.()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('1. installedPluginsManager isolates in-memory caches and background fetch tracking per host', async () => {
    const dirA = realpathSync(mkdtempSync(join(tmpdir(), 'als-ipm-a-')))
    const dirB = realpathSync(mkdtempSync(join(tmpdir(), 'als-ipm-b-')))
    tempDirs.push(dirA, dirB)

    let releaseFetchA!: () => void
    const fetchAGate = new Promise<void>(resolve => {
      releaseFetchA = resolve
    })
    let releaseFetchB!: () => void
    const fetchBGate = new Promise<void>(resolve => {
      releaseFetchB = resolve
    })

    const candidate = {
      pluginId: 'shared-ext@mkt',
      entry: { name: 'shared-ext' },
      marketplaceInstallLocation: dirA,
      marketplaceSource: undefined,
    }

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-ipm-a', cwd: dirA }, async () => {
        clearInstalledPluginsCache()
        resetMigrationState()
        addPluginInstallation('plug-a@mkt', 'user', join(dirA, 'a-v1'), {
          version: '1.0.0',
        })
        const snapBefore = getInMemoryInstalledPlugins()
        expect(snapBefore.plugins['plug-a@mkt']).toHaveLength(1)

        let fetchACalls = 0
        const pA = scheduleManagedExternalPluginBackgroundFetch([candidate], {
          fetcher: async () => {
            fetchACalls++
            await fetchAGate
            return false
          },
        })
        expect(pA).toBeDefined()
        expect(getInFlightManagedExternalPluginFetch()).toBe(pA)

        await tick(15)
        // Clearing Host A's in-memory state must not affect Host B
        resetInMemoryState()
        clearInstalledPluginsCache()
        releaseFetchA()
        await pA
        return {
          fetchACalls,
          inFlightAfter: getInFlightManagedExternalPluginFetch(),
        }
      }),
      runWithNewHostSession({ id: 'host-ipm-b', cwd: dirB }, async () => {
        await tick(5)
        // Host B must not see Host A's in-flight promise or dedup set
        expect(getInFlightManagedExternalPluginFetch()).toBeUndefined()

        let fetchBCalls = 0
        const pB = scheduleManagedExternalPluginBackgroundFetch([candidate], {
          fetcher: async () => {
            fetchBCalls++
            await fetchBGate
            return false
          },
        })
        expect(pB).toBeDefined()
        expect(getInFlightManagedExternalPluginFetch()).toBe(pB)

        const snapB = getInMemoryInstalledPlugins()
        // Wait while Host A clears its cache
        await tick(20)
        // Host B's cached snapshot object reference remains intact (not cleared by Host A)
        expect(getInMemoryInstalledPlugins()).toBe(snapB)

        releaseFetchB()
        await pB
        return {
          fetchBCalls,
          inFlightAfter: getInFlightManagedExternalPluginFetch(),
        }
      }),
    ])

    expect(resA.fetchACalls).toBe(1)
    expect(resB.fetchBCalls).toBe(1)
    expect(resA.inFlightAfter).toBeUndefined()
    expect(resB.inFlightAfter).toBeUndefined()
  })

  test('2-5. pluginToolRegistry, pluginToolSessionHost, pluginToolList & pluginToolLoopbackRegistrar are isolated per host', async () => {
    const dirA = realpathSync(mkdtempSync(join(tmpdir(), 'als-ptool-a-')))
    const dirB = realpathSync(mkdtempSync(join(tmpdir(), 'als-ptool-b-')))
    tempDirs.push(dirA, dirB)

    const [outA, outB] = await Promise.all([
      runWithNewHostSession({ id: 'host-ptool-a', cwd: dirA }, async () => {
        const hostObjA: PluginToolSessionHost = {
          addMcpServer: () => {},
          tools: () => [{ name: 'ToolA' }],
          mcpServers: () => ['srv-a'],
        }
        setPluginToolSessionHost(hostObjA)
        setPluginRegisteredTool('plug-shared', {
          name: 'alpha_tool',
          description: 'Alpha tool',
          inputSchema: { type: 'object' },
        })
        setPluginToolServerKey('plug-shared', 'key-a')

        const answerA = await settlePluginToolList(
          ['Bash', 'Read', 'WebFetch'],
          async base => {
            await tick(10)
            return base.filter(t => t !== 'Bash')
          },
        )
        expect([...answerA.removed]).toEqual(['Bash'])

        installPluginToolRegistrar(createBunPluginToolRegistrar())
        const regA = getPluginToolRegistrar()
        expect(regA).toBeDefined()
        const dynA = regA!(
          'plug-shared',
          listPluginRegisteredTools('plug-shared'),
        )

        await tick(15)
        // Still sees only Host A state after Host B mutated its own state
        expect(getPluginToolSessionHost()).toBe(hostObjA)
        expect(
          getPluginRegisteredTool('plug-shared', 'alpha_tool')?.description,
        ).toBe('Alpha tool')
        expect(
          getPluginRegisteredTool('plug-shared', 'beta_tool'),
        ).toBeUndefined()
        expect(getPluginToolServerKey('plug-shared')).toBe('key-a')
        expect(
          applyPluginToolListFilter([
            { name: 'Bash' },
            { name: 'Read' },
            { name: 'WebFetch' },
          ]).map(t => t.name),
        ).toEqual(['Read', 'WebFetch'])
        expect(
          applyPluginToolListDenyRules({
            alwaysDenyRules: { session: [] as string[] },
          }).alwaysDenyRules?.session,
        ).toEqual(['Bash'])

        // Verify Host A's loopback server responds cleanly and clearing Host A does not affect Host B
        const listBeforeClear = listPluginRegisteredTools('plug-shared').map(
          t => t.name,
        )
        clearPluginToolRegistryForTests()
        resetPluginToolListState()
        clearPluginToolRegistrarForTests()
        setPluginToolSessionHost(undefined)

        return {
          listBeforeClear,
          urlA: dynA.config.type === 'http' ? dynA.config.url : '',
          afterClearKey: getPluginToolServerKey('plug-shared'),
        }
      }),
      runWithNewHostSession({ id: 'host-ptool-b', cwd: dirB }, async () => {
        const hostObjB: PluginToolSessionHost = {
          addMcpServer: () => {},
          tools: () => [{ name: 'ToolB' }],
          mcpServers: () => ['srv-b'],
        }
        setPluginToolSessionHost(hostObjB)
        setPluginRegisteredTool('plug-shared', {
          name: 'beta_tool',
          description: 'Beta tool',
          inputSchema: { type: 'object' },
        })
        setPluginToolServerKey('plug-shared', 'key-b')

        recordPluginToolListAnswer(
          ['Bash', 'Read', 'WebFetch'],
          ['Bash', 'Read'],
        )
        installPluginToolRegistrar(createBunPluginToolRegistrar())
        const regB = getPluginToolRegistrar()
        expect(regB).toBeDefined()
        const dynB = regB!(
          'plug-shared',
          listPluginRegisteredTools('plug-shared'),
        )

        // Wait until AFTER Host A has called all its clear/reset functions
        await tick(35)

        expect(getPluginToolSessionHost()).toBe(hostObjB)
        expect(
          getPluginRegisteredTool('plug-shared', 'beta_tool')?.description,
        ).toBe('Beta tool')
        expect(
          getPluginRegisteredTool('plug-shared', 'alpha_tool'),
        ).toBeUndefined()
        expect(getPluginToolServerKey('plug-shared')).toBe('key-b')
        expect(getPluginToolRegistrar()).toBe(regB)
        expect([...(getPluginToolListState().answer?.removed ?? [])]).toEqual([
          'WebFetch',
        ])
        expect(
          applyPluginToolListFilter([
            { name: 'Bash' },
            { name: 'Read' },
            { name: 'WebFetch' },
          ]).map(t => t.name),
        ).toEqual(['Bash', 'Read'])

        // Invalidate & forget in Host B cleanly
        invalidatePluginToolList()
        expect(getPluginToolListState().isInvalidated).toBe(true)
        const forgottenKey = forgetPluginRegisteredTools('plug-shared')
        clearPluginToolRegistrarForTests()
        setPluginToolSessionHost(undefined)

        return {
          forgottenKey,
          urlB: dynB.config.type === 'http' ? dynB.config.url : '',
        }
      }),
    ])

    expect(outA.listBeforeClear).toEqual(['alpha_tool'])
    expect(outA.afterClearKey).toBeUndefined()
    expect(outB.forgottenKey).toBe('key-b')
    expect(outA.urlA).not.toBe('')
    expect(outB.urlB).not.toBe('')
    // Distinct loopback server ports/URLs per host
    expect(outA.urlA).not.toBe(outB.urlB)
  })

  test('6-9. pluginMonitors, pluginSiteHold, pluginOptionsStorage & marketplaceManager caches are isolated per host/session', async () => {
    const dirA = realpathSync(mkdtempSync(join(tmpdir(), 'als-misc-a-')))
    const dirB = realpathSync(mkdtempSync(join(tmpdir(), 'als-misc-b-')))
    tempDirs.push(dirA, dirB)

    const fakeMarketA: PluginMarketplace = {
      name: 'shared-mkt',
      owner: { name: 'owner-a' },
      plugins: [],
    }
    const fakeMarketB: PluginMarketplace = {
      name: 'shared-mkt',
      owner: { name: 'owner-b' },
      plugins: [],
    }

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-misc-a', cwd: dirA }, async () => {
        const heardA: string[] = []
        const unsub = subscribeSkillInvoked(s => heardA.push(s))
        getSessionArmedMonitorKeys().add('plug:mon-a')

        rememberAskedOnScreen('site-1', { first: 0, last: 10, of: 100 })
        noteHeldRows('site-1', null, 4)

        loadPluginOptions.cache.set('plug-x@mkt', { apiKey: 'secret-a' })
        const nwPromiseA = loadPluginOptionsNw('plug-nw@mkt')
        getMarketplace.cache.set('shared-mkt', Promise.resolve(fakeMarketA))

        emitSkillInvoked('skill-a')
        await tick(12)

        expect(askedOnScreenOf('site-1')).toEqual({
          first: 0,
          last: 10,
          of: 100,
        })
        expect(heldRowsOf('site-1')).toBe(4)
        expect(loadPluginOptions('plug-x@mkt')).toEqual({ apiKey: 'secret-a' })
        expect(await getMarketplace('shared-mkt')).toBe(fakeMarketA)

        // Reset/clear everything in Host A while Host B is still alive
        resetSessionArmedMonitorKeysForTests()
        resetSiteHoldNotes()
        clearPluginOptionsCache()
        clearMarketplacesCache()
        unsub()
        await nwPromiseA.catch(() => {})
        return { heardA }
      }),
      runWithNewHostSession({ id: 'host-misc-b', cwd: dirB }, async () => {
        const heardB: string[] = []
        const unsub = subscribeSkillInvoked(s => heardB.push(s))
        getSessionArmedMonitorKeys().add('plug:mon-b')

        rememberAskedOnScreen('site-1', { first: 20, last: 40, of: 200 })
        noteHeldRows('site-1', null, 9)

        loadPluginOptions.cache.set('plug-x@mkt', { apiKey: 'secret-b' })
        const nwPromiseB = loadPluginOptionsNw('plug-nw@mkt')
        getMarketplace.cache.set('shared-mkt', Promise.resolve(fakeMarketB))

        emitSkillInvoked('skill-b')
        // Wait past Host A's clears/resets
        await tick(25)

        expect([...getSessionArmedMonitorKeys()]).toEqual(['plug:mon-b'])
        expect(askedOnScreenOf('site-1')).toEqual({
          first: 20,
          last: 40,
          of: 200,
        })
        expect(heldRowsOf('site-1')).toBe(9)
        expect(loadPluginOptions('plug-x@mkt')).toEqual({ apiKey: 'secret-b' })
        expect(await getMarketplace('shared-mkt')).toBe(fakeMarketB)
        // Promise cache still holds Host B's memoized promise
        expect(loadPluginOptionsNw('plug-nw@mkt')).toBe(nwPromiseB)

        unsub()
        await nwPromiseB.catch(() => {})
        return { heardB }
      }),
    ])

    expect(resA.heardA).toEqual(['skill-a'])
    expect(resB.heardB).toEqual(['skill-b'])
  })

  test('10-12. orphanedPluginFilter, pluginFlagging & commandProducerDirs isolate caches and listeners per host', async () => {
    const dirA = realpathSync(mkdtempSync(join(tmpdir(), 'als-fpc-a-')))
    const dirB = realpathSync(mkdtempSync(join(tmpdir(), 'als-fpc-b-')))
    tempDirs.push(dirA, dirB)

    const cacheRoot = join(getClaudeConfigHomeDir(), 'plugins', 'cache')
    writeFileWithDirs(
      join(cacheRoot, 'mkt', 'plug', '1.0.0', '.orphaned_at'),
      '1',
    )

    // Host A warms its orphanedPluginFilter cache (only 1.0.0 exists on disk)
    let releaseA!: () => void
    const aWarmed = new Promise<void>(resolve => {
      releaseA = resolve
    })
    let releaseBCheck!: () => void
    const bAddedOrphan2 = new Promise<void>(resolve => {
      releaseBCheck = resolve
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-fpc-a', cwd: dirA }, async () => {
        const ex1 = await getGlobExclusionsForPluginCache()
        expect(ex1).toEqual(['!**/mkt/plug/1.0.0/**'])

        await addFlaggedPlugin('flagged-a@mkt')
        expect(Object.keys(getFlaggedPlugins())).toContain('flagged-a@mkt')

        let dirChangesA = 0
        const unsub = subscribeCommandProducerDirsChanged(() => {
          dirChangesA++
        })
        denyCommandProducerDir(join(dirA, 'denied-a'))
        expect(dirChangesA).toBe(1)

        releaseA()
        await bAddedOrphan2

        // Even after v2 orphan appeared and Host B computed exclusions, Host A keeps its frozen snapshot
        const exStill = await getGlobExclusionsForPluginCache()
        expect(exStill).toEqual(['!**/mkt/plug/1.0.0/**'])
        expect(
          isPathUnderDeniedCommandProducer(join(dirA, 'denied-a', 'bin')),
        ).toBe(true)
        expect(
          isPathUnderDeniedCommandProducer(join(dirB, 'denied-b', 'bin')),
        ).toBe(false)

        // Clearing Host A's state must not disturb Host B
        clearPluginCacheExclusions()
        clearCommandProducerDirsDeniedForTests()
        await removeFlaggedPlugin('flagged-a@mkt')
        unsub()
        return { dirChangesA }
      }),
      runWithNewHostSession({ id: 'host-fpc-b', cwd: dirB }, async () => {
        await aWarmed

        // Before Host B loads or writes flagged plugins, its in-memory cache is empty
        expect(getFlaggedPlugins()).toEqual({})

        // Add second orphan on disk before Host B warms its own cache
        writeFileWithDirs(
          join(cacheRoot, 'mkt', 'plug', '2.0.0', '.orphaned_at'),
          '2',
        )
        const exB = await getGlobExclusionsForPluginCache()
        expect(exB.slice().sort()).toEqual([
          '!**/mkt/plug/1.0.0/**',
          '!**/mkt/plug/2.0.0/**',
        ])

        await loadFlaggedPlugins()
        expect(Object.keys(getFlaggedPlugins())).toContain('flagged-a@mkt')

        let dirChangesB = 0
        const unsub = subscribeCommandProducerDirsChanged(() => {
          dirChangesB++
        })
        denyCommandProducerDir(join(dirB, 'denied-b'))
        emitCommandProducerDirsChanged()
        expect(dirChangesB).toBe(2)

        releaseBCheck()
        await tick(20)

        // Host A cleared its caches & removed flagged-a@mkt, but Host B's in-memory caches stay intact
        expect(
          (await getGlobExclusionsForPluginCache()).slice().sort(),
        ).toEqual(['!**/mkt/plug/1.0.0/**', '!**/mkt/plug/2.0.0/**'])
        expect(Object.keys(getFlaggedPlugins())).toContain('flagged-a@mkt')
        expect([...getCommandProducerDirsDenied()]).toHaveLength(1)
        expect(
          isPathUnderDeniedCommandProducer(join(dirB, 'denied-b', 'bin')),
        ).toBe(true)
        unsub()
        return { dirChangesB }
      }),
    ])

    expect(resA.dirChangesA).toBe(1)
    expect(resB.dirChangesB).toBe(2)
  })

  test('13. functionHooksClient isolates terminal size, surface modules, handlers, press bridge overrides, and client instances per session', async () => {
    const dirA = realpathSync(mkdtempSync(join(tmpdir(), 'als-fhc-a-')))
    const dirB = realpathSync(mkdtempSync(join(tmpdir(), 'als-fhc-b-')))
    tempDirs.push(dirA, dirB)

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-fhc-a', cwd: dirA }, async () => {
        const faultsA: ClientFaultReport[] = []
        const postsA: string[] = []
        const cancelsA: string[] = []
        const holdsA: string[] = []

        const bridgeA: ClientPressBridge = {
          hold: (plugin: string) => {
            holdsA.push(plugin)
            return 101
          },
          release: () => {},
          forget: () => {},
        }

        setClientTerminalSize({
          columns: 80,
          rows: 24,
          conversationColumns: 72,
        })
        setClientFaultReporter(r => faultsA.push(r))
        setClientMessagePostHandler(post => postsA.push(post.id))
        setClientMessageCancelHandler(id => cancelsA.push(id))
        setClientPressBridge(bridgeA)
        const panelSource = `export function Panel(props) { return { type: 'Box', children: [String(props?.label ?? '')] } }`
        const panelPathA = join(dirA, 'panel.js')
        writeFileWithDirs(panelPathA, panelSource)
        setPluginSurfaceModules('plug-ui', dirA, [
          {
            module: './panel',
            modulePath: panelPathA,
            component: 'Panel',
            source: panelSource,
          },
        ])

        const clientA = acquirePluginClient({
          plugin: 'plug-ui',
          key: 'k1',
          module: './panel',
          props: { label: 'A' },
        })

        await tick(15)
        expect(clientTerminalStamp()).toBe('80x24x72')
        expect(getPluginSurfaceModules('plug-ui')?.root).toBe(dirA)

        // Dispose/forget in Session A must not dispose Session B
        disposePluginClients()
        forgetPluginSurfaceModules('plug-ui')
        setClientTerminalSize(undefined)
        setClientPressBridge(undefined)
        return {
          clientAId: clientA.id,
          faultCountA: faultsA.length,
          postCountA: postsA.length,
          cancelCountA: cancelsA.length,
        }
      }),
      runWithNewHostSession({ id: 'host-fhc-b', cwd: dirB }, async () => {
        const faultsB: ClientFaultReport[] = []
        const holdsB: string[] = []
        const bridgeB: ClientPressBridge = {
          hold: (plugin: string) => {
            holdsB.push(plugin)
            return 202
          },
          release: () => {},
          forget: () => {},
        }

        setClientTerminalSize({
          columns: 140,
          rows: 45,
          conversationColumns: 130,
        })
        setClientFaultReporter(r => faultsB.push(r))
        setClientPressBridge(bridgeB)
        const panelSource = `export function Panel(props) { return { type: 'Box', children: [String(props?.label ?? '')] } }`
        const panelPathB = join(dirB, 'panel.js')
        writeFileWithDirs(panelPathB, panelSource)
        setPluginSurfaceModules('plug-ui', dirB, [
          {
            module: './panel',
            modulePath: panelPathB,
            component: 'Panel',
            source: panelSource,
          },
        ])

        const clientB = acquirePluginClient({
          plugin: 'plug-ui',
          key: 'k1',
          module: './panel',
          props: { label: 'B' },
        })
        let clientBUpdates = 0
        const unsubClientB = clientB.subscribe(() => {
          clientBUpdates++
        })

        // Wait past Session A's dispose/forget and until clientB finishes mounting
        await tick(30)
        for (
          let i = 0;
          i < 30 && clientB.getSnapshot().status === 'loading';
          i++
        ) {
          await tick(5)
        }
        expect(clientB.getSnapshot().status).toBe('drawn')
        expect(clientTerminalStamp()).toBe('140x45x130')
        expect(getPluginSurfaceModules('plug-ui')?.root).toBe(dirB)
        // Re-acquiring the same key in Session B attaches to the same live record
        // (not destroyed by Session A's disposePluginClients())
        const clientBAgain = acquirePluginClient({
          plugin: 'plug-ui',
          key: 'k1',
          module: './panel',
          props: { label: 'B-updated' },
        })
        expect(clientBAgain.id).toBe(clientB.id)
        const beforeThrew = clientBUpdates
        clientBAgain.threw(new Error('isolated-b-fault'))
        expect(clientBUpdates).toBeGreaterThan(beforeThrew)
        expect(clientB.getSnapshot().status).toBe('failed')

        unsubClientB()
        disposePluginClients()
        forgetPluginSurfaceModules('plug-ui')
        setClientTerminalSize(undefined)
        setClientPressBridge(undefined)
        return {
          clientBId: clientB.id,
          sharedLiveRecord: clientBUpdates > beforeThrew,
          faultCountB: faultsB.length,
        }
      }),
    ])

    expect(resA.clientAId).toBe(resB.clientBId)
    expect(resB.sharedLiveRecord).toBe(true)
    expect(resA.faultCountA).toBe(0)
    expect(resB.faultCountB).toBeGreaterThanOrEqual(1)
  })

  test('14. functionHooksModules isolates loaded modules, panes, presses, handlers, theme, stores, and coalesced client message drains per session', async () => {
    const dirA = realpathSync(mkdtempSync(join(tmpdir(), 'als-fhm-a-')))
    const dirB = realpathSync(mkdtempSync(join(tmpdir(), 'als-fhm-b-')))
    tempDirs.push(dirA, dirB)

    const makeMod = (
      pluginName: string,
      pattern: string,
      tag: string,
    ): LoadedFunctionHooksModule => ({
      name: pluginName,
      patterns: [pattern, 'ui.message'],
      hooks: [
        {
          pattern,
          hook: async () => ({ handledBy: tag }),
        },
        {
          pattern: 'ui.message',
          hook: async (_api, event) => ({
            echoFrom: tag,
            seen: event.data,
          }),
        },
      ],
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-fhm-a', cwd: dirA }, async () => {
        const laterLoadedA: string[] = []
        setLaterLoadedSessionStart(mods => {
          laterLoadedA.push(...mods.map(m => m.name))
        })
        setUiStatusHandler(() => {})
        setToolCallHandler(async () => ({ ok: 'A' }))

        const modA = makeMod('shared-plug', 'tool.alpha', 'session-A')
        setLoadedFunctionHooksModules([modA])

        recordHooksPassedBy({
          event: 'tool.alpha',
          by: 'shared-plug',
          plugins: ['other-a'],
        })

        // Panes store + subscribers
        let paneEventsA = 0
        const unsubPane = subscribePanes(() => {
          paneEventsA++
        })
        const stopOffer = offerPlacement()
        settlePanesTerminalColumns(100, 30)
        setPanesState(prev => ({
          ...prev,
          open: [
            {
              id: 'pane-a',
              plugin: 'shared-plug',
              title: 'Pane A',
            },
          ],
        }))
        showPane('pane-a')
        focusPane('pane-a')

        // Press handlers + recorded presses
        const pressCallsA: unknown[] = []
        holdPress('env-1', 'h-1', ev => {
          pressCallsA.push(ev)
          return 'pressed-A'
        })
        recordPress('env-1', 'h-1', { kind: 'click-A' })

        // Theme listener & session stopped marker
        let themeEventsA = 0
        const unsubTheme = subscribeSessionTheme(() => {
          themeEventsA++
        })
        markSessionStoppedForPluginInput()

        // Coalesced client message drain restores Session A via runWithSession on setTimeout
        const replyA = await new Promise<unknown>(resolve => {
          enqueueClientMessage(
            {
              id: 'inst-shared',
              plugin: 'shared-plug',
              surface: 'terminal',
              component: 'panel',
              requestId: 'req-a',
              element: 'btn',
              module: './panel',
              data: 'payload-A',
            },
            resolve,
          )
        })

        const invokedA = await invokePress('env-1', 'h-1', { x: 1 })

        expect(getLoadedFunctionHooksModules().map(m => m.name)).toEqual([
          'shared-plug',
        ])
        expect(hasMatchingFunctionHook('tool.alpha', {})).toBe(true)
        expect(hasMatchingFunctionHook('tool.beta', {})).toBe(false)
        expect(getHooksPassedByLines().map(l => l.by)).toEqual(['shared-plug'])
        expect(getPanesState().shownId).toBe('pane-a')
        expect(getPanesState().focusedId).toBe('pane-a')
        expect(getRecordedPresses()).toHaveLength(1)
        expect(getClientMessagesDispatched()).toBe(1)

        const seatStoresA = {
          input: getPluginInputSeatStore(),
          select: getPluginSelectSeatStore(),
          gen: getPluginFieldSeatGenerationStore(),
        }

        // Cleanup in Session A must not disturb Session B
        resetHooksPassedByForTests()
        resetSessionThemeForTests()
        clearSessionStoppedForPluginInput()
        releasePresses('env-1', ['h-1'])
        cancelClientMessage('nonexistent')
        stopOffer()
        unsubPane()
        unsubTheme()
        setLaterLoadedSessionStart(undefined)

        return {
          laterLoadedA,
          paneEventsA,
          themeEventsA,
          pressCallsA,
          invokedA,
          replyA,
          seatStoresA,
          themeA: getSessionTheme(),
        }
      }),
      runWithNewHostSession({ id: 'host-fhm-b', cwd: dirB }, async () => {
        const laterLoadedB: string[] = []
        setLaterLoadedSessionStart(mods => {
          laterLoadedB.push(...mods.map(m => m.name))
        })
        setUiStatusHandler(() => {})
        setToolCallHandler(async () => ({ ok: 'B' }))

        const modB = makeMod('shared-plug', 'tool.beta', 'session-B')
        setLoadedFunctionHooksModules([modB])

        recordHooksPassedBy({
          event: 'tool.beta',
          by: 'shared-plug',
          plugins: ['other-b'],
        })

        let paneEventsB = 0
        const unsubPane = subscribePanes(() => {
          paneEventsB++
        })
        const stopOffer = offerPlacement()
        settlePanesTerminalColumns(120, 40)
        setPanesState(prev => ({
          ...prev,
          open: [
            {
              id: 'pane-b',
              plugin: 'shared-plug',
              title: 'Pane B',
            },
          ],
        }))
        showPane('pane-b')
        focusPane('pane-b')

        const pressCallsB: unknown[] = []
        holdPress('env-1', 'h-1', ev => {
          pressCallsB.push(ev)
          return 'pressed-B'
        })
        recordPress('env-1', 'h-1', { kind: 'click-B' })

        const replyB = await new Promise<unknown>(resolve => {
          enqueueClientMessage(
            {
              id: 'inst-shared',
              plugin: 'shared-plug',
              surface: 'terminal',
              component: 'panel',
              requestId: 'req-b',
              element: 'btn',
              module: './panel',
              data: 'payload-B',
            },
            resolve,
          )
        })

        // Wait past Session A's resets
        await tick(25)

        const invokedB = await invokePress('env-1', 'h-1', { x: 2 })
        expect(hasMatchingFunctionHook('tool.beta', {})).toBe(true)
        expect(hasMatchingFunctionHook('tool.alpha', {})).toBe(false)
        expect(getHooksPassedByLines().map(l => l.event)).toEqual(['tool.beta'])
        expect(getPanesState().shownId).toBe('pane-b')
        expect(getPanesState().focusedId).toBe('pane-b')
        expect(getRecordedPresses()).toHaveLength(1)
        expect(getClientMessagesDispatched()).toBe(1)

        const seatStoresB = {
          input: getPluginInputSeatStore(),
          select: getPluginSelectSeatStore(),
          gen: getPluginFieldSeatGenerationStore(),
        }

        stopOffer()
        unsubPane()
        setLaterLoadedSessionStart(undefined)

        return {
          laterLoadedB,
          paneEventsB,
          pressCallsB,
          invokedB,
          replyB,
          seatStoresB,
        }
      }),
    ])

    expect(resA.laterLoadedA).toEqual(['shared-plug'])
    expect(resB.laterLoadedB).toEqual(['shared-plug'])
    expect(resA.invokedA).toBe('pressed-A')
    expect(resB.invokedB).toBe('pressed-B')
    expect(resA.pressCallsA).toEqual([{ x: 1 }])
    expect(resB.pressCallsB).toEqual([{ x: 2 }])
    expect(resA.replyA).toEqual({ echoFrom: 'session-A', seen: 'payload-A' })
    expect(resB.replyB).toEqual({ echoFrom: 'session-B', seen: 'payload-B' })
    // Distinct per-session seat stores
    expect(resA.seatStoresA.input).not.toBe(resB.seatStoresB.input)
    expect(resA.seatStoresA.select).not.toBe(resB.seatStoresB.select)
    expect(resA.seatStoresA.gen).not.toBe(resB.seatStoresB.gen)
  })

  test('15-16. postSamplingHooks and pluginHookRunner are isolated across concurrent hosts/sessions', async () => {
    const dirA = realpathSync(mkdtempSync(join(tmpdir(), 'als-psh-a-')))
    const dirB = realpathSync(mkdtempSync(join(tmpdir(), 'als-psh-b-')))
    tempDirs.push(dirA, dirB)

    const fakeToolUseContext = {} as unknown as ToolUseContext
    const fakeSystemPrompt = [] as unknown as SystemPrompt

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-psh-a', cwd: dirA }, async () => {
        const ranA: string[] = []
        const runnerA: PluginHookRunner = {
          holds: id => id === 'plug-a',
        }
        setPluginHookRunner(runnerA)
        registerPostSamplingHook(async () => {
          await tick(5)
          ranA.push('hook-A')
        })

        await tick(10)
        await executePostSamplingHooks(
          [],
          fakeSystemPrompt,
          {},
          {},
          fakeToolUseContext,
        )
        const holdsA = getPluginHookRunner()?.holds?.('plug-a')
        clearPostSamplingHooks()
        setPluginHookRunner(undefined)
        return { ranA, holdsA }
      }),
      runWithNewHostSession({ id: 'host-psh-b', cwd: dirB }, async () => {
        const ranB: string[] = []
        const runnerB: PluginHookRunner = {
          holds: id => id === 'plug-b',
        }
        setPluginHookRunner(runnerB)
        registerPostSamplingHook(async () => {
          await tick(5)
          ranB.push('hook-B')
        })

        // Wait until AFTER Host A cleared its postSamplingHooks & pluginHookRunner
        await tick(25)
        await executePostSamplingHooks(
          [],
          fakeSystemPrompt,
          {},
          {},
          fakeToolUseContext,
        )
        const holdsB = getPluginHookRunner()?.holds?.('plug-b')
        const holdsAOnB = getPluginHookRunner()?.holds?.('plug-a')
        clearPostSamplingHooks()
        setPluginHookRunner(undefined)
        return { ranB, holdsB, holdsAOnB }
      }),
    ])

    expect(resA.ranA).toEqual(['hook-A'])
    expect(resB.ranB).toEqual(['hook-B'])
    expect(resA.holdsA).toBe(true)
    expect(resB.holdsB).toBe(true)
    expect(resB.holdsAOnB).toBe(false)
  })

  test('17. hookAsyncRewake restores originating ALS session and isolates broken-script dedup per host', async () => {
    const dirA = realpathSync(mkdtempSync(join(tmpdir(), 'als-rewake-a-')))
    const dirB = realpathSync(mkdtempSync(join(tmpdir(), 'als-rewake-b-')))
    tempDirs.push(dirA, dirB)

    const missingScript = join(dirA, 'missing-hook.sh')
    const missingErr = `bash: ${missingScript}: No such file or directory\n`

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-rewake-a', cwd: dirA }, async () => {
        resetBrokenAsyncRewakeForTests()
        dequeueAll()
        clearHookEventState()
        setAllHookEventsEnabled(true)
        const eventsA: HookExecutionEvent[] = []
        registerHookEventHandler(ev => eventsA.push(ev))

        // First missing-script failure in Host A -> enqueues notification
        const firstA = makeFakeShellCommand({ stderr: missingErr, exitCode: 2 })
        executeInBackground({
          processId: 'proc-a-1',
          hookId: 'hook-a-1',
          shellCommand: firstA.shell,
          asyncResponse: { async: true },
          hookEvent: 'PostToolUse',
          hookName: 'rewake-test',
          command: `bash ${missingScript}`,
          asyncRewake: true,
        })
        firstA.resolveExit(2)
        await tick(20)
        const afterFirstA = getCommandQueueSnapshot().length

        // Second identical missing-script failure in Host A -> deduplicated in Host A only!
        const secondA = makeFakeShellCommand({
          stderr: missingErr,
          exitCode: 2,
        })
        executeInBackground({
          processId: 'proc-a-2',
          hookId: 'hook-a-2',
          shellCommand: secondA.shell,
          asyncResponse: { async: true },
          hookEvent: 'PostToolUse',
          hookName: 'rewake-test',
          command: `bash ${missingScript}`,
          asyncRewake: true,
        })
        secondA.resolveExit(2)
        await tick(20)
        const afterSecondA = getCommandQueueSnapshot().length

        clearHookEventState()
        dequeueAll()
        return {
          afterFirstA,
          afterSecondA,
          hookIdsA: eventsA.map(e => e.hookId),
        }
      }),
      runWithNewHostSession({ id: 'host-rewake-b', cwd: dirB }, async () => {
        resetBrokenAsyncRewakeForTests()
        dequeueAll()
        clearHookEventState()
        setAllHookEventsEnabled(true)
        const eventsB: HookExecutionEvent[] = []
        registerHookEventHandler(ev => eventsB.push(ev))

        // Wait until Host A has already recorded & deduplicated the identical missing script
        await tick(30)

        // Host B's first missing-script failure for the EXACT SAME script must NOT be suppressed by Host A!
        const firstB = makeFakeShellCommand({ stderr: missingErr, exitCode: 2 })
        executeInBackground({
          processId: 'proc-b-1',
          hookId: 'hook-b-1',
          shellCommand: firstB.shell,
          asyncResponse: { async: true },
          hookEvent: 'PostToolUse',
          hookName: 'rewake-test',
          command: `bash ${missingScript}`,
          asyncRewake: true,
        })
        firstB.resolveExit(2)
        await tick(20)
        const afterFirstB = getCommandQueueSnapshot().length

        clearHookEventState()
        dequeueAll()
        return {
          afterFirstB,
          hookIdsB: eventsB.map(e => e.hookId),
        }
      }),
    ])

    expect(resA.afterFirstA).toBe(1)
    expect(resA.afterSecondA).toBe(1)
    expect(resB.afterFirstB).toBe(1)
    expect(resA.hookIdsA).toEqual(['hook-a-1', 'hook-a-2'])
    expect(resB.hookIdsB).toEqual(['hook-b-1'])
  })

  test('18. resolveHookCwd isolates once-per-missing-cwd warnings per host', async () => {
    const dirA = realpathSync(mkdtempSync(join(tmpdir(), 'als-cwd-a-')))
    const dirB = realpathSync(mkdtempSync(join(tmpdir(), 'als-cwd-b-')))
    tempDirs.push(dirA, dirB)

    const missingDir = join(tmpdir(), `als-missing-cwd-${Date.now()}`)
    const loggedWarnings: string[] = []
    const debugSpy = spyOn(debugMod, 'logForDebugging').mockImplementation(
      (msg: string) => {
        if (msg.includes(missingDir)) {
          loggedWarnings.push(msg)
        }
      },
    )

    try {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'host-cwd-a', cwd: dirA }, async () => {
          resetHookCwdFallbackWarningsForTests()
          const r1 = await resolveHookCwd(missingDir, { originalCwd: dirA })
          const r2 = await resolveHookCwd(missingDir, { originalCwd: dirA })
          await tick(15)
          return { r1, r2 }
        }),
        runWithNewHostSession({ id: 'host-cwd-b', cwd: dirB }, async () => {
          resetHookCwdFallbackWarningsForTests()
          await tick(5)
          const r1 = await resolveHookCwd(missingDir, { originalCwd: dirB })
          const r2 = await resolveHookCwd(missingDir, { originalCwd: dirB })
          return { r1, r2 }
        }),
      ])

      expect(resA.r1).toBe(dirA)
      expect(resA.r2).toBe(dirA)
      expect(resB.r1).toBe(dirB)
      expect(resB.r2).toBe(dirB)
      // Each host warns exactly once for the same missing cwd (2 total: 1 for Host A, 1 for Host B)
      expect(loggedWarnings).toHaveLength(2)
      expect(loggedWarnings.some(m => m.includes(dirA))).toBe(true)
      expect(loggedWarnings.some(m => m.includes(dirB))).toBe(true)
    } finally {
      debugSpy.mockRestore()
    }
  })
})
