import { describe, expect, test } from 'bun:test'
import { effortLevelToSymbol } from '../EffortIndicator.js'

describe('densable 2.1.289 bW effort glyphs', () => {
  test('low ○ / medium ◐ / high ● / xhigh ◉ / max ◈', () => {
    expect(effortLevelToSymbol('low')).toBe('\u25CB')
    expect(effortLevelToSymbol('medium')).toBe('\u25D0')
    expect(effortLevelToSymbol('high')).toBe('\u25CF')
    expect(effortLevelToSymbol('xhigh')).toBe('\u25C9')
    expect(effortLevelToSymbol('max')).toBe('\u25C8')
  })
})
