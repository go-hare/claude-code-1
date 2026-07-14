import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CREDIT_PRESETS_CENTS,
  defaultBundlesFromPresets,
  taxMinorUnitsFromRate,
} from '../usageCredits.js'
import {
  formatUsageCreditAmountInput,
  parseUsageCreditAmount,
} from '../../../commands/extra-usage/parseUsageCreditAmount.js'

describe('usage credits helpers (2.1.207)', () => {
  test('default bundle presets match official ARu (25/50/75/150 dollars)', () => {
    expect([...DEFAULT_CREDIT_PRESETS_CENTS]).toEqual([
      2500, 5000, 7500, 15_000,
    ])
    const bundles = defaultBundlesFromPresets()
    expect(bundles).toHaveLength(4)
    expect(bundles[0]?.credit_minor_units).toBe(2500)
    expect(bundles[0]?.price_minor_units).toBe(2500)
    expect(bundles[3]?.local_credit_minor_units).toBe(15_000)
  })

  test('parseUsageCreditAmount aligns with dialog buy/limit input', () => {
    expect(parseUsageCreditAmount('20')).toEqual({ ok: true, cents: 2000 })
    expect(parseUsageCreditAmount('20.5')).toEqual({ ok: true, cents: 2050 })
    expect(parseUsageCreditAmount('$20').ok).toBe(false)
    expect(formatUsageCreditAmountInput(2050)).toBe('20.50')
    expect(formatUsageCreditAmountInput(2000)).toBe('20')
  })

  test('taxMinorUnitsFromRate matches official IYi (round price * rate / 100)', () => {
    // $25.00 @ 8.25% → 206.25 → 206 cents
    expect(taxMinorUnitsFromRate(2500, 8.25)).toBe(206)
    expect(taxMinorUnitsFromRate(1000, 0)).toBe(0)
    expect(taxMinorUnitsFromRate(1000, 10)).toBe(100)
  })
})
