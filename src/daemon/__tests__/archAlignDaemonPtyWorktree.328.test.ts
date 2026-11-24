import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { Socket } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createTaskStateBase,
  generateTaskId,
  type TaskStateBase,
} from '../../Task.js'
import { BridgeHeadlessPermanentError } from '../../bridge/bridgeMain.js'
import type { HeadlessBridgeOpts } from '../../bridge/bridgeMain.js'
import type { AppState } from '../../state/AppState.js'
import {
  installShellPressureReap,
  resetQuietCheckinOwnersForTests,
  startQuietCheckin,
} from '../../tasks/LocalShellTask/LocalShellTask.js'
import type { LocalShellTaskState } from '../../tasks/LocalShellTask/guards.js'
import {
  SHELL_PRESSURE_ANTI_CHURN_MS,
  SHELL_PRESSURE_IDLE_MS,
  checkHostMemoryScarce,
  evaluateMemoryPressureReap,
  getLastPressureReapAt,
  resetLastPressureReapAtForTests,
  setLastPressureReapAt,
} from '../../tasks/LocalShellTask/shellPressureReap.js'
import {
  type LocalMemoryImportTaskState,
  type PostTurnMemoryTaskState,
  isBackgroundTask,
} from '../../tasks/types.js'
import {
  classifyIdeWorkspaceMatch,
  deduplicateIdeLockfileDirs,
} from '../../utils/ide.js'
import {
  getFlagSettingsInline,
  getIsInteractive,
  setFlagSettingsInline,
  setIsInteractive,
} from '../../bootstrap/state.js'
import { createMessageQueue } from '../../utils/messageQueueManager.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import {
  detectAndGetBackend,
  isInProcessEnabled,
  resetBackendDetection,
} from '../../utils/swarm/backends/registry.js'
import {
  clearCliTeammateModeOverride,
  type TeammateMode,
} from '../../utils/swarm/backends/teammateModeSnapshot.js'
import { createTaskRegistry } from '../../utils/taskRegistry.js'
import {
  deriveMessagingKeyName,
  startUdsMessaging,
  stopUdsMessaging,
  unlinkUdsKeyFilesOnExit,
} from '../../utils/udsMessaging.js'
import {
  isUnsafeSymlinkDirectoryEntry,
  isUnsafeWorktreeWriteDestination,
  symlinkDirectories,
} from '../../utils/worktree.js'
import { createAuthenticatedDefaultSpawnPty } from '../bgManager.js'
import {
  createDaemonConfigReconciler,
  createTransientIdleExitController,
  hasBinaryIdentityChanged,
  probeBinaryIdentity,
  spawnUpgradeSuccessor,
} from '../main.js'
import {
  CTRL_FRAME,
  DATA_FRAME,
  type Frame,
  connectAuthenticatedPtyHost,
  createFrameParser,
  encodeCtrlFrame,
  encodeDataFrame,
  mintPtyAuthToken,
  readSocketTokensFile,
  startPtyHostServer,
  verifyPtyAuthToken,
  writeExecExitTailFile,
} from '../ptyHost.js'
import {
  EXIT_CODE_PERMANENT,
  WORKER_KINDS,
  createSupervisorAuthManager,
  createWorkerAuthClient,
  diffDaemonConfig,
  emptyDaemonConfig,
  loadDaemonConfig,
  runHeartbeatWorker,
  runRemoteControlWorker,
} from '../workerRegistry.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup error
    }
  }
  resetLastPressureReapAtForTests()
  resetQuietCheckinOwnersForTests()
  resetBackendDetection()
  process.exitCode = 0
})

// ===========================================================================
// 1. Daemon Supervisor & Worker Registry (P0-11)
// ===========================================================================

describe('P0-11: Daemon Supervisor & Worker Registry (2.1.328)', () => {
  test('WORKER_KINDS registers heartbeat, scheduled, remoteControl with strict Zod schemas', async () => {
    expect(Object.keys(WORKER_KINDS).sort()).toEqual([
      'heartbeat',
      'remoteControl',
      'scheduled',
    ])
    expect(WORKER_KINDS.heartbeat.needsOAuth).toBe(false)
    expect(WORKER_KINDS.scheduled.needsOAuth).toBe(true)
    expect(WORKER_KINDS.remoteControl.needsOAuth).toBe(true)

    // Strict schema rejects unknown keys
    expect(
      WORKER_KINDS.heartbeat.schema.safeParse({
        intervalSeconds: 10,
        bogus: true,
      }).success,
    ).toBe(false)

    // Scheduled schema rejects invalid 5-field cron & duplicate task IDs
    expect(
      WORKER_KINDS.scheduled.schema.safeParse({
        tasks: [
          {
            id: 't1',
            cron: 'not-a-cron',
            prompt: 'hi',
            directory: '/tmp',
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      WORKER_KINDS.scheduled.schema.safeParse({
        tasks: [
          { id: 'dup', cron: '*/5 * * * *', prompt: 'a', directory: '/tmp' },
          { id: 'dup', cron: '0 * * * *', prompt: 'b', directory: '/tmp' },
        ],
      }).success,
    ).toBe(false)
    expect(
      WORKER_KINDS.scheduled.schema.safeParse({
        tasks: [
          { id: 'ok', cron: '*/5 * * * *', prompt: 'run', directory: '/tmp' },
        ],
      }).success,
    ).toBe(true)

    // Missing daemon.json falls back gracefully
    const dir = makeTempDir('daemon-cfg-')
    const missing = await loadDaemonConfig(join(dir, 'daemon.json'))
    expect(missing.ok).toBe(true)
    if (missing.ok) {
      expect(missing.existed).toBe(false)
      expect(missing.config.remoteControl).toEqual([])
      expect(missing.config.scheduled).toEqual([])
      expect(missing.config.heartbeat).toEqual([])
    }
  })

  test('runRemoteControlWorker invokes runBridgeHeadless (not startBgManager) and parks on sandbox/permanent errors', async () => {
    const calledOpts: HeadlessBridgeOpts[] = []
    const ac = new AbortController()
    const logs: string[] = []

    await runRemoteControlWorker(
      { dir: '/tmp/my-repo', spawnMode: 'worktree', capacity: 8 },
      ac.signal,
      {
        authClient: {
          getAccessToken: () => 'tok-test-123',
          reportAuth401: async () => true,
          dispose: () => {},
        },
        log: msg => logs.push(msg),
        runBridgeHeadlessImpl: async opts => {
          calledOpts.push(opts)
          expect(opts.getAccessToken()).toBe('tok-test-123')
          expect(await opts.onAuth401('old-tok')).toBe(true)
        },
      },
    )
    expect(calledOpts).toHaveLength(1)
    expect(calledOpts[0]!.dir).toContain('my-repo')
    expect(calledOpts[0]!.spawnMode).toBe('worktree')
    expect(calledOpts[0]!.capacity).toBe(8)
    expect(calledOpts[0]!.sandbox).toBe(false)
    expect(process.exitCode).toBe(0)

    // sandbox: true rejected permanently (EX_CONFIG = 78)
    await runRemoteControlWorker(
      { dir: '/tmp/my-repo', sandbox: true },
      ac.signal,
      {
        authClient: {
          getAccessToken: () => 'tok-test-123',
          reportAuth401: async () => false,
          dispose: () => {},
        },
        log: msg => logs.push(msg),
        runBridgeHeadlessImpl: async () => {
          throw new Error('must not run bridge when sandbox is true')
        },
      },
    )
    expect(process.exitCode).toBe(EXIT_CODE_PERMANENT)

    // BridgeHeadlessPermanentError sets EXIT_CODE_PERMANENT
    process.exitCode = 0
    await runRemoteControlWorker({ dir: '/tmp/my-repo' }, ac.signal, {
      authClient: {
        getAccessToken: () => 'tok-test-123',
        reportAuth401: async () => false,
        dispose: () => {},
      },
      log: () => {},
      runBridgeHeadlessImpl: async () => {
        throw new BridgeHeadlessPermanentError('workspace not trusted')
      },
    })
    expect(process.exitCode).toBe(EXIT_CODE_PERMANENT)
  })

  test('runHeartbeatWorker logs startup and heartbeat ticks until aborted', async () => {
    const ac = new AbortController()
    const logs: string[] = []
    const done = runHeartbeatWorker({ intervalSeconds: 0.02 }, ac.signal, m => {
      logs.push(m)
      if (m === 'heartbeat') ac.abort()
    })
    await done
    expect(logs[0]).toContain('heartbeat worker started')
    expect(logs).toContain('heartbeat')
  })

  test('Supervisor OAuth IPC coordinator broadcasts token_update & coordinates auth_401 / auth_401_result', async () => {
    const supervisorSide = new EventEmitter()
    const workerSide = new EventEmitter()
    const supMessagesToWorker: unknown[] = []

    const fakeChildPeer = {
      on: (ev: 'message', fn: (msg: unknown) => void) =>
        supervisorSide.on(ev, fn),
      removeListener: (ev: 'message', fn: (msg: unknown) => void) =>
        supervisorSide.removeListener(ev, fn),
      send: (msg: unknown) => {
        supMessagesToWorker.push(msg)
        workerSide.emit('message', msg)
        return true
      },
    }

    let storedToken = 'tok-initial'
    const ac = new AbortController()
    const supAuth = createSupervisorAuthManager({
      signal: ac.signal,
      readTokens: async () => ({
        accessToken: storedToken,
        expiresAt: Date.now() + 3_600_000,
      }),
      refreshIfNeeded: async () => false,
      handle401: async failed => {
        if (failed === 'tok-initial') {
          storedToken = 'tok-refreshed'
          return true
        }
        return false
      },
      clearCache: () => {},
    })
    await supAuth.ready

    const workerClient = createWorkerAuthClient(undefined, {
      send: msg => {
        supervisorSide.emit('message', msg)
        return true
      },
      on: (ev, fn) => workerSide.on(ev, fn),
      off: (ev, fn) => workerSide.off(ev, fn),
    })

    // Attaching worker immediately pushes current token
    supAuth.attachWorker(fakeChildPeer)
    expect(workerClient.getAccessToken()).toBe('tok-initial')

    // Worker reports 401 -> supervisor recovers, broadcasts new token, replies auth_401_result
    const refreshed = await workerClient.reportAuth401('tok-initial')
    expect(refreshed).toBe(true)
    expect(workerClient.getAccessToken()).toBe('tok-refreshed')
    expect(
      supMessagesToWorker.some(
        m =>
          typeof m === 'object' &&
          m !== null &&
          (m as { type?: string }).type === 'auth_401_result' &&
          (m as { refreshed?: boolean }).refreshed === true,
      ),
    ).toBe(true)

    workerClient.dispose()
    supAuth.dispose()
    ac.abort()
  })

  test('daemon.json hot-reload reconciler diffs and starts/restarts/stops workers', async () => {
    const dir = makeTempDir('daemon-reload-')
    const jsonPath = join(dir, 'daemon.json')
    writeFileSync(
      jsonPath,
      JSON.stringify({ heartbeat: { intervalSeconds: 30 } }),
    )

    const events: string[] = []
    const reconciler = createDaemonConfigReconciler({
      jsonPath,
      initialConfig: emptyDaemonConfig(),
      enableWatch: false,
      log: () => {},
      onStartWorker: (id, kind) => {
        events.push(`start:${id}:${kind}`)
      },
      onRestartWorker: (id, kind) => {
        events.push(`restart:${id}:${kind}`)
      },
      onStopWorker: (id, kind) => {
        events.push(`stop:${id}:${kind}`)
      },
    })

    const r1 = await reconciler.reload()
    expect(r1).toEqual({ stopped: 0, started: 1, restarted: 0 })

    // Modify heartbeat interval & add remoteControl
    writeFileSync(
      jsonPath,
      JSON.stringify({
        heartbeat: { intervalSeconds: 60 },
        remoteControl: { dir },
      }),
    )
    const r2 = await reconciler.reload()
    expect(r2).toEqual({ stopped: 0, started: 1, restarted: 1 })

    // Remove heartbeat
    writeFileSync(jsonPath, JSON.stringify({ remoteControl: { dir } }))
    const r3 = await reconciler.reload()
    expect(r3).toEqual({ stopped: 1, started: 0, restarted: 0 })

    expect(events).toEqual([
      'start:heartbeat:0:heartbeat',
      'restart:heartbeat:0:heartbeat',
      'start:remoteControl:0:remoteControl',
      'stop:heartbeat:0:heartbeat',
    ])

    // Verify pure diffDaemonConfig as well
    const d = diffDaemonConfig(emptyDaemonConfig(), reconciler.currentConfig)
    expect(d.start).toHaveLength(1)
    reconciler.dispose()
  })

  test('probeBinaryIdentity detects on-disk binary upgrade & spawnUpgradeSuccessor spawns detached successor', async () => {
    const dir = makeTempDir('daemon-bin-')
    const v1 = join(dir, '2.1.328')
    const v2 = join(dir, '2.1.329')
    writeFileSync(v1, 'bin1')
    writeFileSync(v2, 'bin2')
    const link = join(dir, 'claude')
    symlinkSync(v1, link)

    const startup = await probeBinaryIdentity(link)
    expect(startup).not.toBeNull()
    expect(startup!.version).toBe('2.1.328')
    expect(hasBinaryIdentityChanged(startup!, startup!)).toBe(false)

    // Replace symlink with newer version on disk
    rmSync(link)
    symlinkSync(v2, link)
    const upgraded = await probeBinaryIdentity(link, {
      startupIdentity: startup,
    })
    expect(upgraded).not.toBeNull()
    expect(upgraded!.version).toBe('2.1.329')
    expect(hasBinaryIdentityChanged(startup!, upgraded!)).toBe(true)

    // Also detects in-place mtime change on same target
    const future = new Date(Date.now() + 10_000)
    utimesSync(v2, future, future)
    const touched = await probeBinaryIdentity(link, {
      startupIdentity: upgraded,
      queryVersion: async () => '2.1.330',
    })
    expect(hasBinaryIdentityChanged(upgraded!, touched!)).toBe(true)

    // spawnUpgradeSuccessor spawns detached daemon run
    let capturedArgs: string[] = []
    let capturedDetached = false
    let unrefCalled = false
    spawnUpgradeSuccessor({
      origin: 'service',
      jsonPath: join(dir, 'daemon.json'),
      cwd: dir,
      spawnFn: (launch, spawnOpts) => {
        capturedArgs = launch.args
        capturedDetached = spawnOpts?.detached === true
        return {
          unref: () => {
            unrefCalled = true
          },
        } as never
      },
    })
    expect(capturedDetached).toBe(true)
    expect(unrefCalled).toBe(true)
    expect(capturedArgs).toContain('daemon')
    expect(capturedArgs).toContain('run')
    expect(capturedArgs).toContain('--origin')
    expect(capturedArgs).toContain('service')
  })

  test('createTransientIdleExitController idle-exits after grace when empty and cancels when active', async () => {
    let active = 1
    let exited = 0
    const ctrl = createTransientIdleExitController({
      origin: 'transient',
      getActiveCount: () => active,
      isShuttingDown: () => false,
      idleGraceMs: 40,
      startupIdleGraceMs: 80,
      log: () => {},
      onIdleExit: () => {
        exited++
      },
    })

    // Active handle -> never arms
    ctrl.onKeepAliveChange()
    expect(ctrl.isTimerArmed()).toBe(false)

    // Handle finishes -> arms idle timer
    active = 0
    ctrl.onKeepAliveChange()
    expect(ctrl.isTimerArmed()).toBe(true)

    // New dispatch arrives before grace expires -> cancels timer
    active = 1
    ctrl.onKeepAliveChange()
    expect(ctrl.isTimerArmed()).toBe(false)
    await new Promise(r => setTimeout(r, 60))
    expect(exited).toBe(0)

    // Now drops to 0 and stays idle -> exits after grace
    active = 0
    ctrl.onKeepAliveChange()
    await new Promise(r => setTimeout(r, 80))
    expect(exited).toBe(1)
    ctrl.dispose()

    // Service origin never idle-exits
    const svc = createTransientIdleExitController({
      origin: 'service',
      getActiveCount: () => 0,
      isShuttingDown: () => false,
      idleGraceMs: 10,
      log: () => {},
      onIdleExit: () => {
        exited++
      },
    })
    svc.onKeepAliveChange()
    expect(svc.isTimerArmed()).toBe(false)
    svc.dispose()
  })
})

// ===========================================================================
// 2. PTY Host Auth, Heartbeat, Orphan Watchdog & 4KB Exit-Tail (P0-12 + P2)
// ===========================================================================

describe('P0-12 + P2: PTY Host Auth, Heartbeat, Orphan Watchdog & Exit Tail (2.1.328)', () => {
  test('verifyPtyAuthToken uses timingSafeEqual and readSocketTokensFile loads ptyAuth', async () => {
    const token = mintPtyAuthToken()
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(verifyPtyAuthToken(token, token)).toBe(true)
    expect(verifyPtyAuthToken('wrong', token)).toBe(false)
    expect(verifyPtyAuthToken('', token)).toBe(false)
    expect(verifyPtyAuthToken(null, token)).toBe(false)
    expect(verifyPtyAuthToken(token, undefined)).toBe(false)

    const dir = makeTempDir('pty-tokens-')
    const tokFile = join(dir, 'tokens.json')
    writeFileSync(tokFile, JSON.stringify({ ptyAuth: token, rvAuth: 'rv1' }))
    const loaded = await readSocketTokensFile(tokFile)
    expect(loaded).toEqual({ ptyAuth: token, rvAuth: 'rv1' })
    expect(typeof createAuthenticatedDefaultSpawnPty).toBe('function')
  })

  test('rejects unauthenticated DATA_FRAME with auth-required, disconnects silent peer, and accepts authenticated write', async () => {
    const dir = makeTempDir('pty-auth-')
    const sockPath = join(dir, 'p.sock')
    const secret = mintPtyAuthToken()
    const writes: string[] = []

    const host = await startPtyHostServer({
      sockPath,
      replPid: process.pid,
      ptyAuthToken: secret,
      silentPeerTimeoutMs: 80,
      enableWatchdogs: false,
      onWrite: payload => writes.push(payload.toString('utf8')),
    })
    host.pushOutput(Buffer.from('ring-secret-output'))

    try {
      // 1. Silent unauthenticated peer receives NO ring buffer and is disconnected
      const silentFrames: Frame[] = []
      const silentClosed = await new Promise<boolean>(resolve => {
        const s = new Socket()
        const parse = createFrameParser(f => silentFrames.push(f))
        s.on('data', parse)
        s.once('close', () => resolve(true))
        s.connect(sockPath)
      })
      expect(silentClosed).toBe(true)
      expect(silentFrames).toHaveLength(0)

      // 2. Unauthenticated peer sending DATA_FRAME gets auth-required and write is blocked
      const unauthFrames: Frame[] = []
      await new Promise<void>(resolve => {
        const s = new Socket()
        const parse = createFrameParser(f => {
          unauthFrames.push(f)
          if (f.kind === CTRL_FRAME && f.ctrl.t === 'auth-required') {
            s.destroy()
            resolve()
          }
        })
        s.on('data', parse)
        s.once('connect', () => {
          s.write(encodeDataFrame(Buffer.from('injected-evil-keys')))
        })
        s.connect(sockPath)
      })
      expect(writes).toEqual([])
      expect(unauthFrames).toHaveLength(1)
      expect(unauthFrames[0]!.kind).toBe(CTRL_FRAME)
      if (unauthFrames[0]!.kind === CTRL_FRAME) {
        expect(unauthFrames[0]!.ctrl.t).toBe('auth-required')
      }

      // 3. Authenticated peer via connectAuthenticatedPtyHost receives ring replay & writes succeed
      const conn = connectAuthenticatedPtyHost(sockPath, process.pid, secret)
      const received: string[] = []
      conn.onData(d => received.push(d))
      await new Promise<void>(resolve => {
        conn.onResume(() => resolve())
      })
      expect(received.join('')).toContain('ring-secret-output')

      conn.write('hello-pty')
      await new Promise(r => setTimeout(r, 40))
      expect(writes).toEqual(['hello-pty'])
      conn.dispose()
    } finally {
      await host.close()
    }
  })

  test('heartbeat destroys unresponsive attacher after 3 missed pongs', async () => {
    const dir = makeTempDir('pty-hb-')
    const sockPath = join(dir, 'hb.sock')
    const host = await startPtyHostServer({
      sockPath,
      replPid: process.pid,
      heartbeatMs: 25,
      maxMissedPongs: 3,
      orphanCheckMs: 60_000,
      enableWatchdogs: true,
      onWrite: () => {},
    })

    try {
      let pings = 0
      const closed = await new Promise<boolean>(resolve => {
        const s = new Socket()
        const parse = createFrameParser(f => {
          if (f.kind === CTRL_FRAME && f.ctrl.t === 'ping') {
            pings++
            // Reply ONLY to the very first ping to arm heartbeat, then go silent
            if (pings === 1) {
              s.write(encodeCtrlFrame({ t: 'pong' }))
            }
          }
        })
        s.on('data', parse)
        s.once('close', () => resolve(true))
        s.connect(sockPath)
      })
      expect(closed).toBe(true)
      expect(pings).toBeGreaterThanOrEqual(3)
    } finally {
      await host.close()
    }
  })

  test('orphan watchdog triggers kill after ppid changes with 0 attachers', async () => {
    const dir = makeTempDir('pty-orphan-')
    const sockPath = join(dir, 'orphan.sock')
    let fakePpid = 1000
    let orphanKilled = false
    const breadcrumbs: string[] = []

    const host = await startPtyHostServer({
      sockPath,
      replPid: process.pid,
      heartbeatMs: 60_000,
      orphanCheckMs: 15,
      orphanMaxTicks: 3,
      enableWatchdogs: true,
      originalPpid: 1000,
      getPpid: () => fakePpid,
      onWrite: () => {},
      onOrphanKill: () => {
        orphanKilled = true
      },
      onBreadcrumb: msg => breadcrumbs.push(msg),
    })

    try {
      // Same ppid -> never kills
      await new Promise(r => setTimeout(r, 70))
      expect(orphanKilled).toBe(false)

      // Reparented (ppid changed to 1) with 0 attachers -> kills after 3 ticks
      fakePpid = 1
      await new Promise(r => setTimeout(r, 100))
      expect(orphanKilled).toBe(true)
      expect(breadcrumbs.some(b => b.includes('orphan watchdog'))).toBe(true)
    } finally {
      await host.close()
    }
  })

  test('exec-mode 4KB exit-tail JSON sidecar truncates safely on UTF-8 boundary', async () => {
    const dir = makeTempDir('pty-tail-')
    const exitFile = join(dir, 'job.exec-exit')
    // 5000 bytes of 3-byte UTF-8 chars ('中' = 3 bytes) to ensure boundary splitting
    const payload = Buffer.from('中'.repeat(2000), 'utf8')
    writeExecExitTailFile(exitFile, [payload], 42, 'SIGTERM')

    const parsed = JSON.parse(readFileSync(exitFile, 'utf8')) as {
      code: number
      signal?: string
      tail: string
    }
    expect(parsed.code).toBe(42)
    expect(parsed.signal).toBe('SIGTERM')
    expect(Buffer.byteLength(parsed.tail, 'utf8')).toBeLessThanOrEqual(4096)
    expect(parsed.tail.includes('\uFFFD')).toBe(false)
    expect(parsed.tail.endsWith('中中中')).toBe(true)
  })
})

// ===========================================================================
// 3. Worktree symlinkDirectories Hardening (P0-14)
// ===========================================================================

describe('P0-14: Worktree symlinkDirectories symlink-escape & absolute path hardening (2.1.328)', () => {
  test('rejects path traversal, absolute paths, drive-prefixed & UNC entries', () => {
    expect(isUnsafeSymlinkDirectoryEntry('../outside')).toBe(true)
    expect(isUnsafeSymlinkDirectoryEntry('a/../b')).toBe(true)
    expect(isUnsafeSymlinkDirectoryEntry('/etc/passwd')).toBe(true)
    expect(isUnsafeSymlinkDirectoryEntry('C:\\Windows')).toBe(true)
    expect(isUnsafeSymlinkDirectoryEntry('\\\\server\\share')).toBe(true)
    expect(isUnsafeSymlinkDirectoryEntry('')).toBe(true)
    expect(isUnsafeSymlinkDirectoryEntry('node_modules')).toBe(false)
    expect(isUnsafeSymlinkDirectoryEntry('packages/app/node_modules')).toBe(
      false,
    )
  })

  test('blocks intermediate symlink escape in worktree and external symlink in repoRoot, allows safe dirs', async () => {
    const base = makeTempDir('wt-sym-escape-')
    const repoRoot = join(base, 'repo')
    const worktree = join(base, 'worktree')
    const outside = join(base, 'outside')

    mkdirSync(join(repoRoot, 'node_modules'), { recursive: true })
    mkdirSync(join(repoRoot, 'packages', 'node_modules'), { recursive: true })
    mkdirSync(join(repoRoot, 'ok-nested', 'cache'), { recursive: true })
    mkdirSync(worktree, { recursive: true })
    mkdirSync(join(worktree, 'ok-nested'), { recursive: true })
    mkdirSync(outside, { recursive: true })

    // Attack 1: intermediate directory `packages` in worktree is a symlink to `outside`
    symlinkSync(outside, join(worktree, 'packages'), 'dir')
    // Attack 2: source directory `evil_src` inside repoRoot is a symlink pointing outside repoRoot
    symlinkSync(outside, join(repoRoot, 'evil_src'), 'dir')

    await symlinkDirectories(repoRoot, worktree, [
      '../outside',
      '/tmp/abs-escape',
      'C:\\evil',
      'packages/node_modules',
      'evil_src',
      'node_modules',
      'ok-nested/cache',
    ])

    // Attacks must NOT create symlinks
    expect(existsSync(join(outside, 'node_modules'))).toBe(false)
    expect(existsSync(join(worktree, 'evil_src'))).toBe(false)

    // Legitimate directories MUST be symlinked
    expect(lstatSync(join(worktree, 'node_modules')).isSymbolicLink()).toBe(
      true,
    )
    expect(
      lstatSync(join(worktree, 'ok-nested', 'cache')).isSymbolicLink(),
    ).toBe(true)

    // Direct helper check on intermediate symlink
    const unsafe = await isUnsafeWorktreeWriteDestination(
      join(worktree, 'packages', 'node_modules'),
      worktree,
      worktree,
    )
    expect(unsafe).toBe(true)
  })
})

// ===========================================================================
// 4. Tasks & LocalShellTask Quiet Check-in + Critical-Only Pressure Reap (P1-10 + P1-11)
// ===========================================================================

describe('P1-10 + P1-11: Task Types, createTaskStateBase & LocalShellTask (2.1.328)', () => {
  test('Task prefixes & createTaskStateBase outputKey / startedUnderUseCase', () => {
    expect(generateTaskId('local_memory_import')).toMatch(/^n[0-9a-z]{8}$/)
    expect(generateTaskId('post_turn_memory')).toMatch(/^p[0-9a-z]{8}$/)
    expect(generateTaskId('monitor_ws')).toMatch(/^s[0-9a-z]{8}$/)

    const base = createTaskStateBase(
      'p12345678',
      'post_turn_memory',
      'saving memories',
      'tu-1',
      'custom-out-key',
      'post-turn',
    )
    expect(base.outputFile).toContain('custom-out-key')
    expect(base.startedUnderUseCase).toBe('post-turn')

    const importTask: LocalMemoryImportTaskState = {
      ...(createTaskStateBase(
        'n12345678',
        'local_memory_import',
        'importing memories',
      ) as TaskStateBase),
      type: 'local_memory_import',
      status: 'running',
    }
    const postTurnTask: PostTurnMemoryTaskState = {
      ...(base as TaskStateBase),
      type: 'post_turn_memory',
      status: 'running',
    }
    expect(isBackgroundTask(importTask)).toBe(false)
    expect(isBackgroundTask(postTurnTask)).toBe(false)
  })

  test('memory pressure reap ONLY reaps on critical, enforces 30m anti-churn & checks host memory scarcity', () => {
    const now = 10_000_000
    const baseOpts = {
      status: 'running' as const,
      notified: false,
      shellCommandStatus: 'backgrounded',
      lastInteractionTime: now - SHELL_PRESSURE_IDLE_MS - 1_000,
      now,
      mainLoopBusy: false,
      hasActiveAgentTasks: false,
      lastPressureReapAt: 0,
      taskStartTime: now - 60_000,
      checkHostMemory: () => ({ scarce: true, detail: 'scarce' }),
    }

    // Non-critical pressure levels are NEVER reaped
    expect(
      evaluateMemoryPressureReap({ ...baseOpts, level: 'warning' }).shouldReap,
    ).toBe(false)
    expect(
      evaluateMemoryPressureReap({ ...baseOpts, level: undefined }).shouldReap,
    ).toBe(false)

    // Host memory not scarce -> skipped even on critical
    expect(
      evaluateMemoryPressureReap({
        ...baseOpts,
        level: 'critical',
        checkHostMemory: () => ({ scarce: false, detail: 'plenty free' }),
      }).shouldReap,
    ).toBe(false)

    // Linux /proc/meminfo scarcity parsing
    expect(
      checkHostMemoryScarce({
        platform: 'linux',
        readMeminfo: () =>
          'MemTotal:       16000000 kB\nMemAvailable:    800000 kB\n',
      }).scarce,
    ).toBe(true)
    expect(
      checkHostMemoryScarce({
        platform: 'linux',
        readMeminfo: () =>
          'MemTotal:       16000000 kB\nMemAvailable:   8000000 kB\n',
      }).scarce,
    ).toBe(false)

    // 30-minute anti-churn: previous reap after lastInteractionTime, task started <30m after reap
    const reapAt = now - 600_000
    expect(
      evaluateMemoryPressureReap({
        ...baseOpts,
        level: 'critical',
        lastPressureReapAt: reapAt,
        taskStartTime: reapAt + 60_000,
      }).shouldReap,
    ).toBe(false)

    // Once past 30m anti-churn (or terminal input happened after reap), critical reap proceeds
    expect(
      evaluateMemoryPressureReap({
        ...baseOpts,
        level: 'critical',
        lastPressureReapAt: now - SHELL_PRESSURE_ANTI_CHURN_MS - 10_000,
        taskStartTime: now - 5_000,
      }).shouldReap,
    ).toBe(true)

    // Live process.on('memoryPressure') listener in installShellPressureReap
    let killed = false
    let state: { tasks: Record<string, LocalShellTaskState> } = {
      tasks: {
        b12345678: {
          ...createTaskStateBase('b12345678', 'local_bash', 'sleep 999'),
          type: 'local_bash',
          status: 'running',
          command: 'sleep 999',
          completionStatusSentInAttachment: false,
          shellCommand: {
            status: 'backgrounded',
            kill: () => {
              killed = true
            },
          } as never,
          lastReportedTotalLines: 0,
          isBackgrounded: true,
          startTime: now - 100_000,
        },
      },
    }
    const registry = createTaskRegistry(
      () => state as unknown as AppState,
      updater => {
        state = updater(state as unknown as AppState) as unknown as typeof state
      },
    )

    const dispose = installShellPressureReap(
      'b12345678',
      'sleep 999',
      registry,
      undefined,
      'bash',
      undefined,
      {
        isInteractive: true,
        getNow: () => now,
        getLastInteraction: () => now - SHELL_PRESSURE_IDLE_MS - 5_000,
        isMainLoopBusy: () => false,
        checkHostMemory: () => ({ scarce: true, detail: 'test scarce' }),
      },
    )
    try {
      // 'warning' MUST NOT reap
      ;(process as EventEmitter).emit('memoryPressure', 'warning')
      expect(killed).toBe(false)
      expect(getLastPressureReapAt()).toBe(0)

      // 'critical' MUST reap & record lastPressureReapAt
      ;(process as EventEmitter).emit('memoryPressure', 'critical')
      expect(killed).toBe(true)
      expect(getLastPressureReapAt()).toBe(now)
    } finally {
      dispose()
      setLastPressureReapAt(0)
    }
  })

  test('startQuietCheckin enqueues shell-checkin notification after silence threshold', async () => {
    const queue = createMessageQueue()
    const state = {
      tasks: {
        bquiet001: {
          ...createTaskStateBase('bquiet001', 'local_bash', 'long build'),
          type: 'local_bash' as const,
          status: 'running' as const,
          command: 'make all',
          completionStatusSentInAttachment: false,
          shellCommand: { status: 'backgrounded' } as never,
          lastReportedTotalLines: 0,
          isBackgrounded: true,
          startTime: Date.now() - 10_000,
        },
      },
    }
    const registry = createTaskRegistry(
      () => state as unknown as AppState,
      () => {},
    )

    const dispose = startQuietCheckin(
      {
        taskId: 'bquiet001',
        description: 'long build',
        taskRegistry: registry,
      },
      {
        queue,
        thresholdMs: 35,
        pollMs: 10,
        getOutputSize: async () => 0,
        getLastInteraction: () => 0,
        isMainLoopBusy: () => false,
      },
    )

    try {
      await new Promise(r => setTimeout(r, 90))
      const cmds = queue.getCommands()
      expect(cmds.length).toBe(1)
      expect(cmds[0]!.origin?.source).toBe('shell-checkin')
      expect(String(cmds[0]!.value)).toContain(
        'This is a check-in, not a completion',
      )
      expect(String(cmds[0]!.value)).toContain('long build')
    } finally {
      dispose()
    }
  })
})

// ===========================================================================
// 5. Swarm Backend Registry (P1-13)
// ===========================================================================

describe('P1-13: Swarm Backend Registry explicit iterm2 & outside-read in-process force (2.1.328)', () => {
  test('explicit teammateMode=iterm2 runs before tmux detection and isInProcessEnabled returns false', async () => {
    const origTermProg = process.env.TERM_PROGRAM
    const origTmux = process.env.TMUX
    const origRemote = process.env.CLAUDE_CODE_REMOTE
    const prevInteractive = getIsInteractive()
    const prevInline = getFlagSettingsInline()
    delete process.env.TERM_PROGRAM
    delete process.env.CLAUDE_CODE_REMOTE
    process.env.TMUX = '/tmp/tmux-1000/default,123,0'

    try {
      setIsInteractive(true)
      setFlagSettingsInline(null)
      resetSettingsCache()
      clearCliTeammateModeOverride('iterm2' as TeammateMode)
      resetBackendDetection()
      expect(isInProcessEnabled()).toBe(false)

      // Even with TMUX set, explicit teammateMode=iterm2 throws iTerm2-specific error instead of picking tmux
      await expect(detectAndGetBackend()).rejects.toThrow(
        /teammateMode is set to "iterm2" but this session is not running inside iTerm2/,
      )
    } finally {
      setIsInteractive(prevInteractive)
      setFlagSettingsInline(prevInline)
      resetSettingsCache()
      if (origTermProg !== undefined) process.env.TERM_PROGRAM = origTermProg
      else delete process.env.TERM_PROGRAM
      if (origTmux !== undefined) process.env.TMUX = origTmux
      else delete process.env.TMUX
      if (origRemote !== undefined) process.env.CLAUDE_CODE_REMOTE = origRemote
      else delete process.env.CLAUDE_CODE_REMOTE
      clearCliTeammateModeOverride('auto')
      resetBackendDetection()
    }
  })

  test('isInProcessEnabled forces true when blockFileToolReadsOutsideWorkingDirectories or blockReadsOutsideWorkingDirectories is set', () => {
    const origRemote = process.env.CLAUDE_CODE_REMOTE
    const prevInteractive = getIsInteractive()
    delete process.env.CLAUDE_CODE_REMOTE
    const prevInline = getFlagSettingsInline()

    try {
      setIsInteractive(true)
      setFlagSettingsInline(null)
      resetSettingsCache()
      clearCliTeammateModeOverride('tmux')
      resetBackendDetection()
      expect(isInProcessEnabled()).toBe(false)

      // Force via permissions.blockFileToolReadsOutsideWorkingDirectories
      setFlagSettingsInline({
        permissions: {
          blockFileToolReadsOutsideWorkingDirectories: true,
        },
      })
      resetSettingsCache()
      expect(isInProcessEnabled()).toBe(true)

      // Force via permissions.blockReadsOutsideWorkingDirectories
      setFlagSettingsInline({
        permissions: {
          blockReadsOutsideWorkingDirectories: true,
        },
      })
      resetSettingsCache()
      expect(isInProcessEnabled()).toBe(true)
    } finally {
      setIsInteractive(prevInteractive)
      setFlagSettingsInline(prevInline)
      resetSettingsCache()
      if (origRemote !== undefined) process.env.CLAUDE_CODE_REMOTE = origRemote
      else delete process.env.CLAUDE_CODE_REMOTE
      clearCliTeammateModeOverride('auto')
    }
  })
})

// ===========================================================================
// 6. UDS Exit Keyfile Cleanup & IDE Workspace Matching (P2)
// ===========================================================================

describe('P2: UDS Exit Keyfile Cleanup & IDE Workspace Matching (2.1.328)', () => {
  test('startUdsMessaging registers synchronous exit handler that unlinks keyfile', async () => {
    const dir = makeTempDir('uds-exit-')
    const origConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = dir
    const sockPath = join(dir, 'm.sock')

    try {
      await startUdsMessaging(sockPath)
      const keyFile = join(
        dir,
        'sessions',
        deriveMessagingKeyName(process.pid, sockPath),
      )
      expect(existsSync(keyFile)).toBe(true)
      expect(process.listeners('exit')).toContain(unlinkUdsKeyFilesOnExit)

      // Simulate abrupt process exit synchronously unlinking the active keyfile
      unlinkUdsKeyFilesOnExit()
      expect(existsSync(keyFile)).toBe(false)
    } finally {
      await stopUdsMessaging()
      if (origConfigDir !== undefined)
        process.env.CLAUDE_CONFIG_DIR = origConfigDir
      else delete process.env.CLAUDE_CONFIG_DIR
    }
  })

  test('classifyIdeWorkspaceMatch classifies contains-cwd, inside-cwd, unrelated & deduplicateIdeLockfileDirs deduplicates by realpath', async () => {
    expect(
      classifyIdeWorkspaceMatch(
        '/Users/dev/monorepo/pkg-a',
        '/Users/dev/monorepo',
      ),
    ).toBe('contains-cwd')
    expect(
      classifyIdeWorkspaceMatch('/Users/dev/monorepo', '/Users/dev/monorepo'),
    ).toBe('contains-cwd')
    expect(
      classifyIdeWorkspaceMatch(
        '/Users/dev/monorepo',
        '/Users/dev/monorepo/pkg-a',
      ),
    ).toBe('inside-cwd')
    expect(
      classifyIdeWorkspaceMatch('/Users/dev/other', '/Users/dev/monorepo'),
    ).toBe('unrelated')
    // Prefix boundary safety (monorepo-2 is NOT inside monorepo)
    expect(
      classifyIdeWorkspaceMatch('/Users/dev/monorepo', '/Users/dev/monorepo-2'),
    ).toBe('unrelated')
    // Windows drive letter case normalization
    expect(
      classifyIdeWorkspaceMatch(
        'c:\\Users\\dev\\proj\\sub',
        'C:\\Users\\dev\\proj',
      ),
    ).toBe('contains-cwd')

    // Deduplicate symlink alias directory by realpath
    const dir = makeTempDir('ide-dedup-')
    const realDir = join(dir, 'real-ide')
    const linkDir = join(dir, 'link-ide')
    mkdirSync(realDir, { recursive: true })
    symlinkSync(realDir, linkDir, 'dir')

    const deduped = await deduplicateIdeLockfileDirs([
      realDir,
      linkDir,
      realDir,
    ])
    expect(deduped).toEqual([realDir])
  })
})
