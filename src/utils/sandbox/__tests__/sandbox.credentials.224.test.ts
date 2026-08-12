/**
 * densable 2.1.224 #6 — sandbox credentials decode/jwt, maskClaims, awsPairs, sigv4
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import {
  SandboxCredentialAwsPairSchema,
  SandboxCredentialEnvVarSchema,
  SandboxCredentialFileSchema,
  SandboxCredentialsConfigSchema,
  SandboxSigv4ConfigSchema,
} from 'src/entrypoints/sandboxTypes.js'
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

describe('densable 2.1.224 #6 SandboxCredentialFileSchema jwt/maskClaims', () => {
  const schema = SandboxCredentialFileSchema()

  test('accepts decode jwt without maskClaims (whole-token fallback)', () => {
    const v = schema.parse({
      path: '~/.tokens/id.jwt',
      mode: 'mask',
      decode: 'jwt',
      onExtractNoMatch: 'deny',
    })
    expect(v.decode).toBe('jwt')
    expect(v.maskClaims).toBeUndefined()
  })

  test('accepts decode jwt + maskClaims', () => {
    const v = schema.parse({
      path: '~/.tokens/id.jwt',
      mode: 'mask',
      decode: 'jwt',
      maskClaims: ['access_token', 'refresh_token'],
      injectHosts: ['api.example.com'],
    })
    expect(v.decode).toBe('jwt')
    expect(v.maskClaims).toEqual(['access_token', 'refresh_token'])
  })

  test('rejects maskClaims without decode', () => {
    const r = schema.safeParse({
      path: '~/.tokens/id.jwt',
      mode: 'mask',
      maskClaims: ['sub'],
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(
        r.error.issues.some(i => i.message.includes('requires decode')),
      ).toBe(true)
    }
  })

  test('rejects empty maskClaims', () => {
    const r = schema.safeParse({
      path: '~/.tokens/id.jwt',
      mode: 'mask',
      decode: 'jwt',
      maskClaims: [],
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(
        r.error.issues.some(i => i.message.includes('explicitly empty')),
      ).toBe(true)
    }
  })
})

describe('densable 2.1.224 #6 SandboxCredentialEnvVarSchema jwt/extract', () => {
  const schema = SandboxCredentialEnvVarSchema()

  test('accepts extract + onExtractNoMatch', () => {
    const v = schema.parse({
      name: 'MY_TOKEN',
      mode: 'mask',
      extract: 'Bearer\\s+(\\S+)',
      onExtractNoMatch: 'error',
    })
    expect(v.extract).toBe('Bearer\\s+(\\S+)')
    expect(v.onExtractNoMatch).toBe('error')
  })

  test('accepts decode jwt + maskClaims', () => {
    const v = schema.parse({
      name: 'OIDC_TOKEN',
      mode: 'mask',
      decode: 'jwt',
      maskClaims: ['access_token'],
    })
    expect(v.decode).toBe('jwt')
    expect(v.maskClaims).toEqual(['access_token'])
  })

  test('rejects maskClaims without decode', () => {
    const r = schema.safeParse({
      name: 'OIDC_TOKEN',
      mode: 'mask',
      maskClaims: ['access_token'],
    })
    expect(r.success).toBe(false)
  })
})

describe('densable 2.1.224 #6 awsPairs + sigv4 schema', () => {
  test('AwsPair accepts access/secret/session vars', () => {
    const v = SandboxCredentialAwsPairSchema().parse({
      accessKeyIdVar: 'MY_AWS_KEY',
      secretAccessKeyVar: 'MY_AWS_SECRET',
      sessionTokenVar: 'MY_AWS_TOKEN',
    })
    expect(v.accessKeyIdVar).toBe('MY_AWS_KEY')
    expect(v.sessionTokenVar).toBe('MY_AWS_TOKEN')
  })

  test('sigv4 accepts deny|passthrough policies', () => {
    const v = SandboxSigv4ConfigSchema().parse({
      streaming: 'passthrough',
      presigned: 'deny',
      sigv4a: 'deny',
    })
    expect(v.streaming).toBe('passthrough')
    expect(v.presigned).toBe('deny')
  })

  test('credentials block accepts awsPairs + sigv4', () => {
    const v = SandboxCredentialsConfigSchema().parse({
      envVars: [
        { name: 'MY_AWS_KEY', mode: 'mask' },
        { name: 'MY_AWS_SECRET', mode: 'mask' },
      ],
      awsPairs: [
        {
          accessKeyIdVar: 'MY_AWS_KEY',
          secretAccessKeyVar: 'MY_AWS_SECRET',
        },
      ],
      sigv4: { streaming: 'deny', presigned: 'passthrough' },
    })
    expect(v?.awsPairs?.[0]?.accessKeyIdVar).toBe('MY_AWS_KEY')
    expect(v?.sigv4?.presigned).toBe('passthrough')
  })
})

describe('mergeSandboxCredentialsForRuntime densable 2.1.224 #6', () => {
  test('passes file decode + maskClaims from userSettings', () => {
    bySource({
      userSettings: {
        sandbox: {
          credentials: {
            files: [
              {
                path: '/home/u/.id.jwt',
                mode: 'mask',
                decode: 'jwt',
                maskClaims: ['access_token'],
                injectHosts: ['api.x.com'],
              },
            ],
          },
        },
      },
    })
    const cred = mergeSandboxCredentialsForRuntime()
    expect(cred?.files?.[0]?.decode).toBe('jwt')
    expect(cred?.files?.[0]?.maskClaims).toEqual(['access_token'])
    expect(cred?.files?.[0]?.injectHosts).toEqual(['api.x.com'])
  })

  test('passes env decode/extract/maskClaims from userSettings', () => {
    bySource({
      userSettings: {
        sandbox: {
          credentials: {
            envVars: [
              {
                name: 'OIDC_TOKEN',
                mode: 'mask',
                decode: 'jwt',
                maskClaims: ['access_token'],
              },
              {
                name: 'NETRC_LINE',
                mode: 'mask',
                extract: 'password\\s+(\\S+)',
                onExtractNoMatch: 'deny',
              },
            ],
          },
        },
      },
    })
    const cred = mergeSandboxCredentialsForRuntime()
    const byName = Object.fromEntries(
      (cred?.envVars ?? []).map(e => [e.name, e]),
    )
    expect(byName.OIDC_TOKEN?.decode).toBe('jwt')
    expect(byName.OIDC_TOKEN?.maskClaims).toEqual(['access_token'])
    expect(byName.NETRC_LINE?.extract).toBe('password\\s+(\\S+)')
    expect(byName.NETRC_LINE?.onExtractNoMatch).toBe('deny')
  })

  test('merges awsPairs + sigv4 from userSettings; ignores project', () => {
    bySource({
      userSettings: {
        sandbox: {
          credentials: {
            envVars: [
              { name: 'MY_AWS_KEY', mode: 'mask' },
              { name: 'MY_AWS_SECRET', mode: 'mask' },
            ],
            awsPairs: [
              {
                accessKeyIdVar: 'MY_AWS_KEY',
                secretAccessKeyVar: 'MY_AWS_SECRET',
              },
            ],
            sigv4: { streaming: 'passthrough' },
          },
        },
      },
      projectSettings: {
        sandbox: {
          credentials: {
            awsPairs: [
              {
                accessKeyIdVar: 'EVIL_KEY',
                secretAccessKeyVar: 'EVIL_SECRET',
              },
            ],
            sigv4: { streaming: 'deny', presigned: 'passthrough' },
          },
        },
      },
    })
    const cred = mergeSandboxCredentialsForRuntime()
    expect(cred?.awsPairs).toEqual([
      {
        accessKeyIdVar: 'MY_AWS_KEY',
        secretAccessKeyVar: 'MY_AWS_SECRET',
      },
    ])
    expect(cred?.sigv4).toEqual({ streaming: 'passthrough' })
  })
})
