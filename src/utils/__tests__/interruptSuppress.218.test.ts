/**
 * densable 2.1.218 #12 — m0e/Cxg suppress interrupt markers for
 * interrupt + refusal-fallback-edit; Ede marks shutdown.
 */
import { describe, expect, test } from 'bun:test'
import {
  createAbortErrorReason,
  getAbortReasonMessage,
  isInterruptAbortReason,
  isShutdownAbortReason,
  shouldSuppressInterruptionMessage,
} from '../abortController.js'
import { createUserInterruptionMessage } from '../messages.js'

describe('densable 2.1.218 #12 interrupt suppress', () => {
  test('m0e: interrupt and refusal-fallback-edit suppress message', () => {
    expect(shouldSuppressInterruptionMessage('interrupt')).toBe(true)
    expect(shouldSuppressInterruptionMessage('refusal-fallback-edit')).toBe(
      true,
    )
    expect(
      shouldSuppressInterruptionMessage(
        createAbortErrorReason('refusal-fallback-edit'),
      ),
    ).toBe(true)
  })

  test('m0e: user-cancel / undefined / empty do not suppress', () => {
    expect(shouldSuppressInterruptionMessage('user-cancel')).toBe(false)
    expect(shouldSuppressInterruptionMessage(undefined)).toBe(false)
    expect(shouldSuppressInterruptionMessage('')).toBe(false)
    expect(shouldSuppressInterruptionMessage('background')).toBe(false)
  })

  test('isInterruptAbortReason still only interrupt', () => {
    expect(isInterruptAbortReason('interrupt')).toBe(true)
    expect(isInterruptAbortReason('refusal-fallback-edit')).toBe(false)
  })

  test('Ede: shutdown abort reason', () => {
    expect(isShutdownAbortReason('shutdown')).toBe(true)
    expect(isShutdownAbortReason(createAbortErrorReason('shutdown'))).toBe(true)
    expect(isShutdownAbortReason('user-cancel')).toBe(false)
  })

  test('Tse: toolUse toggles text; fields plumb', () => {
    const plain = createUserInterruptionMessage({ toolUse: false })
    const tool = createUserInterruptionMessage({
      toolUse: true,
      interruptedByShutdown: true,
      interruptedMessageId: 'msg_abc',
    })
    const plainText =
      typeof plain.message.content === 'string'
        ? plain.message.content
        : (plain.message.content as { text: string }[])[0]?.text
    const toolText =
      typeof tool.message.content === 'string'
        ? tool.message.content
        : (tool.message.content as { text: string }[])[0]?.text
    expect(plainText).toBe('[Request interrupted by user]')
    expect(toolText).toBe('[Request interrupted by user for tool use]')
    expect(tool.interruptedByShutdown).toBe(true)
    expect(tool.interruptedMessageId).toBe('msg_abc')
  })

  test('getAbortReasonMessage unwraps DOMException AbortError', () => {
    expect(
      getAbortReasonMessage(createAbortErrorReason('refusal-fallback-edit')),
    ).toBe('refusal-fallback-edit')
  })
})
