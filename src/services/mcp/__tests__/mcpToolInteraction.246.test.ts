import { describe, expect, test } from 'bun:test'
import {
  isMcpRequiresUserInteraction,
  mcpToolCheckPermissionsResult,
} from '../mcpToolInteraction.js'

describe('isMcpRequiresUserInteraction (official W)', () => {
  test('true only for the anthropic meta flag', () => {
    expect(
      isMcpRequiresUserInteraction({
        'anthropic/requiresUserInteraction': true,
      }),
    ).toBe(true)
    expect(
      isMcpRequiresUserInteraction({
        'anthropic/requiresUserInteraction': false,
      }),
    ).toBe(false)
    expect(isMcpRequiresUserInteraction({})).toBe(false)
    expect(isMcpRequiresUserInteraction(undefined)).toBe(false)
  })
})

describe('mcpToolCheckPermissionsResult (official checkPermissions)', () => {
  test('requires interaction → ask, no persistent allow', () => {
    const result = mcpToolCheckPermissionsResult(true, 'mcp__demo__click')
    expect(result).toEqual({
      behavior: 'ask',
      message: 'MCPTool requires permission.',
      suggestions: [],
      suppressAlwaysAllowRule: true,
    })
  })

  test('plain MCP tool still suggests a whole-tool allow rule', () => {
    const result = mcpToolCheckPermissionsResult(false, 'mcp__demo__search')
    expect(result.behavior).toBe('passthrough')
    if (result.behavior !== 'passthrough') {
      throw new Error('expected passthrough')
    }
    expect(result.suggestions).toEqual([
      {
        type: 'addRules',
        rules: [
          {
            toolName: 'mcp__demo__search',
            ruleContent: undefined,
          },
        ],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
    expect(
      'suppressAlwaysAllowRule' in result && result.suppressAlwaysAllowRule,
    ).toBeFalsy()
  })
})
