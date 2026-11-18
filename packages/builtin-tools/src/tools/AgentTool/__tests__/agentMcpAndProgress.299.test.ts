import { describe, expect, test } from 'bun:test'
import type { Tool, Tools } from 'src/Tool.js'
import { resolveAgentTools } from '../agentToolUtils.js'
import {
  advanceProgressTrailState,
  createProgressTrailState,
  getProcessedProgressMessages,
} from '../UI.js'

function makeMcpTool(serverName: string, toolName: string): Tool {
  return {
    name: `mcp__${serverName}__${toolName}`,
    mcpInfo: { serverName, toolName },
    isEnabled: () => true,
  } as unknown as Tool
}

describe('AgentTool MCP tools & incremental progress trail (#723, #883)', () => {
  test('#723: mcp__<server> takes only that server tools, and __ servers require mcp__<whole name>__*', () => {
    const fooTool = makeMcpTool('foo', 'ping')
    const fooBarTool = makeMcpTool('foo__bar', 'status')
    const tools: Tools = [fooTool, fooBarTool]

    // `mcp__foo` / `mcp__foo__*` must NOT include `foo__bar`
    const fooOnly = resolveAgentTools(
      {
        tools: ['mcp__foo'],
        source: 'projectSettings',
        agentType: 'test',
      } as any,
      tools,
      false,
    )
    expect(fooOnly.resolvedTools).toEqual([fooTool])

    const fooWildcard = resolveAgentTools(
      {
        tools: ['mcp__foo__*'],
        source: 'projectSettings',
        agentType: 'test',
      } as any,
      tools,
      false,
    )
    expect(fooWildcard.resolvedTools).toEqual([fooTool])

    // Server whose name contains `__` must be listed as `mcp__<whole name>__*`
    const fooBarWildcard = resolveAgentTools(
      {
        tools: ['mcp__foo__bar__*'],
        source: 'projectSettings',
        agentType: 'test',
      } as any,
      tools,
      false,
    )
    expect(fooBarWildcard.resolvedTools).toEqual([fooBarTool])

    // Without `__*`, `mcp__foo__bar` does NOT expand server `foo__bar`
    const fooBarNoWildcard = resolveAgentTools(
      {
        tools: ['mcp__foo__bar'],
        source: 'projectSettings',
        agentType: 'test',
      } as any,
      tools,
      false,
    )
    expect(fooBarNoWildcard.resolvedTools).toEqual([])
  })

  test('#883: advanceProgressTrailState processes new messages incrementally without re-reading earlier ones', () => {
    const state = createProgressTrailState()
    const tools: Tools = []
    const makeAssistant = (uuid: string, text: string) =>
      ({
        uuid,
        type: 'progress',
        data: {
          type: 'agent_progress',
          prompt: 'p',
          message: {
            type: 'assistant',
            uuid,
            message: { role: 'assistant', content: [{ type: 'text', text }] },
          },
        },
      }) as any

    const m1 = makeAssistant('u1', 'first')
    advanceProgressTrailState(state, [m1], tools)
    expect(state.processedSourceCount).toBe(1)
    expect(getProcessedProgressMessages(state, true)).toHaveLength(1)

    const m2 = makeAssistant('u2', 'second')
    advanceProgressTrailState(state, [m1, m2], tools)
    expect(state.processedSourceCount).toBe(2)
    expect(state.lastSourceUuid).toBe('u2')
    const out = getProcessedProgressMessages(state, true)
    expect(out).toHaveLength(2)
  })
})
