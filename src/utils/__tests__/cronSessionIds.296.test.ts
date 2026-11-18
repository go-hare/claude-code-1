import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getSessionId,
  setScheduledTasksEnabled,
  switchSession,
} from '../../bootstrap/state.js'
import type { SessionId } from '../../types/ids.js'
import { createCronScheduler } from '../cronScheduler.js'
import {
  addCronTask,
  getOwnProcStartToken,
  readCronTasks,
} from '../cronTasks.js'
import { getProjectDir } from '../sessionStoragePortable.js'

describe('cron sessionIds across session switches (#212)', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('addCronTask persists createdBySessionId, createdByPid, createdByProcStart, createdInProject for durable tasks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cron-212-'))
    dirs.push(dir)
    const { setProjectRoot } = await import('../../bootstrap/state.js')
    const prevRoot = (await import('../../bootstrap/state.js')).getProjectRoot()
    setProjectRoot(dir)
    try {
      const id = await addCronTask('* * * * *', 'hello', true, true)
      const tasks = await readCronTasks(dir)
      const created = tasks.find(t => t.id === id)
      expect(created).toBeDefined()
      expect(created!.createdBySessionId).toBe(getSessionId())
      expect(created!.createdByPid).toBe(process.pid)
      expect(created!.createdByProcStart).toBe(getOwnProcStartToken())
      expect(created!.createdInProject).toBe(dir)
    } finally {
      setProjectRoot(prevRoot)
    }
  })

  test('scheduler runs task created in an earlier session of the same process after switchSession even without lock ownership', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cron-sched-212-'))
    dirs.push(dir)
    mkdirSync(join(dir, '.claude'), { recursive: true })

    // Pre-create a lock owned by another live-looking session so this scheduler is NOT lock owner
    const foreignSession = '00000000-0000-4000-8000-000000000099'
    writeFileSync(
      join(dir, '.claude', 'scheduled_tasks.lock'),
      JSON.stringify({
        sessionId: foreignSession,
        pid: process.pid,
        acquiredAt: Date.now(),
      }),
    )

    const { getProjectRoot, setProjectRoot } = await import(
      '../../bootstrap/state.js'
    )
    const prevRoot = getProjectRoot()
    setProjectRoot(dir)
    setScheduledTasksEnabled(true)

    const initialSession = getSessionId()
    const fired: string[] = []
    const scheduler = createCronScheduler({
      onFire: p => fired.push(p),
      isLoading: () => false,
    })

    try {
      const taskId = await addCronTask(
        '* * * * *',
        'from-first-session',
        true,
        true,
      )
      // Backdate createdAt so the recurring task is due on checkNow()
      const tasks = await readCronTasks(dir)
      const target = tasks.find(t => t.id === taskId)!
      target.createdAt = Date.now() - 120_000
      const { writeCronTasks } = await import('../cronTasks.js')
      await writeCronTasks(tasks, dir)

      // Ensure project dir exists for transcript check
      mkdirSync(getProjectDir(dir), { recursive: true })

      scheduler.start()
      // Switch to a new session (simulating /clear or /branch or /resume)
      const nextSession = '11111111-1111-4111-8111-111111111111' as SessionId
      switchSession(nextSession, 'clear')

      // Wait briefly for enable() -> load(true) to finish
      await new Promise(r => setTimeout(r, 200))
      scheduler.checkNow()

      expect(fired).toContain('from-first-session')
    } finally {
      scheduler.stop()
      switchSession(initialSession, 'clear')
      setProjectRoot(prevRoot)
    }
  })
})
