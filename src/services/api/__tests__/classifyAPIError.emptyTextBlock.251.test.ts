/**
 * densable 2.1.251 #11 pte — 400 empty text-block wording → empty_text_block.
 */
import { describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { classifyAPIError } from '../errors.js'

function api400(message: string): APIError {
  return new APIError(400, { message }, message, new Headers())
}

describe('densable 2.1.251 #11 classifyAPIError empty_text_block', () => {
  test('400 non-empty wording is empty_text_block', () => {
    expect(
      classifyAPIError(api400('text content blocks must be non-empty')),
    ).toBe('empty_text_block')
  })

  test('400 non-whitespace wording is empty_text_block', () => {
    expect(
      classifyAPIError(
        api400('text content blocks must contain non-whitespace text'),
      ),
    ).toBe('empty_text_block')
  })

  test('plain Error with the wording is not empty_text_block', () => {
    expect(
      classifyAPIError(new Error('text content blocks must be non-empty')),
    ).not.toBe('empty_text_block')
  })

  test('400 without the wording stays client_error', () => {
    expect(classifyAPIError(api400('bad request'))).toBe('client_error')
  })
})
