/**
 * densable 2.1.289 — MCP URL elicitation (2025-11-25) + bareElicitationCapability.
 * Gold: Idt/cln/TDt + bn/Lr + config key on stdio/sse/http/ws.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  densableBareClientCapabilities,
  densableClientCapabilitiesForConnect,
  densableClientCapabilitiesForServer,
  densableFormUrlClientCapabilities,
  isJavaMcpFormUrlElicitationReject,
  JAVA_MCP_BARE_ELICITATION_HINT,
  JAVA_MCP_FORM_URL_ELICITATION_REJECT_RE,
  patchMcpInitializeCapabilities,
} from '../mcpV2Client.js'
import {
  McpHTTPServerConfigSchema,
  McpSSEServerConfigSchema,
  McpStdioServerConfigSchema,
  McpWebSocketServerConfigSchema,
} from '../types.js'

const gatesOn = (key: string, def: boolean): boolean => {
  if (
    key === 'tengu_mcp_url_elicitation' ||
    key === 'tengu_mcp_legacy_url_elicitation'
  ) {
    return true
  }
  return def
}

const gatesOffLegacy = (key: string, def: boolean): boolean => {
  if (key === 'tengu_mcp_legacy_url_elicitation') return false
  if (key === 'tengu_mcp_url_elicitation') return true
  return def
}

describe('densable 2.1.289 bareElicitationCapability config', () => {
  test('stdio/sse/http/ws schemas accept bareElicitationCapability', () => {
    expect(
      McpStdioServerConfigSchema().parse({
        command: 'java',
        bareElicitationCapability: true,
      }).bareElicitationCapability,
    ).toBe(true)
    expect(
      McpSSEServerConfigSchema().parse({
        type: 'sse',
        url: 'https://example.com/sse',
        bareElicitationCapability: true,
      }).bareElicitationCapability,
    ).toBe(true)
    expect(
      McpHTTPServerConfigSchema().parse({
        type: 'http',
        url: 'https://example.com/mcp',
        bareElicitationCapability: false,
      }).bareElicitationCapability,
    ).toBe(false)
    expect(
      McpWebSocketServerConfigSchema().parse({
        type: 'ws',
        url: 'wss://example.com/mcp',
        bareElicitationCapability: true,
      }).bareElicitationCapability,
    ).toBe(true)
  })
})

describe('densable Idt / cln / TDt elicitation capability bags', () => {
  test('bare bag is roots.listChanged + elicitation:{}', () => {
    expect(densableBareClientCapabilities()).toEqual({
      roots: { listChanged: true },
      elicitation: {},
    })
  })

  test('form/url bag advertises elicitation.form + elicitation.url', () => {
    expect(densableFormUrlClientCapabilities(gatesOn)).toEqual({
      roots: { listChanged: true },
      elicitation: { form: {}, url: {} },
    })
  })

  test('Idt chooses form/url for stdio/http when gates on and not bare-pinned', () => {
    expect(
      densableClientCapabilitiesForServer(
        { type: 'stdio', command: 'java' },
        { denylisted: false, readFeature: gatesOn },
      ),
    ).toEqual({
      roots: { listChanged: true },
      elicitation: { form: {}, url: {} },
    })
    expect(
      densableClientCapabilitiesForServer(
        { type: 'http', url: 'https://example.com/mcp' },
        { denylisted: false, readFeature: gatesOn },
      ).elicitation,
    ).toEqual({ form: {}, url: {} })
  })

  test('Idt stays bare when bareElicitationCapability:true', () => {
    expect(
      densableClientCapabilitiesForServer(
        {
          type: 'stdio',
          command: 'java',
          bareElicitationCapability: true,
        },
        { denylisted: false, readFeature: gatesOn },
      ),
    ).toEqual(densableBareClientCapabilities())
  })

  test('Idt stays bare when denylisted or legacy gate off', () => {
    expect(
      densableClientCapabilitiesForServer(
        { type: 'stdio', command: 'java' },
        { denylisted: true, readFeature: gatesOn },
      ),
    ).toEqual(densableBareClientCapabilities())
    expect(
      densableClientCapabilitiesForServer(
        { type: 'stdio', command: 'java' },
        { denylisted: false, readFeature: gatesOffLegacy },
      ),
    ).toEqual(densableBareClientCapabilities())
  })

  test('ze ternary: forceBare → bare; auto → form/url; legacy → Idt', () => {
    expect(
      densableClientCapabilitiesForConnect(
        { mode: 'auto', probe: { timeoutMs: 1000 } },
        { type: 'stdio', command: 'java' },
        { forceBare: true, readFeature: gatesOn },
      ),
    ).toEqual(densableBareClientCapabilities())
    expect(
      densableClientCapabilitiesForConnect(
        { mode: 'auto', probe: { timeoutMs: 1000 } },
        { type: 'stdio', command: 'java' },
        { readFeature: gatesOn },
      ).elicitation,
    ).toEqual({ form: {}, url: {} })
    expect(
      densableClientCapabilitiesForConnect(
        { mode: 'legacy' },
        {
          type: 'stdio',
          command: 'java',
          bareElicitationCapability: true,
        },
        { readFeature: gatesOn },
      ),
    ).toEqual(densableBareClientCapabilities())
  })
})

describe('densable bn / Lr Java form-url reject helpers', () => {
  test('ua regex matches gold Jackson message', () => {
    const msg =
      'Unrecognized field "form" (class io.modelcontextprotocol.spec.McpSchema$ClientCapabilities$Elicitation)'
    expect(JAVA_MCP_FORM_URL_ELICITATION_REJECT_RE.test(msg)).toBe(true)
    expect(JAVA_MCP_BARE_ELICITATION_HINT).toContain(
      '"bareElicitationCapability": true',
    )
  })

  test('bn true only when current plan would still advertise url', () => {
    const err = new Error(
      'Unrecognized field "url" (class io.modelcontextprotocol.spec.McpSchema$ClientCapabilities$Elicitation)',
    )
    expect(
      isJavaMcpFormUrlElicitationReject(
        err,
        { type: 'stdio', command: 'java' },
        null,
        { denylisted: false, readFeature: gatesOn },
      ),
    ).toBe(true)
    expect(
      isJavaMcpFormUrlElicitationReject(
        err,
        {
          type: 'stdio',
          command: 'java',
          bareElicitationCapability: true,
        },
        null,
        { denylisted: false, readFeature: gatesOn },
      ),
    ).toBe(false)
  })

  test('Lr rewrites initialize capabilities through Idt', async () => {
    const sent: unknown[] = []
    const client = {
      send: async (message: unknown) => {
        sent.push(message)
        return undefined
      },
    }
    patchMcpInitializeCapabilities(
      client,
      {
        type: 'stdio',
        command: 'java',
        bareElicitationCapability: true,
      },
      { denylisted: false, readFeature: gatesOn },
    )
    await client.send({
      method: 'initialize',
      params: {
        capabilities: { elicitation: { form: {}, url: {} } },
        protocolVersion: '2025-11-25',
      },
    })
    const msg = sent[0] as {
      params: { capabilities: { elicitation: unknown } }
    }
    expect(msg.params.capabilities.elicitation).toEqual({})
  })
})

describe('densable HEe ownership arm — HAVE with mount callers', () => {
  test('markCliOwnedConfig wires HEe OR; no minify OEe/HEe/nf exports', async () => {
    const {
      isCliOwnedConfig,
      markCliOwnedConfig,
      resetCliOwnedConfigsForTests,
    } = await import('../cliOwnedConfigs.js')
    const { isMcpCcrProxyServerConfig } = await import(
      '../mcpConnectTimeout.js'
    )
    resetCliOwnedConfigsForTests()
    const config = { type: 'http', url: 'https://example/not-ccr' }
    markCliOwnedConfig(config)
    expect(isCliOwnedConfig(config)).toBe(true)
    expect(isMcpCcrProxyServerConfig(config)).toBe(true)

    const owned = await import('../cliOwnedConfigs.js')
    expect('OEe' in owned).toBe(false)
    expect('nf' in owned).toBe(false)
    expect('HEe' in owned).toBe(false)

    const v2 = readFileSync(join(import.meta.dir, '../mcpV2Client.ts'), 'utf8')
    const timeout = readFileSync(
      join(import.meta.dir, '../mcpConnectTimeout.ts'),
      'utf8',
    )
    expect(timeout).toContain('isCliOwnedConfig')
    expect(v2).toContain('markCliOwnedConfig')
    expect(v2).not.toContain('export function OEe')
    expect(timeout).not.toContain('export function HEe')
  })
})
