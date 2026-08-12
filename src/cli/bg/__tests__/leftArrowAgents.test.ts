import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import * as realInstallPrompt from '../../../daemon/installPrompt.js'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// jobState.createInitialJobState reads MACRO.VERSION (build define).
beforeAll(() => {
  ;(globalThis as { MACRO?: { VERSION: string } }).MACRO = {
    VERSION: '2.6.33-test',
  }
})

describe('seedForLeftArrow + writeA8qJobState (official Sj4/A8q)', () => {
  const prevHome = process.env.CLAUDE_CONFIG_DIR
  let dir: string

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevHome
    if (dir) rmSync(dir, { recursive: true, force: true })
    mock.restore()
  })

  test('seedForLeftArrow empty → intent ""', async () => {
    const { seedForLeftArrow } = await import('../helpers.js')
    expect(seedForLeftArrow([], {})).toEqual({ intent: '' })
  })

  test('seedForLeftArrow fills haiku title when name missing', async () => {
    const { seedForLeftArrow } = await import('../helpers.js')
    const seed = seedForLeftArrow(
      [{ type: 'user', message: { content: 'fix the flaky test' } }],
      { haikuTitle: 'flaky-fix' },
    )
    expect(seed.intent).toBe('fix the flaky test')
    expect(seed.name).toBe('flaky-fix')
    expect(seed.nameSource).toBe('auto')
  })

  test('writeA8qJobState empty seed → idle blocked needs prompt', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    const { writeA8qJobState, readBgJobState } = await import(
      '../../../daemon/jobState.js'
    )
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const { short } = writeA8qJobState({
      sessionId,
      cwd: '/tmp/proj',
      intent: '',
    })
    expect(short).toBe('aaaaaaaa')
    const state = readBgJobState(short)!
    expect(state.intent).toBe('')
    expect(state.template).toBe('bg')
    expect(state.state).toBe('working')
    expect(state.tempo).toBe('blocked')
    expect(state.needs).toBe('send a prompt to start')
    expect(state.detail).toContain('send a prompt to start')
    // Must not default name to "new session"
    expect(state.name).toBeUndefined()
  })

  test('writeA8qJobState with intent keeps name and detail', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    const { writeA8qJobState, readBgJobState } = await import(
      '../../../daemon/jobState.js'
    )
    const sessionId = '11111111-2222-3333-4444-555555555555'
    writeA8qJobState({
      sessionId,
      cwd: '/tmp/proj',
      intent: 'push 12000 proxy',
      name: 'push 12000',
      nameSource: 'user',
      detail: 'Pushing via proxy…',
    })
    const state = readBgJobState('11111111')!
    expect(state.intent).toBe('push 12000 proxy')
    expect(state.name).toBe('push 12000')
    expect(state.detail).toBe('Pushing via proxy…')
    expect(state.tempo).toBe('active')
    expect(state.state).toBe('starting')
  })

  test('submitDispatch providedSessionId matches A8q short', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../../../daemon/controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    const { writeA8qJobState } = await import('../../../daemon/jobState.js')
    const provided = 'cccccccc-dddd-eeee-ffff-000000000000'
    writeA8qJobState({
      sessionId: provided,
      cwd: '/tmp',
      intent: 'from left arrow',
      name: 'from left',
    })

    const { submitDispatch } = await import('../../../daemon/bgManager.js')
    const result = await submitDispatch({
      intent: 'from left arrow',
      name: 'from left',
      source: 'left_arrow',
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      forkSession: true,
      providedSessionId: provided,
    })
    expect(result.short).toBe('cccccccc')
    expect(result.sessionId).toBe(provided)

    const { getDispatchDir } = await import('../../../daemon/bgWorker.js')
    const dispatchDir = getDispatchDir()
    const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(
      readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
    ) as {
      short: string
      sessionId: string
      source: string
      launch: { mode: string; sessionId?: string; fork?: boolean }
      name?: string
      intent: string
    }
    expect(payload.short).toBe('cccccccc')
    expect(payload.source).toBe('left_arrow')
    expect(payload.launch.mode).toBe('resume')
    expect(payload.launch.fork).toBe(true)
    expect(payload.launch.sessionId).toBe(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    )
    expect(payload.name).toBe('from left')
    expect(payload.intent).toBe('from left arrow')
  })

  test('writeA8qJobState persists worktree + bridge + resumeSessionId', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    const { writeA8qJobState, readBgJobState } = await import(
      '../../../daemon/jobState.js'
    )
    const sessionId = 'deadbeef-1111-2222-3333-444444444444'
    writeA8qJobState({
      sessionId,
      cwd: '/tmp/wt-path',
      intent: 'continue in worktree',
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      worktree: {
        path: '/tmp/wt-path',
        branch: 'feat/x',
        hookBased: false,
        originCwd: '/tmp/origin',
      },
      bridgeSessionId: 'bridge-sess-1',
      bridgeOutboundOnly: true,
      bridgeSessionSeq: 9,
      bridgeSessionGroupingId: 'sgrp_abc',
    })
    const state = readBgJobState('deadbeef')!
    expect(state.cwd).toBe('/tmp/wt-path')
    expect(state.resumeSessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(state.bgIsolation).toBe('worktree')
    expect(state.worktreePath).toBe('/tmp/wt-path')
    expect(state.worktreeBranch).toBe('feat/x')
    expect(state.originCwd).toBe('/tmp/origin')
    expect(state.bridgeSessionId).toBe('bridge-sess-1')
    expect(state.bridgeOutboundOnly).toBe(true)
    expect(state.bridgeSessionSeq).toBe(9)
    expect(state.bridgeSessionGroupingId).toBe('sgrp_abc')
  })

  test('buildBridgeReattachEnv mirrors official rit()', async () => {
    const { buildBridgeReattachEnv } = await import('../leftArrowAgents.js')
    expect(buildBridgeReattachEnv(undefined)).toBeUndefined()
    expect(buildBridgeReattachEnv('sid')).toEqual({
      CLAUDE_BRIDGE_REATTACH_SESSION: 'sid',
      CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY: '1',
    })
    expect(
      buildBridgeReattachEnv('sid', {
        seq: 7,
        outboundOnly: false,
        grouping: 'g1',
      }),
    ).toEqual({
      CLAUDE_BRIDGE_REATTACH_SESSION: 'sid',
      CLAUDE_BRIDGE_REATTACH_SEQ: '7',
      CLAUDE_BRIDGE_REATTACH_GROUPING: 'g1',
    })
  })

  test('openAgentsViaLeftArrow writes adopt.json prefill on abort-then-fork', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../../../bootstrap/state.js', () => ({
      getOriginalCwd: () => '/tmp/proj',
      getSessionId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      isSessionPersistenceDisabled: () => false,
    }))
    mock.module('../../../utils/sessionStorage.js', () => ({
      getCurrentSessionTitle: () => undefined,
    }))
    mock.module('../../../types/ids.js', () => ({
      asSessionId: (s: string) => s,
    }))
    mock.module('../../../utils/worktree.js', () => ({
      getCurrentWorktreeSession: () => null,
    }))
    mock.module('../../../bridge/replBridgeHandle.js', () => ({
      getReplBridgeHandle: () => null,
      takeLeftArrowBridgeHandle: () => null,
      stashLeftArrowBridgeHandle: () => {},
      resetLeftArrowBridgeHandleForTests: () => {},
    }))
    mock.module('../../../daemon/installPrompt.js', () => ({
      ...realInstallPrompt,
      ensureDaemonRunning: async () => ({ ok: false }),
    }))

    const { openAgentsViaLeftArrow } = await import('../leftArrowAgents.js')
    const result = await openAgentsViaLeftArrow(
      [{ type: 'user', message: { content: 'mid turn work' } }],
      {
        via: 'abort-then-fork',
        partialText: 'partial assistant text that was streaming',
        boundaryUuid: 'bound-1',
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const adoptPath = join(dir, 'jobs', result.short, 'adopt.json')
    const adopt = JSON.parse(readFileSync(adoptPath, 'utf8')) as {
      prefill?: { text: string; boundaryUuid?: string }
      shells: unknown[]
      cron: unknown[]
    }
    expect(adopt.prefill?.text).toContain('partial assistant')
    expect(adopt.prefill?.boundaryUuid).toBe('bound-1')
    expect(Array.isArray(adopt.shells)).toBe(true)
  })

  test('openAgentsViaLeftArrow without session id refuses (no checkpoint/disown path)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-nosession-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../../../bootstrap/state.js', () => ({
      getOriginalCwd: () => '/tmp/proj',
      getSessionId: () => {
        throw new Error('no session')
      },
      isSessionPersistenceDisabled: () => false,
    }))
    mock.module('../../../utils/sessionStorage.js', () => ({
      getCurrentSessionTitle: () => undefined,
    }))
    mock.module('../../../types/ids.js', () => ({
      asSessionId: (s: string) => s,
    }))
    mock.module('../../../utils/worktree.js', () => ({
      getCurrentWorktreeSession: () => null,
    }))
    mock.module('../../../bridge/replBridgeHandle.js', () => ({
      getReplBridgeHandle: () => null,
      takeLeftArrowBridgeHandle: () => null,
      stashLeftArrowBridgeHandle: () => {},
      resetLeftArrowBridgeHandleForTests: () => {},
    }))
    // If handoff proceeded it would call ensureDaemonRunning / write job —
    // these must not be reached without a session id.
    mock.module('../../../daemon/installPrompt.js', () => ({
      ...realInstallPrompt,
      ensureDaemonRunning: async () => {
        throw new Error('must not reach daemon without session')
      },
    }))

    const { openAgentsViaLeftArrow } = await import('../leftArrowAgents.js')
    const result = await openAgentsViaLeftArrow(
      [{ type: 'user', message: { content: 'orphan risk' } }],
      { via: 'idle-fork' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/no active session id/i)
    // No job dir created (refused before writeA8qJobState)
    expect(readdirSync(dir).includes('jobs')).toBe(false)
  })

  test('persistence disabled refuses without aborting stashed live agents', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-nopersist-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../../../bootstrap/state.js', () => ({
      getOriginalCwd: () => '/tmp/proj',
      getSessionId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      isSessionPersistenceDisabled: () => true,
    }))
    mock.module('../../../utils/sessionStorage.js', () => ({
      getCurrentSessionTitle: () => undefined,
    }))
    mock.module('../../../types/ids.js', () => ({
      asSessionId: (s: string) => s,
    }))
    mock.module('../../../utils/worktree.js', () => ({
      getCurrentWorktreeSession: () => null,
    }))
    mock.module('../../../bridge/replBridgeHandle.js', () => ({
      getReplBridgeHandle: () => null,
      takeLeftArrowBridgeHandle: () => null,
      stashLeftArrowBridgeHandle: () => {},
      resetLeftArrowBridgeHandleForTests: () => {},
    }))
    mock.module('../../../daemon/installPrompt.js', () => ({
      ...realInstallPrompt,
      ensureDaemonRunning: async () => {
        throw new Error('must not reach daemon when persistence disabled')
      },
    }))

    let checkpointAgentsCalls = 0
    let disownCalls = 0
    const {
      stashLeftArrowCheckpointLive,
      takeLeftArrowCheckpointLive,
      resetLeftArrowCheckpointLive,
    } = await import('../../../utils/bgCheckpoint.js')
    resetLeftArrowCheckpointLive()
    stashLeftArrowCheckpointLive({
      payload: {
        version: 1,
        shells: [],
        agents: [{ agentId: 'live-agent-1' }],
        workflows: [],
        cron: [],
      } as never,
      shellTaskIds: [],
      agentIds: ['live-agent-1'],
      workflowTaskIds: [],
      cronIds: [],
      detachedPids: [],
      handoffTaskIds: ['task-live-agent-1'],
      disown: () => {
        disownCalls++
      },
      checkpointAgents: async () => {
        checkpointAgentsCalls++
        return { abortedWorkflowIds: [], abortedAgentIds: ['live-agent-1'] }
      },
      abandon: () => {},
    })

    try {
      const { openAgentsViaLeftArrow } = await import('../leftArrowAgents.js')
      const result = await openAgentsViaLeftArrow(
        [{ type: 'user', message: { content: 'must not kill agents' } }],
        { via: 'idle-fork' },
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/session persistence is disabled/i)
      // densable aAf: take stash only — never post-adopt checkpoint/disown/abort.
      expect(checkpointAgentsCalls).toBe(0)
      expect(disownCalls).toBe(0)
      expect(takeLeftArrowCheckpointLive()).toBeNull()
      expect(readdirSync(dir).includes('jobs')).toBe(false)
    } finally {
      resetLeftArrowCheckpointLive()
    }
  })

  test('openAgentsViaLeftArrow writes checkpoint shells/cron from options', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../../../bootstrap/state.js', () => ({
      getOriginalCwd: () => '/tmp/proj',
      getSessionId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      isSessionPersistenceDisabled: () => false,
    }))
    mock.module('../../../utils/sessionStorage.js', () => ({
      getCurrentSessionTitle: () => undefined,
    }))
    mock.module('../../../types/ids.js', () => ({
      asSessionId: (s: string) => s,
    }))
    mock.module('../../../utils/worktree.js', () => ({
      getCurrentWorktreeSession: () => null,
    }))
    mock.module('../../../bridge/replBridgeHandle.js', () => ({
      getReplBridgeHandle: () => null,
      takeLeftArrowBridgeHandle: () => null,
      stashLeftArrowBridgeHandle: () => {},
      resetLeftArrowBridgeHandleForTests: () => {},
    }))
    mock.module('../../../daemon/installPrompt.js', () => ({
      ...realInstallPrompt,
      ensureDaemonRunning: async () => ({ ok: false }),
    }))

    const { openAgentsViaLeftArrow } = await import('../leftArrowAgents.js')
    const result = await openAgentsViaLeftArrow(
      [{ type: 'user', message: { content: 'carry tasks' } }],
      {
        via: 'idle-fork',
        checkpoint: {
          shells: [{ taskId: 'b1', pid: 9, command: 'sleep 9' }],
          cron: [{ id: 'c1', cron: '0 * * * *', prompt: 'hourly' }],
        },
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const adoptPath = join(dir, 'jobs', result.short, 'adopt.json')
    const adopt = JSON.parse(readFileSync(adoptPath, 'utf8')) as {
      prefill?: unknown
      shells: Array<{ taskId?: string; pid?: number }>
      cron: Array<{ id: string }>
    }
    expect(adopt.prefill).toBeUndefined()
    expect(adopt.shells[0]?.pid).toBe(9)
    expect(adopt.cron[0]?.id).toBe('c1')
  })

  test('buildBridgeReattachEnv with seq + grouping', async () => {
    const { buildBridgeReattachEnv } = await import('../leftArrowAgents.js')
    expect(
      buildBridgeReattachEnv('sid', {
        seq: 42,
        grouping: 'g',
        outboundOnly: true,
      }),
    ).toEqual({
      CLAUDE_BRIDGE_REATTACH_SESSION: 'sid',
      CLAUDE_BRIDGE_REATTACH_SEQ: '42',
      CLAUDE_BRIDGE_REATTACH_GROUPING: 'g',
      CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY: '1',
    })
  })

  test('shouldReplyOnIdleFork mirrors densable nzu', async () => {
    const { shouldReplyOnIdleFork, bridgeFlushCapMs } = await import(
      '../leftArrowAgents.js'
    )
    expect(shouldReplyOnIdleFork(null, [])).toBe(false)
    expect(shouldReplyOnIdleFork({ length: 1, uuid: 'a' }, [])).toBe(false)
    const base = [
      { type: 'user', uuid: 'u1' },
      { type: 'assistant', uuid: 'a1' },
    ]
    expect(shouldReplyOnIdleFork({ length: 2, uuid: 'a1' }, base)).toBe(true)
    // only non-user/assistant tails → still true
    expect(
      shouldReplyOnIdleFork({ length: 2, uuid: 'a1' }, [
        ...base,
        { type: 'system', uuid: 's1' },
      ]),
    ).toBe(true)
    // new user after snap → false
    expect(
      shouldReplyOnIdleFork({ length: 2, uuid: 'a1' }, [
        ...base,
        { type: 'user', uuid: 'u2' },
      ]),
    ).toBe(false)
    // uuid mismatch → false
    expect(shouldReplyOnIdleFork({ length: 2, uuid: 'other' }, base)).toBe(
      false,
    )
    // densable bridge flush cap
    expect(bridgeFlushCapMs(false)).toBe(2000)
    expect(bridgeFlushCapMs(undefined)).toBe(2000)
    expect(bridgeFlushCapMs(true)).toBe(5000)
  })

  test('LeftArrowOpenOptions / handoff surface includes replyOnResume + abortAfterFlush', async () => {
    // Type + export surface guard (finding 4 residual).
    const mod = await import('../leftArrowAgents.js')
    expect(typeof mod.bridgeFlushCapMs).toBe('function')
    expect(typeof mod.shouldReplyOnIdleFork).toBe('function')
    expect(mod.BRIDGE_FLUSH_CAP_MS).toBe(2000)
    expect(mod.BRIDGE_FLUSH_CAP_REPLY_ON_RESUME_MS).toBe(5000)
    expect(mod.SESSION_FLUSH_CAP_MS).toBe(2000)
    // densable nzu: snap.length < 1 or null → false (no turn-start prefix)
    expect(mod.shouldReplyOnIdleFork({ length: 0 }, [])).toBe(false)
    expect(mod.shouldReplyOnIdleFork(null, [])).toBe(false)
    // stable prefix + no new user/assistant suffix → true
    expect(
      mod.shouldReplyOnIdleFork({ length: 1, uuid: 'u1' }, [
        { type: 'user', uuid: 'u1' },
      ]),
    ).toBe(true)
  })

  test('openAgentsViaLeftArrow replyOnResume → --reply-on-resume + abortAfterFlush', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-ror-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../../../bootstrap/state.js', () => ({
      getOriginalCwd: () => '/tmp/proj',
      getSessionId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      isSessionPersistenceDisabled: () => false,
    }))
    mock.module('../../../utils/sessionStorage.js', () => ({
      getCurrentSessionTitle: () => undefined,
      flushSessionStorage: async () => {},
    }))
    mock.module('../../../types/ids.js', () => ({
      asSessionId: (s: string) => s,
    }))
    mock.module('../../../utils/worktree.js', () => ({
      getCurrentWorktreeSession: () => null,
    }))
    mock.module('../../../bridge/replBridgeHandle.js', () => ({
      getReplBridgeHandle: () => null,
      takeLeftArrowBridgeHandle: () => null,
      stashLeftArrowBridgeHandle: () => {},
      resetLeftArrowBridgeHandleForTests: () => {},
    }))
    mock.module('../../../daemon/installPrompt.js', () => ({
      ...realInstallPrompt,
      ensureDaemonRunning: async () => ({ ok: true }),
    }))
    mock.module('../../../daemon/controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    const ac = new AbortController()
    const { openAgentsViaLeftArrow } = await import('../leftArrowAgents.js')
    const result = await openAgentsViaLeftArrow(
      [{ type: 'user', message: { content: 'mid' } }],
      {
        via: 'abort-then-fork',
        partialText: 'partial',
        boundaryUuid: 'b1',
        replyOnResume: true,
        abortAfterFlush: ac,
      },
    )
    expect(result.ok).toBe(true)
    // densable: abort after fire-and-forget kickoff with J0("background")
    expect(ac.signal.aborted).toBe(true)
    const { isBackgroundAbortReason } = await import(
      '../../../utils/abortController.js'
    )
    expect(isBackgroundAbortReason(ac.signal.reason)).toBe(true)

    // let microtask spawn write dispatch
    await new Promise(r => setTimeout(r, 50))
    const { getDispatchDir } = await import('../../../daemon/bgWorker.js')
    const dispatchDir = getDispatchDir()
    const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(
      readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
    ) as {
      launch?: { flagArgs?: string[] }
      respawnFlags?: string[]
    }
    const flags = [
      ...(payload.launch?.flagArgs ?? []),
      ...(payload.respawnFlags ?? []),
    ]
    expect(flags).toContain('--reply-on-resume')
  })

  test('densable aAf spawn fail: jo/xe reason gates (2.1.211)', async () => {
    const {
      attachErrorTelemetryMessage,
      spawnFailReasonFromError,
      isBackgroundSpawnLogErrorReason,
      reportBackgroundSpawnFail,
    } = await import('../leftArrowAgents.js')
    const { getInMemoryErrors } = await import('../../../utils/log.js')

    // densable jo
    const e = new Error('x') as Error & { telemetryMessage?: string }
    attachErrorTelemetryMessage(e, 'safe')
    expect(e.telemetryMessage).toBe('safe')
    attachErrorTelemetryMessage(e, 'other')
    expect(e.telemetryMessage).toBe('safe') // no overwrite when already set

    // densable yNo reason from err.code (_p)
    expect(
      spawnFailReasonFromError(
        Object.assign(new Error('e'), { code: 'ERR_IPC' }),
      ),
    ).toBe('spawn_failed_ERR_IPC')
    expect(
      spawnFailReasonFromError(
        Object.assign(new Error('e'), { code: 'ENOENT' }),
      ),
    ).toBe('spawn_failed_ENOENT')
    expect(spawnFailReasonFromError(new Error('plain'))).toBe(
      'spawn_failed_unknown',
    )

    // densable aAf: only undefined / unknown / ERR_* → xe; ENOENT → warn
    expect(isBackgroundSpawnLogErrorReason(undefined)).toBe(true)
    expect(isBackgroundSpawnLogErrorReason('spawn_failed_unknown')).toBe(true)
    expect(isBackgroundSpawnLogErrorReason('spawn_failed_ERR_IPC')).toBe(true)
    expect(isBackgroundSpawnLogErrorReason('spawn_failed_ENOENT')).toBe(false)
    expect(isBackgroundSpawnLogErrorReason('gate_blocked')).toBe(false)

    // Side-effect path must not throw (logError may be process-mocked empty).
    // When real log is live, in-memory should capture the xe-shaped message.
    expect(() =>
      reportBackgroundSpawnFail('daemon not running', 'spawn_failed_unknown'),
    ).not.toThrow()
    const mem = getInMemoryErrors()
    if (mem.length > 0) {
      expect(
        mem.some(x =>
          x.error.includes('background spawn failed: daemon not running'),
        ),
      ).toBe(true)
    }
  })

  test('submitDispatch carries worktree isolation + reattachEnv', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../../../daemon/controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    const provided = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
    const { writeA8qJobState } = await import('../../../daemon/jobState.js')
    writeA8qJobState({
      sessionId: provided,
      cwd: '/tmp/wt',
      intent: 'wt',
      worktree: { path: '/tmp/wt', originCwd: '/tmp/o' },
    })

    const { submitDispatch } = await import('../../../daemon/bgManager.js')
    await submitDispatch({
      intent: 'wt',
      cwd: '/tmp/wt',
      source: 'left_arrow',
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      forkSession: true,
      providedSessionId: provided,
      isolation: 'worktree',
      worktree: { path: '/tmp/wt' },
      reattachEnv: {
        CLAUDE_BRIDGE_REATTACH_SESSION: 'br1',
        CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY: '1',
      },
    })

    const { getDispatchDir } = await import('../../../daemon/bgWorker.js')
    const dispatchDir = getDispatchDir()
    const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    const payload = JSON.parse(
      readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
    ) as {
      isolation?: string
      worktree?: { path: string }
      reattachEnv?: Record<string, string>
      env?: Record<string, string>
    }
    expect(payload.isolation).toBe('worktree')
    expect(payload.worktree?.path).toBe('/tmp/wt')
    expect(payload.reattachEnv?.CLAUDE_BRIDGE_REATTACH_SESSION).toBe('br1')
  })

  test('writeA8qJobState persists sessionPermissionRules + memoryToggledOff', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    const { writeA8qJobState, readBgJobState } = await import(
      '../../../daemon/jobState.js'
    )
    const sessionId = 'permrule-1111-2222-3333-444444444444'
    writeA8qJobState({
      sessionId,
      cwd: '/tmp/proj',
      intent: 'with rules',
      sessionPermissionRules: {
        allow: ['Bash(git *)'],
        deny: ['Bash(rm *)'],
      },
      memoryToggledOff: true,
    })
    const state = readBgJobState(sessionId.slice(0, 8))!
    expect(state.sessionPermissionRules?.allow).toEqual(['Bash(git *)'])
    expect(state.sessionPermissionRules?.deny).toEqual(['Bash(rm *)'])
    expect(state.memoryToggledOff).toBe(true)
  })

  test('submitDispatch sets CLAUDE_BG_SESSION_PERMISSION_RULES + MEMORY env', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../../../daemon/controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    const provided = 'rulesenv-cccc-dddd-eeee-ffffffffffff'
    const { writeA8qJobState } = await import('../../../daemon/jobState.js')
    writeA8qJobState({
      sessionId: provided,
      cwd: '/tmp',
      intent: 'rules',
    })
    const { submitDispatch } = await import('../../../daemon/bgManager.js')
    await submitDispatch({
      intent: 'rules',
      source: 'left_arrow',
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      forkSession: true,
      providedSessionId: provided,
      sessionPermissionRules: { allow: ['Read'], deny: [] },
      memoryToggledOff: true,
    })
    const { getDispatchDir } = await import('../../../daemon/bgWorker.js')
    const dispatchDir = getDispatchDir()
    const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    const payload = JSON.parse(
      readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
    ) as { env?: Record<string, string> }
    expect(payload.env?.CLAUDE_BG_MEMORY_TOGGLED_OFF).toBe('1')
    expect(
      JSON.parse(payload.env?.CLAUDE_BG_SESSION_PERMISSION_RULES ?? '{}'),
    ).toEqual({ allow: ['Read'], deny: [] })
  })

  test('carryTaskListToFork copies task files (official pqb)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pqb-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    delete process.env.CLAUDE_CODE_TASK_LIST_ID

    const { mkdirSync, writeFileSync, existsSync } = await import('fs')
    const fromId = 'from-session-aaaa-bbbb-cccc-dddddddddddd'
    const toId = 'to-session-eeee-ffff-0000-111111111111'
    const fromDir = join(dir, 'tasks', fromId)
    mkdirSync(fromDir, { recursive: true })
    writeFileSync(join(fromDir, '1.json'), '{"id":"1","subject":"x"}')
    writeFileSync(join(fromDir, '.lock'), 'ignore-me')

    const { carryTaskListToFork } = await import('../leftArrowAgents.js')
    await carryTaskListToFork(toId, fromId)
    expect(existsSync(join(dir, 'tasks', toId, '1.json'))).toBe(true)
    expect(existsSync(join(dir, 'tasks', toId, '.lock'))).toBe(false)
  })

  test('carryTaskListToFork skips when CLAUDE_CODE_TASK_LIST_ID set', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pqb-skip-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    process.env.CLAUDE_CODE_TASK_LIST_ID = 'shared'
    try {
      const { mkdirSync, writeFileSync, existsSync } = await import('fs')
      const fromId = 'from2-session-aaaa-bbbb-cccc-dddddddddddd'
      const toId = 'to2-session-eeee-ffff-0000-111111111111'
      const fromDir = join(dir, 'tasks', fromId)
      mkdirSync(fromDir, { recursive: true })
      writeFileSync(join(fromDir, '1.json'), '{}')
      const { carryTaskListToFork } = await import('../leftArrowAgents.js')
      await carryTaskListToFork(toId, fromId)
      expect(existsSync(join(dir, 'tasks', toId, '1.json'))).toBe(false)
    } finally {
      delete process.env.CLAUDE_CODE_TASK_LIST_ID
    }
  })
})

describe('tryQueueLeftArrowSpawnFail (densable yNo queued_for_later)', () => {
  const prevHome = process.env.CLAUDE_CONFIG_DIR
  let dir: string

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevHome
    if (dir) rmSync(dir, { recursive: true, force: true })
    mock.restore()
  })

  test('copies transcript + marks job failed with linkScanPath/respawnFlags', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-queue-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    const resumeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const providedId = 'cccccccc-dddd-eeee-ffff-000000000000'
    const short = providedId.slice(0, 8)

    // write resume transcript under projects/
    const { mkdirSync: mm, writeFileSync: ww } = await import('fs')
    const projects = join(dir, 'projects', 'tmp-proj')
    mm(projects, { recursive: true })
    const resumePath = join(projects, `${resumeId}.jsonl`)
    ww(resumePath, '{"type":"user"}\n')

    const { writeA8qJobState, readBgJobState } = await import(
      '../../../daemon/jobState.js'
    )
    writeA8qJobState({
      sessionId: providedId,
      cwd: '/tmp/proj',
      intent: 'queued later',
      resumeSessionId: resumeId,
    })

    mock.module('../../../utils/sessionStorage.js', () => ({
      getCurrentSessionTitle: () => undefined,
      getTranscriptPathForSession: (id: string) =>
        join(projects, `${id}.jsonl`),
    }))

    const {
      tryQueueLeftArrowSpawnFail,
      LEFT_ARROW_SPAWN_FAIL_RETRY_DETAIL,
      reportLeftArrowSpawnFailOutcome,
    } = await import('../leftArrowAgents.js')

    const ok = await tryQueueLeftArrowSpawnFail({
      short,
      providedSessionId: providedId,
      resumeSessionId: resumeId,
      respawnFlags: ['--reply-on-resume'],
    })
    expect(ok).toBe(true)
    const state = readBgJobState(short)!
    expect(state.state).toBe('failed')
    expect(state.tempo).toBe('idle')
    expect(state.detail).toBe(LEFT_ARROW_SPAWN_FAIL_RETRY_DETAIL)
    expect(state.linkScanPath).toBe(join(projects, `${providedId}.jsonl`))
    expect(state.respawnFlags).toEqual(['--reply-on-resume'])
    // dest transcript exists
    expect(readFileSync(state.linkScanPath!, 'utf8')).toContain('"type":"user"')

    // structural: outcome helper exists and is callable
    expect(() => reportLeftArrowSpawnFailOutcome(true)).not.toThrow()
    expect(() => reportLeftArrowSpawnFailOutcome(false)).not.toThrow()
  })

  test('missing job state → false (no throw)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'a8q-queue-miss-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    mock.module('../../../utils/sessionStorage.js', () => ({
      getCurrentSessionTitle: () => undefined,
      getTranscriptPathForSession: (id: string) =>
        join(dir, 'projects', `${id}.jsonl`),
    }))
    const { tryQueueLeftArrowSpawnFail } = await import('../leftArrowAgents.js')
    const ok = await tryQueueLeftArrowSpawnFail({
      short: 'deadbeef',
      providedSessionId: 'deadbeef-1111-2222-3333-444444444444',
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
    expect(ok).toBe(false)
  })
})

describe('left-arrow alive gate (densable !x.alive)', () => {
  test('source: handleSpawnFail skips queue when alreadyAlive', async () => {
    // densable yNo: left_arrow && !x.alive → queue; short_alive skips.
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(import.meta.dir, '../leftArrowAgents.ts'),
      'utf8',
    )
    expect(src).toContain('alreadyAlive')
    expect(src).toContain('alive === true')
    expect(src).toContain('if (!alreadyAlive)')
    // Must not call tryQueue when short already running
    expect(src).toMatch(
      /if \(!alreadyAlive\) \{\s*queued = await tryQueueLeftArrowSpawnFail/,
    )
  })

  test('isSubmitDispatchAliveError true only for alive:true', async () => {
    const { isSubmitDispatchAliveError } = await import(
      '../../../daemon/bgManager.js'
    )
    expect(
      isSubmitDispatchAliveError(
        Object.assign(new Error('alive'), {
          alive: true,
          reason: 'short_alive',
        }),
      ),
    ).toBe(true)
    expect(
      isSubmitDispatchAliveError(
        Object.assign(new Error('timeout'), { alive: false }),
      ),
    ).toBe(false)
    expect(isSubmitDispatchAliveError(new Error('plain'))).toBe(false)
    expect(isSubmitDispatchAliveError(null)).toBe(false)
  })
})
