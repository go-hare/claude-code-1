/**
 * densable 2.1.217 #9 — managed OTEL supremacy (`dTd` / `tdr`).
 *
 * When policySettings claims OTEL_EXPORTER_OTLP_ENDPOINT (or otelHeadersHelper),
 * lower-trust signal-specific endpoints must be deleted so the OTEL SDK cannot
 * prefer them over the managed endpoint.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const mockGetSettingsForSource = mock(
  (_source: string) => null as Record<string, unknown> | null,
)

mock.module('../settings/settings.js', () => ({
  getSettingsForSource: (s: string) => mockGetSettingsForSource(s),
  getSettings_DEPRECATED: () => ({}),
  getInitialSettings: () => ({}),
}))

const { applyManagedOtelEndpointSupremacy, clearManagedOtelDropWarnsForTests } =
  await import('../managedEnv.js')

const OTEL_KEYS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_PROFILES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
  'OTEL_EXPORTER_OTLP_HEADERS',
] as const

const saved: Partial<Record<(typeof OTEL_KEYS)[number], string | undefined>> =
  {}

function snapshotOtelEnv(): void {
  for (const k of OTEL_KEYS) {
    saved[k] = process.env[k]
  }
}

function restoreOtelEnv(): void {
  for (const k of OTEL_KEYS) {
    const v = saved[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

beforeEach(() => {
  snapshotOtelEnv()
  clearManagedOtelDropWarnsForTests()
  mockGetSettingsForSource.mockReset()
  mockGetSettingsForSource.mockReturnValue(null)
  for (const k of OTEL_KEYS) delete process.env[k]
})

afterEach(() => {
  restoreOtelEnv()
  clearManagedOtelDropWarnsForTests()
  mockGetSettingsForSource.mockReset()
})

describe('managed OTEL supremacy densable 2.1.217 #9', () => {
  test('dTd no-ops when policy has no env and no otelHeadersHelper', () => {
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'http://evil/traces'
    mockGetSettingsForSource.mockReturnValue({})
    applyManagedOtelEndpointSupremacy()
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe(
      'http://evil/traces',
    )
  })

  test('policy ENDPOINT drops lower-trust signal endpoints (tdr)', () => {
    const managed = 'https://managed.example/v1'
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = managed
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'http://evil/traces'
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'http://evil/metrics'
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://evil/logs'
    process.env.OTEL_EXPORTER_OTLP_PROFILES_ENDPOINT = 'http://evil/profiles'

    mockGetSettingsForSource.mockImplementation(source => {
      if (source === 'policySettings') {
        return { env: { OTEL_EXPORTER_OTLP_ENDPOINT: managed } }
      }
      return null
    })

    applyManagedOtelEndpointSupremacy()

    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(managed)
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined()
    expect(process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT).toBeUndefined()
    expect(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBeUndefined()
    expect(process.env.OTEL_EXPORTER_OTLP_PROFILES_ENDPOINT).toBeUndefined()
  })

  test('policy-claimed signal endpoint is kept (same value in map)', () => {
    const managed = 'https://managed.example/v1'
    const traces = 'https://managed.example/traces'
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = managed
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = traces

    mockGetSettingsForSource.mockImplementation(source => {
      if (source === 'policySettings') {
        return {
          env: {
            OTEL_EXPORTER_OTLP_ENDPOINT: managed,
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: traces,
          },
        }
      }
      return null
    })

    applyManagedOtelEndpointSupremacy()

    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(managed)
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe(traces)
  })

  test('otelHeadersHelper drops all signal endpoints and base ENDPOINT', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://user/endpoint'
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'http://user/traces'
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'http://user/metrics'

    mockGetSettingsForSource.mockImplementation(source => {
      if (source === 'policySettings') {
        return { otelHeadersHelper: '/usr/local/bin/otel-headers.sh' }
      }
      return null
    })

    applyManagedOtelEndpointSupremacy()

    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined()
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined()
    expect(process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT).toBeUndefined()
  })

  test('policy HEADERS claim also drops base ENDPOINT + signal ENDPOINT/HEADERS', () => {
    const headers = 'Authorization=Bearer managed'
    process.env.OTEL_EXPORTER_OTLP_HEADERS = headers
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://user/endpoint'
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'http://user/traces'
    process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = 'x=1'

    mockGetSettingsForSource.mockImplementation(source => {
      if (source === 'policySettings') {
        return { env: { OTEL_EXPORTER_OTLP_HEADERS: headers } }
      }
      return null
    })

    applyManagedOtelEndpointSupremacy()

    expect(process.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(headers)
    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined()
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined()
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS).toBeUndefined()
  })

  test('empty policy env value does not trigger drops', () => {
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'http://evil/traces'
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = ''

    mockGetSettingsForSource.mockImplementation(source => {
      if (source === 'policySettings') {
        return { env: { OTEL_EXPORTER_OTLP_ENDPOINT: '   ' } }
      }
      return null
    })

    applyManagedOtelEndpointSupremacy()
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe(
      'http://evil/traces',
    )
  })
})
