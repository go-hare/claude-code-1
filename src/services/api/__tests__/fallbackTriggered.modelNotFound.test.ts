/**
 * Official densable dXH / qF3 parity — model_not_found reason on
 * FallbackTriggeredError and detector for 404 not_found_error + model:.
 */
import { describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import {
  FallbackTriggeredError,
  isModelNotFoundAPIError,
} from '../withRetry.js'

function makeApiError(
  status: number,
  message: string,
  body?: Record<string, unknown>,
): APIError {
  return APIError.generate(
    status,
    body ?? { type: 'not_found_error', message },
    message,
    new Headers(),
  )
}

describe('FallbackTriggeredError reason', () => {
  test('defaults to overloaded (529 capacity path)', () => {
    const e = new FallbackTriggeredError('a', 'b')
    expect(e.reason).toBe('overloaded')
    expect(e.originalModel).toBe('a')
    expect(e.fallbackModel).toBe('b')
  })

  test('accepts model_not_found for permanent primary failure', () => {
    const e = new FallbackTriggeredError('gone', 'sonnet', 'model_not_found')
    expect(e.reason).toBe('model_not_found')
  })
})

describe('isModelNotFoundAPIError (official qF3)', () => {
  test('true for 404 not_found_error body mentioning model:', () => {
    const err = makeApiError(
      404,
      'model: claude-bad-xyz',
      { type: 'not_found_error', message: 'model: claude-bad-xyz' },
    )
    expect(isModelNotFoundAPIError(err)).toBe(true)
  })

  test('true when message string embeds not_found_error JSON and model:', () => {
    // SDK may stringify the API body into message; official qF3 scans message.
    const err = Object.assign(
      makeApiError(404, 'x', { type: 'error' }),
      {
        message:
          '404 {"type":"not_found_error","message":"model: retired-model"}',
        error: {
          type: 'not_found_error',
          message: 'model: retired-model',
        },
      },
    )
    expect(isModelNotFoundAPIError(err)).toBe(true)
  })

  test('false for 404 without model: marker', () => {
    const err = makeApiError(404, 'resource missing', {
      type: 'not_found_error',
      message: 'resource missing',
    })
    expect(isModelNotFoundAPIError(err)).toBe(false)
  })

  test('false for non-404', () => {
    const err = makeApiError(529, 'overloaded', { type: 'overloaded_error' })
    expect(isModelNotFoundAPIError(err)).toBe(false)
  })

  test('false for plain Error', () => {
    expect(isModelNotFoundAPIError(new Error('model: foo'))).toBe(false)
  })
})
