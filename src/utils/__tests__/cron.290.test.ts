import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addSessionCronTask,
  removeSessionCronTasks,
} from '../../bootstrap/state.js'
import { createCronScheduler } from '../cronScheduler.js'
import {
  readCronTasks,
  readCronTasksStrict,
  removeCronTasks,
} from '../cronTasks.js'
import {
  releaseSchedulerLock,
  tryAcquireSchedulerLock,
} from '../cronTasksLock.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cron-290-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('cronTasks / cronTasksLock / cronScheduler v2.1.290', () => {
  test('readCronTasksStrict returns unreadable on corrupt JSON and removeCronTasks refuses to clobber', async () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'scheduled_tasks.json'), '{not-json')

    expect(await readCronTasksStrict(dir)).toBe('unreadable')
    expect(await readCronTasks(dir)).toEqual([])
    await expect(removeCronTasks(['abc'], dir)).rejects.toThrow(
      /could not be read as a list of tasks/,
    )
  })

  test('readCronTasksStrict preserves creator metadata fields', async () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', 'scheduled_tasks.json'),
      JSON.stringify({
        tasks: [
          {
            id: 't1',
            cron: '* * * * *',
            prompt: 'hi',
            createdAt: 1000,
            createdBySessionId: 'sess-1',
            createdByPid: 12345,
            createdByProcStart: 'Mon Jan 1 00:00:00 2026',
            createdInProject: dir,
            plugin: 'my-plugin',
          },
        ],
      }),
    )

    const tasks = await readCronTasksStrict(dir)
    expect(tasks).not.toBe('unreadable')
    expect((tasks as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 't1',
      createdBySessionId: 'sess-1',
      createdByPid: 12345,
      createdByProcStart: 'Mon Jan 1 00:00:00 2026',
      createdInProject: dir,
      plugin: 'my-plugin',
    })
  })

  test('tryAcquireSchedulerLock recovers stale lock with mismatched procStart', async () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, '.claude'), { recursive: true })
    // Live PID (current process) but different procStart -> treated as PID reuse (stale)
    writeFileSync(
      join(dir, '.claude', 'scheduled_tasks.lock'),
      JSON.stringify({
        sessionId: 'other-session',
        pid: process.pid,
        procStart: 'Thu Jan 1 00:00:00 1970',
        acquiredAt: 1000,
      }),
    )

    const acquired = await tryAcquireSchedulerLock({
      dir,
      lockIdentity: 'my-lock-id',
    })
    expect(acquired).toBe(true)
    await releaseSchedulerLock({ dir, lockIdentity: 'my-lock-id' })
  })

  test('cronScheduler.isFireDue reflects session task due state', () => {
    const id = 'sess-due-' + Date.now()
    addSessionCronTask({
      id,
      cron: '* * * * *',
      prompt: 'ping',
      createdAt: Date.now() - 120_000,
      recurring: true,
    })
    try {
      const scheduler = createCronScheduler({
        onFire: () => {},
        isLoading: () => false,
      })
      expect(scheduler.isFireDue()).toBe(true)
    } finally {
      removeSessionCronTasks([id])
    }
  })
})
