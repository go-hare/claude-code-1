/**
 * densable 2.1.234 #7 — KXt + sessionAllowedHosts → LOr merge into allowedDomains.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realSettings from 'src/utils/settings/settings.js'
import type { SettingsJson } from 'src/utils/settings/types.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

let mergedSettings: SettingsJson = {}
const getSettingsForSourceMock = mock(
  (_source?: string) =>
    null as ReturnType<typeof realSettings.getSettingsForSource>,
)

const settingsSnap = snapshotModuleExports(realSettings)
const settingsMock = createSettingsMock(settingsSnap, {
  getSettingsForSource:
    getSettingsForSourceMock as typeof realSettings.getSettingsForSource,
  getSettings_DEPRECATED: () => mergedSettings,
  getInitialSettings: () => mergedSettings,
})
mock.module('src/utils/settings/settings.ts', settingsMock)
mock.module('src/utils/settings/settings.js', settingsMock)
mock.module('../settings/settings.js', settingsMock)

const realConstants = await import('src/utils/settings/constants.js')
mock.module('src/utils/settings/constants.js', () => ({
  ...realConstants,
  isSettingSourceEnabled: () => true,
}))
mock.module('../settings/constants.js', () => ({
  ...realConstants,
  isSettingSourceEnabled: () => true,
}))

const realBootstrap = await import('src/bootstrap/state.js')
const bootstrapSnap = snapshotModuleExports(realBootstrap)
mock.module('src/bootstrap/state.js', () => ({
  ...bootstrapSnap,
  getAdditionalDirectoriesForClaudeMd: () => [],
  getCwdState: () => process.cwd(),
  getOriginalCwd: () => process.cwd(),
}))

const realRipgrep = await import('src/utils/ripgrep.js')
const ripgrepSnap = snapshotModuleExports(realRipgrep)
mock.module('src/utils/ripgrep.js', () => ({
  ...ripgrepSnap,
  ripgrepCommand: () => ({ rgPath: 'rg', rgArgs: [], argv0: undefined }),
}))
const realHostProxy = await import('src/utils/hostProxyPorts.js')
const hostProxySnap = snapshotModuleExports(realHostProxy)
mock.module('src/utils/hostProxyPorts.js', () => ({
  ...hostProxySnap,
  readHostProxyPorts: () => ({}),
}))
const realEnvUtils = await import('src/utils/envUtils.js')
const envUtilsSnap = snapshotModuleExports(realEnvUtils)
mock.module('src/utils/envUtils.js', () => ({
  ...envUtilsSnap,
  getClaudeConfigHomeDir: () => '/tmp/claude-home',
}))

const {
  SandboxManager,
  addSessionAllowedHost,
  clearSessionAllowedHostsForTests,
  convertToSandboxRuntimeConfig,
  getSessionAllowedHosts,
  normalizeSandboxSessionHost,
} = await import('../sandbox-adapter.js')

afterEach(() => {
  clearSessionAllowedHostsForTests()
  mergedSettings = {}
  getSettingsForSourceMock.mockReset()
  getSettingsForSourceMock.mockImplementation((_source?: string) => null)
})

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
    'src/utils/settings/settings.ts',
    '../settings/settings.js',
  ])
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/utils/envUtils.js', () => ({ ...envUtilsSnap }))
  mock.module('src/utils/ripgrep.js', () => ({ ...ripgrepSnap }))
  mock.module('src/utils/hostProxyPorts.js', () => ({ ...hostProxySnap }))
})

describe('normalizeSandboxSessionHost (KXt)', () => {
  test('brackets bare IPv6', () => {
    expect(normalizeSandboxSessionHost('2001:db8::1')).toBe('[2001:db8::1]')
  })

  test('leaves hostname and IPv4 unchanged', () => {
    expect(normalizeSandboxSessionHost('example.com')).toBe('example.com')
    expect(normalizeSandboxSessionHost('127.0.0.1')).toBe('127.0.0.1')
  })
})

describe('sessionAllowedHosts → convert LOr merge', () => {
  test('merges session hosts into allowedDomains when not managed-only', () => {
    addSessionAllowedHost('api.example.com')
    addSessionAllowedHost('2001:db8::2')
    expect([...getSessionAllowedHosts()]).toEqual(
      expect.arrayContaining(['api.example.com', '[2001:db8::2]']),
    )

    const cfg = convertToSandboxRuntimeConfig({
      sandbox: { network: { allowedDomains: ['settings.example'] } },
    })
    expect(cfg.network.allowedDomains).toEqual(
      expect.arrayContaining([
        'settings.example',
        'api.example.com',
        '[2001:db8::2]',
      ]),
    )
  })

  test('idempotent add does not duplicate', () => {
    addSessionAllowedHost('once.com')
    addSessionAllowedHost('once.com')
    expect([...getSessionAllowedHosts()]).toEqual(['once.com'])
  })

  test('SandboxManager.addSessionAllowedHost is the same path', () => {
    SandboxManager.addSessionAllowedHost('via-manager.test')
    expect(getSessionAllowedHosts().has('via-manager.test')).toBe(true)
  })

  test('managed-only (LOr) excludes sessionAllowedHosts from allowedDomains', () => {
    addSessionAllowedHost('session-only.example')
    getSettingsForSourceMock.mockImplementation((source?: string) => {
      if (source === 'policySettings') {
        return {
          sandbox: {
            network: {
              allowManagedDomainsOnly: true,
              allowedDomains: ['policy.example'],
            },
          },
        } as never
      }
      return null
    })

    const cfg = convertToSandboxRuntimeConfig({
      sandbox: { network: { allowedDomains: ['settings.example'] } },
    })
    expect(cfg.network.allowedDomains).toEqual(['policy.example'])
    expect(cfg.network.allowedDomains).not.toContain('session-only.example')
    expect(cfg.network.allowedDomains).not.toContain('settings.example')
  })
})
