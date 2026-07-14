import { describe, expect, test } from 'bun:test'
import {
  deepResearchFetchAgentLabel,
  deepResearchSourceLabel,
  normURL,
  quotedLabel,
  stripLabelChars,
} from '../deepResearchSourceLabel.js'

describe('deepResearchSourceLabel', () => {
  test('shows bare hostname for clean https URLs (not unknown)', () => {
    expect(
      deepResearchSourceLabel({
        url: 'https://www.example.com/path/to/doc',
        title: 'Example Doc',
      }),
    ).toBe('example.com')
    expect(
      deepResearchFetchAgentLabel({
        url: 'https://docs.python.org/3/library/os.html',
      }),
    ).toBe('fetch:docs.python.org')
  })

  test('strips userinfo and prefers real host (last @)', () => {
    // WHATWG authority splits at last @ — must not label trusted.com
    expect(
      deepResearchSourceLabel({
        url: 'https://x@trusted.com@evil.com/x',
      }),
    ).toBe('evil.com')
  })

  test('quotes unclean hosts; falls back to title; else unknown', () => {
    // Underscore is not LDH — quoted, not bare
    const unclean = deepResearchSourceLabel({
      url: 'https://bad_host.example/path',
      title: 'Some Title',
    })
    expect(unclean.startsWith('"')).toBe(true)
    expect(unclean.includes('bad')).toBe(true)

    expect(
      deepResearchSourceLabel({
        url: 'not-a-url',
        title: 'Fallback Title',
      }),
    ).toBe(quotedLabel('Fallback Title'))

    expect(deepResearchSourceLabel({ url: 'not-a-url' })).toBe('unknown')
  })

  test('strips control / bidi / quote lookalikes from labels', () => {
    // ESC (C0) and zero-width are removed; CSI param bytes after ESC remain
    // as printable — host still fails STRICT_HOST and goes through quotedLabel.
    expect(stripLabelChars('ex\u001bample\u200b.com')).toBe('example.com')
    expect(stripLabelChars('say "hi"')).toBe('say hi')
  })
})

describe('normURL', () => {
  test('lowercases host+path without trailing slash', () => {
    expect(normURL('https://WWW.Example.COM/Foo/')).toBe('example.com/foo')
  })
})
