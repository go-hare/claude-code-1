/**
 * densable lxu tool_use_summary residual: enablePromptCaching:!1.
 * Behavior only (no analytics).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('toolUseSummary densable enablePromptCaching residual', () => {
  test('enablePromptCaching is false (densable !1)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../toolUseSummaryGenerator.ts'),
      'utf8',
    )
    expect(src).toContain("querySource: 'tool_use_summary_generation'")
    expect(src).toContain('enablePromptCaching: false')
    expect(src).not.toMatch(/enablePromptCaching:\s*true/)
  })

  test('keeps haiku path + empty agents/mcpTools', () => {
    const src = readFileSync(
      join(import.meta.dir, '../toolUseSummaryGenerator.ts'),
      'utf8',
    )
    expect(src).toContain('queryHaiku')
    expect(src).toContain('agents: []')
    expect(src).toContain('mcpTools: []')
    expect(src).toContain('hasAppendSystemPrompt: false')
  })
})
