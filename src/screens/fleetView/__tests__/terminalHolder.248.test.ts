/**
 * densable 2.1.248 #17 + #19 — terminalHolders / already-open row and
 * dead-epoch stale-resurrect (gold strings 1:1, no invent overlay).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BgJobState } from '../../../daemon/jobState.js'
import {
  DEAD_EPOCH_DETAIL,
  DEAD_EPOCH_STALE_MS,
  planReapedJobSettle,
} from '../../../daemon/jobState.js'
import {
  DEAD_EPOCH_TRANSCRIPT_GONE,
  evaluateRespawnTranscriptGate,
  formatDeadEpochTranscriptGoneError,
} from '../../../daemon/transcriptProbe.js'
import {
  buildTerminalHolders,
  DEAD_EPOCH_DETAIL as FLEET_DEAD_EPOCH_DETAIL,
  DEAD_EPOCH_STALE_MS as FLEET_DEAD_EPOCH_STALE_MS,
  DEAD_EPOCH_TRANSCRIPT_GONE as FLEET_DEAD_EPOCH_CODE,
  decideFleetOpenGate,
  FLEET_DEAD_EPOCH_GONE,
  FLEET_DEAD_EPOCH_OFFER,
  FLEET_DEAD_EPOCH_OFFER_MS,
  FLEET_HELD_IN_TERMINAL_HINT,
  FLEET_HELD_IN_TERMINAL_LABEL,
  FLEET_OPEN_IN_ANOTHER_TERMINAL,
  isFleetBhSettled,
  isFleetDeadEpochOfferArmed,
  isFleetExecJob,
  isFleetTerminalHolderLive,
  terminalHolderOf,
} from '../helpers.js'

const ROOT = join(import.meta.dir, '../../..')

function job(over: Partial<BgJobState> = {}): BgJobState {
  return {
    state: 'working',
    detail: 'running',
    tempo: 'active',
    intent: 'do work',
    sessionId: 'sess-1',
    cwd: '/tmp',
    template: 'bg',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    firstTerminalAt: null,
    output: null,
    children: null,
    respawnFlags: [],
    ...over,
  }
}

describe('densable 2.1.248 #19 terminalHolderOf / Wr row', () => {
  test('gold row copy is Open in a terminal + continue it there', () => {
    expect(FLEET_HELD_IN_TERMINAL_LABEL).toBe('Open in a terminal')
    expect(FLEET_HELD_IN_TERMINAL_HINT).toBe('continue it there')
    expect(FLEET_OPEN_IN_ANOTHER_TERMINAL).toBe(
      "Can't open — this session is running in another terminal",
    )
  })

  test('terminalHolderOf skips peer and remote backends', () => {
    const holders = new Map([['sess-1', 99]])
    expect(
      terminalHolderOf({ backend: 'peer', sessionId: 'sess-1' }, holders),
    ).toBeUndefined()
    expect(
      terminalHolderOf({ backend: 'remote', sessionId: 'sess-1' }, holders),
    ).toBeUndefined()
    expect(
      terminalHolderOf({ backend: 'daemon', sessionId: 'sess-1' }, holders),
    ).toBe(99)
  })

  test('terminalHolderOf uses resumeSessionId then sessionId', () => {
    const holders = new Map([
      ['resume-1', 7],
      ['sess-1', 8],
    ])
    expect(
      terminalHolderOf(
        { sessionId: 'sess-1', resumeSessionId: 'resume-1' },
        holders,
      ),
    ).toBe(7)
    expect(terminalHolderOf({ sessionId: 'sess-1' }, holders)).toBe(8)
    expect(terminalHolderOf({ sessionId: 'missing' }, holders)).toBeUndefined()
  })

  test('buildTerminalHolders keeps interactive other-pid unparked sessions', () => {
    const self = 1000
    const map = buildTerminalHolders(
      [
        { kind: 'interactive', pid: 2000, sessionId: 'a' },
        { kind: 'interactive', pid: self, sessionId: 'self' },
        { kind: 'bg', pid: 2001, sessionId: 'bg' },
        {
          kind: 'interactive',
          pid: 2002,
          sessionId: 'parked',
          parkedJobId: 'abcd1234',
        },
        { kind: 'interactive', pid: 2003, sessionId: 'b' },
      ],
      self,
    )
    expect([...map.entries()]).toEqual([
      ['a', 2000],
      ['b', 2003],
    ])
    expect(
      isFleetTerminalHolderLive(
        { kind: 'interactive', pid: 2000, sessionId: 'a' },
        self,
      ),
    ).toBe(true)
  })

  test('held-in-terminal open path refuses without spawning', () => {
    const gate = decideFleetOpenGate({
      heldInTerminal: true,
      settled: true,
      isExec: false,
      jobId: 'abcd1234',
      forkRefusedJobId: null,
      deadEpochGoneJobId: null,
      deadEpochOfferedJobId: null,
      deadEpochOfferAgeMs: Number.POSITIVE_INFINITY,
      offerArmed: false,
    })
    expect(gate).toEqual({
      action: 'refuse',
      error: FLEET_OPEN_IN_ANOTHER_TERMINAL,
    })
  })

  test('spawn-refuse uses v$e for interactive, long fallback otherwise', async () => {
    const {
      RESUME_SESSION_LIVE_ELSEWHERE_FALLBACK,
      RESUME_SESSION_LIVE_ELSEWHERE_INTERACTIVE,
      formatResumeSessionLiveElsewhereError,
    } = await import('../../../daemon/xyrRespawn.js')
    expect(RESUME_SESSION_LIVE_ELSEWHERE_INTERACTIVE).toBe(
      FLEET_OPEN_IN_ANOTHER_TERMINAL,
    )
    expect(formatResumeSessionLiveElsewhereError('interactive')).toBe(
      FLEET_OPEN_IN_ANOTHER_TERMINAL,
    )
    expect(formatResumeSessionLiveElsewhereError('bg')).toBe(
      RESUME_SESSION_LIVE_ELSEWHERE_FALLBACK,
    )
    expect(RESUME_SESSION_LIVE_ELSEWHERE_FALLBACK).toContain(
      'already open in another running Claude session',
    )
    const xyr = readFileSync(join(ROOT, 'daemon/xyrRespawn.ts'), 'utf8')
    expect(xyr).toContain("m.kind === 'interactive'")
    expect(xyr).toContain('excludeJobIds')
    const src = readFileSync(join(ROOT, 'screens/AgentView.tsx'), 'utf8')
    expect(src).toContain(
      'formatResumeSessionLiveElsewhereError(conflict.kind)',
    )
    expect(src).toContain('heldInTerminal')
    expect(src).toContain('terminalHolderOf')
  })
})

describe('densable 2.1.248 #17 dead-epoch strings + open gate', () => {
  test('gold fleet ask / gone-row / mcr / H1t / errorCode 1:1', () => {
    expect(FLEET_DEAD_EPOCH_OFFER).toBe(
      'Press enter again to resume this session (it ended while the background service was off), or ctrl+x to delete it.',
    )
    expect(FLEET_DEAD_EPOCH_GONE).toBe(
      "This session's saved conversation is no longer on disk (old transcripts are cleaned up), so there is nothing to resume. ctrl+x deletes the row.",
    )
    expect(FLEET_DEAD_EPOCH_OFFER).toContain(
      'this session (it ended while the background service was off), or ctrl+x to delete it.',
    )
    expect(FLEET_DEAD_EPOCH_DETAIL).toBe(
      'ended while the background service was off',
    )
    expect(DEAD_EPOCH_DETAIL).toBe(FLEET_DEAD_EPOCH_DETAIL)
    expect(FLEET_DEAD_EPOCH_STALE_MS).toBe(172_800_000)
    expect(DEAD_EPOCH_STALE_MS).toBe(172_800_000)
    expect(FLEET_DEAD_EPOCH_CODE).toBe('dead_epoch_transcript_gone')
    expect(DEAD_EPOCH_TRANSCRIPT_GONE).toBe('dead_epoch_transcript_gone')
    expect(FLEET_DEAD_EPOCH_OFFER_MS).toBe(700)
    expect(formatDeadEpochTranscriptGoneError('abcd1234')).toBe(
      "This session's saved conversation is no longer on disk (it ended while the background service was off, and old transcripts are cleaned up), so there is nothing to resume. `claude rm abcd1234` deletes the row; `claude respawn abcd1234` runs its original prompt again instead.",
    )
  })

  test('first enter on a dead-epoch settled row offers ja, does not spawn', () => {
    const gate = decideFleetOpenGate({
      heldInTerminal: false,
      deadEpochReapedAt: '2026-01-01T00:00:00.000Z',
      settled: true,
      isExec: false,
      jobId: 'abcd1234',
      forkRefusedJobId: null,
      deadEpochGoneJobId: null,
      deadEpochOfferedJobId: null,
      deadEpochOfferAgeMs: Number.POSITIVE_INFINITY,
      offerArmed: false,
    })
    expect(gate).toEqual({
      action: 'offer',
      error: FLEET_DEAD_EPOCH_OFFER,
    })
  })

  test('second enter after ja proceeds; debounce inside Tb keeps the offer', () => {
    const proceed = decideFleetOpenGate({
      heldInTerminal: false,
      deadEpochReapedAt: '2026-01-01T00:00:00.000Z',
      settled: true,
      isExec: false,
      jobId: 'abcd1234',
      forkRefusedJobId: null,
      deadEpochGoneJobId: null,
      deadEpochOfferedJobId: 'abcd1234',
      deadEpochOfferAgeMs: 800,
      offerArmed: true,
    })
    expect(proceed).toEqual({ action: 'proceed', clearOffered: true })

    const debounce = decideFleetOpenGate({
      heldInTerminal: false,
      deadEpochReapedAt: '2026-01-01T00:00:00.000Z',
      settled: true,
      isExec: false,
      jobId: 'abcd1234',
      forkRefusedJobId: null,
      deadEpochGoneJobId: null,
      deadEpochOfferedJobId: 'abcd1234',
      deadEpochOfferAgeMs: 100,
      offerArmed: true,
    })
    expect(debounce).toEqual({ action: 'debounce' })
  })

  test('gone-row after dead_epoch_transcript_gone shows ip', () => {
    const gate = decideFleetOpenGate({
      heldInTerminal: false,
      deadEpochReapedAt: '2026-01-01T00:00:00.000Z',
      settled: true,
      isExec: false,
      jobId: 'abcd1234',
      forkRefusedJobId: null,
      deadEpochGoneJobId: 'abcd1234',
      deadEpochOfferedJobId: null,
      deadEpochOfferAgeMs: Number.POSITIVE_INFINITY,
      offerArmed: false,
    })
    expect(gate).toEqual({
      action: 'refuse',
      error: FLEET_DEAD_EPOCH_GONE,
    })
  })

  test('does not invent a confirm overlay — Ka is the ja banner', () => {
    expect(
      isFleetDeadEpochOfferArmed({
        error: FLEET_DEAD_EPOCH_OFFER,
        previewOpen: false,
        helpOpen: false,
        exitArmed: false,
        renaming: false,
        groupEdit: false,
        deletePending: false,
      }),
    ).toBe(true)
    expect(
      isFleetDeadEpochOfferArmed({
        error: FLEET_DEAD_EPOCH_OFFER,
        previewOpen: true,
        helpOpen: false,
        exitArmed: false,
        renaming: false,
        groupEdit: false,
        deletePending: false,
      }),
    ).toBe(false)
  })

  test('sS / Di helpers match gold', () => {
    expect(isFleetExecJob({ template: 'exec', respawnFlags: [] })).toBe(true)
    expect(isFleetExecJob({ template: 'exec', respawnFlags: ['--name'] })).toBe(
      false,
    )
    expect(isFleetExecJob({ template: 'bg', respawnFlags: [] })).toBe(false)
    expect(isFleetBhSettled({ state: 'stopped', tempo: 'idle' })).toBe(true)
    expect(isFleetBhSettled({ state: 'stopped', tempo: 'active' })).toBe(false)
    expect(isFleetBhSettled({ state: 'working', tempo: 'idle' })).toBe(false)
  })
})

describe('densable 2.1.248 #17 uae writer', () => {
  test('stale auto-resume failed non-exec → stopped + deadEpochReapedAt + mcr', () => {
    const now = Date.parse('2026-09-20T00:00:00.000Z')
    const updatedAt = new Date(now - DEAD_EPOCH_STALE_MS - 1).toISOString()
    const plan = planReapedJobSettle(
      job({ updatedAt, detail: 'working' }),
      'failed',
      'process gone while supervisor was down',
      { resumable: 'auto-resume' },
      now,
    )
    expect(plan.verdict).toBe('dead-epoch')
    if (plan.verdict === 'none') throw new Error('expected settle')
    expect(plan.next.state).toBe('stopped')
    expect(plan.next.detail).toBe('ended while the background service was off')
    expect(plan.next.deadEpochReapedAt).toBe(new Date(now).toISOString())
    expect(plan.next.tempo).toBe('idle')
    expect(plan.next.firstTerminalAt).toBe(updatedAt)
  })

  test('recent auto-resume failed → reapedMidWorkAt, not dead-epoch', () => {
    const now = Date.parse('2026-09-20T00:00:00.000Z')
    const updatedAt = new Date(now - 1000).toISOString()
    const plan = planReapedJobSettle(
      job({ updatedAt }),
      'failed',
      'process gone while supervisor was down',
      { resumable: 'auto-resume' },
      now,
    )
    expect(plan.verdict).toBe('settled')
    if (plan.verdict === 'none') throw new Error('expected settle')
    expect(plan.next.state).toBe('failed')
    expect(plan.next.deadEpochReapedAt).toBeUndefined()
    expect(plan.next.reapedMidWorkAt).toBe(updatedAt)
    expect(plan.next.detail).toBe('running')
  })

  test('exec jobs and already-settled rows are not dead-epoch', () => {
    const now = Date.parse('2026-09-20T00:00:00.000Z')
    const old = new Date(now - DEAD_EPOCH_STALE_MS - 1).toISOString()
    expect(
      planReapedJobSettle(
        job({ template: 'exec', updatedAt: old }),
        'failed',
        'process gone while supervisor was down',
        { resumable: 'auto-resume' },
        now,
      ).verdict,
    ).toBe('settled')
    expect(
      planReapedJobSettle(
        job({ state: 'stopped', tempo: 'idle', updatedAt: old }),
        'failed',
        'gone',
        { resumable: 'auto-resume' },
        now,
      ).verdict,
    ).toBe('none')
  })
})

describe('densable 2.1.248 #17 transcript gate errorCode', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  test('deadEpochReapedAt + empty transcript + !force + !R → errorCode', async () => {
    dir = join(tmpdir(), `dead-epoch-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'sess-id-1.jsonl')
    writeFileSync(path, '', 'utf8')

    const gate = await evaluateRespawnTranscriptGate({
      short: 'abcd1234',
      sessionId: 'sess-id-1',
      resumeSessionId: 'sess-id-1',
      cwd: dir,
      bgIsolation: 'worktree',
      linkScanPath: path,
      deadEpochReapedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(gate.allow).toBe(false)
    if (gate.allow) throw new Error('expected refuse')
    expect(gate.errorCode).toBe(DEAD_EPOCH_TRANSCRIPT_GONE)
    expect(gate.error).toBe(formatDeadEpochTranscriptGoneError('abcd1234'))
  })

  test('force bypasses dead-epoch; forceRefusalRetry does not; R does', async () => {
    dir = join(tmpdir(), `dead-epoch-force-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'sess-id-1.jsonl')
    writeFileSync(path, '', 'utf8')

    const retry = await evaluateRespawnTranscriptGate({
      short: 'abcd1234',
      sessionId: 'sess-id-1',
      resumeSessionId: 'sess-id-1',
      cwd: dir,
      bgIsolation: 'worktree',
      linkScanPath: path,
      deadEpochReapedAt: '2026-01-01T00:00:00.000Z',
      forceRefusalRetry: true,
    })
    expect(retry.allow).toBe(false)
    if (!retry.allow) {
      expect(retry.errorCode).toBe(DEAD_EPOCH_TRANSCRIPT_GONE)
    }

    const forced = await evaluateRespawnTranscriptGate({
      short: 'abcd1234',
      sessionId: 'sess-id-1',
      resumeSessionId: 'sess-id-1',
      cwd: dir,
      bgIsolation: 'worktree',
      linkScanPath: path,
      deadEpochReapedAt: '2026-01-01T00:00:00.000Z',
      force: true,
    })
    expect(forced.allow).toBe(true)

    const elsewhere = await evaluateRespawnTranscriptGate({
      short: 'abcd1234',
      sessionId: 'sess-id-1',
      resumeSessionId: 'other-sess',
      cwd: dir,
      bgIsolation: 'worktree',
      linkScanPath: path,
      deadEpochReapedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(elsewhere.allow).toBe(true)
  })
})
