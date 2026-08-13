/**
 * densable 2.1.219 #6 — normalizeMessage surfaces subagent_type /
 * task_description / parent_tool_use_id on agent_progress frames.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

// Avoid bootstrap/state side effects from getSessionId — snap+restore for co-suites.
const realBootstrap = await import('../../bootstrap/state.js')
const bootstrapSnap = snapshotModuleExports(realBootstrap)
mock.module('src/bootstrap/state.js', () => ({
  ...bootstrapSnap,
  getSessionId: () => 'test-session-id',
  getIsNonInteractiveSession: () => true,
  isReplBridgeActive: () => false,
}))
afterAll(() => {
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
})

import { normalizeMessage } from '../queryHelpers.js'
import type { Message } from 'src/types/message.js'

function makeProgressMessage(overrides?: {
  agentType?: string
  description?: string
  parentToolUseID?: string
  text?: string
}): Message {
  return {
    type: 'progress',
    uuid: 'prog-uuid-1',
    timestamp: new Date().toISOString(),
    toolUseID: 'agent_child-1',
    parentToolUseID: overrides?.parentToolUseID ?? 'parent-tool-use-1',
    data: {
      type: 'agent_progress',
      prompt: '',
      agentId: 'child-1',
      agentType: overrides?.agentType ?? 'Explore',
      description: overrides?.description ?? 'scan files',
      message: {
        type: 'assistant',
        uuid: 'asst-uuid-1',
        timestamp: new Date().toISOString(),
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4',
          content: [
            {
              type: 'text',
              text: overrides?.text ?? 'partial subagent text',
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    },
  } as unknown as Message
}

describe('densable 2.1.219 #6 normalizeMessage agent_progress fields', () => {
  test('emits assistant with parent_tool_use_id + subagent_type + task_description', () => {
    const out = [...normalizeMessage(makeProgressMessage())]
    expect(out.length).toBeGreaterThanOrEqual(1)
    const asst = out.find(m => m.type === 'assistant')
    expect(asst).toBeDefined()
    expect(asst).toMatchObject({
      type: 'assistant',
      parent_tool_use_id: 'parent-tool-use-1',
      subagent_type: 'Explore',
      task_description: 'scan files',
      session_id: 'test-session-id',
    })
  })

  test('omits optional fields when agentType/description absent', () => {
    const msg = makeProgressMessage()
    const data = msg.data as {
      agentType?: string
      description?: string
    }
    delete data.agentType
    delete data.description
    const out = [...normalizeMessage(msg)]
    const asst = out.find(m => m.type === 'assistant') as
      | Record<string, unknown>
      | undefined
    expect(asst).toBeDefined()
    expect(asst?.parent_tool_use_id).toBe('parent-tool-use-1')
    expect('subagent_type' in (asst ?? {})).toBe(false)
    expect('task_description' in (asst ?? {})).toBe(false)
  })

  test('preserves nested parent_tool_use_id for depth-2+', () => {
    const out = [
      ...normalizeMessage(
        makeProgressMessage({ parentToolUseID: 'nested-parent-tu' }),
      ),
    ]
    const asst = out.find(m => m.type === 'assistant')
    expect(asst).toMatchObject({ parent_tool_use_id: 'nested-parent-tu' })
  })
})
