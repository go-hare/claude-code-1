import { describe, expect, test } from 'bun:test'
import {
  stripImagesFromMessages,
  stripReinjectedAttachments,
  stripToolPayloadsForNonEssential,
} from '../compact.js'
import type { Message } from '../../../types/message.js'

describe('compact.ts 1:1 SEA alignment (#792)', () => {
  test('stripToolPayloadsForNonEssential strips thinking blocks, wireToolInputs, wireIngestContext, and truncates tool payloads to 100 chars', () => {
    const longStr = 'x'.repeat(150)
    const messages = [
      {
        type: 'assistant',
        uuid: 'a1',
        wireToolInputs: { a: 1 },
        wireIngestContext: { b: 2 },
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'secret' },
            { type: 'redacted_thinking', data: 'abc' },
            {
              type: 'tool_use',
              id: 't1',
              name: 'Bash',
              input: { command: longStr, nested: [longStr] },
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: [{ type: 'text', text: longStr }],
            },
          ],
        },
      },
    ] as unknown as Message[]

    const result = stripToolPayloadsForNonEssential(messages)
    const assistant = result[0] as unknown as {
      wireToolInputs?: unknown
      wireIngestContext?: unknown
      message: {
        content: Array<{
          type: string
          input?: { command: string; nested: string[] }
        }>
      }
    }
    expect(assistant.wireToolInputs).toBeUndefined()
    expect(assistant.wireIngestContext).toBeUndefined()
    expect(assistant.message.content).toHaveLength(1)
    expect(assistant.message.content[0]?.type).toBe('tool_use')
    expect(assistant.message.content[0]?.input?.command).toBe(
      `${'x'.repeat(100)}…[truncated, original 150 chars]`,
    )
    expect(assistant.message.content[0]?.input?.nested[0]).toBe(
      `${'x'.repeat(100)}…[truncated, original 150 chars]`,
    )

    const user = result[1] as unknown as {
      message: { content: Array<{ type: string; content: string }> }
    }
    expect(user.message.content[0]?.content).toBe(
      `${'x'.repeat(100)}…[truncated, original 150 chars]`,
    )
  })

  test('stripReinjectedAttachments drops poll_events, dir_sync_notice, fork_briefing, thinking_stripped, advisor_stripped', () => {
    const messages = [
      { type: 'attachment', attachment: { type: 'poll_events' } },
      { type: 'attachment', attachment: { type: 'dir_sync_notice' } },
      { type: 'attachment', attachment: { type: 'fork_briefing' } },
      { type: 'attachment', attachment: { type: 'thinking_stripped' } },
      { type: 'attachment', attachment: { type: 'advisor_stripped' } },
      { type: 'attachment', attachment: { type: 'date_change' } },
    ] as unknown as Message[]

    const filtered = stripReinjectedAttachments(messages)
    expect(filtered).toHaveLength(1)
    expect(
      (filtered[0] as { attachment: { type: string } }).attachment.type,
    ).toBe('date_change')
  })

  test('stripImagesFromMessages handles queued_command, file image/notebook/parts, and message_pdf_reads', () => {
    const messages = [
      {
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          prompt: [
            { type: 'image', source: {} },
            { type: 'document', source: {} },
            { type: 'text', text: 'hi' },
          ],
        },
      },
      {
        type: 'attachment',
        attachment: {
          type: 'file',
          filename: 'pic.png',
          content: { type: 'image' },
        },
      },
      {
        type: 'attachment',
        attachment: {
          type: 'message_pdf_reads',
          reads: [{ path: 'a.pdf' }],
        },
      },
    ] as unknown as Message[]

    const stripped = stripImagesFromMessages(messages) as unknown as Array<{
      attachment: {
        prompt?: Array<{ type: string; text?: string }>
        content?: { type: string; file?: { content: string } }
        reads?: unknown[]
      }
    }>
    expect(stripped[0]?.attachment.prompt).toEqual([
      { type: 'text', text: '[image]' },
      { type: 'text', text: '[document]' },
      { type: 'text', text: 'hi' },
    ])
    expect(stripped[1]?.attachment.content?.file?.content).toBe('[image]')
    expect(stripped[2]?.attachment.reads).toEqual([])
  })
})
