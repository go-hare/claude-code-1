import { afterAll, describe, expect, mock, test } from 'bun:test'
import * as realConfig from '../config.js'
import * as realSettings from '../settings/settings.js'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'

// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
const configSnap = snapshotModuleExports(realConfig)
const settingsSnap = snapshotModuleExports(realSettings)

mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => false,
  getDynamicConfig_CACHED_MAY_BE_STALE: () => ({}),
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE: () => false,
  initializeGrowthBook: async () => null,
  resetGrowthBook: () => {},
}))

// Re-register snapshots (no overrides) so co-suites keep full surfaces, and
// afterAll can restore without re-exporting a live-bound mock namespace.
mock.module('../config.js', () => ({ ...configSnap }))
mock.module('src/utils/config.js', () => ({ ...configSnap }))
mock.module('../settings/settings.js', () => ({ ...settingsSnap }))
mock.module('src/utils/settings/settings.js', () => ({ ...settingsSnap }))
afterAll(() => {
  mock.module('../config.js', () => ({ ...configSnap }))
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  restoreSettingsMockWith(mock.module, settingsSnap, [
    '../settings/settings.js',
    'src/utils/settings/settings.js',
  ])
})

import {
  FULLSCREEN_UPSELL_MAX_SEEN,
  incrementFullscreenUpsellSeen,
  markFullscreenUpsellFullySeen,
  shouldShowFullscreenUpsell,
} from '../fullscreenUpsellGate.js'

describe('shouldShowFullscreenUpsell Npf densable', () => {
  test('FORCE_FULLSCREEN_UPSELL wins over other gates', () => {
    expect(
      shouldShowFullscreenUpsell({
        env: { CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL: '1' },
        isNonInteractiveOrDemo: false,
        isFullscreenAlready: true,
        hasExplicitTuiSetting: true,
        seenCount: 99,
      }),
    ).toBe(true)
  })

  test('non-interactive / demo skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        isNonInteractiveOrDemo: true,
        seenCount: 0,
        isFullscreenAlready: false,
        hasExplicitTuiSetting: false,
      }),
    ).toBe(false)
  })

  test('already fullscreen skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        isNonInteractiveOrDemo: false,
        isFullscreenAlready: true,
        hasExplicitTuiSetting: false,
        seenCount: 0,
      }),
    ).toBe(false)
  })

  test('hard-disabled skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        isNonInteractiveOrDemo: false,
        isFullscreenAlready: false,
        isHardDisabled: true,
        hasExplicitTuiSetting: false,
        seenCount: 0,
      }),
    ).toBe(false)
  })

  test('explicit tui setting skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        isNonInteractiveOrDemo: false,
        isFullscreenAlready: false,
        hasExplicitTuiSetting: true,
        seenCount: 0,
      }),
    ).toBe(false)
  })

  test('seen count at max skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        isNonInteractiveOrDemo: false,
        isFullscreenAlready: false,
        isHardDisabled: false,
        hasExplicitTuiSetting: false,
        seenCount: FULLSCREEN_UPSELL_MAX_SEEN,
      }),
    ).toBe(false)
  })

  test('eligible when under max (no GB required)', () => {
    expect(
      shouldShowFullscreenUpsell({
        isNonInteractiveOrDemo: false,
        isFullscreenAlready: false,
        isHardDisabled: false,
        hasExplicitTuiSetting: false,
        seenCount: 0,
      }),
    ).toBe(true)
  })

  test('markFullscreenUpsellFullySeen caps at max', () => {
    expect(markFullscreenUpsellFullySeen({})).toEqual({
      fullscreenUpsellSeenCount: FULLSCREEN_UPSELL_MAX_SEEN,
    })
    expect(
      markFullscreenUpsellFullySeen({
        fullscreenUpsellSeenCount: FULLSCREEN_UPSELL_MAX_SEEN,
      }),
    ).toEqual({ fullscreenUpsellSeenCount: FULLSCREEN_UPSELL_MAX_SEEN })
  })

  test('incrementFullscreenUpsellSeen steps by one until max', () => {
    expect(incrementFullscreenUpsellSeen({})).toEqual({
      fullscreenUpsellSeenCount: 1,
    })
    expect(
      incrementFullscreenUpsellSeen({ fullscreenUpsellSeenCount: 1 }),
    ).toEqual({ fullscreenUpsellSeenCount: 2 })
    expect(
      incrementFullscreenUpsellSeen({
        fullscreenUpsellSeenCount: FULLSCREEN_UPSELL_MAX_SEEN,
      }),
    ).toEqual({ fullscreenUpsellSeenCount: FULLSCREEN_UPSELL_MAX_SEEN })
  })
})
