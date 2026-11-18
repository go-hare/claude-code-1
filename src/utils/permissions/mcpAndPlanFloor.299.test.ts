import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  checkRuleBasedPermissions,
  getMcpServerRuleNames,
  toolMatchesRule,
} from './permissions.js'
import type { PermissionRule } from './PermissionRule.js'
import type { Tool, ToolUseContext } from '../../Tool.js'

function makeRule(
  toolName: string,
  ruleBehavior: 'allow' | 'deny' | 'ask',
  source: PermissionRule['source'] = 'userSettings',
): PermissionRule {
  return {
    source,
    ruleBehavior,
    ruleValue: { toolName },
  }
}

describe('v2.1.299 MCP double-underscore rules (#629, #722) & planModeWriteFloor (#686)', () => {
  test('#629: deny and ask rules mcp__<server> match servers with __ in normalized name', () => {
    const toolWithInfo = {
      name: 'mcp__my__server__do_thing',
      mcpInfo: { serverName: 'my__server', toolName: 'do_thing' },
    }
    const toolWithoutInfo = {
      name: 'mcp__my__server__do_thing',
    }
    expect(getMcpServerRuleNames(toolWithInfo)).toContain('mcp__my__server')
    expect(getMcpServerRuleNames(toolWithoutInfo)).toEqual([
      'mcp__my',
      'mcp__my__server',
    ])

    expect(
      toolMatchesRule(toolWithInfo, makeRule('mcp__my__server', 'deny')),
    ).toBe(true)
    expect(
      toolMatchesRule(toolWithInfo, makeRule('mcp__my__server', 'ask')),
    ).toBe(true)
    expect(
      toolMatchesRule(toolWithoutInfo, makeRule('mcp__my__server', 'deny')),
    ).toBe(true)
  })

  test('#722: allow rule mcp__a does not allow server a__b or a_; mcp__<server>__* works', () => {
    const toolAB = {
      name: 'mcp__a__b__run',
      mcpInfo: { serverName: 'a__b', toolName: 'run' },
    }
    const toolAUnderscore = {
      name: 'mcp__a___run',
      mcpInfo: { serverName: 'a_', toolName: 'run' },
    }
    const toolA = {
      name: 'mcp__a__run',
      mcpInfo: { serverName: 'a', toolName: 'run' },
    }

    expect(toolMatchesRule(toolAB, makeRule('mcp__a', 'allow'))).toBe(false)
    expect(toolMatchesRule(toolAUnderscore, makeRule('mcp__a', 'allow'))).toBe(
      false,
    )
    expect(toolMatchesRule(toolA, makeRule('mcp__a', 'allow'))).toBe(true)

    expect(toolMatchesRule(toolAB, makeRule('mcp__a__b__*', 'allow'))).toBe(
      true,
    )
    expect(
      toolMatchesRule(toolAUnderscore, makeRule('mcp__a___*', 'allow')),
    ).toBe(true)
  })

  test('#686: checkRuleBasedPermissions with planModeWriteFloor blocks non-read-only writes in plan mode', async () => {
    const writeTool = {
      name: 'Write',
      inputSchema: z.object({ file_path: z.string() }),
      isReadOnly: () => false,
      checkPermissions: async () => ({
        behavior: 'allow' as const,
        updatedInput: { file_path: '/tmp/x' },
      }),
    } as unknown as Tool

    const readTool = {
      name: 'Read',
      inputSchema: z.object({ file_path: z.string() }),
      isReadOnly: () => true,
      checkPermissions: async () => ({
        behavior: 'allow' as const,
        updatedInput: { file_path: '/tmp/x' },
      }),
    } as unknown as Tool

    const planContext = {
      abortController: new AbortController(),
      options: { tools: [] },
      getAppState: () => ({
        toolPermissionContext: {
          mode: 'plan',
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          additionalWorkingDirectories: new Map(),
        },
      }),
    } as unknown as ToolUseContext

    const writeDecision = await checkRuleBasedPermissions(
      writeTool,
      { file_path: '/tmp/x' },
      planContext,
      { crashIsObjection: true, planModeWriteFloor: true },
    )
    expect(writeDecision?.behavior).toBe('ask')
    expect(writeDecision?.decisionReason).toEqual({
      type: 'mode',
      mode: 'plan',
    })

    const readDecision = await checkRuleBasedPermissions(
      readTool,
      { file_path: '/tmp/x' },
      planContext,
      { crashIsObjection: true, planModeWriteFloor: true },
    )
    expect(readDecision).toBeNull()
  })
})
