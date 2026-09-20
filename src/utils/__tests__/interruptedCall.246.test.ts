/**
 * densable 2.1.246 #12 — Nvo / qn.interruptedCall + collapse cut mark.
 *
 * Nvo(e): user + tool_result is_error + (toolUseResult===foe || aTe prefix)
 * aTe=[eW,kw,Q0,p_]  foe="User rejected tool use"
 * V6: fe && <FallbackToolUseRejectedMessage />; "shell command(s)"
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CANCEL_MESSAGE,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_PLUGIN_TOOL_USE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  USER_REJECTED_TOOL_USE,
  interruptedCall,
} from '../messages.js'

const collapseSrc = readFileSync(
  join(
    import.meta.dir,
    '../../components/messages/CollapsedReadSearchContent.tsx',
  ),
  'utf8',
)

function userToolResult(
  content: unknown,
  opts?: { is_error?: boolean; toolUseResult?: unknown },
) {
  return {
    type: 'user' as const,
    message: {
      content: [
        {
          type: 'tool_result' as const,
          is_error: opts?.is_error ?? true,
          content,
        },
      ],
    },
    toolUseResult: opts?.toolUseResult,
  }
}

describe('densable 2.1.246 #12 interruptedCall (Nvo)', () => {
  test('foe toolUseResult is interrupted even without aTe content', () => {
    expect(
      interruptedCall(
        userToolResult('ok', {
          is_error: true,
          toolUseResult: USER_REJECTED_TOOL_USE,
        }),
      ),
    ).toBe(true)
  })

  test('aTe prefixes on is_error tool_result', () => {
    expect(interruptedCall(userToolResult(INTERRUPT_MESSAGE))).toBe(true)
    expect(
      interruptedCall(userToolResult(INTERRUPT_MESSAGE_FOR_TOOL_USE)),
    ).toBe(true)
    expect(
      interruptedCall(userToolResult(INTERRUPT_MESSAGE_FOR_PLUGIN_TOOL_USE)),
    ).toBe(true)
    expect(interruptedCall(userToolResult(CANCEL_MESSAGE))).toBe(true)
    expect(
      interruptedCall(
        userToolResult(`${INTERRUPT_MESSAGE_FOR_TOOL_USE} extra`),
      ),
    ).toBe(true)
  })

  test('non-interrupt or non-error tool_result is false', () => {
    expect(interruptedCall(undefined)).toBe(false)
    expect(interruptedCall({ type: 'assistant' })).toBe(false)
    expect(
      interruptedCall(userToolResult(INTERRUPT_MESSAGE, { is_error: false })),
    ).toBe(false)
    expect(interruptedCall(userToolResult('command finished'))).toBe(false)
  })

  test('mid-run shell abort: toolUseResult.interrupted or abort error tag', () => {
    expect(
      interruptedCall(
        userToolResult('partial stdout', {
          is_error: true,
          toolUseResult: { stdout: 'partial stdout', interrupted: true },
        }),
      ),
    ).toBe(true)
    expect(
      interruptedCall(
        userToolResult(
          'partial\n<error>Command was aborted before completion</error>',
        ),
      ),
    ).toBe(true)
    expect(
      interruptedCall(
        userToolResult('exit 1', {
          is_error: true,
          toolUseResult: { stdout: '', interrupted: false },
        }),
      ),
    ).toBe(false)
  })

  test('collapse uses shell command wording + rejected fallback when fe', () => {
    expect(collapseSrc).toContain('shell {bashCount === 1 ? ')
    expect(collapseSrc).not.toContain('bash {bashCount === 1 ? ')
    expect(collapseSrc).toContain(
      'interruptedCall(lookups.toolResultByToolUseID.get(id))',
    )
    expect(collapseSrc).toContain(
      '{anyInterrupted && <FallbackToolUseRejectedMessage />}',
    )
  })
})
