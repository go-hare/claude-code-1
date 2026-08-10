/**
 * densable 2.1.222 #11 — tool errors still display when tool def is gone
 * (e.g. MCP server removed). SEA Wli: return {tool?, toolUse} not null.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Tool, Tools } from '../../../../Tool.js'
import { resolveToolFromMessages } from '../utils.js'

function fakeTool(name: string): Tool {
  return { name } as Tool
}

function toolUse(id: string, name: string): ToolUseBlockParam {
  return {
    type: 'tool_use',
    id,
    name,
    input: {},
  }
}

describe('densable 2.1.222 #11 resolveToolFromMessages (Wli)', () => {
  test('returns null only when tool_use block is missing', () => {
    const map = new Map<string, ToolUseBlockParam>()
    expect(resolveToolFromMessages('missing', [], map, [])).toBeNull()
  })

  test('returns live tool when present', () => {
    const live = fakeTool('mcp__srv__do')
    const block = toolUse('tu_1', 'mcp__srv__do')
    const map = new Map([['tu_1', block]])
    const resolved = resolveToolFromMessages('tu_1', [live], map, [])
    expect(resolved).toEqual({ tool: live, toolUse: block })
  })

  test('MCP removed: still returns toolUse with tool undefined (error visible)', () => {
    const block = toolUse('tu_2', 'mcp__gone__call')
    const map = new Map([['tu_2', block]])
    const resolved = resolveToolFromMessages('tu_2', [] as Tools, map, [])
    expect(resolved).not.toBeNull()
    expect(resolved!.toolUse).toBe(block)
    expect(resolved!.tool).toBeUndefined()
  })

  test('Brief SendUserMessage recovers from base tools when not live', () => {
    const base = fakeTool('SendUserMessage')
    const block = toolUse('tu_3', 'SendUserMessage')
    const map = new Map([['tu_3', block]])
    const resolved = resolveToolFromMessages('tu_3', [], map, [base])
    expect(resolved).toEqual({ tool: base, toolUse: block })
  })

  test('non-Brief does not recover from base tools', () => {
    const base = fakeTool('Bash')
    const block = toolUse('tu_4', 'Bash')
    const map = new Map([['tu_4', block]])
    const resolved = resolveToolFromMessages('tu_4', [], map, [base])
    expect(resolved!.tool).toBeUndefined()
    expect(resolved!.toolUse).toBe(block)
  })
})

describe('densable 2.1.222 #11 wire-up', () => {
  test('UserToolErrorMessage falls back when tool undefined', () => {
    const src = readFileSync(
      join(import.meta.dir, '../UserToolErrorMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('tool?.renderToolUseErrorMessage')
    expect(src).toContain('FallbackToolUseErrorMessage')
  })

  test('UserToolResultMessage only nulls when toolUse block missing', () => {
    const src = readFileSync(
      join(import.meta.dir, '../UserToolResultMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('if (!toolUse)')
    expect(src).toContain('param.is_error')
    expect(src).toContain('UserToolErrorMessage')
  })

  test('utils implements densable Wli fallthrough (not null on missing def)', () => {
    const src = readFileSync(join(import.meta.dir, '../utils.tsx'), 'utf8')
    expect(src).toContain('resolveToolFromMessages')
    expect(src).toContain('SendUserMessage')
    expect(src).toContain('getAllBaseTools')
    // must not early-return null solely because findToolByName failed
    expect(src).not.toMatch(
      /const tool = findToolByName\([\s\S]*?\nif \(!tool\) \{\s*return null/,
    )
  })
})
