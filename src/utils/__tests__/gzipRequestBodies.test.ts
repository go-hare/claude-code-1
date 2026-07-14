import { describe, expect, test } from 'bun:test'
import {
  applyGzipRequestBodyInit,
  isGzipRequestBodiesEnabled,
  isGzipRequestBodyUrlEligible,
  padGzipRequestBody,
} from '../gzipRequestBodies.js'

describe('isGzipRequestBodiesEnabled', () => {
  test('env forces on', () => {
    expect(
      isGzipRequestBodiesEnabled({
        env: { CLAUDE_CODE_GZIP_REQUEST_BODIES: '1' },
        gbValue: false,
      }),
    ).toBe(true)
  })
  test('env forces off', () => {
    expect(
      isGzipRequestBodiesEnabled({
        env: { CLAUDE_CODE_GZIP_REQUEST_BODIES: '0' },
        gbValue: true,
      }),
    ).toBe(false)
  })
  test('gb when env unset', () => {
    expect(isGzipRequestBodiesEnabled({ env: {}, gbValue: true })).toBe(true)
  })
})

describe('isGzipRequestBodyUrlEligible', () => {
  test('only api.anthropic.com', () => {
    expect(
      isGzipRequestBodyUrlEligible('https://api.anthropic.com/v1/messages'),
    ).toBe(true)
    expect(
      isGzipRequestBodyUrlEligible(
        'https://bedrock-runtime.us-east-1.amazonaws.com/x',
      ),
    ).toBe(false)
  })
})

describe('applyGzipRequestBodyInit', () => {
  test('sets compress and pads string body when gate on', () => {
    const init = applyGzipRequestBodyInit(
      'https://api.anthropic.com/v1/messages',
      { body: '{"a":1}', method: 'POST' },
      { env: { CLAUDE_CODE_GZIP_REQUEST_BODIES: '1' }, gbValue: false },
    )
    expect(init).toBeDefined()
    expect((init as { compress?: string }).compress).toBe('gzip')
    expect(typeof init?.body).toBe('string')
    expect(String(init?.body).startsWith('{"a":1} ')).toBe(true)
    expect(String(init?.body).length).toBeGreaterThan('{"a":1}'.length)
  })

  test('no-op when gate off', () => {
    const orig = { body: '{"a":1}' }
    const init = applyGzipRequestBodyInit(
      'https://api.anthropic.com/v1/messages',
      orig,
      { env: {}, gbValue: false },
    )
    expect(init).toBe(orig)
  })

  test('pad length is body + space + 0..256', () => {
    const padded = padGzipRequestBody('x')
    expect(padded.startsWith('x ')).toBe(true)
    // 'x' + ' ' + 0..256 pad chars
    expect(padded.length).toBeGreaterThanOrEqual(2)
    expect(padded.length).toBeLessThanOrEqual(1 + 1 + 256)
  })
})
