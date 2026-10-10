/**
 * densable 2.1.289 — `/mcp reconnect` / `/mcp reconnect all` wiring.
 * Exclusive: command + MCPReconnect hosts. Remedy copy stays in
 * mcpReconnectRemedy.ts.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  formatMcpReconnectOutcome,
  missingMcpReconnectTarget,
  planMcpReconnect,
} from '../../../services/mcp/mcpReconnectRemedy.js'

const root = join(import.meta.dir, '../../..')
const MCP_TSX = join(root, 'commands/mcp/mcp.tsx')
const MCP_INDEX = join(root, 'commands/mcp/index.ts')
const RECONNECT_TSX = join(root, 'components/mcp/MCPReconnect.tsx')

describe('densable 2.1.289 /mcp reconnect all wiring', () => {
  test('mcp.tsx mounts MCPReconnect for bare reconnect as all', () => {
    const src = readFileSync(MCP_TSX, 'utf8')
    expect(src).toContain("if (action === 'reconnect')")
    expect(src).toContain("const target = parts.slice(1).join(' ') || 'all'")
    expect(src).toContain(
      '<MCPReconnect serverName={target} onComplete={onDone} />',
    )
    expect(src).not.toContain("parts[0] === 'reconnect' && parts[1]")
  })

  test('mcp.tsx Be unknown-action / usage / session-view copy', async () => {
    const {
      MCP_INLINE_USAGE,
      formatUnrecognizedMcpAction,
      MCP_INLINE_SESSION_UNAVAILABLE,
      MCP_INLINE_VIEW_UNAVAILABLE,
    } = await import('../mcp.js')
    expect(MCP_INLINE_USAGE).toBe(
      'Usage: /mcp [reconnect|enable|disable [<server>|all]]. With no server name, applies to all.',
    )
    expect(formatUnrecognizedMcpAction('foo')).toBe(
      `"foo" isn't a recognized /mcp action. Try reconnect, enable, or disable.`,
    )
    expect(MCP_INLINE_SESSION_UNAVAILABLE).toBe(
      "Reconnect, enable, and disable aren't available in this session.",
    )
    expect(MCP_INLINE_VIEW_UNAVAILABLE).toBe(
      "MCP controls aren't available right now — the terminal is still starting up or is showing another view.",
    )
    const src = readFileSync(MCP_TSX, 'utf8')
    expect(src).toContain('formatUnrecognizedMcpAction(action)')
    expect(src).toContain('isBgSessionWithoutTerminal()')
    expect(src).toContain('getIsInteractive()')
  })

  test('argumentHint documents reconnect|enable|disable [<server>|all]', () => {
    const src = readFileSync(MCP_INDEX, 'utf8')
    expect(src).toContain(
      "argumentHint: '[reconnect|enable|disable [<server>|all]]'",
    )
  })

  test('MCPReconnect all path uses plan/format/missing remedy helpers', () => {
    const src = readFileSync(RECONNECT_TSX, 'utf8')
    expect(src).toContain('planMcpReconnect')
    expect(src).toContain('formatMcpReconnectOutcome')
    expect(src).toContain('missingMcpReconnectTarget')
    expect(src).toContain("if (serverName === 'all')")
    const allArm = src.indexOf("if (serverName === 'all')")
    const namedFind = src.indexOf(
      'const server = clients.find(c => c.name === serverName)',
    )
    expect(allArm).toBeGreaterThan(0)
    expect(namedFind).toBeGreaterThan(allArm)
    expect(src.slice(allArm, namedFind)).toContain(
      "planMcpReconnect(clients, 'all', isMcpServerDisabled)",
    )
    expect(src.slice(allArm, namedFind)).toContain(
      "formatMcpReconnectOutcome('all', results, plan.appendix)",
    )
    expect(src.slice(allArm, namedFind)).toContain(
      "missingMcpReconnectTarget('all')",
    )
  })

  test('named reconnect still gates with reconnectDisabledElsewhereResult', () => {
    const src = readFileSync(RECONNECT_TSX, 'utf8')
    expect(src).toContain('reconnectDisabledElsewhereResult')
    const drifted = src.indexOf(
      'const driftedRemedy = reconnectDisabledElsewhereResult(',
    )
    const reconnect = src.indexOf('await reconnectMcpServer(serverName)')
    expect(drifted).toBeGreaterThan(0)
    expect(reconnect).toBeGreaterThan(drifted)
  })

  test('plan/format/missing helpers keep all-target copy', () => {
    expect(missingMcpReconnectTarget('all')).toBe(
      'No MCP servers are configured. Add one with `claude mcp add`.',
    )
    expect(
      planMcpReconnect([{ name: 'a', type: 'connected' }], 'all', () => false),
    ).toEqual({
      kind: 'text',
      text: 'All enabled MCP servers are already connected or connecting.',
    })
    const reconnect = planMcpReconnect(
      [{ name: 'a', type: 'failed' }],
      'all',
      () => false,
    )
    expect(reconnect).toEqual({
      kind: 'reconnect',
      names: ['a'],
      appendix: null,
    })
    expect(
      formatMcpReconnectOutcome('all', [{ ok: true, type: 'connected' }], null),
    ).toBe(
      'Reconnected 1 of 1 MCP server(s). Run `/mcp` in the terminal to see status.',
    )
  })
})
