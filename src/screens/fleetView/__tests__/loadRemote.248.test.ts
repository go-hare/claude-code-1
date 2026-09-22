/**
 * densable 2.1.248 leftover remote list — setRemoteWanted / #I / loadRemote.
 * Official `Hu()` returns []. Official gg `Zs=!1` — no remote tabs.
 * Do not invent listCloudPeerSessions as listRemoteSessions.
 *
 * Gold: gold-248-ie-remote.txt · gold-248-ie-remote2.txt ·
 *       gold-248-ie-remote3.txt
 * - Hu @192115650
 * - Gu @192115692 sha=48de2b5e188bbd80
 * - Vu @192116575 sha=f8e4d1413d50f705
 * - WKe @179877053 sha=6c0dd6b25bc80e00
 * - loadRemote @192140121
 * - stopRemote @192140769 sha=e6ceb644d1007258
 * - archiveRemote @192141350 sha=de30126b02b75c82
 * - Z=!Y||!!d?.startsWith("remote-")
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  FLEET_REMOTE_OVERLAY_MS,
  FLEET_REMOTE_POLL_MS,
  archiveRemote,
  fleetOoActivity,
  fleetRemoteJobId,
  fleetRemotePoll,
  fleetRemoteStateFromSession,
  fleetSimpleWantsRemote,
  fleetRemoteWorkerHh,
  listRemoteSessions,
  loadRemoteJobs,
  mapRemoteSessionsToJobs,
  mergeRemoteJobs,
  refreshRemoteJobsActivity,
  stopRemote,
  stripFleetRemoteSessionId,
  type FleetRemoteJob,
  type FleetRemoteSessionRow,
} from '../fhFields.js'

function src(rel: string): string {
  return readFileSync(join(import.meta.dir, rel), 'utf8')
}

const AGENT_VIEW = src('../../AgentView.tsx')
const FH = src('../fhFields.ts')

describe('densable 2.1.248 leftover loadRemote / setRemoteWanted', () => {
  test('lands on AgentView / fhFields — no class gc / cloud list / remote tabs', () => {
    expect(AGENT_VIEW).toContain('setRemoteWanted')
    expect(AGENT_VIEW).toContain('loadRemote')
    expect(AGENT_VIEW).toContain('startRemoteI')
    expect(AGENT_VIEW).toContain('const stopRemote')
    expect(AGENT_VIEW).toContain('const archiveRemote')
    expect(AGENT_VIEW).toContain("session.backend === 'remote'")
    expect(FH).toContain('async function stopRemote(')
    expect(FH).toContain('async function archiveRemote(')
    expect(FH).toContain('FLEET_REMOTE_OVERLAY_MS = 120_000')
    expect(FH).toContain('interrupt rejected')
    expect(FH).toContain('archive rejected')
    expect(AGENT_VIEW).toContain('fleetSimpleWantsRemote')
    expect(AGENT_VIEW).toContain('FLEET_REMOTE_POLL_MS')
    expect(AGENT_VIEW).toContain('showRemoteTabs: false')
    expect(AGENT_VIEW).toContain(
      'simpleWantsRemote ? remoteJobs : EMPTY_REMOTE_JOBS',
    )
    expect(AGENT_VIEW).not.toMatch(/(?:^|\n)\s*(?:export\s+)?class gc\b/)
    expect(AGENT_VIEW).not.toContain('listCloudPeerSessions')
    expect(FH).toContain('async function Hu(){return[]}')
    expect(FH).toContain('listRemoteSessions:()=>Hu()')
    expect(FH).not.toContain('listCloudPeerSessions')
  })

  test('Hu returns empty; WKe / mr / hh match official', async () => {
    expect(await listRemoteSessions()).toEqual([])
    expect(fleetRemoteJobId('session_abcdefgh')).toBe('remote-abcdefgh')
    expect(stripFleetRemoteSessionId('session_abcdefgh')).toBe('abcdefgh')
    expect(stripFleetRemoteSessionId('cse_xyz')).toBe('xyz')
    expect(fleetRemoteWorkerHh('requires_action')).toEqual({
      state: 'blocked',
      tempo: 'blocked',
    })
    expect(fleetRemoteWorkerHh('idle')).toEqual({
      state: 'done',
      tempo: 'idle',
    })
    expect(fleetRemoteWorkerHh('running')).toEqual({
      state: 'working',
      tempo: 'active',
    })
    expect(FLEET_REMOTE_POLL_MS).toBe(30_000)
  })

  test('Gu maps official remote row onto leftover FleetJobState', () => {
    const row: FleetRemoteSessionRow = {
      id: 'session_remote01',
      title: 'fix pr',
      worker_status: 'requires_action',
      created_at: '2026-01-01T00:00:00.000Z',
      last_event_at: '2026-01-01T00:01:00.000Z',
      config: {
        sources: [{ type: 'git_repository', url: '/repo' }],
      },
      external_metadata: {
        pending_action: { tool_name: 'ExitPlanMode' },
      },
    }
    const state = fleetRemoteStateFromSession(row)
    expect(state.backend).toBe('remote')
    expect(state.template).toBe('remote')
    expect(state.sessionId).toBe('session_remote01')
    expect(state.cwd).toBe('/repo')
    expect(state.originCwd).toBe('/repo')
    expect(state.intent).toBe('fix pr')
    expect(state.needs).toBe('approve plan')
    expect(state.tempo).toBe('blocked')
    expect(state.state).toBe('blocked')
  })

  test('Vu keeps remote-pending- until sessionId lands', () => {
    const pending: FleetRemoteJob = {
      id: 'remote-pending-1',
      activity: 'flowing',
      state: { sessionId: 'session_pending1' },
    }
    const fetched: FleetRemoteJob = {
      id: 'remote-ote01xxx',
      activity: 'flowing',
      state: { sessionId: 'session_remote01' },
    }
    expect(mergeRemoteJobs([pending], [fetched]).map(job => job.id)).toEqual([
      'remote-ote01xxx',
      'remote-pending-1',
    ])
    const landed: FleetRemoteJob = {
      id: 'remote-ending1',
      activity: 'flowing',
      state: { sessionId: 'session_pending1' },
    }
    expect(mergeRemoteJobs([pending], [landed]).map(job => job.id)).toEqual([
      'remote-ending1',
    ])
  })

  test('loadRemote maps injected list and sets loaded when attached', async () => {
    const rows: FleetRemoteSessionRow[] = [
      {
        id: 'session_abcdefgh',
        title: 'remote work',
        worker_status: 'running',
        created_at: new Date().toISOString(),
      },
    ]
    const result = await loadRemoteJobs({
      generation: 1,
      currentGeneration: () => 1,
      prev: [],
      attached: true,
      listRemoteSessions: async () => rows,
    })
    expect(result?.loaded).toBe(true)
    expect(result?.jobs?.[0]?.id).toBe('remote-abcdefgh')
    expect(result?.jobs?.[0]?.state?.backend).toBe('remote')
    expect(result?.jobs?.[0]?.state?.intent).toBe('remote work')
  })

  test('stale generation drops the poll; catch still marks loaded', async () => {
    const stale = await loadRemoteJobs({
      generation: 1,
      currentGeneration: () => 2,
      prev: [],
      attached: true,
      listRemoteSessions: async () => [{ id: 'session_stale000' }],
    })
    expect(stale).toBeUndefined()

    const failed = await loadRemoteJobs({
      generation: 3,
      currentGeneration: () => 3,
      prev: [{ id: 'keep' }],
      attached: true,
      listRemoteSessions: async () => {
        throw new Error('mapper')
      },
    })
    expect(failed).toEqual({ loaded: true })
  })

  test('#I refreshes activity via leftover Oo; Z matches official gg', () => {
    const jobs: FleetRemoteJob[] = [
      {
        id: 'remote-1',
        activity: 'stuck',
        state: {
          state: 'done',
          tempo: 'idle',
          updatedAt: new Date().toISOString(),
        },
      },
    ]
    expect(refreshRemoteJobsActivity(jobs)[0]?.activity).toBe(
      fleetOoActivity(jobs[0]!.state!),
    )
    expect(fleetSimpleWantsRemote({ simpleView: false })).toBe(true)
    expect(fleetSimpleWantsRemote({ simpleView: true })).toBe(false)
    expect(
      fleetSimpleWantsRemote({
        simpleView: true,
        initialJobId: 'remote-abcdef',
      }),
    ).toBe(true)
  })

  test('w8 leftover poll fires then stops', () => {
    let now = 0
    const timers: Array<{ at: number; fn: () => void }> = []
    const stop = fleetRemotePoll(
      {
        setTimeout: (fn, ms) => {
          const at = now + ms
          const entry = { at, fn }
          timers.push(entry)
          return () => {
            const idx = timers.indexOf(entry)
            if (idx >= 0) timers.splice(idx, 1)
          }
        },
      },
      () => {
        now += 1
      },
      30_000,
    )
    expect(timers).toHaveLength(1)
    timers[0]!.fn()
    expect(now).toBe(1)
    stop()
    const afterStop = now
    for (const timer of [...timers]) timer.fn()
    expect(now).toBe(afterStop)
  })

  test('mapRemoteSessionsToJobs honors leftover #S stop overlay', () => {
    const stopUntil = new Map<string, number>([
      ['remote-abcdefgh', Date.now() + 60_000],
    ])
    const mapped = mapRemoteSessionsToJobs(
      [{ id: 'session_abcdefgh', worker_status: 'running' }],
      { stopUntil },
    )
    expect(mapped[0]?.state?.state).toBe('stopped')
    expect(mapped[0]?.state?.tempo).toBe('idle')
  })

  test('stopRemote overlays #S and interrupts; reject clears overlay', async () => {
    const stopUntil = new Map<string, number>()
    let jobs: FleetRemoteJob[] = [
      {
        id: 'remote-abcdefgh',
        activity: 'flowing',
        state: {
          sessionId: 'session_abcdefgh',
          state: 'working',
          tempo: 'active',
        },
      },
    ]
    let loaded = 0
    await stopRemote({
      job: jobs[0]!,
      stopUntil,
      now: 1_000,
      interruptRemoteSession: async () => true,
      updateRemoteJobs: fn => {
        jobs = fn(jobs)
      },
      loadRemote: () => {
        loaded += 1
      },
    })
    expect(stopUntil.get('remote-abcdefgh')).toBe(
      1_000 + FLEET_REMOTE_OVERLAY_MS,
    )
    expect(jobs[0]?.state?.state).toBe('stopped')
    expect(jobs[0]?.activity).toBe('stopped')
    expect(loaded).toBe(0)

    await expect(
      stopRemote({
        job: {
          id: 'remote-fail0001',
          state: {
            sessionId: 'session_fail0001',
            state: 'working',
            tempo: 'active',
          },
        },
        stopUntil,
        interruptRemoteSession: async () => false,
        updateRemoteJobs: fn => {
          jobs = fn(jobs)
        },
        loadRemote: () => {
          loaded += 1
        },
      }),
    ).rejects.toThrow('interrupt rejected')
    expect(stopUntil.has('remote-fail0001')).toBe(false)
    expect(loaded).toBe(1)
  })

  test('archiveRemote overlays #w and drops the job; reject reloads', async () => {
    const archiveUntil = new Map<string, number>()
    let jobs: FleetRemoteJob[] = [
      {
        id: 'remote-abcdefgh',
        state: { sessionId: 'session_abcdefgh' },
      },
    ]
    let loaded = 0
    await archiveRemote({
      job: jobs[0]!,
      archiveUntil,
      now: 2_000,
      archiveRemoteSession: async () => true,
      updateRemoteJobs: fn => {
        jobs = fn(jobs)
      },
      loadRemote: () => {
        loaded += 1
      },
    })
    expect(jobs).toEqual([])
    expect(archiveUntil.get('remote-abcdefgh')).toBe(
      2_000 + FLEET_REMOTE_OVERLAY_MS,
    )
    expect(loaded).toBe(0)

    await expect(
      archiveRemote({
        job: {
          id: 'remote-arch0001',
          state: { sessionId: 'session_arch0001' },
        },
        archiveUntil,
        archiveRemoteSession: async () => false,
        updateRemoteJobs: fn => {
          jobs = fn(jobs)
        },
        loadRemote: () => {
          loaded += 1
        },
      }),
    ).rejects.toThrow('archive rejected')
    expect(archiveUntil.has('remote-arch0001')).toBe(false)
    expect(loaded).toBe(1)
  })
})
