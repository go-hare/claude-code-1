/**
 * densable 2.1.238 #16 — N_f / F_f / oGn / L_f / H_f / $Yp
 * claudeai-proxy send-intercept only. Never stdio. Never cliOwnedConfigs/vbe.
 *
 * Do not mock src/services/mcp/client.ts (same-dir mock pollution).
 */
import { describe, expect, mock, test } from 'bun:test'
import type { Transport } from '@modelcontextprotocol/client'
import {
  LATEST_PROTOCOL_VERSION,
  ProtocolErrorCode,
} from '@modelcontextprotocol/client'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

import {
  CLAUDEAI_INIT_PROJECTION_HEADER_MAX_BYTES,
  CLAUDEAI_MCP_PROTOCOL_VERSION_HEADER,
  claudeAiMcpInitProjectionHeaders,
  interceptStatelessClaudeAiProxySend,
  isStatelessClaudeAiProxy,
  resolveCachedClaudeAiDiscover,
  resolveCachedClaudeAiInitialize,
  sanitizeProtocolVersionForLog,
  suppressGetSseOnEndpoint,
  wrapStatelessClaudeAiProxyTransport,
  type ClaudeAiProxyStatelessConfig,
} from '../claudeAiProxyStateless.js'
import { densableClientCapabilities } from '../mcpV2Client.js'

const gbOn = () => true
const gbOff = () => false

const validInit = {
  protocolVersion: '2025-11-25',
  capabilities: {},
  serverInfo: { name: 'proxy', version: '1' },
}

const validDiscover = {
  supportedVersions: ['2025-11-25'],
  capabilities: {},
}

function proxyConfig(
  extra: Partial<ClaudeAiProxyStatelessConfig> = {},
): ClaudeAiProxyStatelessConfig {
  return {
    type: 'claudeai-proxy',
    id: 'srv_1',
    stateless: true,
    ...extra,
  }
}

function fakeTransport() {
  const sent: unknown[] = []
  const transport = {
    send: async (message: unknown) => {
      sent.push(message)
    },
    start: async () => {},
    close: async () => {},
    onmessage: undefined as Transport['onmessage'],
  }
  return { transport: transport as unknown as Transport, sent, raw: transport }
}

async function flushMicrotask(): Promise<void> {
  await new Promise<void>(resolve => {
    queueMicrotask(resolve)
  })
}

describe('densable 2.1.238 #16 oGn / fqn', () => {
  test('claudeai-proxy + stateless + GB is skip-init', () => {
    expect(isStatelessClaudeAiProxy(proxyConfig(), gbOn)).toBe(true)
  })

  test('GB off is not skip-init', () => {
    expect(isStatelessClaudeAiProxy(proxyConfig(), gbOff)).toBe(false)
  })

  test('stateless false is not skip-init', () => {
    expect(
      isStatelessClaudeAiProxy(proxyConfig({ stateless: false }), gbOn),
    ).toBe(false)
  })

  test('stdio is never skip-init', () => {
    expect(
      isStatelessClaudeAiProxy({ type: 'stdio', stateless: true }, gbOn),
    ).toBe(false)
  })
})

describe('densable 2.1.238 #16 L_f cached initialize', () => {
  test('valid cachedInitResponse returns InitializeResult', () => {
    const result = resolveCachedClaudeAiInitialize(
      proxyConfig({ cachedInitResponse: validInit }),
      gbOn,
    )
    expect(result).toEqual(validInit)
  })

  test('null cachedInitResponse falls through', () => {
    expect(
      resolveCachedClaudeAiInitialize(
        proxyConfig({ cachedInitResponse: null }),
        gbOn,
      ),
    ).toBeUndefined()
  })

  test('invalid shape falls through', () => {
    expect(
      resolveCachedClaudeAiInitialize(
        proxyConfig({ cachedInitResponse: { nope: true } }),
        gbOn,
      ),
    ).toBeUndefined()
  })

  test('unsupported protocolVersion falls through', () => {
    expect(
      resolveCachedClaudeAiInitialize(
        proxyConfig({
          cachedInitResponse: {
            ...validInit,
            protocolVersion: '1999-01-01',
          },
        }),
        gbOn,
      ),
    ).toBeUndefined()
  })

  test('F1e strips non-ascii and caps at 32', () => {
    expect(sanitizeProtocolVersionForLog(`${'a'.repeat(40)}\n\x01`)).toBe(
      'a'.repeat(32),
    )
  })
})

describe('densable 2.1.238 #16 H_f cached discover', () => {
  test('legacy → method-not-found even without body', () => {
    expect(
      resolveCachedClaudeAiDiscover(
        proxyConfig({ discoverSupport: 'legacy' }),
        gbOn,
      ),
    ).toBe('method-not-found')
  })

  test('supported + valid body → result', () => {
    expect(
      resolveCachedClaudeAiDiscover(
        proxyConfig({
          discoverSupport: 'supported',
          cachedDiscoverResponse: validDiscover,
        }),
        gbOn,
      ),
    ).toEqual({ result: validDiscover })
  })

  test('missing discoverSupport passes through', () => {
    expect(
      resolveCachedClaudeAiDiscover(
        proxyConfig({ cachedDiscoverResponse: validDiscover }),
        gbOn,
      ),
    ).toBeUndefined()
  })

  test('supported + invalid body passes through', () => {
    expect(
      resolveCachedClaudeAiDiscover(
        proxyConfig({
          discoverSupport: 'supported',
          cachedDiscoverResponse: { nope: true },
        }),
        gbOn,
      ),
    ).toBeUndefined()
  })
})

describe('densable 2.1.238 #16 N_f send intercept', () => {
  test('initialize resolves from cached projection (no wire send)', async () => {
    const { transport, sent, raw } = fakeTransport()
    const messages: unknown[] = []
    raw.onmessage = msg => {
      messages.push(msg)
    }
    interceptStatelessClaudeAiProxySend(transport, validInit as never)
    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })
    expect(sent).toEqual([])
    await flushMicrotask()
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 1, result: validInit }])
  })

  test('server/discover method-not-found uses gold string + MethodNotFound', async () => {
    const { transport, sent, raw } = fakeTransport()
    const messages: unknown[] = []
    raw.onmessage = msg => {
      messages.push(msg)
    }
    interceptStatelessClaudeAiProxySend(
      transport,
      validInit as never,
      'method-not-found',
    )
    await transport.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'server/discover',
      params: {},
    })
    expect(sent).toEqual([])
    await flushMicrotask()
    expect(messages).toEqual([
      {
        jsonrpc: '2.0',
        id: 2,
        error: {
          code: ProtocolErrorCode.MethodNotFound,
          message: 'server/discover resolved locally as unsupported',
        },
      },
    ])
  })

  test('server/discover result from cached projection', async () => {
    const { transport, sent, raw } = fakeTransport()
    const messages: unknown[] = []
    raw.onmessage = msg => {
      messages.push(msg)
    }
    interceptStatelessClaudeAiProxySend(transport, validInit as never, {
      result: validDiscover as never,
    })
    await transport.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'server/discover',
      params: {},
    })
    expect(sent).toEqual([])
    await flushMicrotask()
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 3, result: validDiscover }])
  })

  test('swallows notifications/initialized', async () => {
    const { transport, sent } = fakeTransport()
    interceptStatelessClaudeAiProxySend(transport, validInit as never)
    await transport.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(sent).toEqual([])
  })

  // SEA leftover #4 / densable N_f: swallow is unconditional — even when
  // initialize stays on the wire (no cachedInit).
  test('swallows notifications/initialized even when cachedInit is undefined', async () => {
    const { transport, sent } = fakeTransport()
    interceptStatelessClaudeAiProxySend(transport, undefined)
    await transport.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(sent).toEqual([])
  })

  test('skeleton E2E: cached init+discover never race ahead of each other on the wire', async () => {
    const { transport, sent, raw } = fakeTransport()
    const messages: unknown[] = []
    raw.onmessage = msg => {
      messages.push(msg)
    }
    interceptStatelessClaudeAiProxySend(
      transport,
      validInit as never,
      'method-not-found',
    )
    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })
    await transport.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'server/discover',
      params: {},
    })
    expect(sent).toEqual([])
    await flushMicrotask()
    expect(messages).toHaveLength(2)
    expect((messages[0] as { id: number }).id).toBe(1)
    expect((messages[1] as { id: number }).id).toBe(2)
    expect(
      (messages[1] as { error?: { message: string } }).error?.message,
    ).toBe('server/discover resolved locally as unsupported')
  })

  test('other methods still hit original send', async () => {
    const { transport, sent } = fakeTransport()
    interceptStatelessClaudeAiProxySend(transport, validInit as never)
    const ping = { jsonrpc: '2.0' as const, id: 9, method: 'ping' }
    await transport.send(ping)
    expect(sent).toEqual([ping])
  })

  test('undefined cachedInit leaves initialize on the wire', async () => {
    const { transport, sent } = fakeTransport()
    interceptStatelessClaudeAiProxySend(transport, undefined)
    const init = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: {},
    }
    await transport.send(init)
    expect(sent).toEqual([init])
  })
})

describe('densable 2.1.238 #16 F_f GET SSE suppress', () => {
  test('GET to canonical endpoint returns 405 Method Not Allowed', async () => {
    const inner = mock(async () => new Response('hit'))
    const fetch = suppressGetSseOnEndpoint(
      inner as never,
      'https://proxy.example/mcp',
    )
    const res = await fetch('https://proxy.example/mcp', { method: 'GET' })
    expect(res.status).toBe(405)
    expect(res.statusText).toBe('Method Not Allowed')
    expect(inner).not.toHaveBeenCalled()
  })

  test('POST to canonical endpoint is not suppressed', async () => {
    const inner = mock(async () => new Response('ok', { status: 200 }))
    const fetch = suppressGetSseOnEndpoint(
      inner as never,
      'https://proxy.example/mcp',
    )
    const res = await fetch('https://proxy.example/mcp', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  test('GET to a different URL is not suppressed', async () => {
    const inner = mock(async () => new Response('other', { status: 200 }))
    const fetch = suppressGetSseOnEndpoint(
      inner as never,
      'https://proxy.example/mcp',
    )
    const res = await fetch('https://proxy.example/other', { method: 'GET' })
    expect(res.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  test('GET with URL object to canonical endpoint returns 405', async () => {
    const inner = mock(async () => new Response('hit'))
    const fetch = suppressGetSseOnEndpoint(
      inner as never,
      'https://proxy.example/mcp',
    )
    const res = await fetch(new URL('https://proxy.example/mcp'), {
      method: 'GET',
    })
    expect(res.status).toBe(405)
    expect(inner).not.toHaveBeenCalled()
  })
})

describe('densable 2.1.238 #16 $Yp init-projection headers', () => {
  test('GB off omits both headers', () => {
    expect(claudeAiMcpInitProjectionHeaders(gbOff)).toEqual({})
  })

  test('GB on stamps capabilities + protocol version', () => {
    const headers = claudeAiMcpInitProjectionHeaders(gbOn)
    expect(headers['MCP-Protocol-Version']).toBe(
      CLAUDEAI_MCP_PROTOCOL_VERSION_HEADER,
    )
    expect(headers['MCP-Protocol-Version']).toBe(LATEST_PROTOCOL_VERSION)
    expect(headers['MCP-Protocol-Version']).toBe('2025-11-25')
    const encoded = headers['anthropic-mcp-client-capabilities']
    expect(typeof encoded).toBe('string')
    expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))).toEqual(
      densableClientCapabilities(),
    )
    expect(CLAUDEAI_INIT_PROJECTION_HEADER_MAX_BYTES).toBe(6144)
  })
})

describe('densable 2.1.238 #16 wrapStatelessClaudeAiProxyTransport', () => {
  test('stdio-shaped config is never wrapped', () => {
    const { transport } = fakeTransport()
    const originalSend = transport.send
    const wrapped = wrapStatelessClaudeAiProxyTransport(
      transport,
      { type: 'stdio', id: 'x', stateless: true } as never,
      () => {},
      { readFeature: gbOn },
    )
    expect(wrapped).toBeUndefined()
    expect(transport.send).toBe(originalSend)
  })

  test('gold logs + initialize intercept when cached', async () => {
    const logs: string[] = []
    const { transport, sent, raw } = fakeTransport()
    const messages: unknown[] = []
    raw.onmessage = msg => {
      messages.push(msg)
    }
    const wrapped = wrapStatelessClaudeAiProxyTransport(
      transport,
      proxyConfig({
        cachedInitResponse: validInit,
        discoverSupport: 'legacy',
      }),
      msg => logs.push(msg),
      { readFeature: gbOn },
    )
    expect(wrapped?.cachedInit).toEqual(validInit)
    expect(wrapped?.cachedDiscover).toBe('method-not-found')
    expect(logs).toEqual([
      'Stateless claudeai-proxy — resolving MCP initialize from cached projection',
      'Stateless claudeai-proxy — server/discover resolved locally as legacy (method-not-found)',
    ])
    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })
    expect(sent).toEqual([])
    await flushMicrotask()
    expect(messages).toHaveLength(1)
  })

  test('no cached projection logs GET SSE suppressed', () => {
    const logs: string[] = []
    const { transport } = fakeTransport()
    wrapStatelessClaudeAiProxyTransport(
      transport,
      proxyConfig(),
      msg => logs.push(msg),
      { readFeature: gbOn },
    )
    expect(logs).toEqual([
      'Stateless claudeai-proxy — no cached projection; real initialize, GET SSE suppressed',
    ])
  })

  test('reconnect includeDiscover:false leaves discover on the wire', async () => {
    const { transport, sent } = fakeTransport()
    wrapStatelessClaudeAiProxyTransport(
      transport,
      proxyConfig({
        cachedInitResponse: validInit,
        discoverSupport: 'legacy',
      }),
      () => {},
      { includeDiscover: false, readFeature: gbOn },
    )
    const discover = {
      jsonrpc: '2.0' as const,
      id: 4,
      method: 'server/discover',
      params: {},
    }
    await transport.send(discover)
    expect(sent).toEqual([discover])
  })
})
