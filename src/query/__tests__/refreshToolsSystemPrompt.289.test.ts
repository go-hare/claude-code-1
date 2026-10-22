import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'bun:test'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.289 refreshTools before attachments, no systemPrompt rebuild', () => {
  test('gold query refreshes tools then MCP clients then attachments; does not rebuild systemPrompt', () => {
    const query = readFileSync(join(__dirname, '../../query.ts'), 'utf-8')
    expect(query).not.toContain('toolNamesChanged')
    expect(query).not.toContain("require('./utils/systemPrompt.js')")
    const refresh = query.indexOf(
      'if (updatedToolUseContext.options.refreshTools)',
    )
    const mcp = query.indexOf(
      'if (updatedToolUseContext.options.refreshMcpClients)',
      refresh,
    )
    const attachments = query.indexOf(
      'Get queued commands snapshot before processing attachments',
      refresh,
    )
    const afterAttachments = query.indexOf(
      'tengu_query_after_attachments',
      attachments,
    )
    expect(refresh).toBeGreaterThan(0)
    expect(mcp).toBeGreaterThan(refresh)
    expect(attachments).toBeGreaterThan(mcp)
    expect(afterAttachments).toBeGreaterThan(attachments)
    expect(query.indexOf('toolNamesChanged', refresh)).toBe(-1)
  })
})
