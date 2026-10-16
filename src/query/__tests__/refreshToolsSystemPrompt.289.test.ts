import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'bun:test'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.289 refreshTools rebuilds systemPrompt', () => {
  test('query rebuilds systemPrompt when tool names change after refresh', () => {
    const query = readFileSync(join(__dirname, '../../query.ts'), 'utf-8')
    expect(query).toContain('let { systemPrompt } = params')
    expect(query).toContain('toolNamesChanged')
    expect(query).toContain("require('./constants/prompts.js')")
    expect(query).toContain("require('./utils/systemPrompt.js')")
    expect(query).toContain('getSystemPrompt(')
    expect(query).toContain('buildEffectiveSystemPrompt({')
    expect(query).toContain('if (updatedToolUseContext.agentId)')
    expect(query).toContain('enhanceSystemPromptWithEnvDetails')
    expect(query).toContain('mergeAppendSubagentSystemPrompt')
    expect(query).toContain("querySource === 'agent:builtin:fork'")
    expect(query).toContain("agentType === 'fork'")
    expect(query).toContain('useExactTools:')
    expect(query).toContain("'agent:observer:'")
    expect(query).not.toMatch(
      /if \(toolNamesChanged\)[\s\S]{0,400}getMainThreadAgentType\(\)/,
    )
    const refresh = query.indexOf(
      'if (updatedToolUseContext.options.refreshTools)',
    )
    const rebuild = query.indexOf('if (toolNamesChanged)')
    const subagent = query.indexOf(
      'if (updatedToolUseContext.agentId)',
      rebuild,
    )
    expect(refresh).toBeGreaterThan(0)
    expect(rebuild).toBeGreaterThan(refresh)
    expect(subagent).toBeGreaterThan(rebuild)
  })
})
