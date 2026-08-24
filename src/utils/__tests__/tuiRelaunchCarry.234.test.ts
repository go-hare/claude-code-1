import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { ToolPermissionContext } from '../../types/permissions.js'
import {
  buildTuiCarryPermissionArgs,
  buildTuiCarryToolRuleArgs,
  buildTuiRelaunchExtraArgs,
  canCarryPermissionRuleIntact,
  carryableAddDirPaths,
  flagArgPair,
  formatTuiUncarriableRefuseMessage,
  formatTuiUncarriableSavedMessage,
  FORK_RESTRICTED_LAUNCH_FLAGS_DESCRIPTION,
  getTuiUncarriableReasons,
  isSafeArgvValue,
  resolveRelaunchEffortArg,
  tokenizePermissionRuleArgs,
} from '../tuiRelaunchCarry.js'

function ctx(
  partial: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    ...partial,
  }
}

describe('tuiRelaunchCarry densable 2.1.234 (#21–22)', () => {
  test('EOe / isSafeArgvValue rejects flag-like and URI / NUL', () => {
    expect(isSafeArgvValue('claude-opus-4-7')).toBe(true)
    expect(isSafeArgvValue('/tmp/ok')).toBe(true)
    expect(isSafeArgvValue('--evil')).toBe(false)
    expect(isSafeArgvValue('-n')).toBe(false)
    expect(isSafeArgvValue('https://x')).toBe(false)
    expect(isSafeArgvValue('a\0b')).toBe(false)
  })

  test('SR / tokenizePermissionRuleArgs is paren-aware', () => {
    expect(tokenizePermissionRuleArgs(['Bash(npm install),Edit'])).toEqual([
      'Bash(npm install)',
      'Edit',
    ])
    expect(tokenizePermissionRuleArgs(['Bash, Edit'])).toEqual(['Bash', 'Edit'])
    expect(tokenizePermissionRuleArgs(['Bash(python -c "print(1)")'])).toEqual([
      'Bash(python -c "print(1)")',
    ])
  })

  test('eLa / canCarryPermissionRuleIntact', () => {
    expect(canCarryPermissionRuleIntact('Bash')).toBe(true)
    expect(canCarryPermissionRuleIntact('Bash(npm install)')).toBe(true)
    expect(canCarryPermissionRuleIntact('Bash,Edit')).toBe(false)
    expect(canCarryPermissionRuleIntact('--flag')).toBe(false)
  })

  test('sz / flagArgPair uses = form for unsafe values', () => {
    expect(flagArgPair('--agent', 'coder')).toEqual(['--agent', 'coder'])
    expect(flagArgPair('--agent', '--weird')).toEqual(['--agent=--weird'])
    expect(flagArgPair('--agent', undefined)).toEqual([])
  })

  test('B9p / carryableAddDirPaths filters cliArg+session', () => {
    const dirs = new Map([
      ['/a', { path: '/a', source: 'cliArg' as const }],
      ['/b', { path: '/b', source: 'session' as const }],
      ['/c', { path: '/c', source: 'userSettings' as const }],
    ])
    expect(carryableAddDirPaths(dirs)).toEqual(['/a', '/b'])
  })

  test('Cmt / buildTuiCarryPermissionArgs order + strip add-dir', () => {
    const out = buildTuiCarryPermissionArgs(
      ctx({
        mode: 'acceptEdits',
        isBypassPermissionsModeAvailable: true,
        additionalWorkingDirectories: new Map([
          ['/extra', { path: '/extra', source: 'cliArg' }],
        ]),
      }),
      undefined,
      {
        replConfigArgv: [
          '--settings',
          's.json',
          '--add-dir',
          '/old',
          '--strict-mcp-config',
        ],
        resolveModelArg: () => 'claude-opus-4-7',
        resolveEffortArg: () => undefined,
      },
    )
    expect(out).toEqual([
      '--settings',
      's.json',
      '--strict-mcp-config',
      '--allow-dangerously-skip-permissions',
      '--add-dir',
      '/extra',
      '--model',
      'claude-opus-4-7',
      '--permission-mode',
      'acceptEdits',
    ])
  })

  test('Rmt / buildTuiCarryToolRuleArgs', () => {
    const out = buildTuiCarryToolRuleArgs(
      ctx({
        alwaysAllowRules: { cliArg: ['Bash', 'Edit'] },
        alwaysDenyRules: { cliArg: ['WebFetch'] },
      }),
      {
        agent: 'explore',
        agents: '{"a":1}',
        appendSystemPrompt: 'hi',
      },
    )
    expect(out).toEqual([
      '--allowed-tools',
      'Bash',
      '--allowed-tools',
      'Edit',
      '--disallowed-tools',
      'WebFetch',
      '--agent',
      'explore',
      '--agents',
      '{"a":1}',
      '--append-system-prompt',
      'hi',
    ])
  })

  test('Cmt+Rmt compose buildTuiRelaunchExtraArgs', () => {
    const out = buildTuiRelaunchExtraArgs({
      toolPermissionContext: ctx({
        mode: 'default',
        alwaysAllowRules: { cliArg: ['Bash'] },
        isBypassPermissionsModeAvailable: false,
      }),
      effort: undefined,
      replay: { agent: 'coder' },
      replConfigArgv: [],
      resolveModelArg: () => undefined,
      resolveEffortArg: () => undefined,
    })
    expect(out).toEqual([
      '--permission-mode',
      'default',
      '--allowed-tools',
      'Bash',
      '--agent',
      'coder',
    ])
  })

  test('W4e / getTuiUncarriableReasons covers densable reasons', () => {
    expect(getTuiUncarriableReasons(ctx(), false)).toEqual([])

    expect(getTuiUncarriableReasons(ctx(), true)).toEqual([
      `launch flags: ${FORK_RESTRICTED_LAUNCH_FLAGS_DESCRIPTION}`,
    ])

    expect(
      getTuiUncarriableReasons(
        ctx({
          alwaysDenyRules: { session: ['Bash'] },
        }),
        false,
      ),
    ).toEqual(['permission rules set for this session only'])

    expect(
      getTuiUncarriableReasons(
        ctx({
          alwaysAskRules: { session: ['Edit'] },
        }),
        false,
      ),
    ).toEqual(['permission rules set for this session only'])

    expect(
      getTuiUncarriableReasons(
        ctx({
          alwaysAskRules: { cliArg: ['Bash'] },
        }),
        false,
      ),
    ).toEqual(['ask-before-running rules with no command-line form'])

    expect(
      getTuiUncarriableReasons(
        ctx({
          alwaysAllowRules: { cliArg: ['Bash,Edit'] },
        }),
        false,
      ),
    ).toEqual(['permission rules a command line cannot carry intact'])

    expect(
      getTuiUncarriableReasons(
        ctx({
          additionalWorkingDirectories: new Map([
            ['--bad', { path: '--bad', source: 'cliArg' }],
          ]),
        }),
        false,
      ),
    ).toEqual(['added directories a command line cannot carry intact'])
  })

  test('UYh / Jpc copy matches densable en-dash strings', () => {
    const refuse = formatTuiUncarriableRefuseMessage('fullscreen', [
      'permission rules set for this session only',
    ])
    expect(refuse).toContain('Cannot switch renderers in this session —')
    expect(refuse).toContain('permission rules set for this session only')
    expect(refuse).toContain('Nothing was changed')
    expect(refuse).toContain('/tui fullscreen')

    const saved = formatTuiUncarriableSavedMessage([
      `launch flags: ${FORK_RESTRICTED_LAUNCH_FLAGS_DESCRIPTION}`,
    ])
    expect(saved).toContain(
      'Staying on the default renderer without a restart —',
    )
    expect(saved).toContain('the preference is saved')
  })

  test('nMr / resolveRelaunchEffortArg needs pGo + kXs', () => {
    expect(
      resolveRelaunchEffortArg('high', {
        arePinsUnpinned: () => false,
        settingsEffortAtStartup: 'medium',
      }),
    ).toBeUndefined()
    expect(
      resolveRelaunchEffortArg('high', {
        arePinsUnpinned: () => true,
        settingsEffortAtStartup: 'medium',
        argv: ['node', 'cli'],
      }),
    ).toBe('high')
    // Same as settings and no CLI --effort → skip
    expect(
      resolveRelaunchEffortArg('high', {
        arePinsUnpinned: () => true,
        settingsEffortAtStartup: 'high',
        argv: ['node', 'cli'],
      }),
    ).toBeUndefined()
    // Same as settings but CLI --effort present → carry
    expect(
      resolveRelaunchEffortArg('high', {
        arePinsUnpinned: () => true,
        settingsEffortAtStartup: 'high',
        argv: ['node', 'cli', '--effort', 'high'],
        parseEffort: r => r,
      }),
    ).toBe('high')
  })
})
