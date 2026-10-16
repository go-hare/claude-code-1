/**
 * densable 2.1.289 WKe / qOt / sjn / ijn — confirmWithUser primitive.
 */
import { describe, expect, test } from 'bun:test'
import {
  CONFIRM_TOOL_USE_ID_PREFIX,
  isForcedAskStillPending,
} from '../confirmWithUser.js'
import {
  CAN_USE_TOOL_INVALID_RESULT_REASON,
  isNoOneToAskDenyReason,
  PERMISSION_PROMPT_TOOL_DISCONNECTED_REASON,
  TOOL_PERMISSION_REQUEST_FAILED_REASON,
  TOOL_PERMISSION_STREAM_CLOSED_REASON,
} from '../permissionDecisionReasons.js'
import type { PermissionAskDecision } from '../../../types/permissions.js'

describe('densable 2.1.289 confirmWithUser helpers', () => {
  test('Flt prefix', () => {
    expect(CONFIRM_TOOL_USE_ID_PREFIX).toBe('confirm_')
  })

  test('sjn: same object or ask+forcedByCaller is still pending', () => {
    const forced: PermissionAskDecision = {
      behavior: 'ask',
      message: 'Answer questions?',
      forcedByCaller: true,
    }
    expect(isForcedAskStillPending(forced, forced)).toBe(true)
    expect(
      isForcedAskStillPending(
        { behavior: 'ask', message: 'x', forcedByCaller: true },
        forced,
      ),
    ).toBe(true)
    expect(
      isForcedAskStillPending({ behavior: 'allow', updatedInput: {} }, forced),
    ).toBe(false)
  })

  test('ijn: canned deny reasons are no_one_to_ask', () => {
    expect(isNoOneToAskDenyReason(TOOL_PERMISSION_STREAM_CLOSED_REASON)).toBe(
      true,
    )
    expect(isNoOneToAskDenyReason(CAN_USE_TOOL_INVALID_RESULT_REASON)).toBe(
      true,
    )
    expect(isNoOneToAskDenyReason(TOOL_PERMISSION_REQUEST_FAILED_REASON)).toBe(
      true,
    )
    expect(
      isNoOneToAskDenyReason(PERMISSION_PROMPT_TOOL_DISCONNECTED_REASON),
    ).toBe(true)
    expect(
      isNoOneToAskDenyReason('localDisplayOnly ask not forwarded: sdk'),
    ).toBe(true)
    expect(isNoOneToAskDenyReason('user said no')).toBe(false)
  })
})
