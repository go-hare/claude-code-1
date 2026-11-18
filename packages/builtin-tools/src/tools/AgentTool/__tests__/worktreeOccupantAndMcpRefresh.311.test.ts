import { describe, expect, test } from 'bun:test'
import type { TaskStateBase } from 'src/Task.js'
import type { Tool, Tools } from 'src/Tool.js'
import { findWorktreeOccupant } from '../AgentTool.js'
import { createSubagentRefreshTools } from '../runAgent.js'

describe('AgentTool worktree occupant check (#1234)', () => {
  test('detects running background child task inside the same worktree', () => {
    const worktreePath = '/repo/.claude/worktrees/agent-1'
    const childTask = {
      id: 'child-bg-1',
      type: 'local_agent',
      status: 'running',
      description: 'bg child',
      toolUseId: 'tu-1',
      startTime: Date.now(),
      outputFile: '/tmp/out',
      outputOffset: 0,
      notified: false,
      cwd: `${worktreePath}/packages/app`,
    } as unknown as TaskStateBase

    const occupant = findWorktreeOccupant(
      { 'child-bg-1': childTask },
      [worktreePath],
      'parent-agent',
    )
    expect(occupant?.id).toBe('child-bg-1')
  })

  test('ignores completed tasks without keepalive/child obligations', () => {
    const worktreePath = '/repo/.claude/worktrees/agent-1'
    const doneTask = {
      id: 'done-1',
      type: 'local_agent',
      status: 'completed',
      description: 'done child',
      toolUseId: 'tu-2',
      startTime: Date.now(),
      outputFile: '/tmp/out2',
      outputOffset: 0,
      notified: true,
      cwd: worktreePath,
    } as unknown as TaskStateBase

    const occupant = findWorktreeOccupant(
      { 'done-1': doneTask },
      [worktreePath],
      'parent-agent',
    )
    expect(occupant).toBeUndefined()
  })
})

describe('AgentTool createSubagentRefreshTools (#1229)', () => {
  test('appends newly connected MCP tools when mcp.tools or parentTools updates', () => {
    const builtinTool = { name: 'Read', isMcp: false } as unknown as Tool
    const lateMcpTool = {
      name: 'mcp__late__ping',
      isMcp: true,
    } as unknown as Tool

    let mcpTools: Tools = []
    let parentTools: Tools = [builtinTool]

    const refresh = createSubagentRefreshTools(
      [builtinTool],
      () => mcpTools,
      () => parentTools,
      candidates => candidates,
    )

    expect(refresh().map(t => t.name)).toEqual(['Read'])

    mcpTools = [lateMcpTool]
    expect(refresh().map(t => t.name)).toEqual(['Read', 'mcp__late__ping'])
  })
})
