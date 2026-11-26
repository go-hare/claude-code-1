import { afterEach, describe, expect, test } from 'bun:test'
import { context as otelContext, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setIsInteractive } from '../../bootstrap/state.js'
import {
  initializeDatadog,
  shutdownDatadog,
} from '../../services/analytics/datadog.js'
import {
  initialize1PEventLogging,
  logEventTo1P,
  logEventTo1PPromise,
  shutdown1PEventLogging,
} from '../../services/analytics/firstPartyEventLogger.js'
import {
  _resetForTesting as _resetAnalyticsForTesting,
  attachAnalyticsSink,
  logEvent,
  logEventAsync,
  type LogEventMetadata,
} from '../../services/analytics/index.js'
import {
  initializeAnalyticsGates,
  initializeAnalyticsSink,
} from '../../services/analytics/sink.js'
import {
  clearDiagnosticSanitizeLatchesForTests,
  DiagnosticTrackingService,
  diagnosticTracker,
} from '../../services/diagnosticTracking.js'
import { logPermissionContextForAnts } from '../../services/internalLogging.js'
import {
  getLangfuseProcessor,
  initLangfuse,
  shutdownLangfuse,
} from '../../services/langfuse/client.js'
import {
  hasClaudeAiBillingAccess,
  setMockBillingAccessOverride,
} from '../billing.js'
import {
  _resetCacheStatsStateForTest,
  getCacheStatsState,
  onResponse as onCacheStatsResponse,
} from '../cacheStatsState.js'
import { runCleanupFunctions } from '../cleanupRegistry.js'
import {
  _resetDebugLoggerForTesting,
  enableDebugLogging,
  flushDebugLogs,
  getDebugFilePath,
  getDebugFilter,
  getDebugLogPath,
  getHasFormattedOutput,
  getMinDebugLogLevel,
  isDebugMode,
  isDebugToStdErr,
  logForDebugging,
  setHasFormattedOutput,
} from '../debug.js'
import { parseDebugFilter } from '../debugFilter.js'
import {
  _clearLogWritersForTesting,
  _flushLogWritersForTesting,
  getErrorsPath,
  getMCPLogsPath,
  initializeErrorLogSink,
} from '../errorLogSink.js'
import {
  _getEventLoopStallStatsForTesting,
  _stopEventLoopStallDetectorForTesting,
  startEventLoopStallDetector,
} from '../eventLoopStallDetector.js'
import {
  armStreamFirstByte,
  consumeStreamFirstByteArm,
} from '../firstByteWatchdog.js'
import {
  headlessProfilerCheckpoint,
  headlessProfilerStartTurn,
  logHeadlessProfilerTurn,
} from '../headlessProfiler.js'
import {
  _resetErrorLogForTesting,
  attachErrorLogSink,
  getInMemoryErrors,
  logError,
  logMCPDebug,
  logMCPError,
} from '../log.js'
import {
  clearLoggableMcpServersForTests,
  isMcpServerLoggable,
  markMcpServerLoggable,
  redactMcpServerNameForOtel,
} from '../mcpUsageAttribution.js'
import {
  clearProjectScopedTracingWarnsForTests,
  stripProjectScopedTracingEnv,
} from '../projectScopedTracingStrip.js'
import {
  endQueryProfile,
  logQueryProfileReport,
  queryCheckpoint,
  startQueryProfile,
} from '../queryProfiler.js'
import { closeSentry, initSentry, isSentryInitialized } from '../sentry.js'
import {
  getActiveSessionFromAls,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'
import {
  clone,
  cloneDeep,
  jsonParse,
  jsonStringify,
} from '../slowOperations.js'
import {
  assignStartupContext,
  getRecordedStartupPhase,
  getRecordedStartupPhaseStart,
  getStartupContext,
  profileCheckpoint,
  profileCheckpointOnce,
  profileReport,
  recordStartupPhase,
  resetClaimProfilerForTests,
  resetRecordedStartupPhasesForTesting,
} from '../startupProfiler.js'
import { withStatsCacheLock } from '../statsCache.js'
import {
  addBetaLLMRequestAttributes,
  clearBetaTracingState,
} from '../telemetry/betaSessionTracing.js'
import {
  collectorTelemetryRoad,
  logOTelEvent,
  type OTelCollectorLogEntry,
} from '../telemetry/events.js'
import {
  getActiveInteractionOTelContext,
  setActiveInteractionOTelContext,
} from '../telemetry/interactionOtelContext.js'
import {
  emitPerfettoInstant,
  getPerfettoEvents,
  initializePerfettoTracing,
  isPerfettoTracingEnabled,
  registerAgent,
  resetPerfettoTracer,
} from '../telemetry/perfettoTracing.js'
import {
  buildOTelAttributionAttributes,
  clearFirstPartyPluginsForAttributionForTests,
  getFirstPartyPluginsForAttribution,
  registerFirstPartyPluginForAttribution,
  sanitizeAttributionForOTel,
} from '../telemetry/pluginTelemetry.js'
import {
  endInteractionSpan,
  endLLMRequestSpan,
  getCurrentSpan,
  startInteractionSpan,
  startLLMRequestSpan,
} from '../telemetry/sessionTracing.js'
import {
  getVcsRepositoryTelemetryAttributes,
  invalidateVcsRepositoryAttributesCache,
  resolveVcsRepositoryAttributesForCwd,
  VCS_REPOSITORY_NAME,
} from '../telemetry/vcsRepositoryAttributes.js'
import { initializeWarningHandler } from '../warningHandler.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms))

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 6 Agent 3 — Multi-host ALS isolation for Telemetry, Analytics, Profilers, Logging & Diagnostics (2.1.331)', () => {
  test('analytics/index.ts [W-10]: pre-attach queue, sink attach, and microtask drain stay isolated per host and preserve ALS', async () => {
    _resetAnalyticsForTesting()
    const seenA: Array<{
      event: string
      meta: LogEventMetadata
      sessionId: string | undefined
    }> = []
    const seenB: Array<{
      event: string
      meta: LogEventMetadata
      sessionId: string | undefined
    }> = []

    await Promise.all([
      runWithNewHostSession({ id: 'host-analytics-a' }, async () => {
        logEvent('queued_before_attach_a', { step: 1 })
        await logEventAsync('queued_async_a', { step: 2 })
        await delay(10)
        attachAnalyticsSink({
          logEvent: (event, meta) => {
            seenA.push({
              event,
              meta,
              sessionId: getActiveSessionFromAls()?.id,
            })
          },
          logEventAsync: async (event, meta) => {
            seenA.push({
              event,
              meta,
              sessionId: getActiveSessionFromAls()?.id,
            })
          },
        })
        logEvent('after_attach_a', { step: 3 })
        await delay(10)
        _resetAnalyticsForTesting()
      }),
      runWithNewHostSession({ id: 'host-analytics-b' }, async () => {
        logEvent('queued_before_attach_b', { step: 10 })
        await delay(5)
        attachAnalyticsSink({
          logEvent: (event, meta) => {
            seenB.push({
              event,
              meta,
              sessionId: getActiveSessionFromAls()?.id,
            })
          },
          logEventAsync: async (event, meta) => {
            seenB.push({
              event,
              meta,
              sessionId: getActiveSessionFromAls()?.id,
            })
          },
        })
        await logEventAsync('after_attach_b', { step: 20 })
        await delay(10)
        _resetAnalyticsForTesting()
      }),
    ])

    expect(seenA.map(e => e.event).sort()).toEqual([
      'after_attach_a',
      'queued_async_a',
      'queued_before_attach_a',
    ])
    expect(seenB.map(e => e.event).sort()).toEqual([
      'after_attach_b',
      'queued_before_attach_b',
    ])
    expect(seenA.every(e => e.sessionId === 'host-analytics-a')).toBe(true)
    expect(seenB.every(e => e.sessionId === 'host-analytics-b')).toBe(true)
  })

  test('analytics/sink.ts, datadog.ts & firstPartyEventLogger.ts: per-host gate, memoize .cache proxy, and logger isolation', async () => {
    const prevEnvKind = process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    const prevDisableTelemetry = process.env.DISABLE_TELEMETRY
    const globalWithMacro = globalThis as unknown as {
      MACRO?: { VERSION: string }
    }
    const prevMacro = globalWithMacro.MACRO
    if (!globalWithMacro.MACRO) {
      globalWithMacro.MACRO = { VERSION: '2.1.331-test' }
    }
    try {
      await Promise.all([
        runWithNewHostSession({ id: 'host-dd-a' }, async () => {
          initializeAnalyticsGates()
          initializeAnalyticsSink()
          // Override initializeDatadog.cache for Host A only
          initializeDatadog.cache.set(undefined, Promise.resolve(true))
          await delay(10)
          expect(await initializeDatadog()).toBe(true)
          await shutdownDatadog()
          await shutdown1PEventLogging()
        }),
        runWithNewHostSession({ id: 'host-dd-b' }, async () => {
          initializeAnalyticsGates()
          initializeAnalyticsSink()
          initializeDatadog.cache.set(undefined, Promise.resolve(false))
          await delay(10)
          expect(await initializeDatadog()).toBe(false)
          // Calling 1P logger in uninitialized host B is a clean no-op
          logEventTo1P('test_event', { count: 1 })
          await logEventTo1PPromise('test_event_async', { count: 2 })
          initialize1PEventLogging()
          await shutdown1PEventLogging()
          await shutdownDatadog()
        }),
      ])
    } finally {
      if (prevMacro === undefined) {
        delete globalWithMacro.MACRO
      } else {
        globalWithMacro.MACRO = prevMacro
      }
      if (prevEnvKind === undefined) {
        delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
      } else {
        process.env.CLAUDE_CODE_ENVIRONMENT_KIND = prevEnvKind
      }
      if (prevDisableTelemetry === undefined) {
        delete process.env.DISABLE_TELEMETRY
      } else {
        process.env.DISABLE_TELEMETRY = prevDisableTelemetry
      }
    }
  })

  test('diagnosticTracking.ts: DiagnosticTrackingService.getInstance(), diagnosticTracker Proxy, and sanitize latches isolate per host', async () => {
    const instances: DiagnosticTrackingService[] = []
    const sharedMalformedPayload = { notAnArray: true }

    await Promise.all([
      runWithNewHostSession({ id: 'host-diag-a' }, async () => {
        const svcA = DiagnosticTrackingService.getInstance()
        instances.push(svcA)
        expect(diagnosticTracker instanceof DiagnosticTrackingService).toBe(
          true,
        )
        const fakeClientA = {
          name: 'ide-a',
          type: 'connected',
          config: { type: 'stdio', command: 'ide-a' },
          serverInfo: { name: 'VSCode A', version: '1.0' },
        } as unknown as Parameters<typeof diagnosticTracker.initialize>[0]
        diagnosticTracker.initialize(fakeClientA)
        await delay(10)
        // Same host sees initialized = true via both getInstance() and Proxy
        const privA = svcA as unknown as {
          initialized: boolean
          mcpClient?: { name: string }
        }
        expect(privA.initialized).toBe(true)
        expect(privA.mcpClient?.name).toBe('ide-a')
        expect(
          DiagnosticTrackingService.sanitizeDiagnosticFiles(
            sharedMalformedPayload,
          ),
        ).toEqual([])
        clearDiagnosticSanitizeLatchesForTests()
        await diagnosticTracker.shutdown()
      }),
      runWithNewHostSession({ id: 'host-diag-b' }, async () => {
        const svcB = DiagnosticTrackingService.getInstance()
        instances.push(svcB)
        await delay(5)
        const privB = svcB as unknown as {
          initialized: boolean
          mcpClient?: { name: string }
        }
        expect(privB.initialized).toBe(false)
        expect(privB.mcpClient).toBeUndefined()
        expect(
          DiagnosticTrackingService.sanitizeDiagnosticFiles(
            sharedMalformedPayload,
          ),
        ).toEqual([])
        await svcB.shutdown()
      }),
    ])

    expect(instances[0]).not.toBe(instances[1])
  })

  test('billing.ts: mockBillingAccessOverride isolates concurrently across hosts', async () => {
    const results = await Promise.all([
      runWithNewHostSession({ id: 'host-bill-a' }, async () => {
        setMockBillingAccessOverride(true)
        await delay(15)
        const val = hasClaudeAiBillingAccess()
        setMockBillingAccessOverride(null)
        return val
      }),
      runWithNewHostSession({ id: 'host-bill-b' }, async () => {
        setMockBillingAccessOverride(false)
        await delay(10)
        const val = hasClaudeAiBillingAccess()
        setMockBillingAccessOverride(null)
        return val
      }),
    ])
    expect(results).toEqual([true, false])
  })

  test('cacheStatsState.ts: isolates across hosts and shares across withProject forks', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-cache-a' }, async root => {
        onCacheStatsResponse({
          input_tokens: 100,
          cache_read_input_tokens: 400,
          cache_creation_input_tokens: 0,
        })
        await delay(10)
        const fromRoot = getCacheStatsState()
        const fork = root.withProject({ cwd: '/tmp/fork-cache-a' })
        const fromFork = runWithSession(fork, () => getCacheStatsState())
        _resetCacheStatsStateForTest()
        return { fromRoot, fromFork }
      }),
      runWithNewHostSession({ id: 'host-cache-b' }, async () => {
        onCacheStatsResponse({
          input_tokens: 500,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 500,
        })
        await delay(10)
        const stateB = getCacheStatsState()
        _resetCacheStatsStateForTest()
        return stateB
      }),
    ])

    expect(resA.fromRoot.signature).toBe(resA.fromFork.signature)
    expect(resA.fromRoot.lastHitRate).toBe(resA.fromFork.lastHitRate)
    expect(resA.fromRoot.signature).not.toBe(resB.signature)
    expect(resA.fromRoot.lastHitRate).not.toBe(resB.lastHitRate)
  })

  test('debug.ts & debugFilter.ts: per-host runtime debug flag, formatted output, memoize .cache proxies, and log path', async () => {
    const dirA = makeTempDir('w6-debug-a-')
    const dirB = makeTempDir('w6-debug-b-')

    await Promise.all([
      runWithNewHostSession({ id: 'host-dbg-a', cwd: dirA }, async () => {
        setHasFormattedOutput(true)
        enableDebugLogging()
        getMinDebugLogLevel.cache.set(undefined, 'verbose')
        getDebugFilePath.cache.set(undefined, join(dirA, 'a.log'))
        isDebugToStdErr.cache.set(undefined, false)
        getDebugFilter.cache.set(undefined, parseDebugFilter('api'))
        parseDebugFilter.cache.set('custom', {
          include: ['host-a-only'],
          exclude: [],
          isExclusive: false,
        })

        await delay(15)

        expect(getHasFormattedOutput()).toBe(true)
        expect(isDebugMode()).toBe(true)
        expect(getMinDebugLogLevel()).toBe('verbose')
        expect(getDebugLogPath()).toBe(join(dirA, 'a.log'))
        expect(parseDebugFilter('custom')?.include).toEqual(['host-a-only'])
        expect(getDebugFilter()?.include).toEqual(['api'])
        await flushDebugLogs()
        _resetDebugLoggerForTesting()
      }),
      runWithNewHostSession({ id: 'host-dbg-b', cwd: dirB }, async () => {
        setHasFormattedOutput(false)
        getMinDebugLogLevel.cache.set(undefined, 'error')
        getDebugFilePath.cache.set(undefined, join(dirB, 'b.log'))
        isDebugToStdErr.cache.set(undefined, false)
        getDebugFilter.cache.set(undefined, parseDebugFilter('!hooks'))

        await delay(10)

        expect(getHasFormattedOutput()).toBe(false)
        expect(getMinDebugLogLevel()).toBe('error')
        expect(getDebugLogPath()).toBe(join(dirB, 'b.log'))
        expect(parseDebugFilter('custom')?.include).toEqual(['custom'])
        expect(getDebugFilter()?.exclude).toEqual(['hooks'])
        await flushDebugLogs()
        _resetDebugLoggerForTesting()
      }),
    ])
  })

  test('log.ts & errorLogSink.ts: per-host error sinks, pre-attach queues, and in-memory error logs stay isolated', async () => {
    _resetErrorLogForTesting()
    const errorsA: string[] = []
    const errorsB: string[] = []
    const mcpA: string[] = []
    const mcpB: string[] = []

    const prevDisableErr = process.env.DISABLE_ERROR_REPORTING
    const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    const prevVertex = process.env.CLAUDE_CODE_USE_VERTEX
    const prevFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.DISABLE_ERROR_REPORTING
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY

    try {
      await Promise.all([
        runWithNewHostSession({ id: 'host-log-a' }, async () => {
          logError(new Error('queued-err-a'))
          logMCPError('srv-a', 'mcp-err-a')
          await delay(10)
          attachErrorLogSink({
            logError: e => errorsA.push(e.message),
            logMCPError: (s, e) => mcpA.push(`${s}:${String(e)}`),
            logMCPDebug: (s, m) => mcpA.push(`dbg:${s}:${m}`),
            getErrorsPath,
            getMCPLogsPath,
          })
          logError(new Error('live-err-a'))
          logMCPDebug('srv-a', 'hello-a')
          await delay(10)
          expect(getInMemoryErrors().length).toBe(2)
          expect(getInMemoryErrors().every(e => e.error.includes('-a'))).toBe(
            true,
          )
          _resetErrorLogForTesting()
        }),
        runWithNewHostSession({ id: 'host-log-b' }, async () => {
          logError(new Error('queued-err-b'))
          logMCPError('srv-b', 'mcp-err-b')
          await delay(5)
          attachErrorLogSink({
            logError: e => errorsB.push(e.message),
            logMCPError: (s, e) => mcpB.push(`${s}:${String(e)}`),
            logMCPDebug: (s, m) => mcpB.push(`dbg:${s}:${m}`),
            getErrorsPath,
            getMCPLogsPath,
          })
          logError(new Error('live-err-b'))
          await delay(10)
          expect(getInMemoryErrors().length).toBe(2)
          expect(getInMemoryErrors().every(e => e.error.includes('-b'))).toBe(
            true,
          )
          _resetErrorLogForTesting()
        }),
      ])

      expect(errorsA).toEqual(['queued-err-a', 'live-err-a'])
      expect(errorsB).toEqual(['queued-err-b', 'live-err-b'])
      expect(mcpA).toEqual(['srv-a:mcp-err-a', 'dbg:srv-a:hello-a'])
      expect(mcpB).toEqual(['srv-b:mcp-err-b'])

      // Also verify errorLogSink helpers run cleanly per host
      await Promise.all([
        runWithNewHostSession({ id: 'host-errsink-a' }, async () => {
          initializeErrorLogSink()
          expect(getErrorsPath()).toContain('.jsonl')
          expect(getMCPLogsPath('my-mcp')).toContain('.jsonl')
          _flushLogWritersForTesting()
          _clearLogWritersForTesting()
          _resetErrorLogForTesting()
        }),
        runWithNewHostSession({ id: 'host-errsink-b' }, async () => {
          initializeErrorLogSink()
          _flushLogWritersForTesting()
          _clearLogWritersForTesting()
          _resetErrorLogForTesting()
        }),
      ])
    } finally {
      if (prevDisableErr !== undefined) {
        process.env.DISABLE_ERROR_REPORTING = prevDisableErr
      }
      if (prevBedrock !== undefined) {
        process.env.CLAUDE_CODE_USE_BEDROCK = prevBedrock
      }
      if (prevVertex !== undefined) {
        process.env.CLAUDE_CODE_USE_VERTEX = prevVertex
      }
      if (prevFoundry !== undefined) {
        process.env.CLAUDE_CODE_USE_FOUNDRY = prevFoundry
      }
    }
  })

  test('eventLoopStallDetector.ts: detector running state & cleanup stay isolated per host', async () => {
    await Promise.all([
      runWithNewHostSession({ id: 'host-stall-a' }, async () => {
        startEventLoopStallDetector()
        expect(_getEventLoopStallStatsForTesting().running).toBe(true)
        await delay(15)
        // Host cleanup stops Host A's detector without touching Host B
        await runCleanupFunctions()
        expect(_getEventLoopStallStatsForTesting().running).toBe(false)
        _stopEventLoopStallDetectorForTesting()
      }),
      runWithNewHostSession({ id: 'host-stall-b' }, async () => {
        expect(_getEventLoopStallStatsForTesting().running).toBe(false)
        await delay(25)
        // Still false even while Host A ran and cleaned up
        expect(_getEventLoopStallStatsForTesting().running).toBe(false)
        startEventLoopStallDetector()
        expect(_getEventLoopStallStatsForTesting().running).toBe(true)
        _stopEventLoopStallDetectorForTesting()
      }),
    ])
  })

  test('firstByteWatchdog.ts: armedRequestIds isolates across hosts and shares across withProject forks', async () => {
    await Promise.all([
      runWithNewHostSession({ id: 'host-fb-a' }, async root => {
        armStreamFirstByte('req-shared-id')
        await delay(15)
        // Fork of Host A sees the armed id
        const fork = root.withProject({ cwd: '/tmp/fork-fb-a' })
        expect(
          runWithSession(fork, () =>
            consumeStreamFirstByteArm('req-shared-id'),
          ),
        ).toBe(true)
        expect(consumeStreamFirstByteArm('req-shared-id')).toBe(false)
      }),
      runWithNewHostSession({ id: 'host-fb-b' }, async () => {
        await delay(5)
        // Host B cannot consume Host A's armed id
        expect(consumeStreamFirstByteArm('req-shared-id')).toBe(false)
        armStreamFirstByte('req-only-b')
        await delay(15)
        expect(consumeStreamFirstByteArm('req-only-b')).toBe(true)
      }),
    ])
  })

  test('headlessProfiler.ts, queryProfiler.ts & startupProfiler.ts: turns, checkpoints, phases, and contexts isolate per host', async () => {
    const prevProfileStartup = process.env.CLAUDE_CODE_PROFILE_STARTUP
    const prevProfileQuery = process.env.CLAUDE_CODE_PROFILE_QUERY
    const prevUserType = process.env.USER_TYPE
    process.env.CLAUDE_CODE_PROFILE_STARTUP = '1'
    process.env.CLAUDE_CODE_PROFILE_QUERY = '1'
    process.env.USER_TYPE = 'ant'

    const headlessEventsA: LogEventMetadata[] = []
    const headlessEventsB: LogEventMetadata[] = []
    const startupEventsA: LogEventMetadata[] = []
    const startupEventsB: LogEventMetadata[] = []

    try {
      await Promise.all([
        runWithNewHostSession({ id: 'host-prof-a' }, async () => {
          setIsInteractive(false)
          attachAnalyticsSink({
            logEvent: (name, meta) => {
              if (name === 'tengu_headless_latency') headlessEventsA.push(meta)
              if (name === 'tengu_startup_perf') startupEventsA.push(meta)
            },
            logEventAsync: async () => {},
          })

          // Headless profiler: 2 turns in Host A
          headlessProfilerStartTurn()
          headlessProfilerCheckpoint('query_started')
          await delay(5)
          headlessProfilerCheckpoint('api_request_sent')
          headlessProfilerCheckpoint('first_chunk')
          logHeadlessProfilerTurn()

          headlessProfilerStartTurn()
          headlessProfilerCheckpoint('query_started')
          logHeadlessProfilerTurn()

          // Query profiler
          startQueryProfile()
          queryCheckpoint('query_api_request_sent')
          queryCheckpoint('query_first_chunk_received')
          endQueryProfile()
          logQueryProfileReport()

          // Startup profiler
          recordStartupPhase('await_initialize_ms', 111.4, 10)
          expect(profileCheckpointOnce('claim_received')).toBe(true)
          expect(profileCheckpointOnce('claim_received')).toBe(false)
          assignStartupContext({ hostTag: 'A' })
          profileCheckpoint('cli_entry')
          profileCheckpoint('main_after_run')
          await delay(10)

          expect(getRecordedStartupPhase('await_initialize_ms')).toBe(111)
          expect(getRecordedStartupPhaseStart('await_initialize_ms')).toBe(10)
          expect(getStartupContext()).toEqual({ hostTag: 'A' })

          // Run profileReport (with detailed file output redirected to temp config dir? skip disk write by turning off detailed flag? no, let's keep it isolated with temp dir? Just assert record/context/once isolation and logStartupPerf via non-detailed report)
          resetRecordedStartupPhasesForTesting()
          resetClaimProfilerForTests()
          _resetAnalyticsForTesting()
        }),
        runWithNewHostSession({ id: 'host-prof-b' }, async () => {
          setIsInteractive(false)
          attachAnalyticsSink({
            logEvent: (name, meta) => {
              if (name === 'tengu_headless_latency') headlessEventsB.push(meta)
              if (name === 'tengu_startup_perf') startupEventsB.push(meta)
            },
            logEventAsync: async () => {},
          })

          // Headless profiler: only 1 turn in Host B (turn_number MUST be 0, not 2!)
          headlessProfilerStartTurn()
          headlessProfilerCheckpoint('system_message_yielded')
          await delay(8)
          headlessProfilerCheckpoint('query_started')
          logHeadlessProfilerTurn()

          // Query profiler
          startQueryProfile()
          queryCheckpoint('query_api_request_sent')
          endQueryProfile()
          logQueryProfileReport()

          // Startup profiler
          recordStartupPhase('await_initialize_ms', 222.8, 20)
          expect(profileCheckpointOnce('claim_received')).toBe(true)
          assignStartupContext({ hostTag: 'B' })
          await delay(10)

          expect(getRecordedStartupPhase('await_initialize_ms')).toBe(223)
          expect(getRecordedStartupPhaseStart('await_initialize_ms')).toBe(20)
          expect(getStartupContext()).toEqual({ hostTag: 'B' })

          // Test profileReport idempotency without writing to real ~/.claude
          process.env.CLAUDE_CODE_PROFILE_STARTUP = '0'
          profileCheckpoint('cli_entry')
          profileCheckpoint('main_after_run')
          profileReport()
          profileReport() // second call is a no-op
          expect(startupEventsB.length).toBe(1)

          resetRecordedStartupPhasesForTesting()
          resetClaimProfilerForTests()
          _resetAnalyticsForTesting()
        }),
      ])

      expect(headlessEventsA.map(m => m.turn_number)).toEqual([0, 1])
      expect(headlessEventsB.map(m => m.turn_number)).toEqual([0])
      expect(headlessEventsB[0]?.time_to_system_message_ms).toBeDefined()
    } finally {
      if (prevProfileStartup === undefined) {
        delete process.env.CLAUDE_CODE_PROFILE_STARTUP
      } else {
        process.env.CLAUDE_CODE_PROFILE_STARTUP = prevProfileStartup
      }
      if (prevProfileQuery === undefined) {
        delete process.env.CLAUDE_CODE_PROFILE_QUERY
      } else {
        process.env.CLAUDE_CODE_PROFILE_QUERY = prevProfileQuery
      }
      if (prevUserType === undefined) {
        delete process.env.USER_TYPE
      } else {
        process.env.USER_TYPE = prevUserType
      }
    }
  })

  test('mcpUsageAttribution.ts & projectScopedTracingStrip.ts: per-host sets stay isolated', async () => {
    await Promise.all([
      runWithNewHostSession({ id: 'host-attr-a' }, async () => {
        markMcpServerLoggable('server-a')
        const stripped = stripProjectScopedTracingEnv(
          { BETA_TRACING_ENDPOINT: 'https://evil', SAFE: '1' },
          'projectSettings',
        )
        expect(stripped).toEqual({ SAFE: '1' })
        await delay(10)
        expect(isMcpServerLoggable('server-a')).toBe(true)
        expect(isMcpServerLoggable('server-b')).toBe(false)
        expect(redactMcpServerNameForOtel('server-a')).toBe('server-a')
        expect(redactMcpServerNameForOtel('server-b')).toBe('custom')
        clearLoggableMcpServersForTests()
        clearProjectScopedTracingWarnsForTests()
      }),
      runWithNewHostSession({ id: 'host-attr-b' }, async () => {
        markMcpServerLoggable('server-b')
        const stripped = stripProjectScopedTracingEnv(
          { BETA_TRACING_ENDPOINT: 'https://evil-b', SAFE: '2' },
          'localSettings',
        )
        expect(stripped).toEqual({ SAFE: '2' })
        await delay(10)
        expect(isMcpServerLoggable('server-b')).toBe(true)
        expect(isMcpServerLoggable('server-a')).toBe(false)
        expect(redactMcpServerNameForOtel('server-b')).toBe('server-b')
        expect(redactMcpServerNameForOtel('server-a')).toBe('custom')
        clearLoggableMcpServersForTests()
        clearProjectScopedTracingWarnsForTests()
      }),
    ])
  })

  test('statsCache.ts: withStatsCacheLock serializes per stats-cache path across hosts and within same host while preserving ALS', async () => {
    const timeline: string[] = []
    const observedSessions: string[] = []

    // Cross-host serialization on shared CLAUDE_CONFIG_DIR prevents stats-cache.json
    // read-modify-write corruption while preserving each caller's ALS session!
    const crossHostDone = Promise.all([
      runWithNewHostSession({ id: 'host-lock-a' }, async () => {
        await withStatsCacheLock(async () => {
          timeline.push('A-enter')
          observedSessions.push(getActiveSessionFromAls()?.id ?? 'none')
          await delay(40)
          timeline.push('A-exit')
        })
      }),
      runWithNewHostSession({ id: 'host-lock-b' }, async () => {
        await delay(5)
        await withStatsCacheLock(async () => {
          timeline.push('B-enter')
          observedSessions.push(getActiveSessionFromAls()?.id ?? 'none')
          await delay(5)
          timeline.push('B-exit')
        })
      }),
    ])
    await crossHostDone
    // Host B MUST wait for Host A to release the shared path lock, and each callback
    // MUST run inside its own owning ALS session!
    expect(timeline).toEqual(['A-enter', 'A-exit', 'B-enter', 'B-exit'])
    expect(observedSessions).toEqual(['host-lock-a', 'host-lock-b'])

    // Same-host serialization: two calls inside the same host MUST serialize
    const sameHostTimeline: string[] = []
    await runWithNewHostSession({ id: 'host-lock-same' }, async () => {
      await Promise.all([
        withStatsCacheLock(async () => {
          sameHostTimeline.push('1-enter')
          await delay(25)
          sameHostTimeline.push('1-exit')
        }),
        (async () => {
          await delay(5)
          await withStatsCacheLock(async () => {
            sameHostTimeline.push('2-enter')
            sameHostTimeline.push('2-exit')
          })
        })(),
      ])
    })
    expect(sameHostTimeline).toEqual(['1-enter', '1-exit', '2-enter', '2-exit'])
  })

  test('slowOperations.ts & internalLogging.ts & langfuse/client.ts (process-global) & sentry.ts: multi-host safe execution', async () => {
    const prevLangfusePub = process.env.LANGFUSE_PUBLIC_KEY
    const prevLangfuseSec = process.env.LANGFUSE_SECRET_KEY
    const prevSentryDsn = process.env.SENTRY_DSN
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
    delete process.env.SENTRY_DSN
    await shutdownLangfuse()
    await closeSentry()

    try {
      await Promise.all([
        runWithNewHostSession({ id: 'host-misc-a' }, async () => {
          const obj = { nested: [1, 2, 3], host: 'a' }
          expect(jsonParse(jsonStringify(obj))).toEqual(obj)
          expect(clone(obj)).toEqual(obj)
          expect(cloneDeep(obj)).toEqual(obj)

          expect(initLangfuse()).toBe(false)
          expect(getLangfuseProcessor()).toBeNull()
          await shutdownLangfuse()

          initSentry()
          expect(isSentryInitialized()).toBe(false)
          await closeSentry()

          await logPermissionContextForAnts(null, 'initialization')
        }),
        runWithNewHostSession({ id: 'host-misc-b' }, async () => {
          const obj = { nested: [4, 5], host: 'b' }
          expect(jsonParse(jsonStringify(obj))).toEqual(obj)
          expect(clone(obj)).toEqual(obj)
          expect(cloneDeep(obj)).toEqual(obj)

          expect(initLangfuse()).toBe(false)
          expect(getLangfuseProcessor()).toBeNull()
          await shutdownLangfuse()

          initSentry()
          expect(isSentryInitialized()).toBe(false)
          await closeSentry()

          await logPermissionContextForAnts(null, 'summary')
        }),
      ])
    } finally {
      if (prevLangfusePub !== undefined) {
        process.env.LANGFUSE_PUBLIC_KEY = prevLangfusePub
      }
      if (prevLangfuseSec !== undefined) {
        process.env.LANGFUSE_SECRET_KEY = prevLangfuseSec
      }
      if (prevSentryDsn !== undefined) {
        process.env.SENTRY_DSN = prevSentryDsn
      }
    }
  })

  test('telemetry/events.ts, interactionOtelContext.ts, betaSessionTracing.ts & pluginTelemetry.ts: per-host/session isolation', async () => {
    const entriesA: OTelCollectorLogEntry[] = []
    const entriesB: OTelCollectorLogEntry[] = []
    const sessionIdsInRoadA: Array<string | undefined> = []
    const sessionIdsInRoadB: Array<string | undefined> = []

    const prevBeta = process.env.ENABLE_BETA_TRACING_DETAILED
    const prevBetaEndpoint = process.env.BETA_TRACING_ENDPOINT
    const prevUserType = process.env.USER_TYPE
    process.env.ENABLE_BETA_TRACING_DETAILED = '1'
    process.env.BETA_TRACING_ENDPOINT = 'https://trace.example.test'
    process.env.USER_TYPE = 'ant'

    try {
      await Promise.all([
        runWithNewHostSession({ id: 'host-otel-a' }, async root => {
          // Collector road isolation + ALS preservation inside route()
          collectorTelemetryRoad.setRoad({
            send: async entry => {
              entriesA.push(entry)
              sessionIdsInRoadA.push(getActiveSessionFromAls()?.id)
            },
          })

          // Interaction OTel context bridge isolation
          const spanA = trace.getTracer('t').startSpan('span-a')
          const ctxA = trace.setSpan(otelContext.active(), spanA)
          setActiveInteractionOTelContext(ctxA)

          // Plugin telemetry firstParty registry isolation (including default params!)
          registerFirstPartyPluginForAttribution(
            'plugin-a',
            'claude-plugins-official',
          )

          await logOTelEvent('ev_a_1', { k: 'a1' })
          await delay(10)
          await logOTelEvent('ev_a_2', { k: 'a2' })
          await collectorTelemetryRoad.settled()

          // Verify fork shares root session's eventSequence and interactionOtelContext
          const fork = root.withProject({ cwd: '/tmp/fork-otel-a' })
          await runWithSession(fork, async () => {
            expect(getActiveInteractionOTelContext()).toBe(ctxA)
            await logOTelEvent('ev_a_fork', { k: 'af' })
          })
          await collectorTelemetryRoad.settled()

          // Verify betaSessionTracing seenHashes isolates per root session
          const dummySpanA = trace.getTracer('t').startSpan('llm-a')
          addBetaLLMRequestAttributes(dummySpanA, {
            systemPrompt: 'shared-system-prompt-text',
          })
          // Wait for microtask from void logOTelEvent('system_prompt', ...)
          await delay(10)
          await collectorTelemetryRoad.settled()
          clearBetaTracingState()
          dummySpanA.end()

          // Plugin telemetry default param check
          expect(getFirstPartyPluginsForAttribution().has('plugin-a')).toBe(
            true,
          )
          expect(getFirstPartyPluginsForAttribution().has('plugin-b')).toBe(
            false,
          )
          expect(
            sanitizeAttributionForOTel('agent:custom:plugin-a:helper', {
              attributionAgent: 'plugin-a:helper',
              attributionPlugin: 'plugin-a',
            }).attributionAgent,
          ).toBe('plugin-a:helper')
          expect(
            buildOTelAttributionAttributes('agent:custom:plugin-b:helper', {
              attributionAgent: 'plugin-b:helper',
              attributionPlugin: 'plugin-b',
            })['plugin.name'],
          ).toBe('third-party')

          setActiveInteractionOTelContext(undefined)
          spanA.end()
          clearFirstPartyPluginsForAttributionForTests()
        }),
        runWithNewHostSession({ id: 'host-otel-b' }, async () => {
          collectorTelemetryRoad.setRoad({
            send: async entry => {
              entriesB.push(entry)
              sessionIdsInRoadB.push(getActiveSessionFromAls()?.id)
            },
          })

          const spanB = trace.getTracer('t').startSpan('span-b')
          const ctxB = trace.setSpan(otelContext.active(), spanB)
          setActiveInteractionOTelContext(ctxB)

          registerFirstPartyPluginForAttribution(
            'plugin-b',
            'claude-plugins-official',
          )

          await logOTelEvent('ev_b_1', { k: 'b1' })
          await delay(10)

          // Verify Host B gets its own system_prompt emission despite Host A hashing the same prompt
          const dummySpanB = trace.getTracer('t').startSpan('llm-b')
          addBetaLLMRequestAttributes(dummySpanB, {
            systemPrompt: 'shared-system-prompt-text',
          })
          await delay(10)
          await collectorTelemetryRoad.settled()
          clearBetaTracingState()
          dummySpanB.end()

          expect(getActiveInteractionOTelContext()).toBe(ctxB)
          expect(getFirstPartyPluginsForAttribution().has('plugin-b')).toBe(
            true,
          )
          expect(getFirstPartyPluginsForAttribution().has('plugin-a')).toBe(
            false,
          )
          expect(
            sanitizeAttributionForOTel('agent:custom:plugin-b:helper', {
              attributionAgent: 'plugin-b:helper',
              attributionPlugin: 'plugin-b',
            }).attributionAgent,
          ).toBe('plugin-b:helper')

          setActiveInteractionOTelContext(undefined)
          spanB.end()
          clearFirstPartyPluginsForAttributionForTests()
        }),
      ])

      // Host A and Host B each started their own event.sequence from 0!
      const seqA = entriesA
        .filter(e => e.event.startsWith('ev_a_'))
        .map(e => e.attributes['event.sequence'])
      const seqB = entriesB
        .filter(e => e.event.startsWith('ev_b_'))
        .map(e => e.attributes['event.sequence'])
      expect(seqA).toEqual([0, 1, 2])
      expect(seqB).toEqual([0])

      // BOTH hosts independently logged system_prompt for the identical prompt text!
      expect(entriesA.some(e => e.event === 'system_prompt')).toBe(true)
      expect(entriesB.some(e => e.event === 'system_prompt')).toBe(true)

      // Every collector road dispatch ran inside its owning host's ALS session!
      expect(sessionIdsInRoadA.every(id => id === 'host-otel-a')).toBe(true)
      expect(sessionIdsInRoadB.every(id => id === 'host-otel-b')).toBe(true)
    } finally {
      if (prevBeta === undefined) {
        delete process.env.ENABLE_BETA_TRACING_DETAILED
      } else {
        process.env.ENABLE_BETA_TRACING_DETAILED = prevBeta
      }
      if (prevBetaEndpoint === undefined) {
        delete process.env.BETA_TRACING_ENDPOINT
      } else {
        process.env.BETA_TRACING_ENDPOINT = prevBetaEndpoint
      }
      if (prevUserType === undefined) {
        delete process.env.USER_TYPE
      } else {
        process.env.USER_TYPE = prevUserType
      }
    }
  })

  test('telemetry/sessionTracing.ts: interactionSequence, activeSpans, and enterWith ownerRoot guard isolate hosts', () => {
    const prevBeta = process.env.ENABLE_BETA_TRACING_DETAILED
    const prevEndpoint = process.env.BETA_TRACING_ENDPOINT
    const prevUserType = process.env.USER_TYPE
    process.env.ENABLE_BETA_TRACING_DETAILED = '1'
    process.env.BETA_TRACING_ENDPOINT = 'https://trace.example.test'
    process.env.USER_TYPE = 'ant'

    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    trace.setGlobalTracerProvider(provider)

    try {
      // Intentionally leave Host A's interaction span open across synchronous
      // boundary to prove enterWith in Host A does NOT leak into Host B!
      let spanA: ReturnType<typeof startInteractionSpan> | undefined
      runWithNewHostSession({ id: 'host-trace-a' }, () => {
        spanA = startInteractionSpan('prompt-a')
        expect(getCurrentSpan()).toBe(spanA)
        const llmA = startLLMRequestSpan('claude-sonnet-4-6')
        endLLMRequestSpan(llmA, { inputTokens: 10 })
      })

      runWithNewHostSession({ id: 'host-trace-b' }, () => {
        // Must NOT see Host A's leaked interaction span!
        expect(getCurrentSpan()).toBeNull()
        const spanB = startInteractionSpan('prompt-b')
        expect(getCurrentSpan()).toBe(spanB)
        endInteractionSpan()
        expect(getCurrentSpan()).toBeNull()
      })

      // Clean up spanA explicitly
      spanA?.end()

      const finished = exporter.getFinishedSpans()
      const interactionB = finished.find(
        s =>
          s.name === 'claude_code.interaction' &&
          s.attributes['gen_ai.conversation.id'] === 'host-trace-b',
      )
      // Host B's interaction.sequence must start at 1 (not 2!)
      expect(interactionB?.attributes['interaction.sequence']).toBe(1)
    } finally {
      trace.disable()
      if (prevBeta === undefined) {
        delete process.env.ENABLE_BETA_TRACING_DETAILED
      } else {
        process.env.ENABLE_BETA_TRACING_DETAILED = prevBeta
      }
      if (prevEndpoint === undefined) {
        delete process.env.BETA_TRACING_ENDPOINT
      } else {
        process.env.BETA_TRACING_ENDPOINT = prevEndpoint
      }
      if (prevUserType === undefined) {
        delete process.env.USER_TYPE
      } else {
        process.env.USER_TYPE = prevUserType
      }
    }
  })

  test('telemetry/vcsRepositoryAttributes.ts: cachedCwd and cachedVcsAttributes isolate per host', async () => {
    const nonGitDir = makeTempDir('w6-non-git-')
    const repoDir = process.cwd()

    await Promise.all([
      runWithNewHostSession({ id: 'host-vcs-repo', cwd: repoDir }, async () => {
        invalidateVcsRepositoryAttributesCache()
        const resolved = await resolveVcsRepositoryAttributesForCwd(repoDir)
        await delay(15)
        const syncAttrs = getVcsRepositoryTelemetryAttributes({
          OTEL_METRICS_INCLUDE_REPOSITORY: '1',
        })
        expect(syncAttrs).toEqual(resolved)
        // This workspace is a git repo so repo name or revision should be present
        expect(Object.keys(syncAttrs).length).toBeGreaterThan(0)
        if (resolved[VCS_REPOSITORY_NAME]) {
          expect(syncAttrs[VCS_REPOSITORY_NAME]).toBe(
            resolved[VCS_REPOSITORY_NAME],
          )
        }
        invalidateVcsRepositoryAttributesCache()
      }),
      runWithNewHostSession(
        { id: 'host-vcs-empty', cwd: nonGitDir },
        async () => {
          invalidateVcsRepositoryAttributesCache()
          const resolved = await resolveVcsRepositoryAttributesForCwd(nonGitDir)
          await delay(10)
          const syncAttrs = getVcsRepositoryTelemetryAttributes({
            OTEL_METRICS_INCLUDE_REPOSITORY: '1',
          })
          expect(resolved).toEqual({})
          expect(syncAttrs).toEqual({})
          invalidateVcsRepositoryAttributesCache()
        },
      ),
    ])
  })

  test('warningHandler.ts: counts warnings independently per host with zero extra process warning listeners', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const eventsA: LogEventMetadata[] = []
    const eventsB: LogEventMetadata[] = []

    try {
      initializeWarningHandler()
      const baselineListeners = process.listenerCount('warning')

      await Promise.all([
        runWithNewHostSession({ id: 'host-warn-a' }, async () => {
          initializeWarningHandler()
          attachAnalyticsSink({
            logEvent: (name, meta) => {
              if (name === 'tengu_node_warning') eventsA.push(meta)
            },
            logEventAsync: async () => {},
          })
          process.emit('warning', new Error('shared-warning-msg'))
          await delay(10)
          process.emit('warning', new Error('shared-warning-msg'))
          _resetAnalyticsForTesting()
        }),
        runWithNewHostSession({ id: 'host-warn-b' }, async () => {
          initializeWarningHandler()
          attachAnalyticsSink({
            logEvent: (name, meta) => {
              if (name === 'tengu_node_warning') eventsB.push(meta)
            },
            logEventAsync: async () => {},
          })
          await delay(5)
          process.emit('warning', new Error('shared-warning-msg'))
          _resetAnalyticsForTesting()
        }),
      ])

      expect(process.listenerCount('warning')).toBe(baselineListeners)
      expect(eventsA.map(e => e.occurrence_count)).toEqual([1, 2])
      expect(eventsB.map(e => e.occurrence_count)).toEqual([1])
    } finally {
      if (prevNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = prevNodeEnv
      }
    }
  })

  test('telemetry/perfettoTracing.ts: concurrent hosts keep separate enabled state, events, and agent registries', async () => {
    resetPerfettoTracer()
    const tempDir = makeTempDir('w6-perfetto-iso-')
    const prevPerfetto = process.env.CLAUDE_CODE_PERFETTO_TRACE
    process.env.CLAUDE_CODE_PERFETTO_TRACE = join(tempDir, 'trace-a.json')
    try {
      await Promise.all([
        runWithNewHostSession({ id: 'host-perf-a' }, async () => {
          initializePerfettoTracing()
          if (isPerfettoTracingEnabled()) {
            registerAgent('agent-a', 'worker-a')
            emitPerfettoInstant('event-only-a', 'test')
            await delay(15)
            const names = getPerfettoEvents().map(e => e.name)
            expect(names).toContain('event-only-a')
            expect(names).not.toContain('event-only-b')
          } else {
            // Even with PERFETTO_TRACING feature compiled OFF, state stays disabled
            expect(isPerfettoTracingEnabled()).toBe(false)
            expect(getPerfettoEvents()).toEqual([])
          }
          resetPerfettoTracer()
        }),
        runWithNewHostSession({ id: 'host-perf-b' }, async () => {
          // Host B does NOT call initializePerfettoTracing initially
          await delay(5)
          expect(isPerfettoTracingEnabled()).toBe(false)
          expect(getPerfettoEvents()).toEqual([])
          // Now initialize Host B separately
          initializePerfettoTracing()
          if (isPerfettoTracingEnabled()) {
            registerAgent('agent-b', 'worker-b')
            emitPerfettoInstant('event-only-b', 'test')
            const names = getPerfettoEvents().map(e => e.name)
            expect(names).toContain('event-only-b')
            expect(names).not.toContain('event-only-a')
          }
          resetPerfettoTracer()
        }),
      ])
    } finally {
      if (prevPerfetto === undefined) {
        delete process.env.CLAUDE_CODE_PERFETTO_TRACE
      } else {
        process.env.CLAUDE_CODE_PERFETTO_TRACE = prevPerfetto
      }
    }
  })

  test('ZERO process listener growth (exit / beforeExit / warning) across 25 ephemeral hosts', async () => {
    const tempDir = makeTempDir('w6-listener-leak-')
    const debugDir = join(tempDir, 'debug')
    mkdirSync(debugDir, { recursive: true })
    const prevNodeEnv = process.env.NODE_ENV
    const prevPerfetto = process.env.CLAUDE_CODE_PERFETTO_TRACE
    const prevDebugLogsDir = process.env.CLAUDE_CODE_DEBUG_LOGS_DIR
    process.env.NODE_ENV = 'development'
    process.env.CLAUDE_CODE_PERFETTO_TRACE = join(tempDir, 'trace.json')
    process.env.CLAUDE_CODE_DEBUG_LOGS_DIR = debugDir

    try {
      // Warm up 1st ephemeral host so one-time shared hooks are installed
      await runWithNewHostSession({ id: 'ephemeral-warmup' }, async () => {
        initializeWarningHandler()
        initializePerfettoTracing()
        if (isPerfettoTracingEnabled()) {
          registerAgent('ag-0', 'worker-0')
          emitPerfettoInstant('ping', 'test')
          expect(getPerfettoEvents().length).toBeGreaterThan(0)
        }
        enableDebugLogging()
        logForDebugging('warmup message')
        await flushDebugLogs()
        startEventLoopStallDetector()
        await runCleanupFunctions()
        resetPerfettoTracer()
        _resetDebugLoggerForTesting()
        _stopEventLoopStallDetectorForTesting()
      })

      const exitBefore = process.listenerCount('exit')
      const beforeExitBefore = process.listenerCount('beforeExit')
      const warningBefore = process.listenerCount('warning')

      for (let i = 0; i < 25; i++) {
        await runWithNewHostSession({ id: `ephemeral-${i}` }, async () => {
          initializeWarningHandler()
          initializePerfettoTracing()
          if (isPerfettoTracingEnabled()) {
            emitPerfettoInstant(`ev-${i}`, 'test')
          }
          enableDebugLogging()
          logForDebugging(`ephemeral debug ${i}`)
          await flushDebugLogs()
          startEventLoopStallDetector()
          initializeErrorLogSink()
          await runCleanupFunctions()
          resetPerfettoTracer()
          _resetDebugLoggerForTesting()
          _clearLogWritersForTesting()
          _resetErrorLogForTesting()
          _stopEventLoopStallDetectorForTesting()
        })
      }

      expect(process.listenerCount('exit')).toBe(exitBefore)
      expect(process.listenerCount('beforeExit')).toBe(beforeExitBefore)
      expect(process.listenerCount('warning')).toBe(warningBefore)

      // Sanity check that debug log file was written for ephemeral hosts
      const logContent = readFileSync(
        join(tempDir, 'debug', 'ephemeral-0.txt'),
        'utf8',
      )
      expect(logContent).toContain('ephemeral debug 0')
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevPerfetto === undefined) {
        delete process.env.CLAUDE_CODE_PERFETTO_TRACE
      } else {
        process.env.CLAUDE_CODE_PERFETTO_TRACE = prevPerfetto
      }
      if (prevDebugLogsDir === undefined) {
        delete process.env.CLAUDE_CODE_DEBUG_LOGS_DIR
      } else {
        process.env.CLAUDE_CODE_DEBUG_LOGS_DIR = prevDebugLogsDir
      }
    }
  })
})
