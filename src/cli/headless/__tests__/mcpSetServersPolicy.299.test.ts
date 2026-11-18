import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  handleMcpSetServers,
  reconcileMcpServers,
} from '../HeadlessControlPlane.js'
import {
  resetSettingsCache,
  setCachedSettingsForSource,
  setSessionSettingsCache,
} from '../../../utils/settings/settingsCache.js'

describe('HeadlessControlPlane mcp_set_servers policy checks (#644)', () => {
  const prevSafeMode = process.env.CLAUDE_CODE_SAFE_MODE
  const prevMacro = (globalThis as Record<string, unknown>).MACRO

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).MACRO ??= {
      VERSION: '2.1.301',
    }
  })

  afterEach(() => {
    if (prevSafeMode === undefined) delete process.env.CLAUDE_CODE_SAFE_MODE
    else process.env.CLAUDE_CODE_SAFE_MODE = prevSafeMode
    if (prevMacro === undefined)
      delete (globalThis as Record<string, unknown>).MACRO
    else (globalThis as Record<string, unknown>).MACRO = prevMacro
    resetSettingsCache()
  })

  test('reconcileMcpServers rejects servers blocked by managed policy without connecting', async () => {
    setCachedSettingsForSource('policySettings', {
      settings: {
        deniedMcpServers: [{ serverName: 'blocked_srv' }],
      },
      errors: [],
    })
    setSessionSettingsCache({
      settings: {
        deniedMcpServers: [{ serverName: 'blocked_srv' }],
      },
      errors: [],
    })
    const result = await reconcileMcpServers(
      {
        blocked_srv: {
          type: 'http',
          url: 'https://blocked.example.com/mcp',
        },
      },
      { clients: [], tools: [], configs: {} },
      () => {},
    )
    expect(result.response.errors.blocked_srv).toBe(
      'MCP server "blocked_srv" is blocked by managed policy',
    )
    expect(result.response.added).toEqual([])
    expect(result.newState.clients).toEqual([])
  })

  test('handleMcpSetServers rejects non-sdk servers in safe mode', async () => {
    process.env.CLAUDE_CODE_SAFE_MODE = '1'
    const result = await handleMcpSetServers(
      {
        stdio_srv: {
          type: 'stdio',
          command: 'nonexistent-binary-should-not-run',
        },
      },
      { clients: [], tools: [], configs: {} },
      { clients: [], tools: [], configs: {} },
      () => {},
    )
    expect(result.response.errors.stdio_srv).toBe('Ignored in safe mode')
    expect(result.response.added).toEqual([])
  })
})
