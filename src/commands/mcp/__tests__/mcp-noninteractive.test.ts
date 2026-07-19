import { afterEach, describe, expect, test } from 'bun:test'
import { clearMcpControls, setMcpControls } from '../mcpControls.js'

const clients = [
  { name: 'alpha', type: 'connected' as const },
  { name: 'beta', type: 'disabled' as const },
  { name: 'gamma', type: 'failed' as const },
]

const { call } = await import('../mcp-noninteractive.js')

const ctx = {
  getAppState: () => ({ mcp: { clients } }),
} as never

afterEach(() => {
  clearMcpControls()
})

describe('mcp noninteractive (densable yDy)', () => {
  test('empty args returns status summary', async () => {
    const r = await call('', ctx)
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('3 MCP server(s)')
      expect(r.value).toContain('Usage: /mcp')
    }
  })

  test('help returns usage only', async () => {
    const r = await call('help', ctx)
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value.startsWith('Usage: /mcp')).toBe(true)
    }
  })

  test('unknown action rejected', async () => {
    const r = await call('ping', ctx)
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain("isn't a recognized /mcp action")
    }
  })

  test('without controls reports unavailable', async () => {
    const r = await call('enable beta', ctx)
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain("aren't available")
    }
  })

  test('enable uses toggle control', async () => {
    const toggled: string[] = []
    setMcpControls(
      (async (name: string) => ({
        client: { name, type: 'connected' },
        tools: [],
        commands: [],
      })) as never,
      async (name: string) => {
        toggled.push(name)
      },
    )
    const r = await call('enable beta', ctx)
    expect(toggled).toEqual(['beta'])
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('Enabled "beta"')
    }
  })

  test('reconnect all targets failed', async () => {
    const reconnected: string[] = []
    setMcpControls(
      (async (name: string) => {
        reconnected.push(name)
        return {
          client: { name, type: 'connected' },
          tools: [],
          commands: [],
        }
      }) as never,
      async () => {},
    )
    const r = await call('reconnect all', ctx)
    expect(reconnected).toEqual(['gamma'])
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('Reconnected 1 of 1')
    }
  })
})
