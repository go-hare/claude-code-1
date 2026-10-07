import { afterEach, describe, expect, test } from 'bun:test'
import { CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV } from '../../../bridge/bridgeCarrier.js'
import {
  CLAUDE_CODE_REMOTE_MCP_SERVER_ID,
  CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
} from '../../../bridge/hearthbotMcp.js'
import {
  isCliOwnedConfig,
  resetCliOwnedConfigsForTests,
} from '../cliOwnedConfigs.js'
import { parseMcpConfig } from '../config.js'
import { resetMcpCcrIngressCapture } from '../mcpConnectTimeout.js'

const prevCarrier = process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV]
const prevIngress = process.env.SESSION_INGRESS_URL

afterEach(() => {
  resetCliOwnedConfigsForTests()
  if (prevCarrier === undefined) {
    delete process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV]
  } else {
    process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV] = prevCarrier
  }
  if (prevIngress === undefined) delete process.env.SESSION_INGRESS_URL
  else process.env.SESSION_INGRESS_URL = prevIngress
  resetMcpCcrIngressCapture()
})

describe('densable 2.1.289 parseMcpConfig carrier-child arm (oFn)', () => {
  test('foreign name drops bridge_carrier_foreign_entry', () => {
    process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV] = '1'
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const { config, errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          other: {
            type: 'http',
            url: 'https://api.example/v2/ccr-sessions/cse_1/mcp',
          },
        },
      },
      expandVars: false,
      scope: 'dynamic',
      bridgeSessionId: 'cse_1',
    })
    expect(config?.mcpServers).toEqual({})
    expect(errors[0]?.mcpErrorMetadata?.skipReason).toBe(
      'bridge_carrier_foreign_entry',
    )
  })

  test('hostCarrier forces arm without env; not-http drops', () => {
    delete process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV]
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const { errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: {
            type: 'sse',
            url: 'https://api.example/v2/ccr-sessions/cse_1/mcp',
          },
        },
      },
      expandVars: false,
      scope: 'dynamic',
      hostCarrier: true,
      bridgeSessionId: 'cse_1',
    })
    expect(errors[0]?.mcpErrorMetadata?.skipReason).toBe(
      'bridge_carrier_not_http',
    )
  })

  test('no ingress origin drops bridge_carrier_no_ingress_origin', () => {
    process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV] = '1'
    delete process.env.SESSION_INGRESS_URL
    delete process.env.ANTHROPIC_BASE_URL
    resetMcpCcrIngressCapture()
    const { errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: {
            type: 'http',
            url: 'https://api.example/v2/ccr-sessions/cse_1/mcp',
          },
        },
      },
      expandVars: false,
      scope: 'dynamic',
      bridgeSessionId: 'cse_1',
    })
    expect(errors[0]?.mcpErrorMetadata?.skipReason).toBe(
      'bridge_carrier_no_ingress_origin',
    )
  })

  test('missing bridgeSessionId drops bridge_carrier_no_session_id', () => {
    process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV] = '1'
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const { errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: {
            type: 'http',
            url: 'https://api.example/v2/ccr-sessions/cse_1/mcp',
          },
        },
      },
      expandVars: false,
      scope: 'dynamic',
    })
    expect(errors[0]?.mcpErrorMetadata?.skipReason).toBe(
      'bridge_carrier_no_session_id',
    )
  })

  test('wrong origin/path drops bridge_carrier_url_mismatch', () => {
    process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV] = '1'
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const { errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: {
            type: 'http',
            url: 'https://evil.example/v2/ccr-sessions/cse_1/mcp',
          },
        },
      },
      expandVars: false,
      scope: 'dynamic',
      bridgeSessionId: 'cse_1',
    })
    expect(errors[0]?.mcpErrorMetadata?.skipReason).toBe(
      'bridge_carrier_url_mismatch',
    )
  })

  test('toolbox_mcp_server_id=x (not iqt) drops bridge_carrier_url_mismatch', () => {
    process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV] = '1'
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const { config, errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: {
            type: 'http',
            url: 'https://api.example/v2/ccr-sessions/cse_1/mcp?mcp_server_id=11111111-1111-1111-1111-111111111111&toolbox_mcp_server_id=x',
          },
        },
      },
      expandVars: false,
      scope: 'dynamic',
      bridgeSessionId: 'cse_1',
    })
    expect(config?.mcpServers).toEqual({})
    expect(errors[0]?.mcpErrorMetadata?.skipReason).toBe(
      'bridge_carrier_url_mismatch',
    )
  })

  test('empty query drops; gold Ykn requires toolbox_mcp_server_id===iqt', () => {
    process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV] = '1'
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const { errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: {
            type: 'http',
            url: 'https://api.example/v2/ccr-sessions/cse_1/mcp',
          },
        },
      },
      expandVars: false,
      scope: 'dynamic',
      bridgeSessionId: 'cse_1',
    })
    expect(errors[0]?.mcpErrorMetadata?.skipReason).toBe(
      'bridge_carrier_url_mismatch',
    )
  })

  test('claude-code-remote http rewrite marks cliOwned Cet with forced iqt query', () => {
    process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV] = '1'
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const { config, errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: {
            type: 'http',
            url: `https://api.example/v2/ccr-sessions/cse_1/mcp?mcp_server_id=11111111-1111-1111-1111-111111111111&toolbox_mcp_server_id=${CLAUDE_CODE_REMOTE_MCP_SERVER_ID}&mcp_url=https://api.example/v2/ccr-sessions/-/meta/mcp`,
          },
        },
      },
      expandVars: false,
      scope: 'dynamic',
      bridgeSessionId: 'cse_1',
    })
    expect(errors.filter(e => e.mcpErrorMetadata?.skipReason)).toEqual([])
    const server = config?.mcpServers[CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]
    expect(server).toBeDefined()
    expect(isCliOwnedConfig(server!)).toBe(true)
    expect(server).toMatchObject({
      type: 'http',
      url: `https://api.example/v2/ccr-sessions/cse_1/mcp?mcp_url=https%3A%2F%2Fapi.example%2Fv2%2Fccr-sessions%2F-%2Fmeta%2Fmcp&mcp_server_id=11111111-1111-1111-1111-111111111111&toolbox_mcp_server_id=${CLAUDE_CODE_REMOTE_MCP_SERVER_ID}`,
      alwaysLoad: true,
      headers: {
        'X-MCP-Server-ID': CLAUDE_CODE_REMOTE_MCP_SERVER_ID,
        'X-Session-UUID': 'cse_1',
        'anthropic-version': '2023-06-01',
      },
    })
  })

  test('non-dynamic scope ignores carrier arm', () => {
    process.env[CLAUDE_CODE_BRIDGE_MCP_CARRIER_ENV] = '1'
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const { config, errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          other: {
            type: 'http',
            url: 'https://api.example/mcp',
          },
        },
      },
      expandVars: false,
      scope: 'project',
      bridgeSessionId: 'cse_1',
    })
    expect(errors.filter(e => e.mcpErrorMetadata?.skipReason)).toEqual([])
    expect(config?.mcpServers.other).toMatchObject({
      type: 'http',
      url: 'https://api.example/mcp',
    })
    expect(isCliOwnedConfig(config!.mcpServers.other)).toBe(false)
  })
})
