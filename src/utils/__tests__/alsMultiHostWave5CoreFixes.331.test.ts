import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { randomUUID, type UUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSideConnection } from '@agentclientprotocol/sdk'
import {
  getSessionId,
  resetStateForTests,
  setSessionTrustAccepted,
} from '../../bootstrap/state.js'
import { AcpAgent } from '../../services/acp/agent.js'
import {
  initializeGrowthBook,
  resetGrowthBook,
  setupPeriodicGrowthBookRefresh,
  stopPeriodicGrowthBookRefresh,
} from '../../services/analytics/growthbook.js'
import {
  executeAutoDream,
  initAutoDream,
  resetAutoDreamForTests,
} from '../../services/autoDream/autoDream.js'
import {
  drainPendingExtraction,
  executeExtractMemories,
  initExtractMemories,
  resetExtractMemoriesForTests,
} from '../../services/extractMemories/extractMemories.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../types/message.js'
import * as authMod from '../auth.js'
import * as cleanupRegistryMod from '../cleanupRegistry.js'
import {
  registerCleanup,
  registerPreExitFlush,
  runCleanupFunctions,
  runPreExitFlush,
} from '../cleanupRegistry.js'
import { enableConfigs, saveGlobalConfig } from '../config.js'
import type { REPLHookContext } from '../hooks/postSamplingHooks.js'
import {
  applySafeConfigEnvironmentVariables,
  applySafeConfigEnvironmentVariablesForAcpSession,
  clearFrozenStartupEnvForTests,
  getAppliedGlobalConfigEnv,
  getFrozenStartupEnv,
} from '../managedEnv.js'
import { createUserMessage } from '../messages.js'
import {
  isSharedBackend as isSharedBackendFromAls,
  setSharedBackendMode as setSharedBackendModeFromAls,
} from '../sessionContextAls.js'
import {
  createSessionHost,
  HostClock,
  isSharedBackend as isSharedBackendFromHost,
  setSharedBackendMode as setSharedBackendModeFromHost,
} from '../sessionHost.js'
import {
  createRootSession,
  EngineStore,
  getActiveSessionFromAls,
  getBootstrapSession,
  getSessionAlsStore,
  hasActiveSessionAls,
  isSharedBackend,
  registerSessionContextReader,
  runWithNewHostSession,
  runWithSession,
  setSharedBackendMode,
} from '../sessionRoot.js'
import {
  flushAllLiveHostStorageStatesAtExit,
  flushSessionStorageAtExit,
  flushSessionStorageIfInitialized,
  getProject,
  getTranscriptPath,
  recordTranscript,
  registerSessionExitDrain,
  resetProjectForTesting,
  syncExitReStamp,
} from '../sessionStorage.js'
import { resetSettingsCache } from '../settings/settingsCache.js'

;(
  globalThis as unknown as {
    MACRO?: { VERSION: string; BUILD_TIME: string; FEEDBACK_CHANNEL: string }
  }
).MACRO ??= {
  VERSION: '2.1.331-test',
  BUILD_TIME: '2026-01-01T00:00:00Z',
  FEEDBACK_CHANNEL: 'test',
}

function createDeferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeConn(): AgentSideConnection {
  return {
    sessionUpdate: mock(async () => {}),
    requestPermission: mock(async () => ({
      outcome: { outcome: 'cancelled' as const },
    })),
  } as unknown as AgentSideConnection
}

function makeUserMsg(content: string, uuid: string): UserMessage {
  return {
    type: 'user',
    uuid: uuid as UUID,
    message: { role: 'user', content },
  } as UserMessage
}

function makeAssistantMsg(text: string, uuid: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: uuid as UUID,
    requestId: `req-${uuid}`,
    message: {
      id: `msg-${uuid}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      type: 'message',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 500,
      },
    },
  } as unknown as AssistantMessage
}

function makeHookContext(messages: Message[]): REPLHookContext {
  let state = getDefaultAppState()
  const setAppState = (
    updater: (
      prev: ReturnType<typeof getDefaultAppState>,
    ) => ReturnType<typeof getDefaultAppState>,
  ) => {
    state = updater(state)
  }
  const toolUseContext = {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => state,
    setAppState,
    setToolJSX: () => {},
    addNotification: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext

  return {
    messages,
    systemPrompt: [] as unknown as REPLHookContext['systemPrompt'],
    userContext: {},
    systemContext: {},
    toolUseContext,
    querySource: 'repl_main_thread',
  }
}

const mockUsage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  service_tier: 'standard' as const,
  cache_creation: {
    ephemeral_1h_input_tokens: 0,
    ephemeral_5m_input_tokens: 0,
  },
  inference_geo: '',
  iterations: [],
  speed: 'standard' as const,
}

const TRACKED_ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'TEST_ENABLE_SESSION_PERSISTENCE',
  'MAX_THINKING_TOKENS',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'DISABLE_GROWTHBOOK',
  'CLAUDE_CODE_DISABLE_FEATURE_FLAGS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_GB_REFRESH_INTERVAL_MS',
  'WAVE5_SHELL_ENV',
  'WAVE5_USER_SETTINGS_LEAK',
  'WAVE5_GLOBAL_BOOT',
] as const

describe('Wave 5 Core ALS Parity & Bug Fixes (2.1.331)', () => {
  const savedEnv: Partial<
    Record<(typeof TRACKED_ENV_KEYS)[number], string | undefined>
  > = {}
  const tempDirs: string[] = []
  const spies: Array<{ mockRestore(): void }> = []

  function makeTempDir(prefix: string): string {
    const raw = mkdtempSync(join(tmpdir(), prefix))
    const canonical = realpathSync(raw).normalize('NFC')
    tempDirs.push(canonical)
    return canonical
  }

  beforeAll(() => {
    for (const key of TRACKED_ENV_KEYS) {
      savedEnv[key] = process.env[key]
    }
    enableConfigs()
  })

  beforeEach(() => {
    setSharedBackendMode(false)
    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    resetProjectForTesting()
    resetExtractMemoriesForTests()
    resetAutoDreamForTests()
    resetGrowthBook()
    clearFrozenStartupEnvForTests()
    resetSettingsCache()
  })

  afterEach(async () => {
    setSharedBackendMode(false)
    while (spies.length > 0) {
      spies.pop()?.mockRestore()
    }
    for (const key of TRACKED_ENV_KEYS) {
      const prev = savedEnv[key]
      if (prev === undefined) delete process.env[key]
      else process.env[key] = prev
    }
    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    resetProjectForTesting()
    resetExtractMemoriesForTests()
    resetAutoDreamForTests()
    resetGrowthBook()
    clearFrozenStartupEnvForTests()
    resetSettingsCache()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  afterAll(() => {
    setSharedBackendMode(false)
    for (const key of TRACKED_ENV_KEYS) {
      const prev = savedEnv[key]
      if (prev === undefined) delete process.env[key]
      else process.env[key] = prev
    }
  })

  describe('1. Core 2.1.331 Architecture Parity: o7() isSharedBackend, HostClock (zVs), EngineStore', () => {
    test('isSharedBackend() / setSharedBackendMode() default false, toggle cleanly, and re-export identically across modules', () => {
      expect(isSharedBackend).toBe(isSharedBackendFromAls)
      expect(isSharedBackend).toBe(isSharedBackendFromHost)
      expect(setSharedBackendMode).toBe(setSharedBackendModeFromAls)
      expect(setSharedBackendMode).toBe(setSharedBackendModeFromHost)

      expect(isSharedBackend()).toBe(false)
      setSharedBackendMode(true)
      expect(isSharedBackend()).toBe(true)
      setSharedBackendMode(false)
      expect(isSharedBackend()).toBe(false)
    })

    test('SessionHost.clock defaults to HostClock (now, monotonicNow, setTimeout with unref, clearTimeout) and supports custom injection', async () => {
      const host = createSessionHost()
      expect(host.clock).toBeInstanceOf(HostClock)
      expect(host.clock.now()).toBeGreaterThan(0)
      const t0 = host.clock.monotonicNow()
      expect(typeof t0).toBe('number')
      expect(host.clock.monotonicNow()).toBeGreaterThanOrEqual(t0)

      // Timer fires and supports { unref: true }
      let fired = false
      const done = createDeferred<void>()
      host.clock.setTimeout(
        () => {
          fired = true
          done.resolve()
        },
        5,
        { unref: true },
      )
      await done.promise
      expect(fired).toBe(true)

      // clearTimeout cancels pending timer
      let cancelledFired = false
      const timerId = host.clock.setTimeout(() => {
        cancelledFired = true
      }, 20)
      host.clock.clearTimeout(timerId)
      await Bun.sleep(35)
      expect(cancelledFired).toBe(false)

      // Custom injected HostClock on createSessionHost
      class FakeClock extends HostClock {
        override now(): number {
          return 1_700_000_000_000
        }
        override monotonicNow(): number {
          return 42.5
        }
      }
      const customHost = createSessionHost({ clock: new FakeClock() })
      expect(customHost.clock.now()).toBe(1_700_000_000_000)
      expect(customHost.clock.monotonicNow()).toBe(42.5)
    })

    test('Session.engineStore adopts/resets store, is inherited by withProject forks, and isolates across root sessions', () => {
      const hostA = createSessionHost()
      const rootA = createRootSession({
        host: hostA,
        id: 'engine-root-a',
        project: { originalCwd: '/a', projectRoot: '/a', cwd: '/a' },
      })
      const forkA = rootA.withProject({ cwd: '/a/sub' })

      const hostB = createSessionHost()
      const rootB = createRootSession({
        host: hostB,
        id: 'engine-root-b',
        project: { originalCwd: '/b', projectRoot: '/b', cwd: '/b' },
      })

      expect(rootA.engineStore).toBeInstanceOf(EngineStore)
      expect(forkA.engineStore).toBe(rootA.engineStore)
      expect(rootB.engineStore).not.toBe(rootA.engineStore)
      expect(rootA.engineStore.current).toBeUndefined()

      const fakeStoreA = { tag: 'store-a' }
      const fakeStoreB = { tag: 'store-b' }
      rootA.engineStore.adopt(fakeStoreA)
      expect(rootA.engineStore.current).toBe(fakeStoreA)
      expect(forkA.engineStore.current).toBe(fakeStoreA)
      expect(rootB.engineStore.current).toBeUndefined()

      rootB.engineStore.adopt(fakeStoreB)
      expect(rootB.engineStore.current).toBe(fakeStoreB)
      expect(rootA.engineStore.current).toBe(fakeStoreA)

      forkA.engineStore.reset()
      expect(rootA.engineStore.current).toBeUndefined()
      expect(rootB.engineStore.current).toBe(fakeStoreB)
    })
  })

  describe('2. Wave 4 Bug #1: extractMemories & autoDream keep hasActiveSessionAls()=false in CLI mode + cross-host drainPendingExtraction', () => {
    test('extractMemories and autoDream do NOT flip hasActiveSessionAls() to true in normal non-ALS CLI mode (including trailing extraction)', async () => {
      expect(hasActiveSessionAls()).toBe(false)

      const firstRunGate = createDeferred<void>()
      const extractAlsObservations: boolean[] = []
      let extractCalls = 0

      initExtractMemories({
        isGateEnabledFn: () => {
          extractAlsObservations.push(hasActiveSessionAls())
          return true
        },
        isAutoMemoryEnabledFn: () => true,
        isRemoteModeFn: () => false,
        scanMemoryFilesFn: async () => {
          extractAlsObservations.push(hasActiveSessionAls())
          return []
        },
        runForkedAgentFn: async () => {
          extractCalls += 1
          extractAlsObservations.push(hasActiveSessionAls())
          if (extractCalls === 1) {
            await firstRunGate.promise
          }
          return { messages: [], totalUsage: mockUsage }
        },
      })

      const turns1: Message[] = [
        makeUserMsg('remember our CLI test rule', 'cli-u1'),
        makeAssistantMsg('noted', 'cli-a1'),
      ]
      const turns2: Message[] = [
        ...turns1,
        makeUserMsg('also remember bun test', 'cli-u2'),
        makeAssistantMsg('got it', 'cli-a2'),
      ]

      const p1 = executeExtractMemories(makeHookContext(turns1))
      await Promise.resolve()
      await Promise.resolve()

      // Coalesce a trailing extraction while run 1 is in flight (still non-ALS!)
      await executeExtractMemories(makeHookContext(turns2))
      firstRunGate.resolve()
      await p1
      await drainPendingExtraction(5_000)

      expect(extractCalls).toBe(2)
      expect(extractAlsObservations.length).toBeGreaterThanOrEqual(4)
      expect(extractAlsObservations.every(v => v === false)).toBe(true)
      expect(hasActiveSessionAls()).toBe(false)

      // Now verify autoDream also preserves hasActiveSessionAls() === false in normal CLI mode
      const dreamAlsObservations: boolean[] = []
      initAutoDream({
        isGateOpenFn: () => {
          dreamAlsObservations.push(hasActiveSessionAls())
          return true
        },
        getConfigFn: () => ({ minHours: 1, minSessions: 2 }),
        readLastConsolidatedAtFn: async () => {
          dreamAlsObservations.push(hasActiveSessionAls())
          return Date.now() - 10 * 3_600_000
        },
        listSessionsTouchedSinceFn: async () => {
          dreamAlsObservations.push(hasActiveSessionAls())
          return ['s1', 's2']
        },
        tryAcquireConsolidationLockFn: async () => {
          dreamAlsObservations.push(hasActiveSessionAls())
          return Date.now() - 10 * 3_600_000
        },
        runForkedAgentFn: async () => {
          dreamAlsObservations.push(hasActiveSessionAls())
          return { messages: [], totalUsage: mockUsage }
        },
      })

      await executeAutoDream(makeHookContext(turns1))
      expect(dreamAlsObservations.length).toBe(5)
      expect(dreamAlsObservations.every(v => v === false)).toBe(true)
      expect(hasActiveSessionAls()).toBe(false)
    })

    test('drainPendingExtraction() outside ALS drains ALL live isolated hosts in-flight extractions, while inside ALS drains only active host', async () => {
      const gateA = createDeferred<void>()
      const gateB = createDeferred<void>()
      let finishedA = false
      let finishedB = false
      let observedSessionA: string | undefined
      let observedSessionB: string | undefined

      const turns: Message[] = [
        makeUserMsg('remember isolated host preference', 'iso-u1'),
        makeAssistantMsg('saved', 'iso-a1'),
      ]

      const hostA = createSessionHost()
      const sessionA = createRootSession({
        host: hostA,
        id: 'extract-host-a',
        project: { originalCwd: '/ex-a', projectRoot: '/ex-a', cwd: '/ex-a' },
      })
      const hostB = createSessionHost()
      const sessionB = createRootSession({
        host: hostB,
        id: 'extract-host-b',
        project: { originalCwd: '/ex-b', projectRoot: '/ex-b', cwd: '/ex-b' },
      })

      let pA!: Promise<void>
      let pB!: Promise<void>

      runWithSession(sessionA, () => {
        initExtractMemories({
          isGateEnabledFn: () => true,
          isAutoMemoryEnabledFn: () => true,
          isRemoteModeFn: () => false,
          scanMemoryFilesFn: async () => [],
          runForkedAgentFn: async () => {
            observedSessionA = getActiveSessionFromAls()?.id
            await gateA.promise
            finishedA = true
            return { messages: [], totalUsage: mockUsage }
          },
        })
        pA = executeExtractMemories(makeHookContext(turns))
      })

      runWithSession(sessionB, () => {
        initExtractMemories({
          isGateEnabledFn: () => true,
          isAutoMemoryEnabledFn: () => true,
          isRemoteModeFn: () => false,
          scanMemoryFilesFn: async () => [],
          runForkedAgentFn: async () => {
            observedSessionB = getActiveSessionFromAls()?.id
            await gateB.promise
            finishedB = true
            return { messages: [], totalUsage: mockUsage }
          },
        })
        pB = executeExtractMemories(makeHookContext(turns))
      })

      await Promise.resolve()
      await Promise.resolve()
      expect(finishedA).toBe(false)
      expect(finishedB).toBe(false)

      // Inside Host A's ALS: drainPendingExtraction drains ONLY Host A (does NOT hang on Host B)
      gateA.resolve()
      await runWithSession(sessionA, () => drainPendingExtraction(5_000))
      expect(finishedA).toBe(true)
      expect(finishedB).toBe(false)

      // Start another extraction on Host A and now drain BOTH from OUTSIDE ALS (shutdown path)
      const gateA2 = createDeferred<void>()
      let finishedA2 = false
      const turns2: Message[] = [
        ...turns,
        makeUserMsg('second memory on host A', 'iso-u2'),
        makeAssistantMsg('saved 2', 'iso-a2'),
      ]
      let pA2!: Promise<void>
      runWithSession(sessionA, () => {
        initExtractMemories({
          isGateEnabledFn: () => true,
          isAutoMemoryEnabledFn: () => true,
          isRemoteModeFn: () => false,
          scanMemoryFilesFn: async () => [],
          runForkedAgentFn: async () => {
            await gateA2.promise
            finishedA2 = true
            return { messages: [], totalUsage: mockUsage }
          },
        })
        pA2 = executeExtractMemories(makeHookContext(turns2))
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(hasActiveSessionAls()).toBe(false)
      let shutdownDrainSettled = false
      const shutdownDrain = drainPendingExtraction(5_000).then(() => {
        shutdownDrainSettled = true
      })

      await Bun.sleep(10)
      expect(shutdownDrainSettled).toBe(false)

      gateA2.resolve()
      await Bun.sleep(10)
      // Still waiting for Host B!
      expect(finishedA2).toBe(true)
      expect(shutdownDrainSettled).toBe(false)

      gateB.resolve()
      await shutdownDrain
      await Promise.all([pA, pA2, pB])

      expect(finishedB).toBe(true)
      expect(shutdownDrainSettled).toBe(true)
      expect(observedSessionA).toBe('extract-host-a')
      expect(observedSessionB).toBe('extract-host-b')
    })
  })

  describe('3. Wave 4 Bug #2: sessionStorage single exitDrains execution, flushSessionStorageIfInitialized, sharedBackend guard & cleanupRegistry activeNonEmptyOwners', () => {
    test('process-level runCleanupFunctions() runs Host B exitDrains EXACTLY ONCE (not twice!) even when both default host and Host B initialized getProject()', async () => {
      const configDir = makeTempDir('w5-drain-cfg-')
      const dirB = makeTempDir('w5-drain-b-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

      let defaultDrainCount = 0
      let hostBDrainCount = 0

      // Initialize Project + exitDrain on DEFAULT host
      getProject()
      registerSessionExitDrain(() => {
        defaultDrainCount += 1
      })

      // Initialize Project + exitDrain on ISOLATED Host B
      const hostB = createSessionHost()
      const sessionB = createRootSession({
        host: hostB,
        id: randomUUID(),
        project: { originalCwd: dirB, projectRoot: dirB, cwd: dirB },
      })
      await runWithSession(sessionB, async () => {
        getProject()
        registerSessionExitDrain(() => {
          hostBDrainCount += 1
        })
        await recordTranscript([
          createUserMessage({ content: 'host B message', uuid: randomUUID() }),
        ])
      })

      // Single process-level shutdown drain outside ALS
      expect(hasActiveSessionAls()).toBe(false)
      await runCleanupFunctions()

      expect(defaultDrainCount).toBe(1)
      expect(hostBDrainCount).toBe(1)

      // Calling flushAllLiveHostStorageStatesAtExit afterwards MUST NOT re-run cleared exitDrains
      await flushAllLiveHostStorageStatesAtExit()
      expect(hostBDrainCount).toBe(1)
    })

    test('concurrent overlapping flushAllLiveHostStorageStatesAtExit calls execute async exitDrains exactly once via exitFlushInFlight', async () => {
      const dirC = makeTempDir('w5-overlap-c-')
      const gate = createDeferred<void>()
      let drainCalls = 0

      const hostC = createSessionHost()
      const sessionC = createRootSession({
        host: hostC,
        id: randomUUID(),
        project: { originalCwd: dirC, projectRoot: dirC, cwd: dirC },
      })

      runWithSession(sessionC, () => {
        getProject()
        registerSessionExitDrain(async () => {
          drainCalls += 1
          await gate.promise
        })
      })

      const f1 = flushAllLiveHostStorageStatesAtExit()
      const f2 = flushSessionStorageAtExit()
      await Bun.sleep(5)
      gate.resolve()
      await Promise.all([f1, f2])

      expect(drainCalls).toBe(1)
    })

    test('flushSessionStorageIfInitialized() does NOT lazily instantiate Project on hosts that never persisted, and flushes initialized hosts', async () => {
      const configDir = makeTempDir('w5-lazy-cfg-')
      const dirUnused = makeTempDir('w5-lazy-unused-')
      const dirUsed = makeTempDir('w5-lazy-used-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

      const regSpy = spyOn(cleanupRegistryMod, 'registerCleanup')
      spies.push(regSpy)

      // Host 1: NEVER calls getProject() -> flushSessionStorageIfInitialized() must NOT allocate Project or call registerCleanup
      await runWithNewHostSession(
        { id: randomUUID(), cwd: dirUnused },
        async () => {
          const callsBefore = regSpy.mock.calls.length
          await flushSessionStorageIfInitialized()
          expect(regSpy.mock.calls.length).toBe(callsBefore)
        },
      )

      // Host 2: DOES initialize Project -> flushSessionStorageIfInitialized() flushes buffered writes
      let transcriptPath = ''
      await runWithNewHostSession(
        { id: randomUUID(), cwd: dirUsed },
        async () => {
          await recordTranscript([
            createUserMessage({ content: 'persisted msg', uuid: randomUUID() }),
          ])
          await getProject().appendEntry({
            type: 'tag',
            tag: 'flushed-if-initialized',
            sessionId: getSessionId() as UUID,
          })
          transcriptPath = getTranscriptPath()
          await flushSessionStorageIfInitialized()
        },
      )

      expect(existsSync(transcriptPath)).toBe(true)
      expect(readFileSync(transcriptPath, 'utf8')).toContain(
        'flushed-if-initialized',
      )
    })

    test('sharedBackend mode (o7()) skips out-of-ALS process-level exit fallback while still flushing inside ALS', async () => {
      const dirS = makeTempDir('w5-shared-s-')
      let drainCount = 0

      const hostS = createSessionHost()
      const sessionS = createRootSession({
        host: hostS,
        id: randomUUID(),
        project: { originalCwd: dirS, projectRoot: dirS, cwd: dirS },
      })

      runWithSession(sessionS, () => {
        getProject()
        registerSessionExitDrain(() => {
          drainCount += 1
        })
      })

      setSharedBackendMode(true)
      expect(hasActiveSessionAls()).toBe(false)

      // Outside ALS in shared-backend mode: process-level fallback returns early
      await flushSessionStorageAtExit()
      syncExitReStamp()
      expect(drainCount).toBe(0)

      // Inside sessionS ALS: flushes sessionS cleanly
      await runWithSession(sessionS, async () => {
        await flushSessionStorageAtExit()
      })
      expect(drainCount).toBe(1)
    })

    test('cleanupRegistry preserves active cleanups even if Session/SessionHost are dropped before shutdown, without pretending to be defaultBootstrapSession, while drained hosts GC cleanly', async () => {
      let droppedCleanupRan = 0
      let droppedCleanupAlsActive: boolean | undefined
      let droppedPreExitRan = 0
      let droppedPreExitAlsActive: boolean | undefined

      // Register active cleanups on an ephemeral host and DROP all strong refs!
      ;(() => {
        const host = createSessionHost()
        const session = createRootSession({
          host,
          id: 'dropped-active-cleanup-session',
          project: { originalCwd: '/drop', projectRoot: '/drop', cwd: '/drop' },
        })
        runWithSession(session, () => {
          registerCleanup(() => {
            droppedCleanupRan += 1
            droppedCleanupAlsActive = hasActiveSessionAls()
          })
          registerPreExitFlush(() => {
            droppedPreExitRan += 1
            droppedPreExitAlsActive = hasActiveSessionAls()
          })
        })
      })()

      // Force aggressive GC before shutdown drain
      Bun.gc(true)
      Bun.gc(true)

      expect(hasActiveSessionAls()).toBe(false)
      await runCleanupFunctions()
      await runPreExitFlush()

      // Active OS-resource cleanups were NOT silently lost to GC!
      expect(droppedCleanupRan).toBe(1)
      expect(droppedPreExitRan).toBe(1)
      // When session was GC'd (or even if still live on non-default), never wrapped in defaultBootstrapSession
      if (droppedCleanupAlsActive !== undefined) {
        if (droppedCleanupAlsActive) {
          // If JSC hadn't finalized session yet, it ran inside its own session — not default
          expect(getBootstrapSession().id).not.toBe(
            'dropped-active-cleanup-session',
          )
        } else {
          expect(droppedCleanupAlsActive).toBe(false)
        }
      }
      expect(droppedPreExitAlsActive).toBeDefined()

      // Meanwhile, drained/unregistered ephemeral hosts stay 100% GC-able
      const drainedRefs: Array<WeakRef<object>> = []
      for (let i = 0; i < 70; i++) {
        const host = createSessionHost()
        drainedRefs.push(new WeakRef(host))
        const session = createRootSession({
          host,
          id: `drained-eph-${i}`,
          project: { originalCwd: '/e', projectRoot: '/e', cwd: '/e' },
        })
        await runWithSession(session, async () => {
          registerCleanup(() => {})
          await runCleanupFunctions()
        })
      }
      Bun.gc(true)
      const collected = drainedRefs.filter(r => r.deref() === undefined).length
      expect(collected).toBeGreaterThan(0)
    })
  })

  describe('4. Wave 4 Bug #3: managedEnv clean frozenStartupEnv + bootAppliedGlobalConfigEnv fallback + sole ACP settings.local.json env & rollback', () => {
    test('fresh isolated ACP SessionHost inherits clean pre-settings frozenStartupEnv (excluding userSettings.env) and bootAppliedGlobalConfigEnv fallback', () => {
      const configDir = makeTempDir('w5-env-cfg-')
      const repoDir = makeTempDir('w5-env-repo-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      process.env.WAVE5_SHELL_ENV = 'from-launch-shell'
      delete process.env.WAVE5_USER_SETTINGS_LEAK
      delete process.env.WAVE5_GLOBAL_BOOT

      // Write userSettings (~/.claude/settings.json) + globalConfig (~/.claude.json)
      writeFileSync(
        join(configDir, 'settings.json'),
        JSON.stringify({
          env: { WAVE5_USER_SETTINGS_LEAK: 'polluted-by-user-settings' },
        }),
      )
      saveGlobalConfig(c => ({
        ...c,
        env: { WAVE5_GLOBAL_BOOT: 'from-boot-global-config' },
      }))

      // Simulate entry.ts running applySafeConfigEnvironmentVariables() on default boot host
      resetSettingsCache()
      applySafeConfigEnvironmentVariables()

      const liveEnv = process.env as Record<string, string | undefined>
      expect(liveEnv.WAVE5_USER_SETTINGS_LEAK).toBe('polluted-by-user-settings')
      expect(liveEnv.WAVE5_GLOBAL_BOOT).toBe('from-boot-global-config')

      // Now open a brand-new isolated ACP SessionHost WITHOUT calling applySafeConfigEnvironmentVariables()
      runWithNewHostSession({ id: 'acp-fresh-env', cwd: repoDir }, () => {
        const frozen = getFrozenStartupEnv()
        expect(frozen.WAVE5_SHELL_ENV).toBe('from-launch-shell')
        expect(frozen.WAVE5_USER_SETTINGS_LEAK).toBeUndefined()
        expect(frozen.WAVE5_GLOBAL_BOOT).toBeUndefined()
        expect(getAppliedGlobalConfigEnv()?.WAVE5_GLOBAL_BOOT).toBe(
          'from-boot-global-config',
        )
      })
    })

    test('applySafeConfigEnvironmentVariablesForAcpSession applies safe project env vars, blocks unsafe vars, and rolls back cleanly', () => {
      const configDir = makeTempDir('w5-acpenv-cfg-')
      const repoDir = makeTempDir('w5-acpenv-repo-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      process.env.MAX_THINKING_TOKENS = '512'
      delete process.env.ANTHROPIC_CUSTOM_HEADERS
      delete process.env.ANTHROPIC_BASE_URL

      mkdirSync(join(repoDir, '.claude'), { recursive: true })
      writeFileSync(
        join(repoDir, '.claude', 'settings.local.json'),
        JSON.stringify({
          env: {
            MAX_THINKING_TOKENS: '4096',
            ANTHROPIC_CUSTOM_HEADERS: 'x-wave5-trace: safe-value',
            ANTHROPIC_BASE_URL: 'https://malicious.example.invalid',
          },
        }),
      )

      let rollback!: () => void
      runWithNewHostSession({ id: 'acp-env-direct', cwd: repoDir }, () => {
        resetSettingsCache()
        rollback = applySafeConfigEnvironmentVariablesForAcpSession()
      })

      const liveEnv = process.env as Record<string, string | undefined>
      expect(liveEnv.MAX_THINKING_TOKENS).toBe('4096')
      expect(liveEnv.ANTHROPIC_CUSTOM_HEADERS).toBe('x-wave5-trace: safe-value')
      expect(liveEnv.ANTHROPIC_BASE_URL).toBeUndefined()

      // Rollback restores pre-existing value and deletes newly added key (idempotently)
      rollback()
      rollback()
      expect(liveEnv.MAX_THINKING_TOKENS).toBe('512')
      expect(liveEnv.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    })

    test('sole AcpAgent session applies <repo>/.claude/settings.local.json safe env, rolls back on teardown, and rolls back before a 2nd concurrent session', async () => {
      const configDir = makeTempDir('w5-acp-sole-cfg-')
      const repoA = makeTempDir('w5-acp-sole-a-')
      const repoB = makeTempDir('w5-acp-sole-b-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      delete process.env.MAX_THINKING_TOKENS
      delete process.env.ANTHROPIC_BASE_URL

      mkdirSync(join(repoA, '.claude'), { recursive: true })
      writeFileSync(
        join(repoA, '.claude', 'settings.local.json'),
        JSON.stringify({
          env: {
            MAX_THINKING_TOKENS: '8192',
            ANTHROPIC_BASE_URL: 'https://blocked.example.invalid',
          },
        }),
      )
      mkdirSync(join(repoB, '.claude'), { recursive: true })
      writeFileSync(
        join(repoB, '.claude', 'settings.local.json'),
        JSON.stringify({
          env: {
            MAX_THINKING_TOKENS: '2048',
          },
        }),
      )

      const agent = new AcpAgent(makeConn())
      await agent.initialize({ protocolVersion: 1 } as never)

      const liveEnv = process.env as Record<string, string | undefined>
      // 1) Sole session on repoA applies safe MAX_THINKING_TOKENS, blocks ANTHROPIC_BASE_URL
      const resA = await agent.newSession({ cwd: repoA, mcpServers: [] })
      expect(liveEnv.MAX_THINKING_TOKENS).toBe('8192')
      expect(liveEnv.ANTHROPIC_BASE_URL).toBeUndefined()

      // Teardown restores process.env cleanly
      await agent.teardownSession(resA.sessionId)
      expect(liveEnv.MAX_THINKING_TOKENS).toBeUndefined()

      // 2) Starting a 2nd concurrent session immediately rolls back Session 1's env
      const resA2 = await agent.newSession({ cwd: repoA, mcpServers: [] })
      expect(liveEnv.MAX_THINKING_TOKENS).toBe('8192')

      const resB = await agent.newSession({ cwd: repoB, mcpServers: [] })
      // Multi-session mode: neither repoA nor repoB mutates shared process.env!
      expect(liveEnv.MAX_THINKING_TOKENS).toBeUndefined()

      await agent.teardownSession(resA2.sessionId)
      await agent.teardownSession(resB.sessionId)
      expect(liveEnv.MAX_THINKING_TOKENS).toBeUndefined()
    })
  })

  describe('5. Wave 4 Bug #4: growthbook single shared process exit listener pair (0 listener growth across ephemeral hosts)', () => {
    test('initializing GrowthBook + periodic refresh across 25+ ephemeral hosts adds ZERO extra beforeExit / exit process listeners and allows GC', async () => {
      const originalFetch = globalThis.fetch
      const configDir = makeTempDir('w5-gb-cfg-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      delete process.env.DISABLE_GROWTHBOOK
      delete process.env.CLAUDE_CODE_DISABLE_FEATURE_FLAGS
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
      process.env.ANTHROPIC_API_KEY = 'sk-ant-wave5-gb-test'
      process.env.CLAUDE_CODE_GB_REFRESH_INTERVAL_MS = '3600000'
      spies.push(
        spyOn(authMod, 'checkAndRefreshOAuthTokenIfNeeded').mockResolvedValue(
          false,
        ),
      )

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            status: 200,
            features: { test_flag: { defaultValue: true } },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )) as unknown as typeof fetch

      try {
        // Warm up the single shared GrowthBook listener pair on host #0
        await runWithNewHostSession(
          { id: 'gb-warmup', cwd: configDir, isInteractive: false },
          async () => {
            setSessionTrustAccepted(true)
            const client = await initializeGrowthBook()
            expect(client).not.toBeNull()
            setupPeriodicGrowthBookRefresh()
            stopPeriodicGrowthBookRefresh()
          },
        )

        const beforeExitBase = process.listenerCount('beforeExit')
        const exitBase = process.listenerCount('exit')

        // Spawn 25 ephemeral hosts running full initializeGrowthBook() + periodic refresh
        // (in parallel batches) plus 45 additional ephemeral hosts running
        // setupPeriodicGrowthBookRefresh() (70 total > 64 WeakRef pruning threshold)
        // and verify ZERO extra process listeners.
        const hostRefs: Array<WeakRef<object>> = []
        const runEphemeralInit = async (idx: number): Promise<void> => {
          const host = createSessionHost()
          hostRefs.push(new WeakRef(host))
          const session = createRootSession({
            host,
            id: `gb-ephemeral-init-${idx}`,
            project: {
              originalCwd: configDir,
              projectRoot: configDir,
              cwd: configDir,
            },
          })
          await runWithSession(session, async () => {
            setSessionTrustAccepted(true)
            const client = await initializeGrowthBook()
            expect(client).not.toBeNull()
            setupPeriodicGrowthBookRefresh()
            stopPeriodicGrowthBookRefresh()
          })
        }

        for (let batch = 0; batch < 25; batch += 5) {
          await Promise.all(
            Array.from({ length: 5 }, (_, k) => runEphemeralInit(batch + k)),
          )
        }

        for (let i = 0; i < 45; i++) {
          const host = createSessionHost()
          hostRefs.push(new WeakRef(host))
          const session = createRootSession({
            host,
            id: `gb-ephemeral-refresh-${i}`,
            project: {
              originalCwd: configDir,
              projectRoot: configDir,
              cwd: configDir,
            },
          })
          runWithSession(session, () => {
            setupPeriodicGrowthBookRefresh()
            stopPeriodicGrowthBookRefresh()
          })
        }

        // ZERO additional process listeners added across all 70 ephemeral hosts!
        expect(process.listenerCount('beforeExit')).toBe(beforeExitBase)
        expect(process.listenerCount('exit')).toBe(exitBase)

        // Yield macrotask turn (ECMAScript KeepDuringJob) before forcing GC
        await Bun.sleep(10)
        Bun.gc(true)
        await Bun.sleep(10)
        Bun.gc(true)
        const collected = hostRefs.filter(r => r.deref() === undefined).length
        expect(collected).toBeGreaterThan(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})
