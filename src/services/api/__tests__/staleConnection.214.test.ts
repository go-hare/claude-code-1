/**
 * densable 2.1.214 #18/#46 — ConnectionClosed + always disableKeepAlive.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { APIConnectionError } from '@anthropic-ai/sdk'
import { extractConnectionErrorDetails } from '@ant/model-provider'
import { SOCKET_CONNECTION_CLOSED_PREFIX } from '@ant/model-provider'
import {
  _resetKeepAliveForTesting,
  disableKeepAlive,
  getProxyFetchOptions,
} from 'src/utils/proxy.js'

// Avoid loading full withRetry graph for unit classification — re-test T2 + keepalive path.

describe('densable T2 extractConnectionErrorDetails ConnectionClosed', () => {
  test('maps Bun socket-closed message', () => {
    const err = new Error(
      `${SOCKET_CONNECTION_CLOSED_PREFIX}. For more information, pass verbose`,
    )
    const d = extractConnectionErrorDetails(err)
    expect(d?.code).toBe('ConnectionClosed')
    expect(d?.isSSLError).toBe(false)
  })

  test('still prefers errno code when present', () => {
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' })
    const d = extractConnectionErrorDetails(err)
    expect(d?.code).toBe('ECONNRESET')
  })

  test('walks cause chain for message prefix', () => {
    const root = new Error(`${SOCKET_CONNECTION_CLOSED_PREFIX} mid stream`)
    const wrap = new Error('Connection error.', { cause: root })
    const d = extractConnectionErrorDetails(wrap)
    expect(d?.code).toBe('ConnectionClosed')
  })
})

describe('densable #46 disableKeepAlive sticky', () => {
  beforeEach(() => {
    _resetKeepAliveForTesting()
  })
  afterEach(() => {
    _resetKeepAliveForTesting()
  })

  test('getProxyFetchOptions sets keepalive:false after disable', () => {
    expect(getProxyFetchOptions().keepalive).toBeUndefined()
    disableKeepAlive()
    expect(getProxyFetchOptions().keepalive).toBe(false)
  })
})

describe('APIConnectionError + ConnectionClosed classification shape', () => {
  test('APIConnectionError with cause code is extractable', () => {
    const cause = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    })
    const err = new APIConnectionError({ message: 'Connection error.', cause })
    const d = extractConnectionErrorDetails(err)
    expect(d?.code).toBe('ECONNRESET')
  })
})
