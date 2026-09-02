import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isAwaySummaryLiveEnabled,
  shouldGenerateAwaySummary,
} from '../useAwaySummary.js'
import { createAwaySummaryMessage } from '../../utils/messages.js'
import type { Message } from '../../types/message.js'

const src = readFileSync(join(import.meta.dir, '../useAwaySummary.ts'), 'utf8')

describe('densable XiH live recap gate', () => {
  test('off + generate path does not append', () => {
    const appended: Message[] = []
    function generate(awaySummaryEnabled: boolean | undefined): void {
      if (
        !shouldGenerateAwaySummary({
          awaySummaryEnabled,
          gbEnabled: true,
          featureOn: true,
          messages: [],
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

  test('generate() and idle effect re-check live enablement', () => {
    expect(src).toContain('useAppState(s => s.awaySummaryEnabled)')
    expect(src).toContain('shouldGenerateAwaySummary')
    expect(src).toContain('awaySummaryEnabledRef.current')
    expect(src).not.toContain('getInitialSettings()')
  })
})
