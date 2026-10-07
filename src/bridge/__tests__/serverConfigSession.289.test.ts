import { afterEach, describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppStateStore.js'
import {
  isCliOwnedConfig,
  resetCliOwnedConfigsForTests,
} from '../../services/mcp/cliOwnedConfigs.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import {
  CLAUDE_CODE_REMOTE_MCP_SERVER_ID,
  CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
  CLAUDE_CODE_REMOTE_META_MCP_PATH,
} from '../hearthbotMcp.js'
import { createServerConfigSession } from '../serverConfigSession.js'

afterEach(() => {
  resetCliOwnedConfigsForTests()
})

function makeStores(clients: MCPServerConnection[] = []) {
  let state = {
    mcp: {
      clients,
      tools: [],
      commands: [],
      resources: {},
      resourceTemplates: {},
    },
    toolPermissionContext: {
      alwaysAllowRules: { session: [] as string[] },
      alwaysDenyRules: { session: [] as string[] },
      alwaysAskRules: {},
      mode: 'default',
    },
  } as unknown as AppState
  return {
    getAppState: () => state,
    setAppState: (f: (prev: AppState) => AppState) => {
      state = f(state)
    },
    getDynamicMcpState: () => ({ clients: [], configs: {} }),
    getState: () => state,
  }
}

describe('densable 2.1.289 serverConfigSession meta mount (vt.A)', () => {
  test('no bearer → skip meta mount', async () => {
    const stores = makeStores()
    const session = createServerConfigSession({
      stores,
      getAppendSystemPrompt: () => undefined,
      setAppendSystemPrompt: () => {},
      sdkHostConfigs: () => ({}),
      reconnect: async () => ({
        client: {
          name: CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
          type: 'failed',
          config: {} as never,
          error: 'x',
        },
        tools: [],
        commands: [],
      }),
    })
    const apply = session.apply({}, { bridgeSessionId: 'cse_1' })
    expect(
      apply.mountMetaMcp({
        url: `https://api.example${CLAUDE_CODE_REMOTE_META_MCP_PATH}`,
        autoAllowTools: [],
        sessionId: 'cse_1',
      }),
    ).toBe(false)
    expect(stores.getState().mcp.clients).toEqual([])
    await session.undo()
  })

  test('mounts Cet headers + cliOwned when bearer present', async () => {
    const stores = makeStores()
    let connectedConfig: unknown
    const session = createServerConfigSession({
      stores,
      getAppendSystemPrompt: () => undefined,
      setAppendSystemPrompt: () => {},
      sdkHostConfigs: () => ({}),
      reconnect: async (_name, config) => {
        connectedConfig = config
        return {
          client: {
            name: CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
            type: 'connected',
            config,
            client: {} as never,
          },
          tools: [],
          commands: [],
        }
      },
    })
    const apply = session.apply(
      {},
      {
        bridgeSessionId: 'cse_1',
        getWorkerBearerToken: () => 'tok',
      },
    )
    expect(
      apply.mountMetaMcp({
        url: `https://api.example${CLAUDE_CODE_REMOTE_META_MCP_PATH}`,
        autoAllowTools: ['list'],
        sessionId: 'cse_1',
      }),
    ).toBe(true)
    const pending = stores
      .getState()
      .mcp.clients.find(c => c.name === CLAUDE_CODE_REMOTE_MCP_SERVER_NAME)
    expect(pending?.type).toBe('pending')
    expect(isCliOwnedConfig(pending!.config)).toBe(true)
    expect(pending!.config).toMatchObject({
      type: 'http',
      headers: {
        'X-MCP-Server-ID': CLAUDE_CODE_REMOTE_MCP_SERVER_ID,
        'X-Session-UUID': 'cse_1',
      },
      scope: 'dynamic',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(connectedConfig).toBe(pending!.config)
    await session.undo()
  })

  test('name_taken skips when client already present', async () => {
    const existingConfig = {
      type: 'http' as const,
      url: 'https://api.example/other',
      scope: 'dynamic' as const,
    }
    const stores = makeStores([
      {
        name: CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
        type: 'connected',
        config: existingConfig,
        client: {} as never,
      },
    ])
    const session = createServerConfigSession({
      stores,
      getAppendSystemPrompt: () => undefined,
      setAppendSystemPrompt: () => {},
      sdkHostConfigs: () => ({}),
    })
    const apply = session.apply(
      {},
      {
        bridgeSessionId: 'cse_1',
        getWorkerBearerToken: () => 'tok',
      },
    )
    expect(
      apply.mountMetaMcp({
        url: `https://api.example${CLAUDE_CODE_REMOTE_META_MCP_PATH}`,
        autoAllowTools: [],
        sessionId: 'cse_1',
      }),
    ).toBe(false)
    await session.undo()
  })

  test('disallowedTools deny retracts on undo (gold w/D)', async () => {
    const stores = makeStores()
    const session = createServerConfigSession({
      stores,
      getAppendSystemPrompt: () => undefined,
      setAppendSystemPrompt: () => {},
      sdkHostConfigs: () => ({}),
    })
    session.apply(
      {
        claude_code_args: {
          disallowedTools: 'Bash,Edit',
        },
      },
      { bridgeSessionId: 'cse_deny' },
    )
    const denied =
      stores.getState().toolPermissionContext.alwaysDenyRules.session ?? []
    expect(denied.some(r => r.includes('Bash'))).toBe(true)
    expect(denied.some(r => r.includes('Edit'))).toBe(true)
    await session.undo()
    const after =
      stores.getState().toolPermissionContext.alwaysDenyRules.session ?? []
    expect(after.some(r => r.includes('Bash'))).toBe(false)
    expect(after.some(r => r.includes('Edit'))).toBe(false)
  })
})
