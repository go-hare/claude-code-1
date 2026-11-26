/**
 * Wave 7 Observability Fixes regression tests (2.1.331):
 * Verifies P0-7 boot-time wiring inheritance + per-host override isolation,
 * P1-4 process-global Langfuse client semantics, P1-5 multi-host Datadog & 1P
 * shutdown flushing + per-host cleanup registration, Sentry subconversation fix,
 * Debug P2-5 owning-host FS drainSync, and Perfetto P2-5 WeakRef timer cleanup.
 */

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { LoggerProvider } from '@opentelemetry/sdk-logs'
import * as Sentry from '@sentry/node'
import axios from 'axios'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  initializeDatadog,
  shutdownDatadog,
  trackDatadogEvent,
} from '../../services/analytics/datadog.js'
import {
  initialize1PEventLogging,
  logEventTo1PPromise,
  shutdown1PEventLogging,
} from '../../services/analytics/firstPartyEventLogger.js'
import * as growthbook from '../../services/analytics/growthbook.js'
import {
  _resetForTesting as _resetAnalyticsForTesting,
  attachAnalyticsSink,
  logEvent,
  logEventAsync,
} from '../../services/analytics/index.js'
import {
  _resetAnalyticsSinkForTesting,
  initializeAnalyticsGates,
  initializeAnalyticsSink,
} from '../../services/analytics/sink.js'
import {
  flushLangfuse,
  getLangfuseProcessor,
  initLangfuse,
  shutdownLangfuse,
} from '../../services/langfuse/client.js'
import { runCleanupFunctions } from '../cleanupRegistry.js'
import {
  _resetDebugLoggerForTesting,
  enableDebugLogging,
  flushDebugLogs,
  getHasFormattedOutput,
  isDebugMode,
  logForDebugging,
  setHasFormattedOutput,
} from '../debug.js'
import {
  type FsOperations,
  getFsImplementation,
  setFsImplementation,
} from '../fsOperations.js'
import {
  _resetErrorLogForTesting,
  attachErrorLogSink,
  logError,
  logMCPDebug,
  logMCPError,
} from '../log.js'
import {
  captureException,
  closeSentry,
  initSentry,
  isSentryInitialized,
  setTag,
  setUser,
} from '../sentry.js'
import {
  getActiveSessionFromAls,
  runWithNewHostSession,
  runWithSubconversationContext,
  type Session,
} from '../sessionRoot.js'
import {
  collectorTelemetryRoad,
  logOTelEvent,
  type OTelCollectorLogEntry,
} from '../telemetry/events.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms))

function restoreEnv(key: string, prev: string | undefined): void {
  if (prev === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = prev
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 7 Observability Fixes (P0-7, P1-4, P1-5, P2-5)', () => {
  test('analytics/index.ts: boot attachAnalyticsSink is inherited by isolated hosts without dropping events, while per-host override stays isolated', async () => {
    _resetAnalyticsForTesting()
    const bootEvents: Array<{
      event: string
      sessionId: string | undefined
    }> = []
    const hostBEvents: Array<{
      event: string
      sessionId: string | undefined
    }> = []

    try {
      // Boot-time sink attached on default host (outside ALS)
      attachAnalyticsSink({
        logEvent: event => {
          bootEvents.push({ event, sessionId: getActiveSessionFromAls()?.id })
        },
        logEventAsync: async event => {
          bootEvents.push({ event, sessionId: getActiveSessionFromAls()?.id })
        },
      })

      await Promise.all([
        runWithNewHostSession({ id: 'w7-analytics-inherit-a' }, async () => {
          // Log >1000 events without attaching a host-local sink: MUST dispatch
          // immediately to boot sink instead of buffering 1000 and dropping the rest.
          for (let i = 0; i < 1020; i++) {
            logEvent(`ev_a_${i}`, { idx: i })
          }
          await logEventAsync('ev_a_async', { ok: true })
        }),
        runWithNewHostSession({ id: 'w7-analytics-override-b' }, async () => {
          attachAnalyticsSink({
            logEvent: event => {
              hostBEvents.push({
                event,
                sessionId: getActiveSessionFromAls()?.id,
              })
            },
            logEventAsync: async event => {
              hostBEvents.push({
                event,
                sessionId: getActiveSessionFromAls()?.id,
              })
            },
          })
          logEvent('ev_b_only', { host: 'b' })
          await logEventAsync('ev_b_async', { host: 'b' })
          // Resetting inside Host B must NOT clear default host's boot sink
          _resetAnalyticsForTesting()
          logEvent('ev_b_after_reset_falls_back_to_boot', { ok: true })
        }),
      ])

      expect(
        bootEvents.filter(e => e.sessionId === 'w7-analytics-inherit-a').length,
      ).toBe(1021)
      expect(
        bootEvents.some(
          e => e.event === 'ev_b_only' || e.event === 'ev_b_async',
        ),
      ).toBe(false)
      expect(
        bootEvents.some(e => e.event === 'ev_b_after_reset_falls_back_to_boot'),
      ).toBe(true)
      expect(hostBEvents.map(e => e.event)).toEqual(['ev_b_only', 'ev_b_async'])
      expect(
        hostBEvents.every(e => e.sessionId === 'w7-analytics-override-b'),
      ).toBe(true)
    } finally {
      _resetAnalyticsForTesting()
    }
  })

  test('log.ts: boot attachErrorLogSink is inherited by isolated hosts while per-host attachErrorLogSink overrides cleanly', async () => {
    const prevDisableErr = process.env.DISABLE_ERROR_REPORTING
    const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    const prevVertex = process.env.CLAUDE_CODE_USE_VERTEX
    const prevFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.DISABLE_ERROR_REPORTING
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY

    _resetErrorLogForTesting()
    const bootSeen: string[] = []
    const hostBSeen: string[] = []

    try {
      attachErrorLogSink({
        logError: err =>
          bootSeen.push(`err:${getActiveSessionFromAls()?.id}:${err.message}`),
        logMCPError: (srv, err) =>
          bootSeen.push(
            `mcpErr:${getActiveSessionFromAls()?.id}:${srv}:${String(err)}`,
          ),
        logMCPDebug: (srv, msg) =>
          bootSeen.push(
            `mcpDbg:${getActiveSessionFromAls()?.id}:${srv}:${msg}`,
          ),
        getErrorsPath: () => '/tmp/boot-errors.jsonl',
        getMCPLogsPath: () => '/tmp/boot-mcp.jsonl',
      })

      await Promise.all([
        runWithNewHostSession({ id: 'w7-log-inherit-a' }, async () => {
          logError(new Error('boom-a'))
          logMCPError('srv-a', 'fail-a')
          logMCPDebug('srv-a', 'dbg-a')
        }),
        runWithNewHostSession({ id: 'w7-log-override-b' }, async () => {
          attachErrorLogSink({
            logError: err => hostBSeen.push(`err:${err.message}`),
            logMCPError: (srv, err) =>
              hostBSeen.push(`mcpErr:${srv}:${String(err)}`),
            logMCPDebug: (srv, msg) => hostBSeen.push(`mcpDbg:${srv}:${msg}`),
            getErrorsPath: () => '/tmp/b-errors.jsonl',
            getMCPLogsPath: () => '/tmp/b-mcp.jsonl',
          })
          logError(new Error('boom-b'))
          logMCPError('srv-b', 'fail-b')
          logMCPDebug('srv-b', 'dbg-b')
          _resetErrorLogForTesting()
        }),
      ])

      expect(bootSeen).toEqual([
        'err:w7-log-inherit-a:boom-a',
        'mcpErr:w7-log-inherit-a:srv-a:fail-a',
        'mcpDbg:w7-log-inherit-a:srv-a:dbg-a',
      ])
      expect(hostBSeen).toEqual([
        'err:boom-b',
        'mcpErr:srv-b:fail-b',
        'mcpDbg:srv-b:dbg-b',
      ])
    } finally {
      _resetErrorLogForTesting()
      restoreEnv('DISABLE_ERROR_REPORTING', prevDisableErr)
      restoreEnv('CLAUDE_CODE_USE_BEDROCK', prevBedrock)
      restoreEnv('CLAUDE_CODE_USE_VERTEX', prevVertex)
      restoreEnv('CLAUDE_CODE_USE_FOUNDRY', prevFoundry)
    }
  })

  test('analytics/sink.ts: boot initializeAnalyticsGates() Datadog gate is inherited by isolated hosts and overridable per host', async () => {
    const prevDisableTelemetry = process.env.DISABLE_TELEMETRY
    const prevDisableNonEssential =
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    const prevVertex = process.env.CLAUDE_CODE_USE_VERTEX
    const prevFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY
    const prevOpenAI = process.env.CLAUDE_CODE_USE_OPENAI
    const prevGemini = process.env.CLAUDE_CODE_USE_GEMINI
    const prevGrok = process.env.CLAUDE_CODE_USE_GROK
    const prevEnvKind = process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    const prevCustomOauth = process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
    const prevDisableGb = process.env.DISABLE_GROWTHBOOK
    delete process.env.DISABLE_TELEMETRY
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
    process.env.DISABLE_GROWTHBOOK = '1'

    let currentGateValue = true
    const gateSpy = spyOn(
      growthbook,
      'checkStatsigFeatureGate_CACHED_MAY_BE_STALE',
    ).mockImplementation(() => currentGateValue)
    const gbEnabledSpy = spyOn(
      growthbook,
      'isGrowthBookEnabled',
    ).mockImplementation(() => false)
    const dynConfigSpy = spyOn(
      growthbook,
      'getDynamicConfig_CACHED_MAY_BE_STALE',
    ).mockImplementation((_name, defaultValue) => defaultValue)

    const postedBatches: unknown[] = []
    const axiosPostSpy = spyOn(axios, 'post').mockImplementation((async (
      _url: string,
      data: unknown,
    ) => {
      postedBatches.push(data)
      return { status: 200, data: {} }
    }) as unknown as typeof axios.post)

    const globalWithMacro = globalThis as unknown as {
      MACRO?: { VERSION: string }
    }
    const prevMacro = globalWithMacro.MACRO
    if (!globalWithMacro.MACRO) {
      globalWithMacro.MACRO = { VERSION: '2.1.331-w7' }
    }

    _resetAnalyticsForTesting()
    _resetAnalyticsSinkForTesting()

    try {
      // Boot-time wiring on default host with Datadog gate = true
      initializeAnalyticsGates()
      initializeAnalyticsSink()

      // Flip the underlying gate cache to false AFTER boot so any host falling
      // back to cache instead of boot state would see false!
      currentGateValue = false

      // Isolated Host A inherits boot gate = true without calling initializeAnalyticsGates()
      await runWithNewHostSession({ id: 'w7-sink-inherit-a' }, async () => {
        initializeDatadog.cache.set(undefined, Promise.resolve(true))
        await logEventAsync('tengu_started', { source: 'host-a' })
        await shutdownDatadog()
      })
      expect(postedBatches.length).toBe(1)

      // Isolated Host B explicitly overrides gate via initializeAnalyticsGates() -> false
      await runWithNewHostSession({ id: 'w7-sink-override-b' }, async () => {
        initializeDatadog.cache.set(undefined, Promise.resolve(true))
        initializeAnalyticsGates()
        await logEventAsync('tengu_started', { source: 'host-b' })
        await shutdownDatadog()
      })
      // Host B's explicit false override prevented Datadog dispatch
      expect(postedBatches.length).toBe(1)
    } finally {
      await shutdownDatadog()
      _resetAnalyticsSinkForTesting()
      _resetAnalyticsForTesting()
      axiosPostSpy.mockRestore()
      gateSpy.mockRestore()
      gbEnabledSpy.mockRestore()
      dynConfigSpy.mockRestore()
      if (prevMacro === undefined) delete globalWithMacro.MACRO
      else globalWithMacro.MACRO = prevMacro
      restoreEnv('DISABLE_TELEMETRY', prevDisableTelemetry)
      restoreEnv(
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
        prevDisableNonEssential,
      )
      restoreEnv('CLAUDE_CODE_USE_BEDROCK', prevBedrock)
      restoreEnv('CLAUDE_CODE_USE_VERTEX', prevVertex)
      restoreEnv('CLAUDE_CODE_USE_FOUNDRY', prevFoundry)
      restoreEnv('CLAUDE_CODE_USE_OPENAI', prevOpenAI)
      restoreEnv('CLAUDE_CODE_USE_GEMINI', prevGemini)
      restoreEnv('CLAUDE_CODE_USE_GROK', prevGrok)
      restoreEnv('CLAUDE_CODE_ENVIRONMENT_KIND', prevEnvKind)
      restoreEnv('CLAUDE_CODE_CUSTOM_OAUTH_URL', prevCustomOauth)
      restoreEnv('DISABLE_GROWTHBOOK', prevDisableGb)
    }
  })

  test('analytics/datadog.ts (P1-5): shutdownDatadog() outside ALS flushes buffered logs from all live isolated hosts and per-host registerCleanup flushes single host', async () => {
    const prevDisableTelemetry = process.env.DISABLE_TELEMETRY
    const prevDisableNonEssential =
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    const prevVertex = process.env.CLAUDE_CODE_USE_VERTEX
    const prevFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY
    const prevOpenAI = process.env.CLAUDE_CODE_USE_OPENAI
    const prevGemini = process.env.CLAUDE_CODE_USE_GEMINI
    const prevGrok = process.env.CLAUDE_CODE_USE_GROK
    const prevEnvKind = process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    const prevCustomOauth = process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
    const prevFlushInterval = process.env.CLAUDE_CODE_DATADOG_FLUSH_INTERVAL_MS
    delete process.env.DISABLE_TELEMETRY
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
    process.env.CLAUDE_CODE_DATADOG_FLUSH_INTERVAL_MS = '60000'

    const globalWithMacro = globalThis as unknown as {
      MACRO?: { VERSION: string }
    }
    const prevMacro = globalWithMacro.MACRO
    if (!globalWithMacro.MACRO) {
      globalWithMacro.MACRO = { VERSION: '2.1.331-w7' }
    }

    const postedEvents: Array<{
      sessionId: string | undefined
      payload: unknown
    }> = []
    const axiosPostSpy = spyOn(axios, 'post').mockImplementation((async (
      _url: string,
      data: unknown,
    ) => {
      postedEvents.push({
        sessionId: getActiveSessionFromAls()?.id,
        payload: data,
      })
      return { status: 200, data: {} }
    }) as unknown as typeof axios.post)

    try {
      // Keep references to both isolated sessions so they remain live until shutdownDatadog()
      let sessionA: Session | undefined
      let sessionB: Session | undefined
      await runWithNewHostSession({ id: 'w7-dd-host-a' }, async s => {
        sessionA = s
        initializeDatadog.cache.set(undefined, Promise.resolve(true))
        await trackDatadogEvent('tengu_started', { source: 'dd-a' })
      })
      await runWithNewHostSession({ id: 'w7-dd-host-b' }, async s => {
        sessionB = s
        initializeDatadog.cache.set(undefined, Promise.resolve(true))
        await trackDatadogEvent('tengu_started', { source: 'dd-b' })
      })
      // Neither has flushed yet (60s timer)
      expect(postedEvents.length).toBe(0)

      // Process-level shutdownDatadog() outside ALS MUST flush BOTH isolated hosts!
      await shutdownDatadog()
      expect(postedEvents.length).toBe(2)
      const flushedSessions = postedEvents.map(e => e.sessionId).sort()
      expect(flushedSessions).toEqual(['w7-dd-host-a', 'w7-dd-host-b'])
      void sessionA
      void sessionB

      // Per-host cleanup via runCleanupFunctions() flushes ONLY that host
      postedEvents.length = 0
      let sessionD: Session | undefined
      await runWithNewHostSession({ id: 'w7-dd-host-d' }, async s => {
        sessionD = s
        initializeDatadog.cache.set(undefined, Promise.resolve(true))
        await trackDatadogEvent('tengu_started', { source: 'dd-d' })
      })
      await runWithNewHostSession({ id: 'w7-dd-host-c' }, async () => {
        initializeDatadog.cache.set(undefined, Promise.resolve(true))
        await trackDatadogEvent('tengu_started', { source: 'dd-c' })
        await runCleanupFunctions()
      })
      expect(postedEvents.length).toBe(1)
      expect(postedEvents[0]?.sessionId).toBe('w7-dd-host-c')

      // Now process shutdown flushes remaining Host D
      await shutdownDatadog()
      expect(postedEvents.length).toBe(2)
      expect(postedEvents[1]?.sessionId).toBe('w7-dd-host-d')
      void sessionD
    } finally {
      await shutdownDatadog()
      axiosPostSpy.mockRestore()
      if (prevMacro === undefined) delete globalWithMacro.MACRO
      else globalWithMacro.MACRO = prevMacro
      restoreEnv('DISABLE_TELEMETRY', prevDisableTelemetry)
      restoreEnv(
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
        prevDisableNonEssential,
      )
      restoreEnv('CLAUDE_CODE_USE_BEDROCK', prevBedrock)
      restoreEnv('CLAUDE_CODE_USE_VERTEX', prevVertex)
      restoreEnv('CLAUDE_CODE_USE_FOUNDRY', prevFoundry)
      restoreEnv('CLAUDE_CODE_USE_OPENAI', prevOpenAI)
      restoreEnv('CLAUDE_CODE_USE_GEMINI', prevGemini)
      restoreEnv('CLAUDE_CODE_USE_GROK', prevGrok)
      restoreEnv('CLAUDE_CODE_ENVIRONMENT_KIND', prevEnvKind)
      restoreEnv('CLAUDE_CODE_CUSTOM_OAUTH_URL', prevCustomOauth)
      restoreEnv('CLAUDE_CODE_DATADOG_FLUSH_INTERVAL_MS', prevFlushInterval)
    }
  })

  test('analytics/firstPartyEventLogger.ts (P0-7 + P1-5): boot 1P logger is inherited by isolated hosts, and shutdown1PEventLogging() outside ALS shuts down all live hosts', async () => {
    const prevDisableTelemetry = process.env.DISABLE_TELEMETRY
    const prevDisableNonEssential =
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    const prevVertex = process.env.CLAUDE_CODE_USE_VERTEX
    const prevFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY
    const prevCustomOauth = process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
    delete process.env.DISABLE_TELEMETRY
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL

    const globalWithMacro = globalThis as unknown as {
      MACRO?: { VERSION: string }
    }
    const prevMacro = globalWithMacro.MACRO
    if (!globalWithMacro.MACRO) {
      globalWithMacro.MACRO = { VERSION: '2.1.331-w7' }
    }

    const emittedByProvider = new Map<LoggerProvider, string[]>()
    const shutdownProviders: Array<{
      provider: LoggerProvider
      sessionId: string | undefined
    }> = []

    const origGetLogger = LoggerProvider.prototype.getLogger
    const getLoggerSpy = spyOn(
      LoggerProvider.prototype,
      'getLogger',
    ).mockImplementation(function (
      this: LoggerProvider,
      name: string,
      version?: string,
    ) {
      const realLogger = origGetLogger.call(this, name, version)
      const emitted: string[] = []
      emittedByProvider.set(this, emitted)
      return {
        emit(record: Parameters<typeof realLogger.emit>[0]) {
          emitted.push(String(record.body))
          realLogger.emit(record)
        },
      }
    } as unknown as typeof LoggerProvider.prototype.getLogger)

    const shutdownSpy = spyOn(
      LoggerProvider.prototype,
      'shutdown',
    ).mockImplementation(async function (this: LoggerProvider) {
      shutdownProviders.push({
        provider: this,
        sessionId: getActiveSessionFromAls()?.id,
      })
    })

    const axiosPostSpy = spyOn(axios, 'post').mockImplementation((async () => ({
      status: 200,
      data: {},
    })) as unknown as typeof axios.post)

    try {
      // Boot-time 1P init on default host
      initialize1PEventLogging()
      expect(emittedByProvider.size).toBe(1)
      const bootProvider = Array.from(emittedByProvider.keys())[0]!

      // Isolated Host A (no own init) inherits boot 1P logger!
      await runWithNewHostSession({ id: 'w7-1p-inherit-a' }, async () => {
        await logEventTo1PPromise('tengu_1p_from_host_a', { step: 1 })
      })
      expect(emittedByProvider.get(bootProvider)).toContain(
        'tengu_1p_from_host_a',
      )

      // Isolated Host B creates its own 1P provider (per-host override)
      let sessionB: Session | undefined
      await runWithNewHostSession({ id: 'w7-1p-override-b' }, async s => {
        sessionB = s
        initialize1PEventLogging()
        await logEventTo1PPromise('tengu_1p_from_host_b', { step: 2 })
      })
      expect(emittedByProvider.size).toBe(2)
      const hostBProvider = Array.from(emittedByProvider.keys())[1]!
      expect(emittedByProvider.get(hostBProvider)).toContain(
        'tengu_1p_from_host_b',
      )
      expect(emittedByProvider.get(bootProvider)).not.toContain(
        'tengu_1p_from_host_b',
      )

      // Isolated Host C creates its own provider and cleans up via runCleanupFunctions()
      await runWithNewHostSession({ id: 'w7-1p-cleanup-c' }, async () => {
        initialize1PEventLogging()
        await runCleanupFunctions()
      })
      expect(emittedByProvider.size).toBe(3)
      const hostCProvider = Array.from(emittedByProvider.keys())[2]!
      expect(
        shutdownProviders.some(
          entry =>
            entry.provider === hostCProvider &&
            entry.sessionId === 'w7-1p-cleanup-c',
        ),
      ).toBe(true)
      // Boot and Host B providers must STILL be alive!
      expect(
        shutdownProviders.some(entry => entry.provider === bootProvider),
      ).toBe(false)
      expect(
        shutdownProviders.some(entry => entry.provider === hostBProvider),
      ).toBe(false)

      // Process-level shutdown1PEventLogging() outside ALS MUST shut down BOTH
      // default host's provider AND Host B's live provider!
      await shutdown1PEventLogging()
      expect(
        shutdownProviders.some(entry => entry.provider === bootProvider),
      ).toBe(true)
      expect(
        shutdownProviders.some(
          entry =>
            entry.provider === hostBProvider &&
            entry.sessionId === 'w7-1p-override-b',
        ),
      ).toBe(true)
      void sessionB
    } finally {
      await shutdown1PEventLogging()
      getLoggerSpy.mockRestore()
      shutdownSpy.mockRestore()
      axiosPostSpy.mockRestore()
      if (prevMacro === undefined) delete globalWithMacro.MACRO
      else globalWithMacro.MACRO = prevMacro
      restoreEnv('DISABLE_TELEMETRY', prevDisableTelemetry)
      restoreEnv(
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
        prevDisableNonEssential,
      )
      restoreEnv('CLAUDE_CODE_USE_BEDROCK', prevBedrock)
      restoreEnv('CLAUDE_CODE_USE_VERTEX', prevVertex)
      restoreEnv('CLAUDE_CODE_USE_FOUNDRY', prevFoundry)
      restoreEnv('CLAUDE_CODE_CUSTOM_OAUTH_URL', prevCustomOauth)
    }
  })

  test('telemetry/events.ts: boot collectorTelemetryRoad is inherited across isolated hosts while per-host setRoad overrides isolate', async () => {
    const prevRoad = collectorTelemetryRoad.getRoad()
    const bootEntries: Array<{
      event: string
      sessionId: string | undefined
    }> = []
    const hostBEntries: Array<{
      event: string
      sessionId: string | undefined
    }> = []

    const bootRoad = {
      send: async (entry: OTelCollectorLogEntry) => {
        bootEntries.push({
          event: entry.event,
          sessionId: getActiveSessionFromAls()?.id,
        })
      },
    }
    const hostBRoad = {
      send: async (entry: OTelCollectorLogEntry) => {
        hostBEntries.push({
          event: entry.event,
          sessionId: getActiveSessionFromAls()?.id,
        })
      },
    }

    try {
      // Boot-time install on default host (mirrors functionHooksModules.ts:3608)
      collectorTelemetryRoad.setRoad(bootRoad)

      await Promise.all([
        runWithNewHostSession({ id: 'w7-road-inherit-a' }, async () => {
          expect(collectorTelemetryRoad.getRoad()).toBe(bootRoad)
          expect(collectorTelemetryRoad.isWaitingForRoad()).toBe(false)
          await logOTelEvent('ev_from_a', { k: 'a' })
          await collectorTelemetryRoad.settled()
        }),
        runWithNewHostSession({ id: 'w7-road-override-b' }, async () => {
          collectorTelemetryRoad.setRoad(hostBRoad)
          expect(collectorTelemetryRoad.getRoad()).toBe(hostBRoad)
          await logOTelEvent('ev_from_b', { k: 'b' })
          await collectorTelemetryRoad.settled()
        }),
        runWithNewHostSession({ id: 'w7-road-null-c' }, async () => {
          collectorTelemetryRoad.setRoad(null)
          expect(collectorTelemetryRoad.getRoad()).toBeNull()
          expect(collectorTelemetryRoad.isWaitingForRoad()).toBe(true)
        }),
      ])

      expect(bootEntries).toEqual([
        { event: 'ev_from_a', sessionId: 'w7-road-inherit-a' },
      ])
      expect(hostBEntries).toEqual([
        { event: 'ev_from_b', sessionId: 'w7-road-override-b' },
      ])

      // Verify waitingForRoad boot inheritance: default host enters waiting mode,
      // isolated host queues event, then boot installs road -> delivers inside isolated host ALS!
      const lateBootEntries: Array<{
        event: string
        sessionId: string | undefined
      }> = []
      collectorTelemetryRoad.setRoad(null)
      const pendingHostD = runWithNewHostSession(
        { id: 'w7-road-wait-d' },
        async () => {
          expect(collectorTelemetryRoad.getRoad()).toBeNull()
          expect(collectorTelemetryRoad.isWaitingForRoad()).toBe(true)
          await logOTelEvent('ev_late_d', { k: 'd' })
        },
      )
      await delay(10)
      collectorTelemetryRoad.setRoad({
        send: async entry => {
          lateBootEntries.push({
            event: entry.event,
            sessionId: getActiveSessionFromAls()?.id,
          })
        },
      })
      await pendingHostD
      expect(lateBootEntries).toEqual([
        { event: 'ev_late_d', sessionId: 'w7-road-wait-d' },
      ])
    } finally {
      collectorTelemetryRoad.setRoad(prevRoad)
    }
  })

  test('sentry.ts: boot initSentry() works across isolated hosts, respects per-host closeSentry(), and fixes subconversation bug on default host', async () => {
    const prevDsn = process.env.SENTRY_DSN
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/12345'

    await closeSentry()

    const capturedScopes: Array<{
      error: unknown
      tags: Record<string, string>
      user: unknown
      extras: Record<string, unknown>
    }> = []
    const globalTags: Array<[string, string]> = []
    const globalUsers: unknown[] = []
    let flushCount = 0
    let closeCount = 0

    const initSpy = spyOn(Sentry, 'init').mockImplementation(
      (() => undefined) as unknown as typeof Sentry.init,
    )
    const setTagSpy = spyOn(Sentry, 'setTag').mockImplementation(((
      k: string,
      v: string,
    ) => {
      globalTags.push([k, v])
    }) as unknown as typeof Sentry.setTag)
    const setUserSpy = spyOn(Sentry, 'setUser').mockImplementation(((
      u: unknown,
    ) => {
      globalUsers.push(u)
    }) as unknown as typeof Sentry.setUser)
    const flushSpy = spyOn(Sentry, 'flush').mockImplementation(async () => {
      flushCount++
      return true
    })
    const closeSpy = spyOn(Sentry, 'close').mockImplementation(async () => {
      closeCount++
      return true
    })

    let activeScopeTags: Record<string, string> = {}
    let activeScopeUser: unknown = null
    let activeScopeExtras: Record<string, unknown> = {}
    const withScopeSpy = spyOn(Sentry, 'withScope').mockImplementation(((
      cb: (scope: {
        setTag: (k: string, v: string) => void
        setUser: (u: unknown) => void
        setExtras: (e: Record<string, unknown>) => void
      }) => void,
    ) => {
      activeScopeTags = {}
      activeScopeUser = null
      activeScopeExtras = {}
      cb({
        setTag: (k, v) => {
          activeScopeTags[k] = v
        },
        setUser: u => {
          activeScopeUser = u
        },
        setExtras: e => {
          activeScopeExtras = { ...activeScopeExtras, ...e }
        },
      })
    }) as unknown as typeof Sentry.withScope)
    const captureSpy = spyOn(Sentry, 'captureException').mockImplementation(((
      err: unknown,
    ) => {
      capturedScopes.push({
        error: err,
        tags: { ...activeScopeTags },
        user: activeScopeUser,
        extras: { ...activeScopeExtras },
      })
      return 'event-id'
    }) as unknown as typeof Sentry.captureException)

    try {
      // Boot-time initSentry() on default host
      initSentry()
      expect(initSpy).toHaveBeenCalledTimes(1)
      expect(isSentryInitialized()).toBe(true)

      // Isolated Host A inherits boot Sentry without calling initSentry()
      await runWithNewHostSession({ id: 'w7-sentry-a' }, async () => {
        expect(isSentryInitialized()).toBe(true)
        setTag('host', 'a')
        setUser({ id: 'user-a' })
        // Must NOT touch global Sentry scope from isolated host!
        expect(globalTags).toEqual([])
        expect(globalUsers).toEqual([])

        captureException(new Error('host-a-boom'), { extraA: 1 })
        expect(capturedScopes.length).toBe(1)
        expect(capturedScopes[0]?.tags).toEqual({ host: 'a' })
        expect(capturedScopes[0]?.user).toEqual({ id: 'user-a' })
        expect(capturedScopes[0]?.extras).toEqual({ extraA: 1 })

        // Closing Sentry on Host A flushes only (does NOT close global SDK!)
        await closeSentry()
        expect(flushCount).toBe(1)
        expect(closeCount).toBe(0)
        expect(isSentryInitialized()).toBe(false)

        // Further captures in Host A are no-ops after explicit close
        captureException(new Error('host-a-after-close'))
        expect(capturedScopes.length).toBe(1)
      })

      // Sibling isolated Host B and default host STILL have active Sentry!
      expect(isSentryInitialized()).toBe(true)
      await runWithNewHostSession({ id: 'w7-sentry-b' }, async () => {
        expect(isSentryInitialized()).toBe(true)
        captureException(new Error('host-b-boom'))
        expect(capturedScopes.length).toBe(2)
        expect(capturedScopes[1]?.tags).toEqual({})
      })

      // Subconversation on DEFAULT host: setTag/setUser/closeSentry MUST treat
      // default host as default host (NOT isolated ALS host)!
      await runWithSubconversationContext(
        { sessionId: 'subconv-on-default' },
        async () => {
          setTag('env_sub', 'default')
          setUser({ id: 'default-user' })
          expect(globalTags).toEqual([['env_sub', 'default']])
          expect(globalUsers).toEqual([{ id: 'default-user' }])

          await closeSentry()
          expect(closeCount).toBe(1)
          expect(isSentryInitialized()).toBe(false)
        },
      )

      // After global close, default host and fresh isolated hosts see false
      expect(isSentryInitialized()).toBe(false)
      await runWithNewHostSession({ id: 'w7-sentry-after-close' }, async () => {
        expect(isSentryInitialized()).toBe(false)
      })
    } finally {
      await closeSentry()
      initSpy.mockRestore()
      setTagSpy.mockRestore()
      setUserSpy.mockRestore()
      flushSpy.mockRestore()
      closeSpy.mockRestore()
      withScopeSpy.mockRestore()
      captureSpy.mockRestore()
      restoreEnv('SENTRY_DSN', prevDsn)
    }
  })

  test('debug.ts (P0-7 + P2-5): boot enableDebugLogging/setHasFormattedOutput are inherited (and overridable), and onSharedDebugExit drainSync uses owning host FS', async () => {
    const tempDir = makeTempDir('w7-debug-')
    const debugDir = join(tempDir, 'debug')
    mkdirSync(debugDir, { recursive: true })
    const prevNodeEnv = process.env.NODE_ENV
    const prevDebugDir = process.env.CLAUDE_CODE_DEBUG_LOGS_DIR
    const prevUserType = process.env.USER_TYPE
    process.env.NODE_ENV = 'development'
    process.env.CLAUDE_CODE_DEBUG_LOGS_DIR = debugDir
    delete process.env.USER_TYPE

    _resetDebugLoggerForTesting()

    try {
      // Boot-time debug & formatted output flags set on default host
      enableDebugLogging()
      setHasFormattedOutput(true)

      await Promise.all([
        runWithNewHostSession({ id: 'w7-dbg-inherit-a' }, async () => {
          expect(isDebugMode()).toBe(true)
          expect(getHasFormattedOutput()).toBe(true)
          logForDebugging('line1\nline2')
          await flushDebugLogs()
        }),
        runWithNewHostSession({ id: 'w7-dbg-override-b' }, async () => {
          // Explicit per-host override to false beats boot true
          setHasFormattedOutput(false)
          expect(getHasFormattedOutput()).toBe(false)
          logForDebugging('raw1\nraw2')
          await flushDebugLogs()
        }),
      ])

      const logA = readFileSync(join(debugDir, 'w7-dbg-inherit-a.txt'), 'utf8')
      const logB = readFileSync(join(debugDir, 'w7-dbg-override-b.txt'), 'utf8')
      // Host A inherited hasFormattedOutput=true -> multiline string was JSON-stringified
      expect(logA).toContain('"line1\\nline2"')
      // Host B overrode hasFormattedOutput=false -> multiline string stayed raw
      expect(logB).toContain('raw1\nraw2')

      // P2-5: onSharedDebugExit -> drainSync MUST run inside owning host's root
      // session so getFsImplementation() reads that host's custom FS!
      const hostCFsCalls: Array<{
        path: string
        data: string
        sessionId: string | undefined
      }> = []
      let keptSessionC: Session | undefined
      await runWithNewHostSession({ id: 'w7-dbg-exit-fs-c' }, async s => {
        keptSessionC = s
        const baseFs = getFsImplementation()
        const customFs: FsOperations = {
          ...baseFs,
          mkdirSync: () => {},
          appendFileSync: (path: string, data: string) => {
            hostCFsCalls.push({
              path,
              data,
              sessionId: getActiveSessionFromAls()?.id,
            })
          },
        }
        setFsImplementation(customFs)
        // Queue a debug message without awaiting flush so unflushedChunks / buffer
        // will be drained synchronously on exit!
        logForDebugging('sync-exit-marker-host-c')
      })

      // Invoke debug.ts's shared exit listener directly outside ALS
      const debugExitListener = process
        .listeners('exit')
        .find(fn => fn.name === 'onSharedDebugExit')
      expect(debugExitListener).toBeDefined()
      ;(debugExitListener as (code: number) => void)(0)

      expect(
        hostCFsCalls.some(
          c =>
            c.data.includes('sync-exit-marker-host-c') &&
            c.sessionId === 'w7-dbg-exit-fs-c',
        ),
      ).toBe(true)
      void keptSessionC
    } finally {
      _resetDebugLoggerForTesting()
      restoreEnv('NODE_ENV', prevNodeEnv)
      restoreEnv('CLAUDE_CODE_DEBUG_LOGS_DIR', prevDebugDir)
      restoreEnv('USER_TYPE', prevUserType)
    }
  })

  test('telemetry/perfettoTracing.ts (P0-7 + P2-5): boot Perfetto state is inherited (with per-host override), and intervals use WeakRef & self-clear after GC', () => {
    const tempDir = makeTempDir('w7-perfetto-')
    const script = `
import { join } from 'path'
import * as perfetto from './src/utils/telemetry/perfettoTracing.js'
import { runWithNewHostSession } from './src/utils/sessionRoot.js'

const tempDir = process.env.W7_PERFETTO_TEMP_DIR
const assert = (cond, msg) => {
  if (!cond) throw new Error('Assertion failed: ' + msg)
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

perfetto.resetPerfettoTracer()

// Part A (P0-7): Boot-time initializePerfettoTracing() on default host
process.env.CLAUDE_CODE_PERFETTO_TRACE = join(tempDir, 'boot-trace.json')
delete process.env.CLAUDE_CODE_PERFETTO_WRITE_INTERVAL_S
perfetto.initializePerfettoTracing()
assert(perfetto.isPerfettoTracingEnabled() === true, 'boot tracing enabled')

// Isolated Host A (never called initializePerfettoTracing) inherits boot tracing!
await runWithNewHostSession({ id: 'w7-perf-inherit-a' }, async () => {
  assert(perfetto.isPerfettoTracingEnabled() === true, 'Host A inherits enabled')
  perfetto.emitPerfettoInstant('event_from_inherited_host_a', 'acp')
  assert(
    perfetto.getPerfettoEvents().some(e => e.name === 'event_from_inherited_host_a'),
    'Host A sees emitted event',
  )
})
assert(
  perfetto.getPerfettoEvents().some(e => e.name === 'event_from_inherited_host_a'),
  'Default host trace recorded Host A event',
)

// Isolated Host B explicitly initializes its own Perfetto tracer (per-host override)
await runWithNewHostSession({ id: 'w7-perf-override-b' }, async () => {
  process.env.CLAUDE_CODE_PERFETTO_TRACE = join(tempDir, 'host-b-trace.json')
  perfetto.initializePerfettoTracing()
  perfetto.emitPerfettoInstant('event_only_in_host_b', 'test')
  const names = perfetto.getPerfettoEvents().map(e => e.name)
  assert(names.includes('event_only_in_host_b'), 'Host B records own event')
  assert(!names.includes('event_from_inherited_host_a'), 'Host B isolated from boot events')
  perfetto.resetPerfettoTracer()
})
assert(
  !perfetto.getPerfettoEvents().some(e => e.name === 'event_only_in_host_b'),
  'Boot trace isolated from Host B override',
)

// Isolated Host C explicitly resets -> disabled in Host C only, boot stays enabled
await runWithNewHostSession({ id: 'w7-perf-reset-c' }, async () => {
  perfetto.resetPerfettoTracer()
  assert(perfetto.isPerfettoTracingEnabled() === false, 'Host C reset disables only Host C')
})
assert(perfetto.isPerfettoTracingEnabled() === true, 'Boot remains enabled after Host C reset')

perfetto.resetPerfettoTracer()

// Part B (P2-5): Intervals hold WeakRef<Session> (not strong Session) and
// self-clear when the owning Session is GC'd, with zero process listener growth!
const capturedIntervals = []
const clearedIntervalIds = new Set()
const origSetInterval = globalThis.setInterval
const origClearInterval = globalThis.clearInterval
globalThis.setInterval = (fn, ms) => {
  const id = origSetInterval(fn, ms)
  capturedIntervals.push({ id, cb: fn })
  return id
}
globalThis.clearInterval = id => {
  clearedIntervalIds.add(id)
  return origClearInterval(id)
}

try {
  process.env.CLAUDE_CODE_PERFETTO_TRACE = join(tempDir, 'weakref-trace.json')
  process.env.CLAUDE_CODE_PERFETTO_WRITE_INTERVAL_S = '60'

  let sessionRef
  const createEphemeralHost = () => {
    runWithNewHostSession({ id: 'w7-perf-ephemeral-gc' }, session => {
      sessionRef = new WeakRef(session)
      perfetto.initializePerfettoTracing()
      perfetto.emitPerfettoInstant('ephemeral_ev', 'test')
    })
  }
  createEphemeralHost()
  assert(capturedIntervals.length === 2, 'expected 2 perfetto intervals, got ' + capturedIntervals.length)

  for (let i = 0; i < 15 && sessionRef.deref() !== undefined; i++) {
    Bun.gc(true)
    await delay(5)
  }
  assert(sessionRef.deref() === undefined, 'ephemeral Session must be GC-able despite active intervals')

  for (const entry of capturedIntervals) {
    entry.cb()
  }
  for (const entry of capturedIntervals) {
    assert(clearedIntervalIds.has(entry.id), 'interval must self-clear after Session GC')
  }
} finally {
  for (const entry of capturedIntervals) {
    origClearInterval(entry.id)
  }
  globalThis.setInterval = origSetInterval
  globalThis.clearInterval = origClearInterval
}

// Verify zero process listener growth across ephemeral hosts
const exitBefore = process.listenerCount('exit')
const beforeExitBefore = process.listenerCount('beforeExit')
delete process.env.CLAUDE_CODE_PERFETTO_WRITE_INTERVAL_S
for (let i = 0; i < 15; i++) {
  await runWithNewHostSession({ id: 'w7-perf-loop-' + i }, async () => {
    process.env.CLAUDE_CODE_PERFETTO_TRACE = join(tempDir, 'loop-' + i + '.json')
    perfetto.initializePerfettoTracing()
    perfetto.emitPerfettoInstant('ev_' + i, 'test')
    perfetto.resetPerfettoTracer()
  })
}
assert(process.listenerCount('exit') === exitBefore, 'zero exit listener growth')
assert(process.listenerCount('beforeExit') === beforeExitBefore, 'zero beforeExit listener growth')
console.log('PERFETTO_W7_OK')
`
    const proc = Bun.spawnSync(
      [process.execPath, '--feature=PERFETTO_TRACING', '-e', script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          W7_PERFETTO_TEMP_DIR: tempDir,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const stdout = proc.stdout.toString('utf8')
    const stderr = proc.stderr.toString('utf8')
    expect({ exitCode: proc.exitCode, stdout, stderr }).toMatchObject({
      exitCode: 0,
    })
    expect(stdout).toContain('PERFETTO_W7_OK')
  })

  test('langfuse/client.ts (P1-4): processor & provider are process-global, boot initLangfuse() is visible across isolated hosts, and isolated host teardown flushes without clobbering global provider', async () => {
    const prevPub = process.env.LANGFUSE_PUBLIC_KEY
    const prevSec = process.env.LANGFUSE_SECRET_KEY
    const prevBase = process.env.LANGFUSE_BASE_URL
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-w7-test'
    process.env.LANGFUSE_SECRET_KEY = 'sk-w7-test'
    process.env.LANGFUSE_BASE_URL = 'https://cloud.langfuse.test'

    const globalWithMacro = globalThis as unknown as {
      MACRO?: { VERSION: string }
    }
    const prevMacro = globalWithMacro.MACRO
    if (!globalWithMacro.MACRO) {
      globalWithMacro.MACRO = { VERSION: '2.1.331-w7' }
    }

    await shutdownLangfuse()

    let flushCalls = 0
    let shutdownCalls = 0
    const flushSpy = spyOn(
      LangfuseSpanProcessor.prototype,
      'forceFlush',
    ).mockImplementation(async () => {
      flushCalls++
    })
    const shutdownSpy = spyOn(
      LangfuseSpanProcessor.prototype,
      'shutdown',
    ).mockImplementation(async () => {
      shutdownCalls++
    })

    try {
      // Boot-time initLangfuse() on default host
      expect(initLangfuse()).toBe(true)
      const bootProcessor = getLangfuseProcessor()
      expect(bootProcessor).not.toBeNull()

      // Isolated Host A sees bootProcessor, flushLangfuse() works, and
      // shutdownLangfuse() inside Host A flushes WITHOUT killing global provider!
      await runWithNewHostSession({ id: 'w7-langfuse-a' }, async () => {
        expect(getLangfuseProcessor()).toBe(bootProcessor)
        // Idempotent re-init returns true and keeps exact same processor
        expect(initLangfuse()).toBe(true)
        expect(getLangfuseProcessor()).toBe(bootProcessor)

        await flushLangfuse()
        expect(flushCalls).toBe(1)

        await shutdownLangfuse()
        expect(flushCalls).toBe(2)
        expect(shutdownCalls).toBe(0)
        expect(getLangfuseProcessor()).toBe(bootProcessor)
      })

      // Sibling Host B still sees the live bootProcessor!
      await runWithNewHostSession({ id: 'w7-langfuse-b' }, async () => {
        expect(getLangfuseProcessor()).toBe(bootProcessor)
        await flushLangfuse()
        expect(flushCalls).toBe(3)
      })

      // Subconversation on default host performs full process shutdown!
      await runWithSubconversationContext(
        { sessionId: 'w7-langfuse-sub-default' },
        async () => {
          await shutdownLangfuse()
          expect(flushCalls).toBe(4)
          expect(shutdownCalls).toBe(1)
          expect(getLangfuseProcessor()).toBeNull()
        },
      )
    } finally {
      await shutdownLangfuse()
      flushSpy.mockRestore()
      shutdownSpy.mockRestore()
      if (prevMacro === undefined) delete globalWithMacro.MACRO
      else globalWithMacro.MACRO = prevMacro
      restoreEnv('LANGFUSE_PUBLIC_KEY', prevPub)
      restoreEnv('LANGFUSE_SECRET_KEY', prevSec)
      restoreEnv('LANGFUSE_BASE_URL', prevBase)
    }
  })
})
