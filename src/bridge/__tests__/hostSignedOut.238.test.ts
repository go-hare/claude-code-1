/**
 * densable 2.1.238 #26 — signed_out RC copy (ipl / spl / wr / sd / _u).
 * classifyMissingOAuthToken remains signed_out-only (identity_changed stub).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import {
  formatSignedOutStoppingLog,
  HOST_ACCOUNT_CHANGED_HINT,
  HOST_SIGNED_OUT_HINT,
  hostHintForTeardownReason,
  SIGNED_OUT_CLI_HINT,
  teardownReasonForMissingOAuth,
} from '../hostSignedOut.js'

describe('hostSignedOut densable 2.1.238', () => {
  test('ipl/spl/wr use em dash copy', () => {
    expect(HOST_SIGNED_OUT_HINT).toContain(
      'Remote Control stopped — the app running this session is signed out of Claude',
    )
    expect(HOST_ACCOUNT_CHANGED_HINT).toContain(
      'now signed in to a different Claude account',
    )
    expect(SIGNED_OUT_CLI_HINT).toBe(
      'Signed out of Claude — run /login, then /remote-control',
    )
  })

  test('sd maps classification to teardown reason', () => {
    expect(teardownReasonForMissingOAuth('signed_out')).toBe('host_signed_out')
    expect(teardownReasonForMissingOAuth('identity_changed')).toBe(
      'host_account_changed',
    )
  })

  test('_u picks ipl vs spl', () => {
    expect(hostHintForTeardownReason('host_signed_out')).toBe(
      HOST_SIGNED_OUT_HINT,
    )
    expect(hostHintForTeardownReason('host_account_changed')).toBe(
      HOST_ACCOUNT_CHANGED_HINT,
    )
  })

  test('stopping log matches SEA substring', () => {
    expect(formatSignedOutStoppingLog('bridge', 'host_signed_out')).toBe(
      '[remote-bridge] Signed out on this machine under bridge (host_signed_out) — stopping',
    )
  })

  test('classifier body only emits signed_out (identity_changed soft stub)', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../hostSignedOut.ts'),
      'utf8',
    )
    const fn = src.indexOf('export function classifyMissingOAuthToken')
    expect(fn).toBeGreaterThan(0)
    const body = src.slice(fn, src.indexOf('\nexport function', fn + 1))
    expect(body).toContain("'signed_out'")
    expect(body).not.toContain("return 'identity_changed'")
    expect(src).toContain(
      "MissingOAuthClassification = 'signed_out' | 'identity_changed'",
    )
  })
})
