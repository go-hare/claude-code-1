/**
 * densable WebSearch stream residual: effortValue:P_(t), getToolPermissionContext:Tn(t),
 * bare options.mainLoopModel (not X$).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('WebSearch API adapter densable P_/Tn residual', () => {
  test('apiAdapter wires resolveEffortValue + resolveToolPermissionContext', () => {
    const src = readFileSync(
      join(import.meta.dir, '../adapters/apiAdapter.ts'),
      'utf8',
    )
    expect(src).toContain('resolveEffortValue')
    expect(src).toContain('resolveToolPermissionContext')
    expect(src).toContain('toolUseContext')
    // densable bare mainLoopModel, not X$
    expect(src).toContain('toolUseContext?.options.mainLoopModel')
    expect(src).not.toContain('resolveMainLoopModel')
    expect(src).toContain("querySource: 'web_search_tool'")
    expect(src).toContain('effortValue')
  })

  test('apiAdapter densable thinkingConfig disabled + toolChoice web_search always', () => {
    const src = readFileSync(
      join(import.meta.dir, '../adapters/apiAdapter.ts'),
      'utf8',
    )
    // densable: thinkingConfig:{type:"disabled"} (not haiku-gated enabled budget)
    expect(src).toContain("thinkingConfig: { type: 'disabled' as const }")
    expect(src).not.toMatch(/budgetTokens:\s*10000/)
    // densable: toolChoice always web_search (not only when useHaiku)
    expect(src).toContain(
      "toolChoice: { type: 'tool' as const, name: 'web_search' }",
    )
    expect(src).not.toMatch(/toolChoice:\s*useHaiku/)
    // densable enablePromptCaching:!1
    expect(src).toContain('enablePromptCaching: false')
  })

  test('WebSearchTool.call passes toolUseContext to adapter', () => {
    const src = readFileSync(
      join(import.meta.dir, '../WebSearchTool.ts'),
      'utf8',
    )
    expect(src).toContain('toolUseContext: context')
  })

  test('SearchOptions exposes optional toolUseContext', () => {
    const src = readFileSync(
      join(import.meta.dir, '../adapters/types.ts'),
      'utf8',
    )
    expect(src).toContain('toolUseContext?: ToolUseContext')
  })
})
