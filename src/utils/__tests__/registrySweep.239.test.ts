/**
 * densable 2.1.239 fBr / PYb — xWd only sweeps CYb temps when permitted.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getIsInteractive, setIsInteractive } from '../../bootstrap/state.js'
import {
  _resetRegistrySweepPermittedForTests,
  countConcurrentSessions,
  isRegistrySweepPermitted,
  listLiveSessionRecords,
} from '../concurrentSessions.js'
import { readFileSync } from 'node:fs'
import {
  deriveMessagingKeyName,
  isDeadMessagingPid,
  startUdsMessaging,
  stopUdsMessaging,
} from '../udsMessaging.js'

const HASH = 'a'.repeat(64)
const DEAD_PID = 1_000_000_007

function tmpName(): string {
  return `${DEAD_PID}.${HASH}.key.tmp.dead`
}

describe('densable 2.1.239 fBr isRegistrySweepPermitted', () => {
  const savedInteractive = getIsInteractive()
  const savedSandbox = process.env.IS_SANDBOX

  afterEach(() => {
    setIsInteractive(savedInteractive)
    if (savedSandbox === undefined) {
      delete process.env.IS_SANDBOX
    } else {
      process.env.IS_SANDBOX = savedSandbox
    }
    _resetRegistrySweepPermittedForTests()
  })

  test('false when not interactive', async () => {
    setIsInteractive(false)
    _resetRegistrySweepPermittedForTests()
    expect(await isRegistrySweepPermitted()).toBe(false)
  })

  test('false when IS_SANDBOX is truthy', async () => {
    setIsInteractive(true)
    process.env.IS_SANDBOX = '1'
    _resetRegistrySweepPermittedForTests()
    expect(await isRegistrySweepPermitted()).toBe(false)
  })

  test('true on win32/macos interactive non-sandbox (E_a short-circuit)', async () => {
    if (process.platform === 'linux') return
    setIsInteractive(true)
    delete process.env.IS_SANDBOX
    _resetRegistrySweepPermittedForTests()
    expect(await isRegistrySweepPermitted()).toBe(true)
  })
})

describe('densable 2.1.239 PYb gated by fBr', () => {
  let previousConfigDir: string | undefined
  let tempConfigDir = ''
  const savedInteractive = getIsInteractive()

  function socket(label: string): string {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\claude-sweep-${process.pid}-${label}`
    }
    return join(tempConfigDir, `${label}.sock`)
  }

  beforeEach(async () => {
    previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempConfigDir = await mkdtemp(join(tmpdir(), 'uds-sweep-239-'))
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
    setIsInteractive(savedInteractive)
    _resetRegistrySweepPermittedForTests()
  })

  afterEach(async () => {
    await stopUdsMessaging()
    setIsInteractive(savedInteractive)
    _resetRegistrySweepPermittedForTests()
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    }
    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true })
      tempConfigDir = ''
    }
  })

  test('xWd leaves CYb tmp when sweep is not permitted', async () => {
    setIsInteractive(false)
    _resetRegistrySweepPermittedForTests()
    const dir = join(tempConfigDir, 'sessions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(join(dir, tmpName()), 'stale', 'utf8')
    await startUdsMessaging(socket('no-sweep'), { isExplicit: true })
    expect(await readdir(dir)).toContain(tmpName())
  })

  test('xWd unlinks dead CYb tmp when sweep is permitted', async () => {
    if (process.platform === 'linux') return
    setIsInteractive(true)
    delete process.env.IS_SANDBOX
    _resetRegistrySweepPermittedForTests()
    const path = socket('sweep')
    const dir = join(tempConfigDir, 'sessions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(join(dir, tmpName()), 'stale', 'utf8')
    await startUdsMessaging(path, { isExplicit: true })
    const names = await readdir(dir)
    expect(names).not.toContain(tmpName())
    expect(names).toContain(deriveMessagingKeyName(process.pid, path))
  })
})

describe('densable 2.1.239 b1e/mBr pid sweep', () => {
  let previousConfigDir: string | undefined
  let tempConfigDir = ''
  const savedInteractive = getIsInteractive()

  beforeEach(async () => {
    previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempConfigDir = await mkdtemp(join(tmpdir(), 'uds-pid-sweep-239-'))
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
    setIsInteractive(false)
    _resetRegistrySweepPermittedForTests()
  })

  afterEach(async () => {
    setIsInteractive(savedInteractive)
    _resetRegistrySweepPermittedForTests()
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    }
    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true })
      tempConfigDir = ''
    }
  })

  test('b7 is ESRCH-only; pid 1 is not dead', () => {
    expect(isDeadMessagingPid(process.pid)).toBe(false)
    expect(isDeadMessagingPid(1)).toBe(false)
    expect(isDeadMessagingPid(DEAD_PID)).toBe(true)
  })

  test('fBr off leaves a b7-dead pid.json in place', async () => {
    const dir = join(tempConfigDir, 'sessions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const file = `${DEAD_PID}.json`
    await writeFile(
      join(dir, file),
      JSON.stringify({
        pid: DEAD_PID,
        sessionId: 'dead',
        cwd: tempConfigDir,
        startedAt: Date.now(),
      }),
      'utf8',
    )
    expect(await isRegistrySweepPermitted()).toBe(false)
    expect(await listLiveSessionRecords()).toEqual([])
    expect(await countConcurrentSessions()).toBe(0)
    expect(await readdir(dir)).toContain(file)
  })

  test('source-lock: listLive/count use fBr + b7, not WSL-only', () => {
    const src = readFileSync(
      join(import.meta.dir, '../concurrentSessions.ts'),
      'utf8',
    )
    expect(src).toContain('isRegistrySweepPermitted()')
    expect(src).toContain('isDeadMessagingPid(')
    expect(src).not.toMatch(/if \(getPlatform\(\) !== 'wsl'\) \{\s*void unlink/)
  })
})
