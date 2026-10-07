import { afterEach, describe, expect, mock, test } from 'bun:test'

const axiosGet = mock(
  async (_url: string, _opts?: unknown) =>
    ({ status: 200, data: {} }) as { status: number; data: unknown },
)

mock.module('axios', () => ({
  default: {
    get: axiosGet,
    isAxiosError: () => false,
  },
}))

mock.module('../../utils/auth.js', () => ({
  getClaudeAIOAuthTokens: () => ({ accessToken: 'tok' }),
}))

mock.module('../../services/oauth/client.js', () => ({
  getOrganizationUUID: async () => 'org',
}))

mock.module('../../constants/oauth.js', () => ({
  getOauthConfig: () => ({ BASE_API_URL: 'https://api.example' }),
}))

mock.module('../../utils/teleport/api.js', () => ({
  getOAuthHeaders: () => ({ Authorization: 'Bearer tok' }),
}))

mock.module('../bridgeConfig.js', () => ({
  isSelfHostedBridge: () => false,
  getBridgeBaseUrl: () => 'https://api.example',
}))

const { getBridgeSessionWithNotFound } = await import('../createSession.js')

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
