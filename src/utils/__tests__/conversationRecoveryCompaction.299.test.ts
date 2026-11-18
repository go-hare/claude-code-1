import { describe, expect, test } from 'bun:test'
import { detectTurnInterruption } from '../conversationRecovery.js'
import type { NormalizedMessage } from '../../types/message.js'

function userMsg(
  content: string,
  extra: Record<string, unknown> = {},
): NormalizedMessage {
  return {
    type: 'user',
    uuid: `u-${Math.random()}`,
    message: { role: 'user', content },
    ...extra,
  } as unknown as NormalizedMessage
}

function assistantMsg(content: string): NormalizedMessage {
  return {
    type: 'assistant',
    uuid: `a-${Math.random()}`,
    message: { role: 'assistant', content: [{ type: 'text', text: content }] },
  } as unknown as NormalizedMessage
}

describe('2.1.299 #691 conversationRecovery across trailing meta context rows', () => {
  test('detects interrupted_turn when user prompt is followed by meta context rows (turnCompanion / sourceToolUseID)', () => {
    const messages: NormalizedMessage[] = [
      assistantMsg('Previous turn'),
      userMsg('Please fix the build'),
      userMsg('<system-reminder>post-compaction context</system-reminder>', {
        isMeta: true,
        turnCompanion: true,
      }),
    ]
    expect(detectTurnInterruption(messages)).toEqual({
      kind: 'interrupted_turn',
    })
  })

  test('returns none when trailing meta row has queueTranscriptOnly=true (no-reply note)', () => {
    const messages: NormalizedMessage[] = [
      assistantMsg('Previous turn'),
      userMsg('Hello'),
      userMsg('No response requested.', {
        isMeta: true,
        queueTranscriptOnly: true,
      }),
    ]
    expect(detectTurnInterruption(messages)).toEqual({ kind: 'none' })
  })

  test('returns none when trailing meta row sits after a completed assistant turn', () => {
    const messages: NormalizedMessage[] = [
      userMsg('Hello'),
      assistantMsg('Done!'),
      userMsg('<system-reminder>hook context</system-reminder>', {
        isMeta: true,
        turnCompanion: true,
      }),
    ]
    expect(detectTurnInterruption(messages)).toEqual({ kind: 'none' })
  })
})
