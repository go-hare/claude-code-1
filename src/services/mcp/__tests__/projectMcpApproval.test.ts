import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'

let mockSettings: {
  enabledMcpjsonServers?: string[]
  disabledMcpjsonServers?: string[]
  enableAllProjectMcpServers?: boolean
} = {}
let nonInteractive = false
let skipDangerous = false

import * as realSettings from 'src/utils/settings/settings.js'
import * as realBootstrapState from 'src/bootstrap/state.js'
import * as realSettingsConstants from 'src/utils/settings/constants.js'

// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
const settingsSnap = snapshotModuleExports(realSettings)
const bootstrapSnap = snapshotModuleExports(realBootstrapState)
const constantsSnap = snapshotModuleExports(realSettingsConstants)
const realGetInitialSettings =
  settingsSnap.getInitialSettings as typeof realSettings.getInitialSettings

mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getSettings_DEPRECATED: () => mockSettings,
    getInitialSettings: () => ({
      ...realGetInitialSettings(),
      ...mockSettings,
    }),
    hasSkipDangerousModePermissionPrompt: () => skipDangerous,
  }),
)

mock.module('src/bootstrap/state.js', () => ({
  ...bootstrapSnap,
  getIsNonInteractiveSession: () => nonInteractive,
}))

mock.module('src/utils/settings/constants.js', () => ({
  ...constantsSnap,
  isSettingSourceEnabled: () => true,
}))

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
  ])
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/utils/settings/constants.js', () => ({ ...constantsSnap }))
})

const { getProjectMcpServerStatus, getProjectMcpServerStatusStrict } =
  await import('../utils.js')

describe('project MCP approval status', () => {
  beforeEach(() => {
    mockSettings = {}
    nonInteractive = false
    skipDangerous = false
  })

  test('strict status stays pending without settings approval', () => {
    expect(getProjectMcpServerStatusStrict('evil-server')).toBe('pending')
  })

  test('strict status is approved when enableAllProjectMcpServers', () => {
    mockSettings = { enableAllProjectMcpServers: true }
    expect(getProjectMcpServerStatusStrict('evil-server')).toBe('approved')
  })

  test('strict status is rejected when listed in disabledMcpjsonServers', () => {
    mockSettings = { disabledMcpjsonServers: ['evil-server'] }
    expect(getProjectMcpServerStatusStrict('evil-server')).toBe('rejected')
  })

  test('runtime status can auto-approve in non-interactive sessions', () => {
    nonInteractive = true
    expect(getProjectMcpServerStatusStrict('evil-server')).toBe('pending')
    expect(getProjectMcpServerStatus('evil-server')).toBe('approved')
  })

  test('runtime status can auto-approve with skip-dangerous prompt', () => {
    skipDangerous = true
    expect(getProjectMcpServerStatusStrict('evil-server')).toBe('pending')
    expect(getProjectMcpServerStatus('evil-server')).toBe('approved')
  })
})
