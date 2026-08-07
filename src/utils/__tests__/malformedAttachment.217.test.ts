/**
 * densable 2.1.217 #10 — nXu / dQr malformed attachment resume guard
 */
import { describe, expect, test } from 'bun:test'
import {
  dropMalformedAttachments,
  isValidAttachmentPayload,
} from '../conversationRecovery.js'
import type { Message } from '../../types/message.js'

function attachmentMsg(attachment: unknown): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-000000000001',
    timestamp: new Date().toISOString(),
    attachment,
  } as Message
}

describe('malformed attachment densable 2.1.217 #10', () => {
  test('nXu rejects null / non-object / missing type', () => {
    expect(isValidAttachmentPayload(null)).toBe(false)
    expect(isValidAttachmentPayload(undefined)).toBe(false)
    expect(isValidAttachmentPayload('x')).toBe(false)
    expect(isValidAttachmentPayload({})).toBe(false)
    expect(isValidAttachmentPayload({ type: 1 })).toBe(false)
  })

  test('nXu requires filename for new_file / path for new_directory', () => {
    expect(isValidAttachmentPayload({ type: 'new_file' })).toBe(false)
    expect(
      isValidAttachmentPayload({ type: 'new_file', filename: 'a.ts' }),
    ).toBe(true)
    expect(isValidAttachmentPayload({ type: 'new_directory' })).toBe(false)
    expect(
      isValidAttachmentPayload({ type: 'new_directory', path: '/tmp' }),
    ).toBe(true)
  })

  test('nXu accepts unknown types (default true)', () => {
    expect(isValidAttachmentPayload({ type: 'file', filename: 'x' })).toBe(true)
  })

  test('dQr drops malformed attachment messages and keeps others', () => {
    const good = attachmentMsg({ type: 'file', filename: 'ok.ts' })
    const badNull = attachmentMsg(null)
    const badNewFile = attachmentMsg({ type: 'new_file' })
    const user = {
      type: 'user',
      uuid: '00000000-0000-4000-8000-000000000002',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'hi' },
    } as Message

    const out = dropMalformedAttachments([good, badNull, badNewFile, user])
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(good)
    expect(out[1]).toBe(user)
  })

  test('dQr is identity when nothing dropped', () => {
    const msgs = [
      attachmentMsg({ type: 'new_file', filename: 'a.ts' }),
      attachmentMsg({ type: 'directory', path: '/x' }),
    ]
    expect(dropMalformedAttachments(msgs)).toBe(msgs)
  })
})
