/**
 * densable 2.1.229 #7 residual — Write/Edit non-string file_path must not
 * reach expandPath during resume rehydrate (extractReadFilesFromMessages).
 */
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import type { Message } from 'src/types/message.js'
import { extractReadFilesFromMessages } from '../queryHelpers.js'

function assistantTool(
  name: string,
  toolUseId: string,
  input: Record<string, unknown>,
): Message {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name,
          input,
        },
      ],
    },
  } as Message
}

describe('extractReadFilesFromMessages densable #7 Write/Edit nst gate', () => {
  test('Write with object file_path does not throw and is skipped', () => {
    const messages = [
      assistantTool('Write', 'toolu_w1', {
        file_path: { not: 'a string' },
        content: 'hello',
      }),
    ]
    expect(() => extractReadFilesFromMessages(messages, '/tmp')).not.toThrow()
  })

  test('Edit with number file_path does not throw and is skipped', () => {
    const messages = [
      assistantTool('Edit', 'toolu_e1', {
        file_path: 99,
        old_string: 'a',
        new_string: 'b',
      }),
    ]
    expect(() => extractReadFilesFromMessages(messages, '/tmp')).not.toThrow()
  })

  test('Write with string file_path still rehydrates content', () => {
    const id = 'toolu_w2'
    const abs = '/tmp/write-safe-fixture.ts'
    const messages = [
      assistantTool('Write', id, {
        file_path: abs,
        content: 'export const x = 1\n',
      }),
      {
        type: 'user',
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: id,
              content: 'ok',
            },
          ],
        },
      } as Message,
    ]
    const cache = extractReadFilesFromMessages(messages, '/tmp')
    const entry = cache.get(abs)
    expect(entry).toBeDefined()
    expect(entry!.content).toContain('export const x')
  })
})
