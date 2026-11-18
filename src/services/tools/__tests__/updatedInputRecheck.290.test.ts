import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  buildTool,
  getEmptyToolPermissionContext,
  type Tool,
} from 'src/Tool.js'
import { resolveHookPermissionDecision } from '../toolHooks.js'
import { checkRuleBasedPermissions } from 'src/utils/permissions/permissions.js'

function makeDummyContext() {
  return {
    abortController: new AbortController(),
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
    options: {
      isNonInteractiveSession: true,
      tools: [],
      mainLoopModel: 'claude-sonnet-4-6',
    },
  } as never
}

describe('updatedInput full re-check 2.1.290 #116', () => {
  test('checkRuleBasedPermissions with crashIsObjection invokes permissionCheckFailureDecision on error', async () => {
    const tool = buildTool({
      name: 'TestTool',
      inputSchema: z.strictObject({ safe: z.string() }),
      async call() {
        return { data: {} }
      },
      async checkPermissions(input: Record<string, unknown>) {
        return { behavior: 'allow', updatedInput: input }
      },
      permissionCheckFailureDecision() {
        return {
          behavior: 'deny',
          message: 'Blocked by permissionCheckFailureDecision',
          decisionReason: {
            type: 'safetyCheck',
            reason: 'disallowed extra key',
            classifierApprovable: false,
          },
        }
      },
    } as never) as unknown as Tool

    const res = await checkRuleBasedPermissions(
      tool,
      { safe: 'ok', extra: 1 },
      makeDummyContext(),
      { crashIsObjection: true },
    )
    expect(res?.behavior).toBe('deny')
    expect(res?.message).toBe('Blocked by permissionCheckFailureDecision')
  })

  test('resolveHookPermissionDecision fails closed to ask when checkPermissions throws on updatedInput', async () => {
    const tool = buildTool({
      name: 'CrashingTool',
      inputSchema: z.object({ cmd: z.string() }),
      async call() {
        return { data: {} }
      },
      async checkPermissions() {
        throw new Error('boom during checkPermissions')
      },
    } as never) as unknown as Tool

    let canUseToolCalled = false
    const res = await resolveHookPermissionDecision(
      {
        behavior: 'allow',
        updatedInput: { cmd: 'rm -rf /' },
        decisionReason: { type: 'hook', hookName: 'PermissionRequest' },
      },
      tool,
      { cmd: 'ls' },
      makeDummyContext(),
      async () => {
        canUseToolCalled = true
        return {
          behavior: 'deny',
          message: 'Prompted and denied',
          decisionReason: { type: 'other', reason: 'user' },
        }
      },
      { message: { id: 'm1' } } as never,
      'tu_1',
    )

    expect(canUseToolCalled).toBe(true)
    expect(res.decision.behavior).toBe('deny')
    expect(res.input).toEqual({ cmd: 'rm -rf /' })
  })
})
