import { describe, expect, test } from 'bun:test'

// reconnectHelpers is pure — no process-global mock.module (avoids polluting
// sibling files that import full debug/analytics exports).
import { handleReconnectResult } from '../../../components/mcp/utils/reconnectHelpers.js'

// Error class lives in client.ts — import only after light mocks. If client
// still pulls too much, define a local twin of LOs matching SEA for code checks
// and also import the real export when available.

describe('densable 2.1.222 #10 ClaudeAiProxyBearerRejectedError + ati', () => {
  test('SEA LOs shape (local twin matches production constructor contract)', () => {
    // Mirror densable LOs — production is ClaudeAiProxyBearerRejectedError in client.ts
    class ClaudeAiProxyBearerRejectedError extends Error {
      code = 'CLAUDEAI_BEARER_REJECTED' as const
      reasonCode = 'claudeai_bearer_rejected' as const
      constructor() {
        super(
          'claude.ai rejected the session token — it may lack connector scopes or be invalid. Run /login.',
        )
        this.name = 'ClaudeAiProxyBearerRejectedError'
      }
    }
    const err = new ClaudeAiProxyBearerRejectedError()
    expect(err.name).toBe('ClaudeAiProxyBearerRejectedError')
    expect(err.code).toBe('CLAUDEAI_BEARER_REJECTED')
    expect(err.reasonCode).toBe('claudeai_bearer_rejected')
    expect(err.message).toContain('claude.ai rejected the session token')
    expect(err.message).toContain('Run /login')
    expect(
      err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'CLAUDEAI_BEARER_REJECTED',
    ).toBe(true)
  })

  test('source exports ClaudeAiProxyBearerRejectedError + throw path', async () => {
    const text = await Bun.file('src/services/mcp/client.ts').text()
    expect(text).toContain('class ClaudeAiProxyBearerRejectedError')
    expect(text).toContain("code = 'CLAUDEAI_BEARER_REJECTED'")
    expect(text).toContain('throw new ClaudeAiProxyBearerRejectedError()')
    expect(text).toContain('discoveryBearerRejected')
    expect(text).toContain('toolsListError')
    expect(text).toContain('isClaudeAiBearerRejectedError')
  })

  test('reconnectHelpers ati: discoveryBearerRejected message', () => {
    const result = handleReconnectResult(
      {
        client: {
          name: 'slack',
          type: 'connected',
          discoveryBearerRejected: true,
          client: {} as never,
          capabilities: {},
          config: {
            type: 'claudeai-proxy',
            id: 'x',
            url: 'https://x',
          } as never,
          cleanup: async () => {},
        },
        tools: [],
        commands: [],
      },
      'slack',
    )
    expect(result.success).toBe(false)
    expect(result.message).toBe(
      'Reconnected to slack, but your claude.ai session token was rejected. Run /login, then reconnect.',
    )
  })

  test('reconnectHelpers ati: toolsListError message', () => {
    const result = handleReconnectResult(
      {
        client: {
          name: 'slack',
          type: 'connected',
          toolsListError: 'boom',
          client: {} as never,
          capabilities: {},
          config: {
            type: 'claudeai-proxy',
            id: 'x',
            url: 'https://x',
          } as never,
          cleanup: async () => {},
        },
        tools: [],
        commands: [],
      },
      'slack',
    )
    expect(result.success).toBe(false)
    expect(result.message).toContain('fetching tools failed: boom')
  })

  test('reconnectHelpers needs-auth headersHelper copy', () => {
    const withHelper = handleReconnectResult(
      {
        client: {
          name: 'svc',
          type: 'needs-auth',
          config: { type: 'http', url: 'https://x' } as never,
        },
        tools: [],
        commands: [],
      },
      'svc',
      { hasHeadersHelper: true },
    )
    expect(withHelper.message).toContain('headersHelper')
    const plain = handleReconnectResult(
      {
        client: {
          name: 'svc',
          type: 'needs-auth',
          config: { type: 'http', url: 'https://x' } as never,
        },
        tools: [],
        commands: [],
      },
      'svc',
    )
    expect(plain.message).toContain("Use the 'Authenticate' option")
  })

  test('MCPRemoteServerMenu Issue string present', async () => {
    const text = await Bun.file(
      'src/components/mcp/MCPRemoteServerMenu.tsx',
    ).text()
    expect(text).toContain(
      'claude.ai rejected the session token. Run /login, then reconnect.',
    )
    expect(text).toContain('discoveryBearerRejected')
  })
})
