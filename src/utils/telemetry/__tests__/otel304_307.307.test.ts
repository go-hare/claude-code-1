import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { withSuppressedOtelHeadersEnv } from '../instrumentation.js'

const ROOT = join(import.meta.dir, '..', '..', '..', '..')

describe('v2.1.304–2.1.307 Telemetry & Init alignment', () => {
  const prevHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS
  const prevLogsHeaders = process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS

  afterEach(() => {
    if (prevHeaders === undefined) delete process.env.OTEL_EXPORTER_OTLP_HEADERS
    else process.env.OTEL_EXPORTER_OTLP_HEADERS = prevHeaders
    if (prevLogsHeaders === undefined)
      delete process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS
    else process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = prevLogsHeaders
  })

  test('#980: doInitializeTelemetry does not latch telemetryInitialized when telemetry is disabled', () => {
    const initSrc = readFileSync(join(ROOT, 'src/entrypoints/init.ts'), 'utf8')
    const fnStart = initSrc.indexOf('async function doInitializeTelemetry()')
    const fnEnd = initSrc.indexOf('async function setMeterState()')
    const body = initSrc.slice(fnStart, fnEnd)
    const disabledStart = body.indexOf('if (!telemetryEnabled)')
    const returnIdx = body.indexOf('return', disabledStart)
    const disabledBranch = body.slice(disabledStart, returnIdx)
    const disabledCode = disabledBranch.replace(/\/\/.*$/gm, '')
    expect(disabledCode).not.toContain('telemetryInitialized = true')
  })

  test('#1086: withSuppressedOtelHeadersEnv temporarily removes OTEL_EXPORTER_OTLP*_HEADERS and restores them', () => {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-custom=secret'
    process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = 'x-logs=1'

    const seen = withSuppressedOtelHeadersEnv('LOGS', true, () => ({
      common: process.env.OTEL_EXPORTER_OTLP_HEADERS,
      logs: process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS,
    }))
    expect(seen.common).toBeUndefined()
    expect(seen.logs).toBeUndefined()
    expect(process.env.OTEL_EXPORTER_OTLP_HEADERS).toBe('x-custom=secret')
    expect(process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS).toBe('x-logs=1')
  })

  test('#1086: withSuppressedOtelHeadersEnv leaves env intact when onlyConfigHeaders is false', () => {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-custom=keep'
    const seen = withSuppressedOtelHeadersEnv(
      'METRICS',
      false,
      () => process.env.OTEL_EXPORTER_OTLP_HEADERS,
    )
    expect(seen).toBe('x-custom=keep')
  })
})
