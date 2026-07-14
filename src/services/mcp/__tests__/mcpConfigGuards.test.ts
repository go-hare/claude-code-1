import { describe, expect, test } from 'bun:test'

/**
 * Lightweight mirrors of official 2.1.200 / 2.1.202 config guards.
 * Full parseMcpConfig pulls a large module graph; these tests lock the
 * precedence / error shape we care about.
 */

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : []
}

function describeUrlWithoutTypeError(
  entry: unknown,
  name: string,
): {
  message: string
  suggestion?: string
} {
  if (
    entry &&
    typeof entry === 'object' &&
    entry !== null &&
    'url' in entry &&
    !('type' in entry)
  ) {
    return {
      message: `MCP server "${name}" has "url" but no "type"`,
      suggestion:
        'Add "type": "http" (or "sse" / "ws") for remote servers. Example: { "type": "http", "url": "..." }',
    }
  }
  return { message: 'Does not adhere to MCP server configuration schema' }
}

describe('disabledMcpServers / enabledMcpServers array guard (2.1.200)', () => {
  test('non-array becomes empty', () => {
    expect(asStringArray(undefined)).toEqual([])
    expect(asStringArray(null)).toEqual([])
    expect(asStringArray('bad')).toEqual([])
    expect(asStringArray({ foo: 1 })).toEqual([])
  })

  test('filters non-string entries', () => {
    expect(asStringArray(['a', 1, 'b', null, 'c'])).toEqual(['a', 'b', 'c'])
  })

  test('includes works after coercion', () => {
    const disabled = asStringArray(undefined as unknown)
    expect(disabled.includes('foo')).toBe(false)
    const enabled = asStringArray(['chrome'])
    expect(enabled.includes('chrome')).toBe(true)
  })
})

describe('url without type error message (2.1.202)', () => {
  test('detects url-only entry', () => {
    const err = describeUrlWithoutTypeError(
      { url: 'https://example.com/mcp' },
      'my-server',
    )
    expect(err.message).toContain('has "url" but no "type"')
    expect(err.suggestion).toContain('"type": "http"')
  })

  test('ignores proper http entry', () => {
    const err = describeUrlWithoutTypeError(
      { type: 'http', url: 'https://example.com/mcp' },
      'my-server',
    )
    expect(err.message).toBe(
      'Does not adhere to MCP server configuration schema',
    )
    expect(err.suggestion).toBeUndefined()
  })
})

/**
 * Official 2.1.206 RAn: request_timeout_ms folds into timeout when unset,
 * capped at 300_000. Explicit timeout wins.
 */
const MCP_REQUEST_TIMEOUT_MS_CAP = 300_000

function foldRequestTimeoutMs(value: {
  timeout?: number
  request_timeout_ms?: number
  [key: string]: unknown
}): { timeout?: number; [key: string]: unknown } {
  const { request_timeout_ms, ...rest } = value
  if (rest.timeout === undefined && request_timeout_ms !== undefined) {
    return {
      ...rest,
      timeout: Math.min(request_timeout_ms, MCP_REQUEST_TIMEOUT_MS_CAP),
    }
  }
  return rest
}

describe('request_timeout_ms fold (2.1.206)', () => {
  test('folds into timeout when timeout unset', () => {
    expect(
      foldRequestTimeoutMs({
        type: 'http',
        url: 'https://x',
        request_timeout_ms: 12_000,
      }),
    ).toEqual({ type: 'http', url: 'https://x', timeout: 12_000 })
  })

  test('caps at 300_000', () => {
    expect(
      foldRequestTimeoutMs({
        type: 'sse',
        url: 'https://x',
        request_timeout_ms: 999_999,
      }).timeout,
    ).toBe(300_000)
  })

  test('explicit timeout wins', () => {
    expect(
      foldRequestTimeoutMs({
        type: 'http',
        url: 'https://x',
        timeout: 5_000,
        request_timeout_ms: 60_000,
      }),
    ).toEqual({ type: 'http', url: 'https://x', timeout: 5_000 })
  })
})
