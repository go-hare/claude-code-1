import { describe, expect, test } from 'bun:test'
import {
  describeUnparsedToolInput,
  isUnparsedToolInput,
  normalizeContentFromAPI,
  UNPARSED_TOOL_INPUT_KEY,
} from '../../utils/messages.js'
import {
  malformedToolUseRetryAction,
  MAX_MALFORMED_TOOL_USE_RETRIES,
} from '../queryHelpers.js'
import { resolveTurnStepModel } from '../turnStepHooks.js'

describe('#1097 unparsed tool input & 2x retry + #1150 turn.step alias resolution', () => {
  test('#1097 normalizeContentFromAPI marks unparseable tool_use input with __unparsedToolInput', () => {
    const normalized = normalizeContentFromAPI(
      [
        {
          type: 'tool_use',
          id: 'toolu_bad',
          name: 'Bash',
          input: '{"command": "echo hi',
        } as never,
      ],
      [],
    )

    expect(normalized.length).toBe(1)
    const block = normalized[0] as { type: string; input: unknown }
    expect(isUnparsedToolInput(block.input)).toBe(true)
    expect(describeUnparsedToolInput(block.input)).toBe(
      'input JSON failed to parse — 20 bytes',
    )
    expect(
      (block.input as Record<string, { raw: string; len: number }>)[
        UNPARSED_TOOL_INPUT_KEY
      ],
    ).toEqual({
      raw: '{"command": "echo hi',
      len: 20,
    })
  })

  test('#1097 malformedToolUseRetryAction retries up to MAX_MALFORMED_TOOL_USE_RETRIES (2) times', () => {
    expect(MAX_MALFORMED_TOOL_USE_RETRIES).toBe(2)

    expect(
      malformedToolUseRetryAction({
        stopReason: 'tool_use',
        parsedToolUseCount: 0,
        isApiErrorMessage: false,
        previousReason: undefined,
        retryCount: 0,
      }).action,
    ).toBe('retry')

    expect(
      malformedToolUseRetryAction({
        stopReason: 'tool_use',
        parsedToolUseCount: 0,
        isApiErrorMessage: false,
        previousReason: 'malformed_tool_use_retry',
        retryCount: 1,
      }).action,
    ).toBe('retry')

    expect(
      malformedToolUseRetryAction({
        stopReason: 'tool_use',
        parsedToolUseCount: 0,
        isApiErrorMessage: false,
        previousReason: 'malformed_tool_use_retry',
        retryCount: 2,
      }).action,
    ).toBe('exhausted')
  })

  test('#1150 resolveTurnStepModel resolves model alias like haiku to full model ID', () => {
    const resolved = resolveTurnStepModel('haiku', 'claude-sonnet-4-6')
    expect(resolved).not.toBe('haiku')
    expect(resolved).toContain('claude-')
  })
})
