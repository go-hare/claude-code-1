/**
 * densable 2.1.251 #23 — qge on /mcp reconnect and the RC mcp_reconnect result.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  mcpServersDisabledElsewhereRemedy,
  planMcpReconnect,
  reconnectDisabledElsewhereResult,
} from '../mcpReconnectRemedy.js'

const root = join(import.meta.dir, '../../../..')

describe('densable 2.1.251 #23 MCP reconnect remedy', () => {
  const disabled = () => true

  test('failed drifted server returns the disable-and-re-enable remedy', () => {
    const text = mcpServersDisabledElsewhereRemedy(
      [{ name: 'srv', type: 'failed', errorCode: 'ECONNREFUSED' }],
      true,
      disabled,
    )
    expect(text).toContain(
      'MCP server(s) were disabled in another session — disable and re-enable them in /mcp, or restart, to reconnect.',
    )
  })

  test('unconfigured and still-available variants', () => {
    const unconfigured = mcpServersDisabledElsewhereRemedy(
      [{ name: 'srv', type: 'failed', errorCode: 'UNCONFIGURED' }],
      true,
      disabled,
    )
    expect(unconfigured).toContain("aren't configured yet")
    const still = mcpServersDisabledElsewhereRemedy(
      [{ name: 'srv', type: 'connected' }],
      true,
      disabled,
    )
    expect(still).toContain('still available in this session')
  })

  test('a single drifted target is text, not a reconnect attempt', () => {
    const failed = planMcpReconnect(
      [{ name: 'srv', type: 'failed' }],
      'srv',
      disabled,
    )
    expect(failed.kind).toBe('text')
    if (failed.kind === 'text') {
      expect(failed.text).toContain(
        'MCP server(s) were disabled in another session',
      )
    }
    const stillHere = planMcpReconnect(
      [{ name: 'srv', type: 'connected' }],
      'srv',
      disabled,
    )
    expect(stillHere.kind).toBe('text')
    if (stillHere.kind === 'text') {
      expect(stillHere.text).toContain('still available in this session')
    }
    expect(
      reconnectDisabledElsewhereResult(
        [{ name: 'srv', type: 'failed' }],
        'srv',
        disabled,
      ),
    ).toContain('disable and re-enable them in /mcp')
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

  test('slash reconnect and RC mcp_reconnect return the remedy', () => {
    const slash = readFileSync(
      join(root, 'src/components/mcp/MCPReconnect.tsx'),
      'utf8',
    )
    const print = readFileSync(join(root, 'src/cli/print.ts'), 'utf8')
    expect(slash).toContain('reconnectDisabledElsewhereResult')
    expect(slash).toContain('onComplete(driftedRemedy)')
    const rc = print.indexOf("subtype === 'mcp_reconnect'")
    expect(rc).toBeGreaterThan(0)
    const window = print.slice(rc, rc + 2800)
    expect(window).toContain('reconnectDisabledElsewhereResult')
    expect(window).toContain('sendControlResponseError(msg, driftedRemedy)')
  })
})
