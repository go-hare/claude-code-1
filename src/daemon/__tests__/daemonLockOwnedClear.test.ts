import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearDaemonLockIfOwned,
  getDaemonLockPath,
  writeDaemonLock,
} from '../daemonLock.js'

describe('clearDaemonLockIfOwned (official CvK/Q)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-lock-owned-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('clears when pid+startedAt match', async () => {
    const owner = { pid: 4242, startedAt: 1_700_000_000_000 }
    await writeDaemonLock(
      {
        pid: owner.pid,
        version: '2.6.33',
        startedAt: owner.startedAt,
        origin: 'transient',
      },
      dir,
    )
    expect(await clearDaemonLockIfOwned(owner, dir)).toBe(true)
    await expect(readFile(getDaemonLockPath(dir), 'utf8')).rejects.toThrow()
  })

  test('does not clear when pid differs (successor wrote lock)', async () => {
    const oldOwner = { pid: 1, startedAt: 100 }
    const newOwner = { pid: 2, startedAt: 200 }
    await writeDaemonLock(
      {
        pid: newOwner.pid,
        version: '2.6.33',
        startedAt: newOwner.startedAt,
        origin: 'transient',
      },
      dir,
    )
    expect(await clearDaemonLockIfOwned(oldOwner, dir)).toBe(false)
    const raw = await readFile(getDaemonLockPath(dir), 'utf8')
    expect(JSON.parse(raw).pid).toBe(2)
  })

  test('does not clear when startedAt differs', async () => {
    await writeDaemonLock(
      {
        pid: 7,
        version: '2.6.33',
        startedAt: 999,
        origin: 'service',
      },
      dir,
    )
    expect(await clearDaemonLockIfOwned({ pid: 7, startedAt: 1 }, dir)).toBe(
      false,
    )
    const raw = await readFile(getDaemonLockPath(dir), 'utf8')
    expect(JSON.parse(raw).startedAt).toBe(999)
  })

  test('missing lock is a no-op false', async () => {
    expect(await clearDaemonLockIfOwned({ pid: 1, startedAt: 1 }, dir)).toBe(
      false,
    )
  })
})
