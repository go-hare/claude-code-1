import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { zipSync } from 'fflate'
import { reapOrphanSpares } from '../../../daemon/bgSpare.js'
import {
  BgWorker,
  type DispatchRequest,
  PersistentPtyAuthMap,
  type RosterEntry,
  loadPersistedPtyAuthTokens,
  savePersistedPtyAuthTokens,
} from '../../../daemon/bgWorker.js'
import {
  CTRL_FRAME,
  createFrameParser,
  encodeCtrlFrame,
} from '../../../daemon/ptyHost.js'
import { deployBinary } from '../../../ssh/SSHDeploy.js'
import { probeRemote, validateSshHost } from '../../../ssh/SSHProbe.js'
import {
  createSSHSession,
  formatPosixRemoteCli,
  posixSingleQuote,
} from '../../../ssh/createSSHSession.js'
import { buildWindowsTerminalLaunchSpec } from '../../../utils/computerUse/executorCrossPlatform.js'
import { escapePowerShellSingleQuoted } from '../../../utils/computerUse/win32/uiAutomation.js'
import { isPathSafe, unzipFile } from '../../../utils/dxt/zip.js'
import type { ssrfGuardedLookup } from '../../../utils/hooks/ssrfGuard.js'
import { normalizeWindowsDeniesConfig } from '../../../utils/sandbox/adapter/wrapCommands.js'
import {
  createAuthFetch,
  wrapAuthFetchWithHeaders,
  wrapFetchWithOAuthRedirectGuard,
} from '../auth.js'
import {
  type McpTransportBuildState,
  recreateMcpTransportForPinnedLegacy,
} from '../client/connectTransports.js'
import { markCliOwnedConfig } from '../cliOwnedConfigs.js'
import { ssrfGuardedOidcFetch } from '../xaaIdpLogin.js'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')

if (typeof (globalThis as Record<string, unknown>).MACRO === 'undefined') {
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: '2.1.331',
    BUILD_TIME: '2026-01-01T00:00:00Z',
    FEEDBACK_CHANNEL: '',
    ISSUES_EXPLAINER: '',
    PACKAGE_URL: '',
    README_URL: '',
    VERSION_CHANGELOG: '',
  }
}

function makeDispatch(overrides?: Partial<DispatchRequest>): DispatchRequest {
  return {
    short: 're5a',
    sessionId: '22222222-2222-4222-8222-222222222222',
    intent: 'reaudit-test',
    cwd: process.cwd(),
    respawnFlags: [],
    source: 'test',
    createdAt: Date.now(),
    launch: { mode: 'prompt', args: ['--print', 'hello'] },
    ...overrides,
  }
}

describe('P0-2 & P1-E7: Daemon PTY auth on BgWorker.claim, BgWorker.adopt, token persistence, and reapOrphanSpares', () => {
  const tempDirs: string[] = []
  const origConfigDir = process.env.CLAUDE_CONFIG_DIR

  afterEach(() => {
    if (origConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = origConfigDir
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('P0-2: BgWorker.claim() connects via connectAuthenticatedPtyHost, authenticates, pongs, and worker.kill() works', async () => {
    if (process.platform === 'win32') return
    const dir = mkdtempSync(join(tmpdir(), 'p0-2-claim-'))
    tempDirs.push(dir)
    const sockPath = join(dir, 'spare.pty.sock')
    const token = 'spare-secret-token-123'
    const frames: Array<Record<string, unknown>> = []

    const server = createNetServer(conn => {
      const parse = createFrameParser(frame => {
        if (frame.kind === CTRL_FRAME) {
          frames.push(frame.ctrl)
          if (frame.ctrl.t === 'auth' && frame.ctrl.token === token) {
            conn.write(encodeCtrlFrame({ t: 'ping' }))
          }
        }
      })
      conn.on('data', parse)
    })
    await new Promise<void>(r => server.listen(sockPath, r))

    // Spawn a real harmless subprocess so process.kill(pid, 0/SIGTERM) is safe
    const dummy = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)'],
      {
        stdio: 'ignore',
      },
    )
    expect(dummy.pid).toBeDefined()

    const worker = BgWorker.claim(makeDispatch({ short: 'clm1' }), {
      pid: dummy.pid!,
      ptySockPath: sockPath,
      spawnPty: () => {
        throw new Error('unused')
      },
      ptyAuthToken: token,
    })

    try {
      // Wait for auth + pong frames to arrive
      for (let i = 0; i < 40; i++) {
        if (
          frames.some(f => f.t === 'auth' && f.token === token) &&
          frames.some(f => f.t === 'pong')
        ) {
          break
        }
        await new Promise(r => setTimeout(r, 25))
      }
      expect(frames.some(f => f.t === 'auth' && f.token === token)).toBe(true)
      expect(frames.some(f => f.t === 'pong')).toBe(true)

      // Calling worker.kill() must send an authenticated kill frame and terminate the process
      worker.kill('SIGTERM')
      for (let i = 0; i < 40; i++) {
        if (frames.some(f => f.t === 'kill' && f.sig === 'SIGTERM')) break
        await new Promise(r => setTimeout(r, 25))
      }
      expect(frames.some(f => f.t === 'kill' && f.sig === 'SIGTERM')).toBe(true)
    } finally {
      worker.stop()
      try {
        dummy.kill('SIGKILL')
      } catch {
        // already dead
      }
      await new Promise<void>(r => server.close(() => r()))
    }
  })

  test('P1-E7: PersistentPtyAuthMap persists with mode 0600, reloads, prunes, BgWorker.adopt authenticates, and reapOrphanSpares sends auth before kill', async () => {
    if (process.platform === 'win32') return
    const dir = mkdtempSync(join(tmpdir(), 'p1-e7-auth-'))
    tempDirs.push(dir)
    process.env.CLAUDE_CONFIG_DIR = dir

    // 1. Mode 0600 persistence, reload across supervisor restart, and prune
    const storePath = join(dir, 'daemon', 'bg', 'auth', 'pty-auth-tokens.json')
    const mapA = new PersistentPtyAuthMap(storePath)
    mapA.set('/tmp/live.sock', 'tok-live')
    mapA.set('/tmp/dead.sock', 'tok-dead')

    const st = statSync(storePath)
    expect(st.mode & 0o777).toBe(0o600)
    const dirSt = statSync(join(dir, 'daemon', 'bg', 'auth'))
    expect(dirSt.mode & 0o777).toBe(0o700)

    const mapB = new PersistentPtyAuthMap(storePath)
    mapB.reload()
    expect(mapB.get('/tmp/live.sock')).toBe('tok-live')
    expect(mapB.get('/tmp/dead.sock')).toBe('tok-dead')

    const pruned = mapB.pruneToLiveSockets(new Set(['/tmp/live.sock']))
    expect(pruned).toBe(1)
    expect(loadPersistedPtyAuthTokens(storePath).has('/tmp/dead.sock')).toBe(
      false,
    )
    expect(loadPersistedPtyAuthTokens(storePath).get('/tmp/live.sock')).toBe(
      'tok-live',
    )

    // savePersistedPtyAuthTokens standalone round-trip
    savePersistedPtyAuthTokens(new Map([['/tmp/a.sock', 'tok-a']]), storePath)
    expect(loadPersistedPtyAuthTokens(storePath).get('/tmp/a.sock')).toBe(
      'tok-a',
    )

    // 2. BgWorker.adopt() sends persisted ptyAuthToken via connectAuthenticatedPtyHost
    const adoptSock = join(dir, 'adopt.pty.sock')
    const adoptToken = 'adopted-token-xyz'
    const adoptFrames: Array<Record<string, unknown>> = []
    const adoptServer = createNetServer(conn => {
      conn.on(
        'data',
        createFrameParser(f => {
          if (f.kind === CTRL_FRAME) adoptFrames.push(f.ctrl)
        }),
      )
    })
    await new Promise<void>(r => adoptServer.listen(adoptSock, r))
    const dummy = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)'],
      {
        stdio: 'ignore',
      },
    )

    const rosterEntry: RosterEntry = {
      pid: dummy.pid!,
      attempt: 1,
      startedAt: Date.now(),
      sessionId: 'sess-adp1',
      cwd: dir,
      dispatch: makeDispatch({ short: 'adp1' }),
      rendezvousSock: join(dir, 'rv-adp1.sock'),
      ptySock: adoptSock,
    }
    const adopted = await BgWorker.adopt(
      'adp1',
      rosterEntry,
      () => {
        throw new Error('unused')
      },
      undefined,
      adoptToken,
    )
    expect(adopted).not.toBeNull()
    try {
      for (let i = 0; i < 40; i++) {
        if (adoptFrames.some(f => f.t === 'auth' && f.token === adoptToken))
          break
        await new Promise(r => setTimeout(r, 25))
      }
      expect(
        adoptFrames.some(f => f.t === 'auth' && f.token === adoptToken),
      ).toBe(true)
    } finally {
      adopted?.stop()
      try {
        dummy.kill('SIGKILL')
      } catch {
        // already dead
      }
      await new Promise<void>(r => adoptServer.close(() => r()))
    }

    // 3. reapOrphanSpares authenticates kill frames using persisted ptyAuthBySock
    const spareDir = join(dir, 'daemon', 'bg', 'spare')
    mkdirSync(spareDir, { recursive: true, mode: 0o700 })
    const orphanSock = join(spareDir, 'orphan1.pty.sock')
    const orphanToken = 'orphan-spare-secret-999'
    const orphanFrames: Array<Record<string, unknown>> = []
    const orphanServer = createNetServer(conn => {
      conn.on(
        'data',
        createFrameParser(f => {
          if (f.kind === CTRL_FRAME) orphanFrames.push(f.ctrl)
        }),
      )
    })
    await new Promise<void>(r => orphanServer.listen(orphanSock, r))

    const orphanAuthMap = new PersistentPtyAuthMap(storePath)
    orphanAuthMap.set(orphanSock, orphanToken)
    try {
      await reapOrphanSpares(new Map(), () => {}, undefined, orphanAuthMap)
      for (let i = 0; i < 40; i++) {
        if (orphanFrames.length >= 2) break
        await new Promise(r => setTimeout(r, 25))
      }
      expect(orphanFrames[0]).toEqual({ t: 'auth', token: orphanToken })
      expect(orphanFrames[1]).toEqual({ t: 'kill', sig: 'SIGTERM' })
    } finally {
      await new Promise<void>(r => orphanServer.close(() => r()))
    }
  })
})

describe('P0-3: normalizeWindowsDeniesConfig sanitizes relative, POSIX, and glob paths for srt-win', () => {
  test('resolves relative allowWrite, strips POSIX-root paths, materializes **/.env* globs, and keeps concrete Windows paths', () => {
    const cwd = 'C:\\Users\\alice\\repo'
    const normalized = normalizeWindowsDeniesConfig(
      {
        allowWrite: [
          '.',
          './dist',
          '/tmp/claude',
          '/run/user/1000',
          'C:\\Users\\alice\\AppData\\Local\\Temp',
          'C:\\Users\\alice\\repo\\**',
          'C:\\bad\\*\\wild',
          '\\\\server\\share\\dir',
        ],
        denyRead: [
          '**/.env',
          '**/.env*',
          'C:\\Users\\alice\\.ssh\\**',
          'C:\\Users\\alice\\.aws',
          '/etc/shadow',
          '~/secrets/token.json',
          'D:\\other\\**\\*.key',
        ],
        denyWrite: [
          '/tmp/inline-comments-buffer.jsonl',
          '/run/secrets',
          '.git/config',
          'C:/Users/alice/repo/.git/hooks',
          'C:\\Users\\alice\\repo\\**\\*.pem',
          '\\\\?\\C:\\Windows',
        ],
      },
      cwd,
      {
        homeDir: 'C:\\Users\\alice',
        existingRelativeFiles: [
          '.env',
          'apps/web/.env.local',
          'src/index.ts',
          'certs/prod.pem',
        ],
      },
    )

    // Relative '.' and './dist' resolved; POSIX/UNC/interior-wildcard entries dropped; deduplicated
    expect(normalized.allowWrite).toEqual([
      'C:\\Users\\alice\\repo',
      'C:\\Users\\alice\\repo\\dist',
      'C:\\Users\\alice\\AppData\\Local\\Temp',
    ])

    // **/.env & **/.env* materialized cleanly, trailing \** collapsed to dir, ~ expanded, POSIX & foreign globs stripped
    expect(normalized.denyRead).toEqual([
      'C:\\Users\\alice\\repo\\.env',
      'C:\\Users\\alice\\repo\\apps\\web\\.env.local',
      'C:\\Users\\alice\\.ssh',
      'C:\\Users\\alice\\.aws',
      'C:\\Users\\alice\\secrets\\token.json',
    ])

    // POSIX-only & verbatim device paths stripped, relative .git/config resolved, *.pem materialized
    expect(normalized.denyWrite).toEqual([
      'C:\\Users\\alice\\repo\\.git\\config',
      'C:\\Users\\alice\\repo\\.git\\hooks',
      'C:\\Users\\alice\\repo\\certs\\prod.pem',
    ])

    // Zero wildcards or POSIX-root paths survive in any array
    for (const p of [
      ...normalized.allowWrite,
      ...normalized.denyRead,
      ...normalized.denyWrite,
    ]) {
      expect(p).toMatch(/^[A-Za-z]:\\/)
      expect(p).not.toContain('*')
      expect(p).not.toContain('?')
    }
  })
})

describe('P1-E3: OAuth & XAA redirect credential stripping, POST->GET downgrade, and connector-bound SSRF lookup', () => {
  test('wrapFetchWithOAuthRedirectGuard and wrapAuthFetchWithHeaders strip authorization, cookie, and proxy-authorization on cross-origin redirects', async () => {
    const seenHeaders: Headers[] = []
    const mockFetch = (async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url))
      seenHeaders.push(new Headers(init?.headers))
      if (u.origin === 'https://origin-a.example') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://origin-b.example/metadata' },
        })
      }
      return new Response('{"ok":true}', { status: 200 })
    }) as unknown as typeof fetch

    const guarded = wrapFetchWithOAuthRedirectGuard(mockFetch)
    const res = await guarded('https://origin-a.example/.well-known/oauth', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer top-secret',
        Cookie: 'sid=secret-cookie',
        'Proxy-Authorization': 'Basic proxy-secret',
        Accept: 'application/json',
      },
    })
    expect(res.status).toBe(200)
    expect(seenHeaders).toHaveLength(2)
    expect(seenHeaders[0]!.get('authorization')).toBe('Bearer top-secret')
    expect(seenHeaders[1]!.get('authorization')).toBeNull()
    expect(seenHeaders[1]!.get('cookie')).toBeNull()
    expect(seenHeaders[1]!.get('proxy-authorization')).toBeNull()
    expect(seenHeaders[1]!.get('accept')).toBe('application/json')

    // wrapAuthFetchWithHeaders also strips credential headers when following cross-origin GET
    const headerSeen: Headers[] = []
    const headerGuarded = wrapAuthFetchWithHeaders(
      'srv',
      {
        type: 'http',
        url: 'https://origin-a.example/mcp',
        headers: { 'X-Custom': 'val' },
      },
      (async (url: string | URL, init?: RequestInit) => {
        const u = new URL(String(url))
        headerSeen.push(new Headers(init?.headers))
        if (u.origin === 'https://origin-a.example') {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://origin-b.example/next' },
          })
        }
        return new Response('ok', { status: 200 })
      }) as unknown as typeof fetch,
    )
    await headerGuarded('https://origin-a.example/resource', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer leak-me-not',
        Cookie: 'a=b',
        'Proxy-Authorization': 'Basic xyz',
      },
    })
    expect(headerSeen).toHaveLength(2)
    expect(headerSeen[1]!.get('authorization')).toBeNull()
    expect(headerSeen[1]!.get('cookie')).toBeNull()
    expect(headerSeen[1]!.get('proxy-authorization')).toBeNull()
  })

  test('ssrfGuardedOidcFetch strips cross-origin credentials and converts POST 301/302/303 to GET without body/content headers', async () => {
    const allowPublicLookup: typeof ssrfGuardedLookup = (
      _hostname,
      _opts,
      cb,
    ) => {
      cb(null, [{ address: '93.184.216.34', family: 4 }])
    }

    for (const status of [301, 302, 303] as const) {
      const hops: Array<{
        url: string
        method: string
        body: unknown
        headers: Headers
      }> = []
      const res = await ssrfGuardedOidcFetch(
        'https://idp-a.example/token',
        {
          method: 'POST',
          body: 'grant_type=authorization_code&code=abc',
          headers: {
            Authorization: 'Basic secret',
            Cookie: 'session=secret',
            'Proxy-Authorization': 'Basic proxy',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': '38',
            'X-Trace': 'keep-me',
          },
        },
        {
          lookup: allowPublicLookup,
          fetchFn: (async (url: string | URL, init?: RequestInit) => {
            hops.push({
              url: String(url),
              method: (init?.method ?? 'GET').toUpperCase(),
              body: init?.body,
              headers: new Headers(init?.headers),
            })
            if (hops.length === 1) {
              return new Response(null, {
                status,
                headers: { location: 'https://idp-b.example/final' },
              })
            }
            return new Response('{"done":true}', { status: 200 })
          }) as unknown as typeof fetch,
        },
      )
      expect(res.status).toBe(200)
      expect(hops).toHaveLength(2)
      expect(hops[1]!.method).toBe('GET')
      expect(hops[1]!.body).toBeUndefined()
      expect(hops[1]!.headers.get('authorization')).toBeNull()
      expect(hops[1]!.headers.get('cookie')).toBeNull()
      expect(hops[1]!.headers.get('proxy-authorization')).toBeNull()
      expect(hops[1]!.headers.get('content-type')).toBeNull()
      expect(hops[1]!.headers.get('content-length')).toBeNull()
      expect(hops[1]!.headers.get('x-trace')).toBe('keep-me')
    }
  })

  test('createAuthFetch & ssrfGuardedOidcFetch bind lookup directly into the connector (single DNS lookup per hop, zero TOCTOU)', async () => {
    const server = createHttpServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    try {
      let lookupCount = 0
      const singleShotLookup: typeof ssrfGuardedLookup = (
        hostname,
        opts,
        cb,
      ) => {
        lookupCount++
        expect(hostname).toBe('pinned-oauth.invalid')
        if (opts && typeof opts === 'object' && 'all' in opts && opts.all) {
          cb(null, [{ address: '127.0.0.1', family: 4 }])
        } else {
          cb(null, '127.0.0.1', 4)
        }
      }

      const authFetch = createAuthFetch({ lookup: singleShotLookup })
      const res1 = await authFetch(`http://pinned-oauth.invalid:${port}/meta`)
      expect(res1.status).toBe(200)
      expect(await res1.json()).toEqual({ ok: true })
      // Must be resolved EXACTLY ONCE directly by the connector — no preflight + separate connect lookup
      expect(lookupCount).toBe(1)

      lookupCount = 0
      const res2 = await ssrfGuardedOidcFetch(
        `http://pinned-oauth.invalid:${port}/oidc`,
        undefined,
        { lookup: singleShotLookup },
      )
      expect(res2.status).toBe(200)
      expect(lookupCount).toBe(1)
    } finally {
      await new Promise<void>(r => server.close(() => r()))
    }
  })
})

describe('P1-E4: SSH quoting, host option-injection rejection, -- separator, and reconnect leak cleanup', () => {
  test('posixSingleQuote & formatPosixRemoteCli safely quote env values and args while supporting ~/', () => {
    expect(posixSingleQuote("a'b; $(id) `uname`")).toBe(
      `'a'\\''b; $(id) \`uname\`'`,
    )

    const formatted = formatPosixRemoteCli(
      [
        'ANTHROPIC_UNIX_SOCKET=/tmp/sock; touch /tmp/pwn',
        "ANTHROPIC_AUTH_NONCE=abc'def",
        '~/.local/bin/claude',
        '--cwd',
        "/work/o'reilly; $(whoami)",
        '--verbose',
        '-p',
      ],
      2,
    )
    expect(formatted).toContain(
      "ANTHROPIC_UNIX_SOCKET='/tmp/sock; touch /tmp/pwn'",
    )
    expect(formatted).toContain("ANTHROPIC_AUTH_NONCE='abc'\\''def'")
    expect(formatted).toContain('"$HOME"/\'.local/bin/claude\'')
    expect(formatted).toContain("'/work/o'\\''reilly; $(whoami)'")
    expect(formatted).toContain("'-p'")
  })

  test('validateSshHost, probeRemote, deployBinary, and createSSHSession reject leading - and whitespace/control chars', async () => {
    expect(validateSshHost('user@example.com')).toBe('user@example.com')
    expect(() => validateSshHost('-oProxyCommand=calc')).toThrow(
      /Invalid SSH host/,
    )
    expect(() => validateSshHost('host with spaces')).toThrow(
      /Invalid SSH host/,
    )
    expect(() => validateSshHost('host\0evil')).toThrow(/Invalid SSH host/)
    expect(() => validateSshHost('host\nProxyCommand=id')).toThrow(
      /Invalid SSH host/,
    )
    expect(() => validateSshHost('')).toThrow(/Invalid SSH host/)

    await expect(probeRemote('-oProxyCommand=id')).rejects.toThrow(
      /Invalid SSH host/,
    )
    await expect(
      deployBinary({
        host: '-oProxyCommand=id',
        remotePlatform: 'linux',
        remoteArch: 'x64',
        localVersion: '1.0.0',
      }),
    ).rejects.toThrow(/Invalid SSH host/)
    await expect(
      createSSHSession({
        host: '-oProxyCommand=id',
        localVersion: '1.0.0',
        extraCliArgs: [],
      }),
    ).rejects.toThrow(/Invalid SSH host/)

    // Verify all ssh/scp invocations include '--' before host and reconnect kills newProc on init error
    const probeSrc = readFileSync(
      resolve(REPO_ROOT, 'src/ssh/SSHProbe.ts'),
      'utf8',
    )
    expect(probeSrc).toContain("'--',")
    const deploySrc = readFileSync(
      resolve(REPO_ROOT, 'src/ssh/SSHDeploy.ts'),
      'utf8',
    )
    expect(deploySrc).toContain("['-o', 'ConnectTimeout=10', '--', safeHost")
    expect(deploySrc).toContain("['-o', 'ConnectTimeout=10', '--', localBinary")
    const sessionSrc = readFileSync(
      resolve(REPO_ROOT, 'src/ssh/createSSHSession.ts'),
      'utf8',
    )
    expect(sessionSrc).toContain(
      "['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', host, 'pwd']",
    )
    expect(sessionSrc).toContain("sshArgs.push('--', host,")
    expect(sessionSrc).toMatch(
      /await waitForInit\(newProc, remoteCwd\)[\s\S]*?catch[\s\S]*?newProc\.kill\(\)/,
    )
  })
})

describe('P1-E6 & P2-14: Windows ComputerUse wt/--/stdin clipboard/PowerShell Unicode quote escaping, $winPid, and x64 SendInput struct', () => {
  test('P1-E6(a): buildWindowsTerminalLaunchSpec rejects ;/CR/LF in wt cwd and inserts -- before powershell', () => {
    expect(
      buildWindowsTerminalLaunchSpec('wt', 'claude', 'C:\\work; new-tab cmd'),
    ).toBeNull()
    expect(
      buildWindowsTerminalLaunchSpec('wt', 'claude', 'C:\\work\ncmd'),
    ).toBeNull()
    expect(
      buildWindowsTerminalLaunchSpec('wt', 'claude', 'C:\\work\rcmd'),
    ).toBeNull()

    const ok = buildWindowsTerminalLaunchSpec('wt', 'claude', 'C:\\work')
    expect(ok).not.toBeNull()
    expect(ok!.spawnProgram).toBe('wt')
    const dashDashIdx = ok!.spawnArgs.indexOf('--')
    const psIdx = ok!.spawnArgs.indexOf('powershell')
    expect(dashDashIdx).toBeGreaterThan(-1)
    expect(psIdx).toBe(dashDashIdx + 1)
    expect(ok!.spawnArgs).toContain('-EncodedCommand')
  })

  test('P1-E6(b) & P1-E6(c): stdin clipboard piping and Unicode smart-quote escaping across win32 modules', () => {
    expect(
      escapePowerShellSingleQuoted("a'b\u2018c\u2019d\u201ae\u201bf"),
    ).toBe("a''b\u2018\u2018c\u2019\u2019d\u201a\u201ae\u201b\u201bf")

    const crossSrc = readFileSync(
      resolve(REPO_ROOT, 'src/utils/computerUse/executorCrossPlatform.ts'),
      'utf8',
    )
    expect(crossSrc).toContain('[Console]::In.ReadToEnd() | Set-Clipboard')
    expect(crossSrc).not.toContain("Set-Clipboard -Value '${escaped}'")

    const execSrc = readFileSync(
      resolve(REPO_ROOT, 'src/utils/computerUse/executor.ts'),
      'utf8',
    )
    expect(execSrc).toContain('[Console]::In.ReadToEnd() | Set-Clipboard')
    expect(execSrc).not.toContain('Set-Clipboard -Value')

    for (const rel of [
      'src/utils/computerUse/win32/uiAutomation.ts',
      'src/utils/computerUse/win32/windowMessage.ts',
      'src/utils/computerUse/win32/comExcel.ts',
      'packages/@ant/computer-use-input/src/backends/win32.ts',
    ]) {
      const src = readFileSync(resolve(REPO_ROOT, rel), 'utf8')
      expect(src).toContain('escapePowerShellSingleQuoted')
      expect(src).toContain('-EncodedCommand')
      expect(src).not.toContain(".replace(/'/g, \"''\")")
    }
  })

  test('P2-14: $winPid replaces read-only $pid in computer-use-swift and SendInput uses Sequential INPUT + Explicit INPUTUNION', () => {
    const swiftWin32 = readFileSync(
      resolve(
        REPO_ROOT,
        'packages/@ant/computer-use-swift/src/backends/win32.ts',
      ),
      'utf8',
    )
    expect(swiftWin32).toContain('$winPid = [uint32]0')
    expect(swiftWin32).toContain('[ref]$winPid')
    expect(swiftWin32).toContain('Get-Process -Id $winPid')
    expect(swiftWin32).not.toContain('$pid = [uint32]0')

    const inputWin32 = readFileSync(
      resolve(
        REPO_ROOT,
        'packages/@ant/computer-use-input/src/backends/win32.ts',
      ),
      'utf8',
    )
    expect(inputWin32).toContain(
      '[StructLayout(LayoutKind.Explicit)] public struct INPUTUNION',
    )
    expect(inputWin32).toContain(
      '[StructLayout(LayoutKind.Sequential)] public struct INPUT',
    )
    expect(inputWin32).toContain('public INPUTUNION u;')
    expect(inputWin32).toContain('$i.u.mi.dwFlags')
    expect(inputWin32).not.toContain('[FieldOffset(4)]')
  })
})

describe('P2-12: Streaming fflate.Unzip zip-bomb enforcement and hardened isPathSafe', () => {
  test('isPathSafe rejects NUL bytes, Windows drive-relative paths, NTFS ADS, traversal, and absolute paths', () => {
    expect(isPathSafe('dir/file.txt')).toBe(true)
    expect(isPathSafe('hello.txt')).toBe(true)

    expect(isPathSafe('good\0.txt')).toBe(false)
    expect(isPathSafe('C:relative.txt')).toBe(false)
    expect(isPathSafe('C:\\Windows\\win.ini')).toBe(false)
    expect(isPathSafe('c:/evil.txt')).toBe(false)
    expect(isPathSafe('file.txt:ads.exe')).toBe(false)
    expect(isPathSafe('file.txt::$DATA')).toBe(false)
    expect(isPathSafe('../escape.txt')).toBe(false)
    expect(isPathSafe('/etc/passwd')).toBe(false)
    expect(isPathSafe('\\Windows\\System32')).toBe(false)
  })

  test('unzipFile uses streaming Unzip + UnzipInflate to abort DEFLATE zip bombs (including spoofed originalSize: 0) before exhausting memory', async () => {
    const zipSrc = readFileSync(
      resolve(REPO_ROOT, 'src/utils/dxt/zip.ts'),
      'utf8',
    )
    expect(zipSrc).not.toMatch(/\bunzipSync\s*\(/)
    expect(zipSrc).toContain('UnzipInflate')

    // Build a 4MB DEFLATE zip bomb of zeros (~4KB compressed -> >900:1 ratio)
    const bombBytes = Buffer.from(
      zipSync({ 'bomb.bin': [new Uint8Array(4 * 1024 * 1024), { level: 9 }] }),
    )
    // Also spoof BOTH local header and central directory uncompressedSize to 0
    // so only streaming actual inflated byteLength inside file.ondata catches it!
    const spoofed = Buffer.from(bombBytes)
    const localSig = spoofed.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    const cdSig = spoofed.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    expect(localSig).toBeGreaterThanOrEqual(0)
    expect(cdSig).toBeGreaterThan(localSig)
    spoofed.writeUInt32LE(0, localSig + 22)
    spoofed.writeUInt32LE(0, cdSig + 24)

    await expect(unzipFile(spoofed)).rejects.toThrow(
      /Suspicious compression ratio detected/,
    )

    // Corrupt/non-zip data is rejected rather than silently returning {}
    await expect(unzipFile(Buffer.from('not a zip archive'))).rejects.toThrow(
      /Invalid zip data/,
    )

    // Legitimate STORED + DEFLATED + empty zip extracts cleanly
    const legit = Buffer.from(
      zipSync({
        'stored.txt': [Buffer.from('stored-payload'), { level: 0 }],
        'deflated.txt': [
          Buffer.from('deflated-payload-with-variety-0123456789'),
          { level: 6 },
        ],
        'empty.txt': new Uint8Array(0),
      }),
    )
    const out = await unzipFile(legit)
    expect(Buffer.from(out['stored.txt']!).toString('utf8')).toBe(
      'stored-payload',
    )
    expect(Buffer.from(out['deflated.txt']!).toString('utf8')).toBe(
      'deflated-payload-with-variety-0123456789',
    )
    expect(out['empty.txt']!.byteLength).toBe(0)
  })
})

describe('P2-13: recreateMcpTransportForPinnedLegacy mirrors buildInitialMcpTransport', () => {
  test('sets connectAuthProvider, skipIssuerMetadataValidation, case-insensitive Authorization check, and cliOwnedBearer precedence', async () => {
    const makeState = (): McpTransportBuildState => ({
      inProcessServer: undefined,
      connectAuthFlags: undefined,
      connectAuthProvider: undefined,
      useFirstPartyAuth: false,
      lacksHelperHeaders: false,
      firstPartyBearerBag: { last: '' },
    })

    // 1. Lowercase `authorization` header prevents injecting duplicate `Authorization` with sessionIngressToken
    const state1 = makeState()
    const transport1 = await recreateMcpTransportForPinnedLegacy(
      'legacy-http-1',
      {
        type: 'http',
        url: 'https://mcp-legacy.example/mcp',
        scope: 'user',
        headers: {
          authorization: 'Bearer custom-lower',
        },
      },
      'ingress-token-should-not-appear',
      state1,
    )
    const t1Internal = transport1 as unknown as {
      _requestInit?: { headers?: Record<string, string> }
    }
    const headers1 = t1Internal._requestInit?.headers ?? {}
    expect(headers1.authorization).toBe('Bearer custom-lower')
    expect(headers1.Authorization).toBeUndefined()

    // 2. OAuth-capable HTTP server populates transportState.connectAuthProvider
    const stateOAuth = makeState()
    await recreateMcpTransportForPinnedLegacy(
      'legacy-http-oauth',
      {
        type: 'http',
        url: 'https://mcp-oauth.example/mcp',
        scope: 'user',
      },
      undefined,
      stateOAuth,
    )
    expect(stateOAuth.connectAuthProvider).toBeDefined()

    // 3. cliOwnedBearer takes precedence over sessionIngressToken when no Authorization header exists
    const serverCfg2 = {
      type: 'http' as const,
      url: 'https://mcp-owned.example/mcp',
      scope: 'user' as const,
    }
    markCliOwnedConfig(serverCfg2, {
      getBearerToken: () => 'cli-owned-token-42',
    })
    const state2 = makeState()
    const transport2 = await recreateMcpTransportForPinnedLegacy(
      'legacy-http-2',
      serverCfg2,
      'ingress-fallback-unused',
      state2,
    )
    const t2Internal = transport2 as unknown as {
      _requestInit?: { headers?: Record<string, string> }
    }
    expect(t2Internal._requestInit?.headers?.Authorization).toBe(
      'Bearer cli-owned-token-42',
    )

    // Verify source sets skipIssuerMetadataValidation: true and connectAuthProvider inside recreateMcpTransportForPinnedLegacy
    const src = readFileSync(
      resolve(REPO_ROOT, 'src/services/mcp/client/connectTransports.ts'),
      'utf8',
    )
    const recreateIdx = src.indexOf(
      'export async function recreateMcpTransportForPinnedLegacy',
    )
    const recreateBody = src.slice(recreateIdx)
    expect(recreateBody).toContain(
      'transportState.connectAuthProvider = authProvider',
    )
    expect(recreateBody).toContain('skipIssuerMetadataValidation: true')
    expect(recreateBody).toContain("k.toLowerCase() === 'authorization'")
    expect(recreateBody).toContain('getCliOwnedBearerProvider(serverRef)?.()')
  })
})
