/**
 * densable 2.1.219 #7 — mid-stream partial finalize code sets + extract.
 */
import { describe, expect, test } from 'bun:test'
import { APIConnectionError } from '@anthropic-ai/sdk'
import { extractConnectionErrorDetails } from '../errorUtils.js'
import { API_ERROR_MESSAGE_PREFIX } from '../errors.js'
import { NO_CONTENT_MESSAGE } from 'src/constants/messages.js'

/**
 * densable zie / Kie — keep in lockstep with claude.ts STREAM_*_CODES.
 * Duplicated here so the unit test does not import the heavy claude module.
 */
const STREAM_NETWORK_DOWN_CODES = new Set([
  'ECONNREFUSED',
  'ConnectionRefused',
  'ENOTFOUND',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'EAI_AGAIN',
  'FailedToOpenSocket',
  'ERR_PROXY_TUNNEL',
])

const STREAM_STALE_CONNECTION_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ConnectionClosed',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ERR_SOCKET_CLOSED',
  'StreamSuspended',
])

function classifyCause(
  code: string | undefined,
): 'network_down' | 'stale_connection' {
  if (code !== undefined && STREAM_NETWORK_DOWN_CODES.has(code)) {
    return 'network_down'
  }
  return 'stale_connection'
}

function incompleteBanner(opts: {
  hasOutput: boolean
  streamIdleAborted: boolean
  isServerApiError: boolean
}): string {
  const { hasOutput, streamIdleAborted, isServerApiError } = opts
  if (hasOutput) {
    if (streamIdleAborted) {
      return `${API_ERROR_MESSAGE_PREFIX}: Response stalled mid-stream. The response above may be incomplete.`
    }
    if (isServerApiError) {
      return `${API_ERROR_MESSAGE_PREFIX}: Server error mid-response. The response above may be incomplete.`
    }
    return `${API_ERROR_MESSAGE_PREFIX}: Connection closed mid-response. The response above may be incomplete.`
  }
  if (streamIdleAborted) {
    return `${API_ERROR_MESSAGE_PREFIX}: Response stalled while thinking, before producing a response. Try again.`
  }
  return `${API_ERROR_MESSAGE_PREFIX}: Connection closed while thinking, before producing a response. Try again.`
}

describe('densable 2.1.219 #7 mid-stream partial finalize', () => {
  test('zie classifies network-down codes', () => {
    expect(classifyCause('ECONNREFUSED')).toBe('network_down')
    expect(classifyCause('ENOTFOUND')).toBe('network_down')
    expect(classifyCause('EAI_AGAIN')).toBe('network_down')
    expect(classifyCause('ERR_PROXY_TUNNEL')).toBe('network_down')
  })

  test('Kie classifies stale connection codes', () => {
    expect(classifyCause('ECONNRESET')).toBe('stale_connection')
    expect(classifyCause('ConnectionClosed')).toBe('stale_connection')
    expect(classifyCause('StreamSuspended')).toBe('stale_connection')
    expect(classifyCause('EPIPE')).toBe('stale_connection')
  })

  test('extractConnectionErrorDetails walks cause for ECONNRESET', () => {
    const cause = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    })
    const err = new APIConnectionError({ message: 'Connection error.', cause })
    const d = extractConnectionErrorDetails(err)
    expect(d?.code).toBe('ECONNRESET')
    expect(STREAM_STALE_CONNECTION_CODES.has(d!.code)).toBe(true)
    expect(STREAM_NETWORK_DOWN_CODES.has(d!.code)).toBe(false)
  })

  test('incomplete banners match densable copy', () => {
    expect(
      incompleteBanner({
        hasOutput: true,
        streamIdleAborted: true,
        isServerApiError: false,
      }),
    ).toBe(
      'API Error: Response stalled mid-stream. The response above may be incomplete.',
    )
    expect(
      incompleteBanner({
        hasOutput: true,
        streamIdleAborted: false,
        isServerApiError: true,
      }),
    ).toBe(
      'API Error: Server error mid-response. The response above may be incomplete.',
    )
    expect(
      incompleteBanner({
        hasOutput: true,
        streamIdleAborted: false,
        isServerApiError: false,
      }),
    ).toBe(
      'API Error: Connection closed mid-response. The response above may be incomplete.',
    )
    expect(
      incompleteBanner({
        hasOutput: false,
        streamIdleAborted: true,
        isServerApiError: false,
      }),
    ).toBe(
      'API Error: Response stalled while thinking, before producing a response. Try again.',
    )
    expect(
      incompleteBanner({
        hasOutput: false,
        streamIdleAborted: false,
        isServerApiError: false,
      }),
    ).toBe(
      'API Error: Connection closed while thinking, before producing a response. Try again.',
    )
  })

  test('NO_CONTENT_MESSAGE is the empty-text sentinel', () => {
    expect(NO_CONTENT_MESSAGE).toBe('(no content)')
  })
})
