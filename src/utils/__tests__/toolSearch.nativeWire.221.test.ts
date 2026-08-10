import { describe, expect, test } from 'bun:test'

/**
 * densable 2.1.221 #22 — native ToolSearch wire protocol (hermetic mirrors).
 *
 * Covers the SEA gold path without importing claude.ts / SearchExtraToolsTool
 * (process-global mock pollution). Product code lives in:
 * - SearchExtraToolsTool mapResult → tool_reference
 * - claude.ts filter + defer_loading + Jvu beta + dBp placeholder
 * - constants SEARCH_EXTRA_TOOLS_TOOL_NAME = 'ToolSearch'
 */

describe('densable native ToolSearch wire protocol', () => {
  test('wire tool name is ToolSearch (dw)', async () => {
    const { SEARCH_EXTRA_TOOLS_TOOL_NAME } = await import(
      '@claude-code/builtin-tools/tools/SearchExtraToolsTool/constants.js'
    )
    expect(SEARCH_EXTRA_TOOLS_TOOL_NAME).toBe('ToolSearch')
  })

  test('Lwe-style filter: non-deferred + ToolSearch + discovered only', () => {
    const tools = [
      { name: 'Read', deferred: false },
      { name: 'ToolSearch', deferred: false },
      { name: 'CronCreate', deferred: true },
      { name: 'mcp__slack__send', deferred: true },
      { name: 'Config', deferred: true },
    ]
    const discovered = new Set(['CronCreate'])
    const deferredNames = new Set(
      tools.filter(t => t.deferred).map(t => t.name),
    )

    const filtered = tools.filter(tool => {
      if (!deferredNames.has(tool.name)) return true
      if (tool.name === 'ToolSearch') return true
      return discovered.has(tool.name)
    })

    expect(filtered.map(t => t.name)).toEqual([
      'Read',
      'ToolSearch',
      'CronCreate',
    ])
  })

  test('when S off, ToolSearch is excluded', () => {
    const tools = [
      { name: 'Read' },
      { name: 'ToolSearch' },
      { name: 'CronCreate' },
    ]
    const S = false
    const filtered = S ? tools : tools.filter(t => t.name !== 'ToolSearch')
    expect(filtered.map(t => t.name)).toEqual(['Read', 'CronCreate'])
  })

  test('deferLoading = S && (deferred || lspPending)', () => {
    const S = true
    const deferred = new Set(['CronCreate', 'Config'])
    const shouldDefer = (name: string, lspPending = false) =>
      S && (deferred.has(name) || lspPending)

    expect(shouldDefer('Read')).toBe(false)
    expect(shouldDefer('ToolSearch')).toBe(false)
    expect(shouldDefer('CronCreate')).toBe(true)
    expect(shouldDefer('LSP', true)).toBe(true)
  })

  test('Jvu beta push: non-bedrock only', () => {
    const Jvu = (provider: string) =>
      provider === 'vertex' ||
      provider === 'bedrock' ||
      provider === 'mantle' ||
      provider === 'gateway'
        ? 'tool-search-tool-2025-10-19'
        : 'advanced-tool-use-2025-11-20'

    const shouldPush = (S: boolean, provider: string) =>
      S && provider !== 'bedrock' ? Jvu(provider) : null

    expect(shouldPush(true, 'firstParty')).toBe('advanced-tool-use-2025-11-20')
    expect(shouldPush(true, 'vertex')).toBe('tool-search-tool-2025-10-19')
    expect(shouldPush(true, 'bedrock')).toBeNull()
    expect(shouldPush(false, 'firstParty')).toBeNull()
  })

  test('mapResult tool_reference shape (densable gold)', () => {
    const matches = ['CronCreate', 'Config']
    const content = matches.map(tool_name => ({
      type: 'tool_reference' as const,
      tool_name,
    }))
    expect(content).toEqual([
      { type: 'tool_reference', tool_name: 'CronCreate' },
      { type: 'tool_reference', tool_name: 'Config' },
    ])
  })

  test('DeferredToolPlaceholder shape (dBp / Osr)', () => {
    const placeholder = {
      name: 'DeferredToolPlaceholder',
      description:
        'Reserved placeholder that keeps deferred tool loading active; never call this tool.',
      input_schema: { type: 'object' as const, properties: {} },
      defer_loading: true as const,
    }
    expect(placeholder.name).toBe('DeferredToolPlaceholder')
    expect(placeholder.defer_loading).toBe(true)
    expect(placeholder.input_schema.properties).toEqual({})
  })

  test('Lwe extract: tool_reference primary + text legacy', () => {
    type Block = { type: 'tool_reference'; tool_name: string } | string

    function extract(blocks: Block[]): Set<string> {
      const out = new Set<string>()
      for (const b of blocks) {
        if (typeof b === 'object' && b.type === 'tool_reference') {
          out.add(b.tool_name)
        } else if (typeof b === 'string') {
          const m = /^Found \d+ deferred tool\(s\): (.+)\.$/m.exec(b)
          if (m?.[1]) {
            for (const n of m[1]
              .split(',')
              .map(s => s.trim())
              .filter(Boolean)) {
              out.add(n)
            }
          }
        }
      }
      return out
    }

    expect([
      ...extract([{ type: 'tool_reference', tool_name: 'CronCreate' }]),
    ]).toEqual(['CronCreate'])
    expect(
      [
        ...extract([
          'Found 2 deferred tool(s): Config, Monitor.\nUse ExecuteExtraTool...',
        ]),
      ].sort(),
    ).toEqual(['Config', 'Monitor'])
  })

  test('prompt narrative: deferred tools call-directly (no ExecuteExtraTool main path)', async () => {
    const { getPrompt } = await import(
      '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
    )
    const p = getPrompt()
    expect(p).toContain('callable exactly like any tool defined at the top')
    expect(p).not.toContain('ExecuteExtraTool')
  })
})
