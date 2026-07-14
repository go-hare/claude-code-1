/**
 * Official 2.1.206: tool-call 401 reauth_retry decision (E0i + headersHelper).
 * Pure mirror — avoids process-global mock.module pollution of client.ts.
 */
import { describe, expect, test } from 'bun:test'

type ServerCfg = {
  type?: string
  headersHelper?: string
  url?: string
}

/**
 * Mirrors the McpAuthError recovery gate in fetchToolsForClient tool.call:
 * allow one reconnect when headersHelper is set, or when OAuth storage still
 * holds a refresh_token for http/sse (and not headersHelper).
 */
function shouldAuthReconnectOnce(opts: {
  isAuthError: boolean
  retriesUsed: number
  maxRetries: number
  config: ServerCfg
  hasRefreshToken: boolean
}): { retry: boolean; kind?: 'headersHelper' | 'oauth' } {
  if (!opts.isAuthError || opts.retriesUsed >= opts.maxRetries) {
    return { retry: false }
  }
  const transport =
    opts.config.type === 'http' ||
    opts.config.type === 'sse' ||
    opts.config.type === 'ws'
  if (transport && opts.config.headersHelper) {
    return { retry: true, kind: 'headersHelper' }
  }
  if (
    (opts.config.type === 'http' || opts.config.type === 'sse') &&
    !opts.config.headersHelper &&
    !!opts.config.url &&
    opts.hasRefreshToken
  ) {
    return { retry: true, kind: 'oauth' }
  }
  return { retry: false }
}

describe('MCP 401 reauth_retry gate (2.1.206)', () => {
  test('headersHelper on http retries once', () => {
    expect(
      shouldAuthReconnectOnce({
        isAuthError: true,
        retriesUsed: 0,
        maxRetries: 1,
        config: {
          type: 'http',
          headersHelper: 'mint-token.sh',
          url: 'https://x',
        },
        hasRefreshToken: false,
      }),
    ).toEqual({ retry: true, kind: 'headersHelper' })
  })

  test('oauth refresh_token on sse retries once', () => {
    expect(
      shouldAuthReconnectOnce({
        isAuthError: true,
        retriesUsed: 0,
        maxRetries: 1,
        config: { type: 'sse', url: 'https://mcp.example' },
        hasRefreshToken: true,
      }),
    ).toEqual({ retry: true, kind: 'oauth' })
  })

  test('oauth without refresh_token does not retry', () => {
    expect(
      shouldAuthReconnectOnce({
        isAuthError: true,
        retriesUsed: 0,
        maxRetries: 1,
        config: { type: 'http', url: 'https://mcp.example' },
        hasRefreshToken: false,
      }),
    ).toEqual({ retry: false })
  })

  test('second auth error does not retry again', () => {
    expect(
      shouldAuthReconnectOnce({
        isAuthError: true,
        retriesUsed: 1,
        maxRetries: 1,
        config: { type: 'http', headersHelper: 'h', url: 'https://x' },
        hasRefreshToken: true,
      }),
    ).toEqual({ retry: false })
  })

  test('headersHelper takes precedence over oauth path messaging', () => {
    // Even if a refresh token exists, headersHelper servers use helper re-mint.
    expect(
      shouldAuthReconnectOnce({
        isAuthError: true,
        retriesUsed: 0,
        maxRetries: 1,
        config: {
          type: 'http',
          headersHelper: 'h',
          url: 'https://x',
        },
        hasRefreshToken: true,
      }),
    ).toEqual({ retry: true, kind: 'headersHelper' })
  })
})
