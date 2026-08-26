import { afterEach, describe, expect, mock, test } from 'bun:test'
import * as realConfig from '../config.js'
import * as realSettings from '../settings/settings.js'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'
import { getTheme } from '../theme.js'
import { getTheme as getInkTheme } from '../../../packages/@ant/ink/src/theme/theme-types.js'

const configSnap = snapshotModuleExports(realConfig)
const settingsSnap = snapshotModuleExports(realSettings)

mock.module('../config.js', () => ({ ...configSnap }))
mock.module('src/utils/config.js', () => ({ ...configSnap }))
mock.module('../settings/settings.js', () => ({ ...settingsSnap }))
mock.module('src/utils/settings/settings.js', () => ({ ...settingsSnap }))

import {
  _resetFullscreenUpsellImpressionForTesting,
  FULLSCREEN_UPSELL_MAX_SEEN,
  recordFullscreenUpsellImpression,
  shouldShowFullscreenUpsell,
} from '../fullscreenUpsellGate.js'

afterEach(() => {
  _resetFullscreenUpsellImpressionForTesting()
})

describe('dark-ansi expanded tool hover (official fWv / 2.1.239)', () => {
  test('userMessageBackgroundHover is ansi:black, not white', () => {
    const theme = getTheme('dark-ansi')
    expect(theme.userMessageBackgroundHover).toBe('ansi:black')
    expect(theme.text).toBe('ansi:whiteBright')
    expect(theme.background).toBe('ansi:cyanBright')
    const ink = getInkTheme('dark-ansi')
    expect(ink.userMessageBackgroundHover).toBe('ansi:black')
    expect(ink.text).toBe('ansi:whiteBright')
  })
})

describe('V1y shouldShowFullscreenUpsell (2.1.239, no ochre_hollow)', () => {
  test('eligible without GrowthBook (Bedrock/Vertex/Foundry)', () => {
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

  test('already fullscreen still skips', () => {
    expect(
      shouldShowFullscreenUpsell({
        isNonInteractiveOrDemo: false,
        isFullscreenAlready: true,
        hasExplicitTuiSetting: false,
        seenCount: 0,
      }),
    ).toBe(false)
  })
})

describe('udc recordFullscreenUpsellImpression (2.1.239)', () => {
  test('first show increments by one', () => {
    expect(recordFullscreenUpsellImpression({})).toEqual({
      fullscreenUpsellSeenCount: 1,
    })
  })

  test('same process does not increment twice', () => {
    expect(recordFullscreenUpsellImpression({})).toEqual({
      fullscreenUpsellSeenCount: 1,
    })
    expect(
      recordFullscreenUpsellImpression({ fullscreenUpsellSeenCount: 1 }),
    ).toEqual({ fullscreenUpsellSeenCount: 1 })
  })

  test('caps at M4r=3', () => {
    expect(
      recordFullscreenUpsellImpression({
        fullscreenUpsellSeenCount: FULLSCREEN_UPSELL_MAX_SEEN,
      }),
    ).toEqual({ fullscreenUpsellSeenCount: FULLSCREEN_UPSELL_MAX_SEEN })
  })
})
