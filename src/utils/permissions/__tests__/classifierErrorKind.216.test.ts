/**
 * densable 2.1.216 — fO_ / mO_ / Mhd classifier errorKind helpers
 */
import { describe, expect, test } from 'bun:test'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk'
import {
  allowClassifierModelDemotion,
  classifyClassifierErrorKind,
  isTransientClassifierErrorKind,
} from '../yoloClassifier.js'
import {
  buildClassifierUnavailableMessage,
  buildHandoffClassifierUnavailableMessage,
  formatClassifierUnavailableDetail,
} from '../../messages.js'

describe('classifyClassifierErrorKind densable fO_', () => {
  test('abort → wall_clock_timeout', () => {
    expect(classifyClassifierErrorKind(new APIUserAbortError())).toBe(
      'wall_clock_timeout',
    )
  })

  test('APIConnectionTimeoutError → connection_timeout', () => {
    expect(
      classifyClassifierErrorKind(
        new APIConnectionTimeoutError({ message: 'timeout' }),
      ),
    ).toBe('connection_timeout')
  })

  test('APIConnectionError → connection_error', () => {
    expect(
      classifyClassifierErrorKind(
        new APIConnectionError({ message: 'conn', cause: undefined }),
      ),
    ).toBe('connection_error')
  })

  test('APIError 401 → http_401', () => {
    const err = new APIError(
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'x' } },
      'expired',
      new Headers(),
    )
    expect(classifyClassifierErrorKind(err)).toBe('http_401')
  })

  test('APIError with x-should-retry false → http_${status}_no_retry', () => {
    const headers = new Headers({ 'x-should-retry': 'false' })
    const err = new APIError(
      500,
      { type: 'error', error: { type: 'api_error', message: 'x' } },
      'boom',
      headers,
    )
    expect(classifyClassifierErrorKind(err)).toBe('http_500_no_retry')
  })

  test('APIError 429 → http_429', () => {
    const err = new APIError(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'x' } },
      'rl',
      new Headers(),
    )
    expect(classifyClassifierErrorKind(err)).toBe('http_429')
  })
})

describe('isTransientClassifierErrorKind densable mO_', () => {
  test('timeouts + connection_error are transient', () => {
    expect(isTransientClassifierErrorKind('wall_clock_timeout')).toBe(true)
    expect(isTransientClassifierErrorKind('connection_timeout')).toBe(true)
    expect(isTransientClassifierErrorKind('connection_error')).toBe(true)
  })

  test('429 and 5xx are transient', () => {
    expect(isTransientClassifierErrorKind('http_429')).toBe(true)
    expect(isTransientClassifierErrorKind('http_500')).toBe(true)
    expect(isTransientClassifierErrorKind('http_503')).toBe(true)
  })

  test('401 is NOT transient', () => {
    expect(isTransientClassifierErrorKind('http_401')).toBe(false)
    expect(isTransientClassifierErrorKind('http_401_no_retry')).toBe(false)
  })

  test('undefined / other not transient', () => {
    expect(isTransientClassifierErrorKind(undefined)).toBe(false)
    expect(isTransientClassifierErrorKind('other')).toBe(false)
    expect(isTransientClassifierErrorKind('http_400')).toBe(false)
  })
})

describe('allowClassifierModelDemotion densable Mhd', () => {
  test('excludes /^http_401/', () => {
    expect(allowClassifierModelDemotion('http_401')).toBe(false)
    expect(allowClassifierModelDemotion('http_401_no_retry')).toBe(false)
  })

  test('allows other defined kinds', () => {
    expect(allowClassifierModelDemotion('http_429')).toBe(true)
    expect(allowClassifierModelDemotion('http_500')).toBe(true)
    expect(allowClassifierModelDemotion('connection_error')).toBe(true)
  })

  test('undefined → false', () => {
    expect(allowClassifierModelDemotion(undefined)).toBe(false)
  })
})

describe('hUd / f6d / CYu densable messages', () => {
  test('f6d empty body in 2.1.216', () => {
    expect(formatClassifierUnavailableDetail(401, 'http_401')).toBe('')
  })

  test('hUd does not invent HTTP 401 user text', () => {
    const msg = buildClassifierUnavailableMessage(
      'Bash',
      'claude-sonnet',
      401,
      'http_401',
    )
    expect(msg).toContain('claude-sonnet is temporarily unavailable')
    expect(msg).toContain('Bash')
    expect(msg).not.toContain('HTTP 401')
    expect(msg).toContain(
      'so auto mode cannot determine the safety of Bash right now',
    )
  })

  test('CYu handoff allow-with-warning shape', () => {
    const msg = buildHandoffClassifierUnavailableMessage(
      'claude-sonnet',
      401,
      'http_401',
    )
    expect(msg).toContain('claude-sonnet (the safety classifier)')
    expect(msg).toContain('was unavailable')
    expect(msg).toContain("subagent's work")
    expect(msg).not.toContain('HTTP 401')
  })
})
