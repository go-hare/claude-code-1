import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { setupAxiosMock } from '../../../tests/mocks/axios.js'
import { authMock } from '../../../tests/mocks/auth.js'
import {
  oauthClientMock,
  oauthConfigMock,
} from '../../../tests/mocks/oauthSurface.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import * as realBridgeConfig from '../bridgeConfig.js'

const bridgeConfigSnap = snapshotModuleExports(realBridgeConfig)

const axiosGet = mock(
  async (_url: string, _opts?: unknown) =>
    ({ status: 200, data: {} }) as { status: number; data: unknown },
)

const axiosHandle = setupAxiosMock()
axiosHandle.stubs.get = axiosGet
axiosHandle.stubs.isAxiosError = () => false

mock.module('src/utils/auth.js', authMock)
mock.module('../../utils/auth.js', authMock)
mock.module('src/constants/oauth.js', oauthConfigMock)
mock.module('../../constants/oauth.js', oauthConfigMock)
mock.module('src/services/oauth/client.js', () =>
  oauthClientMock({
    getOrganizationUUID: async () => 'org',
  }),
)
mock.module('../../services/oauth/client.js', () =>
  oauthClientMock({
    getOrganizationUUID: async () => 'org',
  }),
)
mock.module('../bridgeConfig.js', () => ({
  ...bridgeConfigSnap,
  isSelfHostedBridge: () => false,
  getBridgeBaseUrl: () => 'https://api.example',
}))

const { getBridgeSessionWithNotFound } = await import('../createSession.js')

beforeAll(() => {
  axiosHandle.useStubs = true
})
afterAll(() => {
  axiosHandle.useStubs = false
})
afterEach(() => {
  axiosGet.mockClear()
})

describe('densable 2.1.289 BridgeSessionInfo.tags sanitize', () => {
  test('keeps string tags only', async () => {
    axiosGet.mockImplementationOnce(async () => ({
      status: 200,
      data: {
        tags: ['rc-child', 1, 'hearth-rc-child', null],
        created_at: '2026-01-01T00:00:00Z',
      },
    }))
    const { session } = await getBridgeSessionWithNotFound('cse_1', {
      getAccessToken: () => 'tok',
      baseUrl: 'https://api.example',
    })
    expect(session?.tags).toEqual(['rc-child', 'hearth-rc-child'])
  })

  test('drops non-array tags', async () => {
    axiosGet.mockImplementationOnce(async () => ({
      status: 200,
      data: { tags: 'rc-child' },
    }))
    const { session } = await getBridgeSessionWithNotFound('cse_2', {
      getAccessToken: () => 'tok',
    })
    expect(session?.tags).toBeUndefined()
  })

  test('empty array kept', async () => {
    axiosGet.mockImplementationOnce(async () => ({
      status: 200,
      data: { tags: [] },
    }))
    const { session } = await getBridgeSessionWithNotFound('cse_3', {
      getAccessToken: () => 'tok',
    })
    expect(session?.tags).toEqual([])
  })
})
