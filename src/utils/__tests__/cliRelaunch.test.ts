import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  acceptTuiRelaunch,
  applyTuiRelaunchPlanToProcessEnv,
  buildRelaunchProcessEnv,
  buildTuiRelaunchEnv,
  buildTuiRelaunchPlan,
  flushStreamsBeforeRelaunchExit,
  isTuiRelaunchSpawnEnabled,
  mergeRelaunchModelArgs,
  RELAUNCH_ALWAYS_DROP_ENV,
  resolveRelaunchCliArgs,
  resolveRelaunchModelArg,
  TUI_RELAUNCH_DROP_ENV,
} from '../cliRelaunch.js'

describe('cliRelaunch densables', () => {
  test('buildTuiRelaunchEnv injects TUI_JUST_SWITCHED + screen reader', () => {
    expect(
      buildTuiRelaunchEnv('fullscreen', { CLAUDE_AX_SCREEN_READER: '1' }),
    ).toEqual({
      CLAUDE_CODE_TUI_JUST_SWITCHED: 'fullscreen',
      CLAUDE_AX_SCREEN_READER: '1',
    })
    expect(buildTuiRelaunchEnv('default', {})).toEqual({
      CLAUDE_CODE_TUI_JUST_SWITCHED: 'default',
    })
  })

  test('resolveRelaunchCliArgs fresh vs resume', () => {
    expect(
      resolveRelaunchCliArgs({
        freshIfNoTranscript: true,
        hasNonEmptyTranscript: false,
        extraArgs: ['--verbose'],
      }),
    ).toEqual(['--verbose'])
    expect(
      resolveRelaunchCliArgs({
        freshIfNoTranscript: true,
        hasNonEmptyTranscript: true,
        sessionId: 'sid',
        extraArgs: ['--verbose'],
      }),
    ).toEqual(['--resume', 'sid', '--verbose'])
    expect(
      resolveRelaunchCliArgs({
        args: ['--help'],
        sessionId: 'sid',
      }),
    ).toEqual(['--help'])
  })

  test('buildRelaunchProcessEnv drops always + dropEnv and injects', () => {
    const env = buildRelaunchProcessEnv({
      processEnv: {
        KEEP: '1',
        CLAUDE_CODE_TUI_JUST_SWITCHED: 'old',
        CLAUDE_CODE_NO_FLICKER: '1',
        CLAUDE_BRIDGE_REATTACH_SESSION: 'x',
      },
      injectEnv: { CLAUDE_CODE_TUI_JUST_SWITCHED: 'fullscreen' },
      dropEnv: ['CLAUDE_CODE_NO_FLICKER'],
    })
    expect(env.KEEP).toBe('1')
    expect(env.CLAUDE_CODE_TUI_JUST_SWITCHED).toBe('fullscreen')
    expect(env.CLAUDE_CODE_NO_FLICKER).toBeUndefined()
    expect(env.CLAUDE_BRIDGE_REATTACH_SESSION).toBeUndefined()
    expect(RELAUNCH_ALWAYS_DROP_ENV).toContain('CLAUDE_CODE_TUI_JUST_SWITCHED')
    expect(TUI_RELAUNCH_DROP_ENV).toContain('CLAUDE_CODE_NO_FLICKER')
  })

  test('buildTuiRelaunchPlan composes OLt densable', () => {
    const plan = buildTuiRelaunchPlan({
      target: 'fullscreen',
      sessionId: 'sid',
      hasNonEmptyTranscript: true,
      screenReaderEnv: {},
      // Pre-seed --model so Bxa merge is a no-op (stable vs process override).
      extraArgs: ['--model', 'claude-sonnet-4-6'],
      terminalSize: { columns: 120, rows: 40 },
    })
    expect(plan.args).toEqual([
      '--resume',
      'sid',
      '--model',
      'claude-sonnet-4-6',
    ])
    expect(plan.injectEnv.CLAUDE_CODE_TUI_JUST_SWITCHED).toBe('fullscreen')
    expect(plan.injectEnv.CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE).toBe('120x40')
    expect(plan.env.CLAUDE_CODE_NO_FLICKER).toBeUndefined()
    expect(plan.env.CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL).toBeUndefined()
  })

  test('resolveRelaunchModelArg densable Bxa cases', () => {
    expect(
      resolveRelaunchModelArg({
        getOverride: () => undefined,
        getProvider: () => 'firstParty',
      }),
    ).toBeUndefined()
    expect(
      resolveRelaunchModelArg({
        getOverride: () => 'claude-opus-4-7',
        getProvider: () => 'mantle',
      }),
    ).toBeUndefined()
    expect(
      resolveRelaunchModelArg({
        getOverride: () => null,
        getProvider: () => 'firstParty',
      }),
    ).toBe('default')
    expect(
      resolveRelaunchModelArg({
        getOverride: () => '',
        getProvider: () => 'firstParty',
      }),
    ).toBeUndefined()
    expect(
      resolveRelaunchModelArg({
        getOverride: () => 'claude-opus-4-7',
        getProvider: () => 'firstParty',
        parseModel: m => m,
        isDeprecatedResolved: () => true,
      }),
    ).toBeUndefined()
    expect(
      resolveRelaunchModelArg({
        getOverride: () => 'fallback-model',
        getProvider: () => 'firstParty',
        parseModel: m => m,
        isDeprecatedResolved: () => false,
        getLatchFallbackModel: () => 'fallback-model',
      }),
    ).toBeUndefined()
    expect(
      resolveRelaunchModelArg({
        getOverride: () => 'claude-opus-4-7',
        getProvider: () => 'firstParty',
        parseModel: m => m,
        isDeprecatedResolved: () => false,
        getLatchFallbackModel: () => undefined,
      }),
    ).toBe('claude-opus-4-7')
  })

  test('mergeRelaunchModelArgs appends --model when absent', () => {
    expect(mergeRelaunchModelArgs([], 'claude-opus-4-7')).toEqual([
      '--model',
      'claude-opus-4-7',
    ])
    expect(
      mergeRelaunchModelArgs(['--verbose', '--model', 'keep'], 'new'),
    ).toEqual(['--verbose', '--model', 'keep'])
    expect(mergeRelaunchModelArgs(['--verbose'], undefined)).toEqual([
      '--verbose',
    ])
  })

  test('acceptTuiRelaunch inject_only densable', () => {
    expect(isTuiRelaunchSpawnEnabled({})).toBe(false)
    expect(
      isTuiRelaunchSpawnEnabled({ CLAUDE_CODE_SPAWN_TUI_RELAUNCH: '1' }),
    ).toBe(true)
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_NO_FLICKER: '1',
      CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL: '1',
    }
    const result = acceptTuiRelaunch({
      target: 'fullscreen',
      hasNonEmptyTranscript: false,
      screenReaderEnv: {},
      env,
      spawn: false,
    })
    expect(result.mode).toBe('inject_only')
    expect(env.CLAUDE_CODE_TUI_JUST_SWITCHED).toBe('fullscreen')
    expect(env.CLAUDE_CODE_NO_FLICKER).toBeUndefined()
    expect(env.CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL).toBeUndefined()

    const plan = buildTuiRelaunchPlan({
      target: 'default',
      hasNonEmptyTranscript: false,
      screenReaderEnv: {},
    })
    const env2: NodeJS.ProcessEnv = {}
    applyTuiRelaunchPlanToProcessEnv(plan, env2)
    expect(env2.CLAUDE_CODE_TUI_JUST_SWITCHED).toBe('default')
  })

  test('acceptTuiRelaunch defaults to oyt spawn unless spawn:false', () => {
    const src = readFileSync(join(import.meta.dir, '../cliRelaunch.ts'), 'utf8')
    const accept = src.slice(src.indexOf('export function acceptTuiRelaunch'))
    expect(accept).toContain('input.spawn === false')
    expect(accept).not.toContain('isTuiRelaunchSpawnEnabled')
    expect(src).toContain('spawnCliRelaunch({')
  })

  test('flushStreamsBeforeRelaunchExit densable', () => {
    let writes = 0
    flushStreamsBeforeRelaunchExit({
      stdout: {
        write: (_c, cb) => {
          writes++
          cb?.(null)
          return true
        },
      },
      stderr: {
        write: (_c, cb) => {
          writes++
          cb?.(null)
          return true
        },
      },
    })
    expect(writes).toBe(2)
  })
})
