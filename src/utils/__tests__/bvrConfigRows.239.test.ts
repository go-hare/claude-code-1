import { describe, expect, test } from 'bun:test'
import { SettingsSchema } from '../settings/types.js'
import {
  EDITOR_REPLY_FENCE,
  stripLastResponseFromEditor,
  wrapLastResponseForEditor,
} from '../promptEditor.js'
import { collectLastAssistantTextsForEditor } from '../messages.js'
import type { Message } from '../../types/message.js'

describe('densable 2.1.239 bvr hosted settings', () => {
  test('SettingsSchema has official switch/precompute/timestamp keys', () => {
    const shape = SettingsSchema().shape
    expect(shape.switchModelsOnFlag).toBeDefined()
    expect(shape.precomputeCompactionEnabled).toBeDefined()
    expect(shape.showMessageTimestamps).toBeDefined()
  })

  test('dqw/pqw wrap and strip last-response fence', () => {
    const wrapped = wrapLastResponseForEditor('hello\nworld')
    expect(wrapped).toContain("Claude's last response")
    expect(wrapped).toContain(EDITOR_REPLY_FENCE)
    expect(wrapped).toContain('# hello')
    expect(wrapped).toContain('# world')
    expect(stripLastResponseFromEditor(`${wrapped}my reply`)).toBe('my reply')
    expect(stripLastResponseFromEditor('plain')).toBe('plain')
  })

  test('jpo noStatusAfterApiError drops empty when last is api error', () => {
    const messages = [
      {
        type: 'assistant',
        isApiErrorMessage: true,
        message: {
          model: '<synthetic>',
          content: [{ type: 'text', text: 'err' }],
        },
      },
    ] as unknown as Message[]
    expect(
      collectLastAssistantTextsForEditor(messages, 8, 65536, {
        noStatusAfterApiError: true,
      }).messages,
    ).toEqual([])
  })

  test('jpo collects trailing assistant texts and stops at user', () => {
    const messages = [
      {
        type: 'user',
        message: { content: 'hi' },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'one' }] },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'two' }] },
      },
    ] as unknown as Message[]
    expect(collectLastAssistantTextsForEditor(messages).messages).toEqual([
      'one',
      'two',
    ])
  })
})
