import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

const realGrowthbook = await import('../../services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (_key: string, defaultValue: unknown) =>
    defaultValue ?? {},
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE: () => false,
  getFeatureValue_CACHED_WITH_REFRESH: (_key: string, defaultValue: unknown) =>
    defaultValue ?? {},
  getDynamicConfig_CACHED_MAY_BE_STALE: (_key: string, defaultValue: unknown) =>
    defaultValue ?? {},
  getFeatureValue_CACHED_MAY_BE_STALE_WITH_DEFAULTS: (
    _key: string,
    defaultValue: unknown,
  ) => defaultValue ?? {},
}))

afterAll(() => {
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

const { getEffortNotificationText, effortLevelToSymbol } = await import(
  '../EffortIndicator.js'
)
const { unpinAllEffortLaunchPins } = await import('../../utils/effort.js')

describe('getEffortNotificationText (densable Z_p)', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    delete process.env.CLAUDE_CODE_DISABLE_WORKFLOWS
    unpinAllEffortLaunchPins()
  })

  afterEach(() => {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
  })

  test('normal effort shows symbol · /effort', () => {
    const text = getEffortNotificationText('high', 'claude-opus-4-7', false)
    expect(text).toBe(`${effortLevelToSymbol('high')} high · /effort`)
  })

  test('ultracode uses catalog wire tier (opus → xhigh)', () => {
    const text = getEffortNotificationText('xhigh', 'claude-opus-4-7', true)
    expect(text).toBe(
      `${effortLevelToSymbol('xhigh')} ultracode · xhigh effort + dynamic workflows for maximum thoroughness`,
    )
  })

  test('ultracode on grok uses catalog high (not densable hardcoded xhigh)', () => {
    const text = getEffortNotificationText('high', 'grok-4.5', true)
    expect(text).toBe(
      `${effortLevelToSymbol('high')} ultracode · high effort + dynamic workflows for maximum thoroughness`,
    )
  })
})
