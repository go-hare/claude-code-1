/**
 * densable 2.1.289 X2e / $zt / bE accountMemory stamps.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  ACCOUNT_MEMORY_SERVER_NAME,
  ACCOUNT_MEMORY_TOOLBOX_ID,
  isAccountMemoryTool,
  isCcrAccountMemoryHttpServer,
  isSdkAccountMemoryTool,
} from '../accountMemoryMcp.js'
import { markCliOwnedConfig } from '../cliOwnedConfigs.js'
import { resetMcpCcrIngressCapture } from '../mcpConnectTimeout.js'

describe('densable 2.1.289 X2e accountMemory', () => {
  beforeEach(() => {
    process.env.SESSION_INGRESS_URL = 'https://ingress.example'
    resetMcpCcrIngressCapture()
  })

  afterEach(() => {
    delete process.env.SESSION_INGRESS_URL
    resetMcpCcrIngressCapture()
  })

  test('$zt: /memory/mcp empty search is account memory', () => {
    const server = {
      name: ACCOUNT_MEMORY_SERVER_NAME,
      config: {
        scope: 'dynamic',
        url: 'https://ingress.example/v2/ccr-sessions/abc/memory/mcp',
      },
    }
    expect(isCcrAccountMemoryHttpServer(server)).toBe(true)
    expect(isAccountMemoryTool(server, 'anything')).toBe(true)
  })

  test('$zt: session /mcp with toolbox id is account memory', () => {
    const server = {
      name: ACCOUNT_MEMORY_SERVER_NAME,
      config: {
        scope: 'dynamic',
        url: `https://ingress.example/v2/ccr-sessions/abc/mcp?toolbox_mcp_server_id=${ACCOUNT_MEMORY_TOOLBOX_ID}`,
      },
    }
    expect(isCcrAccountMemoryHttpServer(server)).toBe(true)
  })

  test('$zt: cli-owned config is not $zt (third arm via nf)', () => {
    const config = {
      scope: 'dynamic',
      url: 'https://ingress.example/v2/ccr-sessions/abc/memory/mcp',
    }
    markCliOwnedConfig(config)
    const server = { name: ACCOUNT_MEMORY_SERVER_NAME, config }
    expect(isCcrAccountMemoryHttpServer(server)).toBe(false)
    expect(isAccountMemoryTool(server, 'x')).toBe(true)
  })

  test('bE: sdk memory_* tool on dynamic memory server', () => {
    const server = {
      name: ACCOUNT_MEMORY_SERVER_NAME,
      config: { scope: 'dynamic', type: 'sdk' },
    }
    expect(isSdkAccountMemoryTool(server, 'memory_read')).toBe(true)
    expect(isSdkAccountMemoryTool(server, 'read')).toBe(false)
    expect(isAccountMemoryTool(server, 'memory_str_replace')).toBe(true)
  })

  test('foreign server name is never account memory', () => {
    const server = {
      name: 'other',
      config: {
        scope: 'dynamic',
        url: 'https://ingress.example/v2/ccr-sessions/abc/memory/mcp',
      },
    }
    expect(isAccountMemoryTool(server, 'memory_read')).toBe(false)
  })
})
