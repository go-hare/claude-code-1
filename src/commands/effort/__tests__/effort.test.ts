import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'

const settingsSnap = snapshotModuleExports(realSettings)

mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => ({}),
    getSettingsForSource: () => ({}),
    // Test stub: never write settings.json
    updateSettingsForSource:
      (() => ({})) as unknown as typeof realSettings.updateSettingsForSource,
  }),
)

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

mock.module('src/services/analytics/growthbook.js', () => ({
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

// FE on so ultracode is offerable for opus-4-7 (matches isUltracodeOfferable).
mock.module('src/utils/workflowDisableGate.js', () => ({
  isWorkflowsAvailable: () => true,
  isWorkflowFeatureEnabled: () => true,
}))

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
})

const { setUltracodeEffort, executeEffort } = await import('../effort.js')
const {
  isEffortLaunchPinned,
  resetEffortLaunchPinsForTests,
  unpinAllEffortLaunchPins,
} = await import('src/utils/model/effortCatalog.js')

describe('setUltracodeEffort densable sLy pin gate', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    resetEffortLaunchPinsForTests()
  })

  test('non-interactive + launch pin → reject, no effortUpdate, pin remains', () => {
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
    const result = setUltracodeEffort('claude-opus-4-7', false)
    expect(result.effortUpdate).toBeUndefined()
    expect(result.message).toContain('launch-effort pin')
    expect(result.message).toContain('interactive')
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
  })

  test('interactive + launch pin → apply xhigh, unpin', () => {
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
    const result = setUltracodeEffort('claude-opus-4-7', true)
    expect(result.effortUpdate).toEqual({ value: 'xhigh', ultracode: true })
    expect(result.message).toContain('ultracode')
    expect(result.message).toContain('xhigh + dynamic workflow orchestration')
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(false)
  })

  test('non-interactive after unpin → apply without pin block', () => {
    unpinAllEffortLaunchPins()
    const result = setUltracodeEffort('claude-opus-4-7', false)
    expect(result.effortUpdate).toEqual({ value: 'xhigh', ultracode: true })
  })

  test('executeEffort(ultracode) uses interactive session default path', () => {
    // executeEffort defaults interactive from getIsInteractive().
    // Explicit paths covered above; here assert alias routing only.
    const result = executeEffort('ultracode', 'claude-opus-4-7', true)
    expect(result.effortUpdate).toEqual({ value: 'xhigh', ultracode: true })
  })

  test('non-interactive /effort low + pin: densable oLy — no unpin, effortUpdate still set', () => {
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
    const result = executeEffort('low', 'claude-opus-4-7', false)
    expect(result.message).toContain('launch-effort pin')
    expect(result.effortUpdate).toEqual({ value: 'low', ultracode: false })
    // Pin remains so resolveAppliedEffort ignores session low
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
  })

  test('interactive /effort low + pin: unpins and applies', () => {
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
    const result = executeEffort('low', 'claude-opus-4-7', true)
    expect(result.effortUpdate).toEqual({ value: 'low', ultracode: false })
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(false)
  })

  test('non-interactive + pin + env: densable oLy reports env before pin', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'high'
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
    const result = executeEffort('low', 'claude-opus-4-7', false)
    expect(result.message).toContain('CLAUDE_CODE_EFFORT_LEVEL')
    expect(result.message).not.toContain('launch-effort pin')
    expect(result.effortUpdate).toEqual({ value: 'low', ultracode: false })
    // non-interactive does not N9
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
  })
})
