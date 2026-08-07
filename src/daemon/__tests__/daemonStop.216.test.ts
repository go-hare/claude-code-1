/**
 * densable 2.1.216 — daemon stop --any / --keep-workers gate
 *
 * Tests pure classification + help surface; stop path is exercised via
 * daemonMain with mocked lock/service where practical.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  classifyDaemonLockHolder,
  getDaemonLockPath,
  isDaemonLockSignalable,
  isDaemonPidRaceLive,
  readDaemonLockLoose,
} from '../daemonLock.js'

describe('daemon stop gate helpers (densable 2.1.216)', () => {
  test('isDaemonLockSignalable is DSr (procStart defined)', () => {
    expect(isDaemonLockSignalable({ procStart: 'x' })).toBe(true)
    expect(isDaemonLockSignalable({})).toBe(false)
  })

  test('isDaemonPidRaceLive true for this process', () => {
    expect(isDaemonPidRaceLive(process.pid)).toBe(true)
  })

  test('isDaemonPidRaceLive false for dead pid', () => {
    // pid 1 may exist on unix; use unlikely high pid that is dead
    expect(isDaemonPidRaceLive(2_147_483_646)).toBe(false)
  })
})

describe('classifyDaemonLockHolder', () => {
  test('unverified when live pid lacks procStart pair', async () => {
    // Current process is live; cmdline may or may not look like daemon.
    // Without procStart on lock → if cmdline ok → unverified; if cmdline
    // fails (non-linux always true) → unverified when no bothHaveStart.
    const kind = await classifyDaemonLockHolder({
      pid: process.pid,
      version: '2.1.216',
      // no procStart
    })
    // On linux, our test process cmdline is not "claude daemon" → stale
    // On macOS, isDaemonCmdline returns true → unverified
    if (process.platform === 'linux') {
      expect(kind).toBe('stale')
    } else {
      expect(kind === 'unverified' || kind === 'stale').toBe(true)
    }
  })
})

describe('daemonMain stop help', () => {
  const origLog = console.log
  const origError = console.error
  let logLines: string[]

  beforeEach(() => {
    logLines = []
    console.log = (...a: unknown[]) => logLines.push(a.map(String).join(' '))
    console.error = (...a: unknown[]) => logLines.push(a.map(String).join(' '))
  })

  afterEach(() => {
    console.log = origLog
    console.error = origError
    process.exitCode = 0
  })

  test('help includes --any and --keep-workers', async () => {
    const { daemonMain } = await import('../main.js')
    await daemonMain(['help'])
    const output = logLines.join('\n')
    expect(output).toContain('--any')
    expect(output).toContain('also stop a transient')
    expect(output).toContain('--keep-workers')
    expect(output).toContain('leave detached sessions running')
  })
})

describe('readDaemonLockLoose integration for stop path', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-stop-ute-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('legacy lock without startedAt is visible to stop classification', async () => {
    await writeFile(
      getDaemonLockPath(dir),
      JSON.stringify({ pid: process.pid, version: 'legacy' }),
    )
    const raw = await readDaemonLockLoose(dir)
    expect(raw?.pid).toBe(process.pid)
    expect(isDaemonLockSignalable(raw)).toBe(false)
  })
})
