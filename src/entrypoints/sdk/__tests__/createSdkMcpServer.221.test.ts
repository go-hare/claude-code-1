/**
 * densable fVp / agent-sdk hl product twin — densable 1:1 registry (plain {}).
 * #10 constructor crash is fixed on API-request path, not by inventing
 * null-proto McpServer maps here.
 */
import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { createLinkedTransportPair } from '@claude-code/mcp-client'
import { z } from 'zod/v4'
import { createSdkMcpServer, tool } from '../createSdkMcpServer.js'

describe('createSdkMcpServer product twin (densable fVp)', () => {
  test('tool() builds definition with optional alwaysLoad meta', () => {
    const def = tool(
      'echo',
      'Echo a message',
      { message: z.string().describe('text') },
      async args => ({
        content: [{ type: 'text', text: String(args.message) }],
      }),
      { alwaysLoad: true, annotations: { readOnlyHint: true } },
    )
    expect(def.name).toBe('echo')
    expect(def.description).toBe('Echo a message')
    expect(def.annotations).toEqual({ readOnlyHint: true })
    expect(def._meta).toEqual({ 'anthropic/alwaysLoad': true })
  })

  test('returns type sdk config with McpServer instance', () => {
    const def = tool('ping', 'Ping', {}, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }))
    const cfg = createSdkMcpServer({
      name: 'test-server',
      version: '1.2.3',
      tools: [def],
    })
    expect(cfg.type).toBe('sdk')
    expect(cfg.name).toBe('test-server')
    expect(cfg.instance).toBeDefined()
    expect(typeof cfg.instance.connect).toBe('function')
  })

  test('normal tool registers and can be listed/called in-process', async () => {
    const def = tool('echo', 'Echo', { message: z.string() }, async args => ({
      content: [{ type: 'text', text: String(args.message) }],
    }))
    const cfg = createSdkMcpServer({ name: 'echo-server', tools: [def] })
    const [clientTransport, serverTransport] = createLinkedTransportPair()
    await cfg.instance.connect(serverTransport)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientTransport)

    const listed = await client.listTools()
    expect(listed.tools.map(t => t.name)).toContain('echo')

    const result = await client.callTool({
      name: 'echo',
      arguments: { message: 'hi' },
    })
    const content = (result as { content?: Array<{ text?: string }> }).content
    expect(content?.[0]?.text).toBe('hi')

    await client.close()
    await cfg.instance.close()
  })

  test('densable 1:1: tool named constructor hits plain registry (already registered)', () => {
    const def = tool(
      'constructor',
      'Built-in property name tool',
      { x: z.number() },
      async args => ({
        content: [{ type: 'text', text: `x=${args.x}` }],
      }),
    )
    // densable SEA / MCP SDK: truthy _registeredTools['constructor'] → throw
    expect(() =>
      createSdkMcpServer({ name: 'ctor-server', tools: [def] }),
    ).toThrow(/already registered/)
  })

  test('duplicate tool name throws already registered', () => {
    const a = tool('dup', 'a', {}, async () => ({
      content: [{ type: 'text', text: 'a' }],
    }))
    const b = tool('dup', 'b', {}, async () => ({
      content: [{ type: 'text', text: 'b' }],
    }))
    expect(() => createSdkMcpServer({ name: 'dups', tools: [a, b] })).toThrow(
      /already registered/,
    )
  })
})
