import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { execFileSync } from 'child_process'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  unwatchFile,
  utimesSync,
  watchFile,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _getPreventSleepStateForTesting,
  forceStopPreventSleep,
  isHolding,
  startPreventSleep,
  stopPreventSleep,
} from '../../services/preventSleep.js'
import {
  _setAudioNapiForTesting,
  startRecording,
  stopRecording,
} from '../../services/voice.js'
import * as autoUpdaterMod from '../autoUpdater.js'
import { runCleanupFunctions } from '../cleanupRegistry.js'
import * as configMod from '../config.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  clearResolveGitDirCache,
  getCachedBranch,
  resetGitFileWatcher,
} from '../git/gitFilesystem.js'
import * as downloadMod from '../nativeInstaller/download.js'
import {
  installLatest,
  stopVersionLockMaintenanceForTesting,
} from '../nativeInstaller/installer.js'
import {
  acquireOrRefreshSharedLock,
  writePerPidLock,
} from '../nativeInstaller/pidLock.js'
import {
  _injectStdoutDrainPendingForTesting,
  _resetStdoutDrainStateForTesting,
  getPendingStdoutBytes,
  getStdoutDrainBudgetMs,
  registerProcessOutputErrorHandlers,
} from '../process.js'
import {
  clearProxyAuthHelperState,
  getConfiguredProxyAuthHelperCommand,
  runProxyAuthHelper,
  setProxyAuthHelperConfig,
} from '../proxyAuthHelper.js'
import {
  _resetKeychainPrefetchForTesting,
  _setKeychainPrefetchExecFileForTesting,
  clearLegacyApiKeyPrefetch,
  ensureKeychainPrefetchCompleted,
  getLegacyApiKeyPrefetchResult,
  startKeychainPrefetch,
} from '../secureStorage/keychainPrefetch.js'
import {
  getBootstrapSession,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'
import * as settingsMod from '../settings/settings.js'
import { withStatsCacheLock } from '../statsCache.js'
import {
  CREDENTIALS_STORE_HANDLE,
  type CredentialsStoreHandle,
  getPinnedCredentials,
  pinCredentialsStore,
  resetPinnedCredentialsForTests,
} from '../storageV5/credentialsStore.js'
import {
  isHoverRestOn,
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../storageV5/hoverRestPin.js'
import {
  getPinnedStorageV5,
  pinStorageV5,
  resetPinnedStorageV5ForTests,
  type StorageV5,
} from '../storageV5/index.js'
import {
  runSerializedByPath,
  withStorageLock,
} from '../storageV5/storageLock.js'
import {
  acquireStorageWatchBus,
  releaseStorageWatchBus,
} from '../storageV5/storageWatchBus.js'
import {
  _resetStreamJsonStdoutGuardForTesting,
  installStreamJsonStdoutGuard,
  STDOUT_GUARD_MARKER,
} from '../streamJsonStdoutGuard.js'
import { getClaudeSocketName, resetSocketState } from '../tmuxSocket.js'

const tick = (ms = 10): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

function makeFakeCredentialsHandle(tag: string): CredentialsStoreHandle {
  return {
    name: tag,
    read: () => null,
    readAsync: async () => null,
    update: () => ({ success: true }),
    delete: () => true,
    [CREDENTIALS_STORE_HANDLE]: 'CredentialsStoreHandle',
  }
}

describe('Wave 7 Fixer 3: Platform, OS-resource, Disk-lock, and Boot-pin ALS Fixes', () => {
  afterEach(() => {
    _resetStdoutDrainStateForTesting()
    resetHoverRestPinForTests()
    resetPinnedStorageV5ForTests()
    resetPinnedCredentialsForTests()
    clearProxyAuthHelperState()
    _resetKeychainPrefetchForTesting()
    forceStopPreventSleep()
    stopVersionLockMaintenanceForTesting()
    resetSocketState()
  })

  describe('P0-1: streamJsonStdoutGuard single process-global refcounted wrapper', () => {
    test('out-of-order Host A / Host B teardown never crashes process.stdout.write and restores only on 1 -> 0', async () => {
      const origStdoutWrite = process.stdout.write
      const origStderrWrite = process.stderr.write
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []

      const fakeStdoutWrite = ((chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(
          typeof chunk === 'string'
            ? chunk
            : Buffer.from(chunk).toString('utf-8'),
        )
        return true
      }) as typeof process.stdout.write
      const fakeStderrWrite = ((chunk: string | Uint8Array): boolean => {
        stderrChunks.push(
          typeof chunk === 'string'
            ? chunk
            : Buffer.from(chunk).toString('utf-8'),
        )
        return true
      }) as typeof process.stderr.write

      process.stdout.write = fakeStdoutWrite
      process.stderr.write = fakeStderrWrite

      try {
        let sessionA!: ReturnType<typeof getBootstrapSession>
        let sessionB!: ReturnType<typeof getBootstrapSession>

        const writeAfterA = runWithNewHostSession(
          { id: 'w7-guard-a' },
          session => {
            sessionA = session
            installStreamJsonStdoutGuard()
            return process.stdout.write
          },
        )
        const writeAfterB = runWithNewHostSession(
          { id: 'w7-guard-b' },
          session => {
            sessionB = session
            installStreamJsonStdoutGuard()
            return process.stdout.write
          },
        )

        // Single process-global wrapper shared across Host A and Host B (0 -> 1 wrap only)
        expect(writeAfterA).not.toBe(fakeStdoutWrite)
        expect(writeAfterB).toBe(writeAfterA)

        // Out-of-order teardown: Host A exits BEFORE Host B
        await runWithSession(sessionA, () => runCleanupFunctions())

        // Wrapper MUST stay installed and valid while Host B is still active!
        expect(process.stdout.write).toBe(writeAfterA)
        expect(() => process.stdout.write('{"from":"host-b"}\n')).not.toThrow()
        expect(() =>
          process.stdout.write('stray non-json line\n'),
        ).not.toThrow()
        expect(stdoutChunks).toEqual(['{"from":"host-b"}\n'])
        expect(
          stderrChunks.some(
            c =>
              c.includes(STDOUT_GUARD_MARKER) &&
              c.includes('stray non-json line'),
          ),
        ).toBe(true)

        // Now Host B tears down (1 -> 0): original write is restored cleanly
        await runWithSession(sessionB, () => runCleanupFunctions())
        expect(process.stdout.write).toBe(fakeStdoutWrite)

        // Post-teardown plain writes go directly to original stdout with zero crash
        expect(() =>
          process.stdout.write('plain after restore\n'),
        ).not.toThrow()
        expect(stdoutChunks).toContain('plain after restore\n')

        // Even calling a previously captured wrapper reference after 1 -> 0 never crashes
        expect(() => writeAfterA('late-captured-ref\n')).not.toThrow()
        expect(stdoutChunks).toContain('late-captured-ref\n')
      } finally {
        runWithNewHostSession({ id: 'w7-guard-clean' }, () => {
          _resetStreamJsonStdoutGuardForTesting()
        })
        process.stdout.write = origStdoutWrite
        process.stderr.write = origStderrWrite
      }
    })
  })

  describe('P0-7: storageV5 boot pins propagate to isolated hosts with per-host override support', () => {
    test('boot pins (hoverRestPin, pinStorageV5, pinCredentialsStore) are visible inside runWithNewHostSession and overridable per host', () => {
      const prevEnv = process.env.CLAUDE_CODE_HOVER_REST
      process.env.CLAUDE_CODE_HOVER_REST = '1'
      const bootBackend = { kind: 'boot-storage-v5' } as unknown as StorageV5
      const hostBBackend = { kind: 'host-b-storage-v5' } as unknown as StorageV5
      const bootCreds = makeFakeCredentialsHandle('boot-creds')
      const hostBCreds = makeFakeCredentialsHandle('host-b-creds')

      try {
        // Boot-time pinning outside ALS (default host, matching cli.tsx:228-239)
        const configHome = getClaudeConfigHomeDir()
        expect(pinHoverRest(true)).toBe('pinned')
        expect(pinStorageV5({ backend: bootBackend, configHome })).toBe(
          bootBackend,
        )
        pinCredentialsStore(bootCreds)

        // E4-P0-4: Isolated Host A (unset) MUST NOT inherit default host's pinned
        // storageV5 or credentialsStore (prevents cross-tenant credential/storage leakage)
        const hostA = runWithNewHostSession({ id: 'w7-sv5-a' }, () => ({
          hoverRestOn: isHoverRestOn(),
          storageV5: getPinnedStorageV5(),
          creds: getPinnedCredentials(),
        }))
        expect(hostA.hoverRestOn).toBe(true)
        expect(hostA.storageV5).toBeUndefined()
        expect(hostA.creds).toBeUndefined()

        // Isolated Host B explicitly sets & resets its own pins without polluting default host or Host A
        const hostB = runWithNewHostSession({ id: 'w7-sv5-b' }, () => {
          expect(pinHoverRest(false)).toBe('pinned')
          const overriddenOff = isHoverRestOn()
          pinCredentialsStore(hostBCreds)
          const credsOverride = getPinnedCredentials()
          pinCredentialsStore(undefined)
          const credsExplicitUndef = getPinnedCredentials()

          // Resetting Host B's hoverRest override lets it re-pin cleanly
          resetHoverRestPinForTests()
          expect(pinHoverRest(true)).toBe('pinned')
          expect(pinStorageV5({ backend: hostBBackend, configHome })).toBe(
            hostBBackend,
          )
          const storageOverride = getPinnedStorageV5()

          resetPinnedStorageV5ForTests()
          resetPinnedCredentialsForTests()
          resetHoverRestPinForTests()
          return {
            overriddenOff,
            credsOverride,
            credsExplicitUndef,
            storageOverride,
            afterResetStorage: getPinnedStorageV5(),
            afterResetCreds: getPinnedCredentials(),
          }
        })

        expect(hostB.overriddenOff).toBe(false)
        expect(hostB.credsOverride).toBe(hostBCreds)
        expect(hostB.credsExplicitUndef).toBeUndefined()
        expect(hostB.storageOverride).toBe(hostBBackend)
        expect(hostB.afterResetStorage).toBeUndefined()
        expect(hostB.afterResetCreds).toBeUndefined()

        // Default host remains completely untouched
        expect(isHoverRestOn()).toBe(true)
        expect(getPinnedStorageV5()).toBe(bootBackend)
        expect(getPinnedCredentials()).toBe(bootCreds)
      } finally {
        resetPinnedStorageV5ForTests()
        resetPinnedCredentialsForTests()
        resetHoverRestPinForTests()
        if (prevEnv === undefined) delete process.env.CLAUDE_CODE_HOVER_REST
        else process.env.CLAUDE_CODE_HOVER_REST = prevEnv
      }
    })
  })

  describe('P0-8: process-global disk lock serialization for storageLock & statsCache', () => {
    test('storageLock runSerializedByPath and withStorageLock serialize concurrent hosts on the same physical path while preserving caller ALS', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'w7-storage-lock-'))
      const sharedPath = join(dir, 'shared-file.json')
      const lockTarget = join(dir, 'locked-resource.json')
      writeFileSync(lockTarget, '{}')
      try {
        let activePath = 0
        let maxActivePath = 0
        const observedIds: string[] = []

        await Promise.all([
          runWithNewHostSession({ id: 'w7-slock-a' }, async () => {
            await runSerializedByPath(sharedPath, async () => {
              activePath += 1
              maxActivePath = Math.max(maxActivePath, activePath)
              observedIds.push(`A:${getBootstrapSession().id}`)
              await tick(25)
              expect(getBootstrapSession().id).toBe('w7-slock-a')
              activePath -= 1
            })
          }),
          runWithNewHostSession({ id: 'w7-slock-b' }, async () => {
            await tick(5)
            await runSerializedByPath(sharedPath, async () => {
              activePath += 1
              maxActivePath = Math.max(maxActivePath, activePath)
              observedIds.push(`B:${getBootstrapSession().id}`)
              await tick(15)
              expect(getBootstrapSession().id).toBe('w7-slock-b')
              activePath -= 1
            })
          }),
        ])

        expect(maxActivePath).toBe(1)
        expect(observedIds).toEqual(['A:w7-slock-a', 'B:w7-slock-b'])

        // Also verify withStorageLock serializes across two hosts & preserves caller ALS
        let activeLock = 0
        let maxActiveLock = 0
        const lockIds: string[] = []
        const [resA, resB] = await Promise.all([
          runWithNewHostSession({ id: 'w7-wlock-a' }, () =>
            withStorageLock(
              lockTarget,
              async () => {
                activeLock += 1
                maxActiveLock = Math.max(maxActiveLock, activeLock)
                lockIds.push(getBootstrapSession().id)
                await tick(20)
                activeLock -= 1
                return { ok: true, value: getBootstrapSession().id }
              },
              {
                ifReentrant: () => ({
                  ok: false,
                  error: { code: 'Reentrant' },
                }),
                ifContended: () => ({
                  ok: false,
                  error: { code: 'Contended' },
                }),
              },
            ),
          ),
          runWithNewHostSession({ id: 'w7-wlock-b' }, async () => {
            await tick(5)
            return withStorageLock(
              lockTarget,
              async () => {
                activeLock += 1
                maxActiveLock = Math.max(maxActiveLock, activeLock)
                lockIds.push(getBootstrapSession().id)
                await tick(10)
                activeLock -= 1
                return { ok: true, value: getBootstrapSession().id }
              },
              {
                ifReentrant: () => ({
                  ok: false,
                  error: { code: 'Reentrant' },
                }),
                ifContended: () => ({
                  ok: false,
                  error: { code: 'Contended' },
                }),
              },
            )
          }),
        ])

        expect(maxActiveLock).toBe(1)
        expect(resA).toEqual({ ok: true, value: 'w7-wlock-a' })
        expect(resB).toEqual({ ok: true, value: 'w7-wlock-b' })
        expect(lockIds).toEqual(['w7-wlock-a', 'w7-wlock-b'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test('statsCache withStatsCacheLock serializes concurrent hosts sharing the same CLAUDE_CONFIG_DIR and allows distinct dirs concurrently', async () => {
      const dir1 = mkdtempSync(join(tmpdir(), 'w7-stats-cfg1-'))
      const dir2 = mkdtempSync(join(tmpdir(), 'w7-stats-cfg2-'))
      const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
      try {
        process.env.CLAUDE_CONFIG_DIR = dir1
        getClaudeConfigHomeDir.cache?.clear?.()

        let activeStats = 0
        let maxActiveStats = 0
        const alsIds: string[] = []

        await Promise.all([
          runWithNewHostSession({ id: 'w7-stats-a' }, async () => {
            await withStatsCacheLock(async () => {
              activeStats += 1
              maxActiveStats = Math.max(maxActiveStats, activeStats)
              alsIds.push(getBootstrapSession().id)
              await tick(30)
              expect(getBootstrapSession().id).toBe('w7-stats-a')
              activeStats -= 1
            })
          }),
          runWithNewHostSession({ id: 'w7-stats-b' }, async () => {
            await tick(5)
            await withStatsCacheLock(async () => {
              activeStats += 1
              maxActiveStats = Math.max(maxActiveStats, activeStats)
              alsIds.push(getBootstrapSession().id)
              await tick(10)
              expect(getBootstrapSession().id).toBe('w7-stats-b')
              activeStats -= 1
            })
          }),
        ])

        expect(maxActiveStats).toBe(1)
        expect(alsIds).toEqual(['w7-stats-a', 'w7-stats-b'])

        // Distinct CLAUDE_CONFIG_DIR paths do NOT block each other
        let dir2EnteredWhileDir1Held = false
        let releaseDir1!: () => void
        const holdDir1 = new Promise<void>(resolve => {
          releaseDir1 = resolve
        })

        const p1 = runWithNewHostSession({ id: 'w7-stats-d1' }, async () => {
          process.env.CLAUDE_CONFIG_DIR = dir1
          getClaudeConfigHomeDir.cache?.clear?.()
          await withStatsCacheLock(async () => {
            await holdDir1
          })
        })
        await tick(10)
        const p2 = runWithNewHostSession({ id: 'w7-stats-d2' }, async () => {
          process.env.CLAUDE_CONFIG_DIR = dir2
          getClaudeConfigHomeDir.cache?.clear?.()
          await withStatsCacheLock(async () => {
            dir2EnteredWhileDir1Held = true
            releaseDir1()
          })
        })
        await Promise.all([p1, p2])
        expect(dir2EnteredWhileDir1Held).toBe(true)
      } finally {
        if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
        else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
        getClaudeConfigHomeDir.cache?.clear?.()
        rmSync(dir1, { recursive: true, force: true })
        rmSync(dir2, { recursive: true, force: true })
      }
    })
  })

  describe('P1-1: process.ts process-global IO accounting and single listener guard', () => {
    test('registerProcessOutputErrorHandlers adds 0 extra listeners across 12 isolated hosts and stdout accounting is visible outside ALS', () => {
      // Prime once so the process-wide guard is set
      registerProcessOutputErrorHandlers()
      const stdinBefore = process.stdin.listenerCount('error')
      const stdoutBefore = process.stdout.listenerCount('error')
      const stderrBefore = process.stderr.listenerCount('error')

      for (let i = 0; i < 12; i++) {
        runWithNewHostSession({ id: `w7-proc-host-${i}` }, () => {
          registerProcessOutputErrorHandlers()
        })
      }

      expect(process.stdin.listenerCount('error')).toBe(stdinBefore)
      expect(process.stdout.listenerCount('error')).toBe(stdoutBefore)
      expect(process.stderr.listenerCount('error')).toBe(stderrBefore)

      // Writes accounted inside an isolated host MUST be visible outside ALS (process exit drain)
      runWithNewHostSession({ id: 'w7-proc-writer' }, () => {
        _injectStdoutDrainPendingForTesting(1_048_576, 0)
      })
      expect(getPendingStdoutBytes()).toBe(1_048_576)
      expect(getStdoutDrainBudgetMs()).toBe(4000)
    })
  })

  describe('P1-2: tmuxSocket assigns distinct socket names to isolated hosts', () => {
    test('Host A, Host B, and default host all receive distinct tmux socket names', () => {
      resetSocketState()
      const defaultSocket = getClaudeSocketName()
      expect(defaultSocket).toBe(`claude-${process.pid}`)

      const socketA1 = runWithNewHostSession({ id: 'w7-tmux-a' }, session => {
        const first = getClaudeSocketName()
        const second = runWithSession(session, () => getClaudeSocketName())
        expect(second).toBe(first)
        return first
      })
      const socketB1 = runWithNewHostSession({ id: 'w7-tmux-b' }, () =>
        getClaudeSocketName(),
      )

      expect(socketA1).toMatch(new RegExp(`^claude-${process.pid}-\\d+$`))
      expect(socketB1).toMatch(new RegExp(`^claude-${process.pid}-\\d+$`))
      expect(socketA1).not.toBe(socketB1)
      expect(socketA1).not.toBe(defaultSocket)
      expect(socketB1).not.toBe(defaultSocket)
    })
  })

  describe('P1-3: pidLock exit handler dedup & installer process-global installLatest dedup', () => {
    test('writePerPidLock and acquireOrRefreshSharedLock across 12 hosts add at most 1 exit listener each', async () => {
      const locksDir = mkdtempSync(join(tmpdir(), 'w7-pidlock-'))
      try {
        const beforePerPid = process.listenerCount('exit')
        for (let i = 0; i < 12; i++) {
          runWithNewHostSession({ id: `w7-pid-host-${i}` }, () => {
            expect(writePerPidLock('/fake/versions/2.1.331', locksDir)).toBe(
              true,
            )
          })
        }
        const afterPerPid = process.listenerCount('exit')
        expect(afterPerPid - beforePerPid).toBeLessThanOrEqual(1)

        // Second round of 12 hosts adds strictly 0 listeners
        for (let i = 12; i < 24; i++) {
          runWithNewHostSession({ id: `w7-pid-host-${i}` }, () => {
            expect(writePerPidLock('/fake/versions/2.1.331', locksDir)).toBe(
              true,
            )
          })
        }
        expect(process.listenerCount('exit')).toBe(afterPerPid)

        // Shared lock across multiple hosts also adds at most 1 exit listener
        const beforeShared = process.listenerCount('exit')
        for (let i = 0; i < 6; i++) {
          const lockFile = join(locksDir, `2.1.${300 + i}.lock`)
          await runWithNewHostSession(
            { id: `w7-shared-host-${i}` },
            async () => {
              const ok = await acquireOrRefreshSharedLock(
                `/fake/versions/2.1.${300 + i}`,
                lockFile,
              )
              expect(ok).toBe(true)
            },
          )
        }
        expect(
          process.listenerCount('exit') - beforeShared,
        ).toBeLessThanOrEqual(1)
      } finally {
        rmSync(locksDir, { recursive: true, force: true })
      }
    })

    test('installLatest deduplicates concurrent calls across two isolated hosts', async () => {
      let latestCalls = 0
      let resolveVersion!: (v: string) => void
      const versionPromise = new Promise<string>(resolve => {
        resolveVersion = resolve
      })

      const maxSpy = spyOn(autoUpdaterMod, 'getMaxVersion').mockResolvedValue(
        undefined,
      )
      const latestSpy = spyOn(
        downloadMod,
        'getLatestVersion',
      ).mockImplementation(() => {
        latestCalls += 1
        return versionPromise
      })

      try {
        const pA = runWithNewHostSession({ id: 'w7-inst-a' }, () =>
          installLatest('latest'),
        )
        const pB = runWithNewHostSession({ id: 'w7-inst-b' }, () =>
          installLatest('latest'),
        )

        // Exact same in-flight Promise returned across Host A & Host B
        expect(pA).toBe(pB)
        await tick(10)
        expect(latestCalls).toBe(1)

        // Reject cleanly via invalid version so no real network/disk install runs
        resolveVersion('invalid-dedup-test-version')
        await expect(pA).rejects.toThrow(/not a well-formed version/)
        await expect(pB).rejects.toThrow(/not a well-formed version/)
      } finally {
        maxSpy.mockRestore()
        latestSpy.mockRestore()
      }
    })
  })

  describe('P1-12: gitFilesystem uses 2-arg unwatchFile(path, listener)', () => {
    test('Host A calling resetGitFileWatcher does NOT kill Host B or sibling watchFile listeners on the same .git/HEAD', async () => {
      const repoDir = realpathSync(mkdtempSync(join(tmpdir(), 'w7-gitfs-')))
      const gitEnv: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      }
      const headPath = join(repoDir, '.git', 'HEAD')
      let externalFired = 0
      const externalListener = () => {
        externalFired += 1
      }

      let sessionA!: ReturnType<typeof getBootstrapSession>
      let sessionB!: ReturnType<typeof getBootstrapSession>

      try {
        execFileSync('git', ['init'], {
          cwd: repoDir,
          env: gitEnv,
          stdio: 'pipe',
        })
        execFileSync('git', ['checkout', '-b', 'branch-one'], {
          cwd: repoDir,
          env: gitEnv,
          stdio: 'pipe',
        })
        execFileSync('git', ['config', '--local', 'user.email', 'a@b.test'], {
          cwd: repoDir,
          env: gitEnv,
          stdio: 'pipe',
        })
        execFileSync('git', ['config', '--local', 'user.name', 'Test'], {
          cwd: repoDir,
          env: gitEnv,
          stdio: 'pipe',
        })
        writeFileSync(join(repoDir, 'file.txt'), 'v1\n')
        execFileSync('git', ['add', 'file.txt'], {
          cwd: repoDir,
          env: gitEnv,
          stdio: 'pipe',
        })
        execFileSync(
          'git',
          ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'],
          { cwd: repoDir, env: gitEnv, stdio: 'pipe' },
        )

        watchFile(
          headPath,
          { interval: 15, persistent: false },
          externalListener,
        )

        // Start GitFileWatcher on BOTH Host A and Host B for the same repo
        const branchA = await runWithNewHostSession(
          {
            id: 'w7-git-a',
            cwd: repoDir,
            originalCwd: repoDir,
            projectRoot: repoDir,
          },
          async session => {
            sessionA = session
            clearResolveGitDirCache()
            return getCachedBranch()
          },
        )
        const branchB1 = await runWithNewHostSession(
          {
            id: 'w7-git-b',
            cwd: repoDir,
            originalCwd: repoDir,
            projectRoot: repoDir,
          },
          async session => {
            sessionB = session
            clearResolveGitDirCache()
            return getCachedBranch()
          },
        )
        expect(branchA).toBe('branch-one')
        expect(branchB1).toBe('branch-one')

        // Host A tears down its watcher — MUST NOT kill Host B's watcher or externalListener!
        runWithSession(sessionA, () => {
          resetGitFileWatcher()
        })

        // Switch branch on disk and bump mtime so stat polling definitely observes a delta
        execFileSync('git', ['checkout', '-b', 'branch-two'], {
          cwd: repoDir,
          env: gitEnv,
          stdio: 'pipe',
        })
        const future = new Date(Date.now() + 2000)
        utimesSync(headPath, future, future)

        // Wait for polling interval (WATCH_INTERVAL_MS is 10ms in test env)
        const deadline = Date.now() + 1500
        let branchB2 = 'branch-one'
        while (Date.now() < deadline) {
          await tick(25)
          branchB2 = await runWithSession(sessionB, () => getCachedBranch())
          if (branchB2 === 'branch-two' && externalFired > 0) {
            break
          }
        }

        expect(branchB2).toBe('branch-two')
        expect(externalFired).toBeGreaterThan(0)
      } finally {
        unwatchFile(headPath, externalListener)
        if (sessionA) {
          runWithSession(sessionA, () => resetGitFileWatcher())
        }
        if (sessionB) {
          runWithSession(sessionB, () => resetGitFileWatcher())
        }
        rmSync(repoDir, { recursive: true, force: true })
      }
    })
  })

  describe('P2-1: storageWatchBus process-global sharing & per-listener ALS', () => {
    test('shares one bus per configHome, preserves cross-host echo suppression, and invokes each listener in its own ALS', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'w7-watchbus-'))
      try {
        const busA = runWithNewHostSession({ id: 'w7-wb-a' }, () =>
          acquireStorageWatchBus(dir),
        )
        const busB = runWithNewHostSession({ id: 'w7-wb-b' }, () =>
          acquireStorageWatchBus(dir),
        )

        expect(busA).toBe(busB)
        expect(busA.referenceCount).toBe(2)

        const seenFromA: string[] = []
        const seenFromB: string[] = []
        const offA = runWithNewHostSession({ id: 'w7-wb-listener-a' }, () =>
          busA.addListener((_chg, src) => {
            seenFromA.push(`${src}@${getBootstrapSession().id}`)
          }),
        )
        const offB = runWithNewHostSession({ id: 'w7-wb-listener-b' }, () =>
          busB.addListener((_chg, src) => {
            seenFromB.push(`${src}@${getBootstrapSession().id}`)
          }),
        )

        const stopExpect = busA.expect('shared-key')
        expect(busB.isWritingLocally('shared-key')).toBe(true)
        busA.emit({ kind: 'updated' }, 'writer-a')
        stopExpect()
        expect(busB.isWritingLocally('shared-key')).toBe(false)

        expect(seenFromA).toEqual(['writer-a@w7-wb-listener-a'])
        expect(seenFromB).toEqual(['writer-a@w7-wb-listener-b'])

        offA()
        offB()

        // Releasing first ref keeps bus registered while second holder is alive
        await releaseStorageWatchBus(dir)
        expect(busA.referenceCount).toBe(1)
        await releaseStorageWatchBus(dir)
        expect(busA.referenceCount).toBe(0)

        // Re-acquiring after full release creates a fresh bus
        const busFresh = acquireStorageWatchBus(dir)
        expect(busFresh).not.toBe(busA)
        await releaseStorageWatchBus(dir)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('P2-2: preventSleep single process-global caffeinate + per-host refcount cleanup', () => {
    test('shares one process-global caffeinate across hosts and per-host cleanup releases only that host', async () => {
      let sessionA!: ReturnType<typeof getBootstrapSession>
      let sessionB!: ReturnType<typeof getBootstrapSession>

      try {
        runWithNewHostSession({ id: 'w7-sleep-a' }, session => {
          sessionA = session
          startPreventSleep()
          startPreventSleep()
        })
        const stateAfterA = runWithSession(sessionA, () =>
          _getPreventSleepStateForTesting(),
        )
        expect(stateAfterA.hostHeld).toBe(2)
        expect(stateAfterA.totalRefCount).toBe(2)

        runWithNewHostSession({ id: 'w7-sleep-b' }, session => {
          sessionB = session
          startPreventSleep()
        })
        const stateAfterB = runWithSession(sessionB, () =>
          _getPreventSleepStateForTesting(),
        )
        expect(stateAfterB.hostHeld).toBe(1)
        expect(stateAfterB.totalRefCount).toBe(3)
        // Single process-global caffeinate child across BOTH hosts on macOS
        if (process.platform === 'darwin') {
          expect(stateAfterA.caffeinateProcess).not.toBeNull()
          expect(stateAfterB.caffeinateProcess).toBe(
            stateAfterA.caffeinateProcess,
          )
          expect(stateAfterB.hasRestartInterval).toBe(true)
        }

        // Host A exits via cleanupRegistry -> decrements ONLY Host A's 2 assertions!
        await runWithSession(sessionA, () => runCleanupFunctions())
        expect(runWithSession(sessionA, () => isHolding())).toBe(false)
        expect(runWithSession(sessionB, () => isHolding())).toBe(true)

        const stateAfterACleanup = runWithSession(sessionB, () =>
          _getPreventSleepStateForTesting(),
        )
        expect(stateAfterACleanup.totalRefCount).toBe(1)
        expect(stateAfterACleanup.hostHeld).toBe(1)
        if (process.platform === 'darwin') {
          expect(stateAfterACleanup.caffeinateProcess).toBe(
            stateAfterA.caffeinateProcess,
          )
        }

        // Host B exits via cleanupRegistry -> totalRefCount reaches 0 and stops caffeinate + interval
        await runWithSession(sessionB, () => runCleanupFunctions())
        expect(runWithSession(sessionB, () => isHolding())).toBe(false)

        const stateFinal = _getPreventSleepStateForTesting()
        expect(stateFinal.totalRefCount).toBe(0)
        expect(stateFinal.caffeinateProcess).toBeNull()
        expect(stateFinal.hasRestartInterval).toBe(false)

        // Verify stopPreventSleep grace period ownership
        runWithSession(sessionA, () => {
          startPreventSleep()
          stopPreventSleep()
          expect(isHolding()).toBe(true)
        })
        expect(runWithSession(sessionB, () => isHolding())).toBe(false)
        runWithSession(sessionA, () => forceStopPreventSleep())
        expect(_getPreventSleepStateForTesting().totalRefCount).toBe(0)
        expect(_getPreventSleepStateForTesting().hasPendingKillTimeout).toBe(
          false,
        )
      } finally {
        if (sessionA) runWithSession(sessionA, () => forceStopPreventSleep())
        if (sessionB) runWithSession(sessionB, () => forceStopPreventSleep())
        forceStopPreventSleep()
      }
    })
  })

  describe('P2-3: voice.ts tracks activeNativeOwnerHost so stale Host A never kills Host B recording', () => {
    test('Host A stopRecording does NOT call stopNativeRecording after Host B takes ownership', async () => {
      if (process.platform === 'linux') {
        // Native cpal path requires ALSA cards on Linux; macOS/Windows run directly
        return
      }
      let nativeActive = false
      let startCalls = 0
      let stopCalls = 0
      const fakeNapi = {
        isNativeAudioAvailable: () => true,
        isNativeRecordingActive: () => nativeActive,
        startNativeRecording: () => {
          startCalls += 1
          nativeActive = true
          return true
        },
        stopNativeRecording: () => {
          stopCalls += 1
          nativeActive = false
        },
      } as unknown as typeof import('audio-capture-napi')

      let sessionA!: ReturnType<typeof getBootstrapSession>
      let sessionB!: ReturnType<typeof getBootstrapSession>

      try {
        const startedA = await runWithNewHostSession(
          { id: 'w7-voice-a' },
          async session => {
            sessionA = session
            _setAudioNapiForTesting(fakeNapi)
            return startRecording(
              () => {},
              () => {},
              { silenceDetection: false },
            )
          },
        )
        expect(startedA).toBe(true)
        expect(startCalls).toBe(1)
        expect(stopCalls).toBe(0)

        // Host B starts recording and takes ownership of the singleton native mic
        const startedB = await runWithNewHostSession(
          { id: 'w7-voice-b' },
          async session => {
            sessionB = session
            _setAudioNapiForTesting(fakeNapi)
            return startRecording(
              () => {},
              () => {},
              { silenceDetection: false },
            )
          },
        )
        expect(startedB).toBe(true)
        expect(startCalls).toBe(2)
        expect(stopCalls).toBe(1)
        expect(nativeActive).toBe(true)

        // Host A calling stopRecording() MUST NOT stop Host B's live native recording!
        runWithSession(sessionA, () => {
          stopRecording()
        })
        expect(stopCalls).toBe(1)
        expect(nativeActive).toBe(true)

        // Host B calling stopRecording() DOES stop its own recording
        runWithSession(sessionB, () => {
          stopRecording()
        })
        expect(stopCalls).toBe(2)
        expect(nativeActive).toBe(false)
      } finally {
        if (sessionA) {
          runWithSession(sessionA, () => _setAudioNapiForTesting(null))
        }
        if (sessionB) {
          runWithSession(sessionB, () => _setAudioNapiForTesting(null))
        }
      }
    })
  })

  describe('P2-4: keychainPrefetch & proxyAuthHelper boot inheritance and trustAccepted default', () => {
    test('keychainPrefetch falls back to boot prefetch on isolated hosts while preserving per-host clear', async () => {
      const prevSimple = process.env.CLAUDE_CODE_SIMPLE
      delete process.env.CLAUDE_CODE_SIMPLE
      try {
        _resetKeychainPrefetchForTesting()
        _setKeychainPrefetchExecFileForTesting((_f, _args, _opts, cb) => {
          setTimeout(() => cb(null, 'sk-boot-keychain\n', ''), 10)
        })
        // Boot prefetch on default host
        startKeychainPrefetch()

        // Isolated Host A awaits and reuses default host's boot prefetch
        const hostARes = await runWithNewHostSession(
          { id: 'w7-kc-a' },
          async () => {
            await ensureKeychainPrefetchCompleted(2000)
            return getLegacyApiKeyPrefetchResult()
          },
        )
        expect(hostARes).toEqual({ stdout: 'sk-boot-keychain' })

        // Isolated Host B explicitly clears its own legacy prefetch without clearing default/Host A
        const hostBRes = runWithNewHostSession({ id: 'w7-kc-b' }, () => {
          clearLegacyApiKeyPrefetch()
          return getLegacyApiKeyPrefetchResult()
        })
        expect(hostBRes).toBeNull()
        expect(getLegacyApiKeyPrefetchResult()).toEqual({
          stdout: 'sk-boot-keychain',
        })
      } finally {
        _resetKeychainPrefetchForTesting()
        if (prevSimple === undefined) delete process.env.CLAUDE_CODE_SIMPLE
        else process.env.CLAUDE_CODE_SIMPLE = prevSimple
      }
    })

    test('proxyAuthHelper inherits boot config on isolated hosts and defaults trustAccepted to checkHasTrustDialogAccepted()', async () => {
      const prevEnable = process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER
      process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER = '1'
      const helper =
        process.platform === 'win32'
          ? 'node -e "console.log(\'Bearer w7-boot-tok\')"'
          : 'printf "Bearer w7-boot-tok"'

      const trustSpy = spyOn(
        configMod,
        'checkHasTrustDialogAccepted',
      ).mockReturnValue(true)

      try {
        // 1. Boot config set on default host propagates to unconfigured isolated Host A
        setProxyAuthHelperConfig({
          helper,
          fromProjectOrLocal: true,
        })
        const hostACmd = runWithNewHostSession({ id: 'w7-proxy-a' }, () =>
          getConfiguredProxyAuthHelperCommand(),
        )
        expect(hostACmd).toBe(helper)

        // Because trustAccepted defaults to checkHasTrustDialogAccepted() (mocked true),
        // interactive project/local helper executes instead of being silently skipped!
        const hostATok = await runWithNewHostSession(
          { id: 'w7-proxy-a2' },
          () => runProxyAuthHelper({ isNonInteractive: false }),
        )
        expect(hostATok).toBe('Bearer w7-boot-tok')

        // 2. Host B overriding config does NOT clobber default host or Host A
        const hostBCmd = runWithNewHostSession({ id: 'w7-proxy-b' }, () => {
          setProxyAuthHelperConfig({ helper: 'echo host-b-only' })
          return getConfiguredProxyAuthHelperCommand()
        })
        expect(hostBCmd).toBe('echo host-b-only')
        expect(getConfiguredProxyAuthHelperCommand()).toBe(helper)

        // 3. Even when default host is cleared and the isolated host NEVER calls
        // setProxyAuthHelperConfig/configureProxyAuthHelperFromSettings, the HostSlot
        // factory defaults trustAccepted to () => checkHasTrustDialogAccepted()!
        clearProxyAuthHelperState()
        const settingsSpy = spyOn(
          settingsMod,
          'getSettings_DEPRECATED',
        ).mockReturnValue({ proxyAuthHelper: helper })
        const sourceSpy = spyOn(
          settingsMod,
          'getSettingsForSource',
        ).mockImplementation(source =>
          source === 'projectSettings' ? { proxyAuthHelper: helper } : null,
        )
        try {
          const hostCTok = await runWithNewHostSession(
            { id: 'w7-proxy-c' },
            () => runProxyAuthHelper({ isNonInteractive: false }),
          )
          expect(hostCTok).toBe('Bearer w7-boot-tok')

          // And when checkHasTrustDialogAccepted() returns false, trust gate skips it
          trustSpy.mockReturnValue(false)
          const hostDSkipped = await runWithNewHostSession(
            { id: 'w7-proxy-d' },
            () => runProxyAuthHelper({ isNonInteractive: false }),
          )
          expect(hostDSkipped).toBeNull()
        } finally {
          settingsSpy.mockRestore()
          sourceSpy.mockRestore()
        }
      } finally {
        trustSpy.mockRestore()
        clearProxyAuthHelperState()
        if (prevEnable === undefined) {
          delete process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER
        } else {
          process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER = prevEnable
        }
      }
    })
  })
})
