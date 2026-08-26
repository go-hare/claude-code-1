/**
 * densable 2.1.239 leftover — tpw raw wrap + binary notes.
 * Q2r is identity (not ported).
 */
import { describe, expect, test } from 'bun:test'
import { FETCHED_WEB_CONTENT_TAG } from '../../AgentTool/built-in/webFetchAgent.js'
import {
  contentTypeToken,
  formatWebFetchBinaryNote,
  httpStatusText,
  wrapRawFetchedWebContent,
} from '../rawWrap.js'

describe('densable 2.1.239 WebFetch raw wrap leftover', () => {
  test('syl / Nhr gold', () => {
    expect(contentTypeToken('text/markdown; charset=utf-8')).toBe(
      'text/markdown',
    )
    expect(contentTypeToken('not-a-mime')).toBe('unknown content type')
    expect(httpStatusText(200)).toBe('OK')
    expect(httpStatusText(999)).toBe('Unknown Status')
  })

  test('tpw wraps untrusted body and quote rules when not preapproved', async () => {
    const out = await wrapRawFetchedWebContent({
      url: 'https://example.com/page',
      code: 200,
      contentType: 'text/html; charset=utf-8',
      content: '# hello',
      isPreapproved: false,
      summarizeRemainder: async () => {
        throw new Error('should not summarize short pages')
      },
    })
    expect(out).toContain(
      'Fetched https://example.com/page (HTTP 200 OK, text/html, 7 characters).',
    )
    expect(out).toContain('UNTRUSTED web content')
    expect(out).toContain(
      `These reporting rules come from the WebFetch tool, not from the page`,
    )
    expect(out).toContain('125-character maximum')
    expect(out).toContain(`<${FETCHED_WEB_CONTENT_TAG}>`)
    expect(out).toContain('# hello')
    expect(out).toContain(`</${FETCHED_WEB_CONTENT_TAG}>`)
  })

  test('tpw omits quote rules when preapproved', async () => {
    const out = await wrapRawFetchedWebContent({
      url: 'https://docs.python.org/3/',
      code: 200,
      contentType: 'text/markdown',
      content: 'docs',
      isPreapproved: true,
      summarizeRemainder: async () => '',
    })
    expect(out).not.toContain(
      'These reporting rules come from the WebFetch tool',
    )
    expect(out).toContain('4 characters')
  })

  test('binary note hides path for web-fetch agent', () => {
    const agent = formatWebFetchBinaryNote(
      true,
      'application/pdf',
      2048,
      '/tmp/secret.pdf',
    )
    expect(agent).toContain('was saved to a local file for the caller')
    expect(agent).not.toContain('/tmp/secret.pdf')
    const parent = formatWebFetchBinaryNote(
      false,
      'application/pdf',
      2048,
      '/tmp/secret.pdf',
    )
    expect(parent).toContain('also saved to /tmp/secret.pdf')
  })
})
