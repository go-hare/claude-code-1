/**
 * densable 2.1.251 #49 — F note + we count + skip-reason arms.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  countClaudeCodeConfiguredMcpServers,
  formatConnectorFetchSkipReasonSentence,
  formatScheduleConnectorsInfo,
  formatScheduleNoConnectorNote,
  resolveConnectorFetchSkipReason,
  SCHEDULE_CLAUDE_CODE_MCP_NOTE,
} from '../scheduleConnectorsCopy.js'

const NOTE =
  'Note that MCP servers configured directly in Claude Code (e.g. with `claude mcp add`) cannot be attached to cloud routines — routines can only use claude.ai connectors.'

const CONNECT_TIP =
  'Connect one at https://claude.ai/customize/connectors if needed.'

describe('densable 2.1.251 #49 schedule connector copy', () => {
  test('note matches gold F', () => {
    expect(SCHEDULE_CLAUDE_CODE_MCP_NOTE).toBe(NOTE)
  })

  test('no local MCP and no connectors includes the note', () => {
    const text = formatScheduleConnectorsInfo([], 0, name => name)
    expect(text).toContain(
      'No available MCP connectors found. The user may need to connect servers at https://claude.ai/customize/connectors.',
    )
    expect(text).toContain(NOTE)
    expect(formatScheduleNoConnectorNote(0)).toBe(
      'No MCP connectors — connect at https://claude.ai/customize/connectors if needed.',
    )
  })

  test('local MCP count uses the we sentence + default connect tip', () => {
    expect(formatScheduleNoConnectorNote(1)).toBe(
      `No MCP connectors for cloud routines — 1 MCP server configured in Claude Code can't be attached to routines (run /mcp to see it); routines can only use claude.ai connectors. ${CONNECT_TIP}`,
    )
    expect(formatScheduleNoConnectorNote(2)).toBe(
      `No MCP connectors for cloud routines — 2 MCP servers configured in Claude Code can't be attached to routines (run /mcp to see them); routines can only use claude.ai connectors. ${CONNECT_TIP}`,
    )
  })

  test('skip-reason optout/safe-mode/missing-scope append', () => {
    expect(
      formatScheduleNoConnectorNote(0, { skipReason: 'optout' }),
    ).toContain(
      'disableClaudeAiConnectors setting or ENABLE_CLAUDEAI_MCP_SERVERS',
    )
    expect(
      formatScheduleNoConnectorNote(0, { skipReason: 'safe-mode' }),
    ).toContain('safe mode')
    expect(
      formatScheduleNoConnectorNote(0, { skipReason: 'missing-scope' }),
    ).toContain('MCP-connectors permission')
    expect(formatConnectorFetchSkipReasonSentence('restricted')).toContain(
      'explicitly passed config',
    )
  })

  test('resolveConnectorFetchSkipReason order', () => {
    expect(
      resolveConnectorFetchSkipReason({
        orgManagesClaudeAiMcps: true,
        allowAllClaudeAiMcps: false,
      }),
    ).toBe('lockdown')
    expect(resolveConnectorFetchSkipReason({ strictConfig: true })).toBe(
      'restricted',
    )
    expect(resolveConnectorFetchSkipReason({ bareOrSimple: true })).toBe(
      'restricted',
    )
    expect(
      resolveConnectorFetchSkipReason({ enableClaudeAiMcpServers: false }),
    ).toBe('optout')
    expect(
      resolveConnectorFetchSkipReason({ disableClaudeAiConnectors: true }),
    ).toBe('optout')
    expect(resolveConnectorFetchSkipReason({ mcpClaudeAiSafeMode: true })).toBe(
      'safe-mode',
    )
    expect(resolveConnectorFetchSkipReason({ hasMcpServersScope: false })).toBe(
      'missing-scope',
    )
    expect(resolveConnectorFetchSkipReason({})).toBeNull()
  })

  test('connectors use the routines header', () => {
    const text = formatScheduleConnectorsInfo(
      [{ uuid: 'u1', name: 'claude.ai Slack', url: 'https://example.test' }],
      0,
      name => name.replace(/[^a-zA-Z0-9_-]/g, '-'),
    )
    expect(text.startsWith('Available connectors (usable by routines):')).toBe(
      true,
    )
    expect(text).toContain('connector_uuid: u1')
    expect(text).not.toContain(NOTE)
  })

  test('claude.ai proxy clients are not local Claude Code servers', () => {
    expect(
      countClaudeCodeConfiguredMcpServers([
        { config: { type: 'stdio' } },
        { config: { type: 'claudeai-proxy' } },
        { config: { type: 'http' } },
      ]),
    ).toBe(2)
  })

  test('schedule skill uses the copy helpers + skip reason', () => {
    const src = readFileSync(
      join(import.meta.dir, '../scheduleRemoteAgents.ts'),
      'utf8',
    )
    expect(src).toContain('formatScheduleNoConnectorNote')
    expect(src).toContain('formatScheduleConnectorsInfo')
    expect(src).toContain('resolveConnectorFetchSkipReason')
    expect(src).not.toContain('claude.ai/settings/connectors')
  })
})
