import { afterEach, describe, expect, test } from 'bun:test'
import type { Message } from '../../../types/message.js'
import { buildTranscriptEntries } from '../yoloClassifier.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_AUTO_MODE_PRIOR_ASSISTANT_CONTEXT
})

function userMsg(
  text: string,
  opts: { isMeta?: boolean; origin?: unknown } = {},
): Message {
  return {
    type: 'user',
    uuid: '00000000-0000-4000-8000-000000000001',
    message: { role: 'user', content: text },
    ...(opts.isMeta ? { isMeta: true } : {}),
    ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
  } as Message
}

function queued(
  prompt: string,
  opts: { isMeta?: boolean; origin?: unknown; commandMode?: string } = {},
): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-000000000002',
    attachment: {
      type: 'queued_command',
      prompt,
      ...(opts.isMeta ? { isMeta: true } : {}),
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
      ...(opts.commandMode ? { commandMode: opts.commandMode } : {}),
      addedNames: [],
      addedLines: [],
      removedNames: [],
    },
  } as Message
}

describe('buildTranscriptEntries isMeta filter (2.1.207 QPu)', () => {
  test('includes ordinary human user text', () => {
    const entries = buildTranscriptEntries([userMsg('please edit foo.ts')])
    expect(entries).toHaveLength(1)
    expect(entries[0]?.role).toBe('user')
    expect(entries[0]?.content).toEqual([
      { type: 'text', text: 'please edit foo.ts' },
    ])
  })

  test('skips isMeta user without origin (system conversation update)', () => {
    const entries = buildTranscriptEntries([
      userMsg('human turn'),
      userMsg('<system-reminder>idle</system-reminder>', { isMeta: true }),
      userMsg('another human'),
    ])
    expect(entries.map(e => (e.content[0] as { text: string }).text)).toEqual([
      'human turn',
      'another human',
    ])
  })

  test('keeps isMeta user when origin is set (peer / channel / etc.)', () => {
    const entries = buildTranscriptEntries([
      userMsg('from teammate', {
        isMeta: true,
        origin: { kind: 'peer' },
      }),
    ])
    expect(entries).toHaveLength(1)
    expect((entries[0]?.content[0] as { text: string }).text).toBe(
      'from teammate',
    )
  })

  test('skips meta queued_command without origin', () => {
    const entries = buildTranscriptEntries([
      queued('system queue noise', { isMeta: true }),
      queued('real queued human'),
    ])
    expect(entries).toHaveLength(1)
    expect((entries[0]?.content[0] as { text: string }).text).toBe(
      'real queued human',
    )
  })

  test('keeps task-notification queued even if isMeta', () => {
    const entries = buildTranscriptEntries([
      queued('task done: build', {
        isMeta: true,
        commandMode: 'task-notification',
      }),
    ])
    expect(entries).toHaveLength(1)
  })

  test('default: assistant text is omitted (only tool_use)', () => {
    const entries = buildTranscriptEntries([
      {
        type: 'assistant',
        uuid: '00000000-0000-4000-8000-000000000010',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will edit foo' },
            {
              type: 'tool_use',
              id: 't1',
              name: 'Edit',
              input: { file_path: 'foo.ts' },
            },
          ],
        },
      } as Message,
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]?.content.map(c => c.type)).toEqual(['tool_use'])
  })

  test('priorAssistantContext: includes assistant text before tool_use', () => {
    process.env.CLAUDE_CODE_AUTO_MODE_PRIOR_ASSISTANT_CONTEXT = '1'
    const entries = buildTranscriptEntries([
      {
        type: 'assistant',
        uuid: '00000000-0000-4000-8000-000000000011',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will edit foo' },
            {
              type: 'tool_use',
              id: 't1',
              name: 'Edit',
              input: { file_path: 'foo.ts' },
            },
          ],
        },
      } as Message,
    ])
    expect(entries[0]?.content.map(c => c.type)).toEqual(['text', 'tool_use'])
    expect((entries[0]?.content[0] as { text: string }).text).toBe(
      'I will edit foo',
    )
  })
})
