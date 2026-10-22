/**
 * densable 2.1.289 WKe / qOt / sjn / ijn — confirmWithUser primitive.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  getAllowedChannels,
  getIsInteractive,
  getPermissionPromptToolName,
  setAllowedChannels,
  setIsInteractive,
  setPermissionPromptToolName,
} from '../../../bootstrap/state.js'
import {
  canConfirmWithUser,
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

const prevInteractive = getIsInteractive()
const prevChannels = getAllowedChannels()
const prevPromptTool = getPermissionPromptToolName()

afterEach(() => {
  setIsInteractive(prevInteractive)
  setAllowedChannels(prevChannels)
  setPermissionPromptToolName(prevPromptTool)
})

function confirmCtx(
  mode: 'default' | 'dontAsk' | 'auto' = 'default',
  shouldAvoidPermissionPrompts = false,
) {
  return {
    getAppState: () => ({
      toolPermissionContext: { mode, shouldAvoidPermissionPrompts },
    }),
  } as never
}

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

  test('cJ: interactive allows; channels do not refuse interactive', () => {
    setIsInteractive(true)
    setAllowedChannels([])
    setPermissionPromptToolName(undefined)
    expect(canConfirmWithUser(confirmCtx())).toBe(true)
    setAllowedChannels([{ kind: 'server', name: 'dev' }])
    expect(canConfirmWithUser(confirmCtx())).toBe(true)
  })

  test('cJ: headless without a prompt tool refuses; a named tool allows', () => {
    setIsInteractive(false)
    setAllowedChannels([])
    setPermissionPromptToolName(undefined)
    expect(canConfirmWithUser(confirmCtx())).toBe(false)
    setPermissionPromptToolName('none')
    expect(canConfirmWithUser(confirmCtx())).toBe(false)
    setPermissionPromptToolName('AskUserQuestion')
    expect(canConfirmWithUser(confirmCtx())).toBe(true)
  })

  test('cJ: headless with channels refuses even with a prompt tool', () => {
    setIsInteractive(false)
    setAllowedChannels([{ kind: 'server', name: 'dev' }])
    setPermissionPromptToolName('AskUserQuestion')
    expect(canConfirmWithUser(confirmCtx())).toBe(false)
  })

  test('qOt: dontAsk and shouldAvoid still refuse when someone could answer', () => {
    setIsInteractive(true)
    setAllowedChannels([])
    setPermissionPromptToolName(undefined)
    expect(canConfirmWithUser(confirmCtx('dontAsk'))).toBe(false)
    expect(canConfirmWithUser(confirmCtx('default', true))).toBe(false)
  })
})
