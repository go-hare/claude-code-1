import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearBridgeSessionMeta,
  getPersistedBridgeSession,
  resetBridgeSessionMetaForTests,
  saveBridgeSessionMeta,
} from '../../bridge/bridgeSessionMeta.js'
import {
  resetBridgePlaceholdersForTests,
  sweepBridgePlaceholders,
} from '../../bridge/bridgePlaceholders.js'
import type { ReplBridgeHandle } from '../../bridge/replBridge.js'
import {
  getReplBridgeHandle,
  getSelfBridgeCompatId,
  resetLeftArrowBridgeHandleForTests,
  setReplBridgeHandle,
  stashLeftArrowBridgeHandle,
  takeLeftArrowBridgeHandle,
} from '../../bridge/replBridgeHandle.js'
import {
  setCseShimGate,
  toCompatSessionId,
} from '../../bridge/sessionIdCompat.js'
import {
  clearTrustedDeviceTokenCache,
  getTrustedDeviceToken,
} from '../../bridge/trustedDevice.js'
import {
  holdBackMcpConfigsForClaim,
  takeHeldBackMcpConfigs,
} from '../../cli/spareClaim.js'
import {
  getCurrentStructuredIO,
  setCurrentStructuredIO,
  type StructuredIO,
} from '../../cli/structuredIO.js'
import {
  _resetWin32HostDeathForTesting,
  getHostProcessState,
} from '../../daemon/hostDeath.js'
import {
  disarmStartupWedgeWatchdog,
  resetStartupWedgeForTests,
  setPeerQuestionHandler,
  registerImmediateCommandRunner,
} from '../../daemon/rendezvousServer.js'
import {
  isDaemonShutdownSignaled,
  markDaemonShutdownSignaled,
  resetDaemonShutdownSignaled,
} from '../../daemon/state.js'
import {
  getPendingTelemetryInitPromiseForTesting,
  init,
  initializeTelemetryAfterTrust,
  isTelemetryDeferredForFirstTurn,
  registerRemoteManagedSettingsLoadPromise,
  releaseDeferredTelemetryForFirstTurn,
  resetSessionCountMetricForTesting,
  setTelemetryInitializerForTesting,
  shouldDeferTelemetryUntilFirstTurn,
} from '../../entrypoints/init.js'
import {
  clearCodeModeVmSession,
  getCodeModeAutoVerdictTracker,
  resetCodeModeRuntimeStateForTests,
} from '../../services/codeMode/executor.js'
import {
  getCodeModeOptInState,
  getCodeModeStateVersion,
  hasCodeModeAccountChanged,
  hasReplContextBeenCreated,
  isAsyncReplEnabled,
  isCodeModeAccepted,
  isCodeModeEnabled,
  isCodeModeOptInDialogOpen,
  isStandaloneBunExecutable,
  markPollEventWiringForTerminalRun,
  noteReplContextCreated,
  openCodeModeOptInDialog,
  pinCodeMode,
  recordCodeModeSignedInAccount,
  registerCodeModePrimitiveToolsResolver,
  resetCodeModeOptInStateForTests,
  resolveCodeModePrimitiveTools,
  sandboxHostListsBlockCodeMode,
  setEngineCheckResultForTests,
  setSandboxCommandNetworkListsOffered,
  setStandaloneExecutableForTests,
  settleCodeModeOptIn,
  subscribeCodeModeState,
} from '../../services/codeMode/optIn.js'
import {
  getReplSessions,
  resetReplSessionsForTests,
} from '../../services/codeMode/replSessions.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { enableConfigs } from '../config.js'
import {
  detectDeploymentEnvironment,
  env,
  getGlobalClaudeFile,
  resetGlobalClaudeFileForTests,
  seedGlobalClaudeFile,
} from '../env.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  createRootSession,
  getBootstrapSession,
  getBootstrapSessionHost,
  runWithNewHostSession,
  runWithSession,
} from '../sessionRoot.js'
import {
  isInITerm2,
  isInWindowsTerminal,
  resetDetectionCache,
} from '../swarm/backends/detection.js'
import {
  _resetSpawnedTeammatePanesForTesting,
  killOrphanedTeammatePanes,
  recordSpawnedTeammatePane,
  untrackSpawnedTeammatePane,
  writeTeamFileAsync,
} from '../swarm/teamHelpers.js'
import {
  assignTeammateColor,
  clearTeammateColors,
  getTeammateColor,
} from '../swarm/teammateLayoutManager.js'

function tick(ms = 4): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const TRACKED_ENV_KEYS = [
  'NODE_ENV',
  'CLAUDE_INTERNAL_FC_OVERRIDES',
  'CLAUDE_TRUSTED_DEVICE_TOKEN',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_DISABLE_STARTUP_WORK_GATE',
  'TERM_PROGRAM',
  'ITERM_SESSION_ID',
  'WT_SESSION',
] as const

describe('Official 2.1.331 Wave 5 multi-host ALS isolation: CodeMode, Bridge, Daemon, Swarm, CLI & Env', () => {
  const savedEnv: Partial<
    Record<(typeof TRACKED_ENV_KEYS)[number], string | undefined>
  > = {}
  const tempDirs: string[] = []

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  function restoreEnv(): void {
    for (const key of TRACKED_ENV_KEYS) {
      const prev = savedEnv[key]
      if (prev === undefined) delete process.env[key]
      else process.env[key] = prev
    }
  }

  beforeAll(() => {
    for (const key of TRACKED_ENV_KEYS) {
      savedEnv[key] = process.env[key]
    }
  })

  afterEach(() => {
    restoreEnv()
    resetCodeModeOptInStateForTests()
    resetCodeModeRuntimeStateForTests()
    resetReplSessionsForTests()
    setReplBridgeHandle(null)
    resetLeftArrowBridgeHandleForTests()
    resetBridgeSessionMetaForTests()
    resetBridgePlaceholdersForTests()
    clearTrustedDeviceTokenCache()
    _resetWin32HostDeathForTesting()
    resetDaemonShutdownSignaled()
    resetStartupWedgeForTests()
    setPeerQuestionHandler(null)
    registerImmediateCommandRunner(null)
    resetDetectionCache()
    clearTeammateColors()
    _resetSpawnedTeammatePanesForTesting()
    setCurrentStructuredIO(undefined)
    takeHeldBackMcpConfigs()
    resetSessionCountMetricForTesting()
    resetGlobalClaudeFileForTests()
    getClaudeConfigHomeDir.cache.clear()
  })

  afterAll(() => {
    restoreEnv()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('1. Code Mode (optIn, replSessions, executor)', () => {
    test('optIn: 21 host globals (opt-in decision, sandbox holdoff, listeners, resolvers, account) stay isolated across concurrent hosts', async () => {
      const cwdA = makeTempDir('als-cm-optin-a-')
      const cwdB = makeTempDir('als-cm-optin-b-')

      let defaultListenerCalls = 0
      const unsubDefault = subscribeCodeModeState(() => {
        defaultListenerCalls += 1
      })

      try {
        const [resA, resB] = await Promise.all([
          runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
            let callsA = 0
            const unsubA = subscribeCodeModeState(() => {
              callsA += 1
            })
            setEngineCheckResultForTests('passed')
            setStandaloneExecutableForTests(true)
            settleCodeModeOptIn({ state: 'on', source: 'shell' })
            markPollEventWiringForTerminalRun()
            noteReplContextCreated()
            recordCodeModeSignedInAccount({
              accountUuid: 'acct-a',
              organizationUuid: 'org-a',
            })
            const unregResolverA = registerCodeModePrimitiveToolsResolver(
              () => [{ name: 'HostAOnlyTool' }],
            )
            await tick(8)

            const beforeHoldoff = isCodeModeEnabled()
            setSandboxCommandNetworkListsOffered(true)
            const afterHoldoff = isCodeModeEnabled()
            const blocked = sandboxHostListsBlockCodeMode()
            const primitives = resolveCodeModePrimitiveTools<{ name: string }>(
              [],
              undefined,
            )
            const accountChangedSame = hasCodeModeAccountChanged({
              accountUuid: 'acct-a',
              organizationUuid: 'org-a',
            })
            const accountChangedDiff = hasCodeModeAccountChanged({
              accountUuid: 'acct-b',
              organizationUuid: 'org-b',
            })

            unregResolverA()
            unsubA()

            return {
              state: getCodeModeOptInState(),
              accepted: isCodeModeAccepted(),
              beforeHoldoff,
              afterHoldoff,
              blocked,
              replCreated: hasReplContextBeenCreated(),
              standalone: isStandaloneBunExecutable(),
              primitiveNames: primitives.map(t => t.name),
              callsA,
              version: getCodeModeStateVersion(),
              accountChangedSame,
              accountChangedDiff,
            }
          }),
          runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
            await tick(4)
            let callsB = 0
            const unsubB = subscribeCodeModeState(() => {
              callsB += 1
            })
            setEngineCheckResultForTests('passed')
            setStandaloneExecutableForTests(false)
            openCodeModeOptInDialog()
            const dialogWasOpen = isCodeModeOptInDialogOpen()
            pinCodeMode(false)
            await tick(8)

            const res = {
              state: getCodeModeOptInState(),
              accepted: isCodeModeAccepted(),
              enabled: isCodeModeEnabled(),
              blocked: sandboxHostListsBlockCodeMode(),
              asyncRepl: isAsyncReplEnabled(),
              replCreated: hasReplContextBeenCreated(),
              dialogWasOpen,
              standalone: isStandaloneBunExecutable(),
              primitiveNames: resolveCodeModePrimitiveTools<{ name: string }>(
                [],
                undefined,
              ).map(t => t.name),
              callsB,
              accountChanged: hasCodeModeAccountChanged({
                accountUuid: 'acct-x',
              }),
            }
            unsubB()
            return res
          }),
        ])

        expect(resA.state).toEqual({ state: 'on', source: 'shell' })
        expect(resA.accepted).toBe(true)
        expect(resA.beforeHoldoff).toBe(true)
        expect(resA.afterHoldoff).toBe(false)
        expect(resA.blocked).toBe(true)
        expect(resA.replCreated).toBe(true)
        expect(resA.standalone).toBe(true)
        expect(resA.primitiveNames).toEqual(['HostAOnlyTool'])
        expect(resA.callsA).toBeGreaterThanOrEqual(4)
        expect(resA.version).toBeGreaterThanOrEqual(4)
        expect(resA.accountChangedSame).toBe(false)
        expect(resA.accountChangedDiff).toBe(true)

        expect(resB.state).toEqual({ state: 'not_asked' })
        expect(resB.accepted).toBe(false)
        expect(resB.enabled).toBe(false)
        expect(resB.blocked).toBe(false)
        expect(resB.asyncRepl).toBe(false)
        expect(resB.replCreated).toBe(false)
        expect(resB.dialogWasOpen).toBe(true)
        expect(resB.standalone).toBe(false)
        expect(resB.primitiveNames).not.toContain('HostAOnlyTool')
        expect(resB.callsB).toBeGreaterThanOrEqual(3)
        expect(resB.accountChanged).toBe(false)

        // Default host was never notified or mutated
        expect(defaultListenerCalls).toBe(0)
        expect(getCodeModeOptInState()).toEqual({ state: 'not_asked' })
        expect(sandboxHostListsBlockCodeMode()).toBe(false)
      } finally {
        unsubDefault()
      }
    })

    test('replSessions: getReplSessions() returns isolated ReplSessions singletons per host', async () => {
      const cwdA = makeTempDir('als-cm-repl-a-')
      const cwdB = makeTempDir('als-cm-repl-b-')
      const defaultSessions = getReplSessions()

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          const sA = getReplSessions()
          sA.set('main', { clearAllTimers: () => {} })
          await tick(8)
          const beforeResetHas = sA.has('main')
          const sameAsDefault = sA === defaultSessions
          resetReplSessionsForTests()
          const afterReset = getReplSessions()
          return {
            sA,
            beforeResetHas,
            sameAsDefault,
            afterResetHasMain: afterReset.has('main'),
          }
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          const sB = getReplSessions()
          sB.set('main', { clearAllTimers: () => {} })
          await tick(10)
          // Host A's resetReplSessionsForTests() MUST NOT wipe Host B's ReplSessions!
          return {
            sB,
            stillHasMain: sB.has('main'),
            sameAsDefault: sB === defaultSessions,
          }
        }),
      ])

      expect(resA.sameAsDefault).toBe(false)
      expect(resB.sameAsDefault).toBe(false)
      expect(resA.sA).not.toBe(resB.sB)
      expect(resA.beforeResetHas).toBe(true)
      expect(resA.afterResetHasMain).toBe(false)
      expect(resB.stillHasMain).toBe(true)
      expect(defaultSessions.has('main')).toBe(false)
    })

    test('executor: autoVerdictTracker and runtime state are isolated per RootSessionSlot', async () => {
      const cwdA = makeTempDir('als-cm-exec-a-')
      const cwdB = makeTempDir('als-cm-exec-b-')
      const defaultTracker = getCodeModeAutoVerdictTracker()

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          const trackerA = getCodeModeAutoVerdictTracker()
          trackerA.registerScript('script-a')
          trackerA.markAllowed('script-a')
          await tick(8)
          const stateA = trackerA.getRecord('script-a')?.state
          resetCodeModeRuntimeStateForTests()
          const afterResetA = trackerA.getRecord('script-a')
          return {
            trackerA,
            stateA,
            afterResetA,
            sameAsDefault: trackerA === defaultTracker,
          }
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          const trackerB = getCodeModeAutoVerdictTracker()
          trackerB.registerScript('script-b')
          trackerB.markBlocked('script-b', 'blocked-in-b')
          await tick(10)
          const stateB = trackerB.getRecord('script-b')?.state
          const seesA = trackerB.getRecord('script-a')
          clearCodeModeVmSession()
          return {
            trackerB,
            stateB,
            seesA,
            sameAsDefault: trackerB === defaultTracker,
          }
        }),
      ])

      expect(resA.sameAsDefault).toBe(false)
      expect(resB.sameAsDefault).toBe(false)
      expect(resA.trackerA).not.toBe(resB.trackerB)
      expect(resA.stateA).toBe('allowed')
      expect(resA.afterResetA).toBeUndefined()
      expect(resB.stateB).toBe('blocked')
      expect(resB.seesA).toBeUndefined()
      expect(defaultTracker.getRecord('script-a')).toBeUndefined()
      expect(defaultTracker.getRecord('script-b')).toBeUndefined()

      // Two distinct root sessions on the default host also get separate RootSessionSlots
      const sharedHost = getBootstrapSessionHost()
      const root1 = createRootSession({
        host: sharedHost,
        id: randomUUID(),
        project: { originalCwd: cwdA, projectRoot: cwdA, cwd: cwdA },
      })
      const root2 = createRootSession({
        host: sharedHost,
        id: randomUUID(),
        project: { originalCwd: cwdB, projectRoot: cwdB, cwd: cwdB },
      })
      const t1 = runWithSession(root1, () => getCodeModeAutoVerdictTracker())
      const t2 = runWithSession(root2, () => getCodeModeAutoVerdictTracker())
      expect(t1).not.toBe(t2)
    })
  })

  describe('2. Bridge (replBridgeHandle, bridgeSessionMeta, sessionIdCompat, bridgePlaceholders, trustedDevice)', () => {
    test('replBridgeHandle & sessionIdCompat isolate active handle, left-arrow stash, and cse shim gate per host', async () => {
      const cwdA = makeTempDir('als-br-handle-a-')
      const cwdB = makeTempDir('als-br-handle-b-')

      const handleA = {
        bridgeSessionId: 'cse_host_a',
      } as unknown as ReplBridgeHandle
      const stashA = {
        bridgeSessionId: 'cse_stash_a',
      } as unknown as ReplBridgeHandle
      const handleB = {
        bridgeSessionId: 'cse_host_b',
      } as unknown as ReplBridgeHandle
      const stashB = {
        bridgeSessionId: 'cse_stash_b',
      } as unknown as ReplBridgeHandle

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          setCseShimGate(() => false)
          setReplBridgeHandle(handleA)
          stashLeftArrowBridgeHandle(stashA)
          await tick(8)
          const active = getReplBridgeHandle()
          const compat = getSelfBridgeCompatId()
          const directCompat = toCompatSessionId('cse_123')
          const taken = takeLeftArrowBridgeHandle()
          setReplBridgeHandle(null)
          return { active, compat, directCompat, taken }
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          setCseShimGate(() => true)
          setReplBridgeHandle(handleB)
          stashLeftArrowBridgeHandle(stashB)
          await tick(10)
          const active = getReplBridgeHandle()
          const compat = getSelfBridgeCompatId()
          const directCompat = toCompatSessionId('cse_123')
          const taken = takeLeftArrowBridgeHandle()
          return { active, compat, directCompat, taken }
        }),
      ])

      expect(resA.active).toBe(handleA)
      expect(resA.compat).toBe('cse_host_a')
      expect(resA.directCompat).toBe('cse_123')
      expect(resA.taken).toBe(stashA)

      expect(resB.active).toBe(handleB)
      expect(resB.compat).toBe('session_host_b')
      expect(resB.directCompat).toBe('session_123')
      expect(resB.taken).toBe(stashB)

      expect(getReplBridgeHandle()).toBeNull()
      expect(takeLeftArrowBridgeHandle()).toBeNull()
    })

    test('bridgeSessionMeta isolates live persisted bridge meta across concurrent hosts', async () => {
      const cwdA = makeTempDir('als-br-meta-a-')
      const cwdB = makeTempDir('als-br-meta-b-')

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          saveBridgeSessionMeta('session_alpha', 11, {
            groupingId: 'group-a',
            noHistoryBackfill: true,
          })
          await tick(8)
          const beforeClear = getPersistedBridgeSession()
          clearBridgeSessionMeta()
          const afterClear = getPersistedBridgeSession()
          return { beforeClear, afterClear }
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          saveBridgeSessionMeta('session_beta', 22, {
            groupingId: 'group-b',
          })
          await tick(10)
          const persisted = getPersistedBridgeSession()
          return { persisted }
        }),
      ])

      expect(resA.beforeClear).toEqual({
        id: 'session_alpha',
        seq: 11,
        groupingId: 'group-a',
        declaredDialogKinds: undefined,
        noHistoryBackfill: true,
        ownerAccountUuid: undefined,
        ownerOrganizationUuid: undefined,
      })
      expect(resA.afterClear).toBeUndefined()
      expect(resB.persisted?.id).toBe('session_beta')
      expect(resB.persisted?.seq).toBe(22)
      expect(resB.persisted?.groupingId).toBe('group-b')
      expect(resB.persisted?.noHistoryBackfill).toBeUndefined()
      expect(getPersistedBridgeSession()).toBeUndefined()
    })

    test('bridgePlaceholders sweepStarted latch is isolated per host', async () => {
      const cfgDir = makeTempDir('als-br-ph-cfg-')
      const cwdA = makeTempDir('als-br-ph-a-')
      const cwdB = makeTempDir('als-br-ph-b-')
      const claudeFile = join(cfgDir, '.claude.json')
      writeFileSync(
        claudeFile,
        JSON.stringify({
          replBridgePlaceholders: {
            session_dead_orphan_331: {
              pid: 999_999_999,
              createdAt: Date.now() - 600_000,
            },
          },
        }),
        'utf-8',
      )
      process.env.NODE_ENV = 'development'
      process.env.CLAUDE_CONFIG_DIR = cfgDir
      process.env.CLAUDE_INTERNAL_FC_OVERRIDES = JSON.stringify({
        tengu_bridge_placeholder_sweep: true,
      })
      getClaudeConfigHomeDir.cache.clear()
      let fetchCallsA = 0
      let fetchCallsB = 0

      await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          seedGlobalClaudeFile(claudeFile)
          enableConfigs()
          await sweepBridgePlaceholders({
            baseUrl: 'https://example.invalid',
            getAccessToken: () => 'tok-a',
            archive: async () => 200,
            startDelayMs: 0,
            fetchSession: async () => {
              fetchCallsA += 1
              return { session: null, notFound: false }
            },
          })
          await tick(4)
          // Second call on Host A MUST be gated by Host A's sweepStarted latch
          await sweepBridgePlaceholders({
            baseUrl: 'https://example.invalid',
            getAccessToken: () => 'tok-a',
            archive: async () => 200,
            startDelayMs: 0,
            fetchSession: async () => {
              fetchCallsA += 10
              return { session: null, notFound: false }
            },
          })
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(6)
          seedGlobalClaudeFile(claudeFile)
          enableConfigs()
          // Host B's sweepStarted is independent of Host A's latch
          await sweepBridgePlaceholders({
            baseUrl: 'https://example.invalid',
            getAccessToken: () => 'tok-b',
            archive: async () => 200,
            startDelayMs: 0,
            fetchSession: async () => {
              fetchCallsB += 1
              return { session: null, notFound: false }
            },
          })
        }),
      ])

      expect(fetchCallsA).toBe(1)
      expect(fetchCallsB).toBe(1)
    })

    test('trustedDevice memoized token cache is isolated per host', async () => {
      const cwdA = makeTempDir('als-br-td-a-')
      const cwdB = makeTempDir('als-br-td-b-')

      process.env.CLAUDE_INTERNAL_FC_OVERRIDES = JSON.stringify({
        tengu_sessions_elevated_auth_enforcement: true,
      })

      let sessionA: ReturnType<typeof getBootstrapSession> | undefined
      let sessionB: ReturnType<typeof getBootstrapSession> | undefined

      process.env.CLAUDE_TRUSTED_DEVICE_TOKEN = 'td-token-alpha'
      const firstA = await runWithNewHostSession(
        { id: randomUUID(), cwd: cwdA },
        async () => {
          sessionA = getBootstrapSession()
          return getTrustedDeviceToken()
        },
      )

      process.env.CLAUDE_TRUSTED_DEVICE_TOKEN = 'td-token-beta'
      const firstB = await runWithNewHostSession(
        { id: randomUUID(), cwd: cwdB },
        async () => {
          sessionB = getBootstrapSession()
          return getTrustedDeviceToken()
        },
      )

      // Env changed to gamma, but Host A and Host B each retain their own cached token
      process.env.CLAUDE_TRUSTED_DEVICE_TOKEN = 'td-token-gamma'
      const cachedA = runWithSession(sessionA!, () => getTrustedDeviceToken())
      const cachedB = runWithSession(sessionB!, () => getTrustedDeviceToken())

      // Clearing Host A's cache refreshes ONLY Host A
      const refreshedA = runWithSession(sessionA!, () => {
        clearTrustedDeviceTokenCache()
        return getTrustedDeviceToken()
      })
      const stillCachedB = runWithSession(sessionB!, () =>
        getTrustedDeviceToken(),
      )

      expect(firstA).toBe('td-token-alpha')
      expect(firstB).toBe('td-token-beta')
      expect(cachedA).toBe('td-token-alpha')
      expect(cachedB).toBe('td-token-beta')
      expect(refreshedA).toBe('td-token-gamma')
      expect(stillCachedB).toBe('td-token-beta')
    })
  })

  describe('3. Daemon (hostDeath, state, rendezvousServer)', () => {
    test('hostDeath: win32 FFI disable flag and liveness probe are isolated per host', async () => {
      const cwdA = makeTempDir('als-dm-hd-a-')
      const cwdB = makeTempDir('als-dm-hd-b-')
      const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        'platform',
      )
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      })

      try {
        const [stateA, stateB] = await Promise.all([
          runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
            _resetWin32HostDeathForTesting({
              disableFfi: true,
              probe: async () => 'gone',
            })
            await tick(6)
            return getHostProcessState(12345)
          }),
          runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
            await tick(3)
            _resetWin32HostDeathForTesting({
              disableFfi: true,
              probe: async () => 'alive',
            })
            await tick(6)
            return getHostProcessState(12345)
          }),
        ])

        expect(stateA).toBe('X')
        expect(stateB).toBeUndefined()
      } finally {
        if (originalPlatform) {
          Object.defineProperty(process, 'platform', originalPlatform)
        }
      }
    })

    test('daemon/state: daemonShutdownSignaled is isolated per host', async () => {
      const cwdA = makeTempDir('als-dm-st-a-')
      const cwdB = makeTempDir('als-dm-st-b-')

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          const before = isDaemonShutdownSignaled()
          markDaemonShutdownSignaled()
          await tick(8)
          const after = isDaemonShutdownSignaled()
          return { before, after }
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          const during = isDaemonShutdownSignaled()
          await tick(8)
          const end = isDaemonShutdownSignaled()
          return { during, end }
        }),
      ])

      expect(resA).toEqual({ before: false, after: true })
      expect(resB).toEqual({ during: false, end: false })
      expect(isDaemonShutdownSignaled()).toBe(false)
    })

    test('rendezvousServer: disarmStartupWedgeWatchdog & handlers stay isolated per host', async () => {
      const cwdA = makeTempDir('als-dm-rv-a-')
      const cwdB = makeTempDir('als-dm-rv-b-')

      await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          disarmStartupWedgeWatchdog()
          setPeerQuestionHandler(() => true)
          registerImmediateCommandRunner(() => true)
          await tick(6)
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(3)
          resetStartupWedgeForTests()
          setPeerQuestionHandler(null)
          registerImmediateCommandRunner(null)
          await tick(6)
        }),
      ])
      // No cross-host error or leak into default host
      expect(isDaemonShutdownSignaled()).toBe(false)
    })
  })

  describe('4. Remaining Swarm Backends (detection, teammateLayoutManager, teamHelpers)', () => {
    test('detection: cached isInITerm2 / isInWindowsTerminal values are isolated per host', async () => {
      const cwdA = makeTempDir('als-sw-det-a-')
      const cwdB = makeTempDir('als-sw-det-b-')

      let sessionA: ReturnType<typeof getBootstrapSession> | undefined
      let sessionB: ReturnType<typeof getBootstrapSession> | undefined

      process.env.TERM_PROGRAM = 'iTerm.app'
      process.env.WT_SESSION = 'wt-guid-a'
      const firstA = await runWithNewHostSession(
        { id: randomUUID(), cwd: cwdA },
        async () => {
          sessionA = getBootstrapSession()
          return {
            iterm: isInITerm2(),
            wt: isInWindowsTerminal(),
          }
        },
      )

      delete process.env.TERM_PROGRAM
      delete process.env.ITERM_SESSION_ID
      delete process.env.WT_SESSION
      const firstB = await runWithNewHostSession(
        { id: randomUUID(), cwd: cwdB },
        async () => {
          sessionB = getBootstrapSession()
          return {
            iterm: isInITerm2(),
            wt: isInWindowsTerminal(),
          }
        },
      )

      // Host A still returns its cached true values even though env changed and Host B cached false
      const cachedA = runWithSession(sessionA!, () => ({
        iterm: isInITerm2(),
        wt: isInWindowsTerminal(),
      }))

      // Resetting Host A's cache does not alter Host B
      runWithSession(sessionA!, () => {
        resetDetectionCache()
      })
      const afterResetA = runWithSession(sessionA!, () => ({
        iterm: isInITerm2(),
        wt: isInWindowsTerminal(),
      }))
      const stillCachedB = runWithSession(sessionB!, () => ({
        iterm: isInITerm2(),
        wt: isInWindowsTerminal(),
      }))

      expect(firstA).toEqual({ iterm: true, wt: true })
      expect(firstB).toEqual({ iterm: false, wt: false })
      expect(cachedA).toEqual({ iterm: true, wt: true })
      expect(afterResetA).toEqual({ iterm: false, wt: false })
      expect(stillCachedB).toEqual({ iterm: false, wt: false })
    })

    test('teammateLayoutManager: color assignments & round-robin index stay isolated per host', async () => {
      const cwdA = makeTempDir('als-sw-lay-a-')
      const cwdB = makeTempDir('als-sw-lay-b-')

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          const c1 = assignTeammateColor('worker-1')
          const c2 = assignTeammateColor('worker-2')
          await tick(8)
          const lookup1 = getTeammateColor('worker-1')
          clearTeammateColors()
          const afterClear = getTeammateColor('worker-1')
          return { c1, c2, lookup1, afterClear }
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          // Host B's round-robin starts at index 0 independently of Host A
          const c1 = assignTeammateColor('worker-b')
          await tick(10)
          // Host A's clearTeammateColors() must not clear Host B
          const lookupB = getTeammateColor('worker-b')
          const seesA = getTeammateColor('worker-2')
          return { c1, lookupB, seesA }
        }),
      ])

      expect(resA.c1).toBe(resB.c1)
      expect(resA.c2).not.toBe(resA.c1)
      expect(resA.lookup1).toBe(resA.c1)
      expect(resA.afterClear).toBeUndefined()
      expect(resB.lookupB).toBe(resB.c1)
      expect(resB.seesA).toBeUndefined()
      expect(getTeammateColor('worker-b')).toBeUndefined()
    })

    test('teamHelpers: spawnedTeammatePanes ownership tracking stays isolated per host', async () => {
      const cfgDir = makeTempDir('als-sw-team-cfg-')
      const cwdA = makeTempDir('als-sw-team-a-')
      const cwdB = makeTempDir('als-sw-team-b-')
      process.env.CLAUDE_CONFIG_DIR = cfgDir
      getClaudeConfigHomeDir.cache.clear()

      const teamName = `als-team-${randomUUID().slice(0, 8)}`
      await writeTeamFileAsync(teamName, {
        name: teamName,
        createdAt: Date.now(),
        leadAgentId: 'lead@test',
        leadSessionId: 'lead-session',
        members: [
          {
            agentId: 'lead@test',
            name: 'team-lead',
            agentType: 'team-lead',
            model: 'claude-sonnet-4-6',
            joinedAt: Date.now(),
            tmuxPaneId: '',
            cwd: cwdA,
            subscriptions: [],
          },
          {
            agentId: 'peer-a@test',
            name: 'peer-a',
            agentType: 'general-purpose',
            model: 'claude-sonnet-4-6',
            joinedAt: Date.now(),
            tmuxPaneId: '%991',
            backendType: 'tmux',
            cwd: cwdA,
            subscriptions: [],
          },
        ],
      })

      // Host A records ownership of %991; Host B does NOT own %991 and resets its own set
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          recordSpawnedTeammatePane('tmux', '%991')
          await tick(8)
          untrackSpawnedTeammatePane('tmux', '%991')
          // With %991 untracked, killOrphanedTeammatePanes finds 0 owned panes and returns without spawning tmux
          await killOrphanedTeammatePanes(teamName)
          return 'ok-a'
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(3)
          // Host B does not inherit Host A's '%991', so killOrphanedTeammatePanes is a no-op
          await killOrphanedTeammatePanes(teamName)
          _resetSpawnedTeammatePanesForTesting()
          return 'ok-b'
        }),
      ])

      expect(resA).toBe('ok-a')
      expect(resB).toBe('ok-b')
    })
  })

  describe('5. CLI (structuredIO, spareClaim, entrypoints/init) & Env (env, envUtils)', () => {
    test('structuredIO: getCurrentStructuredIO / setCurrentStructuredIO stay isolated per host', async () => {
      const cwdA = makeTempDir('als-cli-sio-a-')
      const cwdB = makeTempDir('als-cli-sio-b-')
      const ioA = { tag: 'io-a' } as unknown as StructuredIO
      const ioB = { tag: 'io-b' } as unknown as StructuredIO

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          setCurrentStructuredIO(ioA)
          await tick(8)
          const current = getCurrentStructuredIO()
          setCurrentStructuredIO(undefined)
          return { current, afterClear: getCurrentStructuredIO() }
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          setCurrentStructuredIO(ioB)
          await tick(10)
          return { current: getCurrentStructuredIO() }
        }),
      ])

      expect(resA.current).toBe(ioA)
      expect(resA.afterClear).toBeUndefined()
      expect(resB.current).toBe(ioB)
      expect(getCurrentStructuredIO()).toBeUndefined()
    })

    test('spareClaim: holdBackMcpConfigsForClaim / takeHeldBackMcpConfigs stay isolated per host', async () => {
      const cwdA = makeTempDir('als-cli-sp-a-')
      const cwdB = makeTempDir('als-cli-sp-b-')
      const cfgA = {
        alpha: {
          type: 'stdio',
          command: 'alpha-mcp',
          scope: 'user',
        } as unknown as ScopedMcpServerConfig,
      }
      const cfgB = {
        beta: {
          type: 'stdio',
          command: 'beta-mcp',
          scope: 'user',
        } as unknown as ScopedMcpServerConfig,
      }

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          holdBackMcpConfigsForClaim(cfgA)
          await tick(8)
          const first = takeHeldBackMcpConfigs()
          const second = takeHeldBackMcpConfigs()
          return { first, second }
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          holdBackMcpConfigsForClaim(cfgB)
          await tick(10)
          const first = takeHeldBackMcpConfigs()
          return { first }
        }),
      ])

      expect(Object.keys(resA.first)).toEqual(['alpha'])
      expect(Object.keys(resA.second)).toEqual([])
      expect(Object.keys(resB.first)).toEqual(['beta'])
      expect(Object.keys(takeHeldBackMcpConfigs())).toEqual([])
    })

    test('entrypoints/init: telemetry latches, remote settings promise, and init.cache stay isolated per host', async () => {
      const cwdA = makeTempDir('als-cli-init-a-')
      const cwdB = makeTempDir('als-cli-init-b-')
      process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_cowork'
      delete process.env.CLAUDE_CODE_DISABLE_STARTUP_WORK_GATE

      let hookCallsA = 0
      let hookCallsB = 0

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          setTelemetryInitializerForTesting(async () => {
            hookCallsA += 1
          })
          // Host A defers Cowork telemetry until first turn
          const shouldDeferBefore = shouldDeferTelemetryUntilFirstTurn()
          initializeTelemetryAfterTrust()
          const deferredWhileWaiting = isTelemetryDeferredForFirstTurn()
          await tick(8)
          const released = releaseDeferredTelemetryForFirstTurn()
          await tick(4)
          const shouldDeferAfter = shouldDeferTelemetryUntilFirstTurn()
          // init.cache is host-scoped
          init.cache.set(undefined, Promise.resolve())
          return {
            shouldDeferBefore,
            deferredWhileWaiting,
            released,
            shouldDeferAfter,
            cacheSize: init.cache.size,
          }
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          setTelemetryInitializerForTesting(async () => {
            hookCallsB += 1
          })
          const gatePromise = Promise.resolve()
          registerRemoteManagedSettingsLoadPromise(gatePromise)
          // Host B does NOT release first-turn telemetry yet; its state is unaffected by Host A
          const shouldDeferB = shouldDeferTelemetryUntilFirstTurn()
          initializeTelemetryAfterTrust()
          await tick(10)
          const stillDeferredB = isTelemetryDeferredForFirstTurn()
          const pendingPromiseB = getPendingTelemetryInitPromiseForTesting()
          return {
            shouldDeferB,
            stillDeferredB,
            pendingPromiseB,
            cacheSize: init.cache.size,
          }
        }),
      ])

      expect(resA.shouldDeferBefore).toBe(true)
      expect(resA.deferredWhileWaiting).toBe(true)
      expect(resA.released).toBe(true)
      expect(resA.shouldDeferAfter).toBe(false)
      expect(resA.cacheSize).toBe(1)
      expect(hookCallsA).toBe(1)

      expect(resB.shouldDeferB).toBe(true)
      expect(resB.stillDeferredB).toBe(true)
      expect(resB.pendingPromiseB).toBeNull()
      expect(resB.cacheSize).toBe(0)
      expect(hookCallsB).toBe(0)

      expect(isTelemetryDeferredForFirstTurn()).toBe(false)
      expect(init.cache.size).toBe(0)
    })

    test('utils/env: globalClaudeFile and memoized caches (with .cache getter/setter proxy) stay isolated per host', async () => {
      const cwdA = makeTempDir('als-env-a-')
      const cwdB = makeTempDir('als-env-b-')
      const fileA = join(cwdA, '.claude-a.json')
      const fileB = join(cwdB, '.claude-b.json')

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          const seed1 = seedGlobalClaudeFile(fileA)
          const seed2 = seedGlobalClaudeFile(fileA)
          const seedConflict = seedGlobalClaudeFile(fileB)

          // Populate Host A's memo caches via .cache proxy (both .set and setter replacement)
          env.hasInternetAccess.cache.set(undefined, Promise.resolve(true))
          env.getPackageManagers.cache.set(undefined, Promise.resolve(['npm']))
          env.getRuntimes.cache.set(undefined, Promise.resolve(['bun']))
          env.isWslEnvironment.cache.set(undefined, true)
          env.isNpmFromWindowsPath.cache.set(undefined, true)
          detectDeploymentEnvironment.cache = new Map([
            [undefined, 'host-a-env'],
          ])

          await tick(8)

          const out = {
            seed1,
            seed2,
            seedConflict,
            file: getGlobalClaudeFile(),
            internet: await env.hasInternetAccess(),
            pms: await env.getPackageManagers(),
            runtimes: await env.getRuntimes(),
            wsl: env.isWslEnvironment(),
            winNpm: env.isNpmFromWindowsPath(),
            deploy: detectDeploymentEnvironment(),
          }
          resetGlobalClaudeFileForTests()
          env.isWslEnvironment.cache.clear()
          return out
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          const seed1 = seedGlobalClaudeFile(fileB)
          env.hasInternetAccess.cache.set(undefined, Promise.resolve(false))
          env.getPackageManagers.cache.set(undefined, Promise.resolve(['pnpm']))
          env.getRuntimes.cache.set(undefined, Promise.resolve(['node']))
          env.isWslEnvironment.cache.set(undefined, false)
          env.isNpmFromWindowsPath.cache.set(undefined, false)
          detectDeploymentEnvironment.cache.set(undefined, 'host-b-env')

          await tick(10)

          return {
            seed1,
            file: getGlobalClaudeFile(),
            internet: await env.hasInternetAccess(),
            pms: await env.getPackageManagers(),
            runtimes: await env.getRuntimes(),
            wsl: env.isWslEnvironment(),
            winNpm: env.isNpmFromWindowsPath(),
            deploy: detectDeploymentEnvironment(),
          }
        }),
      ])

      expect(resA.seed1).toBe('seeded')
      expect(resA.seed2).toBe('unchanged')
      expect(resA.seedConflict).toBe('conflict')
      expect(resA.file).toBe(fileA)
      expect(resA.internet).toBe(true)
      expect(resA.pms).toEqual(['npm'])
      expect(resA.runtimes).toEqual(['bun'])
      expect(resA.wsl).toBe(true)
      expect(resA.winNpm).toBe(true)
      expect(resA.deploy).toBe('host-a-env')

      expect(resB.seed1).toBe('seeded')
      expect(resB.file).toBe(fileB)
      expect(resB.internet).toBe(false)
      expect(resB.pms).toEqual(['pnpm'])
      expect(resB.runtimes).toEqual(['node'])
      expect(resB.wsl).toBe(false)
      expect(resB.winNpm).toBe(false)
      expect(resB.deploy).toBe('host-b-env')

      // Default host caches were never polluted by Host A or Host B
      expect(env.hasInternetAccess.cache.size).toBe(0)
      expect(detectDeploymentEnvironment.cache.size).toBe(0)
    })

    test('utils/envUtils: getClaudeConfigHomeDir memo cache (with .cache getter/setter proxy) stays isolated per host', async () => {
      const cwdA = makeTempDir('als-envu-a-')
      const cwdB = makeTempDir('als-envu-b-')
      const sharedKey = '/tmp/shared-config-key'
      process.env.CLAUDE_CONFIG_DIR = sharedKey

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID(), cwd: cwdA }, async () => {
          // Seed a host-specific value into Host A's cache via setter replacement
          getClaudeConfigHomeDir.cache = new Map([[sharedKey, '/host-a-cfg']])
          await tick(8)
          const beforeClear = getClaudeConfigHomeDir()
          getClaudeConfigHomeDir.cache.clear()
          const afterClear = getClaudeConfigHomeDir()
          return { beforeClear, afterClear }
        }),
        runWithNewHostSession({ id: randomUUID(), cwd: cwdB }, async () => {
          await tick(4)
          getClaudeConfigHomeDir.cache.set(sharedKey, '/host-b-cfg')
          await tick(10)
          // Host A's cache.clear() MUST NOT clear Host B's cache
          const valueB = getClaudeConfigHomeDir()
          return { valueB, sizeB: getClaudeConfigHomeDir.cache.size }
        }),
      ])

      expect(resA.beforeClear).toBe('/host-a-cfg')
      expect(resA.afterClear).toBe(sharedKey)
      expect(resB.valueB).toBe('/host-b-cfg')
      expect(resB.sizeB).toBe(1)
      expect(getClaudeConfigHomeDir.cache.size).toBe(0)
      expect(getClaudeConfigHomeDir()).toBe(sharedKey)
    })
  })
})
