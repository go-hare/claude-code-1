import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'bun:test'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.289 refreshTools before attachments, no systemPrompt rebuild', () => {
  test('gold query refreshes tools then MCP clients then attachments; does not rebuild systemPrompt', () => {
    const query = readFileSync(join(__dirname, '../../query.ts'), 'utf-8')
    const toolRoundHelpers = readFileSync(
      join(__dirname, '../toolRoundHelpers.ts'),
      'utf-8',
    )
    expect(query).not.toContain('toolNamesChanged')
    expect(toolRoundHelpers).not.toContain('toolNamesChanged')
    expect(query).not.toContain("require('./utils/systemPrompt.js')")
    expect(toolRoundHelpers).not.toContain(
      "require('../utils/systemPrompt.js')",
    )
    const refresh = toolRoundHelpers.indexOf('if (ctx.options.refreshTools)')
    const mcp = toolRoundHelpers.indexOf(
      'if (ctx.options.refreshMcpClients)',
      refresh,
    )
    const refreshCall = query.indexOf('refreshToolsAndMcpClientsMidTurn(')
    const attachmentsCall = query.indexOf(
      'drainMidTurnQueuedCommandsAndAttachments(',
      refreshCall,
    )
    const afterAttachments = query.indexOf(
      'tengu_query_after_attachments',
      attachmentsCall,
    )
    expect(refresh).toBeGreaterThan(0)
    expect(mcp).toBeGreaterThan(refresh)
    expect(refreshCall).toBeGreaterThan(0)
    expect(attachmentsCall).toBeGreaterThan(refreshCall)
    expect(afterAttachments).toBeGreaterThan(attachmentsCall)
    expect(query.indexOf('toolNamesChanged', refreshCall)).toBe(-1)
  })
})
