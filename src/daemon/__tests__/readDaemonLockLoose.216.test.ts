/**
 * densable 2.1.216 — UTe loose daemon.lock read + DSr signalability
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DAEMON_LOCK_MAX_BYTES,
  getDaemonLockPath,
  isDaemonLockSignalable,
  readDaemonLock,
  readDaemonLockLoose,
} from '../daemonLock.js'

describe('readDaemonLockLoose (densable UTe)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-ute-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('accepts pid+version without startedAt', async () => {
    await writeFile(
      getDaemonLockPath(dir),
      JSON.stringify({ pid: 99, version: '2.1.216', origin: 'transient' }),
    )
    const got = await readDaemonLockLoose(dir)
    expect(got?.pid).toBe(99)
    expect(got?.version).toBe('2.1.216')
    expect(got?.startedAt).toBeUndefined()
    // Strict ownership read still requires startedAt
    expect(await readDaemonLock(dir)).toBeNull()
  })

  test('accepts full lock with startedAt + procStart', async () => {
    await writeFile(
      getDaemonLockPath(dir),
      JSON.stringify({
        pid: 42,
        version: '2.1.216',
        startedAt: 1_700_000_000_000,
        procStart: 'Wed Jan 1 00:00:00 2025',
      }),
    )
    const got = await readDaemonLockLoose(dir)
    expect(got?.pid).toBe(42)
    expect(got?.startedAt).toBe(1_700_000_000_000)
    expect(isDaemonLockSignalable(got)).toBe(true)
  })

  test('DSr false when procStart missing', async () => {
    expect(isDaemonLockSignalable({ procStart: undefined })).toBe(false)
    expect(isDaemonLockSignalable({ procStart: 123 })).toBe(true)
    expect(isDaemonLockSignalable(null)).toBe(false)
  })

  test('rejects oversized lock (size > 65536) and removes it', async () => {
    const path = getDaemonLockPath(dir)
    // size > DAEMON_LOCK_MAX_BYTES
    await writeFile(path, 'x'.repeat(DAEMON_LOCK_MAX_BYTES + 1))
    expect(await readDaemonLockLoose(dir)).toBeNull()
    // file should be gone
    const again = await readDaemonLockLoose(dir)
    expect(again).toBeNull()
  })

  test('rejects invalid JSON / missing pid', async () => {
    await writeFile(getDaemonLockPath(dir), '{not json')
    expect(await readDaemonLockLoose(dir)).toBeNull()
    await writeFile(getDaemonLockPath(dir), JSON.stringify({ version: 'x' }))
    expect(await readDaemonLockLoose(dir)).toBeNull()
  })
})
