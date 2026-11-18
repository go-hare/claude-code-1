import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type Tools } from '../../../Tool.js'
import { findToolByNameWithAliases } from '../../queryHelpers.js'
import { getDenyRuleForTool } from '../permissions.js'

describe('dynamic --tools/--restricted & findToolByNameWithAliases (#379)', () => {
  test('getDenyRuleForTool denies enablesCodeExecution tools when restricted is true', () => {
    const ctx = { ...getEmptyToolPermissionContext(), restricted: true }
    const rule = getDenyRuleForTool(ctx, {
      name: 'WorkflowTool',
      enablesCodeExecution: true,
    })
    expect(rule).toEqual({
      source: 'toolsNarrowing',
      ruleBehavior: 'deny',
      ruleValue: { toolName: 'WorkflowTool' },
    })

    const nonExecRule = getDenyRuleForTool(ctx, {
      name: 'Read',
      enablesCodeExecution: false,
    })
    expect(nonExecRule).toBeNull()
  })

  test('getDenyRuleForTool checks underlyingV1ToolName against deny rules', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        ...getEmptyToolPermissionContext().alwaysDenyRules,
        cliArg: ['LegacyBash'],
      },
    }
    const rule = getDenyRuleForTool(ctx, {
      name: 'BashV2',
      underlyingV1ToolName: 'LegacyBash',
    })
    expect(rule).not.toBeNull()
    expect(rule!.ruleValue.toolName).toBe('LegacyBash')
  })

  test('findToolByNameWithAliases resolves alias chains and guards cycles', () => {
    const bashTool = { name: 'Bash' } as Tools[number]
    const tools = [bashTool] as unknown as Tools
    expect(
      findToolByNameWithAliases(tools, 'Shell', {
        Shell: 'BashAlias',
        BashAlias: 'Bash',
      }),
    ).toBe(bashTool)

    // Cycle guard: should return undefined instead of overflowing stack
    expect(
      findToolByNameWithAliases(tools, 'A', { A: 'B', B: 'A' }),
    ).toBeUndefined()
  })
})
