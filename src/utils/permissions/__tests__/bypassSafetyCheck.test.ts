/**
 * densable 2.1.218 residual: bypassPermissions must allow classifierApprovable
 * safetyChecks (e.g. Write under .claude/workflow-runs/), while non-approvable
 * safetyChecks (Windows path tricks) stay immune.
 */
import { describe, expect, mock, test } from 'bun:test'
import { z } from 'zod'
import { logMock } from '../../../../tests/mocks/log'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'

mock.module('src/utils/log.ts', logMock)

const { hasPermissionsToUseTool } = await import('../permissions')

function makeContext(
  mode: 'bypassPermissions' | 'default' | 'plan',
  extra?: { prePlanMode?: 'bypassPermissions' | 'default' },
): ToolUseContext {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    mode,
    isBypassPermissionsModeAvailable: true,
    ...(extra?.prePlanMode !== undefined
      ? { prePlanMode: extra.prePlanMode }
      : {}),
  }
  return {
    getAppState: () =>
      ({
        toolPermissionContext,
        mcp: { tools: [] },
      }) as unknown as ReturnType<ToolUseContext['getAppState']>,
    abortController: new AbortController(),
  } as unknown as ToolUseContext
}

function makeSafetyTool(classifierApprovable: boolean): Tool {
  return {
    name: 'Write',
    inputSchema: z.object({
      file_path: z.string(),
      content: z.string().optional(),
    }),
    checkPermissions: async () => ({
      behavior: 'ask' as const,
      message: 'sensitive path',
      decisionReason: {
        type: 'safetyCheck' as const,
        reason: 'test safety',
        classifierApprovable,
      },
    }),
  } as unknown as Tool
}

const dummyMsg = {} as AssistantMessage

describe('bypassPermissions + safetyCheck (densable 2.1.218)', () => {
  test('allows classifierApprovable safetyCheck under bypassPermissions', async () => {
    const result = await hasPermissionsToUseTool(
      makeSafetyTool(true),
      { file_path: '.claude/workflow-runs/from-cli.md', content: 'x' },
      makeContext('bypassPermissions'),
      dummyMsg,
      'tu_1',
    )
    expect(result.behavior).toBe('allow')
  })

  test('still asks for non-classifierApprovable safetyCheck under bypassPermissions', async () => {
    const result = await hasPermissionsToUseTool(
      makeSafetyTool(false),
      { file_path: 'file.txt::$DATA', content: 'x' },
      makeContext('bypassPermissions'),
      dummyMsg,
      'tu_2',
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.decisionReason?.type).toBe('safetyCheck')
    }
  })

  test('default mode still asks for classifierApprovable safetyCheck', async () => {
    const result = await hasPermissionsToUseTool(
      makeSafetyTool(true),
      { file_path: '.claude/workflow-runs/from-cli.md', content: 'x' },
      makeContext('default'),
      dummyMsg,
      'tu_3',
    )
    expect(result.behavior).toBe('ask')
  })

  test('plan with listable bypass still asks (does not inherit 2a)', async () => {
    const result = await hasPermissionsToUseTool(
      makeSafetyTool(true),
      { file_path: 'src/a.ts', content: 'x' },
      makeContext('plan'),
      dummyMsg,
      'tu_plan',
    )
    expect(result.behavior).toBe('ask')
  })

  test('plan entered from bypassPermissions still allows classifierApprovable', async () => {
    const result = await hasPermissionsToUseTool(
      makeSafetyTool(true),
      { file_path: '.claude/workflow-runs/from-cli.md', content: 'x' },
      makeContext('plan', { prePlanMode: 'bypassPermissions' }),
      dummyMsg,
      'tu_plan_bypass',
    )
    expect(result.behavior).toBe('allow')
  })
})
