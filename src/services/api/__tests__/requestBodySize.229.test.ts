/**
 * densable 2.1.229 #20 — messages alone >32MB: fail once with clear copy
 * (no media-strip / compaction retry).
 */
import { describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { API_REQUEST_BODY_MAX_SIZE } from 'src/constants/apiLimits.js'
import {
  getAssistantMessageFromError,
  getRequestTooLargeErrorMessage,
  isMediaSizeErrorMessage,
} from '../errors.js'
import {
  classifyRequestBodySize,
  formatUnrecoverableRequestBodyErrorDetails,
  formatUnrecoverableRequestTooLargeMessage,
  measureBodyBytesInMessagesForAPI,
  measureMediaBytesInMessagesForAPI,
} from '../requestBodySize.js'

function make413(message = 'request entity too large'): APIError {
  return new APIError(413, { message }, message, new Headers())
}

function userTextMessage(text: string) {
  return {
    type: 'user' as const,
    message: { role: 'user' as const, content: [{ type: 'text', text }] },
  }
}

function userWithImage(dataLen: number) {
  return {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'x'.repeat(dataLen),
          },
        },
      ],
    },
  }
}

describe('densable 2.1.229 #20 classifyRequestBodySize (fwp)', () => {
  test('empty conversation → compactable', () => {
    const m = classifyRequestBodySize([])
    expect(m.kind).toBe('compactable')
    expect(m.mediaBytes).toBe(0)
    expect(m.limitBytes).toBe(API_REQUEST_BODY_MAX_SIZE)
  })

  test('text-only under limit → compactable', () => {
    const msgs = [userTextMessage('hello world')]
    const m = classifyRequestBodySize(msgs)
    expect(m.kind).toBe('compactable')
    expect(m.mediaBytes).toBe(0)
    expect(m.bodyBytes).toBeGreaterThan(0)
  })

  test('media present under non-media limit → strippable_media', () => {
    const msgs = [userWithImage(1000)]
    const m = classifyRequestBodySize(msgs)
    expect(m.mediaBytes).toBeGreaterThan(0)
    expect(m.kind).toBe('strippable_media')
  })

  test('non-media body alone over limit → unrecoverable', () => {
    // ~40MB of text JSON → body - media > 32MB
    const huge = 'Z'.repeat(40 * 1024 * 1024)
    const msgs = [userTextMessage(huge)]
    const m = classifyRequestBodySize(msgs)
    expect(m.mediaBytes).toBe(0)
    expect(m.bodyBytes - m.mediaBytes).toBeGreaterThan(
      API_REQUEST_BODY_MAX_SIZE,
    )
    expect(m.kind).toBe('unrecoverable')
  })

  test('media measured only from user image/document blocks', () => {
    const msgs = [
      userTextMessage('hi'),
      userWithImage(50),
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant' as const,
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'y' },
            },
          ],
        },
      },
    ]
    expect(measureMediaBytesInMessagesForAPI(msgs)).toBeGreaterThan(0)
    // assistant image must not count toward mediaBytes (cLb is user-only)
    const userOnly = measureMediaBytesInMessagesForAPI([msgs[1]!])
    expect(measureMediaBytesInMessagesForAPI(msgs)).toBe(userOnly)
    expect(measureBodyBytesInMessagesForAPI(msgs)).toBeGreaterThan(userOnly)
  })
})

describe('densable 2.1.229 #20 unrecoverable copy (hwp / _wp)', () => {
  test('hwp mentions cannot make it fit + interactive/non-interactive tails', () => {
    const measure = {
      kind: 'unrecoverable' as const,
      bodyBytes: 40 * 1024 * 1024,
      mediaBytes: 0,
      limitBytes: API_REQUEST_BODY_MAX_SIZE,
    }
    const interactive = formatUnrecoverableRequestTooLargeMessage(
      measure,
      false,
    )
    expect(interactive).toContain("Request too large for the API's")
    expect(interactive).toContain(
      'none of it is images or documents that could be removed',
    )
    expect(interactive).toContain(
      'removing attachments or compacting cannot make it fit',
    )
    expect(interactive).toContain('Double press esc')
    expect(interactive).toContain('/clear')

    const nonInteractive = formatUnrecoverableRequestTooLargeMessage(
      measure,
      true,
    )
    expect(nonInteractive).toContain('Reduce the input')
    expect(nonInteractive).toContain('cannot continue as is')
    expect(nonInteractive).not.toContain('Double press esc')
  })

  test('_wp errorDetails is request_body_over_limit (not request_too_large)', () => {
    const details = formatUnrecoverableRequestBodyErrorDetails({
      kind: 'unrecoverable',
      bodyBytes: 40000000,
      mediaBytes: 0,
      limitBytes: API_REQUEST_BODY_MAX_SIZE,
    })
    expect(details).toContain('request_body_over_limit:')
    expect(details).toContain('messages only')
    expect(details).not.toContain('request_too_large')
  })
})

describe('densable 2.1.229 #20 getAssistantMessageFromError 413 wire', () => {
  test('generic 413 still uses X8i + request_too_large (media-size retryable)', () => {
    const assistant = getAssistantMessageFromError(
      make413('entity too large'),
      'claude-sonnet-4-6',
    )
    expect(assistant.message.content?.[0]).toMatchObject({
      type: 'text',
      text: getRequestTooLargeErrorMessage(),
    })
    expect(String(assistant.errorDetails)).toContain('request_too_large:')
    expect(isMediaSizeErrorMessage(assistant)).toBe(true)
  })

  test('unrecoverable messages-only → hwp + no media-size strip path', () => {
    const huge = 'Q'.repeat(40 * 1024 * 1024)
    const messagesForAPI = [userTextMessage(huge)]
    const assistant = getAssistantMessageFromError(
      make413('entity too large'),
      'claude-sonnet-4-6',
      { messagesForAPI },
    )
    const text =
      (assistant.message.content?.[0] as { text?: string })?.text ?? ''
    expect(text).toContain("Request too large for the API's")
    expect(text).toContain('cannot make it fit')
    expect(String(assistant.errorDetails)).toContain('request_body_over_limit:')
    // Must NOT be classified as media-size (reactive compact strip+retry)
    expect(isMediaSizeErrorMessage(assistant)).toBe(false)
  })

  test('strippable media 413 keeps request_too_large for strip retry', () => {
    const messagesForAPI = [userWithImage(2000)]
    const assistant = getAssistantMessageFromError(
      make413('entity too large'),
      'claude-sonnet-4-6',
      { messagesForAPI },
    )
    expect(String(assistant.errorDetails)).toContain('request_too_large:')
    expect(isMediaSizeErrorMessage(assistant)).toBe(true)
    const text =
      (assistant.message.content?.[0] as { text?: string })?.text ?? ''
    expect(text).toContain('is images or documents')
  })
})
