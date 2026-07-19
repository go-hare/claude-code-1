import { describe, expect, test } from 'bun:test'
import { isTerminalTaskStatus } from '../../../Task.js'
import {
  hasLiveAgentKeepaliveChildren,
  isParkedKeepaliveAgent,
} from '../../../utils/task/framework.js'
import type { AppState } from '../../../state/AppState.js'

/**
 * densable #168 — JXt park-on-complete / J5r / LSu pure matrix.
 * Gold: JXt=has agent: keepalive; J5r refuse UE&&!YC; LSu skip remove if JXt.
 */

describe('densable JXt / YC / UE pure', () => {
  test('UE isTerminalTaskStatus matches densable completed|failed|killed', () => {
    expect(isTerminalTaskStatus('completed')).toBe(true)
    expect(isTerminalTaskStatus('failed')).toBe(true)
    expect(isTerminalTaskStatus('killed')).toBe(true)
    expect(isTerminalTaskStatus('running')).toBe(false)
    expect(isTerminalTaskStatus('pending')).toBe(false)
  })

  test('YC isParkedKeepaliveAgent = local_agent completed + keepalive non-empty', () => {
    expect(
      isParkedKeepaliveAgent({
        type: 'local_agent',
        status: 'completed',
        keepaliveReasons: new Set(['agent:child']),
      }),
    ).toBe(true)
    expect(
      isParkedKeepaliveAgent({
        type: 'local_agent',
        status: 'completed',
        keepaliveReasons: new Set(),
      }),
    ).toBe(false)
    expect(
      isParkedKeepaliveAgent({
        type: 'local_agent',
        status: 'running',
        keepaliveReasons: new Set(['agent:child']),
      }),
    ).toBe(false)
    expect(
      isParkedKeepaliveAgent({
        type: 'local_bash',
        status: 'completed',
        keepaliveReasons: new Set(['agent:child']),
      }),
    ).toBe(false)
  })

  test('JXt hasLiveAgentKeepaliveChildren true only for agent: reasons', () => {
    const withAgent: AppState = {
      tasks: {
        owner: {
          type: 'local_agent',
          keepaliveReasons: new Set(['agent:child-1', 'bash:b1']),
        },
      },
    } as unknown as AppState
    expect(
      hasLiveAgentKeepaliveChildren('owner', () => withAgent),
    ).toBe(true)

    const onlyBash: AppState = {
      tasks: {
        owner: {
          type: 'local_agent',
          keepaliveReasons: new Set(['bash:b1']),
        },
      },
    } as unknown as AppState
    expect(
      hasLiveAgentKeepaliveChildren('owner', () => onlyBash),
    ).toBe(false)

    const missing: AppState = { tasks: {} } as unknown as AppState
    expect(hasLiveAgentKeepaliveChildren('owner', () => missing)).toBe(false)
    expect(hasLiveAgentKeepaliveChildren(undefined, () => missing)).toBe(false)
  })

  test('J5r gate: terminal non-parked refuses background (pure predicate)', () => {
    // Mirrors backgroundAgentTask early return
    const refuse = (status: string, parked: boolean): boolean =>
      isTerminalTaskStatus(status as never) && !parked
    expect(refuse('completed', false)).toBe(true)
    expect(refuse('completed', true)).toBe(false)
    expect(refuse('running', false)).toBe(false)
    expect(refuse('failed', false)).toBe(true)
  })

  test('source anchors AgentTool Zt park + LSu + task-only AbortError recover', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const agent = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
      ),
      'utf8',
    )
    expect(agent).toContain('backgroundAgentTask')
    expect(agent).toContain('hasLiveAgentKeepaliveChildren')
    expect(agent).toContain('taskAborted')
    expect(agent).toContain('parentLive')
    expect(agent).toContain("status: 'async_launched' as const")
    expect(agent).toContain('wasBackgrounded && foregroundTaskId')
    // densable Gge on mid-bg + Zt park
    expect(agent).toContain('addKeepaliveReason')
    expect(agent).toContain('agentKeepaliveReason')
    expect(agent).toContain('getIsNonInteractiveSession')
    // densable GEu(st) = notifyDropNestedBlockedChain on mid-bg + Zt
    expect(agent).toContain('notifyDropNestedBlockedChain')
    expect(
      (agent.match(/notifyDropNestedBlockedChain\(/g) || []).length,
    ).toBeGreaterThanOrEqual(2)

    const local = readFileSync(
      join(import.meta.dir, '../LocalAgentTask.tsx'),
      'utf8',
    )
    expect(local).toContain('isTerminalTaskStatus(task.status)')
    expect(local).toContain('hasLiveAgentKeepaliveChildren(taskId')
    expect(local).toContain('isParkedKeepaliveAgent(task)')
  })
})
