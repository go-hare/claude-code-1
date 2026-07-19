/**
 * densable qcs tool-not-found hint residual.
 */
import { describe, expect, test } from 'bun:test'
import { buildTool } from '../../../Tool.js'
import {
  formatPendingMcpServerHint,
  formatToolNotFoundHint,
  REPL_PRIMITIVE_TOOL_NAMES,
  WAIT_FOR_MCP_SERVERS_TOOL_NAME,
} from '../toolNotFoundHint.js'

function makeTool(name: string, aliases?: string[]) {
  return buildTool({
    name,
    aliases,
    inputSchema: { type: 'object' } as any,
    maxResultSizeChars: 1000,
    call: async () => ({ data: 'ok' }),
    description: async () => name,
    prompt: async () => name,
    mapToolResultToToolResultBlockParam: (c, id) => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: String(c),
    }),
    renderToolUseMessage: () => null,
  })
}

describe('formatToolNotFoundHint densable qcs', () => {
  test('REPL-only primitive when REPL mode + REPL available', () => {
    const tools = [makeTool('REPL'), makeTool('Bash')]
    const hint = formatToolNotFoundHint({
      toolName: 'Read',
      availableTools: tools,
      baseTools: [makeTool('Read')],
      replModeEnabled: true,
      embeddedSearchTools: false,
    })
    expect(hint).toContain('only available inside REPL')
    expect(hint).toContain('await Read({...})')
  })

  test('no REPL hint when REPL mode off', () => {
    const tools = [makeTool('REPL')]
    const hint = formatToolNotFoundHint({
      toolName: 'Read',
      availableTools: tools,
      baseTools: [],
      replModeEnabled: false,
    })
    expect(hint).toBe('')
  })

  test('subagent disallowed tool hint', () => {
    const base = [makeTool('AskUserQuestion')]
    const hint = formatToolNotFoundHint({
      toolName: 'AskUserQuestion',
      availableTools: [],
      baseTools: base,
      agentId: 'agent-1',
      agentDisallowedTools: new Set(['AskUserQuestion']),
      replModeEnabled: false,
    })
    expect(hint).toContain('not available inside subagents')
  })

  test('SendUserMessage / Brief not enabled session steers to assistant text', () => {
    const base = [makeTool('SendUserMessage', ['Brief'])]
    const hint = formatToolNotFoundHint({
      toolName: 'Brief',
      availableTools: [],
      baseTools: base,
      replModeEnabled: false,
    })
    expect(hint).toContain('not enabled in this session')
    expect(hint).toContain('normal assistant text')
  })

  test('exists but not enabled in this context', () => {
    const base = [makeTool('WebFetch')]
    const hint = formatToolNotFoundHint({
      toolName: 'WebFetch',
      availableTools: [makeTool('Bash')],
      baseTools: base,
      replModeEnabled: false,
    })
    expect(hint).toContain('exists but is not enabled in this context')
  })

  test('embedded search tools: Glob steers to find via Bash', () => {
    const hint = formatToolNotFoundHint({
      toolName: 'Glob',
      availableTools: [makeTool('Bash')],
      baseTools: [],
      replModeEnabled: false,
      embeddedSearchTools: true,
    })
    expect(hint).toContain('find files with `find` via the Bash tool')
  })

  test('embedded search tools: Grep steers to grep via Bash', () => {
    const hint = formatToolNotFoundHint({
      toolName: 'Grep',
      availableTools: [makeTool('Bash')],
      baseTools: [],
      replModeEnabled: false,
      embeddedSearchTools: true,
    })
    expect(hint).toContain('search file contents with `grep` via the Bash tool')
  })

  test('MCP pending server hint (main agent only)', () => {
    const hint = formatToolNotFoundHint({
      toolName: 'mcp__my_server__list_things',
      availableTools: [],
      baseTools: [],
      replModeEnabled: false,
      mcpClients: [{ name: 'my_server', type: 'pending' }],
    })
    expect(hint).toContain("MCP server 'my_server' is still connecting")
    expect(hint).toContain(WAIT_FOR_MCP_SERVERS_TOOL_NAME)
  })

  test('MCP pending hint skipped inside subagent', () => {
    const hint = formatToolNotFoundHint({
      toolName: 'mcp__my_server__list_things',
      availableTools: [],
      baseTools: [],
      agentId: 'agent-1',
      replModeEnabled: false,
      mcpClients: [{ name: 'my_server', type: 'pending' }],
    })
    expect(hint).toBe('')
  })

  test('formatPendingMcpServerHint matches normalized server name', () => {
    const hint = formatPendingMcpServerHint('mcp__my.server__tool', [
      { name: 'my.server', type: 'pending' },
    ])
    expect(hint).toContain("MCP server 'my.server' is still connecting")
  })

  test('unknown name with no special case returns empty', () => {
    expect(
      formatToolNotFoundHint({
        toolName: 'TotallyFakeTool',
        availableTools: [],
        baseTools: [],
        replModeEnabled: false,
      }),
    ).toBe('')
  })

  test('source anchors densable mCt set membership', () => {
    expect(REPL_PRIMITIVE_TOOL_NAMES.has('Read')).toBe(true)
    expect(REPL_PRIMITIVE_TOOL_NAMES.has('Glob')).toBe(true)
    expect(REPL_PRIMITIVE_TOOL_NAMES.has('Grep')).toBe(true)
    expect(REPL_PRIMITIVE_TOOL_NAMES.has('Bash')).toBe(true)
    expect(REPL_PRIMITIVE_TOOL_NAMES.has('PowerShell')).toBe(true)
    expect(REPL_PRIMITIVE_TOOL_NAMES.has('NotebookEdit')).toBe(true)
    // densable mCt does not include Write/Edit/Agent (those are local REPL_ONLY)
    expect(REPL_PRIMITIVE_TOOL_NAMES.has('Write')).toBe(false)
  })
})
