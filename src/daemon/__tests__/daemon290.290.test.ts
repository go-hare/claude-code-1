import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  endsWithQueuedReply,
  isUnqueueableReply,
  resolveRespawnLaunchPrompt,
  sanitizeQueuedPrompt,
} from '../transcriptProbe.js'
import {
  evaluateDaemonUpgradePoll,
  formatDaemonLogMessage,
  type DaemonUpgradePollState,
} from '../main.js'
import type { BgJobState } from '../jobState.js'

function makeState(overrides: Partial<BgJobState> = {}): BgJobState {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: '/tmp/repo',
    template: 'bg',
    state: 'working',
    tempo: 'idle',
    detail: '',
    intent: 'test',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    firstTerminalAt: null,
    output: null,
    children: null,
    respawnFlags: [],
    ...overrides,
  }
}

describe('#62 / #72: queuedPrompt & unqueueable reply filter', () => {
  test('isUnqueueableReply rejects /, !, and multi-choice blocked questions', () => {
    expect(isUnqueueableReply('/compact', null)).toBe(true)
    expect(isUnqueueableReply('  /clear', null)).toBe(true)
    expect(isUnqueueableReply('!ls -la', null)).toBe(true)
    expect(isUnqueueableReply('  !pwd', null)).toBe(true)
    expect(isUnqueueableReply('continue please', null)).toBe(false)

    const blockedWithQuestions = makeState({
      tempo: 'blocked',
      block: {
        questions: [{ question: 'Which?', options: [] }],
      },
    })
    expect(isUnqueueableReply('option A', blockedWithQuestions)).toBe(true)
    expect(
      isUnqueueableReply('option A', makeState({ tempo: 'blocked' })),
    ).toBe(false)
  })

  test('sanitizeQueuedPrompt drops / and ! commands', () => {
    expect(sanitizeQueuedPrompt({ queuedPrompt: '/help' })).toBeUndefined()
    expect(sanitizeQueuedPrompt({ queuedPrompt: '  !echo hi' })).toBeUndefined()
    expect(sanitizeQueuedPrompt({ queuedPrompt: 'keep going' })).toBe(
      'keep going',
    )
    expect(sanitizeQueuedPrompt({ queuedPrompt: undefined })).toBeUndefined()
  })

  test('endsWithQueuedReply deduplicates identical or trailing replies', () => {
    expect(endsWithQueuedReply('hello', 'hello')).toBe(true)
    expect(endsWithQueuedReply('first\n\nsecond', 'second')).toBe(true)
    expect(endsWithQueuedReply('first\nsecond', 'second')).toBe(false)
  })

  test('resolveRespawnLaunchPrompt combines keepQueuedPrompt and skips sanitized / or !', () => {
    expect(
      resolveRespawnLaunchPrompt({
        queuedPrompt: '/compact',
        intent: 'do work',
        skipIntentReplay: false,
      }),
    ).toBe('do work')

    expect(
      resolveRespawnLaunchPrompt({
        initialPrompt: 'new msg',
        queuedPrompt: 'old msg',
        keepQueuedPrompt: true,
      }),
    ).toBe('old msg\n\nnew msg')

    expect(
      resolveRespawnLaunchPrompt({
        initialPrompt: 'old msg',
        queuedPrompt: 'old msg',
        keepQueuedPrompt: true,
      }),
    ).toBe('old msg')
  })
})

describe('#60: empty-transcript respawn intent suppression', () => {
  test('bgManager suppresses intent replay on fresh no-transcript bgIsolation=none respawn', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'bgManager.ts'),
      'utf8',
    )
    expect(src).toContain('freshNoTranscript')
    expect(src).toContain(
      'hasMessages || resumePointsElsewhere || freshNoTranscript',
    )
    expect(src).toContain(
      'the saved reply starts with / or !, so no restart sends it',
    )
  })
})

describe('#74: daemon upgrade poll & launcher runnability check', () => {
  test('refuses downgrade to older build once per target', () => {
    const logs: string[] = []
    const state: DaemonUpgradePollState = {
      refusedStaleTarget: null,
      deferredLauncherLogged: false,
    }
    const r1 = evaluateDaemonUpgradePoll({
      startupVersion: '2.1.325',
      currentVersion: '2.1.290',
      origin: 'transient',
      state,
      log: m => logs.push(m),
    })
    expect(r1).toEqual({ shouldRestart: false, reason: 'stale_binary' })
    expect(logs.length).toBe(1)
    expect(logs[0]).toContain('OLDER build')

    const r2 = evaluateDaemonUpgradePoll({
      startupVersion: '2.1.325',
      currentVersion: '2.1.290',
      origin: 'transient',
      state,
      log: m => logs.push(m),
    })
    expect(r2).toEqual({ shouldRestart: false, reason: 'stale_binary' })
    expect(logs.length).toBe(1)
  })

  test('defers upgrade when non-service launcher is not runnable', () => {
    const logs: string[] = []
    const state: DaemonUpgradePollState = {
      refusedStaleTarget: null,
      deferredLauncherLogged: false,
    }
    const r1 = evaluateDaemonUpgradePoll({
      startupVersion: '2.1.290',
      currentVersion: '2.1.325',
      origin: 'transient',
      state,
      log: m => logs.push(m),
      getWrapperError: () => null,
      getWrapperArgv: () => ['/nonexistent/wrapper'],
      checkLauncherRunnable: () => false,
    })
    expect(r1).toEqual({ shouldRestart: false, reason: 'launcher_unrunnable' })
    expect(logs.length).toBe(1)
    expect(logs[0]).toContain('not runnable right now')

    // Once launcher becomes runnable, upgrade proceeds
    const r2 = evaluateDaemonUpgradePoll({
      startupVersion: '2.1.290',
      currentVersion: '2.1.325',
      origin: 'transient',
      state,
      log: m => logs.push(m),
      getWrapperError: () => null,
      getWrapperArgv: () => ['/bin/sh'],
      checkLauncherRunnable: () => true,
    })
    expect(r2).toEqual({ shouldRestart: true })
    expect(state.deferredLauncherLogged).toBe(false)
  })

  test('service origin does not defer on launcher check', () => {
    const logs: string[] = []
    const state: DaemonUpgradePollState = {
      refusedStaleTarget: null,
      deferredLauncherLogged: false,
    }
    const r = evaluateDaemonUpgradePoll({
      startupVersion: '2.1.290',
      currentVersion: '2.1.325',
      origin: 'service',
      state,
      log: m => logs.push(m),
      getWrapperError: () => 'bad wrapper',
      getWrapperArgv: () => [],
      checkLauncherRunnable: () => false,
    })
    expect(r).toEqual({ shouldRestart: true })
  })
})

describe('#145: JSON-quoted multi-line daemon log', () => {
  test('JSON-quotes multi-line messages onto a single line and escapes control/bidi chars', () => {
    expect(formatDaemonLogMessage('line1\nline2\n')).toBe('"line1\\nline2"')
    expect(formatDaemonLogMessage('hello\x1b[31m world\x1b[0m  ')).toBe(
      'hello world',
    )
    expect(formatDaemonLogMessage('a\u2028b')).toBe('a\\u2028b')
    expect(formatDaemonLogMessage('line1\nline2\u202ebidi')).toBe(
      '"line1\\nline2\\u202ebidi"',
    )
  })
})

describe('#155: isVersionStale & shedMonitoringOnly', () => {
  test('bgWorker exposes isVersionStale, shedMonitoringOnly, and adopt upgrade guard', () => {
    const workerSrc = readFileSync(
      join(import.meta.dir, '..', 'bgWorker.ts'),
      'utf8',
    )
    expect(workerSrc).toContain('get isVersionStale(): boolean')
    expect(workerSrc).toContain('shedMonitoringOnly = false')
    expect(workerSrc).toContain(
      'isNewerCliVersion(entry.cliVersion, MACRO.VERSION)',
    )

    const mgrSrc = readFileSync(
      join(import.meta.dir, '..', 'bgManager.ts'),
      'utf8',
    )
    expect(mgrSrc).toContain('shedMonitoringOnly: true')
    expect(mgrSrc).toContain('tengu_bg_retire_pinned_low_mem')
  })
})
