import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { logMock } from '../../../../../../tests/mocks/log'
import { setupAxiosMock } from '../../../../../../tests/mocks/axios'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../../../tests/mocks/settings.js'

type MockAxiosResponse = {
  data: ArrayBuffer
  headers: Record<string, unknown>
  status: number
  statusText: string
}

type MockAxiosError = Error & {
  isAxiosError: true
  response?: {
    headers: Record<string, unknown>
    status: number
  }
}

let getMock: (url: string) => Promise<MockAxiosResponse>

const axiosHandle = setupAxiosMock()
axiosHandle.stubs.get = (url: string) => getMock(url)
axiosHandle.stubs.isAxiosError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { isAxiosError?: unknown }).isAxiosError === true

const realAnalytics = await import('src/services/analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: () => {},
}))

const realClaudeApi = await import('src/services/api/claude.js')
const claudeApiSnap = snapshotModuleExports(realClaudeApi)
mock.module('src/services/api/claude.js', () => ({
  ...claudeApiSnap,
  queryHaiku: async () => ({ message: { content: [] } }),
}))

const realHttp = await import('src/utils/http.js')
const httpSnap = snapshotModuleExports(realHttp)
mock.module('src/utils/http.js', () => ({
  ...httpSnap,
  getWebFetchUserAgent: () => 'TestAgent/1.0',
}))

mock.module('src/utils/log.ts', logMock)

const realMcpOut = await import('src/utils/mcpOutputStorage.js')
const mcpOutSnap = snapshotModuleExports(realMcpOut)
mock.module('src/utils/mcpOutputStorage.js', () => ({
  ...mcpOutSnap,
  isBinaryContentType: (contentType: string) =>
    !contentType.toLowerCase().startsWith('text/'),
  persistBinaryContent: async () => ({
    filepath: '/tmp/webfetch-test.bin',
    size: 0,
  }),
}))

// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
import * as realSettings from 'src/utils/settings/settings.js'
const settingsSnap = snapshotModuleExports(realSettings)
mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => ({}),
    getSettings_DEPRECATED: () => ({ skipWebFetchPreflight: true }),
  }),
)
afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
  ])
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/api/claude.js', () => ({ ...claudeApiSnap }))
  mock.module('src/utils/http.js', () => ({ ...httpSnap }))
  mock.module('src/utils/mcpOutputStorage.js', () => ({ ...mcpOutSnap }))
  axiosHandle.useStubs = false
})

beforeEach(() => {
  getMock = async () => ({
    data: new TextEncoder().encode('hello').buffer,
    headers: { 'content-type': 'text/plain' },
    status: 200,
    statusText: 'OK',
  })
})

beforeAll(() => {
  axiosHandle.useStubs = true
})

describe('WebFetch response headers', () => {
  test('reads redirect Location from AxiosHeaders-style get()', async () => {
    getMock = async () => {
      const error = new Error('redirect') as MockAxiosError
      error.isAxiosError = true
      error.response = {
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'location' ? '/next' : undefined,
        },
        status: 302,
      }
      throw error
    }

    const { getWithPermittedRedirects } = await import('../utils')
    const result = await getWithPermittedRedirects(
      'https://example.com/old',
      new AbortController().signal,
      () => false,
    )

    expect(result).toEqual({
      type: 'redirect',
      originalUrl: 'https://example.com/old',
      redirectUrl: 'https://example.com/next',
      statusCode: 302,
    })
  })

  test('reads proxy block markers from normalized headers', async () => {
    getMock = async () => {
      const error = new Error('blocked') as MockAxiosError
      error.isAxiosError = true
      error.response = {
        headers: { 'x-proxy-error': 'blocked-by-allowlist' },
        status: 403,
      }
      throw error
    }

    const { getWithPermittedRedirects } = await import('../utils')

    await expect(
      getWithPermittedRedirects(
        'https://blocked.example/path',
        new AbortController().signal,
        () => false,
      ),
    ).rejects.toThrow('EGRESS_BLOCKED')
  })

  test('normalizes array content-type before cache and parsing', async () => {
    getMock = async () => ({
      data: new TextEncoder().encode('plain body').buffer,
      headers: { 'content-type': ['text/plain', 'charset=utf-8'] },
      status: 200,
      statusText: 'OK',
    })

    const { clearWebFetchCache, getURLMarkdownContent } = await import(
      '../utils'
    )
    clearWebFetchCache()

    const result = await getURLMarkdownContent(
      'https://example.com/plain.txt',
      new AbortController(),
    )

    expect('type' in result).toBe(false)
    if ('type' in result) {
      throw new Error('unexpected redirect result')
    }
    expect(result.content).toBe('plain body')
    expect(result.contentType).toBe('text/plain, charset=utf-8')
  })
})
