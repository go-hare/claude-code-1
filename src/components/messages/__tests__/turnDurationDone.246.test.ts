import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatResetTime } from '../../../utils/format.js'

describe('turn duration done clock densable 2.1.246 (#3)', () => {
  test('TurnDurationMessage appends done-at clock from Vs/L', () => {
    const src = readFileSync(
      join(import.meta.dir, '../SystemTextMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('formatResetTime')
    expect(src).toContain('\\u00B7 done')
  })

  test('L/ct same-day format is numeric hour + lowercase am/pm', () => {
    const ts = Math.floor(Date.parse('2026-09-05T18:05:00') / 1000)
    const formatted = formatResetTime(ts)
    expect(formatted).toBeDefined()
    expect(formatted).toMatch(/^\d{1,2}(?::\d{2})?[ap]m$/i)
  })
})
