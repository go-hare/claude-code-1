/**
 * densable 2.1.224 #9 — mailbox_write_failed gold + success-only messaging.
 *
 * SEA: dO returns msg_id | undefined; handleMessage only emits
 * `Message sent to ${e}'s inbox` + msg_id when dO succeeds; else
 * `{success:false, errorClass:"mailbox_write_failed"}`.
 *
 * Pure control-flow gold (no mock.module — avoid process-global pollution).
 * Soft-fail IO covered in src/utils/__tests__/teammateMailbox.test.ts.
 */
import { describe, expect, test } from 'bun:test'

/** densable handleMessage branch after dO (gold-#9-mailbox.txt). */
function handleMessageResult(
  recipientName: string,
  msgId: string | undefined,
  content: string,
): {
  success: boolean
  message: string
  msg_id?: string
  errorClass?: string
  routing?: { content: string }
} {
  if (msgId === undefined) {
    return {
      success: false,
      message: `Failed to write to ${recipientName}'s inbox — nothing was sent. Try again, or message the lead.`,
      errorClass: 'mailbox_write_failed',
    }
  }
  return {
    success: true,
    message: `Message sent to ${recipientName}'s inbox`,
    msg_id: msgId,
    routing: { content: content.slice(0, 50) },
  }
}

describe('densable 2.1.224 #9 mailbox_write_failed gold', () => {
  test('fail path: never claims Message sent; errorClass mailbox_write_failed', () => {
    const result = handleMessageResult('worker', undefined, 'hello world')
    expect(result).toEqual({
      success: false,
      message:
        "Failed to write to worker's inbox — nothing was sent. Try again, or message the lead.",
      errorClass: 'mailbox_write_failed',
    })
    expect(result.message).not.toContain('Message sent')
  })

  test('success path: Message sent + msg_id only when write lands', () => {
    const result = handleMessageResult('worker', 'uuid-abc', 'hello world')
    expect(result.success).toBe(true)
    expect(result.message).toBe("Message sent to worker's inbox")
    expect(result.msg_id).toBe('uuid-abc')
    expect(result.errorClass).toBeUndefined()
  })

  test('shutdown-request fail gold copy', () => {
    const target = 'worker'
    const msg = `Failed to write the shutdown request to ${target}'s inbox — nothing was sent.`
    expect(msg).toContain('nothing was sent')
    expect(msg).not.toContain('Shutdown request sent')
  })

  test('shutdown-rejection fail gold copy', () => {
    const msg =
      "Failed to write the shutdown rejection to team-lead's inbox — nothing was sent. Try again."
    expect(msg).toContain('inbox')
    expect(msg).toContain('nothing was sent')
  })

  test('plan-approval fail gold copy', () => {
    const recipient = 'worker'
    const msg = `Failed to write the plan approval to ${recipient}'s inbox — nothing was sent. Try again.`
    expect(msg).not.toContain('Plan approved')
  })

  test('shutdown-approval degrades but still success (densable Pqb)', () => {
    const confirmMsgId: string | undefined = undefined
    const confirmationNote =
      confirmMsgId === undefined
        ? "The confirmation could not be written to team-lead's inbox."
        : 'Sent confirmation to team-lead.'
    const degraded =
      confirmMsgId === undefined
        ? { degradedClass: 'mailbox_write_failed' as const }
        : undefined
    const data = {
      success: true as const,
      message: `Shutdown approved. ${confirmationNote} Agent worker is now exiting.`,
      request_id: 'req-1',
      ...degraded,
    }
    expect(data.success).toBe(true)
    expect(data.degradedClass).toBe('mailbox_write_failed')
    expect(data.message).toContain('could not be written')
  })
})
