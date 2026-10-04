import { describe, expect, test } from 'bun:test'

/**
 * Fork product-cut: Anthropic telemetry sinks do not send.
 * logEvent call sites remain. User OTEL (CLAUDE_CODE_ENABLE_TELEMETRY) is untouched.
 */

describe('telemetry product cut', () => {
  test('1P event logging never enables', async () => {
    const { is1PEventLoggingEnabled, initialize1PEventLogging } = await import(
      '../../src/services/analytics/firstPartyEventLogger.ts'
    )
    expect(is1PEventLoggingEnabled()).toBe(false)
    initialize1PEventLogging()
    expect(is1PEventLoggingEnabled()).toBe(false)
  })

  test('Datadog initialize is a closed door', async () => {
    const { initializeDatadog, trackDatadogEvent } = await import(
      '../../src/services/analytics/datadog.ts'
    )
    expect(await initializeDatadog()).toBe(false)
    await trackDatadogEvent('tengu_started', {})
  })

  test('GrowthBook is off without a self-hosted adapter', async () => {
    const prev = process.env.CLAUDE_GB_ADAPTER_URL
    delete process.env.CLAUDE_GB_ADAPTER_URL
    try {
      const { isGrowthBookEnabled, getFeatureValue_CACHED_MAY_BE_STALE } =
        await import('../../src/services/analytics/growthbook.ts')
      expect(isGrowthBookEnabled()).toBe(false)
      expect(
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_lodestone_enabled', false),
      ).toBe(true)
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_GB_ADAPTER_URL
      } else {
        process.env.CLAUDE_GB_ADAPTER_URL = prev
      }
    }
  })

  test('Sentry never initializes', async () => {
    const { initSentry, isSentryInitialized } = await import(
      '../../src/utils/sentry.ts'
    )
    initSentry()
    expect(isSentryInitialized()).toBe(false)
  })

  test('metrics opt-out never hits the network', async () => {
    const { checkMetricsEnabled } = await import(
      '../../src/services/api/metricsOptOut.ts'
    )
    expect(await checkMetricsEnabled()).toEqual({
      enabled: false,
      hasError: false,
    })
  })

  test('Perfetto initialize is a no-op', async () => {
    const { initializePerfettoTracing, isPerfettoTracingEnabled } =
      await import('../../src/utils/telemetry/perfettoTracing.ts')
    initializePerfettoTracing()
    expect(isPerfettoTracingEnabled()).toBe(false)
  })
})
