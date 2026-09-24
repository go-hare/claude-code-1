/**
 * densable 2.1.251 #31 — /usage-credits member_* / group_zero_credit_limit
 * copy via uen/mhe. Remaining uen overage arms live in rateLimitMessages.
 */
import { describe, expect, test } from 'bun:test'
import { getUsageCreditsAskAdminHint } from '../../../services/rateLimitMessages.js'
import { getUsageCreditsZeroLimitCopy } from '../extra-usage-core.js'

const ASK_ADMIN = getUsageCreditsAskAdminHint()

describe('densable 2.1.251 #31 /usage-credits zero limit copy', () => {
  test('member allocation disabled asks an admin via mhe()', () => {
    expect(getUsageCreditsZeroLimitCopy('member_level_disabled')).toBe(
      `Your usage allocation has been disabled by your admin${ASK_ADMIN}`,
    )
  })

  test('member zero credit limit uses the same sentence', () => {
    expect(getUsageCreditsZeroLimitCopy('member_zero_credit_limit')).toBe(
      `Your usage allocation has been disabled by your admin${ASK_ADMIN}`,
    )
  })

  test("group zero credit limit is the group's $0 sentence", () => {
    expect(getUsageCreditsZeroLimitCopy('group_zero_credit_limit')).toBe(
      `Your group's usage limit is set to $0${ASK_ADMIN}`,
    )
  })

  test('spend-cap / uen-only overage arms are not this BTr copy', () => {
    expect(getUsageCreditsZeroLimitCopy('org_spend_cap_reached')).toBeNull()
    expect(getUsageCreditsZeroLimitCopy('org_level_disabled_until')).toBeNull()
    expect(getUsageCreditsZeroLimitCopy('out_of_credits')).toBeNull()
    expect(
      getUsageCreditsZeroLimitCopy('seat_tier_zero_credit_limit'),
    ).toBeNull()
    expect(getUsageCreditsZeroLimitCopy('seat_tier_level_disabled')).toBeNull()
    expect(
      getUsageCreditsZeroLimitCopy('org_service_level_disabled'),
    ).toBeNull()
    expect(getUsageCreditsZeroLimitCopy(null)).toBeNull()
  })

  test('copy does not say cap was reached or "ask the admin"', () => {
    const member = getUsageCreditsZeroLimitCopy('member_zero_credit_limit')
    const group = getUsageCreditsZeroLimitCopy('group_zero_credit_limit')
    for (const message of [member, group]) {
      expect(message).toBeTruthy()
      expect(message).not.toContain('cap is reached')
      expect(message).not.toContain('ask the admin')
      expect(message).toContain('ask your admin')
    }
  })

  test('BTr routes member_* / group_zero after spend-cap, not as cap', async () => {
    const src = await Bun.file(
      new URL('../extra-usage-core.ts', import.meta.url),
    ).text()
    expect(src).toContain('getUsageCreditsZeroLimitCopy')
    expect(src).toContain('member_level_disabled')
    expect(src).toContain('member_zero_credit_limit')
    expect(src).toContain('group_zero_credit_limit')
    const capIdx = src.indexOf("disabledReason === 'org_spend_cap_reached'")
    const zeroIdx = src.indexOf('getUsageCreditsZeroLimitCopy(disabledReason)')
    expect(capIdx).toBeGreaterThan(-1)
    expect(zeroIdx).toBeGreaterThan(capIdx)
  })

  test('remaining gold uen overage arms live in rateLimitMessages, not BTr', async () => {
    const uen = await Bun.file(
      new URL('../../../services/rateLimitMessages.ts', import.meta.url),
    ).text()
    const core = await Bun.file(
      new URL('../extra-usage-core.ts', import.meta.url),
    ).text()
    // seat copy is a template: usage vs usage credits via usageBased
    expect(uen).toContain("Your seat type doesn't include ${")
    expect(uen).toContain('This service is disabled for your org')
    expect(uen).toContain("You're out of usage credits")
    expect(uen).toContain('individual usage limit')
    expect(uen).toContain("org's monthly usage limit")
    expect(uen).toContain('progressSavedSuffix')
    expect(uen).toContain(' · progress saved')
    expect(uen).toContain('isProgressSavedHintEnabled')
    // densable Gj() @184960481 — I("tengu_vellum_anchor", !1)
    expect(uen).toContain('tengu_vellum_anchor')
    expect(uen).toContain('getFeatureValue_CACHED_MAY_BE_STALE')
    // Fable seven_day_overage_included is mentioned only as invent-ban note
    expect(uen).toMatch(
      /seven_day_overage_included[\s\S]{0,80}not (in tip RateLimitType|mapped)/,
    )
    // BTr does not switch on seat/org_service — only uen does. Comments may name
    // them when pointing at rateLimitMessages; assert live comparisons only.
    expect(core).not.toMatch(
      /disabledReason === 'seat_tier_(level_disabled|zero_credit_limit)'/,
    )
    expect(core).not.toMatch(/disabledReason === 'org_service_level_disabled'/)
    expect(core).not.toContain("'individual usage limit'")
  })
})
