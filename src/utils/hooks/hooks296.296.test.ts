import { describe, expect, test } from 'bun:test'
import { HookCommandSchema } from '../../schemas/hooks.js'
import {
  extractAsyncHookSyncResponse,
  hasUnparsedAsyncHookJsonLine,
} from './AsyncHookRegistry.js'

describe('Hooks v2.1.295 alignment (#343, #420)', () => {
  test('#343: command and http hook schemas accept onFailure: "block" | "continue"', () => {
    const schema = HookCommandSchema()
    const cmdBlock = schema.safeParse({
      type: 'command',
      command: 'echo ok',
      onFailure: 'block',
    })
    expect(cmdBlock.success).toBe(true)

    const httpContinue = schema.safeParse({
      type: 'http',
      url: 'https://example.com/hook',
      onFailure: 'continue',
    })
    expect(httpContinue.success).toBe(true)

    const invalid = schema.safeParse({
      type: 'command',
      command: 'echo ok',
      onFailure: 'ignore',
    })
    expect(invalid.success).toBe(false)
  })

  test('#420: extractAsyncHookSyncResponse parses multiline JSON output', () => {
    const stdout = `{
  "continue": false,
  "stopReason": "multiline response"
}`
    const parsed = extractAsyncHookSyncResponse(stdout)
    expect(parsed).toEqual({
      continue: false,
      stopReason: 'multiline response',
    })
  })

  test('#420: extractAsyncHookSyncResponse parses multiline JSON after initial {"async":true} line', () => {
    const stdout = `{"async": true}
{
  "systemMessage": "done",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "hello"
  }
}`
    const parsed = extractAsyncHookSyncResponse(stdout)
    expect(parsed).toEqual({
      systemMessage: 'done',
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'hello',
      },
    })
  })

  test('#420: extractAsyncHookSyncResponse still handles single-line JSON with leading log lines', () => {
    const stdout = `debug line 1\n{"async": true}\n{"systemMessage": "single line"}\n`
    const parsed = extractAsyncHookSyncResponse(stdout)
    expect(parsed).toEqual({ systemMessage: 'single line' })
  })

  test('#420: hasUnparsedAsyncHookJsonLine detects malformed JSON line starting with {', () => {
    expect(hasUnparsedAsyncHookJsonLine('{"async": true}\n{bad json')).toBe(
      true,
    )
    expect(hasUnparsedAsyncHookJsonLine('{"async": true}\n')).toBe(false)
  })
})
