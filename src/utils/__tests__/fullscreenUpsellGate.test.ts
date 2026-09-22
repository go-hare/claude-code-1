import { afterAll, describe, expect, mock, test } from 'bun:test'
import * as realConfig from '../config.js'
import * as realSettings from '../settings/settings.js'
import { growthbookMock } from '../../../tests/mocks/growthbook.js'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'

// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
const configSnap = snapshotModuleExports(realConfig)
const settingsSnap = snapshotModuleExports(realSettings)

mock.module('src/services/analytics/growthbook.js', growthbookMock)

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
  isFullscreenUpsellAutoOffReason,
  markFullscreenUpsellFullySeen,
  shouldShowFullscreenUpsell,
} from '../fullscreenUpsellGate.js'

/** Arms that must be false for a positive eligibility path under tip default-on. */
const eligibleArms = {
  isNonInteractiveOrDemo: false,
  isBgSession: false,
  isRemoteWorkspace: false,
  hasBgTakeover: false,
  isFullscreenAlready: false,
  isHardDisabled: false,
  hasExplicitTuiSetting: false,
  isLatchedFullscreen: false,
  isAutoOffGateReason: false,
  isGrowthBookFallback: false,
  isForkRestrictedLaunchConfig: false,
  isStickyAutoDisabled: false,
  seenCount: 0,
} as const

describe('shouldShowFullscreenUpsell Npf densable', () => {
  test('FORCE_FULLSCREEN_UPSELL wins over Lt/Om/tui/seen — not over bg/remote/takeover', () => {
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        env: { CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL: '1' },
        isFullscreenAlready: true,
        hasExplicitTuiSetting: true,
        seenCount: 99,
      }),
    ).toBe(true)

    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        env: { CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL: '1' },
        isBgSession: true,
      }),
    ).toBe(false)
  })

  test('non-interactive / demo skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        isNonInteractiveOrDemo: true,
      }),
    ).toBe(false)
  })

  test('official _t / On / hg skip before FORCE', () => {
    expect(
      shouldShowFullscreenUpsell({ ...eligibleArms, isBgSession: true }),
    ).toBe(false)
    expect(
      shouldShowFullscreenUpsell({ ...eligibleArms, isRemoteWorkspace: true }),
    ).toBe(false)
    expect(
      shouldShowFullscreenUpsell({ ...eligibleArms, hasBgTakeover: true }),
    ).toBe(false)
  })

  test('already fullscreen skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        isFullscreenAlready: true,
      }),
    ).toBe(false)
  })

  test('hard-disabled skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        isHardDisabled: true,
      }),
    ).toBe(false)
  })

  test('explicit tui setting skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        hasExplicitTuiSetting: true,
      }),
    ).toBe(false)
  })

  test('GHe latched fullscreen / uft auto-off / gqn / mwt skip', () => {
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        isLatchedFullscreen: true,
      }),
    ).toBe(false)
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        isAutoOffGateReason: true,
      }),
    ).toBe(false)
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        isGrowthBookFallback: true,
      }),
    ).toBe(false)
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        isStickyAutoDisabled: true,
      }),
    ).toBe(false)
  })

  test('uft maps official auto-off reasons', () => {
    expect(isFullscreenUpsellAutoOffReason('env_off')).toBe(true)
    expect(isFullscreenUpsellAutoOffReason('sr_auto_off')).toBe(true)
    expect(isFullscreenUpsellAutoOffReason('tmux_cc_auto_off')).toBe(true)
    expect(isFullscreenUpsellAutoOffReason('win_ssh_auto_off')).toBe(true)
    expect(isFullscreenUpsellAutoOffReason('ant_default')).toBe(false)
    expect(isFullscreenUpsellAutoOffReason('crash_auto_off')).toBe(false)
  })

  test('seen count at max skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        seenCount: FULLSCREEN_UPSELL_MAX_SEEN,
      }),
    ).toBe(false)
  })

  test('eligible when under max (no GB required)', () => {
    expect(shouldShowFullscreenUpsell({ ...eligibleArms })).toBe(true)
  })

  test('official tae GC() (#w) skips — not Yk/#l', () => {
    expect(
      shouldShowFullscreenUpsell({
        ...eligibleArms,
        isForkRestrictedLaunchConfig: true,
      }),
    ).toBe(false)
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
