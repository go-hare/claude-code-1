import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { marked } from 'marked'
import {
  sanitizeStatusLineText,
  splitStatusLineOutput,
} from '../../components/StatusLine.js'
import { neutralizeChannelPreviewText } from '../channelPreviewSanitize.js'
import {
  createHyperlink,
  HYPERLINK_STYLE_RESET,
  OSC8_START,
} from '../hyperlink.js'
import { formatToken, stripRawOsc8Sequences } from '../markdown.js'

describe('Official 2.1.295 #373 hyperlink conceal/color reset', () => {
  test('createHyperlink applies shownUrlStart when hyperlinks are unsupported', () => {
    const out = createHyperlink('https://example.com', 'click here', {
      supportsHyperlinks: false,
      shownUrlStart: HYPERLINK_STYLE_RESET,
    })
    expect(out).toBe(`click here${HYPERLINK_STYLE_RESET} (https://example.com)`)
  })

  test('createHyperlink resets SGR conceal (28m) before OSC8 when supported', () => {
    const out = createHyperlink('https://example.com', 'click here', {
      supportsHyperlinks: true,
      shownUrlStart: HYPERLINK_STYLE_RESET,
    })
    expect(out.startsWith('\x1b[28m')).toBe(true)
    expect(out).toContain(`${OSC8_START}https://example.com`)
  })
})

describe('Official 2.1.295 #392 raw OSC8 hyperlink stripping', () => {
  test('stripRawOsc8Sequences removes raw OSC8 and stray C1/non-CSI ESC', () => {
    const malicious =
      'Click \x1b]8;;https://evil.test\x07https://safe.test\x1b]8;;\x07!\x9d'
    expect(stripRawOsc8Sequences(malicious)).toBe('Click https://safe.test!')
  })

  test('formatToken strips raw OSC8 from text and codespan tokens', () => {
    const md =
      'Hello \x1b]8;;https://evil.test\x07safe\x1b]8;;\x07 and `code \x1b]8;;https://evil.test\x07x\x1b]8;;\x07`'
    const rendered = marked
      .lexer(stripRawOsc8Sequences(md))
      .map(t => formatToken(t, 'dark'))
      .join('')
    expect(rendered).not.toContain('https://evil.test')
    expect(rendered).toContain('safe')

    const codeOut = formatToken(
      {
        type: 'codespan',
        raw: '`x`',
        text: 'code \x1b]8;;https://evil.test\x07x\x1b]8;;\x07',
      },
      'dark',
    )
    expect(codeOut).not.toContain('https://evil.test')
  })
})

describe('Official 2.1.295 #418 bidi & tab sanitization', () => {
  test('neutralizeChannelPreviewText strips Arabic Letter Mark (U+061C) and U+2028/U+2029', () => {
    expect(
      neutralizeChannelPreviewText('a\u061cb\u202ac\u2028d\u2029e\u2066f'),
    ).toBe('abcdef')
  })

  test('sanitizeStatusLineText and splitStatusLineOutput expand tabs and strip bidi controls', () => {
    expect(sanitizeStatusLineText('a\tb\u202ec\u061cd')).toBe('a    bcd')
    expect(splitStatusLineOutput('one\ttwo\nthree\u2066four')).toEqual([
      'one    two',
      'threefour',
    ])
  })
})

describe('Official 2.1.292 #253 Markdown uses pure-string list path', () => {
  test('Markdown.tsx no longer imports or renders MarkdownList', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../components/Markdown.tsx'),
      'utf8',
    )
    expect(src).not.toContain('<MarkdownList')
  })
})
