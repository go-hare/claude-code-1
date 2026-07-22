import { describe, expect, test } from 'bun:test'
import { runWithAgentContext } from 'src/utils/agentContext.js'
import type { ToolUseContext } from 'src/Tool.js'
import { resolveSenderDisplayName } from '../SendMessageTool.js'

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

    const name = runWithAgentContext(
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
    expect(name).toBe('researcher')
  })

  test('registry reverse lookup when no teammate ALS', () => {
    const senderId = 'agent-abc'
    const ctx = makeContext({
      agentNameRegistry: new Map([['worker-a', senderId]]),
    })
    expect(resolveSenderDisplayName(ctx, senderId)).toBe('worker-a')
  })

  test('local_agent agentType after registry miss', () => {
    const senderId = 'agent-xyz'
    const ctx = makeContext({
      tasks: {
        [senderId]: {
          type: 'local_agent',
          agentType: 'Explore',
        },
      },
    })
    expect(resolveSenderDisplayName(ctx, senderId)).toBe('Explore')
  })

  test('in-process teammate identity.agentName', () => {
    const senderId = 'tm-1'
    const ctx = makeContext({
      tasks: {
        [senderId]: {
          type: 'in_process_teammate',
          identity: { agentName: 'coder' },
        },
      },
    })
    expect(resolveSenderDisplayName(ctx, senderId)).toBe('coder')
  })

  test('falls back to raw agent id', () => {
    const ctx = makeContext({})
    expect(resolveSenderDisplayName(ctx, 'orphan-id')).toBe('orphan-id')
  })

  test('subagent ALS does not short-circuit (not teammate)', () => {
    const senderId = 'sub-1'
    const ctx = makeContext({
      agentNameRegistry: new Map([['named-sub', senderId]]),
    })
    const name = runWithAgentContext(
      {
        agentType: 'subagent',
        agentId: senderId,
        parentSessionId: 'main',
        isBackgroundAgent: true,
      },
      () => resolveSenderDisplayName(ctx, senderId),
    )
    expect(name).toBe('named-sub')
  })
})
