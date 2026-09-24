/**
 * densable 2.1.251 #23 — `/mcp reconnect` returns qge instead of a
 * generic withheld-detail error when the server was disabled elsewhere.
 *
 * Exclusive: MCPReconnect.tsx wiring only. qge/Qo/XS/G8 live in
 * mcpReconnectRemedy.ts (outside this item's writes).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reconnectDisabledElsewhereResult } from '../../../services/mcp/mcpReconnectRemedy.js'

const SRC = join(import.meta.dir, '../MCPReconnect.tsx')

describe('densable 2.1.251 #23 MCPReconnect qge remedy', () => {
  test('reconnectDisabledElsewhereResult runs before reconnectMcpServer', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('reconnectDisabledElsewhereResult')
    const drifted = src.indexOf(
      'const driftedRemedy = reconnectDisabledElsewhereResult(',
    )
    const reconnect = src.indexOf('await reconnectMcpServer(serverName)')
    expect(drifted).toBeGreaterThan(0)
    expect(reconnect).toBeGreaterThan(drifted)
  })

  test('a non-null qge result is the command result, not a withheld error', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('onComplete(driftedRemedy)')
    expect(src).toContain('if (driftedRemedy !== null)')
    expect(src).not.toContain(
      'error detail withheld: it contains control or invisible characters',
    )
    const guard = src.indexOf('if (driftedRemedy !== null)')
    const reconnect = src.indexOf('await reconnectMcpServer(serverName)')
    expect(src.indexOf('onComplete(driftedRemedy)', guard)).toBeGreaterThan(
      guard,
    )
    expect(src.indexOf('onComplete(driftedRemedy)', guard)).toBeLessThan(
      reconnect,
    )
    expect(src.slice(guard, reconnect)).toContain('return')
  })

  test('the drifted client bag keeps type and failed errorCode for XS', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('name: server.name')
    expect(src).toContain('type: server.type')
    expect(src).toContain("server.type === 'failed'")
    expect(src).toContain('errorCode: server.errorCode')
  })

  test('named reconnect of a failed drifted server is the disable-and-re-enable sentence', () => {
    const text = reconnectDisabledElsewhereResult(
      [{ name: 'srv', type: 'failed', errorCode: 'ECONNREFUSED' }],
      'srv',
      () => true,
    )
    expect(text).toBe(
      '1 MCP server(s) were disabled in another session — disable and re-enable them in /mcp, or restart, to reconnect.',
    )
  })

  test('named reconnect of an unconfigured drifted server is the nothing-to-reconnect sentence', () => {
    const text = reconnectDisabledElsewhereResult(
      [{ name: 'srv', type: 'failed', errorCode: 'UNCONFIGURED' }],
      'srv',
      () => true,
    )
    expect(text).toBe(
      "1 MCP server(s) were disabled in another session but aren't configured yet — there's nothing to reconnect until they are.",
    )
  })

  test('named reconnect of a still-available drifted server is the persist-re-enable sentence', () => {
    const text = reconnectDisabledElsewhereResult(
      [{ name: 'srv', type: 'connected' }],
      'srv',
      () => true,
    )
    expect(text).toBe(
      "1 MCP server(s) are still available in this session but were disabled in another — they keep working here and won't reconnect after the next launch. Disable and re-enable them in /mcp to persist the re-enable.",
    )
  })

  test('a server that is not disabled elsewhere is not rewritten', () => {
    expect(
      reconnectDisabledElsewhereResult(
        [{ name: 'srv', type: 'failed' }],
        'srv',
        () => false,
      ),
    ).toBeNull()
  })
})
