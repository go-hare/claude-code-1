import { describe, expect, test } from 'bun:test'
import {
  buildUserDialogBlockedSummary,
  buildUserDialogRequiresActionDetails,
  DEFAULT_DIALOG_ACTION_DESCRIPTIONS,
  deriveParkedPermission,
  MAX_DECLARED_DIALOG_KINDS,
  planParkedPermissionResume,
  sanitizeDeclaredDialogKinds,
  waitForParkedPermissionAnswer,
} from '../userDialog.js'

describe('userDialog densables', () => {
  test('sanitizeDeclaredDialogKinds filters and caps', () => {
    expect(sanitizeDeclaredDialogKinds(null)).toEqual([])
    expect(
      sanitizeDeclaredDialogKinds([
        'refusal_fallback_prompt',
        '',
        12,
        'x'.repeat(65),
        'ok',
      ]),
    ).toEqual(['refusal_fallback_prompt', 'ok'])
    const many = Array.from({ length: 40 }, (_, i) => `k${i}`)
    expect(sanitizeDeclaredDialogKinds(many)).toHaveLength(
      MAX_DECLARED_DIALOG_KINDS,
    )
  })

  test('buildUserDialogRequiresActionDetails uses KDy copy', () => {
    const d = buildUserDialogRequiresActionDetails(
      'refusal_fallback_prompt',
      { model: 'fallback' },
      'req-1',
      'tu-1',
    )
    expect(d.tool_name).toBe('dialog:refusal_fallback_prompt')
    expect(d.display_tool_name).toBe('Claude needs your input')
    expect(d.action_description).toBe(
      DEFAULT_DIALOG_ACTION_DESCRIPTIONS.refusal_fallback_prompt,
    )
    expect(d.request_id).toBe('req-1')
    expect(d.tool_use_id).toBe('tu-1')
    expect(d.input).toEqual({
      dialog_kind: 'refusal_fallback_prompt',
      payload: { model: 'fallback' },
    })
  })

  test('buildUserDialogRequiresActionDetails fallback copy for unknown kind', () => {
    const d = buildUserDialogRequiresActionDetails('custom_kind', {}, 'r')
    expect(d.action_description).toBe(
      'Respond to the custom_kind dialog to continue',
    )
    expect(d.tool_use_id).toBe('')
  })

  test('deriveParkedPermission densable gates', () => {
    expect(
      deriveParkedPermission({
        resumeInterruptedTurn: false,
        pendingAction: {
          tool_name: 'Bash',
          action_description: 'x',
          tool_use_id: 't1',
          request_id: 'r1',
        },
        restoreKind: 'worker',
        knownToolUseIds: new Set(['t1']),
      }),
    ).toBeUndefined()

    expect(
      deriveParkedPermission({
        resumeInterruptedTurn: true,
        pendingAction: {
          tool_name: 'dialog:refusal_fallback_prompt',
          action_description: 'x',
          tool_use_id: 't1',
          request_id: 'r1',
        },
        restoreKind: 'worker',
        knownToolUseIds: new Set(['t1']),
      }),
    ).toBeUndefined()

    expect(
      deriveParkedPermission({
        resumeInterruptedTurn: true,
        pendingAction: {
          tool_name: 'Bash',
          action_description: 'x',
          tool_use_id: 't1',
          request_id: 'r1',
        },
        restoreKind: 'none',
      }),
    ).toBeUndefined()

    expect(
      deriveParkedPermission({
        resumeInterruptedTurn: true,
        pendingAction: {
          tool_name: 'Bash',
          action_description: 'x',
          tool_use_id: 't1',
          request_id: 'r1',
        },
        restoreKind: 'worker',
        knownToolUseIds: new Set(['other']),
      }),
    ).toBeUndefined()

    expect(
      deriveParkedPermission({
        resumeInterruptedTurn: true,
        pendingAction: {
          tool_name: 'Bash',
          action_description: 'x',
          tool_use_id: 't1',
          request_id: 'r1',
        },
        restoreKind: 'worker',
        knownToolUseIds: new Set(['t1']),
      }),
    ).toEqual({ request_id: 'r1', tool_use_id: 't1' })
  })

  test('buildUserDialogBlockedSummary dialog vs permission', () => {
    expect(
      buildUserDialogBlockedSummary({
        tool_name: 'dialog:refusal_fallback_prompt',
        action_description: 'choose',
        tool_use_id: '',
        request_id: 'r',
      }),
    ).toEqual({
      status_category: 'blocked',
      status_detail: 'Waiting on a user dialog',
      needs_action: 'choose',
    })
    expect(
      buildUserDialogBlockedSummary({
        tool_name: 'Bash',
        action_description: 'run',
        tool_use_id: 't',
        request_id: 'r',
      }),
    ).toEqual({
      status_category: 'blocked',
      status_detail: 'Waiting on permission: Bash',
      needs_action: 'Approve or deny Bash',
    })
  })

  test('planParkedPermissionResume densable', () => {
    expect(
      planParkedPermissionResume({
        resumeInterruptedTurn: false,
        pendingAction: {
          tool_name: 'Bash',
          action_description: 'x',
          tool_use_id: 't1',
          request_id: 'r1',
        },
        restoreKind: 'worker',
      }),
    ).toEqual({ wait: false, reason: 'no_parked_permission' })

    const plan = planParkedPermissionResume({
      resumeInterruptedTurn: true,
      pendingAction: {
        tool_name: 'Bash',
        action_description: 'x',
        tool_use_id: 't1',
        request_id: 'r1',
      },
      restoreKind: 'worker',
      env: { CLAUDE_CODE_PARKED_PERMISSION_WAIT_MS: '1500' },
    })
    expect(plan).toMatchObject({
      wait: true,
      parked: { request_id: 'r1', tool_use_id: 't1' },
      waitMs: 1500,
    })
  })

  test('waitForParkedPermissionAnswer densable', async () => {
    const fast = await waitForParkedPermissionAnswer({
      waitMs: 50,
      answer: Promise.resolve('ok'),
      sleep: async () => {
        await new Promise(r => setTimeout(r, 200))
      },
    })
    expect(fast).toBe('ok')

    const timedOut = await waitForParkedPermissionAnswer({
      waitMs: 20,
      answer: new Promise(() => {}),
      sleep: async ms => {
        await new Promise(r => setTimeout(r, ms))
      },
    })
    expect(timedOut).toBeNull()
  })
})
