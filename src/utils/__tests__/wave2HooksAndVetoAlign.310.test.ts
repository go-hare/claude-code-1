import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SYNC_REUSE_WITHIN_MS,
  resolveSyncReuseWithinMs,
} from '../accountSkillsSyncVeto.js'
import {
  extractBashLikeInputFromMonitor,
  getHookFamilyNames,
  getMatchingHooks,
  getMonitorBashStandIn,
  getMonitorCommand,
  remapHookInputForMatchedHook,
  remapHookInputForMonitorAsBash,
} from '../hooks.js'
import type { HookInput } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from '../../state/AppStateStore.js'

describe('#1296 accountSkillsSyncVeto exports resolveSyncReuseWithinMs', () => {
  test('re-exports DEFAULT_SYNC_REUSE_WITHIN_MS and resolveSyncReuseWithinMs', () => {
    expect(DEFAULT_SYNC_REUSE_WITHIN_MS).toBe(600_000)
    expect(resolveSyncReuseWithinMs({})).toBeUndefined()
    expect(
      resolveSyncReuseWithinMs({ CLAUDE_CODE_SYNC_REUSE_WITHIN_MS: '0' }),
    ).toBeUndefined()
    expect(
      resolveSyncReuseWithinMs({ CLAUDE_CODE_SYNC_REUSE_WITHIN_MS: '45000' }),
    ).toBe(45000)
  })
})

describe('#1386 Monitor running Bash PreToolUse hooks (rG/OJn/qwo/MJn/PI)', () => {
  test('getMonitorCommand / extractBashLikeInputFromMonitor / getMonitorBashStandIn', () => {
    expect(getMonitorCommand({ command: 'tail -f log' })).toBe('tail -f log')
    expect(getMonitorCommand({ command: '' })).toBeUndefined()
    expect(getMonitorCommand(null)).toBeUndefined()

    expect(
      extractBashLikeInputFromMonitor({
        command: 'echo hi',
        description: 'desc',
        persistent: true,
      }),
    ).toEqual({ command: 'echo hi', description: 'desc' })

    expect(getMonitorBashStandIn('Monitor', { command: 'echo hi' })).toBe(
      'Bash',
    )
    expect(getMonitorBashStandIn('Monitor', {})).toBeUndefined()
    expect(
      getMonitorBashStandIn('Read', { command: 'echo hi' }),
    ).toBeUndefined()
  })

  test('getHookFamilyNames and remapHookInputForMonitorAsBash / remapHookInputForMatchedHook', () => {
    expect(getHookFamilyNames('Monitor', { command: 'ls' })).toContain('Bash')
    const input = {
      session_id: 's1',
      transcript_path: '/tmp/t',
      cwd: '/tmp',
      hook_event_name: 'PreToolUse' as const,
      tool_name: 'Monitor',
      tool_input: { command: 'ls -la', description: 'list', timeout_ms: 5000 },
      tool_use_id: 'tu-1',
    } as HookInput

    const remapped = remapHookInputForMonitorAsBash(input)
    expect(remapped).toBeDefined()
    expect((remapped as { tool_name: string }).tool_name).toBe('Bash')
    expect((remapped as { tool_input: unknown }).tool_input).toEqual({
      command: 'ls -la',
      description: 'list',
    })

    const pi = remapHookInputForMatchedHook(
      { throughFamilyOnly: true, matcherMetThroughOtherName: 'Bash' },
      input,
    )
    expect((pi as { tool_name: string }).tool_name).toBe('Bash')
    expect((pi as { tool_input: unknown }).tool_input).toEqual({
      command: 'ls -la',
      description: 'list',
    })
  })

  test('getMatchingHooks matches Bash PreToolUse hooks for Monitor and skips if:Monitor when met through Bash', async () => {
    const appState = {
      sessionHooks: new Map([
        [
          's1',
          {
            hooks: {
              PreToolUse: [
                {
                  matcher: 'Bash',
                  hooks: [
                    { hook: { type: 'command', command: 'echo bash-hook' } },
                  ],
                },
                {
                  matcher: 'Bash',
                  hooks: [
                    {
                      hook: {
                        type: 'command',
                        command: 'echo skip-me',
                        if: 'Monitor',
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      ]),
    } as unknown as AppState

    const hookInput = {
      session_id: 's1',
      transcript_path: '/tmp/t',
      cwd: '/tmp',
      hook_event_name: 'PreToolUse' as const,
      tool_name: 'Monitor',
      tool_input: { command: 'tail -f x.log' },
      tool_use_id: 'tu-2',
    } as HookInput

    const matched = await getMatchingHooks(
      appState,
      's1',
      'PreToolUse',
      hookInput,
    )
    expect(matched).toHaveLength(1)
    expect((matched[0]!.hook as { command: string }).command).toBe(
      'echo bash-hook',
    )
    expect(matched[0]!.throughFamilyOnly).toBe(true)
    expect(matched[0]!.matcherMetThroughOtherName).toBe('Bash')
  })
})
