import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

describe('--agents 243 fatal JSON', () => {
  test('main exits like --mcp-config on invalid --agents', () => {
    const src = readFileSync(join(import.meta.dir, '../../main.tsx'), 'utf8')
    expect(src).toContain('Error: Invalid --agents configuration:')
    expect(src).toContain('parseAgentsFromJsonOrThrow')
  })

  test('loadAgentsDir exports the throwing parser', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/AgentTool/loadAgentsDir.ts',
      ),
      'utf8',
    )
    expect(src).toContain('export function parseAgentsFromJsonOrThrow')
  })
})
