import { describe, expect, test } from 'bun:test'

import {
  ACCOUNT_ON_HOLD_FALLBACK_URL,
  formatAccountOnHoldUseMessage,
  OAuthAccountOnHoldError,
} from '../../../utils/accountOnHold.js'
import {
  API_ERROR_MESSAGE_PREFIX,
  classifyAPIError,
  getAssistantMessageFromError,
  INVALID_API_KEY_ERROR_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL,
  INVALID_AUTH_TOKEN_ERROR_MESSAGE,
  INVALID_CUSTOM_HEADERS_ERROR_MESSAGE,
  INVALID_REQUEST_HEADER_ERROR_MESSAGE,
  isInvalidExternalCredentialSuffix,
  shouldRenderClientGeneratedErrorLine,
} from '../errors.js'
import {
  assertValidOutgoingHeaders,
  describeRejectedHeaderValue,
  InvalidRequestHeaderValueError,
} from '../invalidRequestHeader.js'

function textOf(
  assistant: ReturnType<typeof getAssistantMessageFromError>,
): string {
  const content = assistant.message.content
  if (!Array.isArray(content)) return String(content)
  const block = content.find(b => b.type === 'text')
  return block && 'text' in block ? block.text : ''
}

describe('densable 2.1.243 J$a / lb', () => {
  test('J$a matches official base + middot + message suffix', () => {
    expect(
      isInvalidExternalCredentialSuffix(
        `${INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL} · Invalid X-Api-Key header value.`,
      ),
    ).toBe(true)
    expect(
      isInvalidExternalCredentialSuffix(
        `${INVALID_AUTH_TOKEN_ERROR_MESSAGE} · Invalid Authorization header value.`,
      ),
    ).toBe(true)
    expect(
      isInvalidExternalCredentialSuffix(
        `${INVALID_CUSTOM_HEADERS_ERROR_MESSAGE} · Invalid value for distinct header 1 of 1.`,
      ),
    ).toBe(true)
    expect(
      isInvalidExternalCredentialSuffix(
        `${INVALID_REQUEST_HEADER_ERROR_MESSAGE} · Invalid request header value.`,
      ),
    ).toBe(true)
  })

  test('J$a is false for the bare base and unrelated text', () => {
    expect(
      isInvalidExternalCredentialSuffix(INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL),
    ).toBe(false)
    expect(isInvalidExternalCredentialSuffix('API Error: 401')).toBe(false)
    expect(
      isInvalidExternalCredentialSuffix(
        'Failed to authenticate. API Error: 401 Unauthorized',
      ),
    ).toBe(false)
  })

  test('Gx Kx gate is Rle || NR, not J$a', () => {
    expect(shouldRenderClientGeneratedErrorLine(true, 'hello')).toBe(true)
    expect(
      shouldRenderClientGeneratedErrorLine(
        false,
        `${API_ERROR_MESSAGE_PREFIX}: 401`,
      ),
    ).toBe(true)
    expect(
      shouldRenderClientGeneratedErrorLine(
        false,
        `${INVALID_AUTH_TOKEN_ERROR_MESSAGE} · bad token`,
      ),
    ).toBe(false)
    expect(shouldRenderClientGeneratedErrorLine(false, 'hello')).toBe(false)
  })

  test('lb /login and claude.ai map to Not logged in', () => {
    for (const source of ['/login managed key', 'claude.ai'] as const) {
      const err = new InvalidRequestHeaderValueError(
        'Invalid X-Api-Key header value from the saved /login API key.',
        'X-Api-Key',
        source,
      )
      const assistant = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
      expect(assistant.isApiErrorMessage).toBe(true)
      expect(textOf(assistant)).toBe(INVALID_API_KEY_ERROR_MESSAGE)
    }
  })

  test('lb builds base + middot + message for the four official bases', () => {
    const cases: Array<[InvalidRequestHeaderValueError, string]> = [
      [
        new InvalidRequestHeaderValueError(
          'Invalid Authorization header value from ANTHROPIC_AUTH_TOKEN.',
          'Authorization',
          'ANTHROPIC_AUTH_TOKEN',
        ),
        INVALID_AUTH_TOKEN_ERROR_MESSAGE,
      ],
      [
        new InvalidRequestHeaderValueError(
          'Invalid value for distinct header 1 of 1.',
          'other',
          'ANTHROPIC_CUSTOM_HEADERS',
        ),
        INVALID_CUSTOM_HEADERS_ERROR_MESSAGE,
      ],
      [
        new InvalidRequestHeaderValueError(
          'Invalid request header value.',
          'other',
          'claude-code',
        ),
        API_ERROR_MESSAGE_PREFIX,
      ],
      [
        new InvalidRequestHeaderValueError(
          'Invalid X-Api-Key header value from ANTHROPIC_API_KEY.',
          'X-Api-Key',
          'ANTHROPIC_API_KEY',
        ),
        INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL,
      ],
      [
        new InvalidRequestHeaderValueError(
          'Invalid request header value.',
          'other',
          'ANTHROPIC_API_KEY',
        ),
        INVALID_REQUEST_HEADER_ERROR_MESSAGE,
      ],
    ]
    for (const [err, base] of cases) {
      const assistant = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
      expect(assistant.isApiErrorMessage).toBe(true)
      expect(textOf(assistant)).toBe(`${base} · ${err.message}`)
      expect(isInvalidExternalCredentialSuffix(textOf(assistant))).toBe(
        base !== API_ERROR_MESSAGE_PREFIX,
      )
    }
  })

  test('mz describes a newline in the header value', () => {
    expect(describeRejectedHeaderValue('ok\nbad')).toContain('line break')
  })

  test('FTn throws lb for a rejected x-api-key', () => {
    expect(() =>
      assertValidOutgoingHeaders({
        apiKey: 'sk-\n-bad',
        getApiKeySource: () => 'ANTHROPIC_API_KEY',
        authToken: null,
        getAuthTokenSource: () => 'claude.ai',
        defaultHeaders: {},
        authorizationSource: null,
        customHeaderNames: [],
        envSuppliedHeaderNames: new Set(),
      }),
    ).toThrow(InvalidRequestHeaderValueError)
  })

  test('FTn throws lb for ANTHROPIC_CUSTOM_HEADERS value', () => {
    expect(() =>
      assertValidOutgoingHeaders({
        apiKey: null,
        getApiKeySource: () => 'none',
        authToken: null,
        getAuthTokenSource: () => 'claude.ai',
        defaultHeaders: { 'X-Bad': 'a\nb' },
        authorizationSource: null,
        customHeaderNames: ['X-Bad'],
        envSuppliedHeaderNames: new Set(),
      }),
    ).toThrow(/distinct header 1 of 1 parsed from ANTHROPIC_CUSTOM_HEADERS/)
  })

  test('zz classifies user-supplied lb', () => {
    expect(
      classifyAPIError(
        new InvalidRequestHeaderValueError('bad', 'other', 'ANTHROPIC_API_KEY'),
      ),
    ).toBe('invalid_request_header')
    expect(
      classifyAPIError(
        new InvalidRequestHeaderValueError(
          'bad',
          'X-Api-Key',
          'ANTHROPIC_API_KEY',
        ),
      ),
    ).toBe('invalid_api_key')
    expect(
      classifyAPIError(
        new InvalidRequestHeaderValueError('bad', 'other', 'claude-code'),
      ),
    ).not.toBe('invalid_request_header')
  })

  test('yz maps to account_on_hold + YOn(url) and classifies as auth_error', () => {
    const err = new OAuthAccountOnHoldError(ACCOUNT_ON_HOLD_FALLBACK_URL)
    const assistant = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    expect(assistant.isApiErrorMessage).toBe(true)
    expect(assistant.error).toBe('account_on_hold')
    expect(textOf(assistant)).toBe(
      formatAccountOnHoldUseMessage(ACCOUNT_ON_HOLD_FALLBACK_URL),
    )
    expect(classifyAPIError(err)).toBe('auth_error')
  })
})
