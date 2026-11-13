import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import type { Tool } from '../../../Tool.js'
import { remapPostToolOutput } from '../postToolOutput.js'
import { hookJSONOutputSchema } from '../../../types/hooks.js'
import {
  capHostClassifierContext,
  resolveHostClassifierContext,
} from '../../../utils/permissions/hostClassifierContext.js'
import {
  PreToolUseHookInputSchema,
  PostToolUseHookInputSchema,
  PostToolUseFailureHookInputSchema,
  PermissionRequestHookInputSchema,
  PermissionDeniedHookInputSchema,
} from '../../../entrypoints/sdk/coreSchemas.js'

const original = { text: 'original' }
const tool = {
  name: 'Fixture',
  outputSchema: z.object({ text: z.string() }),
  mapToolResultToToolResultBlockParam: (
    output: typeof original,
    id: string,
  ) => ({
    type: 'tool_result',
    tool_use_id: id,
    content: output.text,
  }),
} as unknown as Tool<any, typeof original>

describe('PostToolUse output rewriting', () => {
  test('remaps valid builtin output through the actual tool mapper', () => {
    expect(
      remapPostToolOutput(
        tool,
        original,
        { text: 'redacted' },
        'call',
        () => {},
      ),
    ).toEqual({
      output: { text: 'redacted' },
      block: { type: 'tool_result', tool_use_id: 'call', content: 'redacted' },
    })
  })

  test('rejects an invalid builtin shape and retains original output', () => {
    const result = remapPostToolOutput(
      tool,
      original,
      { text: 2 } as any,
      'call',
      () => {},
    )
    expect(result.output).toBe(original)
    expect(result.error).toContain('Invalid input')
    expect(result.block).toBeUndefined()
  })

  test('mapper throw and undefined both retain original output with diagnostics', () => {
    for (const mapper of [
      () => {
        throw new Error('mapping failed')
      },
      () => undefined,
    ]) {
      const result = remapPostToolOutput(
        { ...tool, mapToolResultToToolResultBlockParam: mapper } as any,
        original,
        { text: 'rewrite' },
        'call',
        () => {},
      )
      expect(result.output).toBe(original)
      expect(result.error).toBeTruthy()
    }
  })

  test('transient remap restoration does not replace persisted rewritten data', () => {
    const rewritten = { text: 'rewrite' }
    const result = remapPostToolOutput(
      { ...tool, restoreTransientForRemap: () => ({ text: 'transient' }) },
      original,
      rewritten,
      'call',
      () => {},
    )
    expect(result.output).toBe(rewritten)
    expect(result.block?.content).toBe('transient')
  })

  test('generic schema preserves falsey rewrites', () => {
    for (const updatedToolOutput of [null, false, 0, '']) {
      const parsed = hookJSONOutputSchema().parse({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput,
          classifierContext: 'assertion',
        },
      })
      expect((parsed as any).hookSpecificOutput.updatedToolOutput).toBe(
        updatedToolOutput,
      )
    }
  })
})

describe('host classifier rewrite integrity', () => {
  const contexts = [
    { value: 'original', hostPrincipal: true, pairedRewriteSeq: 0 },
    { value: 'first rewrite', hostPrincipal: true, pairedRewriteSeq: 1 },
    { value: 'second rewrite', hostPrincipal: true, pairedRewriteSeq: 2 },
    { value: 'independent', hostPrincipal: false },
    { value: 'suppressed', hostPrincipal: true, pairedRewriteSeq: -1 },
  ]

  test('only final applied rewrite and independent assertions survive', () => {
    expect(resolveHostClassifierContext(contexts, 2, false)).toEqual({
      value: 'second rewrite\nindependent',
      hostPrincipal: false,
    })
  })

  test('rejected rewrites restore original assertion and drop all rewrite assertions', () => {
    expect(resolveHostClassifierContext(contexts, 2, true)).toEqual({
      value: 'original\nindependent',
      hostPrincipal: false,
    })
  })

  test('shared join budget and astral characters count UTF-16 units', () => {
    const astral = String.fromCodePoint(0x1f430)
    expect(capHostClassifierContext('x'.repeat(1999) + astral)).toBe(
      'x'.repeat(1999),
    )
    expect(
      capHostClassifierContext('x'.repeat(1998) + astral + '!'),
    ).toHaveLength(2000)
    expect(
      resolveHostClassifierContext(
        [
          { value: 'x'.repeat(1500), hostPrincipal: true },
          { value: 'y'.repeat(1500), hostPrincipal: true },
        ],
        0,
        false,
      ).value,
    ).toHaveLength(2000)
  })
})

describe('tool hook SDK input schemas', () => {
  test('five events retain MCP metadata and two post events retain duration', () => {
    for (const [event, schema] of [
      ['PreToolUse', PreToolUseHookInputSchema],
      ['PostToolUse', PostToolUseHookInputSchema],
      ['PostToolUseFailure', PostToolUseFailureHookInputSchema],
      ['PermissionRequest', PermissionRequestHookInputSchema],
      ['PermissionDenied', PermissionDeniedHookInputSchema],
    ] as const) {
      const parsed = schema().parse({
        session_id: 'session',
        transcript_path: '/tmp/transcript',
        cwd: '/tmp',
        hook_event_name: event,
        tool_name: 'Fixture',
        tool_input: {},
        tool_use_id: 'call',
        tool_response: {},
        error: 'failed',
        reason: 'denied',
        mcp_server: { name: 'server', source: 'sdk' },
        duration_ms: 42,
      })
      expect(parsed.mcp_server).toEqual({ name: 'server', source: 'sdk' })
      if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
        expect((parsed as any).duration_ms).toBe(42)
      }
    }
  })
})
