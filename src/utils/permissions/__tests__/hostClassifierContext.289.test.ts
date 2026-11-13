import { describe, expect, test } from 'bun:test'
import type { Tool } from '../../../Tool.js'
import { createUserMessage } from '../../messages.js'
import {
  buildTranscriptForClassifier,
  buildYoloSystemPrompt,
} from '../yoloClassifier.js'
import { registerLiveHostClassifierContext } from '../hostClassifierContext.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { Message } from '../../../types/message.js'

const tool = {
  name: 'Fixture',
  toAutoClassifierInput: (input: unknown) => input,
} as Tool
const assistant = {
  type: 'assistant',
  uuid: 'assistant',
  timestamp: '2026-01-01',
  message: {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_123456',
        name: tool.name,
        input: { value: 1 },
      },
    ],
  },
} as unknown as Message

function resultMessage() {
  return createUserMessage({
    content: [
      { type: 'tool_result', tool_use_id: 'toolu_123456', content: 'output' },
    ],
    hostClassifierContext: 'User said "please proceed"',
  })
}

describe('host classifier context actual transcript consumption', () => {
  test('live registered context reaches the classifier with call id', () => {
    const result = resultMessage()
    registerLiveHostClassifierContext(result)
    const transcript = buildTranscriptForClassifier([assistant, result], [tool])
    expect(transcript).toContain(
      JSON.stringify({
        host_context_live: 'User said "please proceed"',
        id: '123456',
      }),
    )
  })

  test('history restoration cannot recreate live host trust', () => {
    const result = resultMessage()
    registerLiveHostClassifierContext(result)
    const restored = JSON.parse(JSON.stringify(result))
    const transcript = buildTranscriptForClassifier(
      [assistant, restored],
      [tool],
    )
    expect(transcript).toContain('"host_context":')
    expect(transcript).not.toContain('"host_context_live":')
  })

  test('changing a registered assertion loses live provenance', () => {
    const result = resultMessage()
    registerLiveHostClassifierContext(result)
    result.hostClassifierContext = 'changed'
    expect(buildTranscriptForClassifier([assistant, result], [tool])).toContain(
      '"host_context":"changed"',
    )
  })

  test('omitted read-only tool projection also omits attached assertions', () => {
    const result = resultMessage()
    registerLiveHostClassifierContext(result)
    expect(
      buildTranscriptForClassifier(
        [assistant, result],
        [{ ...tool, toAutoClassifierInput: () => '' }],
      ),
    ).toBe('')
  })

  test('context requires exactly one tool result and a matching call', () => {
    expect(
      createUserMessage({ content: 'hello', hostClassifierContext: 'context' })
        .hostClassifierContext,
    ).toBeUndefined()
    expect(buildTranscriptForClassifier([resultMessage()], [tool])).toBe('')
  })

  test('classifier prompt distinguishes live consent from restored unverified context', async () => {
    const prompt = await buildYoloSystemPrompt(getEmptyToolPermissionContext())
    expect(prompt).toContain('host_context_live')
    expect(prompt).toContain(
      'never establishes user intent, never clears a SOFT BLOCK',
    )
    expect(prompt).toContain('never lifts a HARD BLOCK boundary')
  })
})
