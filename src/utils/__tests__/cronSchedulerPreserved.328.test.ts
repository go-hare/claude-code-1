import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getProjectRoot,
  getSessionId,
  setProjectRoot,
  setScheduledTasksEnabled,
} from '../../bootstrap/state.js'
import { createCronScheduler } from '../cronScheduler.js'

describe('Deep Parity 2.1.328: cronScheduler session resume PID refresh', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('Bug 5 (P2): refreshing task PIDs on session resume preserves unparsed/malformed/invalid-cron entries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cron-pid-preserved-328-'))
    dirs.push(dir)
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })

    const prevRoot = getProjectRoot()
    setProjectRoot(dir)
    setScheduledTasksEnabled(true)

    const sessionId = getSessionId()
    const stalePid = process.pid + 99_999
    const cronPath = join(claudeDir, 'scheduled_tasks.json')

    const foreignMalformedEntry = {
      id: 'foreign-future-v2',
      futureSchema: true,
      note: 'must survive pid refresh',
    }
    const invalidCronEntry = {
      id: 'typo-cron-entry',
      cron: 'not a valid cron',
      prompt: 'keep this user draft',
      createdAt: 1_700_000_000_000,
    }
    const resumedTask = {
      id: 'a1b2c3d4',
      cron: '0 0 1 1 *',
      prompt: 'resumed session recurring task',
      createdAt: Date.now(),
      recurring: true,
      createdBySessionId: sessionId,
      createdByPid: stalePid,
      createdByProcStart: 'old-proc-token',
      createdInProject: dir,
    }

    writeFileSync(
      cronPath,
      JSON.stringify(
        {
          tasks: [resumedTask, foreignMalformedEntry, invalidCronEntry],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )

    const scheduler = createCronScheduler({
      onFire: () => {},
      isLoading: () => false,
    })

    try {
      scheduler.start()

      // Wait for initial load(true) to refresh the stale PID and persist back to disk
      const deadline = Date.now() + 3000
      let parsed: { tasks: Array<Record<string, unknown>> } = { tasks: [] }
      while (Date.now() < deadline) {
        parsed = JSON.parse(readFileSync(cronPath, 'utf8')) as {
          tasks: Array<Record<string, unknown>>
        }
        const refreshed = parsed.tasks.find(t => t.id === 'a1b2c3d4')
        if (refreshed?.createdByPid === process.pid) {
          break
        }
        await new Promise(r => setTimeout(r, 30))
      }

      const refreshed = parsed.tasks.find(t => t.id === 'a1b2c3d4')
      expect(refreshed?.createdByPid).toBe(process.pid)
      expect(refreshed?.createdBySessionId).toBe(sessionId)

      // Both preserved entries must still be present in scheduled_tasks.json!
      expect(parsed.tasks).toContainEqual(foreignMalformedEntry)
      expect(parsed.tasks).toContainEqual(invalidCronEntry)
      expect(parsed.tasks).toHaveLength(3)
    } finally {
      scheduler.stop()
      setProjectRoot(prevRoot)
    }
  })
})
