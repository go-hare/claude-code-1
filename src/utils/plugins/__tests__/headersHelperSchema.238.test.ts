import { describe, expect, test } from 'bun:test'
import {
  HEADERS_HELPER_MAX_LENGTH,
  HeadersHelperCommandSchema,
  MarketplaceSourceSchema,
  PluginMarketplaceEntrySchema,
} from '../schemas.js'

describe('HeadersHelperCommandSchema (densable 2.1.238 m8s)', () => {
  test('accepts short printable command', () => {
    expect(HeadersHelperCommandSchema().safeParse('echo {}').success).toBe(true)
  })

  test('rejects longer than consent UI max (500)', () => {
    const result = HeadersHelperCommandSchema().safeParse(
      'x'.repeat(HEADERS_HELPER_MAX_LENGTH + 1),
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        'install consent UI can display',
      )
    }
  })

  test('rejects non-printable / quad spaces', () => {
    expect(HeadersHelperCommandSchema().safeParse('echo\t{}').success).toBe(
      false,
    )
    expect(HeadersHelperCommandSchema().safeParse('echo    {}').success).toBe(
      false,
    )
  })
})

describe('MarketplaceSourceSchema url headersHelper', () => {
  test('accepts headersHelper beside headers', () => {
    const result = MarketplaceSourceSchema().safeParse({
      source: 'url',
      url: 'https://example.com/marketplace.json',
      headers: { Authorization: 'Bearer static' },
      headersHelper: 'printf %s {}',
    })
    expect(result.success).toBe(true)
  })
})

describe('PluginMarketplaceEntrySchema headersHelper', () => {
  test('accepts entry headersHelper with strict false archive', () => {
    const result = PluginMarketplaceEntrySchema().safeParse({
      name: 'demo-plugin',
      source: {
        source: 'archive',
        url: 'https://example.com/demo.zip',
        sha256: 'a'.repeat(64),
      },
      strict: false,
      description: 'demo',
      headersHelper: '/usr/local/bin/mint-headers',
    })
    expect(result.success).toBe(true)
  })
})
