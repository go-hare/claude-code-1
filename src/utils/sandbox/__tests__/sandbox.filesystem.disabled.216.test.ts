/**
 * densable 2.1.216 — sandbox.filesystem.disabled (Gvg/Wvg + managed lock)
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { SandboxFilesystemConfigSchema } from 'src/entrypoints/sandboxTypes.js'
import * as realSettings from 'src/utils/settings/settings.js'
import type { SettingsJson } from 'src/utils/settings/types.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'

// --- platform mock (memoized getPlatform) ---
let platformOverride: 'macos' | 'linux' | 'wsl' | 'windows' | 'unknown' =
  'macos'
const platformSnap = {
  getPlatform: () => platformOverride,
  getWslVersion: () => undefined,
  SUPPORTED_PLATFORMS: ['macos', 'wsl'] as const,
}
mock.module('src/utils/platform.js', () => platformSnap)
mock.module('src/utils/platform.ts', () => platformSnap)
mock.module('../platform.js', () => platformSnap)

// --- settings mock ---
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

// Mock bootstrap/state used by convertToSandboxRuntimeConfig non-disabled path.
// Snapshot BEFORE mock — live namespace rebinds under Bun; afterAll must restore.
const realBootstrap = await import('src/bootstrap/state.js')
const bootstrapSnap = snapshotModuleExports(realBootstrap)
mock.module('src/bootstrap/state.js', () => ({
  ...bootstrapSnap,
  getAdditionalDirectoriesForClaudeMd: () => [],
  getCwdState: () => process.cwd(),
  getOriginalCwd: () => process.cwd(),
}))

// Light stubs for convert deps. Process-global mock.module — always spread
// the real module so sibling suites (resumeAgent etc.) keep full export surface.
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
// Do NOT mock permissions/filesystem — real getClaudeTempDir is fine.
// Snapshot envUtils BEFORE mock — getClaudeConfigHomeDir → /tmp/claude-home
// must not stick for co-suites (/tui, autoModeReset, etc.).
const realEnvUtils = await import('src/utils/envUtils.js')
const envUtilsSnap = snapshotModuleExports(realEnvUtils)
mock.module('src/utils/envUtils.js', () => ({
  ...envUtilsSnap,
  getClaudeConfigHomeDir: () => '/tmp/claude-home',
}))
const realManagedPath = await import('src/utils/settings/managedPath.js')
const managedPathSnap = snapshotModuleExports(realManagedPath)
mock.module('src/utils/settings/managedPath.js', () => ({
  ...managedPathSnap,
  getManagedSettingsDropInDir: () => '/tmp/managed-dropin',
}))
const realChangeDetector = await import('src/utils/settings/changeDetector.js')
const changeDetectorSnap = snapshotModuleExports(realChangeDetector)
mock.module('src/utils/settings/changeDetector.js', () => ({
  ...changeDetectorSnap,
  settingsChangeDetector: { subscribe: () => () => {} },
}))

const {
  convertToSandboxRuntimeConfig,
  getDisabledFsDiagnosticLists,
  getDisabledSandboxFsReadConfig,
  getDisabledSandboxFsWriteConfig,
  isSandboxFilesystemDisabledLockedByManaged,
  mergeSandboxCredentialsForRuntime,
  resolveSandboxFilesystemDisabled,
  SandboxManager,
} = await import('../sandbox-adapter.js')

afterEach(() => {
  platformOverride = 'macos'
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
  mock.module('src/utils/settings/managedPath.js', () => ({
    ...managedPathSnap,
  }))
  mock.module('src/utils/settings/changeDetector.js', () => ({
    ...changeDetectorSnap,
  }))
})

function bySource(
  map: Partial<Record<string, SettingsJson | null>>,
): typeof getSettingsForSourceMock {
  getSettingsForSourceMock.mockImplementation(
    (source?: string) => (map[source ?? ''] ?? null) as never,
  )
  return getSettingsForSourceMock
}

describe('SandboxFilesystemConfigSchema.disabled (densable 2.1.216)', () => {
  test('accepts true/false/undefined', () => {
    const schema = SandboxFilesystemConfigSchema()
    expect(schema?.parse({ disabled: true })?.disabled).toBe(true)
    expect(schema?.parse({ disabled: false })?.disabled).toBe(false)
    expect(schema?.parse({})?.disabled).toBeUndefined()
  })
})

describe('getDisabledSandboxFsReadConfig / Write (Gvg/Wvg shapes)', () => {
  test('Gvg: empty denyOnly + allowWithinDeny', () => {
    expect(getDisabledSandboxFsReadConfig()).toEqual({
      denyOnly: [],
      allowWithinDeny: [],
    })
  })

  test('Wvg: allowOnly root + empty denyWithinAllow', () => {
    expect(getDisabledSandboxFsWriteConfig()).toEqual({
      allowOnly: ['/'],
      denyWithinAllow: [],
    })
  })
})

describe('resolveSandboxFilesystemDisabled', () => {
  test('false when unset', () => {
    expect(resolveSandboxFilesystemDisabled()).toBe(false)
  })

  test('true from userSettings on macos', () => {
    bySource({
      userSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    platformOverride = 'macos'
    expect(resolveSandboxFilesystemDisabled()).toBe(true)
  })

  test('true from flagSettings on linux', () => {
    bySource({
      flagSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    platformOverride = 'linux'
    expect(resolveSandboxFilesystemDisabled()).toBe(true)
  })

  test('true on wsl', () => {
    bySource({
      userSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    platformOverride = 'wsl'
    expect(resolveSandboxFilesystemDisabled()).toBe(true)
  })

  test('win32 always false even if user sets disabled', () => {
    bySource({
      userSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    platformOverride = 'windows'
    expect(resolveSandboxFilesystemDisabled()).toBe(false)
  })

  test('projectSettings alone is ignored', () => {
    bySource({
      projectSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    expect(resolveSandboxFilesystemDisabled()).toBe(false)
  })

  test('localSettings alone is ignored', () => {
    bySource({
      localSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    expect(resolveSandboxFilesystemDisabled()).toBe(false)
  })

  test('flagSettings wins over userSettings', () => {
    bySource({
      userSettings: { sandbox: { filesystem: { disabled: true } } },
      flagSettings: { sandbox: { filesystem: { disabled: false } } },
    })
    expect(resolveSandboxFilesystemDisabled()).toBe(false)
  })

  test('when managed configures filesystem, user cannot disable', () => {
    bySource({
      policySettings: {
        sandbox: { filesystem: { denyRead: ['/secret'] } },
      },
      userSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    expect(isSandboxFilesystemDisabledLockedByManaged()).toBe(true)
    expect(resolveSandboxFilesystemDisabled()).toBe(false)
  })

  test('when managed locks, only policy disabled=true enables', () => {
    bySource({
      policySettings: {
        sandbox: { filesystem: { disabled: true, denyRead: ['/secret'] } },
      },
      userSettings: { sandbox: { filesystem: { disabled: false } } },
    })
    expect(resolveSandboxFilesystemDisabled()).toBe(true)
  })

  test('managed credentials.files locks disabled to policy only', () => {
    bySource({
      policySettings: {
        sandbox: {
          // densable QTi shape: {path, mode:'deny'}
          credentials: {
            files: [{ path: '.env', mode: 'deny' }],
          },
        },
      },
      userSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    expect(isSandboxFilesystemDisabledLockedByManaged()).toBe(true)
    expect(resolveSandboxFilesystemDisabled()).toBe(false)
  })

  test('managed credentials.envVars alone does not lock', () => {
    bySource({
      policySettings: {
        sandbox: {
          credentials: {
            envVars: [{ name: 'AWS_SECRET_ACCESS_KEY', mode: 'deny' }],
          },
        },
      },
      userSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    expect(isSandboxFilesystemDisabledLockedByManaged()).toBe(false)
    expect(resolveSandboxFilesystemDisabled()).toBe(true)
  })
})

describe('credentials.files via runtime credentials (densable WZn/Dou package-side)', () => {
  test('user credentials.files deny lands on credentials, not filesystem.denyRead', () => {
    bySource({
      userSettings: {
        sandbox: {
          credentials: {
            files: [{ path: '/tmp/secret-token', mode: 'deny' }],
          },
        },
      },
    })
    platformOverride = 'macos'
    const cfg = convertToSandboxRuntimeConfig({
      sandbox: {
        credentials: {
          files: [{ path: '/tmp/secret-token', mode: 'deny' }],
        },
      },
    })
    // densable convert: credentials only; package Gvg does Dou(denyRead, WZn(credentials))
    expect(
      cfg.credentials?.files?.some(
        f =>
          (f.path.includes('secret-token') || f.path === '/tmp/secret-token') &&
          f.mode === 'deny',
      ),
    ).toBe(true)
    expect(
      cfg.filesystem.denyRead.some(
        p => p.includes('secret-token') || p === '/tmp/secret-token',
      ),
    ).toBe(false)
  })

  test('SandboxCredentialsConfigSchema accepts densable QTi/ZTi shapes', () => {
    const { SandboxCredentialsConfigSchema, SandboxSettingsSchema } =
      require('src/entrypoints/sandboxTypes.js') as typeof import('src/entrypoints/sandboxTypes.js')
    const cred = SandboxCredentialsConfigSchema().parse({
      files: [{ path: '~/.aws/credentials', mode: 'deny' }],
      envVars: [
        { name: 'AWS_SECRET_ACCESS_KEY', mode: 'deny' },
        {
          name: 'TOKEN',
          mode: 'mask',
          injectHosts: ['api.example.com'],
        },
      ],
      allowPlaintextInject: false,
    })
    expect(cred?.files?.[0]?.mode).toBe('deny')
    expect(cred?.envVars?.[1]?.mode).toBe('mask')
    // densable 2.1.224 #6 — files mode "mask" is settings-valid (jwt decode path)
    const masked = SandboxCredentialsConfigSchema().parse({
      files: [{ path: '/x', mode: 'mask', decode: 'jwt' }],
    })
    expect(masked?.files?.[0]?.mode).toBe('mask')
    expect(masked?.files?.[0]?.decode).toBe('jwt')
    // settings root accepts credentials first-class
    const settings = SandboxSettingsSchema().parse({
      credentials: {
        files: [{ path: '/tmp/x', mode: 'deny' }],
      },
    })
    expect(settings.credentials?.files?.[0]?.path).toBe('/tmp/x')
  })
})

describe('convertToSandboxRuntimeConfig with filesystem.disabled', () => {
  test('sets filesystem.disabled + keeps path lists; keeps network (0.0.70 native)', () => {
    bySource({
      userSettings: {
        sandbox: {
          filesystem: {
            disabled: true,
            denyRead: ['/etc/shadow'],
            denyWrite: ['/etc'],
            allowWrite: ['/tmp/only'],
          },
        },
      },
    })
    platformOverride = 'macos'

    const cfg = convertToSandboxRuntimeConfig({
      sandbox: {
        network: {
          allowedDomains: ['api.example.com'],
          allowUnixSockets: ['/tmp/sock'],
        },
        filesystem: {
          disabled: true,
          denyRead: ['/etc/shadow'],
          denyWrite: ['/etc'],
          allowWrite: ['/tmp/only'],
        },
        enableWeakerNestedSandbox: true,
      },
      permissions: {
        deny: ['WebFetch(domain:evil.com)'],
      },
    })

    // densable Xot relaxed: disabled flag + full lists (package Gvg/Wvg empty them)
    expect(cfg.filesystem.disabled).toBe(true)
    expect(
      cfg.filesystem.denyRead.some(
        p => p.includes('shadow') || p === '/etc/shadow',
      ),
    ).toBe(true)
    // expandPath is host-native: win32 turns /tmp/only → \tmp\only even when
    // platformOverride is macos (sandbox product platform ≠ path expander OS).
    expect(
      cfg.filesystem.allowWrite.some(
        p => p === '/tmp/only' || p.replace(/\\/g, '/') === '/tmp/only',
      ),
    ).toBe(true)
    expect(cfg.filesystem.allowWrite).toContain('.')
    // network still applied
    expect(cfg.network.allowedDomains).toContain('api.example.com')
    expect(cfg.network.deniedDomains).toContain('evil.com')
    expect(cfg.network.allowUnixSockets).toEqual(['/tmp/sock'])
    expect(cfg.enableWeakerNestedSandbox).toBe(true)
  })

  test('win32 ignores disabled and still emits FS restrictions', () => {
    bySource({
      userSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    platformOverride = 'windows'

    const cfg = convertToSandboxRuntimeConfig({
      sandbox: {
        filesystem: {
          disabled: true,
          denyRead: ['/etc/shadow'],
        },
        network: { allowedDomains: ['ok.example'] },
      },
    })

    // Not the relaxed disabled shape
    expect(cfg.filesystem.disabled).toBeUndefined()
    // default allowWrite includes '.' and temp
    expect(cfg.filesystem.allowWrite.length).toBeGreaterThan(0)
    expect(cfg.network.allowedDomains).toContain('ok.example')
    // dual facade stash cleared when isolation stays on
    expect(getDisabledFsDiagnosticLists()).toBeNull()
  })

  test('dual facade: package disabled:true + diagnostic raw lists', () => {
    // convert pulls sandbox.filesystem.* from settings sources (not only the
    // merged settings arg) — densable same multi-source join.
    bySource({
      userSettings: {
        sandbox: {
          filesystem: {
            disabled: true,
            denyRead: ['/etc/shadow'],
            allowWrite: ['/tmp/only'],
            denyWrite: ['/etc'],
          },
        },
      },
    })
    platformOverride = 'macos'

    const cfg = convertToSandboxRuntimeConfig({
      sandbox: {
        filesystem: {
          disabled: true,
          denyRead: ['/etc/shadow'],
          allowWrite: ['/tmp/only'],
          denyWrite: ['/etc'],
        },
        network: { allowedDomains: ['api.example.com'] },
      },
    })

    // (A) package config carries disabled + full lists (0.0.70 Gvg/Wvg gate)
    expect(cfg.filesystem.disabled).toBe(true)
    expect(
      cfg.filesystem.denyRead.some(
        p => p.includes('shadow') || p === '/etc/shadow',
      ),
    ).toBe(true)
    const isTmpOnly = (p: string) =>
      p === '/tmp/only' || p.replace(/\\/g, '/') === '/tmp/only'
    expect(cfg.filesystem.allowWrite.some(isTmpOnly)).toBe(true)

    // (B) diagnostic stash keeps configured + defaults
    const diag = getDisabledFsDiagnosticLists()
    expect(diag).not.toBeNull()
    expect(
      diag!.denyRead.some(p => p.includes('shadow') || p === '/etc/shadow'),
    ).toBe(true)
    expect(diag!.allowWrite.some(isTmpOnly)).toBe(true)
    expect(diag!.allowWrite).toContain('.')
    expect(
      diag!.denyWrite.some(p => {
        const n = p.replace(/\\/g, '/')
        return n === '/etc' || n.endsWith('/etc')
      }),
    ).toBe(true)

    // OUTER getFs* returns diagnostic (not empty Gvg)
    const read = SandboxManager.getFsReadConfig()
    const write = SandboxManager.getFsWriteConfig()
    expect(read.denyOnly).toEqual(diag!.denyRead)
    expect(write.allowOnly).toEqual(diag!.allowWrite)
    expect(write.denyWithinAllow).toEqual(diag!.denyWrite)
  })
})

describe('maskCredentialInjectionWarning (densable tuu)', () => {
  test('warns when mask envVars without tlsTerminate or allowPlaintextInject', () => {
    const { maskCredentialInjectionWarning } =
      require('../sandbox-adapter.js') as typeof import('../sandbox-adapter.js')
    const msg = maskCredentialInjectionWarning({
      network: { allowedDomains: ['api.example.com'], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: ['.'], denyWrite: [] },
      credentials: {
        envVars: [{ name: 'API_TOKEN', mode: 'mask' }],
      },
    })
    expect(msg).toContain('API_TOKEN')
    expect(msg).toContain('tlsTerminate')
  })

  test('silent when tlsTerminate present', () => {
    const { maskCredentialInjectionWarning } =
      require('../sandbox-adapter.js') as typeof import('../sandbox-adapter.js')
    expect(
      maskCredentialInjectionWarning({
        network: {
          allowedDomains: [],
          deniedDomains: [],
          tlsTerminate: {},
        },
        filesystem: { denyRead: [], allowWrite: ['.'], denyWrite: [] },
        credentials: {
          envVars: [{ name: 'API_TOKEN', mode: 'mask' }],
        },
      }),
    ).toBeUndefined()
  })

  test('silent when allowPlaintextInject true', () => {
    const { maskCredentialInjectionWarning } =
      require('../sandbox-adapter.js') as typeof import('../sandbox-adapter.js')
    expect(
      maskCredentialInjectionWarning({
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: { denyRead: [], allowWrite: ['.'], denyWrite: [] },
        credentials: {
          envVars: [{ name: 'API_TOKEN', mode: 'mask' }],
          allowPlaintextInject: true,
        },
      }),
    ).toBeUndefined()
  })

  test('silent when only deny envVars', () => {
    const { maskCredentialInjectionWarning } =
      require('../sandbox-adapter.js') as typeof import('../sandbox-adapter.js')
    expect(
      maskCredentialInjectionWarning({
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: { denyRead: [], allowWrite: ['.'], denyWrite: [] },
        credentials: {
          envVars: [{ name: 'SECRET', mode: 'deny' }],
        },
      }),
    ).toBeUndefined()
  })
})

describe('tlsTerminate pass-through (densable FQt)', () => {
  test('userSettings tlsTerminate lands on network when not windows ephemeral-only', () => {
    bySource({
      userSettings: {
        sandbox: {
          network: {
            tlsTerminate: {
              caCertPath: '/tmp/ca.pem',
              caKeyPath: '/tmp/ca.key',
            },
          },
        },
      },
    })
    platformOverride = 'macos'
    const cfg = convertToSandboxRuntimeConfig({ sandbox: {} })
    expect(cfg.network.tlsTerminate).toEqual({
      caCertPath: '/tmp/ca.pem',
      caKeyPath: '/tmp/ca.key',
    })
  })

  test('projectSettings tlsTerminate is ignored', () => {
    bySource({
      projectSettings: {
        sandbox: {
          network: {
            tlsTerminate: { caCertPath: '/tmp/ca.pem' },
          },
        },
      },
    })
    platformOverride = 'macos'
    const cfg = convertToSandboxRuntimeConfig({ sandbox: {} })
    expect(cfg.network.tlsTerminate).toBeUndefined()
  })
})

describe('credentials pass-through (densable Vzi / Anu / package 0.0.70)', () => {
  test('convert attaches credentials.files deny + envVars mask', () => {
    bySource({
      userSettings: {
        sandbox: {
          credentials: {
            files: [{ path: '/tmp/secret-token', mode: 'deny' }],
            envVars: [
              { name: 'AWS_SECRET_ACCESS_KEY', mode: 'deny' },
              {
                name: 'API_TOKEN',
                mode: 'mask',
                injectHosts: ['api.example.com'],
              },
            ],
            allowPlaintextInject: false,
          },
        },
      },
    })
    platformOverride = 'macos'
    const cfg = convertToSandboxRuntimeConfig({ sandbox: {} })
    expect(cfg.credentials).toBeDefined()
    expect(
      cfg.credentials!.files?.some(
        f => f.path.includes('secret-token') && f.mode === 'deny',
      ),
    ).toBe(true)
    const env = cfg.credentials!.envVars ?? []
    expect(env.find(e => e.name === 'AWS_SECRET_ACCESS_KEY')?.mode).toBe('deny')
    const mask = env.find(e => e.name === 'API_TOKEN')
    expect(mask?.mode).toBe('mask')
    expect(mask?.injectHosts).toEqual(['api.example.com'])
    expect(cfg.credentials!.allowPlaintextInject).toBe(false)
  })

  test('merge skips project/local mask; keeps project deny files', () => {
    bySource({
      projectSettings: {
        sandbox: {
          credentials: {
            files: [{ path: '/tmp/proj-secret', mode: 'deny' }],
            envVars: [{ name: 'PROJ_TOKEN', mode: 'mask' }],
          },
        },
      },
      userSettings: {
        sandbox: {
          credentials: {
            envVars: [{ name: 'USER_TOKEN', mode: 'mask' }],
          },
        },
      },
    })
    const cred = mergeSandboxCredentialsForRuntime()
    expect(cred).toBeDefined()
    expect(
      cred!.files?.some(
        f => f.path.includes('proj-secret') && f.mode === 'deny',
      ),
    ).toBe(true)
    const names = (cred!.envVars ?? []).map(e => e.name)
    expect(names).toContain('USER_TOKEN')
    expect(names).not.toContain('PROJ_TOKEN')
  })

  test('deny is sticky across sources', () => {
    bySource({
      userSettings: {
        sandbox: {
          credentials: {
            envVars: [{ name: 'SHARED', mode: 'deny' }],
          },
        },
      },
      flagSettings: {
        sandbox: {
          credentials: {
            envVars: [
              {
                name: 'SHARED',
                mode: 'mask',
                injectHosts: ['api.example.com'],
              },
            ],
          },
        },
      },
    })
    const cred = mergeSandboxCredentialsForRuntime()
    expect(cred!.envVars?.find(e => e.name === 'SHARED')?.mode).toBe('deny')
  })
})

describe('getLinuxGlobPatternWarnings when filesystem.disabled (densable uCg)', () => {
  test('returns [] when disabled even on linux with glob rules', () => {
    bySource({
      userSettings: { sandbox: { filesystem: { disabled: true } } },
    })
    platformOverride = 'linux'
    // getLinuxGlobPatternWarnings uses getSettings_DEPRECATED which is mocked empty —
    // still must short-circuit on resolveSandboxFilesystemDisabled before settings.
    expect(SandboxManager.getLinuxGlobPatternWarnings()).toEqual([])
  })
})
