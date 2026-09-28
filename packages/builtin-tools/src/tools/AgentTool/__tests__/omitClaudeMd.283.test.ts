import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../../../../..')

describe('omitClaudeMd densable 2.1.283 Fl', () => {
  test('runAgent uses Fl instead of tengu_slim_subagent_claudemd', () => {
    const src = readFileSync(
      join(ROOT, 'packages/builtin-tools/src/tools/AgentTool/runAgent.ts'),
      'utf8',
    )
    expect(src).toContain('omitClaudeMdUserContext')
    expect(src).toContain('managedInstructionsOnly')
    expect(src).not.toContain('tengu_slim_subagent_claudemd')
  })

  test('loadAgentsDir parses omitClaudeMd from markdown and JSON', () => {
    const src = readFileSync(
      join(ROOT, 'packages/builtin-tools/src/tools/AgentTool/loadAgentsDir.ts'),
      'utf8',
    )
    expect(src).toContain("frontmatter['omitClaudeMd']")
    expect(src).toContain('omitClaudeMd: z.boolean().optional()')
  })
})
