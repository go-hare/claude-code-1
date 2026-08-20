/**
 * densable 2.1.235 #14 — SEA `RPa` / `shouldShowAutoCompactOffHint`.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const realConfig = await import('../../../utils/config.js')
const configSnap = snapshotModuleExports(realConfig)

let autoCompactEnabled = true
mock.module('src/utils/config.js', () => ({
  ...configSnap,
  getGlobalConfig: () => ({
    ...((configSnap.getGlobalConfig?.() as object) ?? {}),
    autoCompactEnabled,
  }),
}))

const realConstants = await import('../../../utils/settings/constants.js')
const constantsSnap = snapshotModuleExports(realConstants)
let enabledSources: string[] = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
]
mock.module('src/utils/settings/constants.js', () => ({
  ...constantsSnap,
  getEnabledSettingSources: () => enabledSources,
}))

const { shouldShowAutoCompactOffHint } = await import('../autoCompact.js')

afterEach(() => {
  delete process.env.DISABLE_COMPACT
  delete process.env.DISABLE_AUTO_COMPACT
  autoCompactEnabled = true
  enabledSources = [
    'userSettings',
    'projectSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ]
})

afterAll(() => {
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  mock.module('src/utils/settings/constants.js', () => ({ ...constantsSnap }))
})

describe('shouldShowAutoCompactOffHint (densable RPa)', () => {
  test('env DISABLE_COMPACT → false', () => {
    process.env.DISABLE_COMPACT = '1'
    autoCompactEnabled = false
    expect(shouldShowAutoCompactOffHint()).toBe(false)
  })

  test('env DISABLE_AUTO_COMPACT → false', () => {
    process.env.DISABLE_AUTO_COMPACT = '1'
    autoCompactEnabled = false
    expect(shouldShowAutoCompactOffHint()).toBe(false)
  })

  test('autoCompact enabled → false', () => {
    autoCompactEnabled = true
    expect(shouldShowAutoCompactOffHint()).toBe(false)
  })

  test('autoCompact disabled + userSettings enabled → true', () => {
    autoCompactEnabled = false
    enabledSources = ['userSettings', 'flagSettings', 'policySettings']
    expect(shouldShowAutoCompactOffHint()).toBe(true)
  })

  test('autoCompact disabled + userSettings not enabled → false', () => {
    autoCompactEnabled = false
    enabledSources = ['flagSettings', 'policySettings']
    expect(shouldShowAutoCompactOffHint()).toBe(false)
  })
})
