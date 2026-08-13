/**
 * densable 2.1.229 #25 — Ysa: PTL surfaces automatic compaction failure detail.
 */
import { describe, expect, test } from 'bun:test'
import {
  AUTOMATIC_COMPACTION_FAILED_DETAIL_MAX_WIDTH,
  annotatePromptTooLongWithCompactFailure,
  formatAutomaticCompactionFailed,
  truncateCompactFailureDetail,
} from '../reactiveCompact.js'
import { PROMPT_TOO_LONG_ERROR_MESSAGE } from '../../api/errors.js'
import type { AssistantMessage } from '../../../types/message.js'

describe('densable 2.1.229 #25 Ysa formatAutomaticCompactionFailed', () => {
  test('error+detail → Prompt is too long · automatic compaction failed: …', () => {
    const s = formatAutomaticCompactionFailed({
      reason: 'error',
      detail: 'summarize timed out',
    })
    expect(s).toBe(
      'Prompt is too long · automatic compaction failed: summarize timed out',
    )
    expect(s?.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)).toBe(true)
  })

  test('non-error reason → undefined (bare PTL)', () => {
    expect(
      formatAutomaticCompactionFailed({ reason: 'skipped', detail: 'x' }),
    ).toBeUndefined()
    expect(formatAutomaticCompactionFailed({ reason: 'error' })).toBeUndefined()
    expect(formatAutomaticCompactionFailed(undefined)).toBeUndefined()
    expect(formatAutomaticCompactionFailed(null)).toBeUndefined()
  })

  test('detail truncated at first sentence (densable Qa r=true) then width', () => {
    const s = formatAutomaticCompactionFailed({
      reason: 'error',
      detail: 'first sentence. second sentence should be dropped',
    })
    expect(s).toBe(
      'Prompt is too long · automatic compaction failed: first sentence…',
    )
  })

  test('detail max width constant densable m0b=300', () => {
    expect(AUTOMATIC_COMPACTION_FAILED_DETAIL_MAX_WIDTH).toBe(300)
    const long = 'a'.repeat(500)
    const clipped = truncateCompactFailureDetail(long)
    // truncateToWidth includes ellipsis within max width
    expect(clipped.length).toBeLessThanOrEqual(301)
    expect(clipped.endsWith('…') || clipped.length <= 300).toBe(true)
  })
})

describe('densable 2.1.229 #25 bua annotatePromptTooLongWithCompactFailure', () => {
  function ptlMessage(errorDetails?: string): AssistantMessage {
    return {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-000000000001',
      timestamp: new Date().toISOString(),
      isApiErrorMessage: true,
      errorDetails,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: PROMPT_TOO_LONG_ERROR_MESSAGE }],
      },
    } as AssistantMessage
  }

  test('annotates content and preserves errorDetails', () => {
    const msg = ptlMessage('prompt is too long: 200000 tokens > 180000 maximum')
    const out = annotatePromptTooLongWithCompactFailure(msg, {
      reason: 'error',
      detail: 'hook blocked',
    })
    const text = (out.message.content as { type: string; text: string }[])[0]
      ?.text
    expect(text).toBe(
      'Prompt is too long · automatic compaction failed: hook blocked',
    )
    expect(out.isApiErrorMessage).toBe(true)
    expect(out.errorDetails).toBe(msg.errorDetails)
  })

  test('no failure detail keeps original message', () => {
    const msg = ptlMessage()
    const out = annotatePromptTooLongWithCompactFailure(msg, {
      reason: 'aborted',
    })
    expect(out).toBe(msg)
  })
})
