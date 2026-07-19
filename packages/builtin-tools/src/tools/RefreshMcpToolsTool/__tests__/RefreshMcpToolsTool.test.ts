import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../../../tests/mocks/debug'
import { logMock } from '../../../../../../tests/mocks/log'
import { REFRESH_MCP_TOOLS_TOOL_NAME } from '../prompt.js'

// Cut bootstrap/state side effects before tool import.
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

// Do not mock src/services/mcp/client.js — incomplete mocks break other
// imports of that module in the same process (e.g. callIdeRpc). The
// not_connected / missing-server paths never call fetchToolsForClient.

describe('RefreshMcpToolsTool', () => {
  test('REFRESH_MCP_TOOLS_TOOL_NAME matches official name', () => {
    expect(REFRESH_MCP_TOOLS_TOOL_NAME).toBe('RefreshMcpTools')
  })

  test('tool exports metadata', async () => {
    const { RefreshMcpToolsTool } = await import('../RefreshMcpToolsTool.js')
    expect(RefreshMcpToolsTool.name).toBe('RefreshMcpTools')
    expect(RefreshMcpToolsTool.shouldDefer).toBe(true)
    expect(RefreshMcpToolsTool.isReadOnly()).toBe(true)
    expect(RefreshMcpToolsTool.isConcurrencySafe()).toBe(true)
    expect(RefreshMcpToolsTool.userFacingName()).toBe('refreshMcpTools')
    expect(await RefreshMcpToolsTool.description()).toContain('MCP')
    expect(await RefreshMcpToolsTool.prompt()).toContain('not_connected')
  })

  test('renderToolUseMessage distinguishes all vs one server', async () => {
    const { RefreshMcpToolsTool } = await import('../RefreshMcpToolsTool.js')
    expect(String(RefreshMcpToolsTool.renderToolUseMessage({}))).toContain(
      'all MCP',
    )
    expect(
      String(RefreshMcpToolsTool.renderToolUseMessage({ server: 'github' })),
    ).toContain('github')
  })

  test('mapToolResultToToolResultBlockParam formats empty and populated', async () => {
    const { RefreshMcpToolsTool } = await import('../RefreshMcpToolsTool.js')
    const empty = RefreshMcpToolsTool.mapToolResultToToolResultBlockParam(
      [],
      'id-1',
    )
    expect(empty.content).toContain('No MCP servers')
    expect(empty.tool_use_id).toBe('id-1')

    const filled = RefreshMcpToolsTool.mapToolResultToToolResultBlockParam(
      [
        {
          server: 'github',
          status: 'refreshed',
          toolCount: 2,
          added: ['mcp__github__a'],
          removed: [],
        },
      ],
      'id-2',
    )
    expect(String(filled.content)).toContain('github')
    expect(String(filled.content)).toContain('refreshed')
  })

  test('call reports not_connected without dialing', async () => {
    const { RefreshMcpToolsTool } = await import('../RefreshMcpToolsTool.js')

    const result = await RefreshMcpToolsTool.call({}, {
      options: {
        mcpClients: [
          {
            name: 'offline',
            type: 'failed',
            config: { type: 'stdio', command: 'x', args: [] },
          },
        ],
        tools: [],
      },
      setAppState: () => {},
      getAppState: () => ({ toolPermissionContext: {} }),
    } as any)

    expect(result.data).toEqual([
      expect.objectContaining({
        server: 'offline',
        status: 'not_connected',
      }),
    ])
  })

  test('call throws when named server is missing', async () => {
    const { RefreshMcpToolsTool } = await import('../RefreshMcpToolsTool.js')
    await expect(
      RefreshMcpToolsTool.call({ server: 'missing' }, {
        options: {
          mcpClients: [
            {
              name: 'present',
              type: 'failed',
              config: { type: 'stdio', command: 'x', args: [] },
            },
          ],
          tools: [],
        },
        setAppState: () => {},
        getAppState: () => ({ toolPermissionContext: {} }),
      } as any),
    ).rejects.toThrow(/missing/)
  })

  test('call with empty mcpClients returns empty data', async () => {
    const { RefreshMcpToolsTool } = await import('../RefreshMcpToolsTool.js')
    const result = await RefreshMcpToolsTool.call({}, {
      options: { mcpClients: [], tools: [] },
      setAppState: () => {},
      getAppState: () => ({ toolPermissionContext: {} }),
    } as any)
    expect(result.data).toEqual([])
  })

  test('call reports error and keeps pool when tools/list fails', async () => {
    const { RefreshMcpToolsTool } = await import('../RefreshMcpToolsTool.js')
    let appTools: Array<{
      name: string
      mcpInfo?: { serverName: string; toolName: string }
    }> = [
      {
        name: 'mcp__failserver__keep',
        mcpInfo: { serverName: 'failserver', toolName: 'keep' },
      },
    ]
    const connected = {
      name: 'failserver',
      type: 'connected' as const,
      config: { type: 'stdio' as const, command: 'x', args: [] as string[] },
      // Real uncached path calls client.request — throw to simulate list failure.
      client: {
        request: async () => {
          throw new Error('tools/list boom')
        },
      },
      capabilities: { tools: {} },
    }

    const result = await RefreshMcpToolsTool.call({ server: 'failserver' }, {
      options: {
        mcpClients: [connected],
        tools: [...appTools],
      },
      setAppState: (f: (prev: any) => any) => {
        const next = f({
          mcp: {
            tools: appTools,
            clients: [connected],
            commands: [],
            resources: {},
          },
        })
        appTools = next.mcp.tools
      },
      getAppState: () => ({ toolPermissionContext: {} }),
    } as any)

    expect(result.data).toEqual([
      expect.objectContaining({
        server: 'failserver',
        status: 'error',
      }),
    ])
    expect(String(result.data[0]!.error)).toMatch(/boom|tools\/list/i)
    // Previous tools must remain — no wipe on list failure.
    expect(appTools.map(t => t.name)).toEqual(['mcp__failserver__keep'])
  })
})
