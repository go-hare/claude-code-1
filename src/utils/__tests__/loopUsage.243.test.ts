import { describe, expect, test } from 'bun:test'

import type { Message } from '../../types/message.js'
import {
  collectLoopUsageRows,
  formatLoopEvery,
  LOOP_USAGE_WIDE_MIN,
} from '../loopUsage.js'
import { createLoopScheduledTaskFireMessage } from '../loopNoopFold.js'

function fire(
  prompt: string,
  opts?: { cron?: string; isDynamic?: boolean; ts?: string },
): Message {
  return createLoopScheduledTaskFireMessage('loop fire', {
    cronKind: 'loop',
    loop: {
      prompt,
      cron: opts?.cron,
      isDynamic: opts?.isDynamic ?? false,
    },
  })
}

function assistant(tokens: {
  input_tokens: number
  output_tokens: number
}): Message {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [],
      usage: tokens,
    },
  }
}

describe('loopUsage 243', () => {
  test('Nh formats dynamic / minute / clock / fallback', () => {
    expect(formatLoopEvery({ isDynamic: true })).toBe('dynamic')
    expect(formatLoopEvery({ isDynamic: false })).toBe('?')
    expect(formatLoopEvery({ isDynamic: false, cron: '*/5 * * * *' })).toBe(
      '5m',
    )
    expect(formatLoopEvery({ isDynamic: false, cron: '0 */2 * * *' })).toBe(
      '2h',
    )
    expect(formatLoopEvery({ isDynamic: false, cron: '30 14 * * *' })).toBe(
      'at 14:30',
    )
  })

  test('qe/oe: fires increment runs and lastRunMs; usage adds tokens', () => {
    const first = fire('watch logs', { cron: '*/10 * * * *' })
    first.timestamp = '2026-09-02T00:00:00.000Z'
    const second = fire('watch logs', { cron: '*/10 * * * *' })
    second.timestamp = '2026-09-02T00:10:00.000Z'

    const rows = collectLoopUsageRows([
      first,
      assistant({ input_tokens: 100, output_tokens: 20 }),
      second,
      assistant({ input_tokens: 50, output_tokens: 10 }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]!.prompt).toBe('watch logs')
    expect(rows[0]!.runs).toBe(2)
    expect(rows[0]!.tokens).toBe(180)
    expect(rows[0]!.lastRunMs).toBe(Date.parse('2026-09-02T00:10:00.000Z'))
    expect(formatLoopEvery(rows[0]!)).toBe('10m')
  })

  test('unstamped loop fires are skipped (no invented prompt)', () => {
    const bare = createLoopScheduledTaskFireMessage('loop fire', {
      cronKind: 'loop',
    })
    expect(collectLoopUsageRows([bare])).toEqual([])
  })

  test('wide table threshold matches SEA Lh = Zs+24', () => {
    expect(LOOP_USAGE_WIDE_MIN).toBe(66)
  })
})
