import { describe, expect, test } from 'bun:test'

/**
 * densable product-surface alignment: UDS/LAN/TEAMMEM/KAIROS periphery must
 * stay in DEFAULT_BUILD_FEATURES once enabled (2026-08-12).
 * densable 2.1.229 SEA: REACTIVE_COMPACT product path (QGo/Ysa) default ON —
 * without it long-session PTL has no withhold/recovery (2026-08-13).
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

  test('includes REACTIVE_COMPACT for densable 413/PTL recovery (not collapse/snip)', async () => {
    const { DEFAULT_BUILD_FEATURES } = await import('../defines.ts')
    expect(DEFAULT_BUILD_FEATURES).toContain('REACTIVE_COMPACT')
    // Explicit product OFF — enabling collapse stub suppresses proactive autocompact
    expect(DEFAULT_BUILD_FEATURES).not.toContain('CONTEXT_COLLAPSE')
    expect(DEFAULT_BUILD_FEATURES).not.toContain('HISTORY_SNIP')
  })

  test('TREE_SITTER_BASH not default ON after densable 2.1.233 bash-permission revert', async () => {
    const { DEFAULT_BUILD_FEATURES } = await import('../defines.ts')
    // 232 temporarily ON for #43; 233 official reverted input-redirect product gate.
    expect(DEFAULT_BUILD_FEATURES).not.toContain('TREE_SITTER_BASH')
  })

  test('growthbook local defaults enable tengu_herring_clock for TEAMMEM runtime', async () => {
    const text = await Bun.file('src/services/analytics/growthbook.ts').text()
    expect(text).toContain('tengu_herring_clock: true')
  })
})
