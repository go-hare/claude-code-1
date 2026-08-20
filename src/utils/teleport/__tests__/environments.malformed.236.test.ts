/**
 * densable 2.1.236 GAP #13 — cloud environments empty/malformed clear errors.
 *
 * Mock axios (and auth/org/config helpers). Do NOT mock the environments
 * module itself — Bun's mock.module is process-global and would pollute
 * any future environments unit/api tests in this directory.
 *
 * Thin unrestored config/auth mocks poisoned sibling suites (orgConsent /
 * tui / autoModeReset / effort / cd / otel). Spread real module snapshots and
 * restore in afterAll (same pattern as referral.referrerReward.236).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { setupAxiosMock } from '../../../../tests/mocks/axios.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realConfig from 'src/utils/config.js'
import * as realAuth from 'src/utils/auth.js'
import * as realOauthConstants from 'src/constants/oauth.js'
import * as realOauthClient from 'src/services/oauth/client.js'
import * as realTeleportApi from 'src/utils/teleport/api.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const configSnap = snapshotModuleExports(realConfig)
const authSnap = snapshotModuleExports(realAuth)
const oauthConstantsSnap = snapshotModuleExports(realOauthConstants)
const oauthClientSnap = snapshotModuleExports(realOauthClient)
const teleportApiSnap = snapshotModuleExports(realTeleportApi)

const getClaudeAIOAuthTokensMock = mock(() => ({
  accessToken: 'test-access-token',
}))

const getOrganizationUUIDMock = mock(async () => 'org-uuid-test')

let hasRemoteEnvironment = false
const saveGlobalConfigMock = mock(
  (
    updater: (s: { hasRemoteEnvironment: boolean }) => {
      hasRemoteEnvironment: boolean
    },
  ) => {
    const next = updater({ hasRemoteEnvironment })
    hasRemoteEnvironment = next.hasRemoteEnvironment
  },
)

function configMock() {
  return {
    ...configSnap,
    getGlobalConfig: () => ({
      ...(configSnap.getGlobalConfig as typeof realConfig.getGlobalConfig)(),
      hasRemoteEnvironment,
    }),
    saveGlobalConfig: saveGlobalConfigMock,
  }
}

function authMock() {
  return {
    ...authSnap,
    getClaudeAIOAuthTokens: getClaudeAIOAuthTokensMock,
  }
}

function oauthConstantsMock() {
  return {
    ...oauthConstantsSnap,
    getOauthConfig: () => ({ BASE_API_URL: 'https://api.anthropic.com' }),
  }
}

function oauthClientMock() {
  return {
    ...oauthClientSnap,
    getOrganizationUUID: getOrganizationUUIDMock,
  }
}

function teleportApiMock() {
  return {
    ...teleportApiSnap,
    getOAuthHeaders: () => ({
      Authorization: 'Bearer test-access-token',
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }),
    prepareWorkspaceApiRequest: async () => ({
      apiKey: 'sk-ant-api03-test',
    }),
  }
}

mock.module('src/constants/oauth.js', oauthConstantsMock)
mock.module('src/utils/auth.js', authMock)
mock.module('src/utils/auth.ts', authMock)
mock.module('src/services/oauth/client.js', oauthClientMock)
mock.module('src/services/oauth/client.ts', oauthClientMock)
mock.module('src/utils/config.js', configMock)
mock.module('src/utils/config.ts', configMock)
mock.module('src/utils/teleport/api.js', teleportApiMock)

const axiosGetMock = mock(async () => ({}))
const axiosPostMock = mock(async () => ({}))
const axiosHandle = setupAxiosMock()
axiosHandle.stubs.get = axiosGetMock
axiosHandle.stubs.post = axiosPostMock

let fetchEnvironments: typeof import('../environments.js').fetchEnvironments
let mapMalformedEnvironmentsResponse: typeof import('../environments.js').mapMalformedEnvironmentsResponse
let createDefaultCloudEnvironment: typeof import('../environments.js').createDefaultCloudEnvironment

beforeAll(async () => {
  axiosHandle.useStubs = true
  const mod = await import('../environments.js')
  fetchEnvironments = mod.fetchEnvironments
  mapMalformedEnvironmentsResponse = mod.mapMalformedEnvironmentsResponse
  createDefaultCloudEnvironment = mod.createDefaultCloudEnvironment
})

afterAll(() => {
  axiosHandle.useStubs = false
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  mock.module('src/utils/config.ts', () => ({ ...configSnap }))
  mock.module('src/utils/auth.js', () => ({ ...authSnap }))
  mock.module('src/utils/auth.ts', () => ({ ...authSnap }))
  mock.module('src/constants/oauth.js', () => ({ ...oauthConstantsSnap }))
  mock.module('src/services/oauth/client.js', () => ({ ...oauthClientSnap }))
  mock.module('src/services/oauth/client.ts', () => ({ ...oauthClientSnap }))
  mock.module('src/utils/teleport/api.js', () => ({ ...teleportApiSnap }))
})

beforeEach(() => {
  axiosGetMock.mockClear()
  axiosPostMock.mockClear()
  saveGlobalConfigMock.mockClear()
  getClaudeAIOAuthTokensMock.mockClear()
  getOrganizationUUIDMock.mockClear()
  getClaudeAIOAuthTokensMock.mockImplementation(() => ({
    accessToken: 'test-access-token',
  }))
  getOrganizationUUIDMock.mockImplementation(async () => 'org-uuid-test')
  hasRemoteEnvironment = false
})

describe('mapMalformedEnvironmentsResponse (densable MIS)', () => {
  test('empty string body → empty-response message + detail', () => {
    const err = mapMalformedEnvironmentsResponse('') as Error & {
      detail: string
    }
    expect(err.message).toBe(
      'The cloud environments service returned an empty response (HTTP 200 with no body). This is usually temporary — try again in a moment.',
    )
    expect(err.detail).toBe('fetchEnvironments: HTTP 200 with an empty body')
  })

  test('whitespace-only string → empty-response message', () => {
    const err = mapMalformedEnvironmentsResponse('   \n\t') as Error & {
      detail: string
    }
    expect(err.message).toContain('empty response')
    expect(err.detail).toBe('fetchEnvironments: HTTP 200 with an empty body')
  })

  test('non-JSON string → unexpected-format non-JSON message', () => {
    const err = mapMalformedEnvironmentsResponse(
      '<html>oops</html>',
    ) as Error & { detail: string }
    expect(err.message).toBe(
      'The cloud environments service returned a response in an unexpected format (HTTP 200 with a non-JSON body). This is usually temporary — try again in a moment.',
    )
    expect(err.detail).toBe('fetchEnvironments: HTTP 200 with a non-JSON body')
  })

  test('else → without usable environments list', () => {
    const err = mapMalformedEnvironmentsResponse({
      environments: null,
    }) as Error & { detail: string }
    expect(err.message).toBe(
      'The cloud environments service returned a response in an unexpected format (HTTP 200 without a usable environments list). This is usually temporary — try again in a moment.',
    )
    expect(err.detail).toBe(
      'fetchEnvironments: HTTP 200 JSON body without a valid environments array',
    )
  })
})

describe('fetchEnvironments malformed HTTP 200 (GAP #13)', () => {
  test('empty string body throws MIS empty-response (unwrapped)', async () => {
    axiosGetMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: '',
    })
    await expect(fetchEnvironments()).rejects.toThrow(
      'The cloud environments service returned an empty response (HTTP 200 with no body). This is usually temporary — try again in a moment.',
    )
  })

  test('non-JSON string body throws MIS non-JSON', async () => {
    axiosGetMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: 'not-json',
    })
    await expect(fetchEnvironments()).rejects.toThrow(
      'HTTP 200 with a non-JSON body',
    )
  })

  test('JSON without environments array throws MIS usable-list', async () => {
    axiosGetMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: { items: [] },
    })
    await expect(fetchEnvironments()).rejects.toThrow(
      'without a usable environments list',
    )
  })

  test('environments containing null is malformed (loose plain-object check)', async () => {
    axiosGetMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: { environments: [null] },
    })
    await expect(fetchEnvironments()).rejects.toThrow(
      'without a usable environments list',
    )
  })

  test('does not wrap MIS message with Failed to fetch environments', async () => {
    axiosGetMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: '',
    })
    try {
      await fetchEnvironments()
      expect.unreachable('expected throw')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg.startsWith('Failed to fetch environments:')).toBe(false)
      expect(msg).toContain('empty response')
    }
  })
})

describe('fetchEnvironments success paths', () => {
  test('empty environments[] returns [] and syncs hasRemoteEnvironment=false', async () => {
    hasRemoteEnvironment = true
    axiosGetMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: {
        environments: [],
        has_more: false,
        first_id: null,
        last_id: null,
      },
    })
    const result = await fetchEnvironments()
    expect(result).toEqual([])
    expect(hasRemoteEnvironment).toBe(false)
    expect(saveGlobalConfigMock).toHaveBeenCalled()
  })

  test('valid environments list returns items and syncs hasRemoteEnvironment=true', async () => {
    const env = {
      kind: 'anthropic_cloud' as const,
      environment_id: 'env_1',
      name: 'Default',
      created_at: '2026-01-01T00:00:00Z',
      state: 'active' as const,
    }
    axiosGetMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: {
        environments: [env],
        has_more: false,
        first_id: null,
        last_id: null,
      },
    })
    const result = await fetchEnvironments()
    expect(result).toEqual([env])
    expect(hasRemoteEnvironment).toBe(true)
  })

  test('auth missing token keeps existing message (outside MIS)', async () => {
    getClaudeAIOAuthTokensMock.mockImplementation(() => null as never)
    await expect(fetchEnvironments()).rejects.toThrow(
      'Claude Code web sessions require authentication with a Claude.ai account',
    )
    expect(axiosGetMock).not.toHaveBeenCalled()
  })

  test('generic network errors still wrap Failed to fetch environments', async () => {
    axiosGetMock.mockRejectedValueOnce(new Error('socket hang up'))
    await expect(fetchEnvironments()).rejects.toThrow(
      'Failed to fetch environments: socket hang up',
    )
  })
})

describe('createDefaultCloudEnvironment description (densable Qht)', () => {
  test('posts description Default - trusted network access', async () => {
    const created = {
      kind: 'anthropic_cloud',
      environment_id: 'env_new',
      name: 'Default',
      created_at: '2026-01-01T00:00:00Z',
      state: 'active',
    }
    axiosPostMock.mockResolvedValueOnce({ status: 200, data: created })
    await createDefaultCloudEnvironment('Default')
    const calls = axiosPostMock.mock.calls as unknown as [
      string,
      Record<string, unknown>,
      unknown,
    ][]
    expect(calls[0]?.[1]?.description).toBe('Default - trusted network access')
  })
})
