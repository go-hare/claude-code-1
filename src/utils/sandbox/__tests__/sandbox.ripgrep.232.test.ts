/**
 * densable 2.1.232 #48 — sandbox.ripgrep / bwrapPath / socatPath source gates (sJc).
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { SandboxSettingsSchema } from 'src/entrypoints/sandboxTypes.js'
import * as realSettings from 'src/utils/settings/settings.js'
import type { SettingsJson } from 'src/utils/settings/types.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'

const getSettingsForSourceMock = mock(
  (_source?: string) =>
    null as ReturnType<typeof realSettings.getSettingsForSource>,
)
const isSettingSourceEnabledMock = mock((_source?: string) => true)

const settingsSnap = snapshotModuleExports(realSettings)
const settingsMock = createSettingsMock(settingsSnap, {
  getSettingsForSource:
    getSettingsForSourceMock as typeof realSettings.getSettingsForSource,
  getSettings_DEPRECATED: () => ({}),
  getInitialSettings: () => ({}),
})
mock.module('src/utils/settings/settings.ts', settingsMock)
mock.module('src/utils/settings/settings.js', settingsMock)
mock.module('../settings/settings.js', settingsMock)

const realConstants = await import('src/utils/settings/constants.js')
const constantsSnap = snapshotModuleExports(realConstants)
mock.module('src/utils/settings/constants.ts', () => ({
  ...constantsSnap,
  isSettingSourceEnabled:
    isSettingSourceEnabledMock as typeof realConstants.isSettingSourceEnabled,
}))
mock.module('src/utils/settings/constants.js', () => ({
  ...constantsSnap,
  isSettingSourceEnabled:
    isSettingSourceEnabledMock as typeof realConstants.isSettingSourceEnabled,
}))
mock.module('../settings/constants.js', () => ({
  ...constantsSnap,
  isSettingSourceEnabled:
    isSettingSourceEnabledMock as typeof realConstants.isSettingSourceEnabled,
}))

const {
  resolveSandboxBwrapPath,
  resolveSandboxRipgrep,
  resolveSandboxSocatPath,
} = await import('../sandbox-adapter.js')

afterEach(() => {
  getSettingsForSourceMock.mockReset()
  getSettingsForSourceMock.mockImplementation((_source?: string) => null)
  isSettingSourceEnabledMock.mockReset()
  isSettingSourceEnabledMock.mockImplementation((_source?: string) => true)
})

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
    'src/utils/settings/settings.ts',
    '../settings/settings.js',
  ])
  mock.module('src/utils/settings/constants.ts', () => ({ ...constantsSnap }))
  mock.module('src/utils/settings/constants.js', () => ({ ...constantsSnap }))
  mock.module('../settings/constants.js', () => ({ ...constantsSnap }))
})

function bySource(
  map: Partial<Record<string, SettingsJson | null>>,
): typeof getSettingsForSourceMock {
  getSettingsForSourceMock.mockImplementation(
    (source?: string) => (map[source ?? ''] ?? null) as never,
  )
  return getSettingsForSourceMock
}

describe('SandboxSettingsSchema.ripgrep describe (densable 2.1.232 #48)', () => {
  test('schema accepts ripgrep and documents source restriction', () => {
    const schema = SandboxSettingsSchema()
    const parsed = schema.parse({
      ripgrep: { command: '/usr/bin/rg', args: ['--hidden'] },
    })
    expect(parsed.ripgrep?.command).toBe('/usr/bin/rg')
    const desc = schema.shape.ripgrep.description ?? ''
    expect(desc).toContain('Only honored from user, managed/policy, or CLI')
    expect(desc).toContain('project settings')
  })

  test('schema accepts bwrapPath/socatPath as managed-only fields', () => {
    const schema = SandboxSettingsSchema()
    const parsed = schema.parse({
      bwrapPath: '/usr/bin/bwrap',
      socatPath: '/usr/bin/socat',
    })
    expect(parsed.bwrapPath).toBe('/usr/bin/bwrap')
    expect(parsed.socatPath).toBe('/usr/bin/socat')
    expect(schema.shape.bwrapPath.description).toContain(
      'admin-controlled managed',
    )
    expect(schema.shape.socatPath.description).toContain(
      'admin-controlled managed',
    )
  })
})

describe('resolveSandboxRipgrep (densable rkt)', () => {
  test('ignores projectSettings and localSettings overrides', () => {
    bySource({
      projectSettings: {
        sandbox: { ripgrep: { command: '/evil/from-project' } },
      },
      localSettings: {
        sandbox: { ripgrep: { command: '/evil/from-local' } },
      },
      userSettings: {
        sandbox: { ripgrep: { command: '/safe/user-rg', args: ['-n'] } },
      },
    })
    expect(resolveSandboxRipgrep()).toEqual({
      command: '/safe/user-rg',
      args: ['-n'],
    })
  })

  test('policy wins over flag and user', () => {
    bySource({
      policySettings: {
        sandbox: { ripgrep: { command: '/managed/rg' } },
      },
      flagSettings: {
        sandbox: { ripgrep: { command: '/flag/rg' } },
      },
      userSettings: {
        sandbox: { ripgrep: { command: '/user/rg' } },
      },
    })
    expect(resolveSandboxRipgrep()?.command).toBe('/managed/rg')
  })

  test('flag wins over user when policy absent', () => {
    bySource({
      flagSettings: {
        sandbox: { ripgrep: { command: '/flag/rg', args: [] } },
      },
      userSettings: {
        sandbox: { ripgrep: { command: '/user/rg' } },
      },
    })
    expect(resolveSandboxRipgrep()).toEqual({
      command: '/flag/rg',
      args: [],
    })
  })

  test('skips userSettings when source disabled', () => {
    isSettingSourceEnabledMock.mockImplementation(
      (source?: string) => source !== 'userSettings',
    )
    bySource({
      userSettings: {
        sandbox: { ripgrep: { command: '/user/rg' } },
      },
    })
    expect(resolveSandboxRipgrep()).toBeUndefined()
  })

  test('returns undefined when no trusted source sets ripgrep', () => {
    bySource({
      projectSettings: {
        sandbox: { ripgrep: { command: '/project/rg' } },
      },
    })
    expect(resolveSandboxRipgrep()).toBeUndefined()
  })
})

describe('resolveSandboxBwrapPath / SocatPath (densable XEn/Mad)', () => {
  test('only policySettings is honored', () => {
    bySource({
      policySettings: {
        sandbox: {
          bwrapPath: '/managed/bwrap',
          socatPath: '/managed/socat',
        },
      },
      userSettings: {
        sandbox: {
          bwrapPath: '/user/bwrap',
          socatPath: '/user/socat',
        },
      },
      projectSettings: {
        sandbox: {
          bwrapPath: '/project/bwrap',
          socatPath: '/project/socat',
        },
      },
    })
    expect(resolveSandboxBwrapPath()).toBe('/managed/bwrap')
    expect(resolveSandboxSocatPath()).toBe('/managed/socat')
  })

  test('undefined when only user/project set paths', () => {
    bySource({
      userSettings: {
        sandbox: { bwrapPath: '/user/bwrap', socatPath: '/user/socat' },
      },
      projectSettings: {
        sandbox: { bwrapPath: '/project/bwrap', socatPath: '/project/socat' },
      },
    })
    expect(resolveSandboxBwrapPath()).toBeUndefined()
    expect(resolveSandboxSocatPath()).toBeUndefined()
  })
})
