import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  dequeue,
  getCommandQueue,
  remove,
} from 'src/utils/messageQueueManager.js'
import { MAIN_RECIPIENT, SendMessageTool } from '../SendMessageTool.js'

function drainQueue(): void {
  while (getCommandQueue().length > 0) {
    const cmd = dequeue()
    if (cmd) remove([cmd])
  }
}

describe('SendMessage densable main recipient (Hco D6)', () => {
  beforeEach(() => {
    drainQueue()
  })
  afterEach(() => {
    drainQueue()
  })

  test('main → main refuses (you already are main)', async () => {
    const result = await SendMessageTool.call!(
      {
        to: MAIN_RECIPIENT,
        summary: 'hi main',
        message: 'hello from self',
      },
      {
        agentId: undefined,
        getAppState: () => ({ tasks: {}, agentNameRegistry: new Map() }),
        setAppState: () => {},
      } as any,
      (async () => ({ behavior: 'allow' as const, updatedInput: {} })) as any,
      {
        type: 'assistant',
        uuid: '00000000-0000-4000-8000-000000000001',
        message: { role: 'assistant', content: [] },
      } as any,
    )
    expect(result.data.success).toBe(false)
    expect(result.data.message).toContain('You are the main conversation')
    expect(result.data.message).toContain(MAIN_RECIPIENT)
    expect(getCommandQueue().length).toBe(0)
  })

  test('subagent → main enqueues peer origin prompt for next turn', async () => {
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
      } as any,
      (async () => ({ behavior: 'allow' as const, updatedInput: {} })) as any,
      {
        type: 'assistant',
        uuid: '00000000-0000-4000-8000-000000000002',
        message: { role: 'assistant', content: [] },
      } as any,
    )
    expect(result.data.success).toBe(true)
    expect(result.data.message).toContain(
      "Message queued for the main conversation's next turn.",
    )
    const q = getCommandQueue()
    expect(q.length).toBe(1)
    const cmd = q[0]!
    expect(cmd.mode).toBe('prompt')
    expect(cmd.priority).toBe('next')
    expect(cmd.isMeta).toBe(true)
    expect(cmd.skipSlashCommands).toBe(true)
    // peer envelope + origin
    expect(typeof cmd.value).toBe('string')
    expect(cmd.value as string).toContain('agent-message')
    expect(cmd.value as string).toContain('worker finished the scan')
    const origin = cmd.origin as { kind?: string; from?: string } | undefined
    expect(origin?.kind).toBe('peer')
  })
})
