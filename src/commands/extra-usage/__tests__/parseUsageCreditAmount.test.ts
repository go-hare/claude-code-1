import { describe, expect, test } from 'bun:test'
import {
  formatUsageCreditAmountInput,
  parseUsageCreditAmount,
} from '../parseUsageCreditAmount.js'

describe('parseUsageCreditAmount', () => {
  test('accepts whole dollars and two-decimal fractions', () => {
    expect(parseUsageCreditAmount('20')).toEqual({ ok: true, cents: 2000 })
    expect(parseUsageCreditAmount('20.5')).toEqual({ ok: true, cents: 2050 })
    expect(parseUsageCreditAmount('20.50')).toEqual({ ok: true, cents: 2050 })
    expect(parseUsageCreditAmount('  7.01  ')).toEqual({ ok: true, cents: 701 })
  })

  test('rejects empty and non-positive', () => {
    expect(parseUsageCreditAmount('')).toEqual({
      ok: false,
      error: 'Enter an amount',
    })
    expect(parseUsageCreditAmount('   ')).toEqual({
      ok: false,
      error: 'Enter an amount',
    })
    expect(parseUsageCreditAmount('0')).toEqual({
      ok: false,
      error: 'Enter an amount',
    })
    expect(parseUsageCreditAmount('0.00')).toEqual({
      ok: false,
      error: 'Enter an amount',
    })
  })

  test('rejects malformed amounts that used to strip silently', () => {
    // Official 2.1.207: no silent strip of symbols / trailing junk / 3dp
    for (const bad of [
      '$20',
      '20$',
      '20abc',
      '20.999',
      '20,00',
      '1e2',
      '-5',
      '.5',
      '20.',
    ]) {
      const r = parseUsageCreditAmount(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe('Enter an amount like 20 or 20.50')
      }
    }
  })
})

describe('formatUsageCreditAmountInput', () => {
  test('whole dollars without trailing .00', () => {
    expect(formatUsageCreditAmountInput(2000)).toBe('20')
  })

  test('fractional cents keep two decimals', () => {
    expect(formatUsageCreditAmountInput(2050)).toBe('20.50')
    expect(formatUsageCreditAmountInput(701)).toBe('7.01')
  })
})
