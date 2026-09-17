/**
 * densable 2.1.246 #38 — official W5s → $5s → tHr + ZWr sandwich.
 *
 * Official normalize @217936570:
 *   if (o) H = R ? W5s(W, i) : W
 *   else if (chair_sermon) H = leo(peo(W))
 *   else H = W
 *   let te=$5s(H); return tHr(te,t)
 *
 * Official ZWr @217998690: stripped tool_use between thinking blocks
 * becomes `[Tool use removed]`.
 *
 * Stay leftover. Do not promote to 246 gold.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../messages.ts'), 'utf8')

describe('#38 W5s → $5s → tHr + ZWr (2.1.246)', () => {
  test('source-locks official is_error strip + W5s-before-$5s + tHr + ZWr', () => {
    expect(src).toContain('function sanitizeErrorToolResultContent(')
    expect(src).toContain("b.type !== 'tool_result' || !b.is_error")
    expect(src).toContain("trContent.every(c => c.type === 'text')")
    expect(src).toContain("trContent.filter(c => c.type === 'text')")
    expect(src).toContain("texts.join('\\n\\n')")
    expect(src).toContain('tengu_chair_sermon')
    expect(src).toContain('[Tool use removed]')
    expect(src).toContain('function mergeBatchedToolResults(')
    expect(src).toContain('function batchEntryParentId(')

    expect(src).not.toContain('function reinsertApiSystem')
    expect(src).toContain('shouldSkipSystemReminderWrap(model)')
    const W = src.indexOf('const W = ensureNonEmptyAssistantContent(')
    const w5s = src.indexOf('demoteOrphanApiSystemMessages(W,', W)
    const chair = src.indexOf(
      "checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_chair_sermon')",
      w5s,
    )
    const s5s = src.indexOf(
      'const te = sanitizeErrorToolResultContent(H)',
      chair,
    )
    const thr = src.indexOf('mergeBatchedToolResults(te, tools)', s5s)
    expect(W).toBeGreaterThan(-1)
    expect(w5s).toBeGreaterThan(W)
    expect(chair).toBeGreaterThan(w5s)
    expect(s5s).toBeGreaterThan(chair)
    expect(thr).toBeGreaterThan(s5s)
  })
})
