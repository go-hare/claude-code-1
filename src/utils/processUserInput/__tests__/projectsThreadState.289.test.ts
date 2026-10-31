import { describe, expect, test } from 'bun:test'
import {
  formatThreadStateAge,
  measureThreadState,
  snapshotProjectsThreadState,
} from '../projectsThreadState.js'

describe('densable 2.1.289 pDo projects thread state', () => {
  test('snapshotProjectsThreadState is no-op without utt gates', () => {
    expect(snapshotProjectsThreadState()).toBeUndefined()
  })

  test('formatThreadStateAge matches gold Uxn', () => {
    expect(formatThreadStateAge(0)).toBe('0m ago')
    expect(formatThreadStateAge(59 * 60_000)).toBe('59m ago')
    expect(formatThreadStateAge(61 * 60_000)).toBe('1h 1m ago')
  })

  test('measureThreadState counts assistant tool_use after last human', () => {
    const now = Date.parse('2026-01-01T00:10:00.000Z')
    const measured = measureThreadState(
      [
        {
          type: 'user',
          timestamp: '2026-01-01T00:00:00.000Z',
          origin: { kind: 'human' },
        },
        {
          type: 'assistant',
          timestamp: '2026-01-01T00:01:00.000Z',
          message: {
            content: [
              { type: 'tool_use' },
              { type: 'tool_use' },
              { type: 'text' },
            ],
          },
        },
      ],
      now,
    )
    expect(measured?.repliesSinceUser).toBe(2)
    expect(measured?.sinceUserMs).toBe(10 * 60_000)
  })
})
