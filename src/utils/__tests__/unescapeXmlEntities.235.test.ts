import { describe, expect, test } from 'bun:test'
import { escapeXml, unescapeXmlEntities } from '../xml'

describe('unescapeXmlEntities (densable oX)', () => {
  test('unescapes &amp; &lt; &gt; only', () => {
    expect(unescapeXmlEntities('a &amp; b &lt;c&gt;')).toBe('a & b <c>')
  })

  test('leaves other entities untouched (not TDr/decodeHtmlEntities)', () => {
    expect(unescapeXmlEntities('&quot;&apos;&nbsp;&#x1F4CA;')).toBe(
      '&quot;&apos;&nbsp;&#x1F4CA;',
    )
  })

  test('round-trips escapeXml', () => {
    const raw = '<stdout>a & b > c</stdout>'
    expect(unescapeXmlEntities(escapeXml(raw))).toBe(raw)
  })

  test('returns empty / plain text unchanged', () => {
    expect(unescapeXmlEntities('')).toBe('')
    expect(unescapeXmlEntities('hello world')).toBe('hello world')
  })

  test('Sp KS leaves quoted agent names as quotes after Wt (no &quot; paint)', () => {
    const raw = 'Background agent "Verify E2B bake-off trainer"'
    expect(unescapeXmlEntities(escapeXml(raw))).toBe(raw)
    expect(unescapeXmlEntities(escapeXml(raw))).not.toContain('&quot;')
  })

  test('unknown mapped miss keeps original match via ??t', () => {
    // regex only matches amp|lt|gt; confirm no throw on mixed content
    expect(unescapeXmlEntities('x &amp; y &unknown; z')).toBe(
      'x & y &unknown; z',
    )
  })
})
