/**
 * densable 2.1.248 #23 ebn/_bt — official claude.ai heading, not type-only.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  hasMcpPluginSource,
  isOfficialClaudeAiConnector,
} from '../officialClaudeAiConnector.js'

const panelSrc = readFileSync(
  join(import.meta.dir, '../../../components/mcp/MCPListPanel.tsx'),
  'utf8',
)

describe('densable 2.1.248 #23 mcp-fake-claude-ai', () => {
  test('_bt is pluginSource !== undefined', () => {
    expect(hasMcpPluginSource(undefined)).toBe(false)
    expect(hasMcpPluginSource({})).toBe(false)
    expect(hasMcpPluginSource({ pluginSource: 'demo@marketplace' })).toBe(true)
  })

  test('ebn: official claudeai + plugin-free dynamic only', () => {
    expect(
      isOfficialClaudeAiConnector({
        type: 'claudeai-proxy',
        scope: 'claudeai',
      }),
    ).toBe(true)
    expect(
      isOfficialClaudeAiConnector({
        type: 'claudeai-proxy',
        scope: 'dynamic',
      }),
    ).toBe(true)
    expect(
      isOfficialClaudeAiConnector({
        type: 'claudeai-proxy',
        scope: 'dynamic',
        pluginSource: 'demo@marketplace',
      }),
    ).toBe(false)
    expect(
      isOfficialClaudeAiConnector({
        type: 'claudeai-proxy',
        scope: 'project',
      }),
    ).toBe(false)
    expect(
      isOfficialClaudeAiConnector({
        type: 'http',
        scope: 'claudeai',
      }),
    ).toBe(false)
  })

  test('MCPListPanel groups by ebn, not type===claudeai-proxy', () => {
    expect(panelSrc).toContain('isOfficialClaudeAiConnector(s.client.config)')
    expect(panelSrc).not.toContain("s.client.config.type !== 'claudeai-proxy'")
    expect(panelSrc).not.toContain("s.client.config.type === 'claudeai-proxy'")
    expect(panelSrc).toContain('<Text bold>claude.ai</Text>')
  })
})
