import { describe, expect, test, mock } from 'bun:test'

;(globalThis as { MACRO?: { VERSION?: string; BUILD_TIME?: string } }).MACRO ??=
  {
    VERSION: '2.1.300',
    BUILD_TIME: '2026-11-18T00:00:00Z',
  }

const loggedOTelEvents: Array<{ name: string; attrs: Record<string, string> }> =
  []

mock.module('../../../utils/telemetry/events.js', () => ({
  logOTelEvent: async (name: string, attrs: Record<string, string>) => {
    loggedOTelEvents.push({ name, attrs })
  },
}))

import { logAPISuccessAndDuration } from '../logging.js'

describe('api_request OTel cache_creation 5m/1h breakdown (#756)', () => {
  test('emits cache_creation_5m_tokens and cache_creation_1h_tokens', () => {
    loggedOTelEvents.length = 0
    logAPISuccessAndDuration({
      model: 'claude-sonnet-4-5',
      preNormalizedModel: 'claude-sonnet-4-5',
      start: 0,
      startIncludingRetries: 0,
      ttftMs: 50,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40,
        cache_creation: {
          ephemeral_5m_input_tokens: 25,
          ephemeral_1h_input_tokens: 15,
        },
      } as never,
      attempt: 1,
      messageCount: 1,
      messageTokens: 100,
      requestId: 'req_123',
      stopReason: 'end_turn',
      didFallBackToNonStreaming: false,
      querySource: 'repl_main_thread',
      costUSD: 0.01,
      permissionMode: 'default',
    })

    const apiReq = loggedOTelEvents.find(e => e.name === 'api_request')
    expect(apiReq).toBeDefined()
    expect(apiReq?.attrs.cache_creation_5m_tokens).toBe('25')
    expect(apiReq?.attrs.cache_creation_1h_tokens).toBe('15')
  })

  test('defaults cache_creation_5m_tokens and cache_creation_1h_tokens to 0 when absent', () => {
    loggedOTelEvents.length = 0
    logAPISuccessAndDuration({
      model: 'claude-sonnet-4-5',
      preNormalizedModel: 'claude-sonnet-4-5',
      start: 0,
      startIncludingRetries: 0,
      ttftMs: 50,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      } as never,
      attempt: 1,
      messageCount: 1,
      messageTokens: 100,
      requestId: 'req_124',
      stopReason: 'end_turn',
      didFallBackToNonStreaming: false,
      querySource: 'repl_main_thread',
      costUSD: 0.01,
      permissionMode: 'default',
    })

    const apiReq = loggedOTelEvents.find(e => e.name === 'api_request')
    expect(apiReq).toBeDefined()
    expect(apiReq?.attrs.cache_creation_5m_tokens).toBe('0')
    expect(apiReq?.attrs.cache_creation_1h_tokens).toBe('0')
  })
})
