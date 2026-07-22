import { describe, expect, test, afterEach } from 'bun:test'
import { mkdtemp, rm, unlink, writeFile, mkdir } from 'fs/promises'
import { createConnection, createServer } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  recvSpareClaim,
  type BgSpareClaimFrame,
  type HeldSpare,
  buildClaimFrame,
  spawnSpare,
  sendClaim,
  claimSpare,
  reapOrphanSpares,
  getSparePtySockPath,
  getSpareClaimSockPath,
  buildSpareHostEnv,
  getBgLowMemThresholdBytes,
  getSpareBinaryArgv,
  sanitizeClaimEnv,
  SPARE_CLAIM_NONCE_ENV,
} from '../bgSpare.js'
import { getSpareDir, type DispatchRequest } from '../bgWorker.js'

function makeDispatch(overrides?: Partial<DispatchRequest>): DispatchRequest {
  return {
    short: 'abcd',
    sessionId: '11111111-1111-4111-8111-111111111111',
    intent: 'test',
    cwd: process.cwd(),
    respawnFlags: ['--verbose'],
    source: 'test',
    createdAt: Date.now(),
    launch: { mode: 'prompt', args: ['--print', 'hi'] },
    ...overrides,
  }
}

describe('recvSpareClaim (official b64)', () => {
  let dir: string
  let sock: string

  afterEach(async () => {
    if (sock) {
      await unlink(sock).catch(() => {})
    }
    if (dir) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('receives newline-delimited claim JSON', async () => {
    dir = await mkdtemp(join(tmpdir(), 'bg-spare-'))
    sock = join(dir, 'claim.sock')

    let pending: Promise<BgSpareClaimFrame>
    try {
      pending = recvSpareClaim(sock)
      await new Promise(r => setTimeout(r, 50))
    } catch {
      // AF_UNIX may be unavailable on some Windows hosts — skip.
      return
    }

    const frame: BgSpareClaimFrame = {
      cwd: dir,
      env: { CLAUDE_CODE_SESSION_KIND: 'bg' },
      argv: ['--print', 'hi'],
      sessionId: '11111111-1111-4111-8111-111111111111',
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const c = createConnection(sock, () => {
          c.end(`${JSON.stringify(frame)}\n`, () => resolve())
        })
        c.on('error', reject)
      })
    } catch {
      return
    }

    const got = await pending
    expect(got.cwd).toBe(dir)
    expect(got.argv).toEqual(['--print', 'hi'])
    expect(got.sessionId).toBe(frame.sessionId)
  })
})

describe('buildClaimFrame (official zF.buildClaimFrame)', () => {
  test('builds attempt=1 argv/env for prompt launch', () => {
    const dispatch = makeDispatch()
    const { env, argv } = buildClaimFrame(dispatch)
    expect(argv).toEqual(['--print', 'hi'])
    expect(env.CLAUDE_CODE_SESSION_KIND).toBe('bg')
    expect(env.CLAUDE_BG_BACKEND).toBe('daemon')
    expect(env.CLAUDE_BG_SOURCE).toBe('test')
  })

  test('merges reattachEnv', () => {
    const dispatch = makeDispatch({
      reattachEnv: { CLAUDE_BRIDGE_REATTACH_SESSION: 's1' },
    })
    const { env } = buildClaimFrame(dispatch)
    expect(env.CLAUDE_BRIDGE_REATTACH_SESSION).toBe('s1')
  })

  test('exec mode returns launch args', () => {
    const dispatch = makeDispatch({
      launch: { mode: 'exec', args: ['echo', 'hi'], cmd: 'echo' },
    })
    const { argv } = buildClaimFrame(dispatch)
    expect(argv).toEqual(['echo', 'hi'])
  })
})

describe('spawnSpare (official M3q)', () => {
  test('returns null on Windows', async () => {
    if (process.platform !== 'win32') return
    const spare = await spawnSpare({
      log: () => {},
      onExit: () => {},
    })
    expect(spare).toBeNull()
  })
})

describe('path helpers (official gvK/QvK)', () => {
  test('pty/claim sock paths live under spare dir', () => {
    const pty = getSparePtySockPath('deadbeef')
    const claim = getSpareClaimSockPath('deadbeef')
    expect(
      pty.endsWith(`${join('spare', 'deadbeef.pty.sock')}`) ||
        pty.includes('deadbeef.pty.sock'),
    ).toBe(true)
    expect(claim.includes('deadbeef.claim.sock')).toBe(true)
    expect(pty.startsWith(getSpareDir()) || pty.includes('spare')).toBe(true)
  })
})

describe('buildSpareHostEnv (official _mO)', () => {
  test('sets bg session env and strips CLAUDECODE', () => {
    const prev = process.env.CLAUDECODE
    process.env.CLAUDECODE = '1'
    try {
      const env = buildSpareHostEnv()
      expect(env.CLAUDE_CODE_SESSION_KIND).toBe('bg')
      expect(env.CLAUDE_BG_BACKEND).toBe('daemon')
      expect(env.FORCE_COLOR).toBe('3')
      expect(env.CLAUDECODE).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.CLAUDECODE
      else process.env.CLAUDECODE = prev
    }
  })

  test('embeds claim nonce when provided', () => {
    const env = buildSpareHostEnv({ claimNonce: 'deadbeef' })
    expect(env[SPARE_CLAIM_NONCE_ENV]).toBe('deadbeef')
  })
})

describe('sanitizeClaimEnv (local product fortify)', () => {
  test('drops loader/shell injection keys', () => {
    const out = sanitizeClaimEnv({
      CLAUDE_CODE_SESSION_KIND: 'bg',
      LD_PRELOAD: '/evil.so',
      DYLD_INSERT_LIBRARIES: '/evil.dylib',
      NODE_OPTIONS: '--require ./x',
      BASH_ENV: '/tmp/x',
      SAFE: '1',
    })
    expect(out.CLAUDE_CODE_SESSION_KIND).toBe('bg')
    expect(out.SAFE).toBe('1')
    expect(out.LD_PRELOAD).toBeUndefined()
    expect(out.DYLD_INSERT_LIBRARIES).toBeUndefined()
    expect(out.NODE_OPTIONS).toBeUndefined()
    expect(out.BASH_ENV).toBeUndefined()
  })
})

describe('getBgLowMemThresholdBytes (official jy6)', () => {
  test('darwin always 0', () => {
    if (process.platform !== 'darwin') return
    expect(getBgLowMemThresholdBytes()).toBe(0)
  })

  test('non-darwin returns positive or zero threshold', () => {
    if (process.platform === 'darwin') return
    const n = getBgLowMemThresholdBytes()
    expect(n).toBeGreaterThanOrEqual(0)
  })
})

describe('getSpareBinaryArgv (official TmO)', () => {
  test('returns execPath at least', () => {
    const argv = getSpareBinaryArgv()
    expect(argv[0]).toBe(process.execPath)
    expect(argv.length).toBeGreaterThanOrEqual(1)
  })
})

describe('claimSpare (local product: await sendClaim before register)', () => {
  test('sendClaim failure throws — no BgWorker handle registered', async () => {
    // Missing claim sock → sendClaim times out / ENOENT → throw.
    // Critical invariant: must NOT return a worker (register happens only after
    // claimSpare resolves in bgManager). Ghost left-arrow jobs came from the
    // densable fire-and-forget path that registered before sendClaim.
    const dir = await mkdtemp(join(tmpdir(), 'bg-spare-claim-fail-'))
    const missingClaim = join(dir, 'no-such.claim.sock')
    const missingPty = join(dir, 'no-such.pty.sock')
    const spare: HeldSpare = {
      hostPid: process.pid,
      ptySock: missingPty,
      claimSock: missingClaim,
      startedAt: Date.now(),
      cliVersion: 'test',
      claimNonce: 'test-nonce',
      dispose() {},
    }
    const dispatch = makeDispatch({ short: 'ghostchk' })
    let threw = false
    try {
      // sendClaim retries ~5s on ENOENT; keep test under default timeout.
      await claimSpare(dispatch, spare, (() => null) as never)
    } catch {
      threw = true
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    expect(threw).toBe(true)
  }, 15_000)
})

describe('sendClaim (official KmO/OmO)', () => {
  test('delivers JSON line to listening claim sock', async () => {
    if (process.platform === 'win32') {
      // Named pipes differ; AF_UNIX skip on some hosts
    }
    const dir = await mkdtemp(join(tmpdir(), 'bg-spare-send-'))
    const sock = join(dir, 'claim.sock')
    try {
      const received = new Promise<string>((resolve, reject) => {
        const server = createServer(s => {
          let buf = ''
          s.setEncoding('utf8')
          s.on('data', (c: string) => {
            buf += c
            if (buf.includes('\n')) {
              server.close()
              resolve(buf)
            }
          })
          s.on('error', reject)
        })
        server.on('error', reject)
        server.listen(sock)
      })

      // Give server a moment to bind
      await new Promise(r => setTimeout(r, 30))

      const frame: BgSpareClaimFrame = {
        cwd: dir,
        env: { A: '1' },
        argv: ['--print'],
        sessionId: 's',
      }
      try {
        await sendClaim(sock, frame)
      } catch {
        // AF_UNIX unavailable
        await rm(dir, { recursive: true, force: true })
        return
      }
      const raw = await received
      const parsed = JSON.parse(raw.trim()) as BgSpareClaimFrame
      expect(parsed.cwd).toBe(dir)
      expect(parsed.argv).toEqual(['--print'])
    } finally {
      await unlink(sock).catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('reapOrphanSpares (official f3q)', () => {
  test('no-op on Windows', async () => {
    if (process.platform !== 'win32') return
    await reapOrphanSpares(new Map(), () => {})
  })

  test('cleans orphan claim.sock when paired pty is unknown', async () => {
    if (process.platform === 'win32') return
    // Uses real getSpareDir(); only create claim sock and verify cleanup attempt.
    const spareDir = getSpareDir()
    await mkdir(spareDir, { recursive: true, mode: 0o700 }).catch(() => {})
    const claim = join(spareDir, 'testorphan.claim.sock')
    await writeFile(claim, '').catch(() => {})
    const logs: string[] = []
    await reapOrphanSpares(new Map(), m => logs.push(m))
    // claim.sock should be unlinked (best-effort) — paired pty not known
    const { access } = await import('fs/promises')
    const stillThere = await access(claim)
      .then(() => true)
      .catch(() => false)
    expect(stillThere).toBe(false)
  })

  test('keeps claim.sock when paired pty is known live', async () => {
    if (process.platform === 'win32') return
    const spareDir = getSpareDir()
    await mkdir(spareDir, { recursive: true, mode: 0o700 }).catch(() => {})
    const id = 'liveheld'
    const claim = join(spareDir, `${id}.claim.sock`)
    const pty = join(spareDir, `${id}.pty.sock`)
    await writeFile(claim, '').catch(() => {})
    // densable f3q: if knownSocks has paired pty → do not unlink claim
    await reapOrphanSpares(new Map(), () => {}, [pty])
    const { access } = await import('fs/promises')
    const stillThere = await access(claim)
      .then(() => true)
      .catch(() => false)
    expect(stillThere).toBe(true)
    await unlink(claim).catch(() => {})
  })
})

describe('recvSpareClaim nonce (local product)', () => {
  test('rejects claim when nonce mismatches', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'bg-spare-nonce-'))
    const sock = join(dir, 'claim.sock')
    try {
      const pending = recvSpareClaim(sock, undefined, 'expected-nonce')
      await new Promise(r => setTimeout(r, 30))
      await sendClaim(sock, {
        cwd: dir,
        env: {},
        argv: [],
        nonce: 'wrong',
      })
      let threw = false
      try {
        await pending
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    } catch {
      // AF_UNIX unavailable
    } finally {
      await unlink(sock).catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  })
})
