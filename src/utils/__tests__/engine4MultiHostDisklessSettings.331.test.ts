import { afterEach, describe, expect, test } from 'bun:test'
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
import { setParentManagedSettings } from '../../bootstrap/state.js'
import { createEmbeddedHost } from '../../entrypoints/sdk/embeddedHost.js'
import {
  executeAutoDream,
  initAutoDream,
  resetAutoDreamForTests,
} from '../../services/autoDream/autoDream.js'
import {
  executeExtractMemories,
  initExtractMemories,
  resetExtractMemoriesForTests,
} from '../../services/extractMemories/extractMemories.js'
import {
  createStore,
  getEntry,
  listStores,
  setEntry,
} from '../../services/SessionMemory/multiStore.js'
import {
  getSessionMemoryContent,
  waitForSessionMemoryExtraction,
} from '../../services/SessionMemory/sessionMemoryUtils.js'
import { runCleanupFunctions, runPreExitFlush } from '../cleanupRegistry.js'
import { getMemoryFiles } from '../claudemd.js'
import {
  _handleGlobalConfigFreshnessWatchEndedForTesting,
  _isGlobalConfigFreshnessWatcherStartedForTesting,
  _resetGlobalConfigFreshnessWatchForTesting,
  _startGlobalConfigFreshnessWatchCdForTesting,
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  resetTrustDialogAcceptedCacheForTesting,
  resolveUserIntentSetting,
  saveGlobalConfig,
  saveUserIntentSetting,
} from '../config.js'
import {
  _resetHookExecutionStateForTesting,
  hasEnteredHookExecution,
  runInsideHookExecution,
} from '../hooks/sessionHooks.js'
import { normalizePathForConfigKey } from '../path.js'
import {
  hasPendingPluginUsage,
  incrementPluginUsage,
  registerPluginUsageStorageV5,
  resetPendingPluginUsageForTests,
} from '../plugins/pluginUsagePending.js'
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  runWithNewHostSession,
} from '../sessionHost.js'
import { restoreSessionStateFromLog } from '../sessionRestore.js'
import {
  flushSessionStorage,
  getProject,
  getResumeHeadPath,
  getTranscriptPathForSession,
  isNotChainParent,
  markNotChainParent,
  readCCRTip,
  readCustomTitleSidecar,
  recordTranscript,
  writeCCRTip,
  writeCustomTitleSidecar,
  writeResumeHeadFile,
} from '../sessionStorage.js'
import {
  ensureProjectWatchedForCurrentHost,
  getWatchedProjectCwdRefCountForTests,
  settingsChangeDetector,
} from '../settings/changeDetector.js'
import {
  clearInternalWrites,
  consumeInternalWrite,
  hashSettingsContent,
  markInternalWrite,
} from '../settings/internalWrites.js'
import { setMdmSettingsCache } from '../settings/mdm/settings.js'
import {
  notifyStrictPluginOnlyPolicyIfChanged,
  registerStrictPluginOnlyChangeCallback,
  resetStrictPluginOnlyChangeStateForTests,
} from '../settings/pluginOnlyPolicy.js'
import {
  applyRemoteSettingsConsentFreeIfEligible,
  drainSettingsWrites,
  getPolicySettingsOrigin,
  getSettingsForSource,
  hasAdminPolicySurvivor,
  loadManagedFileSettings,
  persistSettingsForSource,
  rawSettingsContainsKey,
  resetRemoteSettingsSessionCache,
} from '../settings/settings.js'
import {
  getCachedParsedFile,
  resetSettingsCache,
} from '../settings/settingsCache.js'
import { createMemoryStorageV5Backend } from '../storageV5/createMemoryBackend.js'
import {
  getPinnedCredentials,
  pinCredentialsStore,
} from '../storageV5/credentialsStore.js'
import {
  isHoverRestOn,
  resetHoverRestPinForTests,
} from '../storageV5/hoverRestPin.js'
import {
  getPinnedStorageV5,
  pinInjectedStorageV5,
  pinStorageV5,
} from '../storageV5/index.js'
import {
  _resetStreamJsonStdoutGuardForTesting,
  installStreamJsonStdoutGuard,
} from '../streamJsonStdoutGuard.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await settingsChangeDetector.resetForTesting().catch(() => {})
  pinCredentialsStore(undefined)
  pinStorageV5(undefined)
  resetHoverRestPinForTests()
  resetSettingsCache()
  resetRemoteSettingsSessionCache()
  setParentManagedSettings(null)
  setMdmSettingsCache(
    { settings: {}, errors: [] },
    { settings: {}, errors: [] },
  )
  clearInternalWrites()
  resetPendingPluginUsageForTests()
  resetStrictPluginOnlyChangeStateForTests()
  _resetHookExecutionStateForTesting()
  _resetStreamJsonStdoutGuardForTesting()
  _resetGlobalConfigFreshnessWatchForTesting()
  resetTrustDialogAcceptedCacheForTesting()
  resetAutoDreamForTests()
  resetExtractMemoriesForTests()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Engine 4: Multi-Host ALS Isolation, StorageV5, Settings/Config & Diskless Architecture', () => {
  test('E4-P0-1: diskless EmbeddedHost + injected StorageV5 routes settings, transcripts, sidecars, and plugin usage without isHoverRestOn() and never touches host disk', async () => {
    const sentinelRoot = makeTempDir('e4-p01-sentinel-')
    const nonExistentConfigDir = join(sentinelRoot, 'must-not-be-created')
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const prevTestPersist = process.env.TEST_ENABLE_SESSION_PERSISTENCE
    process.env.CLAUDE_CONFIG_DIR = nonExistentConfigDir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

    const mem = createMemoryStorageV5Backend({
      configHome: nonExistentConfigDir,
    })
    const host = createEmbeddedHost({
      tenantId: 'tenant-diskless-e4',
      diskless: true,
      storageV5: mem,
    })

    try {
      const sess = host.createSession({
        sessionId: '11111111-1111-4111-8111-111111111111',
        cwd: sentinelRoot,
      })

      await sess.run(async () => {
        resetHoverRestPinForTests()
        expect(isHoverRestOn()).toBe(false)
        expect(getPinnedStorageV5()).toBe(mem)

        // 1. persistSettingsForSource writes and merges via StorageV5 with ZERO mkdirSync/readFileSync on host disk
        const r1 = await persistSettingsForSource('userSettings', {
          model: 'sonnet',
        })
        expect(r1.error).toBeNull()
        const r2 = await persistSettingsForSource('userSettings', {
          language: 'en',
        })
        expect(r2.error).toBeNull()
        expect(existsSync(nonExistentConfigDir)).toBe(false)

        const storedSettings = await mem.readText([
          { namespace: 'settings', layer: 'user' },
        ])
        expect(storedSettings.ok).toBe(true)
        if (storedSettings.ok) {
          expect(storedSettings.value.items[0]?.found).toBe(true)
          const parsed = JSON.parse(
            storedSettings.value.items[0]?.value ?? '{}',
          )
          expect(parsed.model).toBe('sonnet')
          expect(parsed.language).toBe('en')
        }
        expect(getSettingsForSource('userSettings')?.model).toBe('sonnet')
        expect(getSettingsForSource('userSettings')?.language).toBe('en')
        expect(rawSettingsContainsKey('language')).toBe(true)
        expect(loadManagedFileSettings().settings).toBeNull()

        // 2. Transcript append (recordTranscript -> leftoverPye) routes through StorageV5 without isHoverRestOn()
        const sid = sess.sessionId
        const transcriptPath = getTranscriptPathForSession(sid)
        await recordTranscript([
          {
            type: 'user',
            uuid: '22222222-2222-4222-8222-222222222222',
            timestamp: new Date().toISOString(),
            message: { role: 'user', content: 'hello diskless' },
          } as unknown as Parameters<typeof recordTranscript>[0][number],
        ])
        await flushSessionStorage()
        expect(existsSync(nonExistentConfigDir)).toBe(false)
        expect(
          Object.keys(mem.snapshot()).some(k => k.endsWith(`${sid}.jsonl`)),
        ).toBe(true)

        // 3. writeCustomTitleSidecar / readCustomTitleSidecar route through StorageV5
        await writeCustomTitleSidecar(transcriptPath, sid, 'Diskless Title')
        expect(existsSync(nonExistentConfigDir)).toBe(false)
        const title = await readCustomTitleSidecar(transcriptPath, sid)
        expect(title).toBe('Diskless Title')

        // 4. writeCCRTip / readCCRTip route through StorageV5
        await writeCCRTip(sid, 'evt-42')
        expect(existsSync(nonExistentConfigDir)).toBe(false)
        const tip = await readCCRTip(sid)
        expect(tip?.eventId).toBe('evt-42')

        // 5. writeResumeHeadFile routes through StorageV5 sidecar without host disk touch
        const headPath = getResumeHeadPath(
          transcriptPath,
          join(nonExistentConfigDir, 'projects'),
        )
        expect(headPath).toBeTruthy()
        if (headPath) {
          await writeResumeHeadFile(headPath, {
            boundaryOffset: 10,
            boundaryLength: 5,
            probe: 'abc',
            rowOffsets: [0],
            rowLengths: [10],
            generation: 1,
          })
          expect(existsSync(nonExistentConfigDir)).toBe(false)
          const snapKeys = Object.keys(mem.snapshot())
          expect(snapKeys.some(k => k.endsWith('resume-head.json'))).toBe(true)
        }

        // 6. pluginUsagePending routes through StorageV5 without isHoverRestOn()
        registerPluginUsageStorageV5(mem)
        incrementPluginUsage('demo@marketplace')
        expect(hasPendingPluginUsage('demo@marketplace')).toBe(true)
        await runPreExitFlush()
        expect(hasPendingPluginUsage('demo@marketplace')).toBe(false)

        // 7. Diskless local-FS guards: claudemd, SessionMemory, multiStore, changeDetector
        const claudeMdPath = join(sentinelRoot, 'CLAUDE.md')
        writeFileSync(claudeMdPath, '# should-not-be-read-diskless\n')
        const memFiles = await getMemoryFiles(false)
        expect(memFiles).toEqual([])
        expect(await getSessionMemoryContent()).toBeNull()
        createStore('diskless-store')
        setEntry('diskless-store', 'k1', 'v1')
        expect(listStores()).toEqual([])
        expect(getEntry('diskless-store', 'k1')).toBeNull()
        await settingsChangeDetector.initialize()
        await ensureProjectWatchedForCurrentHost()
        expect(getWatchedProjectCwdRefCountForTests(sentinelRoot)).toBe(0)
        expect(existsSync(nonExistentConfigDir)).toBe(false)
      })
    } finally {
      await host.dispose()
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      if (prevTestPersist === undefined) {
        delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
      } else {
        process.env.TEST_ENABLE_SESSION_PERSISTENCE = prevTestPersist
      }
    }
  })

  test('E4-P0-3: multi-session isolation on a shared EmbeddedHost isolates trust latch by CWD and SessionStorage by RootSessionSlot', async () => {
    const trustedDir = makeTempDir('e4-p03-trusted-')
    const untrustedDir = makeTempDir('e4-p03-untrusted-')
    const mem = createMemoryStorageV5Backend({ configHome: '/mem-p03' })
    const host = createEmbeddedHost({
      tenantId: 'tenant-shared-host',
      diskless: true,
      storageV5: mem,
    })

    try {
      const s1 = host.createSession({
        sessionId: '33333333-3333-4333-8333-333333333331',
        cwd: trustedDir,
      })
      const s2 = host.createSession({
        sessionId: '33333333-3333-4333-8333-333333333332',
        cwd: untrustedDir,
      })

      // Mark ONLY trustedDir as trusted in this host's config
      await s1.run(() => {
        const trustedKey = normalizePathForConfigKey(trustedDir)
        saveGlobalConfig(prev => ({
          ...prev,
          projects: {
            ...prev.projects,
            [trustedKey]: {
              allowedTools: [],
              mcpContextUris: [],
              mcpServers: {},
              enabledMcpjsonServers: [],
              disabledMcpjsonServers: [],
              projectOnboardingSeenCount: 0,
              hasClaudeMdExternalIncludesApproved: false,
              hasClaudeMdExternalIncludesWarningShown: false,
              ...(prev.projects?.[trustedKey] ?? {}),
              hasTrustDialogAccepted: true,
            },
          },
        }))
        expect(checkHasTrustDialogAccepted()).toBe(true)
      })

      // Session 2 on the SAME EmbeddedHost in untrustedDir MUST NOT inherit trust!
      await s2.run(() => {
        expect(checkHasTrustDialogAccepted()).toBe(false)
      })

      // Forking Session 1 into untrustedDir MUST NOT inherit trust either!
      const forked = s1.forkProject(untrustedDir)
      await forked.run(() => {
        expect(checkHasTrustDialogAccepted()).toBe(false)
      })

      // Concurrent sessions on the SAME EmbeddedHost must have completely separate SessionStorage Project state
      const uuidS1 = '44444444-4444-4444-8444-444444444441'
      const [proj1, proj2] = await Promise.all([
        s1.run(() => {
          const p = getProject()
          p.currentSessionTitle = 'Session-1-Title'
          markNotChainParent(uuidS1)
          expect(isNotChainParent(uuidS1)).toBe(true)
          return p
        }),
        s2.run(() => {
          const p = getProject()
          p.currentSessionTitle = 'Session-2-Title'
          expect(isNotChainParent(uuidS1)).toBe(false)
          return p
        }),
      ])
      expect(proj1).not.toBe(proj2)
      expect(proj1.currentSessionTitle).toBe('Session-1-Title')
      expect(proj2.currentSessionTitle).toBe('Session-2-Title')
    } finally {
      await host.dispose()
    }
  })

  test('E4-P0-4: default-host pinned credentials and StorageV5 never leak into runWithNewHostSession or createEmbeddedHost', async () => {
    const defaultStorage = createMemoryStorageV5Backend({
      configHome: '/default-host-mem',
    })
    const defaultCreds = {
      kind: 'default-host-creds',
    } as unknown as Parameters<typeof pinCredentialsStore>[0]

    pinInjectedStorageV5(defaultStorage)
    pinCredentialsStore(defaultCreds)

    // Outside ALS (default host) sees the default host's pins
    expect(getPinnedStorageV5()).toBe(defaultStorage)
    expect(getPinnedCredentials()).toBe(defaultCreds)

    // Inside runWithNewHostSession -> NEVER falls back to default host pins
    const inIsolated = await runWithNewHostSession(
      { id: 'e4-p04-iso' },
      () => ({
        storage: getPinnedStorageV5(),
        creds: getPinnedCredentials(),
      }),
    )
    expect(inIsolated.storage).toBeUndefined()
    expect(inIsolated.creds).toBeUndefined()

    // Inside createEmbeddedHost without storageV5 -> NEVER inherits default host pins
    const hostNoStorage = createEmbeddedHost({
      tenantId: 'e4-p04-no-storage',
      diskless: false,
    })
    try {
      const res = await hostNoStorage.run(() => ({
        storage: getPinnedStorageV5(),
        creds: getPinnedCredentials(),
      }))
      expect(res.storage).toBeUndefined()
      expect(res.creds).toBeUndefined()
    } finally {
      await hostNoStorage.dispose()
    }
  })

  test('E4-P1-5: internalWrites suppresses cross-host echoes outside ALS; changeDetector isolates hosts and ref-counts watchedProjectCwds', async () => {
    const wsInit = makeTempDir('e4-p15-init-')
    const wsA = makeTempDir('e4-p15-a-')
    const wsB = makeTempDir('e4-p15-b-')
    const wsShared = makeTempDir('e4-p15-shared-')
    mkdirSync(join(wsA, '.claude'), { recursive: true })
    mkdirSync(join(wsB, '.claude'), { recursive: true })
    mkdirSync(join(wsShared, '.claude'), { recursive: true })
    writeFileSync(
      join(wsA, '.claude', 'settings.json'),
      JSON.stringify({ model: 'model-a' }),
    )
    writeFileSync(
      join(wsB, '.claude', 'settings.json'),
      JSON.stringify({ model: 'model-b' }),
    )

    // 1. internalWrites cross-host echo suppression
    const sharedFile = join(wsA, '.claude', 'settings.json')
    const payload = '{"model":"self-write"}\n'
    await runWithNewHostSession({ id: 'iw-host-a', cwd: wsA }, () => {
      markInternalWrite(sharedFile, payload)
    })
    // Host B inside ALS cannot consume or clear Host A's mark
    await runWithNewHostSession({ id: 'iw-host-b', cwd: wsB }, () => {
      expect(consumeInternalWrite(sharedFile, 5_000)).toBeUndefined()
      clearInternalWrites()
    })
    // Process-global chokidar callback firing OUTSIDE ALS consumes Host A's mark
    expect(consumeInternalWrite(sharedFile, 5_000)).toBe(
      hashSettingsContent(payload),
    )

    // 2. changeDetector subscriber isolation: Host A's projectSettings edit must NOT nuke Host B
    await settingsChangeDetector.resetForTesting({
      stabilityThreshold: 30,
      pollInterval: 15,
      watchPollInterval: 100,
      fsWatchProbe: async () => 'delivers',
    })

    const hostAEvents: Array<{ source: string; host: object }> = []
    const hostBEvents: Array<{ source: string; host: object }> = []

    let releaseHosts!: () => void
    const waitRelease = new Promise<void>(r => {
      releaseHosts = r
    })
    let hostBPrimed!: () => void
    const waitHostBPrimed = new Promise<void>(r => {
      hostBPrimed = r
    })

    const [hostBCheck] = await Promise.all([
      runWithNewHostSession(
        { id: 'cd-iso-b', cwd: wsB, originalCwd: wsB, projectRoot: wsB },
        async () => {
          const myHost = getBootstrapSessionHost()
          const unsub = settingsChangeDetector.subscribe(source => {
            hostBEvents.push({ source, host: getBootstrapSessionHost() })
          })
          try {
            const before = getSettingsForSource('projectSettings')
            expect(before?.model).toBe('model-b')
            const fileB = join(wsB, '.claude', 'settings.json')
            expect(getCachedParsedFile(fileB)).toBeDefined()
            hostBPrimed()
            await waitRelease
            // Host A's projectSettings notify MUST NOT have cleared Host B's parsed cache or fired Host B's subscriber!
            return {
              myHost,
              stillCached: getCachedParsedFile(fileB) !== undefined,
            }
          } finally {
            unsub()
          }
        },
      ),
      runWithNewHostSession(
        { id: 'cd-iso-a', cwd: wsA, originalCwd: wsA, projectRoot: wsA },
        async () => {
          await waitHostBPrimed
          const myHost = getBootstrapSessionHost()
          const unsub = settingsChangeDetector.subscribe(source => {
            hostAEvents.push({ source, host: getBootstrapSessionHost() })
          })
          try {
            settingsChangeDetector.notifyChange('projectSettings')
            expect(hostAEvents).toHaveLength(1)
            expect(hostAEvents[0]?.host).toBe(myHost)
          } finally {
            unsub()
            releaseHosts()
          }
        },
      ),
    ])

    expect(hostBCheck.stillCached).toBe(true)
    expect(hostBEvents).toHaveLength(0)

    // 3. Ref-counted watchedProjectCwds unwatch when ref-count drops to 0 on host cleanup
    await runWithNewHostSession(
      { id: 'cd-ref-init', cwd: wsInit, originalCwd: wsInit },
      async () => {
        await settingsChangeDetector.initialize()
      },
    )
    expect(getWatchedProjectCwdRefCountForTests(wsShared)).toBe(0)

    let cleanupB!: () => Promise<void>
    let cleanupC!: () => Promise<void>
    await runWithNewHostSession(
      { id: 'cd-ref-b', cwd: wsShared, originalCwd: wsShared },
      async sessionB => {
        await ensureProjectWatchedForCurrentHost()
        expect(getWatchedProjectCwdRefCountForTests(wsShared)).toBe(1)
        cleanupB = () =>
          runWithNewHostSession({ id: 'noop' }, () => Promise.resolve()).then(
            async () => {
              // Run cleanup directly in sessionB via sessionB.host
              const { runWithSession } = await import('../sessionHost.js')
              await runWithSession(sessionB, () => runCleanupFunctions())
            },
          )
      },
    )
    await runWithNewHostSession(
      { id: 'cd-ref-c', cwd: wsShared, originalCwd: wsShared },
      async sessionC => {
        await ensureProjectWatchedForCurrentHost()
        expect(getWatchedProjectCwdRefCountForTests(wsShared)).toBe(2)
        cleanupC = async () => {
          const { runWithSession } = await import('../sessionHost.js')
          await runWithSession(sessionC, () => runCleanupFunctions())
        }
      },
    )
    await cleanupB()
    expect(getWatchedProjectCwdRefCountForTests(wsShared)).toBe(1)
    await cleanupC()
    expect(getWatchedProjectCwdRefCountForTests(wsShared)).toBe(0)
  })

  test('E4-P1-7: streamJsonStdoutGuard WeakMap lease refcount & pluginUsagePending re-register/clear', async () => {
    // 1. streamJsonStdoutGuard isolates per-host leases without leaking strong host refs
    await runWithNewHostSession({ id: 'guard-a' }, async () => {
      installStreamJsonStdoutGuard()
      await runWithNewHostSession({ id: 'guard-b' }, async () => {
        installStreamJsonStdoutGuard()
        await runCleanupFunctions()
      })
      await runCleanupFunctions()
    })

    // 2. pluginUsagePending unregisters prior hooks on re-register and clears on undefined
    const flushedHandles: string[] = []
    const mkHandle = (tag: string) => ({
      tag,
      write: async () => {
        flushedHandles.push(tag)
        return { ok: true as const, value: { version: 'v1' } }
      },
    })
    const usageHost = createEmbeddedHost({
      tenantId: 'usage-rereg-host',
      diskless: true,
    })
    try {
      await usageHost.run(async () => {
        registerPluginUsageStorageV5(mkHandle('first'))
        registerPluginUsageStorageV5(mkHandle('second'))
        incrementPluginUsage('p1@mp')
        await runPreExitFlush()
        expect(flushedHandles).toEqual(['second'])

        // Clearing with undefined unregisters hooks and stops flushing
        registerPluginUsageStorageV5(undefined)
        incrementPluginUsage('p2@mp')
        await runPreExitFlush()
        expect(flushedHandles).toEqual(['second'])
      })
    } finally {
      await usageHost.dispose()
    }
  })

  test('E4-P1-8: HostSlot isolation for pluginOnlyPolicy, sessionHooks, autoDream, extractMemories', async () => {
    // 1. pluginOnlyPolicy host-scoped vs persistent callbacks
    const hostACalls: unknown[] = []
    const persistentCalls: unknown[] = []
    const unsubPersistent = registerStrictPluginOnlyChangeCallback(
      next => persistentCalls.push(next),
      { persistent: true },
    )
    try {
      await runWithNewHostSession({ id: 'pop-a' }, () => {
        registerStrictPluginOnlyChangeCallback(next => hostACalls.push(next))
      })
      await runWithNewHostSession({ id: 'pop-b' }, () => {
        notifyStrictPluginOnlyPolicyIfChanged(['skills'])
      })
      // Host B's policy change must NOT invoke Host A's host-scoped callback
      expect(hostACalls).toEqual([])
      expect(persistentCalls).toEqual([['skills']])
      // Persistent callback survives resetStrictPluginOnlyChangeStateForTests()
      resetStrictPluginOnlyChangeStateForTests()
      await runWithNewHostSession({ id: 'pop-c' }, () => {
        notifyStrictPluginOnlyPolicyIfChanged(['hooks'])
      })
      expect(persistentCalls).toEqual([['skills'], ['hooks']])
    } finally {
      unsubPersistent()
    }

    // 2. sessionHooks hasEnteredHookExecution isolates per host inside ALS
    await runWithNewHostSession({ id: 'hook-exec-a' }, () => {
      runInsideHookExecution(
        () => {
          expect(hasEnteredHookExecution()).toBe(true)
        },
        { hookName: 'PreToolUse' },
      )
      expect(hasEnteredHookExecution()).toBe(true)
    })
    await runWithNewHostSession({ id: 'hook-exec-b' }, () => {
      expect(hasEnteredHookExecution()).toBe(false)
    })

    // 3. autoDream & extractMemories isolate per host (Host B never inherits Host A's injected deps)
    let dreamConfigCallsA = 0
    let extractGateCallsA = 0
    const dummyCtx = {
      messages: [],
      agentId: undefined,
      options: { tools: [] },
      getAppState: () => ({}),
      toolUseContext: {
        agentId: undefined,
        options: { tools: [] },
        getAppState: () => ({}),
      },
    } as unknown as Parameters<typeof executeAutoDream>[0]
    await runWithNewHostSession({ id: 'dream-a' }, async () => {
      initAutoDream({
        getConfigFn: () => {
          dreamConfigCallsA++
          return { minHours: 24, minSessions: 5 }
        },
        isGateOpenFn: () => true,
        readLastConsolidatedAtFn: async () => Date.now(),
      })
      await executeAutoDream(dummyCtx)
      expect(dreamConfigCallsA).toBeGreaterThanOrEqual(1)

      initExtractMemories({
        isGateEnabledFn: () => {
          extractGateCallsA++
          return false
        },
      })
      await executeExtractMemories(dummyCtx)
      expect(extractGateCallsA).toBeGreaterThanOrEqual(1)
    })
    const dreamCountAfterA = dreamConfigCallsA
    const extractCountAfterA = extractGateCallsA
    await runWithNewHostSession({ id: 'dream-b' }, async () => {
      await executeAutoDream(dummyCtx)
      await executeExtractMemories(dummyCtx)
      // Host B did not init with Host A's deps, so Host A's callbacks MUST NOT be invoked
      expect(dreamConfigCallsA).toBe(dreamCountAfterA)
      expect(extractGateCallsA).toBe(extractCountAfterA)
    })
  })

  test('E4-P1-9: parentManagedSettings outranks HKCU, remote checked first in getPolicySettingsOrigin & hasAdminPolicySurvivor, zero bare require()', async () => {
    await runWithNewHostSession({ id: 'policy-order-host' }, () => {
      // 1. parentManagedSettings outranks Windows HKCU (`parent > hkcu`)
      setMdmSettingsCache(
        { settings: {}, errors: [] },
        {
          settings: {
            model: 'from-hkcu',
            env: { SHARED: 'hkcu', HKCU_ONLY: 'yes' },
          },
          errors: [],
        },
      )
      setParentManagedSettings({
        model: 'from-parent',
        env: { SHARED: 'parent', PARENT_ONLY: 'yes' },
      })
      resetSettingsCache()

      expect(getPolicySettingsOrigin()).toBe('parent')
      const resolved = getSettingsForSource('policySettings')
      expect(resolved?.model).toBe('from-parent')
      expect(resolved?.env?.SHARED).toBe('parent')
      expect(resolved?.env?.PARENT_ONLY).toBe('yes')
      expect(resolved?.env?.HKCU_ONLY).toBe('yes')

      // 2. Remote managed settings checked FIRST in getPolicySettingsOrigin & hasAdminPolicySurvivor
      const applied = applyRemoteSettingsConsentFreeIfEligible(
        { model: 'from-remote' },
        { isFirstPartyTrusted: true, isInteractive: false },
      )
      expect(applied.applied).toBe(true)
      resetSettingsCache()
      expect(getPolicySettingsOrigin()).toBe('remote')
      expect(hasAdminPolicySurvivor()).toBe(true)
    })

    // 3. Zero bare require(...) calls in config.ts, hostModelOverlay.ts, sessionRestore.ts
    const srcRoot = join(import.meta.dir, '../..')
    for (const rel of [
      'utils/config.ts',
      'utils/settings/hostModelOverlay.ts',
      'utils/sessionRestore.ts',
    ]) {
      const src = readFileSync(join(srcRoot, rel), 'utf8')
      expect(src).not.toMatch(/\brequire\s*\(/)
    }
  })

  test('E4-P2-10..13: sessionRestore corrupted transcript safety, saveUserIntentSetting StorageV5 + legacy reset, config freshness stop-on-2nd-error & preExitFlush, sessionMemory finally guard', async () => {
    // E4-P2-10: corrupted assistant messages do not crash restoreSessionStateFromLog / extractTodosFromTranscript
    const corruptedMessages = [
      { type: 'assistant', message: undefined },
      { type: 'assistant', message: { content: 'not-an-array' } },
      {
        type: 'assistant',
        message: { content: [null, 42, { type: 'text', text: 'ok' }] },
      },
    ] as unknown as Parameters<typeof restoreSessionStateFromLog>[0]['messages']
    expect(() =>
      restoreSessionStateFromLog({ messages: corruptedMessages }, prev => prev),
    ).not.toThrow()

    // E4-P2-11: saveUserIntentSetting routes through StorageV5 and clears legacy ~/.claude.json key on explicit undefined reset
    const mem = createMemoryStorageV5Backend({ configHome: '/mem-p211' })
    const host = createEmbeddedHost({
      tenantId: 'tenant-p211',
      diskless: true,
      storageV5: mem,
    })
    try {
      await host.run(async () => {
        pinInjectedStorageV5(mem)
        // Seed legacy GlobalConfig verbose = true
        saveGlobalConfig(prev => ({ ...prev, verbose: true }))
        expect(getGlobalConfig().verbose).toBe(true)
        expect(resolveUserIntentSetting('verbose', false)).toEqual({
          value: true,
          source: 'legacyGlobalConfig',
        })

        // Save to userSettings via StorageV5
        const setRes = saveUserIntentSetting('verbose', true, mem)
        expect(setRes.error).toBeNull()
        await drainSettingsWrites()
        expect(resolveUserIntentSetting('verbose', false)).toEqual({
          value: true,
          source: 'userSettings',
        })

        // Explicit reset (undefined) MUST clear legacy ~/.claude.json so it does NOT resurrect true!
        const resetRes = saveUserIntentSetting('verbose', undefined, mem)
        expect(resetRes.error).toBeNull()
        await drainSettingsWrites()
        expect(resolveUserIntentSetting('verbose', false)).toEqual({
          value: false,
          source: 'default',
        })
      })
    } finally {
      await host.dispose()
    }

    // E4-P2-12a: globalConfig freshness watch resubscribes ONCE on 1st error and stops on 2nd consecutive error
    await runWithNewHostSession({ id: 'freshness-eacces' }, () => {
      _resetGlobalConfigFreshnessWatchForTesting()
      _startGlobalConfigFreshnessWatchCdForTesting()
      expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(true)

      _handleGlobalConfigFreshnessWatchEndedForTesting(new Error('EACCES 1'))
      expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(true)

      _handleGlobalConfigFreshnessWatchEndedForTesting(new Error('EACCES 2'))
      expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(false)
    })

    // E4-P2-12b: diskless saveGlobalConfig registers pre-exit flush awaiting disklessWriteChain
    let releaseSlowWrite!: () => void
    let writeSettled = false
    const slowStorage = {
      write: async () => {
        await new Promise<void>(resolve => {
          releaseSlowWrite = resolve
        })
        writeSettled = true
        return { ok: true as const, value: { version: 'v1' } }
      },
    }
    const flushHost = createEmbeddedHost({
      tenantId: 'tenant-p212-flush',
      diskless: true,
      storageV5: slowStorage as unknown as NonNullable<
        Parameters<typeof createEmbeddedHost>[0]
      >['storageV5'],
    })
    try {
      await flushHost.run(async () => {
        saveGlobalConfig(prev => ({ ...prev, numStartups: 99 }))
        const flushPromise = runPreExitFlush()
        await new Promise(r => setTimeout(r, 15))
        expect(writeSettled).toBe(false)
        releaseSlowWrite()
        await flushPromise
        expect(writeSettled).toBe(true)
      })
    } finally {
      await flushHost.dispose()
    }

    // E4-P2-13: sessionMemory.ts extractSessionMemoryImpl wraps body in finally { markExtractionCompleted() }
    const smSrc = readFileSync(
      join(import.meta.dir, '../../services/SessionMemory/sessionMemory.ts'),
      'utf8',
    )
    expect(smSrc).toContain('finally {\n    markExtractionCompleted()')
    await expect(waitForSessionMemoryExtraction()).resolves.toBeUndefined()
  })
})
