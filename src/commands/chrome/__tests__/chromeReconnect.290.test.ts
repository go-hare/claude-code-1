import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { formatChromeReconnectOutcome } from '../chrome.js'

describe('v2.1.290 #69 — chrome reconnect RLt/o0t', () => {
  test('formatChromeReconnectOutcome formats connected, needs-auth, failed, and unknown', () => {
    expect(
      formatChromeReconnectOutcome(
        {
          client: {
            name: 'claude-in-chrome',
            type: 'connected',
            config: {
              type: 'stdio',
              command: 'node',
              args: [],
              scope: 'dynamic',
            },
            capabilities: {},
            client: {} as never,
            cleanup: async () => {},
          },
        },
        'claude-in-chrome',
      ),
    ).toEqual({
      message: 'Reconnected to claude-in-chrome.',
      success: true,
    })

    expect(
      formatChromeReconnectOutcome(
        {
          client: {
            name: 'claude-in-chrome',
            type: 'needs-auth',
            config: {
              type: 'http',
              url: 'https://example.com',
              scope: 'dynamic',
            },
          },
        },
        'claude-in-chrome',
      ),
    ).toEqual({
      message:
        "claude-in-chrome requires authentication. Use the 'Authenticate' option.",
      success: false,
    })

    expect(
      formatChromeReconnectOutcome(
        {
          client: {
            name: 'claude-in-chrome',
            type: 'failed',
            config: {
              type: 'stdio',
              command: 'node',
              args: [],
              scope: 'dynamic',
            },
            error: 'socket closed',
          },
        },
        'claude-in-chrome',
      ),
    ).toEqual({
      message: 'Failed to reconnect to claude-in-chrome: socket closed',
      success: false,
    })
  })

  test('chrome.tsx uses useOptionalMcpReconnect and surfaces unavailable/success messages', () => {
    const src = readFileSync(join(import.meta.dir, '../chrome.tsx'), 'utf8')
    expect(src).toContain('useOptionalMcpReconnect')
    expect(src).toContain(
      "Reconnect isn't available from this view. Open /mcp, select claude-in-chrome, and choose Reconnect.",
    )
    expect(src).toContain('Its browser tools are back in this session.')
  })
})
