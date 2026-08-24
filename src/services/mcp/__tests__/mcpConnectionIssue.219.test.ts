/**
 * densable 2.1.219 #8 — fSp / mSp / pSp MCP connection issue formatting.
 */
import { describe, expect, test } from 'bun:test'
import {
  extractMcpConnectionErrorCode,
  formatFailedMcpIssue,
  formatFailedMcpReconnectIssue,
  formatMcpErrorCode,
  HIDDEN_MCP_ERROR_CODES,
  sanitizeMcpIssueText,
} from '../mcpConnectionIssue.js'

describe('densable 2.1.219 fSp formatMcpErrorCode', () => {
  test('maps MCP timeout code 23', () => {
    expect(formatMcpErrorCode('23')).toBe('request timed out')
  })

  test('maps HTTP status codes 100-599', () => {
    expect(formatMcpErrorCode('404')).toBe('HTTP 404')
    expect(formatMcpErrorCode('503')).toBe('HTTP 503')
    expect(formatMcpErrorCode('100')).toBe('HTTP 100')
    expect(formatMcpErrorCode('599')).toBe('HTTP 599')
  })

  test('passes through non-HTTP codes', () => {
    expect(formatMcpErrorCode('ECONNREFUSED')).toBe('ECONNREFUSED')
    expect(formatMcpErrorCode('ENOENT')).toBe('ENOENT')
    expect(formatMcpErrorCode('99')).toBe('99')
  })
})

describe('densable 2.1.219 mSp formatFailedMcpIssue', () => {
  test('formats HTTP code with error message', () => {
    expect(
      formatFailedMcpIssue({
        errorCode: '503',
        error: 'Service Unavailable',
      }),
    ).toBe('HTTP 503: Service Unavailable')
  })

  test('formats code alone when no error', () => {
    expect(formatFailedMcpIssue({ errorCode: '404' })).toBe('HTTP 404')
  })

  test('appends displayDetail', () => {
    expect(
      formatFailedMcpIssue({
        errorCode: '502',
        error: 'Bad Gateway',
        displayDetail: 'Error detail: upstream',
      }),
    ).toBe('HTTP 502: Bad Gateway Error detail: upstream')
  })

  test('hides pSp codes from prefix but keeps error text', () => {
    for (const code of HIDDEN_MCP_ERROR_CODES) {
      const out = formatFailedMcpIssue({
        errorCode: code,
        error: 'config problem',
      })
      expect(out).toBe('config problem')
      expect(out.includes(code)).toBe(false)
    }
  })

  test('hidden code with only errorCode falls back to code string', () => {
    expect(formatFailedMcpIssue({ errorCode: 'INVALID_CONFIG' })).toBe(
      'INVALID_CONFIG',
    )
  })

  test('error-only failed (no code)', () => {
    expect(formatFailedMcpIssue({ error: 'spawn ENOENT' })).toBe('spawn ENOENT')
  })

  test('empty when no fields', () => {
    expect(formatFailedMcpIssue({})).toBe('')
  })

  test('redacts bearer tokens', () => {
    const out = formatFailedMcpIssue({
      error: 'Authorization Bearer sk-abcdefghijklmnopqrstuvwxyz rejected',
    })
    expect(out).toContain('Bearer [redacted]')
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
  })
})

describe('densable 2.1.219 Ujo formatFailedMcpReconnectIssue', () => {
  test('includes URL origin only for non-hidden codes (densable #13 cHr)', () => {
    expect(
      formatFailedMcpReconnectIssue({
        errorCode: '503',
        config: {
          url: 'https://user:secret@mcp.example.com/v1/mcp?token=abc',
        },
      }),
    ).toBe('HTTP 503 at https://mcp.example.com')
  })

  test('hidden codes return error text', () => {
    expect(
      formatFailedMcpReconnectIssue({
        errorCode: 'ENDPOINT_NOT_FOUND',
        error: 'MCP endpoint not found',
        config: { url: 'https://x' },
      }),
    ).toBe('MCP endpoint not found')
  })
})

describe('densable 2.1.219 extractMcpConnectionErrorCode', () => {
  test('stringifies numeric HTTP code', () => {
    expect(extractMcpConnectionErrorCode({ code: 401 })).toBe('401')
  })

  test('maps http 404 without session to ENDPOINT_NOT_FOUND', () => {
    expect(
      extractMcpConnectionErrorCode(
        { code: 404 },
        { transportType: 'http', hasSessionId: false },
      ),
    ).toBe('ENDPOINT_NOT_FOUND')
  })

  test('keeps 404 when session present', () => {
    expect(
      extractMcpConnectionErrorCode(
        { code: 404 },
        { transportType: 'http', hasSessionId: true },
      ),
    ).toBe('404')
  })
})

describe('densable 2.1.219 sanitizeMcpIssueText', () => {
  test('collapses whitespace', () => {
    expect(sanitizeMcpIssueText('a\n\n  b\t\tc')).toBe('a b c')
  })
})
