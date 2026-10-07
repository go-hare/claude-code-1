import { describe, expect, test } from 'bun:test'
import {
  extractInjectedMcpToolNames,
  parseCodeSessionUrl,
  parseHearthBinding,
} from '../hearthBinding.js'
import {
  HEARTHBOT_MCP_SERVER_NAME,
  createHearthbotHttpConfig,
  createRemoteMetaHttpConfig,
  hearthbotMcpPath,
  CLAUDE_CODE_REMOTE_MCP_SERVER_ID,
} from '../hearthbotMcp.js'

describe('densable 2.1.289 hearthBinding (pur) + factories', () => {
  test('hearthbotMcpPath / createHearthbotHttpConfig / Cet headers', () => {
    expect(hearthbotMcpPath('sess_1')).toBe(
      '/v2/ccr-sessions/sess_1/hearthbot/mcp',
    )
    const reply = createHearthbotHttpConfig(
      'https://api.example/v2/ccr-sessions/sess_1/hearthbot/mcp',
      'sess_1',
    )
    expect(reply).toEqual({
      type: 'http',
      url: 'https://api.example/v2/ccr-sessions/sess_1/hearthbot/mcp',
      headers: {
        'X-Session-UUID': 'sess_1',
        'anthropic-version': '2023-06-01',
      },
      alwaysLoad: true,
    })
    const meta = createRemoteMetaHttpConfig(
      'https://api.example/v2/ccr-sessions/-/meta/mcp',
      'sess_1',
    )
    expect(meta.headers['X-MCP-Server-ID']).toBe(
      CLAUDE_CODE_REMOTE_MCP_SERVER_ID,
    )
  })

  test('parseHearthBinding accepts matching hearthbot URL + filters pJo tools', () => {
    const mountPath = hearthbotMcpPath('cse_abc')
    const result = parseHearthBinding(
      {
        hearth: {
          channel_id: 'ch_1',
          thread_id: 'th_1',
          mcp_server: {
            name: HEARTHBOT_MCP_SERVER_NAME,
            type: 'http',
            url: `https://api.example${mountPath}`,
            tools: [
              { name: 'reply' },
              { name: 'update_status' },
              { name: 'not_in_pJo' },
            ],
          },
        },
      },
      { apiBaseUrl: 'https://api.example', sessionId: 'cse_abc' },
    )
    expect(result.binding).toEqual({
      channelId: 'ch_1',
      threadId: 'th_1',
      mountUrl: `https://api.example${mountPath}`,
      autoAllowTools: ['reply', 'update_status'],
    })
  })

  test('parseHearthBinding rejects wrong server name / url mismatch', () => {
    expect(
      parseHearthBinding(
        {
          hearth: {
            channel_id: 'ch_1',
            thread_id: 'th_1',
            mcp_server: {
              name: 'other',
              type: 'http',
              url: 'https://api.example/v2/ccr-sessions/cse_abc/hearthbot/mcp',
            },
          },
        },
        { apiBaseUrl: 'https://api.example', sessionId: 'cse_abc' },
      ),
    ).toEqual({ binding: null, reason: 'bad_server_name' })

    expect(
      parseHearthBinding(
        {
          hearth: {
            channel_id: 'ch_1',
            thread_id: 'th_1',
            mcp_server: {
              name: HEARTHBOT_MCP_SERVER_NAME,
              type: 'http',
              url: 'https://evil.example/v2/ccr-sessions/cse_abc/hearthbot/mcp',
            },
          },
        },
        { apiBaseUrl: 'https://api.example', sessionId: 'cse_abc' },
      ),
    ).toEqual({ binding: null, reason: 'url_mismatch' })
  })

  test('extractInjectedMcpToolNames null on malformed tools', () => {
    expect(extractInjectedMcpToolNames({ tools: 'nope' })).toBeNull()
    expect(extractInjectedMcpToolNames({})).toEqual([])
  })

  test('parseCodeSessionUrl splits api base + session id', () => {
    expect(
      parseCodeSessionUrl('https://api.example/v1/code/sessions/cse_1'),
    ).toEqual({ apiBaseUrl: 'https://api.example', sessionId: 'cse_1' })
    expect(parseCodeSessionUrl('https://api.example/other')).toBeNull()
  })
})
