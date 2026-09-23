/**
 * densable 2.1.251 #55 — malformed tool_use retry in query.ts.
 * CAt / bjn are local ports. x0e → executeStopFailureHooks.
 * qo → createAssistantAPIErrorMessage. Gold OS (Jh markApiFailure)
 * has no local tracker.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAssistantMessage } from '../../utils/messages.js'
import {
  MALFORMED_TOOL_USE_EXHAUSTED_TEXT,
  MALFORMED_TOOL_USE_RETRY_PROMPT,
  assistantTextHasLeakedInvoke,
  malformedToolUseRetryAction,
} from '../../query.js'

const querySrc = readFileSync(join(import.meta.dir, '../../query.ts'), 'utf8')

const NEIGHBOR =
  'Your tool call was malformed and could not be parsed. Please retry.'

describe('densable 2.1.251 #55 malformed tool-use retry', () => {
  test('first tool_use with zero parsed tools retries with Blt', () => {
    const action = malformedToolUseRetryAction({
      stopReason: 'tool_use',
      parsedToolUseCount: 0,
      isApiErrorMessage: false,
      previousReason: undefined,
    })
    expect(action).toEqual({
      action: 'retry',
      prompt: MALFORMED_TOOL_USE_RETRY_PROMPT,
    })
    expect(MALFORMED_TOOL_USE_RETRY_PROMPT).toBe(
      'The previous response failed to produce a valid tool call. Please retry the tool call now.',
    )
  })

  test('a second failure is exhausted', () => {
    const action = malformedToolUseRetryAction({
      stopReason: 'tool_use',
      parsedToolUseCount: 0,
      isApiErrorMessage: false,
      previousReason: 'malformed_tool_use_retry',
    })
    expect(action).toEqual({
      action: 'exhausted',
      text: MALFORMED_TOOL_USE_EXHAUSTED_TEXT,
    })
    expect(MALFORMED_TOOL_USE_EXHAUSTED_TEXT).toBe(
      "The model's tool call could not be parsed (retry also failed).",
    )
  })

  test('parsed tools, other stop reasons, and API errors do not retry', () => {
    expect(
      malformedToolUseRetryAction({
        stopReason: 'tool_use',
        parsedToolUseCount: 1,
        isApiErrorMessage: false,
        previousReason: undefined,
      }).action,
    ).toBe('continue')
    expect(
      malformedToolUseRetryAction({
        stopReason: 'end_turn',
        parsedToolUseCount: 0,
        isApiErrorMessage: false,
        previousReason: undefined,
      }).action,
    ).toBe('continue')
    expect(
      malformedToolUseRetryAction({
        stopReason: 'tool_use',
        parsedToolUseCount: 0,
        isApiErrorMessage: true,
        previousReason: undefined,
      }).action,
    ).toBe('continue')
  })

  test('CAt is last assistant text vs leaked-invoke regex', () => {
    expect(assistantTextHasLeakedInvoke([])).toBe(false)
    expect(
      assistantTextHasLeakedInvoke([
        createAssistantMessage({ content: 'plain text' }),
      ]),
    ).toBe(false)
    expect(
      assistantTextHasLeakedInvoke([
        createAssistantMessage({
          content: 'hello <antml:invoke name="x">',
        }),
      ]),
    ).toBe(true)
    expect(
      assistantTextHasLeakedInvoke([
        createAssistantMessage({
          content: '<antml:invoke foo',
        }),
        createAssistantMessage({ content: 'later visible text' }),
      ]),
    ).toBe(false)
  })

  test('query.ts tombstones, continues with prior messages, and does not use the neighbor prompt', () => {
    expect(querySrc).not.toContain(NEIGHBOR)
    const at = querySrc.indexOf("malformedToolUse.action === 'retry'")
    expect(at).toBeGreaterThan(0)
    const retry = querySrc.slice(at, at + 1200)
    expect(retry.toLowerCase()).not.toContain('bedrock')
    expect(retry.toLowerCase()).not.toContain('vertex')
    expect(retry.toLowerCase()).not.toContain('foundry')
    expect(retry).toContain("type: 'tombstone'")
    expect(retry).toContain('messages: [...messagesForQuery, retryMessage]')
    expect(retry).toContain("reason: 'malformed_tool_use_retry'")
    expect(retry).toContain('isMeta: true')
    expect(retry).toContain('text_has_leaked_invoke: leakedInvoke')
    const exhausted = querySrc.indexOf(
      "malformedToolUse.action === 'exhausted'",
    )
    expect(exhausted).toBeGreaterThan(at)
    const tail = querySrc.slice(exhausted, exhausted + 900)
    expect(tail).toContain("reason: 'malformed_tool_use_exhausted'")
    expect(tail).toContain('createAssistantAPIErrorMessage')
    expect(tail).toContain('executeStopFailureHooks')
    expect(tail).not.toContain('tombstone')
    expect(tail.toLowerCase()).not.toContain('markapifailure')
  })
})
