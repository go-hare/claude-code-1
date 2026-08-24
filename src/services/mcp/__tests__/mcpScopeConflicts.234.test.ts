/**
 * densable 2.1.234 #13 — getMcpScopeConflicts uses displayServers (unexpanded)
 * so warnings show configured `${VAR}` forms, not resolved secrets.
 */
import { describe, expect, test } from 'bun:test'
import {
  formatMcpServerEndpoint,
  getMcpScopeConflicts,
  getMcpServerSignature,
  getMcpServerUrlOrigin,
} from '../config.js'
import type { McpServerConfig } from '../types.js'

describe('getMcpServerUrlOrigin (densable cHr)', () => {
  test('strips path query and userinfo', () => {
    expect(
      getMcpServerUrlOrigin({
        url: 'https://user:tok@mcp.example.com/v1?secret=1',
      }),
    ).toBe('https://mcp.example.com')
  })

  test('returns undefined without url', () => {
    expect(getMcpServerUrlOrigin({ type: 'stdio', command: 'npx' })).toBe(
      undefined,
    )
  })
})

describe('getMcpScopeConflicts (densable Gpi)', () => {
  test('warns when same name differs across scopes; endpoint from displayServers', () => {
    const expandedUser: McpServerConfig = {
      type: 'http',
      url: 'https://mcp.example.com/v1?token=RESOLVED_SECRET',
    }
    const displayUser: McpServerConfig = {
      type: 'http',
      url: 'https://mcp.example.com/v1?token=${API_TOKEN}',
    }
    const project: McpServerConfig = {
      type: 'http',
      url: 'https://other.example.com/mcp',
    }

    const conflicts = getMcpScopeConflicts([
      {
        scope: 'user',
        servers: { myserver: expandedUser },
        displayServers: { myserver: displayUser },
      },
      {
        scope: 'project',
        servers: { myserver: project },
        displayServers: { myserver: project },
      },
    ])

    expect(conflicts).toHaveLength(1)
    const msg = conflicts[0]!.message
    expect(msg).toContain('${API_TOKEN}')
    expect(msg).not.toContain('RESOLVED_SECRET')
    expect(msg).toContain(
      'user (https://mcp.example.com/v1?token=${API_TOKEN})',
    )
    expect(msg).toContain('project (https://other.example.com/mcp)')
    expect(conflicts[0]!.suggestion).toContain(
      'claude mcp remove myserver -s user',
    )
  })

  test('no conflict when signatures match across scopes', () => {
    const cfg: McpServerConfig = {
      type: 'http',
      url: 'https://mcp.example.com/v1',
    }
    expect(
      getMcpScopeConflicts([
        {
          scope: 'user',
          servers: { same: cfg },
          displayServers: { same: cfg },
        },
        {
          scope: 'local',
          servers: { same: cfg },
          displayServers: { same: cfg },
        },
      ]),
    ).toHaveLength(0)
  })

  test('stdio endpoint label joins command args from displayServers', () => {
    const display: McpServerConfig = {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '${PKG}'],
      env: { TOKEN: '${SECRET}' },
    }
    expect(formatMcpServerEndpoint(display)).toBe('npx -y ${PKG}')
    // signature ignores env by default
    expect(getMcpServerSignature(display, { includeEnv: false })).toBe(
      getMcpServerSignature({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '${PKG}'],
        env: { TOKEN: 'resolved' },
      }),
    )
  })
})
