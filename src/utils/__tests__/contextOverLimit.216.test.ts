/**
 * densable 2.1.216 #35 — Ftn over-window warning copy for /context
 */
import { describe, expect, test } from 'bun:test'
import { formatContextOverLimitWarning } from '../contextOverLimit.js'
import { formatTokens } from '../format.js'

describe('formatContextOverLimitWarning (densable Ftn)', () => {
  test('returns null when under or at the window', () => {
    expect(
      formatContextOverLimitWarning({
        totalTokens: 1000,
        rawMaxTokens: 2000,
        autocompactSource: 'auto',
      }),
    ).toBeNull()
    expect(
      formatContextOverLimitWarning({
        totalTokens: 2000,
        rawMaxTokens: 2000,
        autocompactSource: 'auto',
      }),
    ).toBeNull()
  })

  test('auto source: hard limit language + compact or clear', () => {
    const over = 50_000
    const limit = 200_000
    const msg = formatContextOverLimitWarning({
      totalTokens: limit + over,
      rawMaxTokens: limit,
      autocompactSource: 'auto',
      disableCompact: false,
    })
    expect(msg).toBe(
      `Context exceeds the ${formatTokens(limit)}-token limit by ${formatTokens(over)} tokens — run /compact or /clear to continue.`,
    )
  })

  test('auto source with DISABLE_COMPACT: only /clear', () => {
    const msg = formatContextOverLimitWarning({
      totalTokens: 210_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'auto',
      disableCompact: true,
    })
    expect(msg).toContain('run /clear to continue')
    expect(msg).not.toContain('/compact')
  })

  test('env (non-auto) source: compaction window language', () => {
    const over = 12_000
    const limit = 100_000
    const msg = formatContextOverLimitWarning({
      totalTokens: limit + over,
      rawMaxTokens: limit,
      autocompactSource: 'env',
      disableCompact: false,
    })
    expect(msg).toBe(
      `Context is ${formatTokens(over)} tokens past the ${formatTokens(limit)}-token compaction window — run /compact to reduce usage.`,
    )
  })

  test('non-auto with DISABLE_COMPACT: /clear only', () => {
    const msg = formatContextOverLimitWarning({
      totalTokens: 120_000,
      rawMaxTokens: 100_000,
      autocompactSource: 'settings',
      disableCompact: true,
    })
    expect(msg).toContain('run /clear to reduce usage')
    expect(msg).not.toContain('/compact')
  })

  test('missing autocompactSource defaults to auto branch', () => {
    const msg = formatContextOverLimitWarning({
      totalTokens: 210_000,
      rawMaxTokens: 200_000,
      disableCompact: false,
    })
    expect(msg).toContain('exceeds the')
    expect(msg).toContain('/compact or /clear')
  })
})
