import { describe, expect, test } from 'bun:test'
import { splitBlockingAndNonBlockingMcpConfigs } from '../main.js'
import type { ScopedMcpServerConfig } from '../services/mcp/types.js'

describe('main MCP split v2.1.304 (#1003)', () => {
  test('#1003: synced plugin stdio servers are non-blocking in cloud unless alwaysLoad: true', () => {
    const configs = {
      'plugin:foo:stdio-default': {
        type: 'stdio',
        command: 'npx',
        args: ['foo'],
        scope: 'dynamic',
        pluginSource: 'foo@synced',
      },
      'plugin:bar:stdio-always': {
        type: 'stdio',
        command: 'npx',
        args: ['bar'],
        scope: 'dynamic',
        pluginSource: 'bar@synced',
        alwaysLoad: true,
      },
      'plugin:baz:http-synced': {
        type: 'http',
        url: 'https://example.com/mcp',
        scope: 'dynamic',
        pluginSource: 'baz@synced',
      },
      'plugin:local:stdio': {
        type: 'stdio',
        command: 'npx',
        args: ['local'],
        scope: 'dynamic',
        pluginSource: 'local@official',
      },
    } as Record<string, ScopedMcpServerConfig>

    const cloud = splitBlockingAndNonBlockingMcpConfigs(configs, true)
    expect(Object.keys(cloud.nonBlocking)).toEqual(['plugin:foo:stdio-default'])
    expect(Object.keys(cloud.blocking).sort()).toEqual([
      'plugin:bar:stdio-always',
      'plugin:baz:http-synced',
      'plugin:local:stdio',
    ])

    const local = splitBlockingAndNonBlockingMcpConfigs(configs, false)
    expect(Object.keys(local.nonBlocking)).toEqual([])
    expect(Object.keys(local.blocking)).toHaveLength(4)
  })
})
