import { afterEach, describe, expect, test } from 'bun:test'
import {
  checkRapidRefillBreaker,
  findLargerPreviousModelForCompact,
  getEffectiveContextWindowSize,
} from '../autoCompact.js'
import { resolveAutoCompactWindow } from '../../../utils/autoCompactWindow.js'
import type { Message } from '../../../types/message.js'

describe('2.1.301 #862/#863/#882 autoCompact window, thrashing breaker & model switch', () => {
  const prevDisableUnknown =
    process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT

  afterEach(() => {
    if (prevDisableUnknown === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT
    } else {
      process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT =
        prevDisableUnknown
    }
  })

  test('#863 resolveAutoCompactWindow returns unknown-model for unrecognized gateway model', () => {
    delete process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT
    const resolved = resolveAutoCompactWindow(
      'gateway-custom-unknown-xyz',
      undefined,
    )
    expect(resolved.source).toBe('unknown-model')
    expect(
      getEffectiveContextWindowSize('gateway-custom-unknown-xyz'),
    ).toBeGreaterThan(0)
  })

  test('#863 checkRapidRefillBreaker trips after 3 consecutive rapid refills within <3 turns', () => {
    expect(
      checkRapidRefillBreaker({
        compacted: true,
        turnId: 't1',
        turnCounter: 1,
        consecutiveRapidRefills: 0,
      }),
    ).toEqual({ action: 'proceed', consecutiveRapidRefills: 1 })

    expect(
      checkRapidRefillBreaker({
        compacted: true,
        turnId: 't2',
        turnCounter: 2,
        consecutiveRapidRefills: 2,
      }),
    ).toEqual({ action: 'trip', consecutiveRapidRefills: 3 })

    expect(
      checkRapidRefillBreaker({
        compacted: true,
        turnId: 't3',
        turnCounter: 3,
        consecutiveRapidRefills: 2,
      }),
    ).toEqual({ action: 'proceed', consecutiveRapidRefills: 0 })
  })

  test('#882/#862 findLargerPreviousModelForCompact selects larger previous model when at blocking limit, and skips credit-gated fable', () => {
    const bigText = 'x'.repeat(900_000)
    const makeHistory = (prevModel: string): Message[] => [
      {
        type: 'user',
        uuid: 'u-1',
        message: { role: 'user', content: bigText },
      } as unknown as Message,
      {
        type: 'assistant',
        uuid: 'a-1',
        message: {
          id: 'msg-1',
          role: 'assistant',
          model: prevModel,
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 195_000, output_tokens: 10 },
        },
      } as unknown as Message,
    ]

    // Opus 4.6 [1m] (1M) -> claude-3-5-sonnet-20241022 (200k): summarizes with larger prevModel
    const picked = findLargerPreviousModelForCompact(
      makeHistory('claude-opus-4-6[1m]'),
      'claude-3-5-sonnet-20241022',
    )
    expect(picked).toBe('claude-opus-4-6[1m]')

    // Switching to larger or equal window does not trigger previous-model compact
    expect(
      findLargerPreviousModelForCompact(
        makeHistory('claude-3-5-sonnet-20241022'),
        'claude-opus-4-6[1m]',
      ),
    ).toBeUndefined()
  })
})
