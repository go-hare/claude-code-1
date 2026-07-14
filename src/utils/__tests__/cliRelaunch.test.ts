import { describe, expect, test } from 'bun:test'
import {
  acceptTuiRelaunch,
  applyTuiRelaunchPlanToProcessEnv,
  buildRelaunchProcessEnv,
  buildTuiRelaunchEnv,
  buildTuiRelaunchPlan,
  flushStreamsBeforeRelaunchExit,
  isTuiRelaunchSpawnEnabled,
  RELAUNCH_ALWAYS_DROP_ENV,
  resolveRelaunchCliArgs,
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
      extraArgs: [],
      terminalSize: { columns: 120, rows: 40 },
    })
    expect(plan.args).toEqual(['--resume', 'sid'])
    expect(plan.injectEnv.CLAUDE_CODE_TUI_JUST_SWITCHED).toBe('fullscreen')
    expect(plan.injectEnv.CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE).toBe('120x40')
    expect(plan.env.CLAUDE_CODE_NO_FLICKER).toBeUndefined()
    expect(plan.env.CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL).toBeUndefined()
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

  test('acceptTuiRelaunch spawn densable via injectable spawnSync path', () => {
    // spawnCliRelaunch uses real spawnSync; when spawn:true, mode is spawned
    // even if binary fails (spawn.ok may be false). Plan env still applied.
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_SPAWN_TUI_RELAUNCH: '1',
      PATH: process.env.PATH,
    }
    const result = acceptTuiRelaunch({
      target: 'fullscreen',
      hasNonEmptyTranscript: false,
      screenReaderEnv: {},
      env,
      // Force spawn path without requiring SPAWN_TUI_RELAUNCH re-read after inject
      spawn: true,
      skipFlush: true,
      cwd: process.cwd(),
    })
    expect(result.mode).toBe('spawned')
    if (result.mode === 'spawned') {
      expect(result.plan.injectEnv.CLAUDE_CODE_TUI_JUST_SWITCHED).toBe(
        'fullscreen',
      )
      expect(typeof result.spawn.ok).toBe('boolean')
    }
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
