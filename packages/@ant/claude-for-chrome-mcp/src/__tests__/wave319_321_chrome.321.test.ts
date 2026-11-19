import { describe, expect, test } from 'bun:test'
import WebSocket from 'ws'
import { BridgeClient } from '../bridgeClient.js'
import {
  BROWSER_TOOLS,
  handleToolCall,
  PREVIOUS_BROWSER_RETURN_WAIT_MS,
  ToolCallLostError,
} from '../index.js'
import {
  isChromeMcpReadOnlyTool,
  isHostProvidedBrowserMcpToolName,
} from '../../../../../src/utils/claudeInChrome/chromeMcpReadOnly.js'
import {
  BROWSER_TOOL_VERBS,
  isClaudeInChromeToolName,
} from '../../../../../src/dialog/permissionBrowser.js'

describe('Wave 319-321 Group 3: Claude in Chrome MCP', () => {
  test('#1794: javascript_tool sets anthropic/maxResultSizeChars to 60000', () => {
    const jsTool = BROWSER_TOOLS.find(t => t.name === 'javascript_tool') as
      | { _meta?: Record<string, unknown> }
      | undefined
    expect(jsTool?._meta?.['anthropic/maxResultSizeChars']).toBe(60000)
  })

  test('#1820: shortcuts_list and shortcuts_execute are removed from built-in Chrome tools', () => {
    const names = BROWSER_TOOLS.map(t => t.name)
    expect(names).not.toContain('shortcuts_list')
    expect(names).not.toContain('shortcuts_execute')
    expect(
      isChromeMcpReadOnlyTool('mcp__claude-in-chrome__shortcuts_list', {}),
    ).toBe(false)
    expect('shortcuts_execute' in BROWSER_TOOL_VERBS).toBe(false)
  })

  test('#1766: ToolCallLostError returns mid-call check-page guidance instead of not-connected', async () => {
    const result = await handleToolCall(
      {
        serverName: 'Claude in Chrome',
        logger: {
          silly: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
        socketPath: '/tmp/unused.sock',
        clientTypeId: 'claude-code',
      } as never,
      {
        ensureConnected: async () => true,
        callTool: async () => {
          throw new ToolCallLostError('Bridge connection closed mid-call')
        },
        isConnected: () => true,
        disconnect: () => {},
        setNotificationHandler: () => {},
        setPermissionMode: async () => {},
      },
      'computer',
      { action: 'left_click', tabId: 1 },
    )
    expect(result.isError).toBe(true)
    const text = (result.content[0] as { text?: string })?.text ?? ''
    expect(text).toContain('connection was lost before its result came back')
    expect(text).toContain('first check the page state')
    expect(text).not.toContain('extension is not connected')
  })

  test('#1793: previous browser return wait window is 6000ms', () => {
    expect(PREVIOUS_BROWSER_RETURN_WAIT_MS).toBe(6000)
  })

  test('#1949: host-provided Chrome/Browser/Preview/remote-devices prefixes are recognized', () => {
    for (const fq of [
      'mcp__claude-in-chrome__read_page',
      'mcp__Claude_in_Chrome__read_page',
      'mcp__Claude_Browser__read_page',
      'mcp__Claude_Preview__read_page',
      'mcp__remote-devices__Claude_in_Chrome__read_page',
      'mcp__remote-devices__Claude_Browser__read_page',
    ]) {
      expect(isHostProvidedBrowserMcpToolName(fq)).toBe(true)
      expect(isClaudeInChromeToolName(fq)).toBe(true)
    }
    expect(isHostProvidedBrowserMcpToolName('mcp__slack__post_message')).toBe(
      false,
    )
  })

  test('#1793: awaitPreviousBrowser ignores unrelated peer_connected and waits for previous device or timeout', async () => {
    const client = new BridgeClient({
      serverName: 'Claude in Chrome',
      logger: {
        silly: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      socketPath: '/tmp/unused.sock',
      clientTypeId: 'claude-code',
      bridgeConfig: {
        url: 'wss://bridge.example.com',
        getUserId: async () => 'u1',
        getOAuthToken: async () => 't1',
      },
    } as never)

    const internal = client as unknown as {
      connected: boolean
      selectedDeviceId: string | undefined
      previousSelectedDeviceId: string | undefined
      previousSelectedLeftAt: number | undefined
      handleMessage: (msg: Record<string, unknown>) => void
    }
    internal.connected = true
    internal.selectedDeviceId = undefined
    internal.previousSelectedDeviceId = 'dev-prev'
    internal.previousSelectedLeftAt =
      Date.now() - PREVIOUS_BROWSER_RETURN_WAIT_MS + 150

    const waitPromise = client.awaitPreviousBrowser()
    // An unrelated browser connects first: must NOT return true early
    setTimeout(() => {
      internal.handleMessage({ type: 'peer_connected', deviceId: 'dev-other' })
    }, 20)
    // Then the previous browser returns before the deadline
    setTimeout(() => {
      internal.handleMessage({ type: 'peer_connected', deviceId: 'dev-prev' })
    }, 60)

    expect(await waitPromise).toBe(true)
    expect(internal.selectedDeviceId as string | undefined).toBe('dev-prev')

    // When only an unrelated browser connects and timeout expires, returns false
    internal.selectedDeviceId = undefined
    internal.previousSelectedDeviceId = 'dev-prev-2'
    internal.previousSelectedLeftAt =
      Date.now() - PREVIOUS_BROWSER_RETURN_WAIT_MS + 60
    const timeoutWait = client.awaitPreviousBrowser()
    setTimeout(() => {
      internal.handleMessage({ type: 'peer_connected', deviceId: 'dev-other' })
    }, 15)
    expect(await timeoutWait).toBe(false)
    expect(internal.selectedDeviceId).toBeUndefined()
  })

  test('#1793: disconnect flushes peerConnectedWaiters immediately so awaitPreviousBrowser rejects fast', async () => {
    const client = new BridgeClient({
      serverName: 'Claude in Chrome',
      logger: {
        silly: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      socketPath: '/tmp/unused.sock',
      clientTypeId: 'claude-code',
    } as never)

    const internal = client as unknown as {
      connected: boolean
      previousSelectedDeviceId: string | undefined
      previousSelectedLeftAt: number | undefined
      flushPeerConnectedWaiters: (arrived: boolean) => void
    }
    internal.connected = true
    internal.previousSelectedDeviceId = 'dev-prev'
    internal.previousSelectedLeftAt = Date.now()

    const started = Date.now()
    const waitPromise = client.awaitPreviousBrowser()
    setTimeout(() => {
      internal.connected = false
      internal.flushPeerConnectedWaiters(false)
    }, 25)

    await expect(waitPromise).rejects.toThrow(
      /Bridge disconnected while waiting/,
    )
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test('#1766: callTool re-checks WS after discovery and cleans up pendingCalls if ws.send throws', async () => {
    const client = new BridgeClient({
      serverName: 'Claude in Chrome',
      logger: {
        silly: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      socketPath: '/tmp/unused.sock',
      clientTypeId: 'claude-code',
    } as never)

    const internal = client as unknown as {
      ws: { readyState: number; send: (data: string) => void } | null
      selectedDeviceId: string | undefined
      discoveryComplete: boolean
      discoveryPromise: Promise<void> | null
      pendingCalls: Map<string, unknown>
    }

    // 1) WS closes while discoveryPromise is running -> rejects post-discovery
    let sendCalled = false
    internal.ws = {
      readyState: WebSocket.OPEN,
      send: () => {
        sendCalled = true
      },
    }
    internal.selectedDeviceId = undefined
    internal.discoveryComplete = false
    internal.discoveryPromise = (async () => {
      await new Promise(r => setTimeout(r, 10))
      internal.ws!.readyState = WebSocket.CLOSED
      internal.selectedDeviceId = 'dev-1'
      internal.discoveryComplete = true
    })()

    await expect(client.callTool('read_page', {})).rejects.toThrow(
      /Bridge disconnected during discovery/,
    )
    expect(sendCalled).toBe(false)
    expect(internal.pendingCalls.size).toBe(0)

    // 2) ws.send throws synchronously -> cleans timer + pendingCalls entry
    internal.ws = {
      readyState: WebSocket.OPEN,
      send: () => {
        throw new Error('EPIPE write failed')
      },
    }
    internal.selectedDeviceId = 'dev-1'
    internal.discoveryComplete = true

    await expect(client.callTool('read_page', {})).rejects.toThrow(
      /EPIPE write failed/,
    )
    expect(internal.pendingCalls.size).toBe(0)
  })
})
