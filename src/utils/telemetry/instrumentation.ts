import { DiagLogLevel, diag, trace } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
// OTLP/Prometheus exporters are dynamically imported inside the protocol
// switch statements below. A process uses at most one protocol variant per
// signal, but static imports would load all 6 (~1.2MB) on every startup.
import {
  hostDetector,
  osDetector,
  resourceFromAttributes,
} from '@opentelemetry/resources'
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
} from '@opentelemetry/sdk-logs'
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_HOST_ARCH,
} from '@opentelemetry/semantic-conventions'
import {
  getLoggerProvider,
  getMeterProvider,
  getTracerProvider,
  setEventLogger,
  setLoggerProvider,
  setMeterProvider,
  setTracerProvider,
} from 'src/bootstrap/state.js'
import {
  getOtelHeadersFromHelperAsync,
  prefetchOtelHeadersFromHelper,
  getSubscriptionType,
  is1PApiCustomer,
  isClaudeAISubscriber,
} from 'src/utils/auth.js'
import { getPlatform, getWslVersion } from 'src/utils/platform.js'
import {
  formatGatewaySessionExpiredError,
  getGatewayAuth,
  isGatewayAuthExpired,
  isGatewayAuthPinned,
} from 'src/utils/gatewayEnv.js'

import { registerCleanup } from '../cleanupRegistry.js'
import { getHasFormattedOutput, logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { errorMessage } from '../errors.js'
import { getMTLSConfig } from '../mtls.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { jsonStringify } from '../slowOperations.js'
import { profileCheckpoint } from '../startupProfiler.js'
import {
  DEFAULT_MANAGED_RESOURCE_ATTRIBUTE_KEYS,
  getOtelResourceAttributeStatus,
} from '../telemetryAttributes.js'
import { isBetaTracingEnabled } from './betaSessionTracing.js'
import { BigQueryMetricsExporter } from './bigqueryExporter.js'
import { ClaudeCodeDiagLogger } from './logger.js'
import { createOtlpHttpAgentFactory } from './otlpHttpAgent.js'
import { initializePerfettoTracing } from './perfettoTracing.js'
import {
  endInteractionSpan,
  isEnhancedTelemetryEnabled,
} from './sessionTracing.js'

const DEFAULT_METRICS_EXPORT_INTERVAL_MS = 60000
const DEFAULT_LOGS_EXPORT_INTERVAL_MS = 5000
const DEFAULT_TRACES_EXPORT_INTERVAL_MS = 5000

/** Official 2.1.323 (#2121, `jt` @311250200): default OTLP protocol when an endpoint is set. */
export const DEFAULT_OTLP_PROTOCOL = 'http/protobuf'

export type OtlpSignal = 'metrics' | 'logs' | 'traces'

const OTLP_SIGNAL_ENV_SUFFIX: Record<OtlpSignal, string> = {
  metrics: 'METRICS',
  logs: 'LOGS',
  traces: 'TRACES',
}

/**
 * Official 2.1.323 (`te` @311265500): validate an `http://` or `https://` URL
 * with a non-empty host.
 */
export function parseValidOtlpHttpUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.host
      ? parsed.href
      : null
  } catch {
    return null
  }
}

/**
 * Official 2.1.323 (`We` / `otlpEndpointIn` @311265000): resolve the effective
 * HTTP(S) OTLP endpoint for a signal from `OTEL_EXPORTER_OTLP_<SIGNAL>_ENDPOINT`
 * or `OTEL_EXPORTER_OTLP_ENDPOINT`.
 */
export function resolveOtlpEndpointForSignal(
  signal: OtlpSignal,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const upper = OTLP_SIGNAL_ENV_SUFFIX[signal]
  const signalEndpoint = env[`OTEL_EXPORTER_OTLP_${upper}_ENDPOINT`]
  if (signalEndpoint?.trim()) {
    return parseValidOtlpHttpUrl(signalEndpoint)
  }
  const baseEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!baseEndpoint?.trim() || parseValidOtlpHttpUrl(baseEndpoint) === null) {
    return null
  }
  return parseValidOtlpHttpUrl(
    `${baseEndpoint}${baseEndpoint.endsWith('/') ? '' : '/'}v1/${signal}`,
  )
}

/**
 * Official 2.1.323 (#2121, `Re` @311255050):
 * Resolve OTLP protocol for `signal`, defaulting to `http/protobuf` whenever a
 * valid HTTP(S) OTLP endpoint is configured and no explicit protocol env var is
 * set.
 */
export function resolveOtlpProtocol(
  signal: OtlpSignal,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const upper = OTLP_SIGNAL_ENV_SUFFIX[signal]
  return (
    env[`OTEL_EXPORTER_OTLP_${upper}_PROTOCOL`]?.trim() ||
    env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim() ||
    (resolveOtlpEndpointForSignal(signal, env) !== null
      ? DEFAULT_OTLP_PROTOCOL
      : undefined)
  )
}

function buildOtlpProtocolError(
  signal: OtlpSignal,
  protocol: string | undefined,
): Error {
  const upper = OTLP_SIGNAL_ENV_SUFFIX[signal]
  return new Error(
    protocol === undefined
      ? `No protocol is set for the ${signal} OTLP exporter, and its endpoint (OTEL_EXPORTER_OTLP_${upper}_ENDPOINT if set, otherwise OTEL_EXPORTER_OTLP_ENDPOINT) is unset or not a valid http:// or https:// URL (check for stray white space)`
      : `Unknown protocol set in OTEL_EXPORTER_OTLP_${upper}_PROTOCOL or OTEL_EXPORTER_OTLP_PROTOCOL env var: ${protocol}`,
  )
}

class TelemetryTimeoutError extends Error {}

function telemetryTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      (rej: (e: Error) => void, msg: string) =>
        rej(new TelemetryTimeoutError(msg)),
      ms,
      reject,
      message,
    ).unref()
  })
}

export function bootstrapTelemetry() {
  if (process.env.USER_TYPE === 'ant') {
    // Read from ANT_ prefixed variables that are defined at build time
    if (process.env.ANT_OTEL_METRICS_EXPORTER) {
      process.env.OTEL_METRICS_EXPORTER = process.env.ANT_OTEL_METRICS_EXPORTER
    }
    if (process.env.ANT_OTEL_LOGS_EXPORTER) {
      process.env.OTEL_LOGS_EXPORTER = process.env.ANT_OTEL_LOGS_EXPORTER
    }
    if (process.env.ANT_OTEL_TRACES_EXPORTER) {
      process.env.OTEL_TRACES_EXPORTER = process.env.ANT_OTEL_TRACES_EXPORTER
    }
    if (process.env.ANT_OTEL_EXPORTER_OTLP_PROTOCOL) {
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL =
        process.env.ANT_OTEL_EXPORTER_OTLP_PROTOCOL
    }
    if (process.env.ANT_OTEL_EXPORTER_OTLP_ENDPOINT) {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
        process.env.ANT_OTEL_EXPORTER_OTLP_ENDPOINT
    }
    if (process.env.ANT_OTEL_EXPORTER_OTLP_HEADERS) {
      process.env.OTEL_EXPORTER_OTLP_HEADERS =
        process.env.ANT_OTEL_EXPORTER_OTLP_HEADERS
    }
  }

  // Set default tempoality to 'delta' because it's the more sane default
  if (!process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE) {
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = 'delta'
  }
}

// Per OTEL spec, "none" means "no automatically configured exporter for this signal".
// https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/#exporter-selection
export function parseExporterTypes(value: string | undefined): string[] {
  return (value || '')
    .trim()
    .split(',')
    .filter(Boolean)
    .map(t => t.trim())
    .filter(t => t !== 'none')
}

async function getOtlpReaders() {
  const exporterTypes = parseExporterTypes(process.env.OTEL_METRICS_EXPORTER)
  const exportInterval = parseInt(
    process.env.OTEL_METRIC_EXPORT_INTERVAL ||
      DEFAULT_METRICS_EXPORT_INTERVAL_MS.toString(),
    10,
  )

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === 'console') {
      // Custom console exporter that shows resource attributes
      const consoleExporter = new ConsoleMetricExporter()
      const originalExport = consoleExporter.export.bind(consoleExporter)

      consoleExporter.export = (metrics, callback) => {
        // Log resource attributes once at the start
        if (metrics.resource && metrics.resource.attributes) {
          // The console exporter is for debugging, so console output is intentional here

          logForDebugging('\n=== Resource Attributes ===')
          logForDebugging(jsonStringify(metrics.resource.attributes))
          logForDebugging('===========================\n')
        }

        return originalExport(metrics, callback)
      }

      exporters.push(consoleExporter)
    } else if (exporterType === 'otlp') {
      const protocol = resolveOtlpProtocol('metrics')

      const { onlyConfigHeaders, ...httpConfig } = getOTLPExporterConfig(
        protocol,
        'metrics',
      )

      switch (protocol) {
        case 'grpc': {
          // Lazy-import to keep @grpc/grpc-js (~700KB) out of the telemetry chunk
          // when the protocol is http/protobuf (ant default) or http/json.
          const { OTLPMetricExporter } = await import(
            '@opentelemetry/exporter-metrics-otlp-grpc'
          )
          exporters.push(
            withSuppressedOtelHeadersEnv(
              'METRICS',
              onlyConfigHeaders,
              () => new OTLPMetricExporter(),
            ),
          )
          break
        }
        case 'http/json': {
          const { OTLPMetricExporter } = await import(
            '@opentelemetry/exporter-metrics-otlp-http'
          )
          exporters.push(
            withSuppressedOtelHeadersEnv(
              'METRICS',
              onlyConfigHeaders,
              () => new OTLPMetricExporter(httpConfig),
            ),
          )
          break
        }
        case 'http/protobuf': {
          const { OTLPMetricExporter } = await import(
            '@opentelemetry/exporter-metrics-otlp-proto'
          )
          exporters.push(
            withSuppressedOtelHeadersEnv(
              'METRICS',
              onlyConfigHeaders,
              () => new OTLPMetricExporter(httpConfig),
            ),
          )
          break
        }
        default:
          throw buildOtlpProtocolError('metrics', protocol)
      }
    } else if (exporterType === 'prometheus') {
      // densable 2.1.216 #26: PrometheusSerializer emits `# UNIT` only when
      // descriptor.unit is truthy (empty unit → invalid OpenMetrics). Local
      // @opentelemetry/exporter-prometheus@0.215 embeds that gate; pure
      // regression surface: prometheusUnitLine.ts.
      const { PrometheusExporter } = await import(
        '@opentelemetry/exporter-prometheus'
      )
      exporters.push(new PrometheusExporter())
    } else {
      throw new Error(
        `Unknown exporter type set in OTEL_EXPORTER_OTLP_METRICS_PROTOCOL or OTEL_EXPORTER_OTLP_PROTOCOL env var: ${exporterType}`,
      )
    }
  }

  return exporters.map(exporter => {
    if ('export' in exporter) {
      return new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: exportInterval,
      })
    }
    return exporter
  })
}

async function getOtlpLogExporters() {
  const exporterTypes = parseExporterTypes(process.env.OTEL_LOGS_EXPORTER)

  const protocol = resolveOtlpProtocol('logs')
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  logForDebugging(
    `[3P telemetry] getOtlpLogExporters: types=${jsonStringify(exporterTypes)}, protocol=${protocol}, endpoint=${endpoint}`,
  )

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === 'console') {
      exporters.push(new ConsoleLogRecordExporter())
    } else if (exporterType === 'otlp') {
      const { onlyConfigHeaders, ...httpConfig } = getOTLPExporterConfig(
        protocol,
        'logs',
      )

      switch (protocol) {
        case 'grpc': {
          const { OTLPLogExporter } = await import(
            '@opentelemetry/exporter-logs-otlp-grpc'
          )
          exporters.push(
            withSuppressedOtelHeadersEnv(
              'LOGS',
              onlyConfigHeaders,
              () => new OTLPLogExporter(),
            ),
          )
          break
        }
        case 'http/json': {
          const { OTLPLogExporter } = await import(
            '@opentelemetry/exporter-logs-otlp-http'
          )
          exporters.push(
            withSuppressedOtelHeadersEnv(
              'LOGS',
              onlyConfigHeaders,
              () => new OTLPLogExporter(httpConfig),
            ),
          )
          break
        }
        case 'http/protobuf': {
          const { OTLPLogExporter } = await import(
            '@opentelemetry/exporter-logs-otlp-proto'
          )
          exporters.push(
            withSuppressedOtelHeadersEnv(
              'LOGS',
              onlyConfigHeaders,
              () => new OTLPLogExporter(httpConfig),
            ),
          )
          break
        }
        default:
          throw buildOtlpProtocolError('logs', protocol)
      }
    } else {
      throw new Error(
        `Unknown exporter type set in OTEL_LOGS_EXPORTER env var: ${exporterType}`,
      )
    }
  }

  return exporters
}

async function getOtlpTraceExporters() {
  const exporterTypes = parseExporterTypes(process.env.OTEL_TRACES_EXPORTER)

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === 'console') {
      exporters.push(new ConsoleSpanExporter())
    } else if (exporterType === 'otlp') {
      const protocol = resolveOtlpProtocol('traces')

      const { onlyConfigHeaders, ...httpConfig } = getOTLPExporterConfig(
        protocol,
        'traces',
      )

      switch (protocol) {
        case 'grpc': {
          const { OTLPTraceExporter } = await import(
            '@opentelemetry/exporter-trace-otlp-grpc'
          )
          exporters.push(
            withSuppressedOtelHeadersEnv(
              'TRACES',
              onlyConfigHeaders,
              () => new OTLPTraceExporter(),
            ),
          )
          break
        }
        case 'http/json': {
          const { OTLPTraceExporter } = await import(
            '@opentelemetry/exporter-trace-otlp-http'
          )
          exporters.push(
            withSuppressedOtelHeadersEnv(
              'TRACES',
              onlyConfigHeaders,
              () => new OTLPTraceExporter(httpConfig),
            ),
          )
          break
        }
        case 'http/protobuf': {
          const { OTLPTraceExporter } = await import(
            '@opentelemetry/exporter-trace-otlp-proto'
          )
          exporters.push(
            withSuppressedOtelHeadersEnv(
              'TRACES',
              onlyConfigHeaders,
              () => new OTLPTraceExporter(httpConfig),
            ),
          )
          break
        }
        default:
          throw buildOtlpProtocolError('traces', protocol)
      }
    } else {
      throw new Error(
        `Unknown exporter type set in OTEL_TRACES_EXPORTER env var: ${exporterType}`,
      )
    }
  }

  return exporters
}

export function isTelemetryEnabled() {
  // Official ENABLE_TELEMETRY densable.
  try {
    const { isTelemetryEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
    return isTelemetryEnvEnabled()
  } catch {
    return isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_TELEMETRY)
  }
}

function getBigQueryExportingReader() {
  const bigqueryExporter = new BigQueryMetricsExporter()
  return new PeriodicExportingMetricReader({
    exporter: bigqueryExporter,
    exportIntervalMillis: 5 * 60 * 1000, // 5mins for BigQuery metrics exporter to reduce load
  })
}

function isBigQueryMetricsEnabled() {
  // BigQuery metrics are enabled for:
  // 1. API customers (excluding Claude.ai subscribers and Bedrock/Vertex)
  // 2. Claude for Enterprise (C4E) users
  // 3. Claude for Teams users
  const subscriptionType = getSubscriptionType()
  const isC4EOrTeamUser =
    isClaudeAISubscriber() &&
    (subscriptionType === 'enterprise' || subscriptionType === 'team')

  return is1PApiCustomer() || isC4EOrTeamUser
}

/**
 * Initialize beta tracing - a separate code path for detailed debugging.
 * Uses BETA_TRACING_ENDPOINT instead of OTEL_EXPORTER_OTLP_ENDPOINT.
 */
async function initializeBetaTracing(
  resource: ReturnType<typeof resourceFromAttributes>,
): Promise<void> {
  const endpoint = process.env.BETA_TRACING_ENDPOINT
  if (!endpoint) {
    return
  }

  const [{ OTLPTraceExporter }, { OTLPLogExporter }] = await Promise.all([
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/exporter-logs-otlp-http'),
  ])

  // Official 2.1.319 (#1758): detailed beta tracing must present
  // CLAUDE_CODE_CLIENT_CERT (mTLS) to collectors that require a client cert.
  const hasMtlsClientCert = Boolean(getMTLSConfig()?.cert)
  const hasOtelTlsOverride = (signal: 'traces' | 'logs'): boolean => {
    const upper = signal.toUpperCase()
    const keys = [
      'OTEL_EXPORTER_OTLP_CERTIFICATE',
      'OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE',
      'OTEL_EXPORTER_OTLP_CLIENT_KEY',
      `OTEL_EXPORTER_OTLP_${upper}_CERTIFICATE`,
      `OTEL_EXPORTER_OTLP_${upper}_CLIENT_CERTIFICATE`,
      `OTEL_EXPORTER_OTLP_${upper}_CLIENT_KEY`,
    ]
    return keys.some(k => Boolean(process.env[k]))
  }
  const betaAgentFactory = createOtlpHttpAgentFactory(endpoint)

  const httpConfig: Record<string, unknown> = {
    url: `${endpoint}/v1/traces`,
    ...(hasMtlsClientCert || !hasOtelTlsOverride('traces')
      ? { httpAgentOptions: betaAgentFactory }
      : {}),
  }

  const logHttpConfig: Record<string, unknown> = {
    url: `${endpoint}/v1/logs`,
    ...(hasMtlsClientCert || !hasOtelTlsOverride('logs')
      ? { httpAgentOptions: betaAgentFactory }
      : {}),
  }

  // Initialize trace exporter
  const traceExporter = new OTLPTraceExporter(httpConfig)
  const spanProcessor = new BatchSpanProcessor(traceExporter, {
    scheduledDelayMillis: DEFAULT_TRACES_EXPORT_INTERVAL_MS,
  })

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [spanProcessor],
  })

  trace.setGlobalTracerProvider(tracerProvider)
  setTracerProvider(tracerProvider)

  // Initialize log exporter
  const logExporter = new OTLPLogExporter(logHttpConfig)
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor(logExporter, {
        scheduledDelayMillis: DEFAULT_LOGS_EXPORT_INTERVAL_MS,
      }),
    ],
  })

  logs.setGlobalLoggerProvider(loggerProvider)
  setLoggerProvider(loggerProvider)

  // Initialize event logger
  const eventLogger = logs.getLogger(
    'com.anthropic.claude_code.events',
    MACRO.VERSION,
  )
  setEventLogger(eventLogger)

  // Setup flush handlers - flush both logs AND traces
  process.on('beforeExit', async () => {
    await loggerProvider?.forceFlush()
    await tracerProvider?.forceFlush()
  })

  process.on('exit', () => {
    void loggerProvider?.forceFlush()
    void tracerProvider?.forceFlush()
  })
}

export async function initializeTelemetry() {
  profileCheckpoint('telemetry_init_start')
  bootstrapTelemetry()

  // Console exporters call console.dir on a timer (5s logs/traces, 60s
  // metrics), writing pretty-printed objects to stdout. In stream-json
  // mode stdout is the SDK message channel; the first line (`{`) breaks
  // the SDK's line reader. Stripped here (not main.tsx) because init.ts
  // re-runs applyConfigEnvironmentVariables() inside initializeTelemetry-
  // AfterTrust for remote-managed-settings users, and bootstrapTelemetry
  // above copies ANT_OTEL_* for ant users — both would undo an earlier strip.
  if (getHasFormattedOutput()) {
    for (const key of [
      'OTEL_METRICS_EXPORTER',
      'OTEL_LOGS_EXPORTER',
      'OTEL_TRACES_EXPORTER',
    ] as const) {
      const v = process.env[key]
      if (v?.includes('console')) {
        process.env[key] = v
          .split(',')
          .map(s => s.trim())
          .filter(s => s !== 'console')
          .join(',')
      }
    }
  }

  diag.setLogger(new ClaudeCodeDiagLogger(), DiagLogLevel.ERROR)

  // Initialize Perfetto tracing (independent of OTEL)
  // Enable via CLAUDE_CODE_PERFETTO_TRACE=1 or CLAUDE_CODE_PERFETTO_TRACE=<path>
  initializePerfettoTracing()

  const readers = []

  // Add customer exporters (if enabled)
  const telemetryEnabled = isTelemetryEnabled()
  logForDebugging(
    `[3P telemetry] isTelemetryEnabled=${telemetryEnabled} (CLAUDE_CODE_ENABLE_TELEMETRY=${process.env.CLAUDE_CODE_ENABLE_TELEMETRY})`,
  )
  if (telemetryEnabled) {
    readers.push(...(await getOtlpReaders()))
  }

  // Add BigQuery exporter (for API customers, C4E users, and internal users)
  if (isBigQueryMetricsEnabled()) {
    readers.push(getBigQueryExportingReader())
  }

  // Create base resource with service attributes
  const platform = getPlatform()
  const baseAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: 'claude-code',
    [ATTR_SERVICE_VERSION]: MACRO.VERSION,
  }

  // Add WSL-specific attributes if running on WSL
  if (platform === 'wsl') {
    const wslVersion = getWslVersion()
    if (wslVersion) {
      baseAttributes['wsl.version'] = wslVersion
    }
  }

  const baseResource = resourceFromAttributes(baseAttributes)

  // Use OpenTelemetry detectors
  const osResource = resourceFromAttributes(
    osDetector.detect().attributes || {},
  )

  // Extract only host.arch from hostDetector
  const hostDetected = hostDetector.detect()
  const hostArchAttributes = hostDetected.attributes?.[SEMRESATTRS_HOST_ARCH]
    ? {
        [SEMRESATTRS_HOST_ARCH]: hostDetected.attributes[SEMRESATTRS_HOST_ARCH],
      }
    : {}
  const hostArchResource = resourceFromAttributes(hostArchAttributes)

  // Official 2.1.323 (#2123, `Lt` @311251300): parse OTEL_RESOURCE_ATTRIBUTES
  // entry-by-entry so one malformed entry does not drop the valid ones.
  // When any entry was dropped, withhold overrides of Claude-managed keys
  // (`DEFAULT_MANAGED_RESOURCE_ATTRIBUTE_KEYS`), while still honoring
  // explicit `OTEL_SERVICE_NAME`.
  const parsedEnvAttrs = getOtelResourceAttributeStatus()
  const filteredEnvAttrs: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsedEnvAttrs.attributes)) {
    if (
      parsedEnvAttrs.isEveryEntryRead ||
      !DEFAULT_MANAGED_RESOURCE_ATTRIBUTE_KEYS.has(k)
    ) {
      filteredEnvAttrs[k] = v
    }
  }
  const envServiceName = process.env.OTEL_SERVICE_NAME?.trim()
  if (envServiceName) {
    filteredEnvAttrs[ATTR_SERVICE_NAME] = envServiceName
  }
  const envResource = resourceFromAttributes(filteredEnvAttrs)

  // Merge resources - later resources take precedence
  const resource = baseResource
    .merge(osResource)
    .merge(hostArchResource)
    .merge(envResource)

  // Check if beta tracing is enabled - this is a separate code path
  // Available to all users who set ENABLE_BETA_TRACING_DETAILED=1 and BETA_TRACING_ENDPOINT
  if (isBetaTracingEnabled()) {
    void initializeBetaTracing(resource).catch(e =>
      logForDebugging(`Beta tracing init failed: ${e}`, { level: 'error' }),
    )
    // Still set up meter provider for metrics (but skip regular logs/traces setup)
    const meterProvider = new MeterProvider({
      resource,
      views: [],
      readers,
    })
    setMeterProvider(meterProvider)

    // Register shutdown for beta tracing
    const shutdownTelemetry = async () => {
      const timeoutMs = parseInt(
        process.env.CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS || '2000',
        10,
      )
      try {
        endInteractionSpan()

        // Force flush + shutdown together inside the timeout. Previously forceFlush
        // was awaited unbounded BEFORE the race, blocking exit on slow OTLP endpoints.
        // Each provider's flush→shutdown is chained independently so a slow logger
        // flush doesn't delay meterProvider/tracerProvider shutdown (no waterfall).
        const loggerProvider = getLoggerProvider()
        const tracerProvider = getTracerProvider()

        const chains: Promise<void>[] = [meterProvider.shutdown()]
        if (loggerProvider) {
          chains.push(
            loggerProvider.forceFlush().then(() => loggerProvider.shutdown()),
          )
        }
        if (tracerProvider) {
          chains.push(
            tracerProvider.forceFlush().then(() => tracerProvider.shutdown()),
          )
        }

        await Promise.race([
          Promise.all(chains),
          telemetryTimeout(timeoutMs, 'OpenTelemetry shutdown timeout'),
        ])
      } catch {
        // Ignore shutdown errors
      }
    }
    registerCleanup(shutdownTelemetry)

    return meterProvider.getMeter('com.anthropic.claude_code', MACRO.VERSION)
  }

  const meterProvider = new MeterProvider({
    resource,
    views: [],
    readers,
  })

  // Store reference in state for flushing
  setMeterProvider(meterProvider)

  // Initialize logs if telemetry is enabled
  if (telemetryEnabled) {
    const logExporters = await getOtlpLogExporters()
    logForDebugging(
      `[3P telemetry] Created ${logExporters.length} log exporter(s)`,
    )

    if (logExporters.length > 0) {
      const loggerProvider = new LoggerProvider({
        resource,
        // Add batch processors for each exporter
        processors: logExporters.map(
          exporter =>
            new BatchLogRecordProcessor(exporter, {
              scheduledDelayMillis: parseInt(
                process.env.OTEL_LOGS_EXPORT_INTERVAL ||
                  DEFAULT_LOGS_EXPORT_INTERVAL_MS.toString(),
                10,
              ),
            }),
        ),
      })

      // Register the logger provider globally
      logs.setGlobalLoggerProvider(loggerProvider)
      setLoggerProvider(loggerProvider)

      // Initialize event logger
      const eventLogger = logs.getLogger(
        'com.anthropic.claude_code.events',
        MACRO.VERSION,
      )
      setEventLogger(eventLogger)
      logForDebugging('[3P telemetry] Event logger set successfully')

      // 'beforeExit' is emitted when Node.js empties its event loop and has no additional work to schedule.
      // Unlike 'exit', it allows us to perform async operations, so it works well for letting
      // network requests complete before the process exits naturally.
      process.on('beforeExit', async () => {
        await loggerProvider?.forceFlush()
        // Also flush traces - they use BatchSpanProcessor which needs explicit flush
        const tracerProvider = getTracerProvider()
        await tracerProvider?.forceFlush()
      })

      process.on('exit', () => {
        // Final attempt to flush logs and traces
        void loggerProvider?.forceFlush()
        void getTracerProvider()?.forceFlush()
      })
    }
  }

  // Initialize tracing if enhanced telemetry is enabled (BETA)
  if (telemetryEnabled && isEnhancedTelemetryEnabled()) {
    const traceExporters = await getOtlpTraceExporters()
    if (traceExporters.length > 0) {
      // Create span processors for each exporter
      const spanProcessors = traceExporters.map(
        exporter =>
          new BatchSpanProcessor(exporter, {
            scheduledDelayMillis: parseInt(
              process.env.OTEL_TRACES_EXPORT_INTERVAL ||
                DEFAULT_TRACES_EXPORT_INTERVAL_MS.toString(),
              10,
            ),
          }),
      )

      const tracerProvider = new BasicTracerProvider({
        resource,
        spanProcessors,
      })

      // Register the tracer provider globally
      trace.setGlobalTracerProvider(tracerProvider)
      setTracerProvider(tracerProvider)
    }
  }

  // Shutdown metrics and logs on exit (flushes and closes exporters)
  const shutdownTelemetry = async () => {
    const timeoutMs = parseInt(
      process.env.CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS || '2000',
      10,
    )

    try {
      // End any active interaction span before shutdown
      endInteractionSpan()

      const shutdownPromises = [meterProvider.shutdown()]
      const loggerProvider = getLoggerProvider()
      if (loggerProvider) {
        shutdownPromises.push(loggerProvider.shutdown())
      }
      const tracerProvider = getTracerProvider()
      if (tracerProvider) {
        shutdownPromises.push(tracerProvider.shutdown())
      }

      await Promise.race([
        Promise.all(shutdownPromises),
        telemetryTimeout(timeoutMs, 'OpenTelemetry shutdown timeout'),
      ])
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        logForDebugging(
          `
OpenTelemetry telemetry flush timed out after ${timeoutMs}ms

To resolve this issue, you can:
1. Increase the timeout by setting CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS env var (e.g., 5000 for 5 seconds)
2. Check if your OpenTelemetry backend is experiencing scalability issues
3. Disable OpenTelemetry by unsetting CLAUDE_CODE_ENABLE_TELEMETRY env var

Current timeout: ${timeoutMs}ms
`,
          { level: 'error' },
        )
      }
      throw error
    }
  }

  // Always register shutdown (internal metrics are always enabled)
  registerCleanup(shutdownTelemetry)

  return meterProvider.getMeter('com.anthropic.claude_code', MACRO.VERSION)
}

/**
 * Flush all pending telemetry data immediately.
 * This should be called before logout or org switching to prevent data leakage.
 */
export async function flushTelemetry(): Promise<void> {
  const meterProvider = getMeterProvider()
  if (!meterProvider) {
    return
  }

  const timeoutMs = parseInt(
    process.env.CLAUDE_CODE_OTEL_FLUSH_TIMEOUT_MS || '5000',
    10,
  )

  try {
    const flushPromises = [meterProvider.forceFlush()]
    const loggerProvider = getLoggerProvider()
    if (loggerProvider) {
      flushPromises.push(loggerProvider.forceFlush())
    }
    const tracerProvider = getTracerProvider()
    if (tracerProvider) {
      flushPromises.push(tracerProvider.forceFlush())
    }

    await Promise.race([
      Promise.all(flushPromises),
      telemetryTimeout(timeoutMs, 'OpenTelemetry flush timeout'),
    ])

    logForDebugging('Telemetry flushed successfully')
  } catch (error) {
    if (error instanceof TelemetryTimeoutError) {
      logForDebugging(
        `Telemetry flush timed out after ${timeoutMs}ms. Some metrics may not be exported.`,
        { level: 'warn' },
      )
    } else {
      logForDebugging(`Telemetry flush failed: ${errorMessage(error)}`, {
        level: 'error',
      })
    }
    // Don't throw - allow logout to continue even if flush fails
  }
}

function parseOtelHeadersEnvVar(): Record<string, string> {
  const headers: Record<string, string> = {}
  const envHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS
  if (envHeaders) {
    for (const pair of envHeaders.split(',')) {
      const [key, ...valueParts] = pair.split('=')
      if (key && valueParts.length > 0) {
        headers[key.trim()] = valueParts.join('=').trim()
      }
    }
  }
  return headers
}

/**
 * densable Ne / JAo — OTLP exporter config:
 * - headers (static env / otelHeadersHelper H3n)
 * - $Nr prefetch when helper + http/json|http/protobuf
 * - httpAgentOptions always = Mvd(endpoint) so YAo sets Content-Length (#31)
 */
export function withSuppressedOtelHeadersEnv<T>(
  signal: 'METRICS' | 'LOGS' | 'TRACES',
  onlyConfigHeaders: boolean | undefined,
  fn: () => T,
): T {
  if (!onlyConfigHeaders) return fn()
  const names = [
    'OTEL_EXPORTER_OTLP_HEADERS',
    `OTEL_EXPORTER_OTLP_${signal}_HEADERS`,
  ]
  const saved: Array<{ name: string; value: string }> = []
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined) {
      saved.push({ name, value })
      delete process.env[name]
    }
  }
  try {
    return fn()
  } finally {
    for (const { name, value } of saved) {
      process.env[name] = value
    }
  }
}

export function getOTLPExporterConfig(
  protocol?: string,
  signal?: 'metrics' | 'logs' | 'traces',
) {
  const gatewayAuth = getGatewayAuth()
  if (isGatewayAuthPinned(gatewayAuth) && gatewayAuth) {
    const baseUrl = gatewayAuth.url
    return {
      ...(signal ? { url: `${baseUrl}/v1/${signal}` } : {}),
      onlyConfigHeaders: true,
      headers: async (): Promise<Record<string, string>> => {
        // Official 2.1.319 (#1761): refresh/re-verify gateway token expiry
        // BEFORE sending telemetry so expired terminals do not fire requests
        // the gateway refuses and logs as `invalid_token`.
        let current = getGatewayAuth()
        if (!current || current.url !== baseUrl) return {}
        if (isGatewayAuthExpired(current)) {
          try {
            const { refreshGatewayTokenIfNeeded } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('../gatewayEnv.js') as {
                refreshGatewayTokenIfNeeded?: () => Promise<unknown>
              }
            await refreshGatewayTokenIfNeeded?.()
            current = getGatewayAuth()
          } catch {
            // refresh failed — re-check below and abort send
          }
        }
        if (
          !current ||
          current.url !== baseUrl ||
          isGatewayAuthExpired(current)
        ) {
          throw new Error(formatGatewaySessionExpiredError())
        }
        return { Authorization: `Bearer ${current.jwt}` }
      },
      httpAgentOptions: createOtlpHttpAgentFactory(baseUrl),
    }
  }

  const settings = getSettings_DEPRECATED()

  // Build base config
  const config: Record<string, unknown> & { onlyConfigHeaders?: boolean } = {}

  // Parse static headers from env var once (doesn't change at runtime)
  const staticHeaders = parseOtelHeadersEnvVar()

  // If otelHeadersHelper is configured, use async headers function for dynamic refresh
  // Otherwise just return static headers if any exist
  if (settings?.otelHeadersHelper) {
    config.headers = async (): Promise<Record<string, string>> => {
      const dynamicHeaders = await getOtelHeadersFromHelperAsync()
      return { ...staticHeaders, ...dynamicHeaders }
    }
    if (protocol === 'http/json' || protocol === 'http/protobuf') {
      prefetchOtelHeadersFromHelper()
    }
  } else if (Object.keys(staticHeaders).length > 0) {
    config.headers = async (): Promise<Record<string, string>> => staticHeaders
  }

  // densable always wires Mvd → YAo-wrapped agents (proxy or direct), not only
  // when a proxy is set — required so Azure Monitor etc. get Content-Length.
  // Official 2.1.323 (#2122): resolve signal-specific endpoint too; unset
  // endpoint defaults to localhost:4318 inside createOtlpHttpAgentFactory so
  // configured proxies are bypassed for local collectors.
  const otelEndpoint =
    (signal
      ? process.env[
          `OTEL_EXPORTER_OTLP_${OTLP_SIGNAL_ENV_SUFFIX[signal]}_ENDPOINT`
        ]
      : undefined) || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  config.httpAgentOptions = createOtlpHttpAgentFactory(otelEndpoint)
  return config
}
