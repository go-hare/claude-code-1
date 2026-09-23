import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runWithAgentContext } from 'src/utils/agentContext.js'
import {
  dequeue,
  getCommandQueue,
  remove,
} from 'src/utils/messageQueueManager.js'
import type { ToolUseContext } from 'src/Tool.js'
import {
  MAIN_RECIPIENT,
  resolveSenderDisplayName,
  SendMessageTool,
} from '../SendMessageTool.js'

function makeContext(opts: {
  tasks?: Record<string, unknown>
  agentNameRegistry?: Map<string, string>
}): ToolUseContext {
  const registry = opts.agentNameRegistry ?? new Map<string, string>()
  // Test stub: only getAppState is exercised by resolveSenderDisplayName.
  return {
    getAppState: () =>
      ({
        tasks: opts.tasks ?? {},
        agentNameRegistry: registry,
      }) as never,
  } as unknown as ToolUseContext
}

function drainQueue(): void {
  while (getCommandQueue().length > 0) {
    const cmd = dequeue()
    if (cmd) remove([cmd])
  }
}

describe('resolveSenderDisplayName', () => {
  test('teammate agentContext.agentName wins over registry and task', () => {
    const senderId = 'researcher@team-1'
    const ctx = makeContext({
      agentNameRegistry: new Map([['registry-name', senderId]]),
      tasks: {
        [senderId]: {
          type: 'local_agent',
          agentType: 'general-purpose',
        },
      },
    })

    const resolved = runWithAgentContext(
      {
        agentType: 'teammate',
        agentId: senderId,
        agentName: 'researcher',
        teamName: 'team-1',
        planModeRequired: false,
        parentSessionId: 'lead-session',
        isTeamLead: false,
      },
      () => resolveSenderDisplayName(ctx, senderId),
    )
    expect(resolved).toEqual({
      from: 'researcher',
      displayName: 'researcher',
    })
  })

  test('registry reverse lookup when no teammate ALS', () => {
    const senderId = 'agent-abc'
    const ctx = makeContext({
      agentNameRegistry: new Map([['worker-a', senderId]]),
    })
    expect(resolveSenderDisplayName(ctx, senderId)).toEqual({
      from: 'worker-a',
      displayName: 'worker-a',
    })
  })

  test('unnamed local_agent from is id; agentType is only displayName', () => {
    const senderId = 'agent-xyz'
    const ctx = makeContext({
      tasks: {
        [senderId]: {
          type: 'local_agent',
          agentType: 'Explore',
        },
      },
    })
    expect(resolveSenderDisplayName(ctx, senderId)).toEqual({
      from: senderId,
      displayName: 'Explore',
    })
  })

  test('in-process teammate identity.agentName before local_agent fallback', () => {
    const senderId = 'tm-1'
    const ctx = makeContext({
      tasks: {
        [senderId]: {
          type: 'in_process_teammate',
          identity: { agentName: 'coder' },
        },
      },
    })
    expect(resolveSenderDisplayName(ctx, senderId)).toEqual({
      from: 'coder',
      displayName: 'coder',
    })
  })

  test('falls back to raw agent id', () => {
    const ctx = makeContext({})
    expect(resolveSenderDisplayName(ctx, 'orphan-id')).toEqual({
      from: 'orphan-id',
      displayName: 'orphan-id',
    })
  })

  test('subagent ALS does not short-circuit (not teammate)', () => {
    const senderId = 'sub-1'
    const ctx = makeContext({
      agentNameRegistry: new Map([['named-sub', senderId]]),
    })
    const resolved = runWithAgentContext(
      {
        agentType: 'subagent',
        agentId: senderId,
        parentSessionId: 'main',
        isBackgroundAgent: true,
      },
      () => resolveSenderDisplayName(ctx, senderId),
    )
    expect(resolved).toEqual({
      from: 'named-sub',
      displayName: 'named-sub',
    })
  })
})

describe('SendMessage envelope uses Ce.from', () => {
  beforeEach(() => {
    drainQueue()
  })
  afterEach(() => {
    drainQueue()
  })

  test('unnamed sibling local_agent from= is the agent id, not agentType', async () => {
    const senderId = 'agent-unnamed-1'
    const result = await SendMessageTool.call!(
      {
        to: MAIN_RECIPIENT,
        summary: 'status update',
        message: 'scan done',
      },
      {
        agentId: senderId,
        getAppState: () => ({
          tasks: {
            [senderId]: {
              type: 'local_agent',
              agentType: 'Explore',
              status: 'running',
            },
          },
          agentNameRegistry: new Map(),
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
    expect(String(cmd?.value)).toContain(`from="${senderId}"`)
    expect(String(cmd?.value)).not.toContain('from="Explore"')
    const origin = cmd?.origin as { from?: string; name?: string } | undefined
    expect(origin?.from).toBe(senderId)
    expect(origin?.name).toBe('Explore')
  })
})
