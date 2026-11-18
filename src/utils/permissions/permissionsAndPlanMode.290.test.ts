import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { buildYoloRejectionMessage } from '../messages.js'
import {
  getAutoModeDenialAllowRuleToolName,
  isMcpServerPolicyAskReason,
  isPlanModeWriteFloorForMcpServerPolicy,
} from './permissions.js'
import {
  planModeOnInteractiveResume,
  preparePlanModeRestoreOnInteractiveResume,
  resetPlanModeResumeGuardForTests,
} from './planModeResume.js'
import type { ToolPermissionContext } from '../../Tool.js'

function makeCtx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

describe('#22 planModeWriteFloor for mcpServerPolicy ask rules', () => {
  const mcpTool = {
    name: 'mcp__slack__post_message',
    mcpInfo: { serverName: 'slack', toolName: 'post_message' },
    inputSchema: z.object({ channel: z.string() }),
    isReadOnly: () => false,
  }

  test('detects mcpServerPolicy ask decisionReason', () => {
    const reason = {
      type: 'rule' as const,
      rule: {
        source: 'mcpServerPolicy' as const,
        ruleBehavior: 'ask' as const,
        ruleValue: { toolName: 'mcp__slack__post_message' },
      },
    }
    expect(isMcpServerPolicyAskReason(reason)).toBe(true)
    expect(
      isPlanModeWriteFloorForMcpServerPolicy(
        reason,
        mcpTool,
        { channel: '#gen' },
        { mode: 'plan' },
      ),
    ).toBe(true)
    expect(
      isPlanModeWriteFloorForMcpServerPolicy(
        reason,
        mcpTool,
        { channel: '#gen' },
        { mode: 'auto' },
      ),
    ).toBe(false)
    expect(
      isPlanModeWriteFloorForMcpServerPolicy(
        reason,
        { ...mcpTool, isReadOnly: () => true },
        { channel: '#gen' },
        { mode: 'plan' },
      ),
    ).toBe(false)
  })
})

describe('#64 auto mode denial allowRuleToolName filtering', () => {
  test('buildYoloRejectionMessage omits rule hint when allowRuleToolName is undefined', () => {
    const msg = buildYoloRejectionMessage('unsafe action')
    expect(msg).not.toContain('add a permission rule')
    const withTool = buildYoloRejectionMessage('unsafe action', {
      allowRuleToolName: 'WebFetch',
    })
    expect(withTool).toContain(
      'To allow this type of action in the future, the user can add a permission rule for WebFetch to their settings.',
    )
  })

  test('getAutoModeDenialAllowRuleToolName suppresses classifier-skipping or ignored rules', () => {
    const baseTool = {
      name: 'WebFetch',
      requiresUserInteraction: () => false,
      suppressesAlwaysAllowRule: () => false,
      suppressesAllPermissionUpdates: () => false,
    }
    const normalResult = {
      behavior: 'ask' as const,
      message: 'ask',
      decisionReason: { type: 'other' as const, reason: 'check' },
    }
    expect(
      getAutoModeDenialAllowRuleToolName(baseTool, {}, normalResult, {
        forRemoteExecution: false,
      }),
    ).toBe('WebFetch')

    expect(
      getAutoModeDenialAllowRuleToolName(
        baseTool,
        {},
        {
          behavior: 'ask',
          message: 'ask',
          suppressAlwaysAllowRule: true,
        },
        { forRemoteExecution: false },
      ),
    ).toBeUndefined()

    expect(
      getAutoModeDenialAllowRuleToolName(
        { ...baseTool, ignoresWholeToolAllowRule: () => true },
        {},
        normalResult,
        { forRemoteExecution: false },
      ),
    ).toBeUndefined()

    expect(
      getAutoModeDenialAllowRuleToolName(
        baseTool,
        {},
        {
          behavior: 'ask',
          message: 'ask',
          decisionReason: { type: 'hook', hookName: 'PreToolUse' },
        },
        { forRemoteExecution: false },
      ),
    ).toBeUndefined()
  })
})

describe('#97 planModeOnInteractiveResume', () => {
  test('restores plan mode from storedPermissionMode="plan" when transcript not exited', () => {
    resetPlanModeResumeGuardForTests()
    const ctx = makeCtx({ mode: 'default' })
    const next = planModeOnInteractiveResume(ctx, {
      storedPermissionMode: 'plan',
      messages: [],
      forkSession: false,
      startupModePinned: false,
      lane: 'interactive',
      isGuardEnabled: () => true,
      isExitPlanModeEnabled: () => true,
      isExitPlanModeDenied: () => false,
    })
    expect(next?.mode).toBe('plan')
  })

  test('does not restore when startupModePinned or forkSession is true', async () => {
    const ctx = makeCtx({ mode: 'default' })
    expect(
      planModeOnInteractiveResume(ctx, {
        storedPermissionMode: 'plan',
        messages: [],
        forkSession: false,
        startupModePinned: true,
        lane: 'interactive',
        isGuardEnabled: () => true,
        isExitPlanModeEnabled: () => true,
        isExitPlanModeDenied: () => false,
      }),
    ).toBeUndefined()

    const apply = await preparePlanModeRestoreOnInteractiveResume({
      storedPermissionMode: 'plan',
      messages: [],
      forkSession: true,
      permissionModeSuppliedOnInvocation: false,
      lane: 'interactive_slash',
    })
    expect(apply(ctx)).toBeUndefined()
  })
})
