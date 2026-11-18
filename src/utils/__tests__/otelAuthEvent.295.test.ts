import { describe, expect, test } from 'bun:test'
import { categorizeAuthError, logOTelAuthEvent } from '../sessionSlots.js'

describe('v2.1.295 #428 claude_code.auth OpenTelemetry event', () => {
  test('categorizeAuthError classifies auth, timeout, network, http, and other', () => {
    expect(
      categorizeAuthError({ isAxiosError: true, response: { status: 403 } }),
    ).toEqual({ kind: 'auth', status: 403 })
    expect(
      categorizeAuthError({ isAxiosError: true, code: 'ECONNABORTED' }),
    ).toEqual({ kind: 'timeout', status: undefined })
    expect(
      categorizeAuthError({ isAxiosError: true, code: 'ENOTFOUND' }),
    ).toEqual({ kind: 'network', status: undefined })
    expect(
      categorizeAuthError({ isAxiosError: true, response: { status: 502 } }),
    ).toEqual({ kind: 'http', status: 502 })
    expect(categorizeAuthError(new Error('boom'))).toEqual({ kind: 'other' })
  })

  test('logOTelAuthEvent runs cleanly for login and logout', () => {
    expect(() =>
      logOTelAuthEvent({
        action: 'login',
        success: true,
        authMethod: 'oauth',
      }),
    ).not.toThrow()
    expect(() =>
      logOTelAuthEvent({
        action: 'login',
        success: false,
        authMethod: 'oauth',
        error: { isAxiosError: true, response: { status: 401 } },
      }),
    ).not.toThrow()
  })
})
