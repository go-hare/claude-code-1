import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('v2.1.290 #111 — restrictedSession skips UDS messaging in setup.ts', () => {
  test('setup.ts checks isRestrictedSession() before startUdsMessaging', () => {
    const src = readFileSync(join(import.meta.dir, 'setup.ts'), 'utf8')
    const idx = src.indexOf("if (feature('UDS_INBOX'))")
    expect(idx).toBeGreaterThan(-1)
    const slice = src.slice(idx, idx + 500)
    expect(slice).toContain('isRestrictedSession()')
    expect(slice).toContain('[uds-messaging] Skipped: restricted session')
    expect(slice).toContain(
      '[uds-messaging] Skipped: restricted session (--messaging-socket-path ignored)',
    )
  })
})
