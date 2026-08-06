import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('xSeSpawn densable e6_/xSe shell', () => {
  const prevHome = process.env.CLAUDE_CONFIG_DIR
  let dir: string

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevHome
    if (dir) rmSync(dir, { recursive: true, force: true })
    mock.restore()
  })

  test('e6_ blocks --print', async () => {
    const { gateBgSpawnArgs } = await import('../xSeSpawn.js')
    const msg = gateBgSpawnArgs(['--bg', '--print', 'hi'])
    expect(msg).toContain('--bg and --print conflict')
  })

  test('e6_ blocks -p short', async () => {
    const { gateBgSpawnArgs } = await import('../xSeSpawn.js')
    expect(gateBgSpawnArgs(['-p', 'hi'])).toContain('--print')
  })

  test('mkdir tmp + file fallback offline (fleet skips seed)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'xse-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    const { xSeSpawn } = await import('../xSeSpawn.js')
    const r = await xSeSpawn({
      intent: 'hello world',
      source: 'fleet',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // jobDir/tmp created
    const { getJobDirPath } = await import('../jobState.js')
    const jobDir = getJobDirPath(r.short)
    expect(existsSync(join(jobDir, 'tmp'))).toBe(true)
    // fleet skip seed → no state.json required
    const { getDispatchDir } = await import('../bgWorker.js')
    const files = readdirSync(getDispatchDir()).filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(1)
  })

  test('ack-timeout rescue when list shows live short+nonce', async () => {
    dir = mkdtempSync(join(tmpdir(), 'xse-rescue-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    let dispatchPayload: { short?: string; nonce?: string } | null = null
    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async (req: {
        op?: string
        d?: { short?: string; nonce?: string }
      }) => {
        if (req.op === 'dispatch' && !dispatchPayload) {
          dispatchPayload = req.d ?? null
          return {
            ok: false,
            timeout: true,
            code: 'ETIMEOUT',
            reason: 'ack-timeout',
          }
        }
        if (req.op === 'list') {
          return {
            ok: true,
            op: 'list',
            jobs: [
              {
                short: dispatchPayload?.short,
                nonce: dispatchPayload?.nonce,
                outcome: undefined,
              },
            ],
          }
        }
        return { ok: false, error: 'no' }
      },
      isDaemonReachable: async () => true,
    }))

    // Fresh import after mock
    const mod = await import('../xSeSpawn.js')
    const r = await mod.xSeSpawn({
      intent: 'rescue me',
      source: 'exit',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rescued).toBe(true)
  })

  test('submitDispatch maps xSe short_alive to throw alive', async () => {
    dir = mkdtempSync(join(tmpdir(), 'xse-alive-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({
        ok: false,
        code: 'EALIVE',
        reason: 'short-alive',
        alive: true,
        error: 'Session abcd1234 is already running',
      }),
      isDaemonReachable: async () => true,
    }))

    // Re-import bgManager after mock — use dynamic path
    const { submitDispatch, isSubmitDispatchAliveError } = await import(
      '../bgManager.js'
    )
    try {
      await submitDispatch({ intent: 'x', source: 'fleet' })
      expect(true).toBe(false)
    } catch (e) {
      expect(isSubmitDispatchAliveError(e)).toBe(true)
    }
  })

  test('gate_blocked returns without dispatch', async () => {
    dir = mkdtempSync(join(tmpdir(), 'xse-gate-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    let called = 0
    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => {
        called++
        return { ok: false, error: 'offline' }
      },
      isDaemonReachable: async () => false,
    }))
    const { xSeSpawn } = await import('../xSeSpawn.js')
    const r = await xSeSpawn({
      intent: 'x',
      argv: ['--print', 'nope'],
      source: 'shell',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('gate_blocked')
    expect(called).toBe(0)
  })

  test('shell source seeds state.json (non-fleet)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'xse-shell-seed-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))
    const { xSeSpawn } = await import('../xSeSpawn.js')
    const r = await xSeSpawn({
      intent: 'seed me please',
      source: 'shell',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { readBgJobState } = await import('../jobState.js')
    const st = readBgJobState(r.short)
    expect(st?.state).toBe('starting')
    expect(st?.intent).toContain('seed me')
  })
})
