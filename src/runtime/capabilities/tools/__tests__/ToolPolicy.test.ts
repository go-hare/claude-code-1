import { describe, expect, test } from 'bun:test'
import { buildTool, getEmptyToolPermissionContext } from '../../../../Tool.js'
import { assembleToolPool, createRuntimeToolCatalog } from '../index.js'

function makeTool(name: string, overrides: Record<string, unknown> = {}) {
  return buildTool({
    name,
    inputSchema: { type: 'object' as const } as any,
    maxResultSizeChars: 10_000,
    call: async () => ({ data: 'ok' }),
    description: async () => `${name} description`,
    prompt: async () => `${name} prompt`,
    mapToolResultToToolResultBlockParam: (
      content: unknown,
      toolUseID: string,
    ) => ({
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: String(content),
    }),
    renderToolUseMessage: () => null,
    ...overrides,
  })
}

describe('runtime ToolPolicy', () => {
  test('throws when an MCP tool collides with a built-in primary name', () => {
    const builtIn = makeTool('Bash')
    const conflictingMcpTool = makeTool('Bash', {
      mcpInfo: { serverName: 'docs', toolName: 'search' },
    })

    expect(() =>
      assembleToolPool(
        getEmptyToolPermissionContext(),
        [conflictingMcpTool],
        [builtIn],
      ),
    ).toThrow('Conflicting tools share primary name "Bash"')
  })
})

describe('runtime ToolCatalog', () => {
  test('creates descriptors and alias lookup from tools', () => {
    const tool = makeTool('Read', {
      aliases: ['FileRead'],
      searchHint: 'read files',
    })

    const catalog = createRuntimeToolCatalog([tool])

    expect(catalog.list()).toEqual([
      expect.objectContaining({
        name: 'Read',
        description: 'read files',
        source: 'builtin',
      }),
    ])
    expect(catalog.find('Read')?.name).toBe('Read')
    expect(catalog.find('FileRead')?.name).toBe('Read')
  })
})
