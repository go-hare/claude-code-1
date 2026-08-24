/**
 * densable 2.1.234 #37 — UnexpectedApiResponseError (Pai) + Tbv/Sbv/OUf.
 */
import { describe, expect, test } from 'bun:test'
import {
  BODY_KIND_LABELS,
  classifyContentType,
  classifyServerHeader,
  classifyUnexpectedBody,
  describeUnexpectedApiResponse,
  isAnthropicMessageShape,
  parseAnthropicRequestId,
  UnexpectedApiResponseError,
} from '../unexpectedApiResponse.js'

describe('densable 2.1.234 #37 unexpectedApiResponse', () => {
  test('OUf isAnthropicMessageShape requires content+model+usage', () => {
    expect(isAnthropicMessageShape(null)).toBe(false)
    expect(isAnthropicMessageShape({})).toBe(false)
    expect(
      isAnthropicMessageShape({
        content: [],
        model: 'claude-sonnet-4-6',
        usage: {},
      }),
    ).toBe(true)
    expect(
      isAnthropicMessageShape({
        content: 'x',
        model: 'm',
        usage: {},
      }),
    ).toBe(false)
  })

  test('Sbv classifyUnexpectedBody covers empty/html/event-stream/json', () => {
    expect(classifyUnexpectedBody(null)).toBe('empty')
    expect(classifyUnexpectedBody('')).toBe('empty')
    expect(classifyUnexpectedBody('   ')).toBe('empty')
    expect(classifyUnexpectedBody('<html>oops</html>')).toBe('html')
    expect(classifyUnexpectedBody('<?xml version="1.0"?>')).toBe('xml')
    expect(classifyUnexpectedBody('event: message\ndata: {}\n\n')).toBe(
      'event-stream',
    )
    expect(classifyUnexpectedBody('{"ok":true}')).toBe('json-text')
    expect(classifyUnexpectedBody({ foo: 1 })).toBe('json-not-message')
    expect(BODY_KIND_LABELS.html).toBe('body is an HTML page')
  })

  test('ubv/pbv/rbv helpers', () => {
    expect(classifyContentType(undefined)).toBe('none')
    expect(classifyContentType('application/json; charset=utf-8')).toBe('json')
    expect(classifyContentType('text/event-stream')).toBe('event-stream')
    expect(classifyServerHeader(null)).toBe('absent')
    expect(classifyServerHeader('cloudflare')).toBe('cloudflare')
    expect(classifyServerHeader('nginx/1.25')).toBe('nginx')
    expect(parseAnthropicRequestId('req_abc-DEF_123')).toBe('req_abc-DEF_123')
    expect(parseAnthropicRequestId('not-a-req')).toBe(null)
  })

  test('Tbv summary embeds response + originating stall copy', () => {
    const headers = new Headers({
      'content-type': 'text/html',
      'content-length': '42',
      server: 'cloudflare',
      via: '1.1 proxy',
      'request-id': 'gateway-xyz',
    })
    const described = describeUnexpectedApiResponse({
      data: '<html>blocked</html>',
      status: 200,
      headers,
      originating: {
        requestId: 'req_stream1',
        cause: 'watchdog',
        errorName: 'Stream idle timeout - no chunks received',
        connectionCode: null,
        stall: {
          events_received: 0,
          ms_to_first_event: null,
          ms_since_last_event: null,
        },
      },
    })
    expect(described.bodyKind).toBe('html')
    expect(described.bodyBytes).toBe(Buffer.byteLength('<html>blocked</html>'))
    expect(described.summary).toContain('content-type html')
    expect(described.summary).toContain('body is an HTML page')
    expect(described.summary).toContain(
      'request-id present but not Anthropic-issued',
    )
    expect(described.summary).toContain('server cloudflare')
    expect(described.summary).toContain('intermediary headers')
    expect(described.summary).toContain(
      'This was the non-streaming retry of streaming request req_stream1',
    )
    expect(described.summary).toContain('0 stream events received')
  })

  test('Pai user message + short telemetryMessage', () => {
    const err = new UnexpectedApiResponseError({
      data: null,
      status: 502,
      headers: new Headers({ 'content-type': 'text/plain' }),
      originating: {
        requestId: null,
        cause: 'other',
        errorName: 'Error',
        connectionCode: 'ECONNRESET',
        stall: {
          events_received: 3,
          ms_to_first_event: 12,
          ms_since_last_event: 45000,
        },
      },
    })
    expect(err.name).toBe('UnexpectedApiResponseError')
    expect(err.telemetryMessage).toBe(
      'API returned an empty or malformed response',
    )
    expect(err.message).toContain(
      'API returned an empty or malformed response (HTTP 502)',
    )
    expect(err.message).toContain(
      'check for a proxy or gateway intercepting the request',
    )
    expect(err.message).toContain('(no Anthropic request-id)')
    expect(err.message).toContain('ECONNRESET')
    expect(err.message).toContain('3 stream events received')
    expect(err.message).toContain('first after 12 ms')
    expect(err.message).toContain('none in the final 45000 ms')
    expect(err.bodyKind).toBe('empty')
  })
})
