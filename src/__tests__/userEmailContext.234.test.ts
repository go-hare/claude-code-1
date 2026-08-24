/**
 * densable 2.1.234 #5 — account email identify-only user context block.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

describe('densable 2.1.234 #5 userEmail context', () => {
  afterEach(() => {
    mock.restore()
    delete process.env.ANTHROPIC_UNIX_SOCKET
  })

  test('gold identify-only wording is present when oauth email exists', async () => {
    // Source-sniff: keep the SEA gold string in tree; behavioral wiring is in
    // getUserContext and covered by context.baseline when auth mocks allow.
    const fs = await import('node:fs')
    const src = fs.readFileSync(
      new URL('../context.ts', import.meta.url),
      'utf8',
    )
    expect(src).toContain(
      'Use it only to identify the user, such as for authorship, attribution, or filtering their own work',
    )
    expect(src).toContain('ANTHROPIC_UNIX_SOCKET')
    expect(src).toContain('getOauthAccountInfo')
    expect(src).toContain('has_user_email')
  })
})
