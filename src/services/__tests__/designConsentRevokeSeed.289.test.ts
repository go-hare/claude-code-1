/**
 * densable 2.1.289 — /design-revoke without DesignSessionState still
 * seeds the next consent read as denied.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONSENT = join(import.meta.dir, '../designConsent.ts')

describe('densable 2.1.289 design revoke seed', () => {
  test('deleteDesignConsent seeds false even without state', () => {
    const src = readFileSync(CONSENT, 'utf8')
    const start = src.indexOf('export async function deleteDesignConsent')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 900)
    expect(body).toContain('seedDesignConsentCache(false)')
  })
})
