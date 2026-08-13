/**
 * densable 2.1.229 #26 — unbracketed / unreliable IPv6 domain spellings.
 *
 * Mocks follow sandbox.credentials.224.test.ts (settings module + constants).
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

const { SandboxManager } = await import('../sandbox-adapter.js')
const {
  detectUnbracketedIpv6DomainWarnings,
  detectUnbracketedIpv6InjectHostWarnings,
} = await import('../../doctorDiagnostic.js')

afterEach(() => {
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
})

describe('densable 2.1.229 #26 IPv6 domain warnings', () => {
  test('flags unbracketed bare IPv6 ::1', () => {
    mergedSettings = {
      sandbox: {
        network: {
          allowedDomains: ['::1'],
        },
      },
    }
    const bad = SandboxManager.getUnbracketedIpv6DomainWarnings()
    expect(bad).toContain('::1')
  })

  test('flags @ in domain entry', () => {
    mergedSettings = {
      sandbox: {
        network: {
          deniedDomains: ['user@host'],
        },
      },
    }
    const bad = SandboxManager.getUnbracketedIpv6DomainWarnings()
    expect(bad).toContain('user@host')
  })

  test('does not flag clean bracketed [::1] and [::1]:443', () => {
    mergedSettings = {
      sandbox: {
        network: {
          allowedDomains: ['[::1]', '[::1]:443', 'example.com'],
        },
      },
    }
    const bad = SandboxManager.getUnbracketedIpv6DomainWarnings()
    expect(bad).not.toContain('[::1]')
    expect(bad).not.toContain('[::1]:443')
    expect(bad).not.toContain('example.com')
  })

  test('flags bad bracketed IPv6 port (leading zero / out of range)', () => {
    mergedSettings = {
      sandbox: {
        network: {
          allowedDomains: ['[::1]:0443', '[::1]:70000'],
        },
      },
    }
    const bad = SandboxManager.getUnbracketedIpv6DomainWarnings()
    expect(bad).toContain('[::1]:0443')
    expect(bad).toContain('[::1]:70000')
  })

  test('doctor Otv issue string is densable 1:1', () => {
    mergedSettings = {
      sandbox: {
        network: {
          allowedDomains: ['::1'],
        },
      },
    }
    const warnings = detectUnbracketedIpv6DomainWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.issue).toBe(
      'Sandbox network domain entries have unreliable spellings',
    )
    expect(warnings[0]!.fix).toContain('IPv6 literals must be bracketed')
    expect(warnings[0]!.fix).toContain('"[::1]", "[::1]:443"')
    expect(warnings[0]!.fix).toContain('enforcement is conservative')
    expect(warnings[0]!.fix).toContain('Found: ::1')
  })

  test('injectHosts warns on bracketed multi-colon hosts (Dtv)', () => {
    mergedSettings = {
      sandbox: {
        credentials: {
          envVars: [
            {
              name: 'TOKEN',
              mode: 'mask',
              injectHosts: ['[::1]', '::1'],
            },
          ],
        },
      },
    }
    const bad = SandboxManager.getUnbracketedIpv6InjectHostWarnings()
    expect(bad).toContain('[::1]')
    expect(bad).not.toContain('::1')

    const warnings = detectUnbracketedIpv6InjectHostWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.issue).toBe(
      'Sandbox credential injectHosts entries can never match their destination',
    )
    expect(warnings[0]!.fix).toContain('canonically-compressed')
  })
})
