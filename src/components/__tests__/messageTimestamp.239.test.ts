import { describe, expect, test } from 'bun:test'
import {
  formatSettingMessageTimestamp,
  messageTimestampValue,
  shouldShowMessageTimestamp,
} from '../MessageTimestamp.js'

const TS = '2026-09-01T04:08:00.000Z'

describe('densable 2.1.239 cko / Kkc / jkc', () => {
  test('Kkc prefers queued_command attachment.timestamp', () => {
    expect(
      messageTimestampValue({
        type: 'attachment',
        timestamp: 'msg',
        attachment: { type: 'queued_command', timestamp: 'att' },
      }),
    ).toBe('att')
  })

  test('assistant: transcript text shows without setting; tools-only needs setting', () => {
    const text = {
      type: 'assistant',
      timestamp: TS,
      message: { content: [{ type: 'text', text: 'hi' }] },
    }
    const tools = {
      type: 'assistant',
      timestamp: TS,
      message: { content: [{ type: 'tool_use', id: '1' }] },
    }
    expect(shouldShowMessageTimestamp(text, true, false)).toBe(true)
    expect(shouldShowMessageTimestamp(text, false, false)).toBe(false)
    expect(shouldShowMessageTimestamp(text, false, true)).toBe(true)
    expect(shouldShowMessageTimestamp(tools, true, false)).toBe(false)
    expect(shouldShowMessageTimestamp(tools, false, true)).toBe(true)
  })

  test('user stamps only when setting on and not compact/split', () => {
    const user = {
      type: 'user',
      timestamp: TS,
      message: { content: [{ type: 'text', text: 'hello' }] },
    }
    expect(shouldShowMessageTimestamp(user, false, false)).toBe(false)
    expect(shouldShowMessageTimestamp(user, false, true)).toBe(true)
    expect(
      shouldShowMessageTimestamp(
        { ...user, isCompactSummary: true },
        false,
        true,
      ),
    ).toBe(false)
    expect(shouldShowMessageTimestamp(user, false, true, true)).toBe(false)
  })

  test('jkc formats setting stamps as YYYY-MM-DD HH:mm:ss TZ', () => {
    const formatted = formatSettingMessageTimestamp(TS, 'UTC')
    expect(formatted).toMatch(/^2026-09-01 04:08:00 UTC$/)
  })
})
