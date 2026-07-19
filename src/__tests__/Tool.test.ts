import { describe, expect, test } from 'bun:test'
import {
  buildTool,
  toolMatchesName,
  findToolByName,
  buildToolNameLookupMap,
  forwardToolAliasPair,
  reverseToolAliases,
  getEmptyToolPermissionContext,
  filterToolProgressMessages,
} from '../Tool'

// Minimal tool definition for testing buildTool
function makeMinimalToolDef(overrides: Record<string, unknown> = {}) {
  return {
    name: 'TestTool',
    inputSchema: { type: 'object' as const } as any,
    maxResultSizeChars: 10000,
    call: async () => ({ data: 'ok' }),
    description: async () => 'A test tool',
    prompt: async () => 'test prompt',
    mapToolResultToToolResultBlockParam: (
      content: unknown,
      toolUseID: string,
    ) => ({
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: String(content),
    }),
    renderToolUseMessage: () => null,
    ...overrides,
  }
}

describe('buildTool', () => {
  test('fills in default isEnabled as true', () => {
    const tool = buildTool(makeMinimalToolDef())
    expect(tool.isEnabled()).toBe(true)
  })

  test('fills in default isConcurrencySafe as false', () => {
    const tool = buildTool(makeMinimalToolDef())
    expect(tool.isConcurrencySafe({})).toBe(false)
  })

  test('fills in default isReadOnly as false', () => {
    const tool = buildTool(makeMinimalToolDef())
    expect(tool.isReadOnly({})).toBe(false)
  })

  test('fills in default isDestructive as false', () => {
    const tool = buildTool(makeMinimalToolDef())
    expect(tool.isDestructive!({})).toBe(false)
  })

  test('fills in default checkPermissions as allow', async () => {
    const tool = buildTool(makeMinimalToolDef())
    const input = { foo: 'bar' }
    const result = await tool.checkPermissions(input, {} as any)
    expect(result).toEqual({ behavior: 'allow', updatedInput: input })
  })

  test('fills in default userFacingName from tool name', () => {
    const tool = buildTool(makeMinimalToolDef())
    expect(tool.userFacingName(undefined)).toBe('TestTool')
  })

  test('fills in default toAutoClassifierInput as empty string', () => {
    const tool = buildTool(makeMinimalToolDef())
    expect(tool.toAutoClassifierInput({})).toBe('')
  })

  test('preserves explicitly provided methods', () => {
    const tool = buildTool(
      makeMinimalToolDef({
        isEnabled: () => false,
        isConcurrencySafe: () => true,
        isReadOnly: () => true,
      }),
    )
    expect(tool.isEnabled()).toBe(false)
    expect(tool.isConcurrencySafe({})).toBe(true)
    expect(tool.isReadOnly({})).toBe(true)
  })

  test('preserves all non-defaultable properties', () => {
    const tool = buildTool(makeMinimalToolDef())
    expect(tool.name).toBe('TestTool')
    expect(tool.maxResultSizeChars).toBe(10000)
    expect(typeof tool.call).toBe('function')
    expect(typeof tool.description).toBe('function')
    expect(typeof tool.prompt).toBe('function')
  })
})

describe('toolMatchesName', () => {
  test('returns true for exact name match', () => {
    expect(toolMatchesName({ name: 'Bash' }, 'Bash')).toBe(true)
  })

  test('returns false for non-matching name', () => {
    expect(toolMatchesName({ name: 'Bash' }, 'Read')).toBe(false)
  })

  test('returns true when name matches an alias', () => {
    expect(
      toolMatchesName(
        { name: 'Bash', aliases: ['BashTool', 'Shell'] },
        'BashTool',
      ),
    ).toBe(true)
  })

  test('returns false when aliases is undefined', () => {
    expect(toolMatchesName({ name: 'Bash' }, 'BashTool')).toBe(false)
  })

  test('returns false when aliases is empty', () => {
    expect(toolMatchesName({ name: 'Bash', aliases: [] }, 'BashTool')).toBe(
      false,
    )
  })
})

describe('findToolByName', () => {
  const mockTools = [
    buildTool(makeMinimalToolDef({ name: 'Bash' })),
    buildTool(makeMinimalToolDef({ name: 'Read', aliases: ['FileRead'] })),
    buildTool(makeMinimalToolDef({ name: 'Edit' })),
  ]

  test('finds tool by primary name', () => {
    const tool = findToolByName(mockTools, 'Bash')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('Bash')
  })

  test('finds tool by alias', () => {
    const tool = findToolByName(mockTools, 'FileRead')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('Read')
  })

  test('returns undefined when no match', () => {
    expect(findToolByName(mockTools, 'NonExistent')).toBeUndefined()
  })

  test('returns first match when duplicates exist', () => {
    const dupeTools = [
      buildTool(makeMinimalToolDef({ name: 'Bash', maxResultSizeChars: 100 })),
      buildTool(makeMinimalToolDef({ name: 'Bash', maxResultSizeChars: 200 })),
    ]
    const tool = findToolByName(dupeTools, 'Bash')
    expect(tool!.maxResultSizeChars).toBe(100)
  })

  // densable Tc — session toolAliases single-hop remap
  test('resolves densable session toolAliases map (single hop)', () => {
    const tool = findToolByName(mockTools, 'shell', { shell: 'Bash' })
    expect(tool?.name).toBe('Bash')
  })

  test('session toolAliases does not chain (single hop only)', () => {
    // shell → sh → Bash would require multi-hop; densable Tc drops map on recurse
    expect(
      findToolByName(mockTools, 'shell', { shell: 'sh', sh: 'Bash' }),
    ).toBeUndefined()
    // direct hop still works
    expect(findToolByName(mockTools, 'sh', { shell: 'sh', sh: 'Bash' })?.name).toBe(
      'Bash',
    )
  })

  test('session toolAliases identity mapping is ignored', () => {
    expect(findToolByName(mockTools, 'Bash', { Bash: 'Bash' })?.name).toBe(
      'Bash',
    )
  })

  test('session toolAliases can remap onto a builtin tool alias target', () => {
    // map → primary name after hop
    expect(findToolByName(mockTools, 'rf', { rf: 'Read' })?.name).toBe('Read')
  })
})

describe('forwardToolAliasPair / reverseToolAliases densable sDn/b5t', () => {
  test('sDn returns [name, mapped] for non-identity map', () => {
    expect(forwardToolAliasPair('shell', { shell: 'Bash' })).toEqual([
      'shell',
      'Bash',
    ])
  })

  test('sDn returns [name] when unmapped or identity', () => {
    expect(forwardToolAliasPair('Bash', { shell: 'Bash' })).toEqual(['Bash'])
    expect(forwardToolAliasPair('Bash', { Bash: 'Bash' })).toEqual(['Bash'])
    expect(forwardToolAliasPair('Bash', null)).toEqual(['Bash'])
  })

  test('b5t lists reverse aliases', () => {
    expect(
      reverseToolAliases('Bash', {
        shell: 'Bash',
        sh: 'Bash',
        r: 'Read',
      }).sort(),
    ).toEqual(['sh', 'shell'])
    expect(reverseToolAliases('Bash', null)).toEqual([])
  })
})

describe('toolNamesForAlwaysAllowSuppress densable nLe', () => {
  test('nLe is primary + reverse aliases', async () => {
    const { toolNamesForAlwaysAllowSuppress } = await import('../Tool.js')
    expect(
      [...toolNamesForAlwaysAllowSuppress({ name: 'Bash' }, { shell: 'Bash' })].sort(),
    ).toEqual(['Bash', 'shell'])
  })
})

describe('buildToolNameLookupMap / findToolByName densable B7c/U7c/Rrg', () => {
  test('Rrg primary name wins over later alias of same string', () => {
    const tools = [
      buildTool(makeMinimalToolDef({ name: 'Read' })),
      buildTool(makeMinimalToolDef({ name: 'Other', aliases: ['Read'] })),
    ]
    const map = buildToolNameLookupMap(tools)
    expect(map.get('Read')?.name).toBe('Read')
  })

  test('Rrg first alias registration wins', () => {
    const tools = [
      buildTool(makeMinimalToolDef({ name: 'A', aliases: ['x'] })),
      buildTool(makeMinimalToolDef({ name: 'B', aliases: ['x'] })),
    ]
    expect(buildToolNameLookupMap(tools).get('x')?.name).toBe('A')
  })

  test('findToolByName cache path still resolves name and alias', () => {
    const tools = [
      buildTool(makeMinimalToolDef({ name: 'Bash' })),
      buildTool(makeMinimalToolDef({ name: 'Read', aliases: ['FileRead'] })),
    ]
    // First lookup primes U7c; second builds B7c map.
    expect(findToolByName(tools, 'Bash')?.name).toBe('Bash')
    expect(findToolByName(tools, 'FileRead')?.name).toBe('Read')
    expect(findToolByName(tools, 'Bash')?.name).toBe('Bash')
    expect(findToolByName(tools, 'missing')).toBeUndefined()
  })

  test('earlier alias vs later primary: linear and cache agree (densable first-wins)', () => {
    // densable ll is single find(name|alias) in registration order; Rrg is single-pass
    // first-wins — so earlier alias shadows later primary, and both paths agree.
    const tools = [
      buildTool(makeMinimalToolDef({ name: 'Early', aliases: ['Conflict'] })),
      buildTool(makeMinimalToolDef({ name: 'Conflict' })),
    ]
    const linear = findToolByName(tools, 'Conflict')?.name
    const cached = findToolByName(tools, 'Conflict')?.name
    const rrg = buildToolNameLookupMap(tools).get('Conflict')?.name
    expect(linear).toBe('Early')
    expect(cached).toBe('Early')
    expect(rrg).toBe('Early')
    expect(cached).toBe(linear)
  })

  test('session toolAliases single-hop still works with cache', () => {
    const tools = [buildTool(makeMinimalToolDef({ name: 'Bash' }))]
    expect(findToolByName(tools, 'shell', { shell: 'Bash' })?.name).toBe('Bash')
    // second lookup hits cache after U7c seen
    expect(findToolByName(tools, 'Bash')?.name).toBe('Bash')
    expect(findToolByName(tools, 'shell', { shell: 'Bash' })?.name).toBe('Bash')
  })

  test('source anchors densable B7c/U7c/Rrg', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(join(import.meta.dir, '../Tool.ts'), 'utf8')
    expect(src).toContain('findToolByNameCache')
    expect(src).toContain('findToolByNameSeen')
    expect(src).toContain('buildToolNameLookupMap')
    expect(src).toContain('densable B7c')
    expect(src).toContain('densable U7c')
    expect(src).toContain('densable Rrg')
    // densable first path is single find(ll), not primary-then-alias two-pass
    expect(src).toMatch(
      /return tools\.find\(\s*t\s*=>\s*toolMatchesName\(\s*t\s*,\s*name\s*\)\s*\)/,
    )
  })
})

describe('getEmptyToolPermissionContext', () => {
  test('returns default permission mode', () => {
    const ctx = getEmptyToolPermissionContext()
    expect(ctx.mode).toBe('default')
  })

  test('returns empty maps and arrays', () => {
    const ctx = getEmptyToolPermissionContext()
    expect(ctx.additionalWorkingDirectories.size).toBe(0)
    expect(ctx.alwaysAllowRules).toEqual({})
    expect(ctx.alwaysDenyRules).toEqual({})
    expect(ctx.alwaysAskRules).toEqual({})
  })

  test('returns isBypassPermissionsModeAvailable as true', () => {
    const ctx = getEmptyToolPermissionContext()
    expect(ctx.isBypassPermissionsModeAvailable).toBe(true)
  })

  test('returns empty mcpPermissionModeOverrides', () => {
    const ctx = getEmptyToolPermissionContext()
    expect(ctx.mcpPermissionModeOverrides).toEqual({})
  })
})

describe('filterToolProgressMessages', () => {
  test('filters out hook_progress messages', () => {
    const messages = [
      { data: { type: 'hook_progress', hookName: 'pre' } },
      { data: { type: 'tool_progress', toolName: 'Bash' } },
    ] as any[]
    const result = filterToolProgressMessages(messages)
    expect(result).toHaveLength(1)
    expect((result[0]!.data as any).type).toBe('tool_progress')
  })

  test('keeps tool progress messages', () => {
    const messages = [
      { data: { type: 'tool_progress', toolName: 'Bash' } },
      { data: { type: 'tool_progress', toolName: 'Read' } },
    ] as any[]
    const result = filterToolProgressMessages(messages)
    expect(result).toHaveLength(2)
  })

  test('returns empty array for empty input', () => {
    expect(filterToolProgressMessages([])).toEqual([])
  })

  test('handles messages without type field', () => {
    const messages = [
      { data: { toolName: 'Bash' } },
      { data: { type: 'hook_progress' } },
    ] as any[]
    const result = filterToolProgressMessages(messages)
    expect(result).toHaveLength(1)
  })
})
