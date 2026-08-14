import { describe, expect, test } from 'bun:test'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
} from '@anthropic-ai/sdk'
import { BodyIdleTimeoutError } from 'src/utils/bodyIdleWatchdog.js'
import { classifyAPIError } from '../errors.js'

/**
 * densable 2.1.232 #26 / YLr:
 *   P5p(e) || Error.message.startsWith("Stream idle timeout") → "api_timeout"
 * so Bedrock/Vertex/gateway stream-idle recover paths tag as timeout (retryable).
 */
describe('classifyAPIError stream idle → api_timeout (densable YLr)', () => {
  test('Stream idle timeout - no chunks received', () => {
    expect(
      classifyAPIError(new Error('Stream idle timeout - no chunks received')),
    ).toBe('api_timeout')
  })

  test('Stream idle timeout - partial response received', () => {
    expect(
      classifyAPIError(
        new Error('Stream idle timeout - partial response received'),
      ),
    ).toBe('api_timeout')
  })

  test('APIConnectionTimeoutError', () => {
    expect(
      classifyAPIError(new APIConnectionTimeoutError({ message: 'timed out' })),
    ).toBe('api_timeout')
  })

  test('APIConnectionError with timeout in message', () => {
    expect(
      classifyAPIError(
        new APIConnectionError({ message: 'connection timeout after 30s' }),
      ),
    ).toBe('api_timeout')
  })

  test('BodyIdleTimeoutError (byte-stream idle)', () => {
    expect(classifyAPIError(new BodyIdleTimeoutError(180_000))).toBe(
      'api_timeout',
    )
  })

  test('does not match unrelated idle wording', () => {
    expect(classifyAPIError(new Error('session idle'))).not.toBe('api_timeout')
  })
})
