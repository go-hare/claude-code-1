import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { selectOpenRawUtilization } from '../claudeAiLimits.js'

describe('raw utilization reset 243', () => {
  test('Y0a keeps windows whose resets_at is still in the future', () => {
    const now = 1_700_000_000
    expect(
      selectOpenRawUtilization(
        {
          five_hour: { utilization: 0.42, resets_at: now + 60 },
          seven_day: { utilization: 0.1, resets_at: now + 86400 },
        },
        now,
      ),
    ).toEqual({
      five_hour: { utilization: 0.42, resets_at: now + 60 },
      seven_day: { utilization: 0.1, resets_at: now + 86400 },
    })
  })

  test('Y0a drops a window at or after resets_at (idle past reset)', () => {
    const now = 1_700_000_000
    expect(
      selectOpenRawUtilization(
        {
          five_hour: { utilization: 0.91, resets_at: now },
          seven_day: { utilization: 0.55, resets_at: now - 1 },
        },
        now,
      ),
    ).toEqual({})
  })

  test('Y0a can drop only the expired 5h window', () => {
    const now = 1_700_000_000
    expect(
      selectOpenRawUtilization(
        {
          five_hour: { utilization: 0.8, resets_at: now - 10 },
          seven_day: { utilization: 0.2, resets_at: now + 10 },
        },
        now,
      ),
    ).toEqual({
      seven_day: { utilization: 0.2, resets_at: now + 10 },
    })
  })

  test('getRawUtilization applies Y0a', () => {
    const src = readFileSync(
      join(import.meta.dir, '../claudeAiLimits.ts'),
      'utf8',
    )
    expect(src).toContain('selectOpenRawUtilization(rawUtilization)')
  })

  test('StatusLine reads filtered getRawUtilization', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../components/StatusLine.tsx'),
      'utf8',
    )
    expect(src).toContain('getRawUtilization()')
    expect(src).toContain(
      'used_percentage: rawUtil.five_hour.utilization * 100',
    )
  })
})
