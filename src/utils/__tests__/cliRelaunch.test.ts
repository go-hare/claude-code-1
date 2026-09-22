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
  mergeRelaunchModelArgs,
  RELAUNCH_ALWAYS_DROP_ENV,
  resolveRelaunchCliArgs,
  resolveRelaunchCwd,
  resolveRelaunchModelArg,
  restoreProcessEnvSnapshot,
  sanitizeEnvForExecve,
  snapshotProcessEnvKeys,
  TUI_RELAUNCH_DROP_ENV,
  tuiRelaunchProcessEnvMutationKeys,
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
        CLAUDE_CODE_TUI_TRIAL: '1',
        CLAUDE_BRIDGE_REATTACH_OWNER_ACCT: 'acct',
        CLAUDE_BRIDGE_REATTACH_OWNER_ORG: 'org',
        CLAUDE_BRIDGE_REATTACH_NO_BACKFILL: '1',
      },
      injectEnv: { CLAUDE_CODE_TUI_JUST_SWITCHED: 'fullscreen' },
      dropEnv: ['CLAUDE_CODE_NO_FLICKER'],
    })
    expect(env.KEEP).toBe('1')
    expect(env.CLAUDE_CODE_TUI_JUST_SWITCHED).toBe('fullscreen')
    expect(env.CLAUDE_CODE_NO_FLICKER).toBeUndefined()
    expect(env.CLAUDE_BRIDGE_REATTACH_SESSION).toBeUndefined()
    expect(env.CLAUDE_CODE_TUI_TRIAL).toBeUndefined()
    expect(env.CLAUDE_BRIDGE_REATTACH_OWNER_ACCT).toBeUndefined()
    expect(env.CLAUDE_BRIDGE_REATTACH_OWNER_ORG).toBeUndefined()
    expect(env.CLAUDE_BRIDGE_REATTACH_NO_BACKFILL).toBeUndefined()
    expect(RELAUNCH_ALWAYS_DROP_ENV).toContain('CLAUDE_CODE_TUI_JUST_SWITCHED')
    expect(RELAUNCH_ALWAYS_DROP_ENV).toContain('CLAUDE_CODE_TUI_TRIAL')
    expect(RELAUNCH_ALWAYS_DROP_ENV).toContain(
      'CLAUDE_BRIDGE_REATTACH_OWNER_ACCT',
    )
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

  test('acceptTuiRelaunch inject_only densable', async () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_NO_FLICKER: '1',
      CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL: '1',
    }
    const result = await acceptTuiRelaunch({
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

  test('injectTuiSwitch false is official _G/Ket ($B + extra, no TUI switch)', async () => {
    const plan = buildTuiRelaunchPlan({
      target: 'default',
      hasNonEmptyTranscript: false,
      screenReaderEnv: { CLAUDE_AX_SCREEN_READER: '1' },
      injectTuiSwitch: false,
      extraInjectEnv: {
        CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME: 'alpha',
      },
    })
    expect(plan.injectEnv.CLAUDE_CODE_TUI_JUST_SWITCHED).toBeUndefined()
    expect(plan.injectEnv.CLAUDE_AX_SCREEN_READER).toBe('1')
    expect(plan.injectEnv.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME).toBe('alpha')
    expect(plan.dropEnv).toEqual([])
    // Yet is `_G`-always. When terminalSize is omitted and stdout has no
    // size, Yet returns {} so the key stays undefined.
    const stdoutColumns = process.stdout.columns
    const stdoutRows = process.stdout.rows
    if (!stdoutColumns || !stdoutRows) {
      expect(plan.injectEnv.CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE).toBeUndefined()
    } else {
      expect(plan.injectEnv.CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE).toBe(
        `${stdoutColumns}x${stdoutRows}`,
      )
    }

    const sized = buildTuiRelaunchPlan({
      target: 'default',
      hasNonEmptyTranscript: false,
      screenReaderEnv: {},
      injectTuiSwitch: false,
      extraInjectEnv: {
        CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME: 'alpha',
      },
      terminalSize: { columns: 100, rows: 30 },
    })
    expect(sized.injectEnv.CLAUDE_CODE_TUI_JUST_SWITCHED).toBeUndefined()
    expect(sized.injectEnv.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME).toBe('alpha')
    expect(sized.dropEnv).toEqual([])
    expect(sized.injectEnv.CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE).toBe('100x30')

    const env: NodeJS.ProcessEnv = {}
    const result = await acceptTuiRelaunch({
      target: 'default',
      hasNonEmptyTranscript: false,
      screenReaderEnv: {},
      env,
      spawn: false,
      injectTuiSwitch: false,
      extraInjectEnv: { CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME: 'alpha' },
    })
    expect(result.mode).toBe('inject_only')
    expect(env.CLAUDE_CODE_TUI_JUST_SWITCHED).toBeUndefined()
    expect(env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME).toBeUndefined()
    expect(result.plan.injectEnv.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME).toBe(
      'alpha',
    )
  })

  test('acceptTuiRelaunch defaults to oyt spawn unless spawn:false', () => {
    const src = readFileSync(join(import.meta.dir, '../cliRelaunch.ts'), 'utf8')
    const accept = src.slice(
      src.indexOf('export async function acceptTuiRelaunch'),
    )
    expect(accept).toContain('input.spawn === false')
    expect(src).not.toContain('isTuiRelaunchSpawnEnabled')
    expect(src).not.toMatch(/CLAUDE_CODE_SPAWN_TUI_RELAUNCH\s*[=:]/)
    expect(accept).toContain('beginCliRelaunch({')
    expect(src).toContain('spawnCliRelaunch({')
  })

  test('acceptTuiRelaunch spawn fail returns spawned (no teardown/exit)', () => {
    const src = readFileSync(join(import.meta.dir, '../cliRelaunch.ts'), 'utf8')
    const accept = src.slice(
      src.indexOf('export async function acceptTuiRelaunch'),
    )
    const prepFn = src.slice(
      src.indexOf('async function runOfficialRelaunchGPrep'),
      src.indexOf('async function runOfficialRelaunchGCommit'),
    )
    // Switching copy runs only after the child has started.
    expect(prepFn).not.toContain('preSpawn')
    // Prep before spawn; Commit only after ok — fail path returns to callers.
    expect(accept.indexOf('runOfficialRelaunchGPrep')).toBeGreaterThan(-1)
    expect(accept.indexOf('runOfficialRelaunchGPrep')).toBeLessThan(
      accept.indexOf('beginCliRelaunch'),
    )
    const failIdx = accept.indexOf('if (!spawn.ok)')
    const returnIdx = accept.indexOf(
      "return { mode: 'spawned', plan, spawn }",
      failIdx,
    )
    const commitIdx = accept.indexOf('runOfficialRelaunchGCommit()')
    const preSpawnIdx = accept.indexOf('input.preSpawn?.()')
    const waitIdx = accept.indexOf('await spawn.exited')
    expect(failIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(failIdx)
    expect(commitIdx).toBeGreaterThan(returnIdx)
    expect(preSpawnIdx).toBeGreaterThan(commitIdx)
    expect(waitIdx).toBeGreaterThan(preSpawnIdx)
    expect(accept.slice(failIdx, returnIdx)).not.toContain('claimShutdown')
    expect(accept.slice(failIdx, returnIdx)).not.toContain('process.exit')
    // Signals are stripped in onSpawned, before commit waits for exit.
    const spawnedIdx = accept.indexOf('onSpawned()')
    expect(spawnedIdx).toBeGreaterThan(-1)
    expect(spawnedIdx).toBeLessThan(failIdx)
    expect(accept.slice(spawnedIdx, failIdx)).toContain('RELAUNCH_G_SIGNALS')
    // Leftover Ake/oyt applied process.env before spawn. finally restores
    // unless the child emitted spawn, so throws and the error event both
    // roll back TUI_JUST_SWITCHED / dropped NO_FLICKER.
    const finallyIdx = accept.indexOf('} finally {')
    expect(finallyIdx).toBeGreaterThan(waitIdx)
    expect(accept.slice(finallyIdx)).toContain('!childStarted')
    expect(accept.slice(finallyIdx)).toContain('restoreProcessEnvSnapshot')
    expect(accept).toContain('snapshotProcessEnvKeys')
    // inject_only returns before the try, so spawn:false keeps the mutation.
    expect(accept.indexOf("return { mode: 'inject_only', plan }")).toBeLessThan(
      accept.indexOf('let childStarted'),
    )
  })

  test('apply/restore process.env round-trip for Ake spawn-fail leftover', () => {
    const plan = buildTuiRelaunchPlan({
      target: 'fullscreen',
      hasNonEmptyTranscript: false,
      screenReaderEnv: {},
    })
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_NO_FLICKER: '1',
      CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
      CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL: '1',
      KEEP: 'yes',
    }
    const snap = snapshotProcessEnvKeys(
      tuiRelaunchProcessEnvMutationKeys(plan),
      env,
    )
    applyTuiRelaunchPlanToProcessEnv(plan, env)
    expect(env.CLAUDE_CODE_TUI_JUST_SWITCHED).toBe('fullscreen')
    expect(env.CLAUDE_CODE_NO_FLICKER).toBeUndefined()
    expect(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN).toBeUndefined()
    expect(env.CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL).toBeUndefined()
    expect(env.KEEP).toBe('yes')

    restoreProcessEnvSnapshot(snap, env)
    expect(env.CLAUDE_CODE_TUI_JUST_SWITCHED).toBeUndefined()
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe('1')
    expect(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN).toBe('1')
    expect(env.CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL).toBe('1')
    expect(env.KEEP).toBe('yes')
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

  test('resolveRelaunchCwd returns projectRoot when sessionFile absent', () => {
    const cwd = resolveRelaunchCwd()
    expect(typeof cwd).toBe('string')
    expect(cwd.length).toBeGreaterThan(0)
  })

  test('sanitizeEnvForExecve is official Xet (skip undefined, safe __proto__)', () => {
    const input: NodeJS.ProcessEnv = { KEEP: '1', DROP: undefined }
    Object.defineProperty(input, '__proto__', {
      value: 'x',
      writable: true,
      enumerable: true,
      configurable: true,
    })
    const env = sanitizeEnvForExecve(input)
    expect(env.KEEP).toBe('1')
    expect(Object.hasOwn(env, 'DROP')).toBe(false)
    expect(Object.hasOwn(env, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(env, '__proto__')?.value).toBe('x')
  })

  test('spawnCliRelaunch matches official C options (no windowsHide)', () => {
    const src = readFileSync(join(import.meta.dir, '../cliRelaunch.ts'), 'utf8')
    const spawnFn = src.slice(
      src.indexOf('export function spawnCliRelaunch'),
      src.indexOf('export function relaunchIntoTui'),
    )
    expect(spawnFn).toContain("stdio: 'inherit'")
    expect(spawnFn).not.toContain('windowsHide')
    const beginFn = src.slice(
      src.indexOf('function beginCliRelaunch'),
      src.indexOf('export function applyTuiRelaunchPlanToProcessEnv'),
    )
    expect(beginFn).toContain("stdio: 'inherit'")
    expect(beginFn).toContain('cwd: input.cwd ?? process.cwd()')
    expect(beginFn).not.toContain('windowsHide')
    expect(beginFn).toContain("child.once('spawn'")
    expect(beginFn).toContain("child.on('error'")
    expect(src).toContain('sanitizeEnvForExecve(launch.env)')
    expect(src).toContain('isAbsolute(launch.execPath)')
  })
})
