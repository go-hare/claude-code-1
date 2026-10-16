import { afterEach, describe, expect, test } from 'bun:test'
import { runWithCwdOverride } from '../cwd.js'
import { dequeueAllMatching, getCommandQueue } from '../messageQueueManager.js'
import { getBootstrapSession } from '../sessionRoot.js'
import {
  defaultWebFetchSavedFiles,
  noteWorkerCheckin,
  parseWorkerCheckinScheduleMs,
  recordSubagentSpawn,
  recordSubagentSpawnRefused,
  resetSubagentSpawnLedgerForTests,
  resetWorkerCheckinForTests,
  snapshotSubagentSpawnLedger,
  subagentSpawnLedgerOf,
  webFetchSavedFilesForAgent,
  workerCheckinTicksUntil,
  WORKER_CHECKIN_POLL_FLOOR_MS,
} from '../subagentSpawnLedger.js'

describe('subagent spawn ledger (densable QLe / moe / $Ve)', () => {
  afterEach(() => {
    resetSubagentSpawnLedgerForTests()
    resetWorkerCheckinForTests()
    dequeueAllMatching(() => true)
  })

  test('recordSpawn handle is one-shot; cancelledAfterCompletion undoes completed', () => {
    const h = recordSubagentSpawn({
      agentType: 'general-purpose',
      runInBackground: true,
      runsInBackground: true,
      depth: 1,
    })
    h.completed()
    h.failed()
    expect(snapshotSubagentSpawnLedger().completed).toBe(1)
    expect(snapshotSubagentSpawnLedger().failed).toBe(0)
    h.cancelledAfterCompletion()
    const snap = snapshotSubagentSpawnLedger()
    expect(snap.completed).toBe(0)
    expect(snap.killed.user).toBe(1)
  })

  test('moe: built-in web-fetch stamps dirs, others undefined', () => {
    expect(
      webFetchSavedFilesForAgent({
        source: 'built-in',
        agentType: 'web-fetch',
      }),
    ).toEqual(defaultWebFetchSavedFiles())
    expect(
      webFetchSavedFilesForAgent({
        source: 'built-in',
        agentType: 'Explore',
      }),
    ).toBeUndefined()
  })

  test('moe: cwd override ALS yields an empty saved-files bag', () => {
    const bag = runWithCwdOverride('/tmp/worktree', () =>
      webFetchSavedFilesForAgent({
        source: 'built-in',
        agentType: 'web-fetch',
      }),
    )
    expect(bag).toEqual({ dirs: [], paths: [] })
  })

  test('$Ve worker checkin is idempotent and skips main-session', () => {
    const prevCoord = process.env.CLAUDE_CODE_COORDINATOR_MODE
    const prevSched = process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
    process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
    process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE = '120'
    try {
      const tasks: Record<string, unknown> = {
        a1: {
          id: 'a1',
          type: 'local_agent',
          status: 'running',
          agentType: 'general-purpose',
          description: 'a1',
          startTime: 1,
        },
      }
      const registry = { all: () => tasks }
      noteWorkerCheckin(tasks.a1 as never, registry)
      noteWorkerCheckin(tasks.a1 as never, registry)
      noteWorkerCheckin(
        {
          id: 'main',
          type: 'local_agent',
          status: 'running',
          agentType: 'main-session',
        },
        registry,
      )
      const bag = getBootstrapSession().sessionScratch.workerCheckin()
      expect(bag?.knownWorkerIds.has('a1')).toBe(true)
      expect(bag?.knownWorkerIds.has('main')).toBe(false)
    } finally {
      if (prevCoord === undefined)
        delete process.env.CLAUDE_CODE_COORDINATOR_MODE
      else process.env.CLAUDE_CODE_COORDINATOR_MODE = prevCoord
      if (prevSched === undefined) {
        delete process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
      } else {
        process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE = prevSched
      }
    }
  })

  test('Fpn/FVe schedule helpers; bag arms real timer with taskRegistry', () => {
    expect(
      parseWorkerCheckinScheduleMs({
        CLAUDE_CODE_COORDINATOR_MODE: '1',
        CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE: '120,300',
      }),
    ).toEqual([120_000, 300_000])
    expect(
      parseWorkerCheckinScheduleMs({
        CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE: '120',
      }),
    ).toBeUndefined()
    expect(
      workerCheckinTicksUntil(0, [120_000], WORKER_CHECKIN_POLL_FLOOR_MS),
    ).toBe(2)

    const prevCoord = process.env.CLAUDE_CODE_COORDINATOR_MODE
    const prevSched = process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
    process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
    process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE = '120'
    try {
      const tasks: Record<string, unknown> = {
        'worker-bag-1': {
          id: 'worker-bag-1',
          type: 'local_agent',
          status: 'running',
          agentType: 'general-purpose',
          description: 'worker',
          startTime: Date.now(),
        },
      }
      noteWorkerCheckin(tasks['worker-bag-1'] as never, { all: () => tasks })
      const bag = getBootstrapSession().sessionScratch.workerCheckin()
      expect(bag?.scheduleMs).toEqual([120_000])
      expect(bag?.knownWorkerIds?.has('worker-bag-1')).toBe(true)
      expect(bag?.timer).toBeDefined()
      expect(typeof bag?.timer).not.toBe('undefined')
      expect(bag?.ticksUntilCheckin).toBe(2)
      expect(bag?.taskRegistry.all()['worker-bag-1']).toBeDefined()
    } finally {
      if (prevCoord === undefined)
        delete process.env.CLAUDE_CODE_COORDINATOR_MODE
      else process.env.CLAUDE_CODE_COORDINATOR_MODE = prevCoord
      if (prevSched === undefined) {
        delete process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
      } else {
        process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE = prevSched
      }
    }
  })

  test('$Ve without taskRegistry does not invent a bag', () => {
    const prevCoord = process.env.CLAUDE_CODE_COORDINATOR_MODE
    const prevSched = process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
    process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
    process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE = '30'
    try {
      noteWorkerCheckin({
        id: 'no-registry',
        type: 'local_agent',
        status: 'running',
        agentType: 'general-purpose',
      })
      expect(
        getBootstrapSession().sessionScratch.workerCheckin(),
      ).toBeUndefined()
    } finally {
      if (prevCoord === undefined)
        delete process.env.CLAUDE_CODE_COORDINATOR_MODE
      else process.env.CLAUDE_CODE_COORDINATOR_MODE = prevCoord
      if (prevSched === undefined) {
        delete process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
      } else {
        process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE = prevSched
      }
    }
  })

  test('Pwr clears timer when no live/parked workers remain', async () => {
    const prevCoord = process.env.CLAUDE_CODE_COORDINATOR_MODE
    const prevSched = process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
    process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
    // 1s schedule → poll floor min(60000,1000)=1000 → 1 tick
    process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE = '1'
    try {
      const tasks: Record<string, unknown> = {
        w1: {
          id: 'w1',
          type: 'local_agent',
          status: 'running',
          agentType: 'general-purpose',
          description: 'still going',
          startTime: Date.now() - 120_000,
          progress: { toolUseCount: 0 },
        },
      }
      noteWorkerCheckin(tasks.w1 as never, { all: () => tasks })
      expect(
        getBootstrapSession().sessionScratch.workerCheckin()?.timer,
      ).toBeDefined()

      // Drain live workers → next tick should WLt clear.
      delete tasks.w1
      await new Promise(resolve => setTimeout(resolve, 1100))
      expect(
        getBootstrapSession().sessionScratch.workerCheckin(),
      ).toBeUndefined()
      expect(
        getCommandQueue().some(
          cmd =>
            cmd.origin?.kind === 'task-notification' &&
            cmd.origin.source === 'worker-checkin',
        ),
      ).toBe(false)
    } finally {
      if (prevCoord === undefined)
        delete process.env.CLAUDE_CODE_COORDINATOR_MODE
      else process.env.CLAUDE_CODE_COORDINATOR_MODE = prevCoord
      if (prevSched === undefined) {
        delete process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
      } else {
        process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE = prevSched
      }
    }
  })

  test('Pwr enqueues worker-checkin notification after ticks elapse', async () => {
    const prevCoord = process.env.CLAUDE_CODE_COORDINATOR_MODE
    const prevSched = process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
    process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
    process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE = '1'
    try {
      const tasks: Record<string, unknown> = {
        w1: {
          id: 'w1',
          type: 'local_agent',
          status: 'running',
          agentType: 'general-purpose',
          description: 'still going',
          startTime: Date.now() - 120_000,
          progress: { toolUseCount: 2 },
        },
      }
      noteWorkerCheckin(tasks.w1 as never, { all: () => tasks })
      await new Promise(resolve => setTimeout(resolve, 1100))
      const queued = getCommandQueue().filter(
        cmd =>
          cmd.origin?.kind === 'task-notification' &&
          cmd.origin.source === 'worker-checkin',
      )
      expect(queued.length).toBe(1)
      expect(String(queued[0]?.value)).toContain(
        'Worker check-in: dispatched work still running',
      )
      expect(String(queued[0]?.value)).toContain('Still running:')
      const bag = getBootstrapSession().sessionScratch.workerCheckin()
      expect(bag?.checkinCount).toBe(1)
      expect(bag?.ticksUntilCheckin).toBe(1)
    } finally {
      if (prevCoord === undefined)
        delete process.env.CLAUDE_CODE_COORDINATOR_MODE
      else process.env.CLAUDE_CODE_COORDINATOR_MODE = prevCoord
      if (prevSched === undefined) {
        delete process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE
      } else {
        process.env.CLAUDE_CODE_WORKER_CHECKIN_SCHEDULE = prevSched
      }
    }
  })

  test('spawn counts are isolated per session object', () => {
    const a = {}
    const b = {}
    recordSubagentSpawn({ agentType: 'general-purpose', depth: 1 }, a)
    expect(snapshotSubagentSpawnLedger(a).spawned).toBe(1)
    expect(snapshotSubagentSpawnLedger(b).spawned).toBe(0)
    expect(snapshotSubagentSpawnLedger().spawned).toBe(0)
  })

  test('subagentSpawnLedgerOf returns the same bag for the same session', () => {
    const s = {}
    expect(subagentSpawnLedgerOf(s)).toBe(subagentSpawnLedgerOf(s))
  })

  test('refused counts are isolated per session object', () => {
    const a = {}
    const b = {}
    recordSubagentSpawnRefused('x', a)
    expect(snapshotSubagentSpawnLedger(a).refused).toEqual({ x: 1 })
    expect(snapshotSubagentSpawnLedger(b).refused).toEqual({})
  })
})
