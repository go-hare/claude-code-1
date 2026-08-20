import { describe, expect, test } from 'bun:test'
import { formatUsageCreditsAmount } from '../usage.js'

describe('formatUsageCreditsAmount (densable am)', () => {
  test('USD precise: cents → $X.YY with locale thousands', () => {
    expect(formatUsageCreditsAmount(0, 'USD')).toBe('$0.00')
    expect(formatUsageCreditsAmount(123, 'USD')).toBe('$1.23')
    expect(formatUsageCreditsAmount(123456, 'USD')).toBe('$1,234.56')
    expect(formatUsageCreditsAmount(100000, 'USD')).toBe('$1,000.00')
  })

  test('null/undefined currency defaults to USD', () => {
    expect(formatUsageCreditsAmount(123, null)).toBe('$1.23')
    expect(formatUsageCreditsAmount(123, undefined)).toBe('$1.23')
  })

  test('JPY/KRW/VND are whole-unit (no /100)', () => {
    expect(formatUsageCreditsAmount(1234, 'JPY')).toBe('¥1,234')
    // KRW/VND absent from $sT → Ztt "CODE " prefix
    expect(formatUsageCreditsAmount(1234, 'KRW')).toBe('KRW 1,234')
    expect(formatUsageCreditsAmount(1234, 'VND')).toBe('VND 1,234')
  })

  test('EUR/GBP symbols', () => {
    expect(formatUsageCreditsAmount(123, 'EUR')).toBe('€1.23')
    expect(formatUsageCreditsAmount(123, 'GBP')).toBe('£1.23')
  })

  test('unknown currency uses CODE prefix (Ztt)', () => {
    expect(formatUsageCreditsAmount(123, 'CHF')).toBe('CHF 1.23')
  })

  test('whole / fit modes', () => {
    expect(formatUsageCreditsAmount(199, 'USD', 'whole')).toBe('$2')
    expect(formatUsageCreditsAmount(200, 'USD', 'fit')).toBe('$2')
    expect(formatUsageCreditsAmount(250, 'USD', 'fit')).toBe('$2.50')
  })
})
