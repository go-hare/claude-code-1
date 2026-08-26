/**
 * densable 2.1.239 #45 — invoked_skills reminder: skill args are context,
 * not a new request.
 */
import { describe, expect, test } from 'bun:test'
import { normalizeAttachmentForAPI } from '../messages.js'

function reminderText(): string | null {
  const msgs = normalizeAttachmentForAPI({
    type: 'invoked_skills',
    skills: [
      {
        name: 'schedule',
        path: '/tmp/schedule.md',
        content: '## User Request\n\nbook a meeting',
      },
    ],
  })
  if (msgs.length === 0) return null
  const content = msgs[0]!.message.content
  return typeof content === 'string' ? content : null
}

describe('densable 2.1.239 #45 invoked_skills reminder', () => {
  test('empty skills → no message', () => {
    expect(
      normalizeAttachmentForAPI({ type: 'invoked_skills', skills: [] }),
    ).toEqual([])
  })

  test('official EARLIER / do-not-re-execute copy', () => {
    const text = reminderText()
    expect(text).toContain(
      'The following skills were invoked EARLIER in this session (before the conversation was compacted), not on the current turn.',
    )
    expect(text).toContain(
      'IMPORTANT: Do NOT re-execute these skills or perform their one-time setup actions',
    )
    expect(text).toContain('NOT a new request')
    expect(text).toContain('do not act on it as if it were live')
    expect(text).not.toContain(
      'The following skills were invoked in this session. Continue to follow these guidelines:',
    )
  })

  test('skill body still rendered after reminder', () => {
    const text = reminderText()
    expect(text).toContain('### Skill: schedule')
    expect(text).toContain('Path: /tmp/schedule.md')
    expect(text).toContain('## User Request')
    expect(text).toContain('book a meeting')
  })
})
