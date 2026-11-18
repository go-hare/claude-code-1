import { describe, expect, test } from 'bun:test'
import { formatHookCompletionDebugLog } from '../../hooks.js'
import { computeOwedSessionStartPlugins } from '../../sessionStart.js'

describe('Hooks & SessionStart v2.1.296 alignment (#505, #520, #542)', () => {
  test('#542: formatHookCompletionDebugLog includes hookName, command, pluginId, outcome, and durationMs', () => {
    expect(
      formatHookCompletionDebugLog({
        hookName: 'PreToolUse:Bash',
        command: 'echo hi',
        pluginId: 'my-plugin@mkt',
        result: { status: 0 },
        timeoutMs: 5000,
        durationMs: 42,
        parentAborted: false,
      }),
    ).toBe(
      'Hooks: PreToolUse:Bash [echo hi] (plugin my-plugin@mkt) finished with status 0 (42ms)',
    )

    expect(
      formatHookCompletionDebugLog({
        hookName: 'Stop',
        command: 'check.sh',
        result: { aborted: true, status: 1 },
        timeoutMs: 3000,
        durationMs: 3001,
        parentAborted: false,
      }),
    ).toBe('Hooks: Stop [check.sh] timed out after 3000ms (3001ms)')

    expect(
      formatHookCompletionDebugLog({
        hookName: 'SessionStart',
        command: 'init.sh',
        result: { aborted: true, status: 1 },
        timeoutMs: 3000,
        durationMs: 15,
        parentAborted: true,
      }),
    ).toBe('Hooks: SessionStart [init.sh] cancelled (15ms)')

    expect(
      formatHookCompletionDebugLog({
        hookName: 'UserPromptSubmit',
        command: 'bg.sh',
        result: { backgrounded: true, status: 0 },
        timeoutMs: 3000,
        durationMs: 5,
        parentAborted: false,
      }),
    ).toBe('Hooks: UserPromptSubmit [bg.sh] moved to the background (5ms)')
  })

  test('#505: computeOwedSessionStartPlugins tracks by pluginId and does not skip different plugins with same name', () => {
    const state = {
      pluginsCovered: new Map<string, string>([['demo@mkt-a', 'demo']]),
      pluginsSucceeded: new Set<string>(['demo@mkt-a']),
    }
    const result = computeOwedSessionStartPlugins(
      state,
      [
        { pluginId: 'demo@mkt-a', pluginName: 'demo' },
        { pluginId: 'demo@mkt-b', pluginName: 'demo' },
        { pluginId: 'other@mkt-b', pluginName: 'Other' },
      ],
      new Set(['demo@mkt-a', 'demo@mkt-b', 'other@mkt-b']),
    )
    expect(result.owed).toEqual([
      { pluginId: 'demo@mkt-b', pluginName: 'demo' },
      { pluginId: 'other@mkt-b', pluginName: 'Other' },
    ])
  })

  test('#505: computeOwedSessionStartPlugins allows inline stand-in only when prior plugin is inactive and not succeeded', () => {
    const state = {
      pluginsCovered: new Map<string, string>([['demo', 'demo']]),
      pluginsSucceeded: new Set<string>(),
    }
    const result = computeOwedSessionStartPlugins(
      state,
      [{ pluginId: 'demo@mkt-a', pluginName: 'demo' }],
      new Set(['demo@mkt-a']),
    )
    expect(result.owed).toEqual([])
    expect(result.stoodFor.get('demo@mkt-a')).toBe('demo')
  })
})
