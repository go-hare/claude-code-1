import { describe, expect, test } from 'bun:test'
import {
  AUTH_CODE_REFUSED_MESSAGE,
  AuthCodeRefusedError,
  isInvalidGrantOAuthError,
} from '../ConsoleOAuthFlow.js'
import { AxiosError, AxiosHeaders } from 'axios'

describe('v2.1.311 #1284 ConsoleOAuthFlow pasted code refused', () => {
  test('AuthCodeRefusedError carries SEA qBe message', () => {
    const err = new AuthCodeRefusedError()
    expect(err.name).toBe('AuthCodeRefusedError')
    expect(err.message).toBe(AUTH_CODE_REFUSED_MESSAGE)
    expect(err.message).toContain('expired, already used')
    expect(err.message).toContain('Sign in again to get a new code')
  })

  test('isInvalidGrantOAuthError detects 400/401 invalid_grant AxiosError and AuthCodeRefusedError', () => {
    expect(isInvalidGrantOAuthError(new AuthCodeRefusedError())).toBe(true)
    const axiosErr = new AxiosError(
      'Request failed with status code 400',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status: 400,
        statusText: 'Bad Request',
        headers: new AxiosHeaders(),
        config: { headers: new AxiosHeaders() },
        data: { error: 'invalid_grant' },
      },
    )
    expect(isInvalidGrantOAuthError(axiosErr)).toBe(true)

    const axios500 = new AxiosError(
      'Request failed with status code 500',
      'ERR_BAD_RESPONSE',
      undefined,
      undefined,
      {
        status: 500,
        statusText: 'Server Error',
        headers: new AxiosHeaders(),
        config: { headers: new AxiosHeaders() },
        data: { error: 'invalid_grant' },
      },
    )
    expect(isInvalidGrantOAuthError(axios500)).toBe(false)
  })
})
