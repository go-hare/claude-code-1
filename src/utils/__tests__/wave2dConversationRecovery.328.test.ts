import { describe, expect, test } from 'bun:test'
import {
  classifyApiErrorYieldKind,
  classifyTurnTailWithApiErrors,
  collectTrailingUnresolvedToolUseIds,
  deserializeMessagesWithInterruptDetection,
  shouldRefuseResumeForLaterCommand,
  synthesizeCutOffToolResults,
} from '../conversationRecovery.js'
import type { Message, NormalizedMessage } from '../../types/message.js'

function makeUserPrompt(uuid: string, text: string, ts?: string): Message {
  return {
    type: 'user',
    uuid,
    timestamp: ts ?? new Date().toISOString(),
    message: { role: 'user', content: text },
  } as unknown as Message
}

function makeApiErrorAssistant(opts: {
  uuid: string
  error?: string
  apiError?: string
  apiErrorCode?: string
  apiErrorStatus?: number
  stopReason?: string | null
  failedResponseHadNoToolCall?: boolean
  ts?: string
}): Message {
  return {
    type: 'assistant',
    uuid: opts.uuid,
    timestamp: opts.ts ?? new Date().toISOString(),
    isApiErrorMessage: true,
    error: opts.error,
    apiError: opts.apiError,
    apiErrorCode: opts.apiErrorCode,
    apiErrorStatus: opts.apiErrorStatus,
    failedResponseHadNoToolCall: opts.failedResponseHadNoToolCall,
    message: {
      id: `msg_${opts.uuid}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'API error' }],
      stop_reason: opts.stopReason ?? 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  } as unknown as Message
}

function makeAssistantToolUse(uuid: string, toolUseId: string): Message {
  return {
    type: 'assistant',
    uuid,
    timestamp: new Date().toISOString(),
    message: {
      id: `msg_${uuid}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'Bash',
          input: { command: 'ls' },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  } as unknown as Message
}

describe('Wave 2D conversationRecovery #1645 & #1646', () => {
  test('classifyApiErrorYieldKind maps ccs_no_request_token, rate_limit, model_not_found, 5xx, and other', () => {
    expect(
      classifyApiErrorYieldKind({ apiErrorCode: 'ccs_no_request_token' }),
    ).toBe('no_request_token')
    expect(classifyApiErrorYieldKind({ error: 'rate_limit' })).toBe(
      'rate_limit',
    )
    expect(classifyApiErrorYieldKind({ error: 'model_not_found' })).toBe(
      'model_not_found',
    )
    expect(classifyApiErrorYieldKind({ apiErrorStatus: 503 })).toBe(
      'server_error',
    )
    expect(
      classifyApiErrorYieldKind({ failedResponseHadNoToolCall: true }),
    ).toBe('other')
    expect(classifyApiErrorYieldKind({ apiErrorStatus: 400 })).toBeUndefined()
  })

  test('#1645: endedOnApiError is populated when turn ends on steppable API error after user prompt', () => {
    const msgs = [
      makeUserPrompt('u-1', 'run tests'),
      makeApiErrorAssistant({
        uuid: 'a-err-1',
        error: 'rate_limit',
        apiErrorStatus: 429,
      }),
    ]
    const res = deserializeMessagesWithInterruptDetection(msgs)
    expect(res.turnInterruptionState.kind).toBe('interrupted_prompt')
    if (res.turnInterruptionState.kind === 'interrupted_prompt') {
      expect(res.turnInterruptionState.endedOnApiError).toBe('rate_limit')
      expect(res.turnInterruptionState.endedOnApiErrorPastCalls).toBeUndefined()
    }
  })

  test('#1646: endedOnApiErrorPastCalls is populated when turn ends on failedResponseHadNoToolCall past open tool calls', () => {
    const msgs = [
      makeUserPrompt('u-1', 'do work'),
      makeAssistantToolUse('a-1', 'tu_open_1'),
      makeApiErrorAssistant({
        uuid: 'a-err-2',
        apiErrorStatus: 413,
        failedResponseHadNoToolCall: true,
      }),
    ]
    const res = deserializeMessagesWithInterruptDetection(msgs)
    expect(res.turnInterruptionState.kind).toBe('interrupted_prompt')
    if (res.turnInterruptionState.kind === 'interrupted_prompt') {
      expect(res.turnInterruptionState.endedOnApiError).toBeUndefined()
      expect(res.turnInterruptionState.endedOnApiErrorPastCalls).toBe('other')
    }
  })

  test('#1645: terminal refusal/DLP API error ends turn normally, unless behindRefusal is allowed for restored card', () => {
    const refusalMsgs = [
      makeUserPrompt('u-1', 'prompt'),
      makeApiErrorAssistant({
        uuid: 'a-refusal',
        stopReason: 'refusal',
      }),
    ] as unknown as NormalizedMessage[]

    const normal = classifyTurnTailWithApiErrors(refusalMsgs, false, false)
    expect(normal.state.kind).toBe('none')

    const restoredCard = classifyTurnTailWithApiErrors(refusalMsgs, true, true)
    expect(restoredCard.state.kind).toBe('interrupted_turn')
    if (restoredCard.state.kind === 'interrupted_turn') {
      expect(restoredCard.state.behindRefusal).toBe(true)
    }
  })

  test('#1645: shouldRefuseResumeForLaterCommand suppresses resume when a later system command sits at tail', () => {
    const msgs: Message[] = [
      makeUserPrompt('u-1', 'first'),
      makeApiErrorAssistant({ uuid: 'a-err', apiErrorStatus: 500 }),
      {
        type: 'system',
        subtype: 'local_command',
        uuid: 'sys-1',
        timestamp: new Date().toISOString(),
        submitUuid: 'sub-2',
        content: '/clear',
      } as unknown as Message,
    ]
    expect(
      shouldRefuseResumeForLaterCommand({
        messages: msgs,
        endedOnApiError: 'server_error',
        resumeInterruptedTurn: true,
        hasPreservedOrRestoredCalls: false,
        flagEnabled: true,
      }),
    ).toBe(true)

    expect(
      shouldRefuseResumeForLaterCommand({
        messages: msgs,
        endedOnApiError: 'server_error',
        resumeInterruptedTurn: true,
        hasPreservedOrRestoredCalls: false,
        flagEnabled: false,
      }),
    ).toBe(false)
  })

  test('#1646: collectTrailingUnresolvedToolUseIds (gje) and synthesizeCutOffToolResults (hje)', () => {
    const msgs = [
      makeUserPrompt('u-1', 'work'),
      makeAssistantToolUse('a-1', 'tu_1'),
    ]
    const trailing = collectTrailingUnresolvedToolUseIds(
      msgs,
      new Set(['tu_1']),
      true,
    )
    expect([...trailing]).toEqual(['tu_1'])

    const synthesized = synthesizeCutOffToolResults(
      msgs,
      undefined,
      trailing,
      trailing,
      '[Tool call interrupted]',
      true,
    )
    const lastRow = synthesized.at(-1) as Message & {
      toolDenialKind?: string
      toolDenialEndsTurn?: boolean
    }
    expect(lastRow.type).toBe('user')
    expect(lastRow.toolDenialKind).toBe('interrupted')
    expect(lastRow.toolDenialEndsTurn).toBe(true)
  })
})
