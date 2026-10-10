import { afterEach, describe, expect, test } from 'bun:test'

/**
 * Official privacy switches gate Anthropic telemetry senders.
 * Pipeline bodies stay; DISABLE_TELEMETRY / DO_NOT_TRACK / essential-traffic
 * turn them off. User OTEL (CLAUDE_CODE_ENABLE_TELEMETRY) is untouched.
 */

const PRIVACY_ENV = [
  'DISABLE_TELEMETRY',
  'DO_NOT_TRACK',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DISABLE_GROWTHBOOK',
  'CLAUDE_GB_ADAPTER_URL',
] as const

const saved: Record<string, string | undefined> = {}
for (const key of PRIVACY_ENV) saved[key] = process.env[key]

function clearPrivacyEnv(): void {
  for (const key of PRIVACY_ENV) delete process.env[key]
}

afterEach(() => {
  for (const key of PRIVACY_ENV) {
    const prior = saved[key]
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
  }
})

describe('telemetry official switches', () => {
  test('unset DISABLE_TELEMETRY is off by default (fork)', async () => {
    clearPrivacyEnv()
    const { isTelemetryDisabled, getPrivacyLevel } = await import(
      '../../src/utils/privacyLevel.ts'
    )
    expect(getPrivacyLevel()).toBe('no-telemetry')
    expect(isTelemetryDisabled()).toBe(true)
    const { is1PEventLoggingEnabled } = await import(
      '../../src/services/analytics/firstPartyEventLogger.ts'
    )
    expect(is1PEventLoggingEnabled()).toBe(false)
  })

  test('DISABLE_TELEMETRY=0 opts telemetry send back on', async () => {
    clearPrivacyEnv()
    process.env.DISABLE_TELEMETRY = '0'
    const { isTelemetryDisabled, getPrivacyLevel } = await import(
      '../../src/utils/privacyLevel.ts'
    )
    expect(getPrivacyLevel()).toBe('default')
    expect(isTelemetryDisabled()).toBe(false)
  })

  test('DISABLE_TELEMETRY turns off 1P event logging', async () => {
    clearPrivacyEnv()
    process.env.DISABLE_TELEMETRY = '1'
    const { is1PEventLoggingEnabled, initialize1PEventLogging } = await import(
      '../../src/services/analytics/firstPartyEventLogger.ts'
    )
    expect(is1PEventLoggingEnabled()).toBe(false)
    initialize1PEventLogging()
    expect(is1PEventLoggingEnabled()).toBe(false)
  }, 20_000)

  test('DISABLE_TELEMETRY turns Datadog initialize off', async () => {
    clearPrivacyEnv()
    process.env.DISABLE_TELEMETRY = '1'
    const { initializeDatadog, trackDatadogEvent } = await import(
      '../../src/services/analytics/datadog.ts'
    )
    expect(await initializeDatadog()).toBe(false)
    await trackDatadogEvent('tengu_started', {})
  })

  test('GrowthBook is off under DISABLE_TELEMETRY', async () => {
    clearPrivacyEnv()
    process.env.DISABLE_TELEMETRY = '1'
    const { isGrowthBookEnabled, getFeatureValue_CACHED_MAY_BE_STALE } =
      await import('../../src/services/analytics/growthbook.ts')
    expect(isGrowthBookEnabled()).toBe(false)
    expect(
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_lodestone_enabled', false),
    ).toBe(true)
  })

  test('Sentry never initializes without SENTRY_DSN', async () => {
    const { initSentry, isSentryInitialized } = await import(
      '../../src/utils/sentry.ts'
    )
    initSentry()
    expect(isSentryInitialized()).toBe(false)
  })

  test('essential-traffic privacy level skips nonessential traffic', async () => {
    clearPrivacyEnv()
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    const { isEssentialTrafficOnly, isTelemetryDisabled } = await import(
      '../../src/utils/privacyLevel.ts'
    )
    expect(isEssentialTrafficOnly()).toBe(true)
    expect(isTelemetryDisabled()).toBe(true)
  })

  test('Perfetto initialize is a no-op without CLAUDE_CODE_PERFETTO_TRACE', async () => {
    const { initializePerfettoTracing, isPerfettoTracingEnabled } =
      await import('../../src/utils/telemetry/perfettoTracing.ts')
    initializePerfettoTracing()
    expect(isPerfettoTracingEnabled()).toBe(false)
  })
})
