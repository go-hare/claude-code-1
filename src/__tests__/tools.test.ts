import { describe, expect, test } from 'bun:test'
import {
  assembleToolPool,
  parseToolPreset,
  filterToolsByDenyRules,
} from '../tools'
import { buildTool, getEmptyToolPermissionContext } from '../Tool'

describe('parseToolPreset', () => {
  test('returns "default" for "default" input', () => {
    expect(parseToolPreset('default')).toBe('default')
  })

  test('returns "default" for "Default" input (case-insensitive)', () => {
    expect(parseToolPreset('Default')).toBe('default')
  })

  test('returns null for unknown preset', () => {
    expect(parseToolPreset('unknown')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parseToolPreset('')).toBeNull()
  })

  test('returns null for random string', () => {
    expect(parseToolPreset('custom-preset')).toBeNull()
  })
})

// ─── filterToolsByDenyRules ─────────────────────────────────────────────

describe('filterToolsByDenyRules', () => {
  const mockTools = [
    { name: 'Bash', mcpInfo: undefined },
    { name: 'Read', mcpInfo: undefined },
    { name: 'Write', mcpInfo: undefined },
    {
      name: 'mcp__server__tool',
      mcpInfo: { serverName: 'server', toolName: 'tool' },
    },
  ]

  test('returns all tools when no deny rules', () => {
    const ctx = getEmptyToolPermissionContext()
    const result = filterToolsByDenyRules(mockTools, ctx)
    expect(result).toHaveLength(4)
  })

  test('filters out denied tool by name', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        localSettings: ['Bash'],
      },
    }
    const result = filterToolsByDenyRules(mockTools, ctx as any)
    expect(result.find(t => t.name === 'Bash')).toBeUndefined()
    expect(result).toHaveLength(3)
  })

  test('filters out multiple denied tools', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        localSettings: ['Bash', 'Write'],
      },
    }
    const result = filterToolsByDenyRules(mockTools, ctx as any)
    expect(result).toHaveLength(2)
    expect(result.map(t => t.name)).toEqual(['Read', 'mcp__server__tool'])
  })

  test('returns empty array when all tools denied', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        localSettings: mockTools.map(t => t.name),
      },
    }
    const result = filterToolsByDenyRules(mockTools, ctx as any)
    expect(result).toHaveLength(0)
  })

  test('handles empty tools array', () => {
    const ctx = getEmptyToolPermissionContext()
    expect(filterToolsByDenyRules([], ctx)).toEqual([])
  })
})

// ─── assembleToolPool ───────────────────────────────────────────────────

describe('assembleToolPool', () => {
  test('throws when an MCP tool collides with a built-in primary name', () => {
    // getTools → tool.isEnabled() may walk model/auth; keep suite hermetic.
    const prevKey = process.env.ANTHROPIC_API_KEY
    const prevOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key'
    try {
      const conflictingMcpTool = buildTool({
        name: 'Bash',
        inputSchema: { type: 'object' as const } as any,
        maxResultSizeChars: 10_000,
        call: async () => ({ data: 'ok' }),
        description: async () => 'Bash description',
        prompt: async () => 'Bash prompt',
        mapToolResultToToolResultBlockParam: (
          content: unknown,
          toolUseID: string,
        ) => ({
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: String(content),
        }),
        renderToolUseMessage: () => null,
        mcpInfo: { serverName: 'docs', toolName: 'search' },
      })

      expect(() =>
        assembleToolPool(getEmptyToolPermissionContext(), [conflictingMcpTool]),
      ).toThrow('Conflicting tools share primary name "Bash"')
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prevKey
      if (prevOauth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevOauth
    }
  })
})
