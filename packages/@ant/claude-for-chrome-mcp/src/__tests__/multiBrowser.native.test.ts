import { describe, expect, test } from 'bun:test'

import { handleToolCall } from '../toolCalls.js'
import type {
  ChromeExtensionInfo,
  ClaudeForChromeContext,
  SocketClient,
} from '../types.js'
import { BROWSER_TOOLS, BRIDGE_ONLY_BROWSER_TOOLS } from '../browserTools.js'

function makeContext(
  overrides: Partial<ClaudeForChromeContext> = {},
): ClaudeForChromeContext {
  return {
    serverName: 'test-chrome',
    logger: {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
      silly: () => {},
    },
    socketPath: '/tmp/test.sock',
    clientTypeId: 'claude-code',
    onToolCallDisconnected: () => 'disconnected',
    onAuthenticationError: () => {},
    ...overrides,
  }
}

function makeNativeSocketClient(
  extensions: Array<ChromeExtensionInfo & { isLocal?: boolean }>,
): SocketClient & {
  selected?: { deviceId: string; name: string }
  switchCalls: number
} {
  let selected: { deviceId: string; name: string } | undefined
  let preferred = extensions[0]?.deviceId
  return {
    selected: undefined as { deviceId: string; name: string } | undefined,
    switchCalls: 0,
    async ensureConnected() {
      return extensions.length > 0
    },
    isConnected() {
      return extensions.length > 0
    },
    disconnect() {},
    setNotificationHandler() {},
    async callTool() {
      return { result: { content: [{ type: 'text', text: 'ok' }] } }
    },
    async listConnectedExtensions() {
      return extensions
    },
    selectExtensionById(deviceId: string, name: string) {
      preferred = deviceId
      selected = { deviceId, name }
      this.selected = selected
    },
    async switchBrowser() {
      this.switchCalls++
      if (extensions.length === 0) return null
      if (extensions.length === 1) return 'no_other_browsers'
      const idx = extensions.findIndex(e => e.deviceId === preferred)
      const next = extensions[(idx + 1) % extensions.length]!
      const name = next.name?.trim() || 'Browser'
      this.selectExtensionById!(next.deviceId, name)
      return { deviceId: next.deviceId, name }
    },
  }
}

describe('multi-browser tools without bridgeConfig (no OAuth)', () => {
  test('ListTools surface always includes multi-browser tools in BROWSER_TOOLS', () => {
    for (const name of BRIDGE_ONLY_BROWSER_TOOLS) {
      expect(BROWSER_TOOLS.some(t => t.name === name)).toBe(true)
    }
  })

  test('list_connected_browsers works on native socket client', async () => {
    const client = makeNativeSocketClient([
      {
        deviceId: '/tmp/a.sock',
        name: 'Local Chrome 1',
        connectedAt: 1,
        isLocal: true,
      },
      {
        deviceId: '/tmp/b.sock',
        name: 'Local Chrome 2',
        connectedAt: 2,
        isLocal: true,
      },
    ])
    const result = await handleToolCall(
      makeContext(), // no bridgeConfig
      client,
      'list_connected_browsers',
      {},
    )
    expect(result.isError).toBeUndefined()
    const text = result.content.map(c => ('text' in c ? c.text : '')).join('\n')
    expect(text).toContain('/tmp/a.sock')
    expect(text).toContain('/tmp/b.sock')
    expect(text).toContain('select_browser')
  })

  test('select_browser pins deviceId without bridgeConfig', async () => {
    const client = makeNativeSocketClient([
      {
        deviceId: '/tmp/a.sock',
        name: 'Local Chrome 1',
        connectedAt: 1,
        isLocal: true,
      },
      {
        deviceId: '/tmp/b.sock',
        name: 'Local Chrome 2',
        connectedAt: 2,
        isLocal: true,
      },
    ])
    const result = await handleToolCall(
      makeContext(),
      client,
      'select_browser',
      { deviceId: '/tmp/b.sock' },
    )
    expect(result.isError).toBeUndefined()
    expect(client.selected?.deviceId).toBe('/tmp/b.sock')
  })

  test('switch_browser cycles local sockets without bridgeConfig', async () => {
    const client = makeNativeSocketClient([
      {
        deviceId: '/tmp/a.sock',
        name: 'Local A',
        connectedAt: 1,
        isLocal: true,
      },
      {
        deviceId: '/tmp/b.sock',
        name: 'Local B',
        connectedAt: 2,
        isLocal: true,
      },
    ])
    const result = await handleToolCall(
      makeContext(),
      client,
      'switch_browser',
      {},
    )
    expect(result.isError).toBeUndefined()
    expect(client.switchCalls).toBe(1)
    expect(client.selected?.deviceId).toBe('/tmp/b.sock')
  })

  test('switch_browser reports no_other_browsers for single socket', async () => {
    const client = makeNativeSocketClient([
      {
        deviceId: '/tmp/only.sock',
        name: 'Only',
        connectedAt: 1,
        isLocal: true,
      },
    ])
    const result = await handleToolCall(
      makeContext(),
      client,
      'switch_browser',
      {},
    )
    expect(result.isError).toBe(true)
    const text = result.content.map(c => ('text' in c ? c.text : '')).join('\n')
    expect(text).toMatch(/No other browsers/i)
  })
})
