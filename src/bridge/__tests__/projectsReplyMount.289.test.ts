import { afterEach, describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppStateStore.js'
import {
  isCliOwnedConfig,
  resetCliOwnedConfigsForTests,
} from '../../services/mcp/cliOwnedConfigs.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import { HEARTHBOT_MCP_SERVER_NAME, hearthbotMcpPath } from '../hearthbotMcp.js'
import { createProjectsReplyMount } from '../projectsReplyMount.js'

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
      alwaysDenyRules: {},
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

describe('densable 2.1.289 createProjectsReplyMount (uur)', () => {
  test('name_taken when hearthbot client already configured', async () => {
    const stores = makeStores([
      {
        name: HEARTHBOT_MCP_SERVER_NAME,
        type: 'connected',
        config: {
          type: 'http',
          url: 'https://api.example/x',
          scope: 'dynamic',
        },
        client: {} as never,
      },
    ])
    const mount = createProjectsReplyMount({
      stores,
      sessionId: 'cse_1',
      apiBaseUrl: 'https://api.example',
      getBearerToken: () => 'tok',
      sdkHostConfigs: () => ({}),
      readHearthBinding: async () => ({
        read: true,
        assertion: {
          channel_id: 'ch_1',
          thread_id: 'th_1',
          mcp_server: {
            name: HEARTHBOT_MCP_SERVER_NAME,
            type: 'http',
            url: `https://api.example${hearthbotMcpPath('cse_1')}`,
            tools: [{ name: 'reply' }],
          },
        },
      }),
      reconnect: async () => {
        throw new Error('should not dial')
      },
    })
    await mount.sync('startup')
    expect(
      stores.getState().mcp.clients.filter(c => c.type === 'pending'),
    ).toEqual([])
    await mount.drop()
  })

  test('dials with role:comms + cliOwned when binding ok', async () => {
    const stores = makeStores()
    let dialed: unknown
    const mount = createProjectsReplyMount({
      stores,
      sessionId: 'cse_1',
      apiBaseUrl: 'https://api.example',
      getBearerToken: () => 'tok',
      sdkHostConfigs: () => ({}),
      readHearthBinding: async () => ({
        read: true,
        assertion: {
          channel_id: 'ch_1',
          thread_id: 'th_1',
          mcp_server: {
            name: HEARTHBOT_MCP_SERVER_NAME,
            type: 'http',
            url: `https://api.example${hearthbotMcpPath('cse_1')}`,
            tools: [{ name: 'reply' }, { name: 'update_status' }],
          },
        },
      }),
      reconnect: async (_name, config) => {
        dialed = config
        return {
          client: {
            name: HEARTHBOT_MCP_SERVER_NAME,
            type: 'connected',
            config,
            client: {} as never,
          },
          tools: [],
          commands: [],
        }
      },
    })
    await mount.sync('startup')
    expect(dialed).toMatchObject({
      type: 'http',
      scope: 'dynamic',
      role: 'comms',
      alwaysLoad: true,
      headers: {
        'X-Session-UUID': 'cse_1',
        'anthropic-version': '2023-06-01',
      },
    })
    expect(isCliOwnedConfig(dialed as object)).toBe(true)
    expect(mount.current()?.channelId).toBe('ch_1')
    expect(mount.current()?.autoAllowTools).toEqual(['reply', 'update_status'])
    await mount.drop()
  })
})
