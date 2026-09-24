import { describe, expect, test } from 'bun:test'
import { SEND_MESSAGE_TOOL_NAME } from '@claude-code/builtin-tools/tools/SendMessageTool/constants.js'
import type { Message } from '../../types/message.js'
import {
  createIdleNotification,
  extractIdleNotificationResult,
  formatIdleNotificationResult,
  IDLE_RESULT_CHAR_CAP,
  sanitizeIdleResultText,
  sliceIdleResultUtf16,
  trimSanitizeIdleResult,
} from '../teammateMailbox.js'

describe('idle notification result (2.1.251 #16)', () => {
  test('carries the last assistant text', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'shipped the fix' }],
        },
      },
    ] as Message[]
    expect(extractIdleNotificationResult(messages)).toBe('shipped the fix')
  })

  test('skips an api error and keeps the prior answer', () => {
    const messages = [
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'partial' }] },
      },
      {
        type: 'assistant',
        isApiErrorMessage: true,
        message: { content: [{ type: 'text', text: 'error' }] },
      },
    ] as Message[]
    expect(extractIdleNotificationResult(messages)).toBe('partial')
  })

  test('createIdleNotification includes result', () => {
    const notification = createIdleNotification('worker', {
      idleReason: 'available',
      result: 'final answer',
    })
    expect(notification.result).toBe('final answer')
    expect(notification.type).toBe('idle_notification')
  })

  test('lyr passes through a result at the 4000-unit cap', () => {
    const result = 'x'.repeat(IDLE_RESULT_CHAR_CAP)
    const notification = createIdleNotification('worker', {
      idleReason: 'available',
      result,
    })
    expect(notification.result).toBe(result)
  })

  test('lyr appends the SendMessage rest marker when reachable', () => {
    const result = 'x'.repeat(IDLE_RESULT_CHAR_CAP + 1)
    const notification = createIdleNotification('worker', {
      idleReason: 'available',
      result,
    })
    expect(notification.result).toBe(
      `${'x'.repeat(IDLE_RESULT_CHAR_CAP)}\n[result truncated \u2014 ask the agent for the rest via ${SEND_MESSAGE_TOOL_NAME}]`,
    )
  })

  test('lyr uses the short marker when idleReason is failed', () => {
    const result = 'x'.repeat(IDLE_RESULT_CHAR_CAP + 1)
    const notification = createIdleNotification('worker', {
      idleReason: 'failed',
      result,
    })
    expect(notification.result).toBe(
      `${'x'.repeat(IDLE_RESULT_CHAR_CAP)}\n[result truncated]`,
    )
  })

  test('lyr uses the short marker when senderReachable is false', () => {
    expect(
      formatIdleNotificationResult('x'.repeat(IDLE_RESULT_CHAR_CAP + 1), false),
    ).toBe(`${'x'.repeat(IDLE_RESULT_CHAR_CAP)}\n[result truncated]`)
  })

  test('ce does not leave a lone high surrogate at the 4000 cut', () => {
    const result = `${'a'.repeat(3999)}\u{1F600}${'z'.repeat(8)}`
    const sliced = sliceIdleResultUtf16(
      trimSanitizeIdleResult(result),
      IDLE_RESULT_CHAR_CAP,
    )
    expect(sliced).toBe('a'.repeat(3999))
    for (let i = 0; i < sliced.length; i++) {
      const code = sliced.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = sliced.charCodeAt(i + 1)
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true)
      }
    }
    const notification = createIdleNotification('worker', { result })
    expect(notification.result).toBe(
      `${'a'.repeat(3999)}\n[result truncated \u2014 ask the agent for the rest via ${SEND_MESSAGE_TOOL_NAME}]`,
    )
  })

  test('$e trims first, then xP strips C0', () => {
    expect(sanitizeIdleResultText('\u0001ok\u0007')).toBe('ok')
    expect(trimSanitizeIdleResult('  hi  ')).toBe('hi')
    // trim leaves the C0s; xP then drops them and keeps inner spaces
    expect(trimSanitizeIdleResult('\u0001  \u0007')).toBe('  ')
    expect(
      createIdleNotification('worker', { result: '\u0001\u0007' }).result,
    ).toBeUndefined()
    expect(
      createIdleNotification('worker', { result: '   ' }).result,
    ).toBeUndefined()
  })

  test('IMe xP(summary) strips C0; empty after xP is still a string', () => {
    expect(createIdleNotification('worker', { summary: 'ok' }).summary).toBe(
      'ok',
    )
    expect(
      createIdleNotification('worker', {
        summary: '\u0001shipped\u0007',
      }).summary,
    ).toBe('shipped')
    expect(
      createIdleNotification('worker', { summary: '\u0001\u0007' }).summary,
    ).toBe('')
    expect(createIdleNotification('worker', {}).summary).toBeUndefined()
  })

  test('IMe does not invent e5e on failureReason', () => {
    expect(
      createIdleNotification('worker', {
        idleReason: 'failed',
        failureReason: '\u0001boom\u0007',
      }).failureReason,
    ).toBe('\u0001boom\u0007')
  })
})
