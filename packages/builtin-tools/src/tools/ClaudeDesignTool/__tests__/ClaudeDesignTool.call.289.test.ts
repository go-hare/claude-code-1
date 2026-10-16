import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { authMock } from '../../../../../../tests/mocks/auth'
import { setupAxiosMock } from '../../../../../../tests/mocks/axios'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'

mock.module('src/utils/auth.js', authMock)

const realOauth = await import('src/constants/oauth.js')
const oauthSnap = snapshotModuleExports(realOauth)
mock.module('src/constants/oauth.js', () => ({
  ...oauthSnap,
  getOauthConfig: () => ({ BASE_API_URL: 'https://example.test' }),
}))

const realDesignOauth = await import('src/cli/handlers/designOauth.js')
const designOauthSnap = snapshotModuleExports(realDesignOauth)
mock.module('src/cli/handlers/designOauth.js', () => ({
  ...designOauthSnap,
  readDesignOauth: async () => ({
    accessToken: 'design-token-secret',
    refreshToken: 'r',
    expiresAt: Date.now() + 60_000,
    scopes: ['user:design:read'],
    clientId: 'id',
  }),
}))

type AxiosPostResult = {
  status: number
  data: unknown
  headers?: Record<string, string>
}

let postResult: AxiosPostResult = { status: 200, data: {} }
const axiosHandle = setupAxiosMock()
axiosHandle.stubs.post = async () => postResult

beforeAll(() => {
  axiosHandle.useStubs = true
})

afterAll(() => {
  axiosHandle.useStubs = false
  mock.module('src/constants/oauth.js', () => ({ ...oauthSnap }))
  mock.module('src/cli/handlers/designOauth.js', () => ({
    ...designOauthSnap,
  }))
})

const { ClaudeDesignTool } = await import('../ClaudeDesignTool.js')

function ctx(isNonInteractiveSession = false) {
  return {
    abortController: new AbortController(),
    options: { isNonInteractiveSession },
  } as never
}

describe('gold 2.1.289 ClaudeDesign HTTP analog', () => {
  test('403 needs_design_scopes surfaces DesignNeedsScopesError text', async () => {
    postResult = {
      status: 403,
      data: { error: 'needs_design_scopes' },
    }
    const result = await ClaudeDesignTool.call(
      { operation: 'list_projects', arguments: {} },
      ctx(false),
    )
    expect(result.data.isError).toBe(true)
    const text = (result.data.content as Array<{ text: string }>)[0]?.text
    expect(text).toContain('HTTP 403')
    expect(text).toContain('does not carry Claude Design access')
    expect(text).toContain('Run /design login')
  })

  test('refuses SSE responses', async () => {
    postResult = {
      status: 200,
      data: 'event: ping',
      headers: { 'content-type': 'text/event-stream' },
    }
    const result = await ClaudeDesignTool.call(
      { operation: 'list', arguments: {} },
      ctx(),
    )
    expect(result.data.isError).toBe(true)
    expect((result.data.content as Array<{ text: string }>)[0]?.text).toContain(
      'text/event-stream',
    )
  })

  test('redacts the access token from HTTP error bodies', async () => {
    postResult = {
      status: 500,
      data: 'boom design-token-secret leaked',
    }
    const result = await ClaudeDesignTool.call(
      { operation: 'list_projects', arguments: {} },
      ctx(),
    )
    const text = (result.data.content as Array<{ text: string }>)[0]?.text
    expect(text).toContain('[redacted-oauth-token]')
    expect(text).not.toContain('design-token-secret')
  })

  test('does not POST a write op that fails WRITE_OP_SCHEMAS', async () => {
    let posted = false
    axiosHandle.stubs.post = async () => {
      posted = true
      return { status: 200, data: {} }
    }
    const result = await ClaudeDesignTool.call(
      { operation: 'mint_grant', arguments: {} },
      ctx(),
    )
    expect(posted).toBe(false)
    expect(result.data.isError).toBe(true)
    expect((result.data.content as Array<{ text: string }>)[0]?.text).toContain(
      'WRITE_OP_SCHEMAS',
    )
    axiosHandle.stubs.post = async () => postResult
  })
})
