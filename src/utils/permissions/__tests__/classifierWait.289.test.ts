/**
 * densable 2.1.289 qdn wait branch. b1 reads x-cc-retry-after-too-long
 * on HTTP 429 or 529, in milliseconds.
 */
import { APIError } from '@anthropic-ai/sdk'
import { describe, expect, test } from 'bun:test'
import { buildClassifierUnavailableMessage } from '../../messages.js'
import { classifierRetryAfterMs } from '../yoloClassifier.js'

function apiError(status: number, headers: Headers): APIError {
  return new APIError(
    status,
    { type: 'error', error: { type: 'rate_limit_error', message: 'wait' } },
    'wait',
    headers,
  )
}

describe('classifier told-to-wait', () => {
  test('429 with the too-long header is milliseconds', () => {
    const headers = new Headers({ 'x-cc-retry-after-too-long': '2000' })
    expect(classifierRetryAfterMs(apiError(429, headers))).toBe(2000)
    expect(classifierRetryAfterMs(apiError(500, headers))).toBeUndefined()
    expect(classifierRetryAfterMs(apiError(429, new Headers()))).toBeUndefined()
  })

  test('short wait uses the qdn sentence and the rate-limit detail', () => {
    const text = buildClassifierUnavailableMessage(
      'Bash',
      'claude-opus',
      429,
      'http_429',
      2000,
    )
    expect(text).toContain(
      "The API told auto mode's safety classifier (claude-opus) to wait about 2 seconds from now (rate-limited)",
    )
    expect(text).toContain('try this action again once the wait is over')
    expect(text).not.toContain('Wait briefly')
  })

  test('a wait of 120000ms cannot be sat out inside the turn', () => {
    const text = buildClassifierUnavailableMessage(
      'Bash',
      'claude-opus',
      529,
      'http_529',
      120_000,
    )
    expect(text).toContain('about 2 minutes')
    expect(text).toContain('You cannot wait this out inside the turn')
    expect(text).toContain('(overloaded)')
  })

  test('no wait keeps the fail-closed unavailable sentence', () => {
    const text = buildClassifierUnavailableMessage('Bash', 'claude-opus', 401)
    expect(text).toContain('Wait briefly and then try this action again')
    expect(text).not.toContain('told auto mode')
  })
})
