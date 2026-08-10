/**
 * densable 2.1.221 — sandbox.credentials.files mode "mask" + extract schema.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { SandboxCredentialFileSchema } from 'src/entrypoints/sandboxTypes.js'
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

// isSettingSourceEnabled lives in constants — keep user trusted by default.
const realConstants = await import('src/utils/settings/constants.js')
mock.module('src/utils/settings/constants.js', () => ({
  ...realConstants,
  isSettingSourceEnabled: () => true,
}))
mock.module('../settings/constants.js', () => ({
  ...realConstants,
  isSettingSourceEnabled: () => true,
}))

mock.module('src/bootstrap/state.js', () => ({
  getAdditionalDirectoriesForClaudeMd: () => [],
  getCwdState: () => process.cwd(),
  getOriginalCwd: () => process.cwd(),
}))

const realRipgrep = await import('src/utils/ripgrep.js')
mock.module('src/utils/ripgrep.js', () => ({
  ...realRipgrep,
  ripgrepCommand: () => ({ rgPath: 'rg', rgArgs: [], argv0: undefined }),
}))
const realHostProxy = await import('src/utils/hostProxyPorts.js')
mock.module('src/utils/hostProxyPorts.js', () => ({
  ...realHostProxy,
  readHostProxyPorts: () => ({}),
}))
const realEnvUtils = await import('src/utils/envUtils.js')
mock.module('src/utils/envUtils.js', () => ({
  ...realEnvUtils,
  getClaudeConfigHomeDir: () => '/tmp/claude-home',
}))

const { mergeSandboxCredentialsForRuntime } = await import(
  '../sandbox-adapter.js'
)

afterEach(() => {
  getSettingsForSourceMock.mockReset()
  getSettingsForSourceMock.mockImplementation((_source?: string) => null)
})

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
    'src/utils/settings/settings.ts',
    '../settings/settings.js',
  ])
})

function bySource(
  map: Partial<Record<string, SettingsJson | null>>,
): typeof getSettingsForSourceMock {
  getSettingsForSourceMock.mockImplementation(
    (source?: string) => (map[source ?? ''] ?? null) as never,
  )
  return getSettingsForSourceMock
}

describe('SandboxCredentialFileSchema densable 2.1.221 mask', () => {
  const schema = SandboxCredentialFileSchema()

  test('accepts mode deny', () => {
    expect(schema.parse({ path: '~/.netrc', mode: 'deny' })).toEqual({
      path: '~/.netrc',
      mode: 'deny',
    })
  })

  test('accepts mode mask + extract fields', () => {
    const v = schema.parse({
      path: '~/.netrc',
      mode: 'mask',
      extract: 'password\\s+(\\S+)',
      onExtractNoMatch: 'deny',
      maskDuplicates: true,
      injectHosts: ['api.example.com'],
    })
    expect(v.mode).toBe('mask')
    expect(v.extract).toBe('password\\s+(\\S+)')
    expect(v.onExtractNoMatch).toBe('deny')
    expect(v.maskDuplicates).toBe(true)
    expect(v.injectHosts).toEqual(['api.example.com'])
  })

  test('rejects mask directory path trailing slash', () => {
    const r = schema.safeParse({ path: '~/.secrets/', mode: 'mask' })
    expect(r.success).toBe(false)
  })
})

describe('mergeSandboxCredentialsForRuntime file mask', () => {
  test('merges mask file from userSettings with extract', () => {
    bySource({
      userSettings: {
        sandbox: {
          credentials: {
            files: [
              {
                path: '/home/u/.token',
                mode: 'mask',
                extract: '(secret)',
                injectHosts: ['api.x.com'],
              },
            ],
          },
        },
      },
    })
    const cred = mergeSandboxCredentialsForRuntime()
    expect(cred?.files?.length).toBe(1)
    expect(cred?.files?.[0]?.mode).toBe('mask')
    expect(cred?.files?.[0]?.extract).toBe('(secret)')
    expect(cred?.files?.[0]?.injectHosts).toEqual(['api.x.com'])
  })

  test('skips mask file from projectSettings', () => {
    bySource({
      projectSettings: {
        sandbox: {
          credentials: {
            files: [{ path: '/repo/.env', mode: 'mask' }],
          },
        },
      },
    })
    const cred = mergeSandboxCredentialsForRuntime()
    // seen=true with empty files after skip
    expect(cred?.files ?? []).toEqual([])
  })

  test('keeps deny file from projectSettings', () => {
    bySource({
      projectSettings: {
        sandbox: {
          credentials: {
            files: [{ path: '/repo/.env', mode: 'deny' }],
          },
        },
      },
    })
    const cred = mergeSandboxCredentialsForRuntime()
    expect(cred?.files?.length).toBe(1)
    expect(cred?.files?.[0]?.mode).toBe('deny')
  })
})
