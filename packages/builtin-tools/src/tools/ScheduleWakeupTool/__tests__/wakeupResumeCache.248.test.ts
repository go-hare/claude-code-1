/**
 * densable 2.1.248 #9 — ScheduleWakeup prompt uses Ivt/B1 with
 * ignoreOverage from pinned tengu_slate_anchor (NAn/zce).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const promptSrc = readFileSync(join(import.meta.dir, '../prompt.ts'), 'utf8')
const claudeSrc = readFileSync(
  join(import.meta.dir, '../../../../../../src/services/api/claude.ts'),
  'utf8',
)
const gbSrc = readFileSync(
  join(
    import.meta.dir,
    '../../../../../../src/services/analytics/growthbook.ts',
  ),
  'utf8',
)

describe('densable 2.1.248 #9 wakeup-resume-cache', () => {
  test('NAn pins tengu_slate_anchor default true', () => {
    expect(promptSrc).toContain("'tengu_slate_anchor'")
    expect(promptSrc).toContain(
      'getPinnedFeatureValue(SLATE_ANCHOR_FEATURE, true)',
    )
    expect(promptSrc).toContain('should1hCacheTTL(')
    expect(promptSrc).toContain('{ ignoreOverage }')
    expect(promptSrc).toContain("should1hCacheTTL('repl_main_thread'")
    expect(promptSrc).toContain("should1hCacheTTL('sdk'")
  })

  test('B1 is Ivt.ttl===1h with ignoreOverage opts', () => {
    expect(claudeSrc).toContain('export function should1hCacheTTL')
    expect(claudeSrc).toContain('ignoreOverage?: boolean')
    expect(claudeSrc).toContain(
      'resolvePromptCacheTtl(querySource, opts).ttl ===',
    )
    expect(claudeSrc).toContain("ttl === '1h'")
  })

  test('Ivt ignoreOverage skips leftover eligibility latch', () => {
    const start = claudeSrc.indexOf('if (ignoreOverage) {')
    expect(start).toBeGreaterThan(-1)
    const slice = claudeSrc.slice(start, start + 280)
    expect(slice).toContain('if (!isClaudeAISubscriber())')
    expect(slice).toContain("ttl: '5m'")
    expect(slice).not.toContain('getPromptCache1hEligible')
  })

  test('zce pins first GB read on session Map', () => {
    expect(gbSrc).toContain('export function getPinnedFeatureValue')
    expect(gbSrc).toContain('getPinnedFeatureValues()')
    expect(gbSrc).toContain('if (!pinned.has(feature))')
    expect(gbSrc).toContain(
      'getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue)',
    )
  })
})
