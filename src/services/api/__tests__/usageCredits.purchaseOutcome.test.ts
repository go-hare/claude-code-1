import { describe, expect, test } from 'bun:test'
import {
  buildCredits3dsFallbackMessage,
  classifyCreditsPurchaseOutcome,
  USAGE_CREDITS_SETTINGS_URL,
} from '../usageCredits.js'

describe('classifyCreditsPurchaseOutcome (official Oe)', () => {
  test('success statuses', () => {
    expect(classifyCreditsPurchaseOutcome({ paymentStatus: 'paid' })).toBe(
      'success',
    )
    expect(classifyCreditsPurchaseOutcome({ paymentStatus: 'succeeded' })).toBe(
      'success',
    )
  })
  test('pending_invoice with id → poll', () => {
    expect(
      classifyCreditsPurchaseOutcome({
        paymentStatus: 'pending_invoice',
        purchaseId: 'p1',
      }),
    ).toBe('poll')
  })
  test('requires_action → 3ds_fallback', () => {
    expect(
      classifyCreditsPurchaseOutcome({
        paymentStatus: 'requires_action',
      }),
    ).toBe('3ds_fallback')
  })
  test('client secret alone → 3ds_fallback', () => {
    expect(
      classifyCreditsPurchaseOutcome({
        paymentStatus: 'pending',
        stripeClientSecret: 'pi_secret',
      }),
    ).toBe('3ds_fallback')
  })
  test('unknown → unexpected', () => {
    expect(classifyCreditsPurchaseOutcome({ paymentStatus: 'weird' })).toBe(
      'unexpected',
    )
  })
})

describe('buildCredits3dsFallbackMessage', () => {
  test('official copy + settings URL', () => {
    const msg = buildCredits3dsFallbackMessage()
    expect(msg).toContain('additional verification')
    expect(msg).toContain(USAGE_CREDITS_SETTINGS_URL)
    expect(msg).toContain('not completed')
  })
})
