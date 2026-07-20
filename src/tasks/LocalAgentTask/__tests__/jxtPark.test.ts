import { describe, expect, test } from 'bun:test'
import { isTerminalTaskStatus } from '../../../Task.js'
import {
  hasLiveAgentKeepaliveChildren,
  isParkedKeepaliveAgent,
} from '../../../utils/task/framework.js'
import type { AppState } from '../../../state/AppState.js'

/**
 * densable — JXt park-on-complete / YC / UE pure matrix.
 * AgentTool source anchors only cover carefully ported Gge/Yeo pieces.
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
    expect(hasLiveAgentKeepaliveChildren('owner', () => withAgent)).toBe(true)

    const onlyBash: AppState = {
      tasks: {
        owner: {
          type: 'local_agent',
          keepaliveReasons: new Set(['bash:b1']),
        },
      },
    } as unknown as AppState
    expect(hasLiveAgentKeepaliveChildren('owner', () => onlyBash)).toBe(false)

    const missing: AppState = { tasks: {} } as unknown as AppState
    expect(hasLiveAgentKeepaliveChildren('owner', () => missing)).toBe(false)
    expect(hasLiveAgentKeepaliveChildren(undefined, () => missing)).toBe(false)
  })

  test('J5r gate: terminal non-parked refuses background (pure predicate)', () => {
    const refuse = (status: string, parked: boolean): boolean =>
      isTerminalTaskStatus(status as never) && !parked
    expect(refuse('completed', false)).toBe(true)
    expect(refuse('completed', true)).toBe(false)
    expect(refuse('running', false)).toBe(false)
    expect(refuse('failed', false)).toBe(true)
  })

  test('source anchors densable Gge on async spawn + mid-bg + BRt mi→undefined', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const agent = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
      ),
      'utf8',
    )
    // Ported carefully: nested Yeo owner + Gge on mid-bg; not full Zt park package
    expect(agent.includes('addKeepaliveReason')).toBe(true)
    expect(agent.includes('agentKeepaliveReason')).toBe(true)
    expect(agent.includes('resolvePanelOwnerAgentId')).toBe(true)
    expect(agent.includes('getIsNonInteractiveSession')).toBe(true)
    // densable OSu: fg register stamps owner; mid-bg re-stamps if missing
    expect(agent.includes('nestedFgOwnerId')).toBe(true)
    expect(agent.includes('ownerAgentId: t.ownerAgentId ?? ownerId')).toBe(true)

    const local = readFileSync(
      join(import.meta.dir, '../LocalAgentTask.tsx'),
      'utf8',
    )
    expect(local.includes('isTerminalTaskStatus(task.status)')).toBe(true)
    expect(local.includes('hasLiveAgentKeepaliveChildren(taskId')).toBe(true)
    expect(local.includes('isParkedKeepaliveAgent(task)')).toBe(true)
    // densable AL: main stamp is mi() via getMainThreadAgentId (not undefined dual)
    expect(local.includes('getMainThreadAgentId')).toBe(true)
    expect(local.includes("priority: 'next'")).toBe(true)
    // densable OSu stamps owner at foreground register
    expect(local.includes('// densable OSu: ownerAgentId:t at register')).toBe(
      true,
    )
    // densable Beo/gtf/hAe stop cascade helpers
    expect(local.includes('isDescendantAgentOf')).toBe(true)
    expect(local.includes('killDescendantAgents')).toBe(true)
    expect(local.includes('markAgentStoppedByUser')).toBe(true)
    // densable Sot Gge is call-site only (resume/observer attachOwnerKeepalive:false)
    expect(local.includes('attachOwnerKeepalive')).toBe(true)
    // densable bot idle-window / full Zt park package (DSu a=true + okg)
    expect(
      local.includes('flag:idle-window') ||
        local.includes('IDLE_WINDOW_KEEPALIVE_REASON'),
    ).toBe(true)
    expect(local.includes('expireIdleWindowKeepalive')).toBe(true)
    expect(local.includes('armIdleWindowTimer')).toBe(true)
    expect(local.includes('clearIdleWindowTimer')).toBe(true)

    const fw = readFileSync(
      join(import.meta.dir, '../../../utils/task/framework.ts'),
      'utf8',
    )
    expect(
      fw.includes("IDLE_WINDOW_KEEPALIVE_REASON = 'flag:idle-window'"),
    ).toBe(true)
    expect(fw.includes('hasNonIdleWindowKeepalive')).toBe(true)
    expect(fw.includes('computePanelEvictAfter')).toBe(true)

    // densable Yqe JXt defer BRt (AgentTool complete path)
    const utils = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/AgentTool/agentToolUtils.ts',
      ),
      'utf8',
    )
    expect(utils.includes('parkAgentOnKeepaliveDeferNotify')).toBe(true)
    expect(utils.includes('parked on keepalive')).toBe(true)
    expect(utils.includes('sweepAndDetectLiveAgentChildren')).toBe(true)
  })
})
