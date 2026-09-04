import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

describe('status invalid entries 243', () => {
  test('copy is Found invalid entries in: and user MCP names ~/.claude.json', () => {
    const status = readFileSync(join(import.meta.dir, '../status.tsx'), 'utf8')
    expect(status).toContain('Found invalid entries in:')
    expect(status).not.toContain('Found invalid settings files:')

    const mcp = readFileSync(
      join(import.meta.dir, '../../services/mcp/config.ts'),
      'utf8',
    )
    expect(mcp).toContain('filePath: getGlobalClaudeFile()')
  })
})
