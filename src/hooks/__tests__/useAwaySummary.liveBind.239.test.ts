import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isAwaySummaryLiveEnabled,
  resolveRecapDelayMs,
  shouldGenerateAwaySummary,
} from '../useAwaySummary.js'
import { createAwaySummaryMessage } from '../../utils/messages.js'
import type { Message } from '../../types/message.js'

const src = readFileSync(join(import.meta.dir, '../useAwaySummary.ts'), 'utf8')

describe('densable XiH live recap gate', () => {
  test('off + generate path does not append', () => {
    const appended: Message[] = []
    const enoughTurns: Message[] = [
      { type: 'user', isMeta: false } as Message,
      { type: 'user', isMeta: false } as Message,
      { type: 'user', isMeta: false } as Message,
    ]
    function generate(awaySummaryEnabled: boolean | undefined): void {
      if (
        !shouldGenerateAwaySummary({
          awaySummaryEnabled,
          gbEnabled: true,
          featureOn: true,
          messages: enoughTurns,
        })
      ) {
        return
      }
      appended.push(createAwaySummaryMessage('recap'))
    }

    generate(false)
    expect(appended).toEqual([])

    generate(undefined)
    expect(appended).toHaveLength(1)
    expect(appended[0]?.type).toBe('system')
    if (appended[0]?.type === 'system') {
      expect(appended[0].subtype).toBe('away_summary')
    }
  })

  test('env force-on overrides /config off', () => {
    expect(
      isAwaySummaryLiveEnabled({
        awaySummaryEnabled: false,
        gbEnabled: false,
        featureOn: false,
        env: { CLAUDE_CODE_ENABLE_AWAY_SUMMARY: '1' },
      }),
    ).toBe(true)
  })

  test('env force-off wins over AppState on', () => {
    expect(
      isAwaySummaryLiveEnabled({
        awaySummaryEnabled: true,
        gbEnabled: true,
        featureOn: true,
        env: { CLAUDE_CODE_ENABLE_AWAY_SUMMARY: '0' },
      }),
    ).toBe(false)
  })

  test('Ogo requires 3 human turns before first recap', () => {
    const { shouldRecapByTurnCount } =
      require('../useAwaySummary.js') as typeof import('../useAwaySummary.js')
    const users = (n: number): Message[] =>
      Array.from(
        { length: n },
        () => ({ type: 'user', isMeta: false }) as Message,
      )
    expect(shouldRecapByTurnCount([])).toBe(false)
    expect(shouldRecapByTurnCount(users(2))).toBe(false)
    expect(shouldRecapByTurnCount(users(3))).toBe(true)
  })

  test('isLoggableMessage persists goal_status for resume', async () => {
    const { isLoggableMessage } = await import('../../utils/sessionStorage.js')
    expect(
      isLoggableMessage({
        type: 'attachment',
        attachment: { type: 'goal_status', met: true, condition: '1+1' },
      } as never),
    ).toBe(true)
  })

  test('generate() and idle effect re-check live enablement', () => {
    expect(src).toContain('useAppState(s => s.awaySummaryEnabled)')
    expect(src).toContain('shouldGenerateAwaySummary')
    expect(src).toContain('awaySummaryEnabledRef.current')
    expect(src).not.toContain('getInitialSettings()')
  })

  test('gold recap generates while blurred and does not abort on focus', () => {
    expect(src).toContain('BLUR_DELAY_MS = 180_000')
    expect(src).toContain('MIN_RECAP_DELAY_MS = 30_000')
    expect(src).toContain('tengu_sedge_lantern_config')
    expect(src).toContain('disable recaps in /config')
    expect(src).toContain('do NOT abort in-flight generate')
    expect(src).toContain('armAwayTimer()')
    expect(src).toContain("state === 'blurred'")
    expect(src).toContain('lastTurnEndRef')
    expect(src).toContain('turnEnd === null')
    expect(src).toContain("focus !== 'blurred' && focus !== 'unknown'")
    expect(src).not.toContain(
      '// densable #M blurred: arm wait from last turn-end (isLoading effect).',
    )
  })

  test('Lgo delayMs floors at xgo and falls back to hrt', () => {
    expect(resolveRecapDelayMs({ delayMs: 10_000 })).toBe(30_000)
    expect(resolveRecapDelayMs({ delayMs: 120_000 })).toBe(120_000)
    expect(resolveRecapDelayMs({ delayMs: Number.NaN })).toBe(180_000)
    expect(resolveRecapDelayMs({})).toBe(180_000)
    expect(resolveRecapDelayMs(null)).toBe(180_000)
  })
})
