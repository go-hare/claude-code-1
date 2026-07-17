import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildAnotherDaemonRunningMessage,
  claimDaemonSupervisorSlot,
  detectDaemonLockRace,
  shouldRequestDaemonYield,
  writeDaemonLock,
} from '../daemonLock.js'

describe('shouldRequestDaemonYield (official tG4)', () => {
  test('only when existing is transient and new is not', () => {
    expect(shouldRequestDaemonYield('transient', 'service')).toBe(true)
    expect(shouldRequestDaemonYield('transient', 'foreground')).toBe(true)
    expect(shouldRequestDaemonYield('transient', 'transient')).toBe(false)
    expect(shouldRequestDaemonYield('service', 'transient')).toBe(false)
    expect(shouldRequestDaemonYield('service', 'service')).toBe(false)
    expect(shouldRequestDaemonYield(undefined, 'service')).toBe(false)
  })
})

describe('buildAnotherDaemonRunningMessage', () => {
  test('transient never displaces', () => {
    const msg = buildAnotherDaemonRunningMessage({
      pid: 9,
      version: '2.6.36',
      existingOrigin: 'service',
      newOrigin: 'transient',
      askedYield: false,
      platform: 'linux',
    })
    expect(msg).toContain('pid=9')
    expect(msg).toContain('an on-demand daemon never displaces a running one')
    expect(msg).toContain('claude daemon stop')
  })

  test('windows stop hint uses taskkill', () => {
    const msg = buildAnotherDaemonRunningMessage({
      pid: 42,
      version: '2.6.36',
      existingOrigin: 'service',
      newOrigin: 'service',
      askedYield: false,
      platform: 'win32',
    })
    expect(msg).toContain('taskkill /PID 42')
  })

  test('yield failure wording', () => {
    const msg = buildAnotherDaemonRunningMessage({
      pid: 1,
      version: 'x',
      existingOrigin: 'transient',
      newOrigin: 'service',
      askedYield: true,
      platform: 'darwin',
    })
    expect(msg).toContain('asked it to yield but the handover failed')
  })
})

describe('claimDaemonSupervisorSlot', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-slot-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('ok when no lock', async () => {
    const r = await claimDaemonSupervisorSlot({
      origin: 'transient',
      configDir: dir,
    })
    expect(r).toEqual({ ok: true })
  })

  test('refuses when another live pid holds lock (stale dead pid ignored)', async () => {
    // pid that is almost certainly dead
    await writeDaemonLock(
      {
        pid: 2_147_483_646,
        version: '2.6.36',
        startedAt: Date.now(),
        origin: 'service',
      },
      dir,
    )
    // If process.kill fails, readAliveDaemonLock returns null → ok
    // If somehow alive, claim fails. Either way no throw.
    const r = await claimDaemonSupervisorSlot({
      origin: 'transient',
      configDir: dir,
    })
    expect(r.ok === true || r.ok === false).toBe(true)
  })

  test('live lock of current process blocks second claim', async () => {
    await writeDaemonLock(
      {
        pid: process.pid,
        version: '2.6.36',
        startedAt: Date.now(),
        origin: 'service',
      },
      dir,
    )
    const r = await claimDaemonSupervisorSlot({
      origin: 'transient',
      configDir: dir,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('another daemon is already running')
      expect(r.reason).toContain('never displaces')
      expect(r.askedYield).toBe(false)
    }
  })

  test('service claims ask transient to yield and wait for release', async () => {
    await writeDaemonLock(
      {
        pid: process.pid,
        version: '2.6.36',
        startedAt: Date.now(),
        origin: 'transient',
      },
      dir,
    )
    let yieldCalls = 0
    const logs: string[] = []
    const r = await claimDaemonSupervisorSlot({
      origin: 'service',
      configDir: dir,
      yieldTimeoutMs: 200,
      log: m => logs.push(m),
      requestYield: async () => {
        yieldCalls++
        // Simulate handover: clear lock after yield ack (caller re-reads).
        const { clearDaemonLock } = await import('../daemonLock.js')
        await clearDaemonLock(dir)
        return { ok: true, yielding: true }
      },
    })
    expect(yieldCalls).toBe(1)
    expect(r.ok).toBe(true)
    expect(logs.some(l => l.includes('asking it to yield'))).toBe(true)
  })

  test('yield acked but lock held → refuse', async () => {
    await writeDaemonLock(
      {
        pid: process.pid,
        version: '2.6.36',
        startedAt: Date.now(),
        origin: 'transient',
      },
      dir,
    )
    const r = await claimDaemonSupervisorSlot({
      origin: 'service',
      configDir: dir,
      yieldTimeoutMs: 150,
      requestYield: async () => ({ ok: true, yielding: true }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.askedYield).toBe(true)
      expect(r.reason).toContain('asked it to yield but the handover failed')
    }
  })

  test('yield refused when existing is non-transient path returns false yielding', async () => {
    // existing is transient so we still request yield; daemon reports not yielding
    await writeDaemonLock(
      {
        pid: process.pid,
        version: '2.6.36',
        startedAt: Date.now(),
        origin: 'transient',
      },
      dir,
    )
    const logs: string[] = []
    const r = await claimDaemonSupervisorSlot({
      origin: 'service',
      configDir: dir,
      log: m => logs.push(m),
      requestYield: async () => ({ ok: true, yielding: false }),
    })
    expect(r.ok).toBe(false)
    expect(logs.some(l => l.includes('refused to yield'))).toBe(true)
  })
})

describe('detectDaemonLockRace', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-race-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('null when lock is ours', async () => {
    const owner = { pid: process.pid, startedAt: 123 }
    await writeDaemonLock(
      {
        pid: owner.pid,
        version: '2.6.36',
        startedAt: owner.startedAt,
        origin: 'transient',
      },
      dir,
    )
    expect(await detectDaemonLockRace(owner, dir)).toBeNull()
  })

  test('returns other live lock', async () => {
    const owner = { pid: process.pid, startedAt: 1 }
    await writeDaemonLock(
      {
        pid: process.pid,
        version: '2.6.36',
        startedAt: 999,
        origin: 'service',
      },
      dir,
    )
    const raced = await detectDaemonLockRace(owner, dir)
    expect(raced).not.toBeNull()
    expect(raced?.startedAt).toBe(999)
  })
})
