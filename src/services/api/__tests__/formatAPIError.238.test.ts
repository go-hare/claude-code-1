/**
 * densable 2.1.238 #17 — T9r named connection copy.
 * Does not change STREAM_NETWORK_DOWN_CODES / F4y.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import type { APIError } from '@anthropic-ai/sdk'
import { formatAPIError } from '../errorUtils.js'

const CLAUDE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../claude.ts'),
  'utf8',
)

function asAPIError(
  message: string,
  extras: {
    code?: string
    cause?: unknown
    status?: number
    error?: unknown
  } = {},
): APIError {
  const err = new Error(
    message,
    extras.cause ? { cause: extras.cause } : undefined,
  )
  if (extras.code !== undefined) {
    Object.assign(err, { code: extras.code })
  }
  if (extras.status !== undefined) {
    Object.assign(err, { status: extras.status })
  }
  if (extras.error !== undefined) {
    Object.assign(err, { error: extras.error })
  }
  return err as unknown as APIError
}

function wrapConnection(code: string): APIError {
  const cause = Object.assign(new Error('underlying'), { code })
  return asAPIError('Connection error.', { cause })
}

describe('densable 2.1.238 #17 formatAPIError T9r', () => {
  test('ERR_PROXY_TUNNEL names the proxy', () => {
    expect(formatAPIError(wrapConnection('ERR_PROXY_TUNNEL'))).toBe(
      "Couldn't connect through your proxy (ERR_PROXY_TUNNEL)",
    )
  })

  test('ECONNREFUSED names firewall/proxy', () => {
    expect(formatAPIError(wrapConnection('ECONNREFUSED'))).toBe(
      'Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)',
    )
  })

  test('ConnectionRefused aliases ECONNREFUSED', () => {
    expect(formatAPIError(wrapConnection('ConnectionRefused'))).toBe(
      'Connection refused — a firewall or proxy may be blocking it (ConnectionRefused)',
    )
  })

  test('DNS / open-socket codes', () => {
    expect(formatAPIError(wrapConnection('ENOTFOUND'))).toBe(
      "Can't reach the API server — check your internet or DNS (ENOTFOUND)",
    )
    expect(formatAPIError(wrapConnection('EAI_AGAIN'))).toBe(
      "Can't reach the API server — check your internet or DNS (EAI_AGAIN)",
    )
    expect(formatAPIError(wrapConnection('FailedToOpenSocket'))).toBe(
      "Can't reach the API server — check your internet or DNS (FailedToOpenSocket)",
    )
  })

  test('no-route codes', () => {
    expect(formatAPIError(wrapConnection('ENETUNREACH'))).toBe(
      'No internet route — check your connection or VPN (ENETUNREACH)',
    )
    expect(formatAPIError(wrapConnection('EHOSTDOWN'))).toBe(
      'No internet route — check your connection or VPN (EHOSTDOWN)',
    )
  })

  test('dropped-socket codes', () => {
    expect(formatAPIError(wrapConnection('ECONNRESET'))).toBe(
      'Connection dropped (ECONNRESET)',
    )
    expect(formatAPIError(wrapConnection('ConnectionClosed'))).toBe(
      'Connection dropped (ConnectionClosed)',
    )
    expect(formatAPIError(wrapConnection('UND_ERR_SOCKET'))).toBe(
      'Connection dropped (UND_ERR_SOCKET)',
    )
  })

  test('unknown errno stays generic with code', () => {
    expect(formatAPIError(wrapConnection('EFOO'))).toBe(
      'Unable to connect to API (EFOO)',
    )
  })

  test('Connection error. without code', () => {
    expect(formatAPIError(asAPIError('Connection error.'))).toBe(
      'Unable to connect to API. Check your internet connection',
    )
  })

  test('StreamSuspended sleep copy', () => {
    expect(
      formatAPIError(asAPIError('sleep', { code: 'StreamSuspended' })),
    ).toBe('Connection lost while your computer was asleep')
  })

  test('BedrockUnexpectedContentType keeps inner message', () => {
    expect(
      formatAPIError(
        asAPIError('got text/html', {
          code: 'BedrockUnexpectedContentType',
        }),
      ),
    ).toBe('got text/html')
  })

  test('AWS cred wrapper unwraps inner cause', () => {
    const inner = new Error('  The security token is invalid.  ')
    expect(
      formatAPIError(
        asAPIError(
          'Failed to resolve AWS credentials from the credential provider chain.',
          { cause: inner },
        ),
      ),
    ).toBe('The security token is invalid.')
  })

  test('nested JSON body with status', () => {
    expect(
      formatAPIError(
        asAPIError('{"type":"error"}', {
          status: 401,
          error: { error: { message: 'invalid x-api-key' } },
        }),
      ),
    ).toBe('401 invalid x-api-key')
  })

  test('STREAM_NETWORK_DOWN_CODES still includes ERR_PROXY_TUNNEL (no F4y / new cause)', () => {
    const start = CLAUDE_SRC.indexOf('const STREAM_NETWORK_DOWN_CODES')
    expect(start).toBeGreaterThan(0)
    const block = CLAUDE_SRC.slice(start, CLAUDE_SRC.indexOf('])', start) + 2)
    expect(block).toContain("'ERR_PROXY_TUNNEL'")
    expect(CLAUDE_SRC).not.toContain('asset_proxy_refused')
  })
})
