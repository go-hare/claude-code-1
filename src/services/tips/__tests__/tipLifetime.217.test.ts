import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realConfig from 'src/utils/config.js'

// Process-global mock.module — spread real config + restore in afterAll so
// sibling suites (effort pin / orgConsent / tui) keep a full export surface.
const configSnap = snapshotModuleExports(realConfig)

const configState: {
  numStartups: number
  tipsHistory: Record<string, number>
  tipLifetimeShownCounts: Record<string, number>
} = {
  numStartups: 10,
  tipsHistory: {},
  tipLifetimeShownCounts: {},
}

function configMock() {
  return {
    ...configSnap,
    getGlobalConfig: () => ({
      ...(configSnap.getGlobalConfig as typeof realConfig.getGlobalConfig)(),
      ...configState,
    }),
    saveGlobalConfig: (
      updater: (c: typeof configState) => typeof configState,
    ) => {
      const next = updater({ ...configState })
      configState.numStartups = next.numStartups
      configState.tipsHistory = { ...(next.tipsHistory ?? {}) }
      configState.tipLifetimeShownCounts = {
        ...(next.tipLifetimeShownCounts ?? {}),
      }
    },
  }
}

mock.module('src/utils/config.ts', configMock)
mock.module('src/utils/config.js', configMock)

afterAll(() => {
  mock.module('src/utils/config.ts', () => ({ ...configSnap }))
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
})

import {
  getSessionsSinceLastShown,
  getTipLifetimeShownCount,
  recordTipShown,
} from '../tipHistory.js'

afterEach(() => {
  configState.numStartups = 10
  configState.tipsHistory = {}
  configState.tipLifetimeShownCounts = {}
})

describe('tip lifetime (densable 2.1.217 #17)', () => {
  test('recordTipShown bumps lifetime once per startup', () => {
    recordTipShown('frontend-design-plugin')
    expect(getTipLifetimeShownCount('frontend-design-plugin')).toBe(1)
    expect(configState.tipsHistory['frontend-design-plugin']).toBe(10)

    // same startup — no double count
    recordTipShown('frontend-design-plugin')
    expect(getTipLifetimeShownCount('frontend-design-plugin')).toBe(1)

    configState.numStartups = 14
    recordTipShown('frontend-design-plugin')
    expect(getTipLifetimeShownCount('frontend-design-plugin')).toBe(2)
    expect(getSessionsSinceLastShown('frontend-design-plugin')).toBe(0)
  })

  test('lifetime filter: maxLifetimeShows 3 excludes after 3 shows', () => {
    configState.tipLifetimeShownCounts['frontend-design-plugin'] = 3
    const maxLifetimeShows = 3
    const allowed =
      maxLifetimeShows === undefined ||
      getTipLifetimeShownCount('frontend-design-plugin') < maxLifetimeShows
    expect(allowed).toBe(false)

    configState.tipLifetimeShownCounts['frontend-design-plugin'] = 2
    expect(getTipLifetimeShownCount('frontend-design-plugin') < 3).toBe(true)
  })
})
