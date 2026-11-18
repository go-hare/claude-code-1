import { describe, expect, test } from 'bun:test'
import { createMcpSocketClient } from '../mcpSocketClient.js'
import type { ClaudeForChromeContext } from '../types.js'

describe('v2.1.290 browser_batch 90s timeout (#137)', () => {
  test('McpSocketClient uses context.getToolCallTimeoutMs when provided', async () => {
    const seen: string[] = []
    const timeouts: number[] = []
    const context: ClaudeForChromeContext = {
      serverName: 'Claude in Chrome',
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        silly: () => {},
      },
      socketPath: '/tmp/nonexistent.sock',
      clientTypeId: 'claude-code',
      onToolCallDisconnected: () => 'disconnected',
      onAuthenticationError: () => {},
      getToolCallTimeoutMs: toolName => {
        seen.push(toolName)
        return toolName === 'browser_batch' ? 90_000 : 30_000
      },
    }

    const client = createMcpSocketClient(context)
    // Spy on private sendRequestWithRetry to verify timeoutMs propagation without opening a real socket.
    ;(
      client as unknown as {
        sendRequestWithRetry: (
          req: unknown,
          timeoutMs?: number,
        ) => Promise<unknown>
      }
    ).sendRequestWithRetry = async (_req, timeoutMs = 30000) => {
      timeouts.push(timeoutMs)
      return { result: { content: [] } }
    }

    await client.callTool('browser_batch', { actions: [] })
    await client.callTool('get_page_text', {})

    expect(seen).toEqual(['browser_batch', 'get_page_text'])
    expect(timeouts).toEqual([90_000, 30_000])
  })
})
