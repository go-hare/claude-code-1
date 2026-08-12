import { describe, expect, test } from 'bun:test'

/**
 * densable product-surface alignment: UDS/LAN/TEAMMEM/KAIROS periphery must
 * stay in DEFAULT_BUILD_FEATURES once enabled (2026-08-12).
 */

describe('DEFAULT_BUILD_FEATURES densable product surface ON', () => {
  test('includes UDS_INBOX, LAN_PIPES, TEAMMEM, KAIROS periphery', async () => {
    const { DEFAULT_BUILD_FEATURES } = await import('../defines.ts')
    for (const flag of [
      'UDS_INBOX',
      'LAN_PIPES',
      'TEAMMEM',
      'KAIROS',
      'KAIROS_CHANNELS',
      'KAIROS_PUSH_NOTIFICATION',
      'KAIROS_GITHUB_WEBHOOKS',
    ] as const) {
      expect(DEFAULT_BUILD_FEATURES).toContain(flag)
    }
  })

  test('growthbook local defaults enable tengu_herring_clock for TEAMMEM runtime', async () => {
    const text = await Bun.file('src/services/analytics/growthbook.ts').text()
    expect(text).toContain('tengu_herring_clock: true')
  })
})
