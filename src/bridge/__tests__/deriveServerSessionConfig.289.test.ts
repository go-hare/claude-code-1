import { afterEach, describe, expect, test } from 'bun:test'
import {
  CLAUDE_CODE_REMOTE_MCP_SERVER_ID,
  CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
} from '../hearthbotMcp.js'
import {
  deriveAutoModeEnvironment,
  deriveBridgeServerSessionConfig,
  deriveClaudeCodeArgs,
  extractMetaMcpFromConfig,
} from '../deriveServerSessionConfig.js'
import { resetMcpCcrIngressCapture } from '../../services/mcp/mcpConnectTimeout.js'

const prevIngress = process.env.SESSION_INGRESS_URL

afterEach(() => {
  if (prevIngress === undefined) delete process.env.SESSION_INGRESS_URL
  else process.env.SESSION_INGRESS_URL = prevIngress
  resetMcpCcrIngressCapture()
})

describe('densable 2.1.289 deriveBridgeServerSessionConfig (bQt)', () => {
  test('deriveClaudeCodeArgs allowlists model/effort/disallowedTools + append', () => {
    const got = deriveClaudeCodeArgs({
      model: 'claude-sonnet',
      effort: 'high',
      'append-system-prompt': 'extra',
      disallowedTools: 'Bash,Edit',
      unknown: 'x',
    })
    expect(got.appendSystemPrompt).toBe('extra')
    expect(got.disallowedTools).toEqual(['Bash', 'Edit'])
    expect(got.extraArgs).toEqual(['--model=claude-sonnet', '--effort=high'])
  })

  test('deriveAutoModeEnvironment stamps prefix and drops empty', () => {
    const got = deriveAutoModeEnvironment(['', 'ship fast'])
    expect(got).toHaveLength(1)
    expect(got[0]).toContain('ship fast')
    expect(got[0]).toContain('Stated by the service')
  })

  test('deriveAutoModeEnvironment skips $defaults sentinel (gold Be)', () => {
    const got = deriveAutoModeEnvironment([
      '$defaults',
      'ship fast',
      '$defaults',
    ])
    expect(got).toHaveLength(1)
    expect(got[0]).toContain('ship fast')
    expect(got.some(e => e.includes('$defaults'))).toBe(false)
    expect(deriveAutoModeEnvironment(['$defaults'])).toEqual([])
  })

  test('extractMetaMcpFromConfig honors only claude-code-remote via Ykn', () => {
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const toolbox = CLAUDE_CODE_REMOTE_MCP_SERVER_ID
    const mcpServers = {
      other: { type: 'http', url: 'https://api.example/x' },
      [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: {
        type: 'http',
        url: `https://api.example/v2/ccr-sessions/cse_1/mcp?toolbox_mcp_server_id=${toolbox}`,
        tools: [{ name: 'list' }],
      },
    }
    const content = Buffer.from(
      JSON.stringify({ mcpServers }),
      'utf8',
    ).toString('base64')
    const got = extractMetaMcpFromConfig(
      { content },
      { sessionId: 'cse_1', apiBaseUrl: 'https://api.example' },
    )
    expect(got.ignored).toBe(1)
    expect(got.dropped).toBeNull()
    expect(got.meta?.url).toContain('/v2/ccr-sessions/cse_1/mcp?')
    expect(got.meta?.autoAllowTools).toEqual(['list'])
  })

  test('deriveBridgeServerSessionConfig composes fields', () => {
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const toolbox = CLAUDE_CODE_REMOTE_MCP_SERVER_ID
    const content = Buffer.from(
      JSON.stringify({
        mcpServers: {
          [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: {
            type: 'http',
            url: `https://api.example/v2/ccr-sessions/cse_1/mcp?toolbox_mcp_server_id=${toolbox}`,
            tools: [{ name: 'list' }],
          },
        },
      }),
      'utf8',
    ).toString('base64')
    const derived = deriveBridgeServerSessionConfig(
      {
        claude_code_args: {
          model: 'm',
          'append-system-prompt': 'hi',
          disallowedTools: 'Bash',
        },
        mcp_config: { content },
        auto_mode_environment: ['fact'],
      },
      { sessionId: 'cse_1', apiBaseUrl: 'https://api.example' },
    )
    expect(derived.appendSystemPrompt).toBe('hi')
    expect(derived.disallowedTools).toEqual(['Bash'])
    expect(derived.metaMountUrl).toContain('/v2/ccr-sessions/cse_1/mcp?')
    expect(derived.autoAllowTools).toEqual(['list'])
    expect(derived.metaDropReason).toBeNull()
    expect(derived.autoModeEnvironment[0]).toContain('fact')
  })
})
