import { describe, expect, test } from 'bun:test'
import {
  buildInterruptedOutputHintContent,
  buildInterruptedOutputNotice,
  canReplayContinueFromMessages,
  checkInterruptedOutputBoundary,
  escapeInterruptedOutputFence,
  formatPartialHintLog,
  formatPrefillBoundaryMismatchLog,
  isSyntheticPrefixUserMessage,
  stripTrailingIncompleteTurnMessages,
} from '../replyOnResume.js'
import { INTERRUPT_MESSAGE, NO_RESPONSE_REQUESTED } from '../messages.js'

describe('escapeInterruptedOutputFence', () => {
  test('escapes angle brackets only (official nLp)', () => {
    expect(escapeInterruptedOutputFence('a<b>&c>d')).toBe('a&lt;b&gt;&c&gt;d')
  })
})

describe('checkInterruptedOutputBoundary', () => {
  test('rejects empty', () => {
    expect(checkInterruptedOutputBoundary({ text: '' }, 'x').reason).toBe(
      'empty_text',
    )
  })
  test('rejects mismatch', () => {
    expect(
      checkInterruptedOutputBoundary(
        { text: 'hi', boundaryUuid: 'press' },
        'fork',
      ).reason,
    ).toBe('boundary_mismatch')
  })
  test('accepts matching or missing boundary', () => {
    expect(
      checkInterruptedOutputBoundary(
        { text: 'hi', boundaryUuid: 'same' },
        'same',
      ).accept,
    ).toBe(true)
    expect(checkInterruptedOutputBoundary({ text: 'hi' }, 'fork').accept).toBe(
      true,
    )
  })
})

describe('buildInterruptedOutputHintContent', () => {
  test('fences escaped partial with official copy', () => {
    const body = buildInterruptedOutputHintContent('partial <tool>')
    expect(body).toContain('<interrupted-output>')
    expect(body).toContain('partial &lt;tool&gt;')
    expect(body).toContain('</interrupted-output>')
    expect(body).toContain('interrupted mid-generation')
    expect(body).toContain('tool/file/web content')
    expect(body).toContain('without repeating it')
  })
})

describe('buildInterruptedOutputNotice', () => {
  test('includes partial when provided', () => {
    expect(buildInterruptedOutputNotice('hello')).toContain(
      'Text before the interruption',
    )
    expect(buildInterruptedOutputNotice('hello')).toContain('hello')
    expect(buildInterruptedOutputNotice()).toBe(
      'Continuing an interrupted response.',
    )
  })
})

describe('reply-on-resume logs', () => {
  test('boundary mismatch + partial hint', () => {
    expect(formatPrefillBoundaryMismatchLog('a', 'b')).toContain(
      'boundary mismatch',
    )
    expect(formatPartialHintLog(12)).toBe(
      '[reply-on-resume] partial-hint 12 chars',
    )
  })
})

describe('densable LVr / $co / bYt portable', () => {
  test('isSyntheticPrefixUserMessage detects NRR and interrupt', () => {
    expect(
      isSyntheticPrefixUserMessage({
        type: 'user',
        message: { content: NO_RESPONSE_REQUESTED },
      }),
    ).toBe(true)
    expect(
      isSyntheticPrefixUserMessage({
        type: 'user',
        message: { content: INTERRUPT_MESSAGE },
      }),
    ).toBe(true)
    expect(
      isSyntheticPrefixUserMessage({
        type: 'user',
        message: { content: 'real prompt' },
      }),
    ).toBe(false)
  })

  test('stripTrailingIncompleteTurnMessages drops NRR sentinel after user', () => {
    const msgs = [
      {
        type: 'user' as const,
        uuid: 'u1',
        message: { content: 'continue work' },
      },
      {
        type: 'assistant' as const,
        uuid: 'a1',
        message: { content: NO_RESPONSE_REQUESTED, stop_reason: null },
      },
    ]
    // Assistant with stop_reason null is incomplete → strip; pure NRR text may
    // not match lXg if stop_reason not null|tool_use — use synthetic user too.
    const withNrrUser = [
      {
        type: 'user' as const,
        uuid: 'u1',
        message: { content: 'continue work' },
      },
      {
        type: 'user' as const,
        uuid: 'u2',
        message: { content: NO_RESPONSE_REQUESTED },
      },
    ]
    const stripped = stripTrailingIncompleteTurnMessages(withNrrUser)
    expect(stripped).toHaveLength(1)
    expect(stripped[0]?.uuid).toBe('u1')
    void msgs
  })

  test('canReplayContinueFromMessages true only for real user tail', () => {
    expect(
      canReplayContinueFromMessages([
        { type: 'user', message: { content: 'do the thing' } },
      ]),
    ).toBe(true)
    expect(
      canReplayContinueFromMessages([
        { type: 'user', message: { content: 'do the thing' } },
        { type: 'assistant', message: { content: 'ok' } },
      ]),
    ).toBe(false)
    expect(
      canReplayContinueFromMessages([
        { type: 'user', message: { content: NO_RESPONSE_REQUESTED } },
      ]),
    ).toBe(false)
  })
})
