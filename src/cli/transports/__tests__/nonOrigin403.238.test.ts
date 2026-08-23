/**
 * densable 2.1.238 #33 — non-origin 403 streak (f8r / $pl / eJv / Ta / jrm).
 */
import { describe, expect, test } from 'bun:test'
import {
  advanceNonOriginStreak,
  classify403RejectSource,
  closedCauseFor403,
  formatNonOrigin403RecoverLog,
  isNonOrigin403Retryable,
  NON_ORIGIN_403_WINDOW_MS,
  recovered403EventName,
  takeFirstInEpisodeFlag,
} from '../nonOrigin403.js'

describe('nonOrigin403 densable 2.1.238', () => {
  test('f8r: request-id req_… is origin (u2t/qnv, not UUID)', () => {
    expect(
      classify403RejectSource({
        'request-id': 'req_abcDEF0123456789_-xyz',
      }),
    ).toBe('origin')
  })

  test('f8r: UUID request-id is not origin', () => {
    expect(
      classify403RejectSource({
        'request-id': '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).toBe('nonorigin_other')
  })

  test('f8r: x-request-id is ignored', () => {
    expect(
      classify403RejectSource({
        'x-request-id': 'req_should_not_count',
      }),
    ).toBe('nonorigin_other')
  })

  test('f8r: empty cf-ray is not nonorigin_cf', () => {
    expect(classify403RejectSource({ 'cf-ray': '' })).toBe('nonorigin_other')
  })

  test('f8r: cf-ray is nonorigin_cf', () => {
    expect(classify403RejectSource({ 'cf-ray': '8a1b2c3d4e5f6789' })).toBe(
      'nonorigin_cf',
    )
  })

  test('f8r: Server Cloudflare is nonorigin_cf', () => {
    expect(classify403RejectSource({ server: 'cloudflare' })).toBe(
      'nonorigin_cf',
    )
  })

  test('f8r: other 403 is nonorigin_other', () => {
    expect(
      classify403RejectSource({ 'x-cache': 'Error from cloudfront' }),
    ).toBe('nonorigin_other')
  })

  test('origin 403 is not retryable (streak null)', () => {
    const streak = advanceNonOriginStreak(null, 'origin', 1_000)
    expect(streak).toBeNull()
    expect(isNonOrigin403Retryable(streak, 1_000)).toBe(false)
  })

  test('non-origin streak inside 180s is retryable', () => {
    const t0 = 10_000
    const streak = advanceNonOriginStreak(null, 'nonorigin_cf', t0)
    expect(streak?.attempts).toBe(1)
    const continued = advanceNonOriginStreak(
      streak,
      'nonorigin_cf',
      t0 + 30_000,
    )
    expect(continued?.attempts).toBe(2)
    expect(isNonOrigin403Retryable(continued, t0 + 30_000)).toBe(true)
    expect(
      isNonOrigin403Retryable(continued, t0 + NON_ORIGIN_403_WINDOW_MS),
    ).toBe(false)
  })

  test('expired window / origin close use jrm named codes', () => {
    expect(closedCauseFor403('origin', null)).toBe('transport_closed_403')
    expect(
      closedCauseFor403('nonorigin_cf', {
        source: 'nonorigin_cf',
        startedAtMs: 0,
        lastAtMs: 1,
        attempts: 3,
      }),
    ).toBe('transport_closed_403_nonorigin_cf')
    expect(closedCauseFor403('nonorigin_other', null)).toBe(
      'transport_closed_403_nonorigin_other',
    )
  })

  test('recover log is SEA-exact', () => {
    const log = formatNonOrigin403RecoverLog({
      source: 'nonorigin_cf',
      startedAtMs: 0,
      lastAtMs: 12_400,
      attempts: 3,
    })
    expect(log).toBe(
      '[remote-bridge] SSE stream live again after 3 non-origin 403(s) over 12s (source=nonorigin_cf)',
    )
    expect(recovered403EventName('nonorigin_cf')).toBe(
      'recovered_403_nonorigin_cf',
    )
    expect(recovered403EventName('nonorigin_other')).toBe(
      'recovered_403_nonorigin_other',
    )
  })

  test('zs: first_in_episode is 0/1 flag, not attempt count', () => {
    const latch = { seen: false }
    expect(takeFirstInEpisodeFlag(latch)).toBe(1)
    expect(takeFirstInEpisodeFlag(latch)).toBe(0)
    expect(takeFirstInEpisodeFlag(latch)).toBe(0)
  })
})
