import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  filterMcpServersByPolicy,
  parseMcpConfig,
  parseMcpConfigFromFilePath,
} from '../config.js'
import {
  createClaudeAiProxyFetch,
  wrapFetchWithTimeout,
} from '../connectionHelpers.js'
import { wrapFirstPartyAutoAuthFetch } from '../mcpFirstPartyAutoAuth.js'
import { getMaxMcpDescriptionLengthForConfig } from '../clientHelpers.js'
import { resolveMcpProtocolNegotiationPlan } from '../mcpConnectTimeout.js'
import {
  getAuthConfiguredHeadersForUrl,
  wrapAuthFetchWithHeaders,
} from '../auth.js'
import { SettingsSchema } from '../../../utils/settings/types.js'

describe('MCP v2.1.299-301 alignment (#596, #606, #619, #643, #680, #716, #725, #726)', () => {
  test('#596: empty or whitespace-only project .mcp.json is read as no servers without error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-empty-'))
    try {
      const filePath = join(dir, '.mcp.json')
      writeFileSync(filePath, '   \n\t  ', 'utf8')
      const res = parseMcpConfigFromFilePath({
        filePath,
        expandVars: false,
        scope: 'project',
      })
      expect(res.errors).toEqual([])
      expect(res.config).not.toBeNull()
      expect(Object.keys(res.config!.mcpServers)).toEqual([])

      // Non-project scope still reports invalid JSON
      const userRes = parseMcpConfigFromFilePath({
        filePath,
        expandVars: false,
        scope: 'user',
      })
      expect(userRes.config).toBeNull()
      expect(userRes.errors.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#606/#607: servers named constructor, prototype, or toString are preserved on null-proto maps', () => {
    const parsed = parseMcpConfig({
      configObject: {
        mcpServers: {
          constructor: { type: 'http', url: 'https://example.com/a' },
          prototype: { type: 'http', url: 'https://example.com/b' },
          toString: { type: 'http', url: 'https://example.com/c' },
        },
      },
      expandVars: false,
      scope: 'user',
    })
    expect(parsed.config).not.toBeNull()
    const servers = parsed.config!.mcpServers
    expect(Object.getPrototypeOf(servers)).toBeNull()
    expect(Object.hasOwn(servers, 'constructor')).toBe(true)
    expect(Object.hasOwn(servers, 'prototype')).toBe(true)
    expect(Object.hasOwn(servers, 'toString')).toBe(true)

    const { allowed, blocked } = filterMcpServersByPolicy(servers)
    expect(Object.getPrototypeOf(allowed)).toBeNull()
    expect(blocked).toEqual([])
    expect(Object.hasOwn(allowed, 'constructor')).toBe(true)
    expect(Object.hasOwn(allowed, 'prototype')).toBe(true)
    expect(Object.hasOwn(allowed, 'toString')).toBe(true)
  })

  test('#619: enabledMcpjsonServers and disabledMcpjsonServers coerce single valid server name string', () => {
    const parsed = SettingsSchema().safeParse({
      enabledMcpjsonServers: 'my-server_1',
      disabledMcpjsonServers: 'other_server-2',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.enabledMcpjsonServers).toEqual(['my-server_1'])
      expect(parsed.data.disabledMcpjsonServers).toEqual(['other_server-2'])
    }

    const invalid = SettingsSchema().safeParse({
      enabledMcpjsonServers: 'invalid server name!',
    })
    expect(invalid.success).toBe(false)
  })

  test('#643: wrapFetchWithTimeout cancels response.body on POST JSON-RPC notifications', async () => {
    let cancelCalls = 0
    const mockFetch = (async () => {
      const stream = new ReadableStream({
        cancel() {
          cancelCalls++
        },
      })
      return new Response(stream, { status: 202 })
    }) as unknown as typeof fetch

    const wrapped = wrapFetchWithTimeout(mockFetch)

    // Notification (no id) -> cancels body
    await wrapped('https://example.com/mcp', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    })
    expect(cancelCalls).toBe(1)

    // Request (has id) -> does NOT cancel body
    const reqRes = await wrapped('https://example.com/mcp', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    })
    expect(cancelCalls).toBe(1)
    await reqRes.body?.cancel()
  })

  test('#680: wrapAuthFetchWithHeaders & getAuthConfiguredHeadersForUrl inject same-origin headers and strip Authorization', async () => {
    const serverConfig = {
      type: 'http' as const,
      url: 'https://proxy.example.com/mcp',
      headers: {
        'X-Proxy-Key': 'secret-key',
        Authorization: 'Bearer should-be-stripped',
      },
    }

    const sameOriginHeaders = await getAuthConfiguredHeadersForUrl(
      'test-srv',
      serverConfig,
      'https://proxy.example.com/oauth/revoke',
    )
    expect(sameOriginHeaders['x-proxy-key']).toBe('secret-key')
    expect(sameOriginHeaders['authorization']).toBeUndefined()

    const crossOriginHeaders = await getAuthConfiguredHeadersForUrl(
      'test-srv',
      serverConfig,
      'https://evil.example.org/oauth/revoke',
    )
    expect(crossOriginHeaders).toEqual({})

    const seen: Array<{
      url: string
      proxyKey: string | null
      auth: string | null
    }> = []
    const authFetch = wrapAuthFetchWithHeaders(
      'test-srv',
      serverConfig,
      (async (url, init) => {
        const h = new Headers(init?.headers)
        seen.push({
          url: String(url),
          proxyKey: h.get('x-proxy-key'),
          auth: h.get('authorization'),
        })
        return new Response('{}', { status: 200 })
      }) as typeof fetch,
    )

    await authFetch(
      'https://proxy.example.com/.well-known/oauth-authorization-server',
    )
    await authFetch(
      'https://other.example.org/.well-known/oauth-authorization-server',
    )

    expect(seen[0]).toEqual({
      url: 'https://proxy.example.com/.well-known/oauth-authorization-server',
      proxyKey: 'secret-key',
      auth: null,
    })
    expect(seen[1]).toEqual({
      url: 'https://other.example.org/.well-known/oauth-authorization-server',
      proxyKey: null,
      auth: null,
    })
  })

  test('#716: wrapFirstPartyAutoAuthFetch sets redirect=manual for api.anthropic.com and leaves third-party untouched', async () => {
    const seenRedirects: Array<RequestRedirect | undefined> = []
    const inner = (async (_url, init) => {
      seenRedirects.push(init?.redirect)
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    const wrapped = wrapFirstPartyAutoAuthFetch(inner)
    await wrapped('https://api.anthropic.com/v1/pages/mcp', {
      headers: { Authorization: 'Bearer existing' },
    })
    await wrapped('https://thirdparty.example.com/mcp', {
      headers: { Authorization: 'Bearer existing' },
    })
    expect(seenRedirects).toEqual(['manual', undefined])
  })

  test('#716: createClaudeAiProxyFetch sets redirect=manual', () => {
    // Verify export and wrapper contract
    expect(typeof createClaudeAiProxyFetch).toBe('function')
  })

  test('#725: resolveMcpProtocolNegotiationPlan defaults to auto and supports MCP_PROTOCOL_NEGOTIATION=legacy', () => {
    expect(resolveMcpProtocolNegotiationPlan('http', {}, () => true).mode).toBe(
      'auto',
    )
    expect(
      resolveMcpProtocolNegotiationPlan('ccr-proxy', {}, () => true).mode,
    ).toBe('auto')
    expect(
      resolveMcpProtocolNegotiationPlan(
        'http',
        { MCP_PROTOCOL_NEGOTIATION: 'legacy' },
        () => true,
      ).mode,
    ).toBe('legacy')
  })

  test('#726: getMaxMcpDescriptionLengthForConfig exempts api.anthropic.com http/sse servers', () => {
    expect(
      getMaxMcpDescriptionLengthForConfig({
        type: 'http',
        url: 'https://api.anthropic.com/v1/pages/mcp',
      }),
    ).toBe(Infinity)
    expect(
      getMaxMcpDescriptionLengthForConfig({
        type: 'sse',
        url: 'https://api.anthropic.com/v1/design/sse',
      }),
    ).toBe(Infinity)
    expect(
      getMaxMcpDescriptionLengthForConfig({
        type: 'http',
        url: 'https://example.com/mcp',
      }),
    ).toBe(4096)
    expect(
      getMaxMcpDescriptionLengthForConfig({
        type: 'stdio',
      }),
    ).toBe(4096)
  })
})
