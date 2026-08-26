/**
 * densable 2.1.239 #7 — Bedrock stream Content-Type default + guard.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  applyBedrockStreamingContentType,
  BedrockUnexpectedContentTypeError,
  BEDROCK_EVENTSTREAM_CONTENT_TYPE,
} from '../bedrockContentTypeGuard.js'

const STREAM_URL =
  'https://bedrock-runtime.us-east-1.amazonaws.com/model/x/invoke-with-response-stream'

function streamResponse(headers?: HeadersInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers })
}

afterEach(() => {
  delete process.env.CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_DEFAULT
  delete process.env.CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_GUARD
})

describe('applyBedrockStreamingContentType densable 2.1.239', () => {
  test('missing content-type on bedrock stream → default eventstream', () => {
    const out = applyBedrockStreamingContentType(
      streamResponse(),
      STREAM_URL,
      'bedrock',
    )
    expect(out.headers.get('content-type')).toBe(
      BEDROCK_EVENTSTREAM_CONTENT_TYPE,
    )
  })

  test('wrong content-type throws BedrockUnexpectedContentTypeError', () => {
    expect(() =>
      applyBedrockStreamingContentType(
        streamResponse({ 'content-type': 'text/html' }),
        STREAM_URL,
        'bedrock',
      ),
    ).toThrow(BedrockUnexpectedContentTypeError)
  })

  test('already eventstream passes through', () => {
    const out = applyBedrockStreamingContentType(
      streamResponse({ 'content-type': BEDROCK_EVENTSTREAM_CONTENT_TYPE }),
      STREAM_URL,
      'bedrock',
    )
    expect(out.headers.get('content-type')).toContain('vnd.amazon.eventstream')
  })

  test('non-bedrock or non-stream URL is unchanged', () => {
    const html = streamResponse({ 'content-type': 'text/html' })
    expect(
      applyBedrockStreamingContentType(
        html,
        STREAM_URL,
        'firstParty',
      ).headers.get('content-type'),
    ).toBe('text/html')
    expect(
      applyBedrockStreamingContentType(
        html,
        'https://example.com/invoke',
        'bedrock',
      ).headers.get('content-type'),
    ).toBe('text/html')
  })
})
