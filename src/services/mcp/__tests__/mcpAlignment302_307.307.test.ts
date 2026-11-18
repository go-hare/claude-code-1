import { describe, expect, test } from 'bun:test'
import {
  fillMissingModernResultFields,
  wrapModernProtocolResultCompat,
  captureConnectClockSnapshot,
  detectConnectSuspendedMessage,
  redialOnConnectSuspended,
  MAX_CONNECT_SUSPEND_REDIALS,
  type ModernCompatTransportLike,
} from '../mcpConnectTimeout.js'
import {
  McpCredentialStoreUnavailableError,
  McpSessionExpiredError,
} from '../connectionHelpers.js'
import { isRetryableRemoteMcpFailure } from '../headlessMcpIdentityBoundary.js'
import {
  hasEnvVarInCommandArgsUrlOrHeaders,
  isMcpServerAllowedByPolicy,
  parseMcpConfig,
} from '../config.js'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('2.1.302-307 MCP alignment (#911, #1053, #1056, #1078, #1079, #1080)', () => {
  test('#911 fillMissingModernResultFields fills resultType, ttlMs, cacheScope when omitted', () => {
    const toolCallResult: Record<string, unknown> = { content: [] }
    expect(fillMissingModernResultFields('tools/call', toolCallResult)).toEqual(
      ['resultType="complete"'],
    )
    expect(toolCallResult.resultType).toBe('complete')
    expect(toolCallResult.ttlMs).toBeUndefined()

    const toolsListResult: Record<string, unknown> = { tools: [] }
    expect(
      fillMissingModernResultFields('tools/list', toolsListResult),
    ).toEqual(['resultType="complete"', 'ttlMs=0', 'cacheScope="private"'])
    expect(toolsListResult).toEqual({
      tools: [],
      resultType: 'complete',
      ttlMs: 0,
      cacheScope: 'private',
    })
  })

  test('#911 wrapModernProtocolResultCompat patches inbound results for 2026-07-28 requests and logs once per method', async () => {
    const logs: string[] = []
    const inboundSeen: Array<Record<string, unknown>> = []
    const transport: ModernCompatTransportLike = {
      send: async () => {},
      onmessage: msg => {
        inboundSeen.push(msg)
      },
    }
    wrapModernProtocolResultCompat(transport, 'test-srv', msg => logs.push(msg))

    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
      },
    })
    await transport.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {
        _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
      },
    })

    const r1: Record<string, unknown> = {
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [] },
    }
    const r2: Record<string, unknown> = {
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [] },
    }
    transport.onmessage?.(r1)
    transport.onmessage?.(r2)

    expect(r1.result).toEqual({
      tools: [],
      resultType: 'complete',
      ttlMs: 0,
      cacheScope: 'private',
    })
    expect(r2.result).toEqual({
      tools: [],
      resultType: 'complete',
      ttlMs: 0,
      cacheScope: 'private',
    })
    expect(inboundSeen).toHaveLength(2)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('2026-07-28')
  })

  test('#1053 MCPServerApprovalDialog wires useIsWithinWindow + useRefusedWithin + refuseInput', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../components/MCPServerApprovalDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('useIsWithinWindow')
    expect(src).toContain('useRefusedWithin')
    expect(src).toContain('refuseInput={refuseInput}')
    expect(src).toContain('if (refuseInput()) return')
  })

  test('#1056 hasEnvVarInCommandArgsUrlOrHeaders ignores env-only ${VAR} and allows managed-mcp.json stdio server', () => {
    expect(
      hasEnvVarInCommandArgsUrlOrHeaders({
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'my-server'],
        env: { API_KEY: '${MY_SECRET}' },
      }),
    ).toBe(false)

    expect(
      hasEnvVarInCommandArgsUrlOrHeaders({
        type: 'stdio',
        command: '${MY_BIN}',
        args: [],
      }),
    ).toBe(true)

    expect(
      hasEnvVarInCommandArgsUrlOrHeaders({
        type: 'http',
        url: 'https://example.com/${TENANT}/mcp',
      }),
    ).toBe(true)

    const { config } = parseMcpConfig({
      configObject: {
        mcpServers: {
          envOnly: {
            command: 'node',
            args: ['server.js'],
            env: { TOKEN: '${SECRET_TOKEN}' },
          },
          cmdVar: {
            command: '${BIN_PATH}',
            args: [],
          },
        },
      },
      expandVars: false,
      scope: 'enterprise',
    })
    expect(
      (config?.mcpServers.envOnly as { expandedFromEnv?: boolean })
        ?.expandedFromEnv,
    ).toBeUndefined()
    expect(
      (config?.mcpServers.cmdVar as { expandedFromEnv?: boolean })
        ?.expandedFromEnv,
    ).toBe(true)

    // Even if allowedMcpServers is configured elsewhere, non-expandedFromEnv enterprise server is allowed
    expect(
      isMcpServerAllowedByPolicy('envOnly', {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        scope: 'enterprise',
      } as unknown as Parameters<typeof isMcpServerAllowedByPolicy>[1]),
    ).toBe(true)
  })

  test('#1078 McpCredentialStoreUnavailableError sets CREDENTIAL_STORE_UNAVAILABLE and is retryable', () => {
    const err = new McpCredentialStoreUnavailableError('my-mcp')
    expect(err.code).toBe('CREDENTIAL_STORE_UNAVAILABLE')
    expect(err.name).toBe('McpCredentialStoreUnavailableError')
    expect(err.message).toContain('my-mcp')
    expect(
      isRetryableRemoteMcpFailure({
        name: 'my-mcp',
        type: 'failed',
        config: { type: 'http', url: 'https://example.com', scope: 'user' },
        errorCode: 'CREDENTIAL_STORE_UNAVAILABLE',
      }),
    ).toBe(true)
  })

  test('#1079 CONNECT_SUSPENDED detects sleep clock jump and redials up to MAX_CONNECT_SUSPEND_REDIALS', async () => {
    let wall = 10_000
    let mono = 1_000
    const snap = captureConnectClockSnapshot({
      now: () => wall,
      monotonicNow: () => mono,
    })
    // Advance wall clock by 15s while monotonic only advanced 200ms -> slept!
    wall += 15_000
    mono += 200
    const msg = detectConnectSuspendedMessage('sleepy-mcp', snap)
    expect(msg).toContain('sleepy-mcp')
    expect(msg).toContain('went to sleep')

    expect(
      isRetryableRemoteMcpFailure({
        name: 'sleepy-mcp',
        type: 'failed',
        config: { type: 'http', url: 'https://example.com', scope: 'user' },
        errorCode: 'CONNECT_SUSPENDED',
      }),
    ).toBe(true)

    let calls = 0
    let exhausted = false
    const res = await redialOnConnectSuspended(
      async () => {
        calls++
        return {
          name: 'sleepy-mcp',
          type: 'failed',
          errorCode: 'CONNECT_SUSPENDED',
        }
      },
      () => true,
      () => {
        exhausted = true
      },
      () => {},
    )
    expect(calls).toBe(1 + MAX_CONNECT_SUSPEND_REDIALS)
    expect(exhausted).toBe(true)
    expect(res.errorCode).toBe('CONNECT_SUSPENDED')
  })

  test('#1080 McpSessionExpiredError.mayHaveRun distinguishes 404 vs connection_closed_http', () => {
    const expired404 = new McpSessionExpiredError('srv', 'session_expired_404')
    expect(expired404.mayHaveRun).toBe(false)

    const closedHttp = new McpSessionExpiredError(
      'srv',
      'connection_closed_http',
    )
    expect(closedHttp.mayHaveRun).toBe(true)
  })
})
