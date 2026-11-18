import { describe, expect, test } from 'bun:test'
import { formatToken } from '../markdown.js'

describe('markdown codespan OSC 8 hyperlink (#913)', () => {
  test('wraps HTTP/HTTPS URL in codespan with OSC 8 hyperlink when linkCap is true', () => {
    const out = formatToken(
      {
        type: 'codespan',
        raw: '`https://example.com/very/long/path`',
        text: 'https://example.com/very/long/path',
      },
      'dark',
      0,
      null,
      null,
      null,
      { linkCap: true },
    )
    expect(out).toContain('\x1b]8;;https://example.com/very/long/path\x07')
    expect(out).toContain('\x1b]8;;\x07')
  })

  test('does not wrap when linkCap is false, promptMode is true, or windowed is true', () => {
    const token = {
      type: 'codespan' as const,
      raw: '`https://example.com`',
      text: 'https://example.com',
    }
    expect(
      formatToken(token, 'dark', 0, null, null, null, { linkCap: false }),
    ).not.toContain('\x1b]8;;')
    expect(
      formatToken(token, 'dark', 0, null, null, null, {
        linkCap: true,
        promptMode: true,
      }),
    ).not.toContain('\x1b]8;;')
    expect(
      formatToken(token, 'dark', 0, null, null, null, {
        linkCap: true,
        windowed: true,
      }),
    ).not.toContain('\x1b]8;;')
  })

  test('does not wrap non-URL codespans or codespans inside a link parent', () => {
    expect(
      formatToken(
        { type: 'codespan', raw: '`foo.bar`', text: 'foo.bar' },
        'dark',
        0,
        null,
        null,
        null,
        {
          linkCap: true,
        },
      ),
    ).not.toContain('\x1b]8;;')

    expect(
      formatToken(
        {
          type: 'codespan',
          raw: '`https://example.com`',
          text: 'https://example.com',
        },
        'dark',
        0,
        null,
        {
          type: 'link',
          raw: '',
          href: 'https://other.com',
          text: '',
          tokens: [],
        },
        null,
        { linkCap: true },
      ),
    ).not.toContain('\x1b]8;;')
  })
})
