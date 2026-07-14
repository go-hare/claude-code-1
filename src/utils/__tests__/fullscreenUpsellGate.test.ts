import { describe, expect, mock, test } from 'bun:test'

mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => false,
  getDynamicConfig_CACHED_MAY_BE_STALE: () => ({}),
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE: () => false,
  initializeGrowthBook: async () => null,
  resetGrowthBook: () => {},
}))

mock.module('../config.js', () => ({
  getGlobalConfig: () => ({}),
  saveGlobalConfig: () => {},
}))

mock.module('../settings/settings.js', () => ({
  getSettingsForSource: () => ({}),
}))

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
        gbOchreHollow: false,
        seenCount: 99,
      }),
    ).toBe(true)
  })

  test('non-interactive / demo skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        isNonInteractiveOrDemo: true,
        gbOchreHollow: true,
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
        gbOchreHollow: true,
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
        gbOchreHollow: true,
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
        gbOchreHollow: true,
        seenCount: 0,
      }),
    ).toBe(false)
  })

  test('GB off skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        isNonInteractiveOrDemo: false,
        isFullscreenAlready: false,
        hasExplicitTuiSetting: false,
        gbOchreHollow: false,
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
        gbOchreHollow: true,
        seenCount: FULLSCREEN_UPSELL_MAX_SEEN,
      }),
    ).toBe(false)
  })

  test('eligible when GB on and under max', () => {
    expect(
      shouldShowFullscreenUpsell({
        isNonInteractiveOrDemo: false,
        isFullscreenAlready: false,
        isHardDisabled: false,
        hasExplicitTuiSetting: false,
        gbOchreHollow: true,
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
