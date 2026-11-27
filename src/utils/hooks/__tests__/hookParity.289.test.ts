import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hookJSONOutputSchema } from '../../../types/hooks.js'
import {
  parseAllowedTerminalSequence,
  parseTerminalSequenceTokens,
} from '../terminalSequence.js'
import {
  clipHookField,
  snapshotStopBackgroundTasks,
} from '../stopHookPayload.js'
import {
  managedPassInputMatches,
  shouldPreserveManagedToolHookPass,
} from '../toolCallManagedPass.js'

describe('hook JSON output schema vs densable 2.1.289 PQ', () => {
  test('accepts Stop additionalContext', () => {
    const parsed = hookJSONOutputSchema().safeParse({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: 'please continue',
      },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success || !('hookSpecificOutput' in parsed.data)) return
    const out = parsed.data.hookSpecificOutput
    expect(out?.hookEventName).toBe('Stop')
    if (out?.hookEventName === 'Stop') {
      expect(out.additionalContext).toBe('please continue')
    }
  })

  test('accepts PreModelSwitch permissionDecision', () => {
    const parsed = hookJSONOutputSchema().safeParse({
      hookSpecificOutput: {
        hookEventName: 'PreModelSwitch',
        permissionDecision: 'deny',
        permissionDecisionReason: 'stay on current model',
      },
    })
    expect(parsed.success).toBe(true)
  })

  test('accepts PostModelSwitch additionalContext', () => {
    const parsed = hookJSONOutputSchema().safeParse({
      hookSpecificOutput: {
        hookEventName: 'PostModelSwitch',
        additionalContext: 'switched',
      },
    })
    expect(parsed.success).toBe(true)
  })

  test('accepts MessageDisplay displayContent', () => {
    const parsed = hookJSONOutputSchema().safeParse({
      hookSpecificOutput: {
        hookEventName: 'MessageDisplay',
        displayContent: 'rewritten',
      },
    })
    expect(parsed.success).toBe(true)
  })

  test('accepts terminalSequence OSC 9', () => {
    const parsed = hookJSONOutputSchema().safeParse({
      terminalSequence: '\x1b]9;hello\x07',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success || !('terminalSequence' in parsed.data)) return
    expect(parsed.data.terminalSequence).toBe('\x1b]9;hello\x07')
  })
})

describe('densable hxe terminalSequence allowlist', () => {
  test('rewrites OSC 9 with BEL', () => {
    const allowed = parseAllowedTerminalSequence('\x1b]9;desk-ping\x07')
    expect(allowed).toBe('\x1b]9;desk-ping\x07')
  })

  test('rejects OSC 9 digit-leading payload', () => {
    expect(parseAllowedTerminalSequence('\x1b]9;9notprogress\x07')).toBeNull()
  })

  test('allows OSC 9;4 progress form', () => {
    expect(parseAllowedTerminalSequence('\x1b]9;4;1;50\x07')).toBe(
      '\x1b]9;4;1;50\x07',
    )
  })

  test('rejects OSC 8', () => {
    expect(parseAllowedTerminalSequence('\x1b]8;;https://x\x07')).toBeNull()
  })

  test('parses concatenated BEL', () => {
    expect(parseTerminalSequenceTokens('\x07')).toEqual([{ kind: 'bel' }])
  })
})

describe('listed-event producer defaults vs densable 2.1.289', () => {
  test('UserPromptSubmit uses HFe 30s timeout', () => {
    const src = [
      '../../hooks.ts',
      '../hookCore.ts',
      '../hookShellRunner.ts',
      '../hookOutputProcessor.ts',
      '../hookConfigRegistry.ts',
      '../hookModelSlotPool.ts',
      '../hookEngine.ts',
      '../hookEntryExecutor.ts',
      '../hookOutsideReplEngine.ts',
      '../hookToolEvents.ts',
      '../hookSessionAndPromptEvents.ts',
      '../hookLifecycleEvents.ts',
    ]
      .map(rel => readFileSync(new URL(rel, import.meta.url), 'utf8'))
      .join('\n')
    expect(src).toContain('USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS = 30_000')
    expect(src).toContain('timeoutMs: USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS')
  })

  test('SessionEnd default timeout is _go not 10 minutes', () => {
    const src = [
      '../../hooks.ts',
      '../hookCore.ts',
      '../hookShellRunner.ts',
      '../hookOutputProcessor.ts',
      '../hookConfigRegistry.ts',
      '../hookModelSlotPool.ts',
      '../hookEngine.ts',
      '../hookEntryExecutor.ts',
      '../hookOutsideReplEngine.ts',
      '../hookToolEvents.ts',
      '../hookSessionAndPromptEvents.ts',
      '../hookLifecycleEvents.ts',
    ]
      .map(rel => readFileSync(new URL(rel, import.meta.url), 'utf8'))
      .join('\n')
    expect(src).toMatch(
      /executeSessionEndHooks[\s\S]*timeoutMs = getSessionEndHookTimeoutMs\(\)/,
    )
  })

  test('StopFailure returns when settingsHooksOff', () => {
    const src = [
      '../../hooks.ts',
      '../hookCore.ts',
      '../hookShellRunner.ts',
      '../hookOutputProcessor.ts',
      '../hookConfigRegistry.ts',
      '../hookModelSlotPool.ts',
      '../hookEngine.ts',
      '../hookEntryExecutor.ts',
      '../hookOutsideReplEngine.ts',
      '../hookToolEvents.ts',
      '../hookSessionAndPromptEvents.ts',
      '../hookLifecycleEvents.ts',
    ]
      .map(rel => readFileSync(new URL(rel, import.meta.url), 'utf8'))
      .join('\n')
    expect(src).toContain(
      'if (toolUseContext?.options.settingsHooksOff === true)',
    )
  })

  test('Nx skips EndConversation, bareFork, settingsHooksOff', () => {
    const src = [
      '../../hooks.ts',
      '../hookCore.ts',
      '../hookShellRunner.ts',
      '../hookOutputProcessor.ts',
      '../hookConfigRegistry.ts',
      '../hookModelSlotPool.ts',
      '../hookEngine.ts',
      '../hookEntryExecutor.ts',
      '../hookOutsideReplEngine.ts',
      '../hookToolEvents.ts',
      '../hookSessionAndPromptEvents.ts',
      '../hookLifecycleEvents.ts',
    ]
      .map(rel => readFileSync(new URL(rel, import.meta.url), 'utf8'))
      .join('\n')
    expect(src).toContain('function shouldSkipJsonToolHooks(')
    expect(src).toContain('context.options.bareFork === true')
    expect(src).toContain('END_CONVERSATION_TOOL_NAME')
    expect(src).toContain('shouldSkipJsonToolHooks(toolName, toolUseContext)')
  })

  test('PreToolUse JSON stdin does not include tool alias field', () => {
    const src = [
      '../../hooks.ts',
      '../hookCore.ts',
      '../hookShellRunner.ts',
      '../hookOutputProcessor.ts',
      '../hookConfigRegistry.ts',
      '../hookModelSlotPool.ts',
      '../hookEngine.ts',
      '../hookEntryExecutor.ts',
      '../hookOutsideReplEngine.ts',
      '../hookToolEvents.ts',
      '../hookSessionAndPromptEvents.ts',
      '../hookLifecycleEvents.ts',
    ]
      .map(rel => readFileSync(new URL(rel, import.meta.url), 'utf8'))
      .join('\n')
    expect(src).toContain("hook_event_name: 'PreToolUse' as const")
    expect(src).not.toMatch(
      /hook_event_name: 'PreToolUse' as const,\s*tool_name: toolName,\s*\.\.\.getToolHookMcpMetadata\([^)]+\),\s*tool: toolName/,
    )
    expect(src).toContain('eventRecord.tool = hookInput.tool_name')
  })
})

describe('densable nd clip', () => {
  test('appends leftover marker past 1000 chars', () => {
    const raw = 'a'.repeat(1005)
    expect(clipHookField(raw)).toBe(`${'a'.repeat(1000)}… [+5 chars]`)
  })
})

describe('densable T2t Stop background_tasks fields', () => {
  test('monitor_mcp copies r.server and r.tool', () => {
    const rows = snapshotStopBackgroundTasks({
      a: {
        id: 'a',
        type: 'monitor_mcp',
        status: 'running',
        description: 'watch',
        server: 'docs',
        tool: 'search',
        serverName: 'docs',
        resourceUri: 'ui://x',
      } as never,
    })
    expect(rows[0]).toMatchObject({
      server: 'docs',
      tool: 'search',
    })
  })

  test('mcp_task copies serverName/toolName onto server/tool', () => {
    const rows = snapshotStopBackgroundTasks({
      b: {
        id: 'b',
        type: 'mcp_task',
        status: 'running',
        description: 'task',
        serverName: 'mcp-a',
        toolName: 'do_it',
      } as never,
    })
    expect(rows[0]).toMatchObject({
      type: 'MCP task',
      server: 'mcp-a',
      tool: 'do_it',
    })
  })
})

describe('densable I$ / ylt', () => {
  test('I$ is true without agentId', () => {
    expect(shouldPreserveManagedToolHookPass({ agentId: undefined }, {})).toBe(
      true,
    )
  })

  test('I$ is true for subagent when preserveToolUseResults', () => {
    expect(
      shouldPreserveManagedToolHookPass(
        { agentId: 'a1', preserveToolUseResults: true },
        {},
      ),
    ).toBe(true)
  })

  test('I$ is true for subagent when tool.preserveToolUseResultInSubagents', () => {
    expect(
      shouldPreserveManagedToolHookPass(
        { agentId: 'a1' },
        { preserveToolUseResultInSubagents: true },
      ),
    ).toBe(true)
  })

  test('I$ is false for subagent without preserve flags', () => {
    expect(shouldPreserveManagedToolHookPass({ agentId: 'a1' }, {})).toBe(false)
  })

  test('ylt matches shallow enumerable fields', () => {
    const stored = { a: 1, b: 'x' }
    expect(managedPassInputMatches(stored, { a: 1, b: 'x' }, () => 'pin')).toBe(
      true,
    )
    expect(
      managedPassInputMatches(stored, { a: 1, b: 'y' }, () => 'other'),
    ).toBe(false)
  })
})

describe('gold AVt / EVt / rd hosts', () => {
  test('VA skips function-hook chain when managedHooksOnly', () => {
    const src = [
      '../../hooks.ts',
      '../hookCore.ts',
      '../hookShellRunner.ts',
      '../hookOutputProcessor.ts',
      '../hookConfigRegistry.ts',
      '../hookModelSlotPool.ts',
      '../hookEngine.ts',
      '../hookEntryExecutor.ts',
      '../hookOutsideReplEngine.ts',
      '../hookToolEvents.ts',
      '../hookSessionAndPromptEvents.ts',
      '../hookLifecycleEvents.ts',
    ]
      .map(rel => readFileSync(new URL(rel, import.meta.url), 'utf8'))
      .join('\n')
    expect(src).toMatch(
      /!classicChainMember &&\s*!managedHooksOnly &&\s*!shouldDisableAllHooksIncludingManaged\(\)/,
    )
    expect(src).toMatch(
      /!classicChainMember &&\s*!managedHooksOnly &&\s*!shouldDisableAllHooksIncludingManaged\(\) &&\s*!sessionFunctionHooksOnly/,
    )
  })

  test('AVt wrap sits on dispatchCheckPermissionsAndCallTool', () => {
    const execDir = fileURLToPath(
      new URL('../../../services/tools/execution', import.meta.url),
    )
    const src = [
      readFileSync(
        new URL('../../../services/tools/toolExecution.ts', import.meta.url),
        'utf8',
      ),
      ...readdirSync(execDir)
        .filter(f => f.endsWith('.ts'))
        .sort()
        .map(f => readFileSync(join(execDir, f), 'utf8')),
    ].join('\n')
    expect(src).toContain('drainManagedPreToolUse')
    expect(src).toContain('managedPass')
    expect(src).toContain('collectManagedOnlyPostToolUse')
    expect(src).toContain('shouldPreserveManagedToolHookPass')
  })

  test('PostToolUse passes managedHooksExcluded from managedPass and I$', () => {
    const src = readFileSync(
      new URL('../../../services/tools/toolHooks.ts', import.meta.url),
      'utf8',
    )
    expect(src).toContain('managedHooksExcluded:')
    expect(src).toContain('toolUseContext.managedPass?.toolUseId === toolUseID')
    expect(src).toContain('preserveToolUseResultInSubagents')
  })

  test('EVt catch rethrows after matchers load and uses tengu_feature_bad', () => {
    const src = [
      '../../hooks.ts',
      '../hookCore.ts',
      '../hookShellRunner.ts',
      '../hookOutputProcessor.ts',
      '../hookConfigRegistry.ts',
      '../hookModelSlotPool.ts',
      '../hookEngine.ts',
      '../hookEntryExecutor.ts',
      '../hookOutsideReplEngine.ts',
      '../hookToolEvents.ts',
      '../hookSessionAndPromptEvents.ts',
      '../hookLifecycleEvents.ts',
    ]
      .map(rel => readFileSync(new URL(rel, import.meta.url), 'utf8'))
      .join('\n')
    expect(src).toContain('if (loadedMatcherCount > 0)')
    expect(src).toContain('error_code:')
    expect(src).toContain("'hook_match_failed'")
    expect(src).toContain('tengu_feature_bad')
    expect(src).toContain('hookTelemetryFeatureName')
  })

  test('rd scratchpad join failure omits the field', () => {
    const src = [
      '../../hooks.ts',
      '../hookCore.ts',
      '../hookShellRunner.ts',
      '../hookOutputProcessor.ts',
      '../hookConfigRegistry.ts',
      '../hookModelSlotPool.ts',
      '../hookEngine.ts',
      '../hookEntryExecutor.ts',
      '../hookOutsideReplEngine.ts',
      '../hookToolEvents.ts',
      '../hookSessionAndPromptEvents.ts',
      '../hookLifecycleEvents.ts',
    ]
      .map(rel => readFileSync(new URL(rel, import.meta.url), 'utf8'))
      .join('\n')
    expect(src).toContain('function resolveScratchpadDirField')
    expect(src).toContain('catch {')
    expect(src).toContain('permissionLayers')
    expect(src).toContain("applied === undefined ? 'high'")
    expect(src).toContain('pdSessionEffort')
  })
})
