/**
 * densable 2.1.238 #22 — YKT/JKT/FDl/n$/ife pointer occupancy + crash-reuse.
 * Gold: leftover standalone pointer is reused on next `claude remote-control`
 * (no --session-id). Live writer pid defers the write. storageV5 is not ported.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { debugMock } from '../../../tests/mocks/debug.js'

mock.module('src/utils/debug.ts', debugMock)

const {
  BRIDGE_POINTER_TTL_MS,
  clearBridgePointer,
  decideStandalonePointerReuse,
  getBridgePointerPath,
  readBridgePointer,
  stampBridgePointer,
  writeBridgePointer,
} = await import('../bridgePointer.js')

const priorConfigDir = process.env.CLAUDE_CONFIG_DIR
let configDir: string
let projectDir: string

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'cc-bridge-ptr-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  projectDir = join(configDir, 'proj')
  await mkdir(projectDir, { recursive: true })
})

afterEach(async () => {
  if (priorConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = priorConfigDir
  }
  await rm(configDir, { recursive: true, force: true })
})

const standalone = {
  sessionId: 'session_aaa',
  environmentId: 'env_bbb',
  source: 'standalone' as const,
}

describe('bridgePointer densable 2.1.238 YKT/JKT/FDl', () => {
  test('schema accepts optional pid/procStart and returns boolean', async () => {
    const ok = await writeBridgePointer(projectDir, {
      ...standalone,
      pid: 4242,
      procStart: 'Wed Jan  1 00:00:00 2025',
    })
    expect(ok).toBe(true)
    const read = await readBridgePointer(projectDir)
    expect(read?.sessionId).toBe('session_aaa')
    expect(read?.environmentId).toBe('env_bbb')
    expect(read?.source).toBe('standalone')
    expect(read?.pid).toBe(4242)
    expect(read?.procStart).toBe('Wed Jan  1 00:00:00 2025')
    expect(read?.ageMs).toBeGreaterThanOrEqual(0)
  })

  test('pre-pid pointer still parses (crash-recovery of old files)', async () => {
    const path = getBridgePointerPath(projectDir)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path,
      JSON.stringify({
        sessionId: 'session_old',
        environmentId: 'env_old',
        source: 'standalone',
      }),
      'utf8',
    )
    const read = await readBridgePointer(projectDir)
    expect(read?.sessionId).toBe('session_old')
    expect(read?.pid).toBeUndefined()
    expect(read?.procStart).toBeUndefined()
  })

  test('stampBridgePointer writes pid + procStart', async () => {
    const ok = await stampBridgePointer(projectDir, standalone)
    expect(ok).toBe(true)
    const read = await readBridgePointer(projectDir)
    expect(read?.pid).toBe(process.pid)
    expect(
      typeof read?.procStart === 'string' || read?.procStart === undefined,
    ).toBe(true)
  })

  test('writer-alive standalone pointer defers', async () => {
    const decision = await decideStandalonePointerReuse(
      { ...standalone, pid: 9999, procStart: 'lstart', ageMs: 12 },
      {
        pid: process.pid,
        isProcessRunning: () => true,
        isSameProcessAsync: async () => true,
      },
    )
    expect(decision).toEqual({ kind: 'defer', pid: 9999 })
  })

  test('writer-dead standalone pointer reuses env+session', async () => {
    const decision = await decideStandalonePointerReuse(
      { ...standalone, pid: 9999, procStart: 'lstart', ageMs: 42 },
      {
        pid: process.pid,
        isProcessRunning: () => false,
        isSameProcessAsync: async () => true,
      },
    )
    expect(decision).toEqual({
      kind: 'reuse',
      environmentId: 'env_bbb',
      sessionId: 'session_aaa',
      ageMs: 42,
    })
  })

  test('pre-pid standalone pointer reuses (pid optional)', async () => {
    const decision = await decideStandalonePointerReuse({
      ...standalone,
      ageMs: 7,
    })
    expect(decision.kind).toBe('reuse')
    if (decision.kind === 'reuse') {
      expect(decision.environmentId).toBe('env_bbb')
    }
  })

  test('repl source does not standalone-reuse even if writer is dead', async () => {
    const decision = await decideStandalonePointerReuse(
      {
        sessionId: 'session_repl',
        environmentId: 'env_repl',
        source: 'repl',
        pid: 9999,
        ageMs: 1,
      },
      {
        isProcessRunning: () => false,
        isSameProcessAsync: async () => false,
      },
    )
    expect(decision).toEqual({ kind: 'none' })
  })

  test('same pid as self is not occupancy (falls through to reuse)', async () => {
    const decision = await decideStandalonePointerReuse(
      { ...standalone, pid: process.pid, ageMs: 1 },
      {
        isProcessRunning: () => true,
        isSameProcessAsync: async () => true,
      },
    )
    expect(decision.kind).toBe('reuse')
  })

  test('noClear leaves stale pointer on disk', async () => {
    await writeBridgePointer(projectDir, standalone)
    const path = getBridgePointerPath(projectDir)
    const stale = Date.now() / 1000 - (BRIDGE_POINTER_TTL_MS / 1000 + 60)
    await utimes(path, stale, stale)

    const skipped = await readBridgePointer(projectDir, { noClear: true })
    expect(skipped).toBeNull()
    await stat(path)

    const cleared = await readBridgePointer(projectDir)
    expect(cleared).toBeNull()
    await expect(stat(path)).rejects.toThrow()
  })

  test('noClear leaves invalid schema on disk', async () => {
    const path = getBridgePointerPath(projectDir)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{"nope":true}', 'utf8')

    const skipped = await readBridgePointer(projectDir, { noClear: true })
    expect(skipped).toBeNull()
    expect(await readFile(path, 'utf8')).toBe('{"nope":true}')

    const cleared = await readBridgePointer(projectDir)
    expect(cleared).toBeNull()
    await expect(stat(path)).rejects.toThrow()
  })

  test('write failure returns false without throwing', async () => {
    // getBridgePointerPath = projectsDir / sanitize(dir) / bridge-pointer.json.
    // Make `projects` a file so mkdir(dirname) fails (ENOTDIR). `/dev/null`
    // cannot be used: sanitizePath writes under CLAUDE_CONFIG_DIR.
    await writeFile(join(configDir, 'projects'), 'not-a-dir')
    const ok = await writeBridgePointer(projectDir, standalone)
    expect(ok).toBe(false)
  })

  test('clearBridgePointer is idempotent', async () => {
    await clearBridgePointer(projectDir)
    await writeBridgePointer(projectDir, standalone)
    await clearBridgePointer(projectDir)
    await clearBridgePointer(projectDir)
    expect(await readBridgePointer(projectDir)).toBeNull()
  })
})
