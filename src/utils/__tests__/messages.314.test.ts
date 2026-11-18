import { describe, expect, test } from 'bun:test'
import {
  isSyntheticMessage,
  REJECT_MESSAGE,
  STOPPED_WHILE_RUNNING_REJECT_MESSAGE,
  SYNTHETIC_MESSAGES,
} from '../messages.js'
import type { UserMessage } from '../../types/message.js'

describe('messages #1399 STOPPED_WHILE_RUNNING_REJECT_MESSAGE', () => {
  test('includes REJECT_MESSAGE prefix and stopped-while-running correction', () => {
    expect(
      STOPPED_WHILE_RUNNING_REJECT_MESSAGE.startsWith(REJECT_MESSAGE),
    ).toBe(true)
    expect(STOPPED_WHILE_RUNNING_REJECT_MESSAGE).toContain(
      'this call was stopped while running, not refused before it ran',
    )
    expect(STOPPED_WHILE_RUNNING_REJECT_MESSAGE).toContain(
      'It may have run in part or in full, and its changes may have been written',
    )
  })

  test('is registered in SYNTHETIC_MESSAGES and recognized by isSyntheticMessage', () => {
    expect(SYNTHETIC_MESSAGES.has(STOPPED_WHILE_RUNNING_REJECT_MESSAGE)).toBe(
      true,
    )
    const msg = {
      type: 'user',
      uuid: '00000000-0000-0000-0000-000000000001',
      message: {
        role: 'user',
        content: [{ type: 'text', text: STOPPED_WHILE_RUNNING_REJECT_MESSAGE }],
      },
    } as unknown as UserMessage
    expect(isSyntheticMessage(msg)).toBe(true)
  })
})
