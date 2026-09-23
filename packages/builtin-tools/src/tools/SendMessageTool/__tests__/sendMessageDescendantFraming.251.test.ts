/**
 * densable 2.1.251 #50 — subagent SendMessage to main is lineage descendant.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  dequeue,
  getCommandQueue,
  remove,
} from 'src/utils/messageQueueManager.js'
import { wrapPeerOriginText } from 'src/utils/messages.js'
import { MAIN_RECIPIENT, SendMessageTool } from '../SendMessageTool.js'

function drainQueue(): void {
  while (getCommandQueue().length > 0) {
    const cmd = dequeue()
    if (cmd) remove([cmd])
  }
}

describe('densable 2.1.251 #50 subagent origin', () => {
  beforeEach(() => {
    drainQueue()
  })
  afterEach(() => {
    drainQueue()
  })

  test('subagent to main is an in-session descendant, not an outside peer', async () => {
    const result = await SendMessageTool.call!(
      {
        to: MAIN_RECIPIENT,
        summary: 'status update',
        message: 'worker finished the scan',
      },
      {
        agentId: 'agent-worker-1',
        getAppState: () => ({
          tasks: {
            'agent-worker-1': {
              type: 'local_agent',
              agentType: 'worker',
              status: 'running',
            },
          },
          agentNameRegistry: new Map([['worker', 'agent-worker-1']]),
        }),
        setAppState: () => {},
      } as never,
      (async () => ({ behavior: 'allow' as const, updatedInput: {} })) as never,
      {
        type: 'assistant',
        uuid: '00000000-0000-4000-8000-000000000002',
        message: { role: 'assistant', content: [] },
      } as never,
    )
    expect(result.data.success).toBe(true)
    const cmd = getCommandQueue()[0]
    const origin = cmd?.origin as
      | { kind?: string; lineage?: string }
      | undefined
    expect(origin?.kind).toBe('peer')
    expect(origin?.lineage).toBe('descendant')
    const framed = wrapPeerOriginText(String(cmd?.value), {
      midTurn: false,
      lineage: 'descendant',
    })
    expect(framed).toContain('working inside this same session')
  })
})
