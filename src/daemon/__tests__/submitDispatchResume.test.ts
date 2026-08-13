import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('submitDispatch resume/fork path (official Hbe subset)', () => {
  const prevHome = process.env.CLAUDE_CONFIG_DIR
  let dir: string

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevHome
    if (dir) rmSync(dir, { recursive: true, force: true })
    mock.restore()
  })

  test('dispatch payload includes nonce for short-alive discrimination', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dispatch-nonce-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    const { submitDispatch } = await import('../bgManager.js')
    await submitDispatch({
      intent: 'nonce check',
      source: 'fleet',
    })

    const { getDispatchDir } = await import('../bgWorker.js')
    const dispatchDir = getDispatchDir()
    const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    const payload = JSON.parse(
      readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
    ) as { nonce?: string; short: string }
    expect(typeof payload.nonce).toBe('string')
    expect(payload.nonce!.length).toBeGreaterThanOrEqual(4)
  })

  test('builds launch.mode=resume with fork for exit handoff', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dispatch-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    const { submitDispatch } = await import('../bgManager.js')
    const result = await submitDispatch({
      intent: 'continue work',
      name: 'exit-job',
      source: 'exit',
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      forkSession: true,
      extraArgs: ['--reply-on-resume'],
    })

    expect(result.short).toHaveLength(8)

    const { getDispatchDir } = await import('../bgWorker.js')
    const dispatchDir = getDispatchDir()
    const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(
      readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
    ) as {
      launch: {
        mode: string
        sessionId?: string
        fork?: boolean
        flagArgs?: string[]
      }
      source: string
    }
    expect(payload.source).toBe('exit')
    expect(payload.launch.mode).toBe('resume')
    expect(payload.launch.sessionId).toBe(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    )
    expect(payload.launch.fork).toBe(true)
    expect(payload.launch.flagArgs).toContain('--reply-on-resume')
    // Must not use the old print-mode argv that left orphan -p children.
    expect(JSON.stringify(payload)).not.toContain('"-p"')
  })

  test('throws when control ack reports settled crashed (densable yNo fail)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dispatch-crash-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({
        ok: true,
        op: 'dispatch',
        short: 'deadbeef',
        settled: 'crashed',
      }),
      isDaemonReachable: async () => true,
    }))

    const { submitDispatch } = await import('../bgManager.js')
    await expect(
      submitDispatch({
        intent: 'x',
        source: 'exit',
        resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        forkSession: true,
      }),
    ).rejects.toThrow(/settled immediately \(crashed\)/)
  })

  test('throws on worker ack timeout — no file fallback (ETIMEOUT)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dispatch-timeout-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({
        ok: false,
        op: 'dispatch',
        short: 'deadbeef',
        timeout: true,
        code: 'ETIMEOUT',
        error: 'worker ack timeout',
      }),
      isDaemonReachable: async () => true,
    }))

    const { submitDispatch } = await import('../bgManager.js')
    await expect(
      submitDispatch({
        intent: 'x',
        source: 'left_arrow',
        resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        forkSession: true,
      }),
    ).rejects.toThrow(/worker ack timeout/)

    // Must not write file-fallback dispatch (would double-dispatch)
    const { getDispatchDir } = await import('../bgWorker.js')
    const dispatchDir = getDispatchDir()
    let files: string[] = []
    try {
      files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    } catch {
      files = []
    }
    expect(files).toEqual([])
  })

  test('EALIVE / short_alive throws with alive:true — no file fallback', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dispatch-ealive-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({
        ok: false,
        op: 'dispatch',
        short: 'deadbeef',
        code: 'EALIVE',
        alive: true,
        error:
          'Session deadbeef is already running — `claude attach deadbeef` to join it',
      }),
      isDaemonReachable: async () => true,
    }))

    const { submitDispatch, isSubmitDispatchAliveError } = await import(
      '../bgManager.js'
    )
    let caught: unknown
    try {
      await submitDispatch({
        intent: 'x',
        source: 'left_arrow',
        resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        forkSession: true,
        providedSessionId: 'deadbeef-1111-2222-3333-444444444444',
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    expect(isSubmitDispatchAliveError(caught)).toBe(true)
    expect((caught as { reason?: string }).reason).toBe('short_alive')
    expect((caught as { code?: string }).code).toBe('EALIVE')

    const { getDispatchDir } = await import('../bgWorker.js')
    const dispatchDir = getDispatchDir()
    let files: string[] = []
    try {
      files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    } catch {
      files = []
    }
    expect(files).toEqual([])
  })

  test('exec path: launch.mode=exec via densable $F_ + routine field', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dispatch-exec-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    const prevShell = process.env.SHELL
    process.env.SHELL = '/bin/zsh'

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    try {
      const { submitDispatch } = await import('../bgManager.js')
      const result = await submitDispatch({
        intent: 'ignored-when-exec',
        exec: 'echo hello',
        routine: 'nightly-review',
        source: 'fleet',
      })
      expect(result.short).toHaveLength(8)

      const { getDispatchDir } = await import('../bgWorker.js')
      const dispatchDir = getDispatchDir()
      const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
      expect(files.length).toBeGreaterThanOrEqual(1)
      const payload = JSON.parse(
        readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
      ) as {
        intent: string
        routine?: string
        launch: {
          mode: string
          cmd?: string
          args?: string[]
          sessionId?: string
        }
        source: string
      }
      expect(payload.source).toBe('fleet')
      expect(payload.intent).toBe('echo hello')
      expect(payload.routine).toBe('nightly-review')
      expect(payload.launch.mode).toBe('exec')
      expect(payload.launch.cmd).toBe('/bin/zsh')
      expect(payload.launch.args).toEqual(['-c', 'echo hello'])
      // Must not fall back to Claude prompt/resume argv for bash jobs.
      expect(payload.launch.sessionId).toBeUndefined()
      expect(JSON.stringify(payload.launch)).not.toContain('--session-id')
    } finally {
      if (prevShell === undefined) delete process.env.SHELL
      else process.env.SHELL = prevShell
    }
  })

  test('whitespace-only exec does not force mode=exec', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dispatch-exec-ws-'))
    process.env.CLAUDE_CONFIG_DIR = dir

    mock.module('../controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    const { submitDispatch } = await import('../bgManager.js')
    await submitDispatch({
      intent: 'real prompt work',
      exec: '   ',
      source: 'fleet',
    })

    const { getDispatchDir } = await import('../bgWorker.js')
    const dispatchDir = getDispatchDir()
    const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    const payload = JSON.parse(
      readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
    ) as { launch: { mode: string } }
    expect(payload.launch.mode).toBe('prompt')
  })
})

describe('ghost-job guards (#2 claimSpare / awaitWorkerAck)', () => {
  test('claimSpare is async and await-sendClaim-before-register in source', async () => {
    // Structural: densable D3q registered handle then fire-and-forget sendClaim.
    // Local product fix awaits sendClaim, only then BgWorker.claim; fail → throw.
    const bgSpareSrc = await Bun.file(
      new URL('../bgSpare.ts', import.meta.url).pathname,
    ).text()
    expect(bgSpareSrc).toMatch(/export async function claimSpare\s*\(/)
    expect(bgSpareSrc).toMatch(/await sendClaim\(/)
    // throw after killSparePty so bgManager can cold-spawn
    expect(bgSpareSrc).toMatch(/killSparePty\([\s\S]*?throw err/)
    // BgWorker.claim only after successful sendClaim (outside catch)
    const claimIdx = bgSpareSrc.indexOf('export async function claimSpare')
    const slice = bgSpareSrc.slice(claimIdx, claimIdx + 2500)
    const awaitSend = slice.indexOf('await sendClaim')
    const bgClaim = slice.indexOf('BgWorker.claim')
    expect(awaitSend).toBeGreaterThan(0)
    expect(bgClaim).toBeGreaterThan(awaitSend)

    const bgManagerSrc = await Bun.file(
      new URL('../bgManager.ts', import.meta.url).pathname,
    ).text()
    // register only in .then(worker => handles.set(...))
    expect(bgManagerSrc).toMatch(
      /void claimSpare\([\s\S]*?\.then\(worker =>[\s\S]*?handles\.set\(req\.short, worker\)/,
    )
    expect(bgManagerSrc).toMatch(/coldSpawn\(req, afterUpgrade\)/)
    // Product: occupy short while awaiting sendClaim (no handle yet)
    expect(bgManagerSrc).toMatch(/claimingShorts\.add\(req\.short\)/)
    expect(bgManagerSrc).toMatch(/claimingShorts\.has\(req\.short\)/)
  })

  test('awaitWorkerAck polls for missing handle — never immediate ok:true', async () => {
    const src = await Bun.file(
      new URL('../bgManager.ts', import.meta.url).pathname,
    ).text()
    const idx = src.indexOf('function awaitWorkerAck(')
    expect(idx).toBeGreaterThan(0)
    const body = src.slice(idx, idx + 5500)
    // Poll loop + ETIMEOUT on deadline
    expect(body).toMatch(/setTimeout\(poll,\s*25\)/)
    expect(body).toMatch(/code:\s*'ETIMEOUT'/)
    expect(body).toMatch(/error:\s*'worker ack timeout'/)
    // Mid-claim: do not ETIMEOUT solely because handles empty
    expect(body).toMatch(/stillClaiming/)
    expect(body).toMatch(/claimingShorts\?\.has\(short\)/)
    // Must not short-circuit missing worker to ok:true (ghost ack)
    expect(body).not.toMatch(
      /if\s*\(\s*!worker\s*\)\s*\{[\s\S]{0,80}ok:\s*true/,
    )
    // Always async via finish()
    expect(body).toMatch(/return null \/\/ Always async respond via finish\(\)/)
  })

  test('dispatch ack timeout covers claimSpare sendClaim budget', async () => {
    const src = await Bun.file(
      new URL('../bgManager.ts', import.meta.url).pathname,
    ).text()
    // Client/server must share budget > sendClaim 5s (was 5_000 → race).
    // Product uses DEFAULT_WORKER_ACK_TIMEOUT_MS directly (no DISPATCH_ACK alias).
    expect(src).toMatch(/DEFAULT_WORKER_ACK_TIMEOUT_MS\s*=\s*12_000/)
    expect(src).toMatch(/ackTimeoutMs:\s*DEFAULT_WORKER_ACK_TIMEOUT_MS/)
    expect(src).toMatch(
      /timeout\s*=\s*timeoutMs\s*\?\?\s*DEFAULT_WORKER_ACK_TIMEOUT_MS/,
    )
  })

  test('product vs densable sWa: await sendClaim before handles.set', async () => {
    // densable sWa: claim() + o.set(short) then fire-and-forget qlT(sendClaim).
    // Local intentionally awaits sendClaim before BgWorker.claim/register.
    // Runtime e2e of slow claim is covered by claimingShorts + 12s ack budget
    // structural gates above — not by re-implementing gold fire-and-forget.
    const bgSpareSrc = await Bun.file(
      new URL('../bgSpare.ts', import.meta.url).pathname,
    ).text()
    expect(bgSpareSrc).toMatch(/densable sWa/)
    expect(bgSpareSrc).toMatch(/Local product \(intentional/)
    const claimIdx = bgSpareSrc.indexOf('export async function claimSpare')
    const slice = bgSpareSrc.slice(claimIdx, claimIdx + 2000)
    expect(slice.indexOf('await sendClaim')).toBeGreaterThan(0)
    expect(slice.indexOf('BgWorker.claim')).toBeGreaterThan(
      slice.indexOf('await sendClaim'),
    )
  })
})
