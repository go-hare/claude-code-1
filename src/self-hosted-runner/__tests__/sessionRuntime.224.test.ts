/**
 * densable 2.1.224 #1 residual MISS set:
 * B2h / xjv / Ijv / Bjv / Fjv / W2h / z2h.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DIAGNOSTICS_MAX_LINES,
  acceptRemoteCwdUnderSession,
  cleanupSessionIngressToken,
  cleanupSessionSideFiles,
  createIngressFenceBgController,
  ensureDirsUnderSessionRoot,
  forwardDebugLogDiagnostics,
  inferenceRefreshIntervalMs,
  initMilestoneEvent,
  isRealpathUnderSessionRoot,
  startIntervalRefreshLoop,
} from '../sessionRuntime.js'
import { resolveUnderSessionRoot } from '../sessionSeed.js'
import { sessionIngressTokenPath } from '../sessionChild.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

function tmp(): string {
  const d = join(
    tmpdir(),
    `shr-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

describe('densable 2.1.224 #1 sessionRuntime (W2h/z2h/Bjv)', () => {
  test('inferenceRefreshIntervalMs (W2h)', () => {
    expect(inferenceRefreshIntervalMs(undefined)).toBe(1_440_000)
    expect(inferenceRefreshIntervalMs(0)).toBe(1_440_000)
    expect(inferenceRefreshIntervalMs(10)).toBe(30_000) // floor
    expect(inferenceRefreshIntervalMs(100)).toBe(80_000) // 80%
    expect(inferenceRefreshIntervalMs(10_000)).toBe(1_440_000) // cap
    expect(DIAGNOSTICS_MAX_LINES).toBe(500)
  })

  test('startIntervalRefreshLoop (z2h) cancel + refresh interval update', async () => {
    const ac = new AbortController()
    let n = 0
    const loop = startIntervalRefreshLoop({
      intervalMs: 20,
      signal: ac.signal,
      refresh: async () => {
        n++
        if (n === 1) return 15
      },
      onError: () => {},
    })
    await Bun.sleep(70)
    loop.cancel()
    const atCancel = n
    await Bun.sleep(50)
    expect(n).toBeGreaterThanOrEqual(1)
    expect(n).toBe(atCancel)
  })

  test('initMilestoneEvent (Bjv)', () => {
    const e = initMilestoneEvent('Preparing foo...')
    expect(e.type).toBe('system')
    expect(e.subtype).toBe('init_milestone')
    expect(e.message).toBe('Preparing foo...')
    expect(typeof e.uuid).toBe('string')
    expect(e.uuid.length).toBeGreaterThan(8)
  })
})

describe('densable 2.1.224 #1 sessionRuntime (xjv/Ijv/B2h/Fjv)', () => {
  test('ensureDirsUnderSessionRoot (xjv) + isRealpathUnderSessionRoot (Ijv)', async () => {
    const root = tmp()
    const nested = join(root, 'a', 'b')
    expect(await ensureDirsUnderSessionRoot(root, nested)).toBe(true)
    expect(await isRealpathUnderSessionRoot(root, nested)).toBe(true)
    expect(await ensureDirsUnderSessionRoot(root, '/etc')).toBe(false)
    // symlink segment rejected
    const real = join(root, 'real')
    mkdirSync(real)
    const link = join(root, 'link')
    symlinkSync(real, link)
    expect(await ensureDirsUnderSessionRoot(root, join(link, 'x'))).toBe(false)
  })

  test('acceptRemoteCwdUnderSession rejects escape', async () => {
    const root = tmp()
    const ok = await acceptRemoteCwdUnderSession(
      root,
      'sub',
      resolveUnderSessionRoot,
    )
    expect(ok).toBe(join(root, 'sub'))
    const bad = await acceptRemoteCwdUnderSession(
      root,
      '/etc/passwd',
      resolveUnderSessionRoot,
    )
    expect(bad).toBeNull()
  })

  test('cleanupSessionIngressToken (B2h) unlinks fence + older tmp', async () => {
    const dir = tmp()
    const fence = sessionIngressTokenPath(dir, 3)
    writeFileSync(fence, 'tok')
    writeFileSync(join(dir, '.session_ingress_token.e2.tmp.abc'), 'old')
    writeFileSync(join(dir, '.session_ingress_token.e3.tmp.xyz'), 'same')
    writeFileSync(join(dir, '.session_ingress_token.e9.tmp.keep'), 'newer')
    const status: string[] = []
    await cleanupSessionIngressToken(fence, m => status.push(m))
    expect(() => readFileSync(fence)).toThrow()
    expect(() =>
      readFileSync(join(dir, '.session_ingress_token.e2.tmp.abc')),
    ).toThrow()
    expect(() =>
      readFileSync(join(dir, '.session_ingress_token.e3.tmp.xyz')),
    ).toThrow()
    expect(
      readFileSync(join(dir, '.session_ingress_token.e9.tmp.keep'), 'utf8'),
    ).toBe('newer')
  })

  test('forwardDebugLogDiagnostics (Fjv)', async () => {
    const dir = tmp()
    const debugFile = join(dir, 'claude-code-debug.txt')
    writeFileSync(debugFile, 'line-a\nline-b\nline-c\n')
    let posted: unknown
    const debug: string[] = []
    await forwardDebugLogDiagnostics({
      apiClient: {
        forwardDiagnostics: async (_b, _s, _t, _e, lines) => {
          posted = lines
        },
      },
      apiBaseUrl: 'https://api.example',
      sessionId: 's1',
      sessionToken: 'tok',
      workerEpoch: 1,
      debugFile,
      onDebug: m => debug.push(m),
    })
    expect(Array.isArray(posted)).toBe(true)
    expect((posted as { fields: { message: string } }[]).length).toBe(3)
    expect(
      (posted as { fields: { message: string } }[])[0]!.fields.message,
    ).toBe('line-a')
    expect(debug.some(m => m.includes('forwarded 3'))).toBe(true)
  })

  test('createIngressFenceBgController (Zt) rewrites with latest token after bg settle', async () => {
    const rewrites: Array<{ path: string; token: string }> = []
    let token = 'tok-old'
    let path: string | undefined = '/tmp/fence'
    let resolveBg!: () => void
    const bg = new Promise<void>(r => {
      resolveBg = r
    })
    const ctrl = createIngressFenceBgController({
      getFencePath: () => path,
      getLatestToken: () => token,
      enqueueRewrite: (p, t, _onBg) => {
        rewrites.push({ path: p, token: t })
      },
    })
    ctrl.onBackground(bg)
    expect(ctrl.hadBackgroundTimeout()).toBe(true)
    token = 'tok-new'
    resolveBg()
    await ctrl.backgroundAll()
    await Bun.sleep(0)
    expect(rewrites).toEqual([{ path: '/tmp/fence', token: 'tok-new' }])

    // densable He — no rewrite after finalize
    rewrites.length = 0
    token = 'tok-after-final'
    const bg2 = Promise.resolve()
    ctrl.markFinalized()
    ctrl.onBackground(bg2)
    await ctrl.backgroundAll()
    await Bun.sleep(0)
    expect(rewrites).toEqual([])
  })

  test('cleanupSessionSideFiles unlinks mcp always; debug only on completed', async () => {
    const dir = tmp()
    const debugFile = join(dir, 'claude-code-debug.txt')
    const mcp = join(dir, 'mcp-config.json')
    writeFileSync(debugFile, 'dbg')
    writeFileSync(mcp, '{}')
    const status: string[] = []
    await cleanupSessionSideFiles({
      sessionId: 's1',
      exitResult: 'failed',
      debugFile,
      mcpConfigPath: mcp,
      onStatus: m => status.push(m),
    })
    expect(readFileSync(debugFile, 'utf8')).toBe('dbg')
    expect(() => readFileSync(mcp)).toThrow()
    expect(status.some(m => m.includes('preserved'))).toBe(true)

    writeFileSync(mcp, '{}')
    await cleanupSessionSideFiles({
      sessionId: 's1',
      exitResult: 'completed',
      debugFile,
      mcpConfigPath: mcp,
      onStatus: () => {},
    })
    expect(() => readFileSync(debugFile)).toThrow()
    expect(() => readFileSync(mcp)).toThrow()
  })
})
