/**
 * densable 2.1.229 #22 — AYh enterprise soft-drop + warn strings.
 */
import { describe, expect, test } from 'bun:test'
import {
  ENTERPRISE_MCP_SET_SERVERS_IGNORE_REASON,
  filterMcpServersForHermeticMode,
  formatEnterpriseMcpConfigDropWarn,
  formatMcpHermeticDropWarn,
  HERMETIC_MCP_SET_SERVERS_IGNORE_REASON,
} from '../mcpHermeticFilter.js'

describe('densable 2.1.229 AYh enterprise MCP soft-drop', () => {
  test('dropForEnterpriseMcpConfig keeps only sdk', () => {
    const r = filterMcpServersForHermeticMode(
      {
        stdioA: { type: 'stdio' as const },
        vscode: { type: 'sdk' as const },
        httpB: { type: 'http' as const },
      },
      {
        safeMode: false,
        hermetic: false,
        dropForEnterpriseMcpConfig: true,
      },
    )
    expect(r.reason).toBe('enterprise MCP config')
    expect(r.dropped).toEqual(['stdioA', 'httpB'])
    expect(Object.keys(r.servers)).toEqual(['vscode'])
  })

  test('safe mode wins over enterprise flag', () => {
    const r = filterMcpServersForHermeticMode(
      { a: { type: 'stdio' as const }, b: { type: 'sdk' as const } },
      {
        safeMode: true,
        hermetic: false,
        dropForEnterpriseMcpConfig: true,
      },
    )
    expect(r.reason).toBe('safe mode')
    expect(r.dropped).toEqual(['a'])
  })

  test('hermetic wins over enterprise when both', () => {
    const r = filterMcpServersForHermeticMode(
      { a: { type: 'sse' as const }, b: { type: 'sdk' as const } },
      {
        safeMode: false,
        hermetic: true,
        dropForEnterpriseMcpConfig: true,
      },
    )
    expect(r.reason).toBe('hermetic mode')
  })

  test('enterprise warn string 1:1 densable', () => {
    expect(formatEnterpriseMcpConfigDropWarn(['foo', 'bar'])).toBe(
      'Warning: an enterprise MCP config (managed-mcp.json) is present and has exclusive control over MCP servers; ignoring 2 MCP servers supplied via --mcp-config: foo, bar',
    )
    expect(formatEnterpriseMcpConfigDropWarn(['only'])).toBe(
      'Warning: an enterprise MCP config (managed-mcp.json) is present and has exclusive control over MCP servers; ignoring 1 MCP server supplied via --mcp-config: only',
    )
  })

  test('enterprise debug-style hermetic warn uses (reason) form', () => {
    expect(formatMcpHermeticDropWarn(['x'], 'enterprise MCP config')).toBe(
      '--mcp-config: 1 server ignored (enterprise MCP config): x',
    )
  })

  test('mcp_set_servers ignore reason strings 1:1 densable', () => {
    expect(ENTERPRISE_MCP_SET_SERVERS_IGNORE_REASON).toBe(
      'Ignored: an enterprise MCP config (managed-mcp.json) is present and has exclusive control over MCP servers',
    )
    expect(HERMETIC_MCP_SET_SERVERS_IGNORE_REASON).toBe(
      'Ignored in hermetic mode (not declared in user config)',
    )
  })
})
