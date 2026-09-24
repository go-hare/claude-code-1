/**
 * densable 2.1.251 #8 — dropDominatedBetaTracingEndpoint + N.
 *
 * Gold dropDominatedBetaTracingEndpoint deletes BETA_TRACING_ENDPOINT via
 * dropDominatedOtelKey when a higher-trust claim is pinned. Function N
 * (filterSettingsEnv → stripProjectScopedTracingEnv) drops vyr keys from
 * projectSettings / localSettings only.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  applyOtelFamilyClaims,
  clearManagedOtelDropWarnsForTests,
  dropDominatedBetaTracingEndpoint,
  getFilteredSettingsEnv,
} from '../managedEnv.js'
import { clearProjectScopedTracingWarnsForTests } from '../projectScopedTracingStrip.js'

const BETA = 'BETA_TRACING_ENDPOINT'
const TELEMETRY = 'CLAUDE_CODE_ENABLE_TELEMETRY'
const LOGS_EXPORTER = 'OTEL_LOGS_EXPORTER'
const TRACES_EXPORTER = 'OTEL_TRACES_EXPORTER'
const VYR_TRACE_KEYS = [
  'ENABLE_BETA_TRACING_DETAILED',
  'BETA_TRACING_ENDPOINT',
  'OTEL_LOG_RAW_API_BODIES',
] as const

const CLAIM_KEYS = [BETA, TELEMETRY, LOGS_EXPORTER, TRACES_EXPORTER] as const

const saved: Partial<Record<(typeof CLAIM_KEYS)[number], string | undefined>> =
  {}

beforeEach(() => {
  for (const key of CLAIM_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  clearManagedOtelDropWarnsForTests()
  clearProjectScopedTracingWarnsForTests()
})

afterEach(() => {
  for (const key of CLAIM_KEYS) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  clearManagedOtelDropWarnsForTests()
  clearProjectScopedTracingWarnsForTests()
})

describe('densable 2.1.251 #8 dropDominatedBetaTracingEndpoint', () => {
  test('drops BETA_TRACING_ENDPOINT when policy map does not claim it', () => {
    process.env[BETA] = 'http://evil/beta'
    dropDominatedBetaTracingEndpoint(
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      new Map([['OTEL_EXPORTER_OTLP_ENDPOINT', 'https://managed.example/v1']]),
    )
    expect(process.env[BETA]).toBeUndefined()
  })

  test('keeps BETA_TRACING_ENDPOINT when policy map claims the same value', () => {
    process.env[BETA] = 'https://managed.example/beta'
    dropDominatedBetaTracingEndpoint(
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      new Map([[BETA, 'https://managed.example/beta']]),
    )
    expect(process.env[BETA]).toBe('https://managed.example/beta')
  })

  test('no-ops when BETA_TRACING_ENDPOINT is unset', () => {
    dropDominatedBetaTracingEndpoint(
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      new Map([['OTEL_EXPORTER_OTLP_ENDPOINT', 'https://managed.example/v1']]),
    )
    expect(process.env[BETA]).toBeUndefined()
  })
})

describe('densable 2.1.251 #8 applyOtelFamilyClaims', () => {
  test('non-otlp OTEL_LOGS_EXPORTER drops BETA_TRACING_ENDPOINT', () => {
    process.env[BETA] = 'http://evil/beta'
    process.env[LOGS_EXPORTER] = 'console'
    applyOtelFamilyClaims(
      new Map([[LOGS_EXPORTER, 'console']]),
      new Map([[LOGS_EXPORTER, 'console']]),
    )
    expect(process.env[BETA]).toBeUndefined()
  })

  test('non-otlp OTEL_TRACES_EXPORTER drops BETA_TRACING_ENDPOINT', () => {
    process.env[BETA] = 'http://evil/beta'
    process.env[TRACES_EXPORTER] = 'console'
    applyOtelFamilyClaims(
      new Map([[TRACES_EXPORTER, 'console']]),
      new Map([[TRACES_EXPORTER, 'console']]),
    )
    expect(process.env[BETA]).toBeUndefined()
  })

  test('otlp in OTEL_LOGS_EXPORTER does not drop BETA_TRACING_ENDPOINT', () => {
    process.env[BETA] = 'http://keep/beta'
    process.env[LOGS_EXPORTER] = 'otlp'
    applyOtelFamilyClaims(
      new Map([[LOGS_EXPORTER, 'otlp']]),
      new Map([[LOGS_EXPORTER, 'otlp']]),
    )
    expect(process.env[BETA]).toBe('http://keep/beta')
  })

  test('otlp token in a comma list does not drop BETA_TRACING_ENDPOINT', () => {
    process.env[BETA] = 'http://keep/beta'
    process.env[LOGS_EXPORTER] = 'console,otlp'
    applyOtelFamilyClaims(
      new Map([[LOGS_EXPORTER, 'console,otlp']]),
      new Map([[LOGS_EXPORTER, 'console,otlp']]),
    )
    expect(process.env[BETA]).toBe('http://keep/beta')
  })

  test('falsy CLAUDE_CODE_ENABLE_TELEMETRY drops BETA_TRACING_ENDPOINT', () => {
    process.env[BETA] = 'http://evil/beta'
    process.env[TELEMETRY] = '0'
    applyOtelFamilyClaims(
      new Map([[TELEMETRY, '0']]),
      new Map([[TELEMETRY, '0']]),
    )
    expect(process.env[BETA]).toBeUndefined()
  })

  test('truthy CLAUDE_CODE_ENABLE_TELEMETRY does not drop BETA_TRACING_ENDPOINT', () => {
    process.env[BETA] = 'http://keep/beta'
    process.env[TELEMETRY] = '1'
    applyOtelFamilyClaims(
      new Map([[TELEMETRY, '1']]),
      new Map([[TELEMETRY, '1']]),
    )
    expect(process.env[BETA]).toBe('http://keep/beta')
  })

  test('base OTEL_EXPORTER_OTLP_ENDPOINT claim drops BETA_TRACING_ENDPOINT', () => {
    const end = 'OTEL_EXPORTER_OTLP_ENDPOINT'
    process.env[BETA] = 'http://evil/beta'
    process.env[end] = 'https://managed.example/v1'
    applyOtelFamilyClaims(
      new Map([[end, 'https://managed.example/v1']]),
      new Map([[end, 'https://managed.example/v1']]),
    )
    expect(process.env[BETA]).toBeUndefined()
  })

  test('TRACES ENDPOINT claim drops BETA_TRACING_ENDPOINT', () => {
    const end = 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'
    process.env[BETA] = 'http://evil/beta'
    process.env[end] = 'https://managed.example/traces'
    applyOtelFamilyClaims(
      new Map([[end, 'https://managed.example/traces']]),
      new Map([[end, 'https://managed.example/traces']]),
    )
    expect(process.env[BETA]).toBeUndefined()
  })

  test('METRICS ENDPOINT claim does not drop BETA_TRACING_ENDPOINT', () => {
    const end = 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT'
    process.env[BETA] = 'http://keep/beta'
    process.env[end] = 'https://managed.example/metrics'
    applyOtelFamilyClaims(
      new Map([[end, 'https://managed.example/metrics']]),
      new Map([[end, 'https://managed.example/metrics']]),
    )
    expect(process.env[BETA]).toBe('http://keep/beta')
  })
})

describe('densable 2.1.251 #8 N project-scoped vyr strip', () => {
  const env: Record<string, string> = {
    ENABLE_BETA_TRACING_DETAILED: '1',
    BETA_TRACING_ENDPOINT: 'http://project/beta',
    OTEL_LOG_RAW_API_BODIES: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }

  test('projectSettings and localSettings drop vyr tracing keys', () => {
    for (const source of ['projectSettings', 'localSettings'] as const) {
      const out = getFilteredSettingsEnv({ ...env }, source)
      for (const key of VYR_TRACE_KEYS) {
        expect(out[key]).toBeUndefined()
      }
      expect(out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
    }
  })

  test('userSettings / settings keep vyr tracing keys', () => {
    for (const source of ['userSettings', 'settings'] as const) {
      const out = getFilteredSettingsEnv({ ...env }, source)
      for (const key of VYR_TRACE_KEYS) {
        expect(out[key]).toBe(env[key])
      }
    }
  })
})
