/**
 * densable 2.1.212 #33 — multi-image 413 "Request too large" copy + classification.
 */
import { describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { API_REQUEST_BODY_MAX_SIZE } from 'src/constants/apiLimits.js'
import { formatFileSize } from 'src/utils/format.js'
import {
  getAssistantMessageFromError,
  getRequestTooLargeErrorMessage,
  isMediaSizeErrorMessage,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
} from '../errors.js'

function make413(message: string): APIError {
  return new APIError(413, { message }, message, new Headers())
}

describe('densable #33 Request too large (X8i / 413)', () => {
  test('X8i copy uses 32MB (R5i) and multi-image guidance', () => {
    const msg = getRequestTooLargeErrorMessage()
    expect(msg).toContain(`max ${formatFileSize(API_REQUEST_BODY_MAX_SIZE)}`)
    expect(msg).toContain('32')
    expect(msg).toContain('Accumulated images and attachments')
    // must NOT still claim the old PDF_TARGET 20MB single-file wording only
    expect(msg).not.toMatch(/Try with a smaller file\.?$/)
  })

  test('413 without context window → X8i + request_too_large errorDetails', () => {
    const err = make413('request entity too large')
    const assistant = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    expect(assistant.isApiErrorMessage).toBe(true)
    expect(assistant.message.content?.[0]).toMatchObject({
      type: 'text',
      text: getRequestTooLargeErrorMessage(),
    })
    expect(String(assistant.errorDetails)).toContain('request_too_large:')
    expect(String(assistant.errorDetails)).toContain('request entity too large')
    expect(isMediaSizeErrorMessage(assistant)).toBe(true)
  })

  test('413 with context window → prompt_too_long (W3), not X8i', () => {
    const err = make413('exceeds context window size')
    const assistant = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    expect(assistant.message.content?.[0]).toMatchObject({
      type: 'text',
      text: PROMPT_TOO_LONG_ERROR_MESSAGE,
    })
    expect(String(assistant.errorDetails)).toContain('context window')
    expect(isMediaSizeErrorMessage(assistant)).toBe(false)
  })

  test('API_REQUEST_BODY_MAX_SIZE is densable R5i 32MiB', () => {
    expect(API_REQUEST_BODY_MAX_SIZE).toBe(33554432)
  })
})
