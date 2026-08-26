import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hookJSONOutputSchema } from '../../../types/hooks.js'
import { findUnresolvedDeferredToolUse } from '../../../utils/queryHelpers.js'
import {
  extractTraceparentContext,
  withOtelContext,
} from '../../../utils/telemetry/sessionTracing.js'
import type { Message } from '../../../types/message.js'

const HOOKS = readFileSync(
  join(import.meta.dir, '../../../utils/hooks.ts'),
  'utf8',
)
const TOOL_HOOKS = readFileSync(
  join(import.meta.dir, '../toolHooks.ts'),
  'utf8',
)
const TOOL_EXEC = readFileSync(
  join(import.meta.dir, '../toolExecution.ts'),
  'utf8',
)
const QUERY = readFileSync(join(import.meta.dir, '../../../query.ts'), 'utf8')
const QUERY_ENGINE = readFileSync(
  join(import.meta.dir, '../../../QueryEngine.ts'),
  'utf8',
)
const PRINT = readFileSync(
  join(import.meta.dir, '../../../cli/print.ts'),
  'utf8',
)
const SPAN = readFileSync(
  join(import.meta.dir, '../../../utils/telemetry/sessionTracing.ts'),
  'utf8',
)

function deferredAttachment(id = 'tu_1'): Message {
  return {
    type: 'attachment',
    uuid: 'att-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    attachment: {
      type: 'hook_deferred_tool',
      toolUseID: id,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      hookName: 'defer.sh',
      hookEvent: 'PreToolUse',
      permissionMode: 'default',
      traceparent: '00-aaa-bbb-01',
    },
  } as unknown as Message
}

describe('densable 2.1.239 #28 PreToolUse defer + same-trace resume', () => {
  test('Zod accepts official permissionDecision=defer', () => {
    const parsed = hookJSONOutputSchema().safeParse({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
      },
    })
    expect(parsed.success).toBe(true)
  })

  test('parse error string includes defer (official first switch)', () => {
    expect(HOOKS).toContain('Valid types are: allow, deny, ask, defer')
    expect(HOOKS).toContain("result.permissionBehavior = 'defer'")
  })

  test('Y reduce is deny > defer > ask > allow', () => {
    expect(HOOKS).toContain('deny > defer > ask > allow')
    expect(HOOKS).toContain("if (permissionBehavior !== 'deny')")
    expect(HOOKS).toContain("permissionBehavior !== 'defer'")
    expect(HOOKS).toContain('permissionBehavior === result.permissionBehavior')
  })

  test('toolHooks latches official c until stream ends and !u', () => {
    expect(TOOL_HOOKS).toContain('Official `c`')
    expect(TOOL_HOOKS).toContain('Official `u`')
    expect(TOOL_HOOKS).toContain('result.hookSource ||')
    expect(TOOL_HOOKS).toContain('PreToolUse:')
    expect(TOOL_HOOKS).toContain(
      'if (deferredHookName && !deniedPermissionResult)',
    )
  })

  test('toolExecution: interactive ignore, solo-only, emit hook_deferred_tool', () => {
    expect(TOOL_EXEC).toContain('permissionDecision=defer in interactive mode')
    expect(TOOL_EXEC).toContain('defer is solo-only')
    expect(TOOL_EXEC).toContain('tengu_pre_tool_hook_deferred')
    expect(TOOL_EXEC).toContain("type: 'hook_deferred_tool'")
    expect(TOOL_EXEC).toContain('injectCurrentTraceparent()')
  })

  test('query stops the turn on hook_deferred_tool', () => {
    expect(QUERY).toContain("attachment!.type === 'hook_deferred_tool'")
    expect(QUERY).toContain('toolWasDeferred = true')
    expect(QUERY).toContain("reason: 'tool_deferred'")
    const deferred = QUERY.indexOf('if (toolWasDeferred)')
    const hookStopped = QUERY.indexOf("return { reason: 'hook_stopped' }")
    expect(deferred).toBeGreaterThan(0)
    expect(hookStopped).toBeGreaterThan(deferred)
  })

  test('startToolSpan prefers active OTel parent (official xne / Qrp)', () => {
    expect(SPAN).toContain('trace.getSpan(otelContext.active())')
    expect(SPAN).toContain('injectCurrentTraceparent')
    expect(SPAN).toContain('extractTraceparentContext')
    expect(SPAN).toContain('withOtelContext')
  })

  test('QueryEngine JNs resume + SDK deferred_tool_use', () => {
    expect(QUERY_ENGINE).toContain('handleDeferredToolUse(')
    expect(QUERY_ENGINE).toContain('stop_reason: unavailable')
    expect(QUERY_ENGINE).toContain('deferred_tool_use:')
    expect(QUERY_ENGINE).toContain("'tool_deferred'")
    expect(QUERY_ENGINE).toContain("'tool_deferred_unavailable'")
  })

  test('print empty/whitespace gate is official !sdkUrl && !Q && !U', () => {
    expect(PRINT).toContain('!isUsingSdkUrl &&')
    expect(PRINT).toContain('!hasDeferredToolUse &&')
    expect(PRINT).toContain('!hookInitialUserMessage')
    expect(PRINT).toContain(
      'No deferred tool marker found in the resumed session',
    )
    expect(PRINT).toContain('hasResumeOrContinue')
    expect(PRINT).not.toContain('hasValidResumeSessionId')
    expect(PRINT).not.toContain(
      'findUnresolvedDeferredToolUse(initialMessages)',
    )
  })

  test('QueryEngine JNs uses constructor deferredToolUse not message scan', () => {
    expect(QUERY_ENGINE).toContain('deferredToolUse: configDeferredToolUse')
    expect(QUERY_ENGINE).toContain('this.hasHandledDeferredToolUse')
    expect(QUERY_ENGINE).toContain(
      'let deferredThisTurn: HookDeferredToolAttachment | undefined',
    )
    expect(QUERY_ENGINE).toContain("attachment.type === 'hook_deferred_tool'")
    expect(QUERY_ENGINE).toContain('const deferredAtEnd = deferredThisTurn')
    expect(QUERY_ENGINE).not.toContain(
      'findUnresolvedDeferredToolUse(this.mutableMessages)',
    )
  })

  test('findUnresolvedDeferredToolUse skips resolved tool_use', () => {
    const open = [deferredAttachment('tu_open')]
    expect(findUnresolvedDeferredToolUse(open)?.toolUseID).toBe('tu_open')

    const closed: Message[] = [
      deferredAttachment('tu_done'),
      {
        type: 'user',
        uuid: 'u-1',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_done', content: 'ok' },
          ],
        },
      } as unknown as Message,
    ]
    expect(findUnresolvedDeferredToolUse(closed)).toBeUndefined()
  })

  test('Zrp/Qrp: missing traceparent is a no-op', () => {
    expect(extractTraceparentContext(undefined)).toBeUndefined()
    expect(extractTraceparentContext('')).toBeUndefined()
    expect(withOtelContext(undefined, () => 7)).toBe(7)
  })
})
