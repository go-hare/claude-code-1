import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatTurnDoneAt } from '../../../utils/timeFormat.js'

describe('turn duration done clock densable 2.1.246 (#3)', () => {
  test('TurnDurationMessage appends done-at clock from kVe', () => {
    const src = readFileSync(
      join(import.meta.dir, '../SystemTextMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('formatTurnDoneAt')
    expect(src).toContain('\\u00B7 done')
    expect(src).not.toContain('formatResetTime')
  })

  test('kVe today clock follows locale (en-US → `6:05 PM`)', () => {
    const lang = process.env.LANG
    process.env.LANG = 'en_US.UTF-8'
    try {
      const at = new Date('2026-09-05T18:05:00')
      expect(formatTurnDoneAt(at, at)).toBe('6:05 PM')
    } finally {
      process.env.LANG = lang
    }
  })

  test('kVe prefixes weekday within a week and date when older', () => {
    const lang = process.env.LANG
    process.env.LANG = 'en_US.UTF-8'
    try {
      const at = new Date('2026-09-05T18:05:00')
      expect(formatTurnDoneAt(at, new Date('2026-09-07T09:00:00'))).toBe(
        'Saturday 6:05 PM',
      )
      expect(formatTurnDoneAt(at, new Date('2026-09-20T09:00:00'))).toBe(
        'Saturday, Sep 5 at 6:05 PM',
      )
    } finally {
      process.env.LANG = lang
    }
  })

  test('away_summary paints recap: prefix', () => {
    const src = readFileSync(
      join(import.meta.dir, '../SystemTextMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('recap:')
    expect(src).toContain('REFERENCE_MARK')
    expect(src).toContain("subtype === 'away_summary'")
  })

  test('turn_duration paints Waiting for N background agent to finish', () => {
    const src = readFileSync(
      join(import.meta.dir, '../SystemTextMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('Waiting for')
    expect(src).toContain(
      "background ${pendingAgents === 1 ? 'agent' : 'agents'}",
    )
    expect(src).not.toContain('still running')
  })
})
