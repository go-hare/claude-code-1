import { describe, expect, test } from 'bun:test'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
} from '../../../Tool.js'
import {
  filterToolsByDenyRules,
  isWithheldOutsideLaunchList,
} from '../../../tools.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@claude-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import {
  clearCommandScopedAllowRules,
  initializeToolPermissionContext,
} from '../permissionSetup.js'
import { getDenyRuleForTool } from '../permissions.js'
import {
  rewriteResumedSubagentShutdownToolResults,
  SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE,
} from '../../messages.js'

describe('Deep 1:1 alignment (#206, #379, #499)', () => {
  test('#379: initializeToolPermissionContext routes --tools exclusions to toolsNarrowing and freezes toolsKeptByLaunchList', async () => {
    const custom = await initializeToolPermissionContext({
      allowedToolsCli: [],
      disallowedToolsCli: [],
      baseToolsCli: ['Read', 'Grep'],
      permissionMode: 'default',
      allowDangerouslySkipPermissions: false,
      addDirs: [],
    })
    expect(custom.toolPermissionContext.toolsKeptByLaunchList).toEqual([
      'Read',
      'Grep',
    ])
    expect(
      Object.isFrozen(custom.toolPermissionContext.toolsKeptByLaunchList),
    ).toBe(true)
    expect(custom.toolPermissionContext.alwaysDenyRules.cliArg).toEqual([])
    expect(
      custom.toolPermissionContext.alwaysDenyRules.toolsNarrowing,
    ).toContain('Bash')
    expect(
      custom.toolPermissionContext.alwaysDenyRules.toolsNarrowing,
    ).not.toContain('Read')
    expect(
      custom.toolPermissionContext.alwaysDenyRules.toolsNarrowing,
    ).not.toContain('Grep')

    const preset = await initializeToolPermissionContext({
      allowedToolsCli: [],
      disallowedToolsCli: [],
      baseToolsCli: ['default'],
      permissionMode: 'default',
      allowDangerouslySkipPermissions: false,
      addDirs: [],
    })
    expect(preset.toolPermissionContext.toolsKeptByLaunchList).toBeUndefined()
  })

  test('#379: isWithheldOutsideLaunchList and filterToolsByDenyRules withhold non-MCP tools outside launch list', () => {
    const ctx: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      toolsKeptByLaunchList: Object.freeze(['Read']),
    }

    const readTool = { name: 'Read' }
    const dynamicTool = { name: 'DynamicPluginTool' }
    const mcpTool = {
      name: 'mcp__srv__do',
      mcpInfo: { serverName: 'srv', toolName: 'do' },
    }
    const structuredOut = { name: SYNTHETIC_OUTPUT_TOOL_NAME }

    expect(isWithheldOutsideLaunchList(ctx, readTool)).toBe(false)
    expect(isWithheldOutsideLaunchList(ctx, dynamicTool)).toBe(true)
    expect(isWithheldOutsideLaunchList(ctx, mcpTool)).toBe(false)
    expect(isWithheldOutsideLaunchList(ctx, structuredOut)).toBe(false)

    const filtered = filterToolsByDenyRules(
      [readTool, dynamicTool, mcpTool, structuredOut],
      ctx,
    )
    expect(filtered.map(t => t.name)).toEqual([
      'Read',
      'mcp__srv__do',
      SYNTHETIC_OUTPUT_TOOL_NAME,
    ])
  })

  test('#379: getDenyRuleForTool guards restricted && enablesCodeExecution with toolsKeptByLaunchList === undefined', () => {
    const codeTool = { name: 'CustomCodeTool', enablesCodeExecution: true }

    const restrictedNoLaunchList: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      restricted: true,
    }
    expect(getDenyRuleForTool(restrictedNoLaunchList, codeTool)).toEqual({
      source: 'toolsNarrowing',
      ruleBehavior: 'deny',
      ruleValue: { toolName: 'CustomCodeTool' },
    })

    const restrictedWithLaunchList: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      restricted: true,
      toolsKeptByLaunchList: Object.freeze(['CustomCodeTool']),
    }
    expect(getDenyRuleForTool(restrictedWithLaunchList, codeTool)).toBeNull()
  })

  test('#206: czs-equivalent turn-start clearing removes strippedDangerousRules.command and pollEventDeliveryGuard', () => {
    const prev: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        userSettings: ['Read'],
        command: ['Skill(foo)'],
      },
      strippedDangerousRules: {
        userSettings: ['Bash(*)'],
        command: ['Bash(*)'],
      },
      pollEventDeliveryGuard: true,
    }

    const cleared = clearCommandScopedAllowRules(prev)
    const next: ToolPermissionContext = {
      ...cleared,
      alwaysAllowRules: {
        ...cleared.alwaysAllowRules,
        command: ['Edit'],
      },
      pollEventDeliveryGuard: undefined,
    }

    expect(next.alwaysAllowRules.command).toEqual(['Edit'])
    expect(next.alwaysAllowRules.userSettings).toEqual(['Read'])
    expect(next.strippedDangerousRules?.command).toBeUndefined()
    expect(next.strippedDangerousRules?.userSettings).toEqual(['Bash(*)'])
    expect(next.pollEventDeliveryGuard).toBeUndefined()
  })

  test('#499: rewriteResumedSubagentShutdownToolResults rewrites shutdown-interrupted tool_result blocks', () => {
    const msg = {
      type: 'user' as const,
      uuid: 'u1',
      interruptedByShutdown: true,
      toolUseResult: 'User rejected tool use',
      message: {
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'tu1',
            content: 'User rejected tool use',
            is_error: true,
          },
        ],
      },
    }
    const [rewritten] = rewriteResumedSubagentShutdownToolResults([
      msg as never,
    ])
    expect(rewritten).toBeDefined()
    if (
      rewritten?.type === 'user' &&
      rewritten.message &&
      Array.isArray(rewritten.message.content)
    ) {
      expect(rewritten.toolUseResult).toBe(
        SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE,
      )
      expect(
        (rewritten.message.content[0] as { content: string }).content,
      ).toBe(SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE)
    }
  })
})
