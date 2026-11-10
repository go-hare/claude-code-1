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

  test('jkc formats setting stamps via timeFormat (auto + UTC override)', () => {
    const formatted = formatSettingMessageTimestamp(TS, 'UTC')
    expect(formatted).toContain('2026')
    expect(formatted).toContain('UTC')
    expect(formatted).toMatch(/04:08:00/)
  })

  test('2.1.289 _s / wDe / Qpo suppresses synthetic or empty XML user and queued_command messages', () => {
    const userWithText = (text: string) => ({
      type: 'user',
      timestamp: TS,
      message: { content: [{ type: 'text', text }] },
    })
    const queuedWithPrompt = (prompt: string) => ({
      type: 'attachment',
      timestamp: TS,
      attachment: { type: 'queued_command', prompt },
    })

    for (const sample of [
      '(no content)',
      '<tick>123</tick>',
      '<local-command-caveat>Caveat</local-command-caveat>',
      '<local-command-stdout></local-command-stdout>',
      '<local-command-stdout>(no content)</local-command-stdout>',
      '<bash-input></bash-input>',
      '<command-message></command-message>',
      '<user-memory-input></user-memory-input>',
      '<task-notification><status>completed</status></task-notification>',
      '<task-notification>\n<task-type>artifact-room-view</task-type>\n<summary>viewed</summary></task-notification>',
      '<task-notification>\n<tool-use-id>tu_1</tool-use-id>\n<task-type>tool_call</task-type>\n<summary>done</summary></task-notification>',
      '<mcp-resource-update></mcp-resource-update>',
    ]) {
      expect(
        shouldShowMessageTimestamp(userWithText(sample), false, true),
      ).toBe(false)
      expect(
        shouldShowMessageTimestamp(queuedWithPrompt(sample), false, true),
      ).toBe(false)
    }

    expect(
      shouldShowMessageTimestamp(
        userWithText('<local-command-stdout>Set model</local-command-stdout>'),
        false,
        true,
      ),
    ).toBe(true)
    expect(
      shouldShowMessageTimestamp(
        userWithText('<bash-input>ls -la</bash-input>'),
        false,
        true,
      ),
    ).toBe(true)
    expect(
      shouldShowMessageTimestamp(
        userWithText(
          '<task-notification><summary>Agent finished</summary></task-notification>',
        ),
        false,
        true,
      ),
    ).toBe(true)
  })
})
