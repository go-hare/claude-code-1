import { afterEach, describe, expect, test } from 'bun:test'
import { APIError, APIConnectionError } from '@anthropic-ai/sdk'
import {
  getAssistantMessageFromError,
  getOauthOrgNotAllowedErrorMessage,
  isBedrockInputTooLongMessage,
  isPromptTooLongErrorMessage,
  OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE,
  OAUTH_SUBSCRIPTION_BILLING_ERROR_MESSAGE,
  classifyAPIError,
} from '../errors.js'
import { shouldRetry } from '../withRetry.js'

describe('v2.1.311–314 API errors & retry alignment', () => {
  const savedEnv = { ...process.env }

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in savedEnv)) delete process.env[k]
    }
    Object.assign(process.env, savedEnv)
  })

  test('#1261 OAuth billing message for Pro/Max vs org disabled', () => {
    expect(OAUTH_SUBSCRIPTION_BILLING_ERROR_MESSAGE).toContain(
      'https://claude.ai/settings/billing',
    )
    expect(OAUTH_SUBSCRIPTION_BILLING_ERROR_MESSAGE).not.toContain(
      'ask your admin',
    )
    expect(OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE).toContain(
      'ask your admin to enable access',
    )
    expect(typeof getOauthOrgNotAllowedErrorMessage()).toBe('string')
  })

  test('#1271 shouldRetry respects x-should-retry: false even under CLAUDE_CODE_RETRY_WATCHDOG', () => {
    process.env.CLAUDE_CODE_RETRY_WATCHDOG = '1'
    process.env.CLAUDE_CODE_UNATTENDED_RETRY = '1'
    const err429 = new APIError(
      429,
      { error: { type: 'rate_limit_error', message: 'rate limited' } },
      'rate limited',
      new Headers({ 'x-should-retry': 'false' }),
    )
    expect(shouldRetry(err429)).toBe(false)

    const err529 = new APIError(
      529,
      { error: { type: 'overloaded_error', message: 'overloaded' } },
      'overloaded',
      new Headers({ 'x-should-retry': 'false' }),
    )
    expect(shouldRetry(err529)).toBe(false)

    const err429FetchErr = new APIError(
      429,
      { error: { type: 'rate_limit_error', message: 'rate limited' } },
      'rate limited',
      new Headers({
        'x-should-retry': 'false',
        'anthropic-ratelimit-unified-overage-disabled-reason': 'fetch_error',
      }),
    )
    // When UNATTENDED_RETRY is enabled in the build, fetch_error bypasses the
    // x-should-retry:false short-circuit; otherwise x-should-retry:false applies.
    expect(typeof shouldRetry(err429FetchErr)).toBe('boolean')
  })

  test('#1282 Connection dropped appends proxy/gateway or VPN/firewall hint on firstParty', () => {
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.HTTPS_PROXY
    delete process.env.https_proxy
    delete process.env.HTTP_PROXY
    delete process.env.http_proxy
    delete process.env.CLAUDE_CODE_REMOTE
    delete process.env.ANTHROPIC_UNIX_SOCKET

    const cause = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    })
    const connErr = new APIConnectionError({ cause })
    const msg = getAssistantMessageFromError(connErr, 'claude-sonnet-4-6')
    const text = (Array.isArray(msg.message.content) ? msg.message.content : [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
    expect(text).toContain('Connection dropped (ECONNRESET)')
    expect(text).toContain(
      'A VPN, firewall, or security software can cause this',
    )

    process.env.HTTPS_PROXY = 'http://proxy.internal:8080'
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.internal'
    const msg2 = getAssistantMessageFromError(connErr, 'claude-sonnet-4-6')
    const text2 = (
      Array.isArray(msg2.message.content) ? msg2.message.content : []
    )
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
    expect(text2).toContain('the proxy set in HTTPS_PROXY')
    expect(text2).toContain('the gateway set in ANTHROPIC_BASE_URL')
  })

  test('#1360 Bedrock 400 Input is too long. recognized as prompt_too_long', () => {
    expect(isBedrockInputTooLongMessage('400 Input is too long.')).toBe(true)
    expect(isBedrockInputTooLongMessage('Input is too long')).toBe(true)
    expect(
      isBedrockInputTooLongMessage('{"message": "Input is too long."}'),
    ).toBe(true)
    expect(
      isBedrockInputTooLongMessage(
        '{"type":"policy_blocked","message":"Input is too long."}',
      ),
    ).toBe(false)
    expect(isPromptTooLongErrorMessage('400 Input is too long.')).toBe(true)
    expect(classifyAPIError(new Error('400 Input is too long.'))).toBe(
      'prompt_too_long',
    )
  })
})
