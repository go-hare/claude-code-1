import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../../tests/mocks/log'
import { debugMock } from '../../../../tests/mocks/debug'
import { bunBundleMock } from '../../../../tests/mocks/bunBundle.js'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'
import type { PermissionMode } from '../PermissionMode.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('bun:bundle', bunBundleMock)

const getSettingsForSourceMock = mock(
  (_source?: string) =>
    null as ReturnType<typeof realSettings.getSettingsForSource>,
)
const getSettingsDeprecatedMock = mock(() => ({}) as Record<string, unknown>)
const updateSettingsForSourceMock = mock(() => undefined)

const settingsSnap = snapshotModuleExports(realSettings)
const settingsMock = createSettingsMock(settingsSnap, {
  getSettingsForSource:
    getSettingsForSourceMock as typeof realSettings.getSettingsForSource,
  getSettings_DEPRECATED:
    getSettingsDeprecatedMock as typeof realSettings.getSettings_DEPRECATED,
  getInitialSettings: () => ({}),
  hasAutoModeOptIn: () => true,
  updateSettingsForSource:
    updateSettingsForSourceMock as typeof realSettings.updateSettingsForSource,
})
mock.module('src/utils/settings/settings.ts', settingsMock)
mock.module('src/utils/settings/settings.js', settingsMock)

afterEach(() => {
  getSettingsForSourceMock.mockReset()
  getSettingsForSourceMock.mockImplementation((_source?: string) => null)
  getSettingsDeprecatedMock.mockReset()
  getSettingsDeprecatedMock.mockImplementation(() => ({}))
  updateSettingsForSourceMock.mockReset()
})

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
})

describe('bypassPermissions from project/local defaultMode (2.1.283)', () => {
  test('trustedSourceGrantsDefaultMode is false when only projectSettings grants it', async () => {
    getSettingsForSourceMock.mockImplementation((source?: string) =>
      source === 'projectSettings'
        ? { permissions: { defaultMode: 'bypassPermissions' } }
        : null,
    )
    const { trustedSourceGrantsDefaultMode } = await import(
      '../permissionSetup.js'
    )
    expect(trustedSourceGrantsDefaultMode('bypassPermissions')).toBe(false)
  })

  test('trustedSourceGrantsDefaultMode is true for userSettings', async () => {
    getSettingsForSourceMock.mockImplementation((source?: string) =>
      source === 'userSettings'
        ? { permissions: { defaultMode: 'bypassPermissions' } }
        : null,
    )
    const { trustedSourceGrantsDefaultMode } = await import(
      '../permissionSetup.js'
    )
    expect(trustedSourceGrantsDefaultMode('bypassPermissions')).toBe(true)
  })

  test('projectSettings defaultMode bypassPermissions is ignored', async () => {
    getSettingsDeprecatedMock.mockImplementation(() => ({
      permissions: { defaultMode: 'bypassPermissions' as PermissionMode },
    }))
    getSettingsForSourceMock.mockImplementation((source?: string) =>
      source === 'projectSettings'
        ? { permissions: { defaultMode: 'bypassPermissions' } }
        : null,
    )
    const { initialPermissionModeFromCLI } = await import(
      '../permissionSetup.js'
    )
    const result = initialPermissionModeFromCLI({
      permissionModeCli: undefined,
      dangerouslySkipPermissions: undefined,
    })
    expect(result.mode).not.toBe('bypassPermissions')
  })

  test('userSettings defaultMode bypassPermissions is honored', async () => {
    getSettingsDeprecatedMock.mockImplementation(() => ({
      permissions: { defaultMode: 'bypassPermissions' as PermissionMode },
    }))
    getSettingsForSourceMock.mockImplementation((source?: string) =>
      source === 'userSettings'
        ? { permissions: { defaultMode: 'bypassPermissions' } }
        : null,
    )
    const { initialPermissionModeFromCLI } = await import(
      '../permissionSetup.js'
    )
    const result = initialPermissionModeFromCLI({
      permissionModeCli: undefined,
      dangerouslySkipPermissions: undefined,
    })
    expect(result.mode).toBe('bypassPermissions')
  })
})

describe('persistPermissionUpdate setMode bypassPermissions (2.1.283)', () => {
  test('does not write defaultMode', async () => {
    const { persistPermissionUpdate } = await import('../PermissionUpdate.js')
    persistPermissionUpdate({
      type: 'setMode',
      destination: 'userSettings',
      mode: 'bypassPermissions',
    })
    expect(updateSettingsForSourceMock).not.toHaveBeenCalled()
  })

  test('still writes a non-bypass mode', async () => {
    const { persistPermissionUpdate } = await import('../PermissionUpdate.js')
    persistPermissionUpdate({
      type: 'setMode',
      destination: 'userSettings',
      mode: 'default',
    })
    expect(updateSettingsForSourceMock).toHaveBeenCalled()
  })
})
