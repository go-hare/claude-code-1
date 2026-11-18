import { describe, expect, test } from 'bun:test'
import { BridgeClient, NoExtensionConnectedError } from '../bridgeClient.js'
import { handleToolCall } from '../toolCalls.js'
import type { ClaudeForChromeContext } from '../types.js'

function createTestContext(
  overrides?: Partial<ClaudeForChromeContext>,
): ClaudeForChromeContext {
  return {
    serverName: 'claude-in-chrome',
    logger: {
      silly: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    getSocketPath: () => '/tmp/nonexistent.sock',
    onToolCallDisconnected: () => 'Browser extension is not connected.',
    ...overrides,
  } as unknown as ClaudeForChromeContext
}

describe('#612: NoExtensionConnectedError when no Chrome extension connected after discovery', () => {
  test('BridgeClient.callTool throws NoExtensionConnectedError after discovery completes with no selectedDeviceId', async () => {
    const client = new BridgeClient(createTestContext())
    // Simulate open WebSocket + completed discovery with 0 extensions
    const internal = client as unknown as {
      ws: { readyState: number }
      discoveryComplete: boolean
      selectedDeviceId: string | undefined
      pairingInProgress: boolean
    }
    internal.ws = { readyState: WebSocket.OPEN }
    internal.discoveryComplete = true
    internal.selectedDeviceId = undefined
    internal.pairingInProgress = false

    let caught: unknown
    try {
      await client.callTool('tabs_context_mcp', {})
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(NoExtensionConnectedError)
    expect((caught as Error).message).toContain(
      'No Chrome extension connected after discovery',
    )
  })

  test('handleToolCall catches NoExtensionConnectedError and returns disconnected message', async () => {
    const ctx = createTestContext()
    const fakeSocketClient = {
      ensureConnected: async () => true,
      callTool: async () => {
        throw new NoExtensionConnectedError(
          '[claude-in-chrome] No Chrome extension connected after discovery',
        )
      },
    }

    const res = await handleToolCall(
      ctx,
      fakeSocketClient as never,
      'tabs_context_mcp',
      {},
    )
    expect(res.isError).toBe(true)
    expect((res.content[0] as { text: string }).text).toContain(
      'Browser extension is not connected.',
    )
  })
})
