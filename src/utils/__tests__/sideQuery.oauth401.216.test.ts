/**
 * densable 2.1.216 — sideQuery OAuth 401 recover + single rebuild+retry.
 * Event: tengu_oauth_401_sidequery_recovered { querySource, httpStatus }
 *
 * Mock only auth recover surface + client; snapshot real modules to avoid
 * process-global mock.module pollution (getRateLimitTier etc.).
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { logMock } from '../../../tests/mocks/log'
import { debugMock } from '../../../tests/mocks/debug'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const analyticsSnap = snapshotModuleExports(
  await import('src/services/analytics/index.js'),
)
const authSnap = snapshotModuleExports(await import('src/utils/auth.js'))
const clientSnap = snapshotModuleExports(
  await import('src/services/api/client.js'),
)
const providersSnap = snapshotModuleExports(
  await import('src/utils/model/providers.js'),
)
const betasSnap = snapshotModuleExports(await import('src/utils/betas.js'))
const claudeApiSnap = snapshotModuleExports(
  await import('src/services/api/claude.js'),
)
const systemSnap = snapshotModuleExports(
  await import('src/constants/system.js'),
)
const langfuseSnap = snapshotModuleExports(
  await import('src/services/langfuse/index.js'),
)

const loggedEvents: Array<{ name: string; props: Record<string, unknown> }> = []

let createCallCount = 0
let handleOAuthCalls: string[] = []
let recoverResult = true
let accessToken: string | null = 'tok_expired'
let clientSeq = 0

mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: (name: string, props: Record<string, unknown>) => {
    loggedEvents.push({ name, props })
  },
  logEventAsync: async () => {},
  stripProtoFields: <V>(v: V) => v,
  attachAnalyticsSink: () => {},
  _resetForTesting: () => {},
}))

mock.module('src/utils/auth.js', () => ({
  ...authSnap,
  getClaudeAIOAuthTokens: () =>
    accessToken
      ? {
          accessToken,
          refreshToken: 'r',
          expiresAt: Date.now() + 60_000,
          scopes: ['user:inference'],
        }
      : null,
  handleOAuth401Error: async (failed: string) => {
    handleOAuthCalls.push(failed)
    if (recoverResult) {
      accessToken = 'tok_fresh'
    }
    return recoverResult
  },
  clearRemoteAuthFailExitTimer: () => {},
  isClaudeAISubscriber: () => true,
}))

mock.module('src/services/api/client.js', () => ({
  ...clientSnap,
  getAnthropicClient: async () => {
    const id = ++clientSeq
    return {
      beta: {
        messages: {
          create: async () => {
            createCallCount++
            if (id === 1) {
              throw new APIError(
                401,
                {
                  type: 'error',
                  error: {
                    type: 'authentication_error',
                    message: 'token expired',
                  },
                },
                'OAuth token has expired',
                new Headers(),
              )
            }
            return {
              id: 'msg_ok',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'ok' }],
              model: 'claude-test',
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
              _request_id: 'req_ok',
            }
          },
        },
      },
    }
  },
}))

mock.module('src/utils/model/providers.js', () => ({
  ...providersSnap,
  getAPIProvider: () => 'firstParty',
}))

mock.module('src/utils/betas.js', () => ({
  ...betasSnap,
  getModelBetas: () => [],
  modelSupportsStructuredOutputs: () => false,
}))

mock.module('src/services/api/claude.js', () => ({
  ...claudeApiSnap,
  getAPIMetadata: () => ({}),
}))

mock.module('src/constants/system.js', () => ({
  ...systemSnap,
  getAttributionHeader: () => '',
  getCLISyspromptPrefix: () => '',
}))

mock.module('src/services/langfuse/index.js', () => ({
  ...langfuseSnap,
  createTrace: () => null,
  createChildSpan: () => null,
  endTrace: () => {},
  recordLLMObservation: () => {},
}))

afterAll(() => {
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/utils/auth.js', () => ({ ...authSnap }))
  mock.module('src/services/api/client.js', () => ({ ...clientSnap }))
  mock.module('src/utils/model/providers.js', () => ({ ...providersSnap }))
  mock.module('src/utils/betas.js', () => ({ ...betasSnap }))
  mock.module('src/services/api/claude.js', () => ({ ...claudeApiSnap }))
  mock.module('src/constants/system.js', () => ({ ...systemSnap }))
  mock.module('src/services/langfuse/index.js', () => ({ ...langfuseSnap }))
})

const { sideQuery } = await import('../sideQuery.js')

describe('sideQuery densable 2.1.216 OAuth 401 recover', () => {
  beforeEach(() => {
    createCallCount = 0
    handleOAuthCalls = []
    recoverResult = true
    accessToken = 'tok_expired'
    clientSeq = 0
    loggedEvents.length = 0
  })

  test('401 with accessToken snapshot → recover → rebuild → retry + event', async () => {
    const res = await sideQuery({
      querySource: 'auto_mode',
      model: 'claude-test',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      maxRetries: 0,
      skipSystemPromptPrefix: true,
    })
    expect(res.id).toBe('msg_ok')
    expect(handleOAuthCalls).toEqual(['tok_expired'])
    expect(createCallCount).toBe(2)
    const recovered = loggedEvents.find(
      e => e.name === 'tengu_oauth_401_sidequery_recovered',
    )
    expect(recovered).toBeTruthy()
    expect(recovered?.props.querySource).toBe('auto_mode')
    expect(recovered?.props.httpStatus).toBe(401)
  })

  test('unrecoverable 401 rethrows original error (no recovered event)', async () => {
    recoverResult = false
    await expect(
      sideQuery({
        querySource: 'auto_mode',
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 16,
        maxRetries: 0,
        skipSystemPromptPrefix: true,
      }),
    ).rejects.toMatchObject({ status: 401 })
    expect(createCallCount).toBe(1)
    expect(
      loggedEvents.some(e => e.name === 'tengu_oauth_401_sidequery_recovered'),
    ).toBe(false)
  })

  test('aborted signal skips recover path', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(
      sideQuery({
        querySource: 'auto_mode',
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 16,
        maxRetries: 0,
        signal: ac.signal,
        skipSystemPromptPrefix: true,
      }),
    ).rejects.toMatchObject({ status: 401 })
    expect(handleOAuthCalls).toEqual([])
  })

  test('no access token snapshot skips recover', async () => {
    accessToken = null
    await expect(
      sideQuery({
        querySource: 'permission_explainer',
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 16,
        maxRetries: 0,
        skipSystemPromptPrefix: true,
      }),
    ).rejects.toMatchObject({ status: 401 })
    expect(handleOAuthCalls).toEqual([])
  })
})
