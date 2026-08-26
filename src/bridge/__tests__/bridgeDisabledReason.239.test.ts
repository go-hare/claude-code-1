/**
 * densable 2.1.239 #57 — RC not-enabled copy names logout/login + doctor.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('getBridgeDisabledReason densable 2.1.239 #57', () => {
  test('gate-false copy matches official doctor/relogin wording', () => {
    const src = readFileSync(
      join(import.meta.dir, '../bridgeEnabled.ts'),
      'utf8',
    )
    expect(src).toContain(
      "Remote Control isn't enabled for this account. If you recently changed plans, run `claude auth logout` then `claude auth login` to refresh your entitlements, or `claude doctor` for details.",
    )
    expect(src).not.toContain(
      'Remote Control is not yet enabled for your account.',
    )
  })
})
