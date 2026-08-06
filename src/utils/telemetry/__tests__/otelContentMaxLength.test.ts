import { describe, expect, test } from 'bun:test'
import {
  getOTelContentMaxLength,
  OTEL_CONTENT_TRUNCATE_LIMIT,
  truncateOTelContent,
} from '../events.js'

describe('getOTelContentMaxLength (densable Ptg)', () => {
  test('defaults to 61440', () => {
    expect(getOTelContentMaxLength({} as NodeJS.ProcessEnv)).toBe(
      OTEL_CONTENT_TRUNCATE_LIMIT,
    )
  })

  test('honors CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH', () => {
    expect(
      getOTelContentMaxLength({
        CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH: '1024',
      } as NodeJS.ProcessEnv),
    ).toBe(1024)
  })

  test('mins with OTEL attribute limits', () => {
    expect(
      getOTelContentMaxLength({
        CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH: '10000',
        OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT: '500',
        OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT: '800',
      } as NodeJS.ProcessEnv),
    ).toBe(500)
  })
})

describe('truncateOTelContent (densable W1)', () => {
  test('uses dynamic KB marker for large limits', () => {
    const limit = 2048
    const big = 'x'.repeat(limit + 50)
    const out = truncateOTelContent(big, limit)
    expect(out.truncated).toBe(true)
    expect(out.content).toContain('[TRUNCATED - Content exceeds 2KB limit]')
    expect(out.content.length).toBe(limit)
  })

  test('uses character marker when limit < 1024', () => {
    const limit = 100
    const out = truncateOTelContent('y'.repeat(200), limit)
    expect(out.truncated).toBe(true)
    expect(out.content).toContain(
      '[TRUNCATED - Content exceeds 100 character limit]',
    )
    expect(out.content.length).toBe(limit)
  })

  test('when marker alone exceeds limit, returns raw slice', () => {
    const limit = 10
    const out = truncateOTelContent('abcdefghijklmnop', limit)
    expect(out.truncated).toBe(true)
    expect(out.content).toBe('abcdefghij')
    expect(out.content).not.toContain('TRUNCATED')
  })
})
