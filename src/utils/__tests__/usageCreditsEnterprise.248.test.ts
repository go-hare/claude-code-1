/**
 * densable 2.1.248 #6 — DN / Zur usage-credits Enterprise Marketplace /
 * self-serve / trial. Gold: gold-248-feat-6.txt, gold-248-feat-6-pass2.txt,
 * gold-248-feat-pass3.txt.
 *
 * SEA DN @180726573 / Zur @180726780 sha=68bdfbfabfda6aaa:
 *   var DN=new Set(["stripe_subscription","stripe_subscription_contracted",
 *     "stripe_subscription_enterprise_self_serve","aws_marketplace",
 *     "c4e_consumption_trial","apple_subscription","google_play_subscription"])
 *   function Zur(){let e=In()?.billingType;if(!St()||!e)return!1;return DN.has(e)}
 * v_() DISABLE gate is #38 leftover — do not regress.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { OVERAGE_PROVISIONING_BILLING_TYPES } from '../auth.js'

const GOLD_DN = [
  'stripe_subscription',
  'stripe_subscription_contracted',
  'stripe_subscription_enterprise_self_serve',
  'aws_marketplace',
  'c4e_consumption_trial',
  'apple_subscription',
  'google_play_subscription',
] as const

const ENTERPRISE_ASK_ADMIN = [
  'stripe_subscription_enterprise_self_serve',
  'aws_marketplace',
  'c4e_consumption_trial',
] as const

const INVENTED_BILLING_TYPES = [
  'usage_based',
  'enterprise_trial',
  'self_serve',
  'marketplace_billing',
  'azure_marketplace',
  'gcp_marketplace',
  'AWS_MARKETPLACE',
] as const

const authSrc = readFileSync(join(import.meta.dir, '../auth.ts'), 'utf8')
const extraIndexSrc = readFileSync(
  join(import.meta.dir, '../../commands/extra-usage/index.ts'),
  'utf8',
)
const extraCoreSrc = readFileSync(
  join(import.meta.dir, '../../commands/extra-usage/extra-usage-core.ts'),
  'utf8',
)
const hintSrc = readFileSync(
  join(import.meta.dir, '../../services/rateLimitMessages.ts'),
  'utf8',
)

function zurBody(src: string): string {
  const start = src.indexOf('export function isOverageProvisioningAllowed')
  expect(start).toBeGreaterThan(-1)
  const brace = src.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(brace, i + 1)
    }
  }
  return src.slice(start, start + 280)
}

function vBody(src: string): string {
  const start = src.indexOf('export function isUsageCreditsHintEnabled')
  expect(start).toBeGreaterThan(-1)
  const brace = src.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(brace, i + 1)
    }
  }
  return src.slice(start, start + 220)
}

describe('densable 2.1.248 #6 DN/Zur usage-credits enterprise', () => {
  test('DN allowlist is gold 1:1 (no invented billing types)', () => {
    expect([...OVERAGE_PROVISIONING_BILLING_TYPES]).toEqual([...GOLD_DN])
    expect(OVERAGE_PROVISIONING_BILLING_TYPES.size).toBe(7)
    for (const invented of INVENTED_BILLING_TYPES) {
      expect(OVERAGE_PROVISIONING_BILLING_TYPES.has(invented)).toBe(false)
    }
  })

  test('Enterprise Marketplace / self-serve / trial are in DN (ask-admin)', () => {
    for (const billingType of ENTERPRISE_ASK_ADMIN) {
      expect(OVERAGE_PROVISIONING_BILLING_TYPES.has(billingType)).toBe(true)
    }
  })

  test('Zur leftover uses gold subscriber + billingType + DN.has', () => {
    const body = zurBody(authSrc)
    expect(body).toContain('getOauthAccountInfo()?.billingType')
    expect(body).toContain('isClaudeAISubscriber()')
    expect(body).toContain('OVERAGE_PROVISIONING_BILLING_TYPES.has')
    expect(body).toContain('if (!isClaudeAISubscriber() || !billingType)')
    expect(body).not.toContain("billingType !== 'stripe_subscription'")
    expect(body).not.toContain('apple_subscription')
    expect(body).not.toContain('google_play_subscription')
  })

  test('extra-usage /usage-credits enablement is Zur after DISABLE', () => {
    expect(extraIndexSrc).toContain('DISABLE_EXTRA_USAGE_COMMAND')
    expect(extraIndexSrc).toContain('isOverageProvisioningAllowed()')
    expect(extraIndexSrc).toMatch(
      /if \(isEnvTruthy\(process\.env\.DISABLE_EXTRA_USAGE_COMMAND\)\) \{\s*return false\s*\}/,
    )
    const enablement = extraIndexSrc.slice(
      extraIndexSrc.indexOf('function isExtraUsageAllowed'),
      extraIndexSrc.indexOf('export const usageCredits'),
    )
    expect(enablement).toContain('return isOverageProvisioningAllowed()')
  })

  test('v_() still gates DISABLE then Zur — no kS invent', () => {
    const body = vBody(hintSrc)
    expect(body).toContain('DISABLE_EXTRA_USAGE_COMMAND')
    expect(body).toContain('return isOverageProvisioningAllowed()')
    expect(body.indexOf('DISABLE_EXTRA_USAGE_COMMAND')).toBeLessThan(
      body.indexOf('isOverageProvisioningAllowed()'),
    )
    expect(body).not.toContain('kS(')
    expect(hintSrc).toContain('getUsageCreditsAskAdminHint')
    expect(hintSrc).toContain(
      'run /usage-credits to ask your admin for a higher limit',
    )
  })

  test('extra-usage ask-admin copy stays leftover (no invented marketplace copy)', () => {
    expect(extraCoreSrc).toContain(
      'Contact your admin to manage usage credit settings.',
    )
    expect(extraCoreSrc).toContain(
      'Request sent to your admin for usage credits.',
    )
    expect(extraCoreSrc).toContain(
      'Your organization is out of usage credits. Contact your admin to add more.',
    )
    expect(extraCoreSrc).not.toContain('AWS Marketplace')
    expect(extraCoreSrc).not.toContain('enterprise_self_serve')
    expect(extraCoreSrc).not.toContain('c4e_consumption_trial')
  })
})
