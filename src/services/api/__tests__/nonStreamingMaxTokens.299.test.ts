import { describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import {
  buildCutShortErrorForMessage,
  buildCutShortErrorForNonStreamingResponse,
} from '../claude.js'
import { classifyAPIError } from '../errors.js'

describe('non-streaming max_tokens cut-short error (#689)', () => {
  test('buildCutShortErrorForNonStreamingResponse emits max_output_tokens for stop_reason=max_tokens', () => {
    const err = buildCutShortErrorForNonStreamingResponse(
      { stop_reason: 'max_tokens', usage: { output_tokens: 21333 } },
      64000,
    )
    expect(err).toBeDefined()
    expect(err?.apiError).toBe('max_output_tokens')
    expect(err?.error).toBe('max_output_tokens')
    const content = err?.message.content
    const text = Array.isArray(content) ? content[0] : undefined
    expect(typeof text === 'object' && text !== null && text.type).toBe('text')
    if (typeof text === 'object' && text !== null && text.type === 'text') {
      expect(text.text).toContain(
        '64000 output token maximum for a request sent without streaming',
      )
    }
  })

  test('buildCutShortErrorForNonStreamingResponse returns undefined for end_turn', () => {
    const err = buildCutShortErrorForNonStreamingResponse(
      { stop_reason: 'end_turn', usage: { output_tokens: 100 } },
      64000,
    )
    expect(err).toBeUndefined()
  })

  test('buildCutShortErrorForMessage handles model_context_window_exceeded', () => {
    const err = buildCutShortErrorForMessage(
      'model_context_window_exceeded',
      8000,
      1200,
    )
    expect(err).toBeDefined()
    expect(err?.apiError).toBe('max_output_tokens')
    const content = err?.message.content
    const text = Array.isArray(content) ? content[0] : undefined
    if (typeof text === 'object' && text !== null && text.type === 'text') {
      expect(text.text).toContain('context window limit')
    }
  })
})

describe('classifyAPIError image_unprocessable (#630)', () => {
  test('400 Could not process image classifies as image_unprocessable', () => {
    const err = new APIError(
      400,
      { type: 'invalid_request_error', message: 'Could not process image' },
      'Could not process image',
      new Headers(),
    )
    expect(classifyAPIError(err)).toBe('image_unprocessable')
  })
})
