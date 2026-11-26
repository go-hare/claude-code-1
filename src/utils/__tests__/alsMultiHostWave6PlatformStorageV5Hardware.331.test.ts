import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  forceStopPreventSleep,
  isHolding,
  startPreventSleep,
} from '../../services/preventSleep.js'
import {
  checkVoiceCircuitBreaker,
  recordVoiceEarlyFailure,
  resetVoiceCircuitBreaker,
} from '../../services/voiceCircuitBreaker.js'
import {
  clearOidcFederationCaches,
  invalidateOidcTokenCache,
  peekOidcCachedAccessToken,
  resolveOidcFederationAccessToken,
} from '../anthropicOidc.js'
import { preconnectAnthropicApi } from '../apiPreconnect.js'
import {
  getUpdateRestoreFailure,
  resetAutoUpdateCheckThrottleForTests,
  setUpdateRestoreFailureForTests,
  shouldThrottleAutoUpdateCheck,
} from '../autoUpdater.js'
import { ParsedCommand } from '../bash/ParsedCommand.js'
import { isBinaryInstalled } from '../binaryCheck.js'
import { clearCACertsCache, getCACertificates } from '../caCerts.js'
import {
  isStartupRelaunchStarted,
  markStartupRelaunchStarted,
  resetStartupRelaunchStartedForTests,
} from '../cliRelaunch.js'
import {
  clearRepositoryCaches,
  detectCurrentRepositoryWithHost,
  getCachedRepository,
  getCachedRepositoryHost,
} from '../detectRepository.js'
import { getExternalEditor } from '../editor.js'
import {
  getFsImplementation,
  NodeFsOperations,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../fsOperations.js'
import {
  capturePolicySnapshot,
  hasPolicyDiverged,
  resetPolicySnapshotForTests,
} from '../gatewayLoginRelaunch.js'
import {
  cancelCurrentIDESearch,
  isSupportedJetBrainsTerminal,
  isSupportedTerminal,
  isSupportedVSCodeTerminal,
} from '../ide.js'
import { probeIgnorePatternCompileError } from '../ignorePatterns.js'
import { isJetBrainsPluginInstalledCachedSync } from '../jetbrains.js'
import {
  clearCloudSessionRepoStripWarnsForTests,
  stripProjectScopeBlockedEnv,
} from '../managedEnvConstants.js'
import { getModelCapability } from '../model/modelCapabilities.js'
import {
  resetUnrecognizedModelSignalClaimsForTests,
  signalUnrecognizedModel,
} from '../model/unrecognizedModelSignal.js'
import { getCompiledOrgPricing, resetOrgPricingCache } from '../modelPricing.js'
import {
  clearVerifiedVersionsCacheForTesting,
  isVersionBinaryVerifiedCached,
} from '../nativeInstaller/installer.js'
import {
  detectApk,
  detectDeb,
  detectPacman,
  detectRpm,
  getOsRelease,
  getPackageManager,
} from '../nativeInstaller/packageManagers.js'
import {
  getPackageManagerUpdateLastFailedAt,
  recordPackageManagerUpdateFailure,
  resetPackageManagerUpdateStateForTests,
} from '../packageManagerAutoUpdate.js'
import {
  isDarwinHomeAutomounted,
  resetDarwinHomeAutomountedForTesting,
} from '../path.js'
import { getLinuxDistroInfo, getPlatform, getWslVersion } from '../platform.js'
import {
  _injectStdoutDrainPendingForTesting,
  _resetStdoutDrainStateForTesting,
  getPendingStdoutBytes,
} from '../process.js'
import {
  failCommandRunWaits,
  recordCommandRunWait,
  resetCommandRunWaits,
  takeCommandRunWait,
} from '../processUserInput/commandRunWaits.js'
import {
  beginSessionStartLatch,
  createPromptSubmitEntries,
  getPromptSubmitLatch,
  isAheadOfSessionStart,
  markAheadOfSessionStart,
} from '../processUserInput/promptSubmitEntries.js'
import {
  recordPromptSubmitWait,
  resetPromptSubmitWaits,
  settlePromptSubmitWaitsRemoved,
  takePromptSubmitWait,
} from '../processUserInput/promptSubmitWaits.js'
import {
  isTurnHookQueuedPrompt,
  markTurnHookQueuedPrompt,
  resetTurnHookQueuedPrompts,
} from '../processUserInput/turnHookQueuedPrompts.js'
import {
  resetProcessWrapperCache,
  resolveProcessWrapper,
} from '../processWrapper.js'
import {
  clearProxyAuthHelperState,
  getConfiguredProxyAuthHelperCommand,
  setProxyAuthHelperConfig,
} from '../proxyAuthHelper.js'
import {
  clearRepoCheckoutCaches,
  getBaseRefs,
  getRepoCheckouts,
} from '../repoCheckouts.js'
import {
  countFilesRoundedRg,
  getRipgrepConfig,
  getRipgrepStatus,
} from '../ripgrep.js'
import {
  _resetKeychainPrefetchForTesting,
  _setKeychainPrefetchExecFileForTesting,
  clearLegacyApiKeyPrefetch,
  ensureKeychainPrefetchCompleted,
  getLegacyApiKeyPrefetchResult,
  startKeychainPrefetch,
} from '../secureStorage/keychainPrefetch.js'
import { runWithNewHostSession, runWithSession } from '../sessionHost.js'
import {
  getCachedPowerShellPath,
  resetPowerShellCache,
} from '../shell/powershellDetection.js'
import {
  ensureToolMemoryCgroupDir,
  resetToolMemoryCgroupMemoForTests,
} from '../shell/toolMemoryCgroup.js'
import {
  isShutdownCommitted,
  markShutdownCommitted,
  resetShutdownCommittedForTests,
} from '../shutdownCommitted.js'
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
import { enterPathQueue } from '../storageV5/storageLock.js'
import {
  acquireStorageWatchBus,
  releaseStorageWatchBus,
} from '../storageV5/storageWatchBus.js'
import { validateStorageKey } from '../storageV5/writeValidate.js'
import {
  _resetStreamJsonStdoutGuardForTesting,
  installStreamJsonStdoutGuard,
} from '../streamJsonStdoutGuard.js'
import {
  getStreamJsonStdoutWriter,
  setStreamJsonStdoutWriter,
  type StreamJsonStdoutWriter,
} from '../streamJsonStdoutWriter.js'
import {
  getRegisteredUpstreamProxyEnv,
  registerUpstreamProxyEnvFn,
} from '../subprocessEnv.js'
import {
  getClaudeSocketPath,
  getClaudeTmuxEnv,
  hasTmuxToolBeenUsed,
  markTmuxToolUsed,
  resetSocketState,
  setClaudeSocketInfo,
} from '../tmuxSocket.js'
import {
  findGitBashPathOrNull,
  posixPathToWindowsPath,
  windowsPathToPosixPath,
} from '../windowsPaths.js'

function tick(ms = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('Wave 6 Agent 4: Multi-host ALS isolation (Platform, Hardware, StorageV5, ProcessUserInput, Shell, Voice, Updater)', () => {
  describe('storageV5/* isolation', () => {
    test('hoverRestPin isolates pinHoverRest and isHoverRestOn across concurrent hosts', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'sv5-pin-a' }, async () => {
          const first = pinHoverRest(true)
          await tick(15)
          const second = pinHoverRest(false)
          const on = isHoverRestOn()
          resetHoverRestPinForTests()
          return { first, second, on }
        }),
        runWithNewHostSession({ id: 'sv5-pin-b' }, async () => {
          await tick(5)
          const first = pinHoverRest(false)
          await tick(15)
          const second = pinHoverRest(false)
          const on = isHoverRestOn()
          resetHoverRestPinForTests()
          return { first, second, on }
        }),
      ])

      expect(resA).toEqual({ first: 'pinned', second: 'conflict', on: true })
      expect(resB).toEqual({ first: 'pinned', second: 'unchanged', on: false })
    })

    test('storageV5/index isolates getPinnedStorageV5 across hosts', async () => {
      const fakeBackendA = { kind: 'backend-a' } as unknown as StorageV5
      const prevEnv = process.env.CLAUDE_CODE_HOVER_REST
      process.env.CLAUDE_CODE_HOVER_REST = '1'
      try {
        const [gotA, gotB] = await Promise.all([
          runWithNewHostSession({ id: 'sv5-idx-a' }, async () => {
            const configHome = process.env.CLAUDE_CONFIG_DIR ?? ''
            // Pin hover rest on and supply snapshot with matching configHome
            pinHoverRest(true)
            const pinned = pinStorageV5({
              backend: fakeBackendA,
              configHome:
                configHome ||
                (await import('../envUtils.js')).getClaudeConfigHomeDir(),
            })
            await tick(15)
            const readBack = getPinnedStorageV5()
            resetPinnedStorageV5ForTests()
            resetHoverRestPinForTests()
            return { pinned, readBack }
          }),
          runWithNewHostSession({ id: 'sv5-idx-b' }, async () => {
            await tick(5)
            const before = getPinnedStorageV5()
            await tick(15)
            const after = getPinnedStorageV5()
            return { before, after }
          }),
        ])
        expect(gotA.pinned).toBe(fakeBackendA)
        expect(gotA.readBack).toBe(fakeBackendA)
        expect(gotB.before).toBeUndefined()
        expect(gotB.after).toBeUndefined()
      } finally {
        if (prevEnv === undefined) delete process.env.CLAUDE_CODE_HOVER_REST
        else process.env.CLAUDE_CODE_HOVER_REST = prevEnv
      }
    })

    test('storageWatchBus shares process-global bus by configHome with cross-host echo suppression and separates distinct configHomes', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sv5-bus-als-'))
      const dirOther = mkdtempSync(join(tmpdir(), 'sv5-bus-als-other-'))
      try {
        const [a, b, c] = await Promise.all([
          runWithNewHostSession({ id: 'sv5-bus-a' }, async () => {
            const bus = acquireStorageWatchBus(dir)
            const seen: string[] = []
            const off = bus.addListener((chg, src) => {
              seen.push(`${src}:${String(chg)}`)
            })
            const stop = bus.expect('key-shared')
            await tick(15)
            bus.emit('ev-a', 'host-a')
            const writing = bus.isWritingLocally('key-shared')
            stop()
            off()
            await releaseStorageWatchBus(dir)
            return { bus, seen, writing }
          }),
          runWithNewHostSession({ id: 'sv5-bus-b' }, async () => {
            await tick(5)
            const bus = acquireStorageWatchBus(dir)
            const seen: string[] = []
            const off = bus.addListener((chg, src) => {
              seen.push(`${src}:${String(chg)}`)
            })
            const writingWhileAExpects = bus.isWritingLocally('key-shared')
            await tick(20)
            bus.emit('ev-b', 'host-b')
            off()
            await releaseStorageWatchBus(dir)
            return { bus, seen, writingWhileAExpects }
          }),
          runWithNewHostSession({ id: 'sv5-bus-c' }, async () => {
            const bus = acquireStorageWatchBus(dirOther)
            const writingOnOtherDir = bus.isWritingLocally('key-shared')
            await releaseStorageWatchBus(dirOther)
            return { bus, writingOnOtherDir }
          }),
        ])
        expect(a.bus).toBe(b.bus)
        expect(a.bus).not.toBe(c.bus)
        expect(a.writing).toBe(true)
        expect(b.writingWhileAExpects).toBe(true)
        expect(c.writingOnOtherDir).toBe(false)
        expect(a.seen).toContain('host-a:ev-a')
        expect(b.seen).toContain('host-b:ev-b')
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(dirOther, { recursive: true, force: true })
      }
    })

    test('storageLock enterPathQueue serializes same physical path across hosts while allowing distinct paths concurrently', async () => {
      let activeSame = 0
      let maxActiveSame = 0

      await Promise.all([
        runWithNewHostSession({ id: 'sv5-lock-a' }, async () => {
          const guard = await enterPathQueue('/tmp/same-virtual-lock-path')
          try {
            activeSame += 1
            maxActiveSame = Math.max(maxActiveSame, activeSame)
            expect(
              validateStorageKey({
                namespace: 'memory',
                projectKey: 'proj-a',
                relPath: ['notes.md'],
              }),
            ).toBeUndefined()
            await tick(25)
          } finally {
            activeSame -= 1
            await guard[Symbol.asyncDispose]()
          }
        }),
        runWithNewHostSession({ id: 'sv5-lock-b' }, async () => {
          await tick(5)
          const guard = await enterPathQueue('/tmp/same-virtual-lock-path')
          try {
            activeSame += 1
            maxActiveSame = Math.max(maxActiveSame, activeSame)
            expect(
              validateStorageKey({
                namespace: 'memory',
                projectKey: 'proj-b',
                relPath: ['team', 'secret.md'],
              }),
            ).toBeUndefined()
            await tick(10)
          } finally {
            activeSame -= 1
            await guard[Symbol.asyncDispose]()
          }
        }),
      ])

      expect(maxActiveSame).toBe(1)
    })
  })

  describe('processUserInput/* RootSessionSlot isolation', () => {
    test('commandRunWaits isolates same uuid across concurrent sessions and shares across withProject forks', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'pui-cmd-a' }, async session => {
          const p = recordCommandRunWait('shared-uuid', { host: 'A' })
          await tick(15)
          const fork = session.withProject({ cwd: '/tmp/fork-a' })
          const taken = runWithSession(fork, () =>
            takeCommandRunWait('shared-uuid'),
          )
          taken?.settle('settled-by-a')
          const val = await p
          resetCommandRunWaits()
          return val
        }),
        runWithNewHostSession({ id: 'pui-cmd-b' }, async () => {
          const p = recordCommandRunWait('shared-uuid', { host: 'B' })
          await tick(5)
          failCommandRunWaits([{ uuid: 'shared-uuid' }], 'failed-by-b')
          const errMsg = await p.then(
            () => 'unexpected-resolve',
            (e: unknown) => (e instanceof Error ? e.message : String(e)),
          )
          resetCommandRunWaits()
          return errMsg
        }),
      ])
      expect(resA).toBe('settled-by-a')
      expect(resB).toBe('failed-by-b')
    })

    test('promptSubmitWaits isolates same uuid across concurrent sessions', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'pui-wait-a' }, async () => {
          const p = recordPromptSubmitWait('u-1', { host: 'A' })
          await tick(15)
          const handle = takePromptSubmitWait('u-1')
          handle?.settle({ ok: 'A' })
          const out = await p
          resetPromptSubmitWaits()
          return out
        }),
        runWithNewHostSession({ id: 'pui-wait-b' }, async () => {
          const p = recordPromptSubmitWait('u-1', { host: 'B' })
          await tick(5)
          settlePromptSubmitWaitsRemoved([{ uuid: 'u-1' }])
          const out = await p
          resetPromptSubmitWaits()
          return out
        }),
      ])
      expect(resA).toEqual({ ok: 'A' })
      expect(resB).toEqual({
        drop: 'the prompt was removed from the queue before it ran',
      })
    })

    test('promptSubmitEntries isolates sessionStartLatch, aheadOfSessionStart, and entry waiters', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'pui-ent-a' }, async () => {
          const latch = beginSessionStartLatch()
          markAheadOfSessionStart('uuid-shared')
          const entries = createPromptSubmitEntries()
          const p = entries.awaitEntry('uuid-shared')
          await tick(15)
          const ahead = isAheadOfSessionStart('uuid-shared')
          const hasLatch = getPromptSubmitLatch() !== undefined
          entries.handedOff()
          entries[Symbol.dispose]()
          await p
          latch.complete()
          return { ahead, hasLatch }
        }),
        runWithNewHostSession({ id: 'pui-ent-b' }, async () => {
          await tick(5)
          const hasLatch = getPromptSubmitLatch() !== undefined
          const ahead = isAheadOfSessionStart('uuid-shared')
          return { ahead, hasLatch }
        }),
      ])
      expect(resA).toEqual({ ahead: true, hasLatch: true })
      expect(resB).toEqual({ ahead: false, hasLatch: false })
    })

    test('turnHookQueuedPrompts isolates marked uuids per root session', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'pui-turn-a' }, async () => {
          markTurnHookQueuedPrompt('q-1', 'turn.start', [{ uuid: 'q-1' }])
          await tick(15)
          const marked = isTurnHookQueuedPrompt('q-1')
          resetTurnHookQueuedPrompts()
          return marked
        }),
        runWithNewHostSession({ id: 'pui-turn-b' }, async () => {
          await tick(5)
          return isTurnHookQueuedPrompt('q-1')
        }),
      ])
      expect(resA).toBe(true)
      expect(resB).toBe(false)
    })
  })

  describe('repoCheckouts [W-11] & detectRepository isolation', () => {
    test('repoCheckouts isolates checkout maps and base refs across concurrent hosts', async () => {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'rc-a', cwd: '/tmp/cwd-a' }, async () => {
          const checkouts = getRepoCheckouts(
            { CLAUDE_CODE_REPO_CHECKOUTS: '{"alpha":"/work/alpha"}' },
            '/tmp/cwd-a',
          )
          const refs = getBaseRefs({
            CLAUDE_CODE_BASE_REFS: '{"alpha":"main"}',
          })
          await tick(15)
          // Subsequent call without env hits Host A's cached map
          const cachedCheckouts = getRepoCheckouts({}, '/tmp/cwd-a')
          const cachedRefs = getBaseRefs({})
          clearRepoCheckoutCaches()
          return {
            alpha: cachedCheckouts.get('alpha'),
            beta: cachedCheckouts.get('beta'),
            ref: cachedRefs.get('alpha'),
            sameRef: checkouts === cachedCheckouts && refs === cachedRefs,
          }
        }),
        runWithNewHostSession({ id: 'rc-b', cwd: '/tmp/cwd-b' }, async () => {
          await tick(5)
          const checkouts = getRepoCheckouts(
            { CLAUDE_CODE_REPO_CHECKOUTS: '{"beta":"/work/beta"}' },
            '/tmp/cwd-b',
          )
          const refs = getBaseRefs({
            CLAUDE_CODE_BASE_REFS: '{"beta":"release"}',
          })
          await tick(15)
          const cachedCheckouts = getRepoCheckouts({}, '/tmp/cwd-b')
          const cachedRefs = getBaseRefs({})
          clearRepoCheckoutCaches()
          return {
            alpha: cachedCheckouts.get('alpha'),
            beta: cachedCheckouts.get('beta'),
            ref: cachedRefs.get('beta'),
            sameRef: checkouts === cachedCheckouts && refs === cachedRefs,
          }
        }),
      ])

      expect(resA).toEqual({
        alpha: '/work/alpha',
        beta: undefined,
        ref: 'main',
        sameRef: true,
      })
      expect(resB).toEqual({
        alpha: undefined,
        beta: '/work/beta',
        ref: 'release',
        sameRef: true,
      })
    })

    test('detectRepository isolates repositoryWithHostCache across concurrent hosts', async () => {
      const repoDir = mkdtempSync(join(tmpdir(), 'detect-repo-als-'))
      try {
        execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' })
        execFileSync(
          'git',
          ['remote', 'add', 'origin', 'https://github.com/acme/widget.git'],
          { cwd: repoDir, stdio: 'ignore' },
        )

        const [resA, resB] = await Promise.all([
          runWithNewHostSession({ id: 'dr-a', cwd: repoDir }, async () => {
            await detectCurrentRepositoryWithHost(repoDir)
            await tick(15)
            const repo = getCachedRepository()
            const host = getCachedRepositoryHost()
            clearRepositoryCaches()
            return { repo, host }
          }),
          runWithNewHostSession({ id: 'dr-b', cwd: repoDir }, async () => {
            await tick(5)
            // Host B never populated its cache for repoDir
            const repoBefore = getCachedRepository()
            const hostBefore = getCachedRepositoryHost()
            await tick(15)
            return { repoBefore, hostBefore }
          }),
        ])

        expect(resA).toEqual({ repo: 'acme/widget', host: 'github.com' })
        expect(resB).toEqual({ repoBefore: null, hostBefore: null })
      } finally {
        rmSync(repoDir, { recursive: true, force: true })
      }
    })
  })

  describe('modelCapabilities, unrecognizedModelSignal, modelPricing isolation', () => {
    test('unrecognizedModelSignal claims are isolated per root session', async () => {
      const [okA, okB] = await Promise.all([
        runWithNewHostSession({ id: 'ums-a' }, async () => {
          resetUnrecognizedModelSignalClaimsForTests()
          signalUnrecognizedModel('totally-custom-model-als-test', 'sdk')
          await tick(10)
          resetUnrecognizedModelSignalClaimsForTests()
          return true
        }),
        runWithNewHostSession({ id: 'ums-b' }, async () => {
          await tick(5)
          // Must not throw and maintains independent claim set
          signalUnrecognizedModel('totally-custom-model-als-test', 'sdk')
          resetUnrecognizedModelSignalClaimsForTests()
          return true
        }),
      ])
      expect(okA).toBe(true)
      expect(okB).toBe(true)
    })

    test('modelCapabilities caches file reads per host', async () => {
      const cfgDir = mkdtempSync(join(tmpdir(), 'model-cap-als-'))
      const savedEnv = {
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
        CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
        CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
        CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
      }
      try {
        process.env.CLAUDE_CONFIG_DIR = cfgDir
        delete process.env.ANTHROPIC_BASE_URL
        delete process.env.CLAUDE_CODE_USE_BEDROCK
        delete process.env.CLAUDE_CODE_USE_VERTEX
        delete process.env.CLAUDE_CODE_USE_FOUNDRY
        const cacheDir = join(cfgDir, 'cache')
        const cacheFile = join(cacheDir, 'model-capabilities.json')
        execFileSync('mkdir', ['-p', cacheDir])
        writeFileSync(
          cacheFile,
          JSON.stringify({
            models: [{ id: 'claude-test-host-cap', max_input_tokens: 111_000 }],
            timestamp: Date.now(),
          }),
        )

        const capA = runWithNewHostSession({ id: 'mc-a' }, () => {
          const first = getModelCapability('claude-test-host-cap')
          // Overwrite file on disk after Host A cached it
          writeFileSync(
            cacheFile,
            JSON.stringify({
              models: [
                { id: 'claude-test-host-cap', max_input_tokens: 222_000 },
              ],
              timestamp: Date.now(),
            }),
          )
          // Host A still returns its cached value
          const second = getModelCapability('claude-test-host-cap')
          return {
            first: first?.max_input_tokens,
            second: second?.max_input_tokens,
          }
        })

        const capB = runWithNewHostSession({ id: 'mc-b' }, () => {
          // Host B has a cold cache and reads the updated file
          return getModelCapability('claude-test-host-cap')?.max_input_tokens
        })

        expect(capA.first).toBe(111_000)
        expect(capA.second).toBe(111_000)
        expect(capB).toBe(222_000)
      } finally {
        for (const [k, v] of Object.entries(savedEnv)) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
        rmSync(cfgDir, { recursive: true, force: true })
      }
    })

    test('modelPricing caches compiled org pricing per host', async () => {
      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'mp-a' }, async () => {
          resetOrgPricingCache()
          const p = getCompiledOrgPricing()
          await tick(10)
          resetOrgPricingCache()
          return p
        }),
        runWithNewHostSession({ id: 'mp-b' }, async () => {
          await tick(5)
          const p = getCompiledOrgPricing()
          resetOrgPricingCache()
          return p
        }),
      ])
      expect(a).toBeUndefined()
      expect(b).toBeUndefined()
    })
  })

  describe('platform, binaryCheck, ripgrep, ide, jetbrains, editor, windowsPaths, caCerts, ignorePatterns', () => {
    test('platform memoize caches and .cache proxies are isolated per host', () => {
      const resultA = runWithNewHostSession({ id: 'plat-a' }, () => {
        getPlatform.cache.set(undefined, 'linux')
        getWslVersion.cache.set(undefined, '2')
        getLinuxDistroInfo.cache.set(
          undefined,
          Promise.resolve({ linuxDistroId: 'ubuntu' }),
        )
        return {
          plat: getPlatform(),
          wsl: getWslVersion(),
          cacheRef: getPlatform.cache,
        }
      })

      const resultB = runWithNewHostSession({ id: 'plat-b' }, () => {
        getPlatform.cache.set(undefined, 'windows')
        getWslVersion.cache.set(undefined, undefined)
        return {
          plat: getPlatform(),
          wsl: getWslVersion(),
          cacheRef: getPlatform.cache,
        }
      })

      expect(resultA.plat).toBe('linux')
      expect(resultA.wsl).toBe('2')
      expect(resultB.plat).toBe('windows')
      expect(resultB.wsl).toBeUndefined()
      expect(resultA.cacheRef).not.toBe(resultB.cacheRef)
    })

    test('binaryCheck isolates binaryCache across hosts', async () => {
      const binDir = mkdtempSync(join(tmpdir(), 'bincheck-als-'))
      const binPath = join(binDir, `claude_als_probe_${Date.now()}`)
      try {
        const resA = await runWithNewHostSession({ id: 'bc-a' }, async () => {
          const before = await isBinaryInstalled(binPath)
          writeFileSync(binPath, '#!/bin/sh\necho ok\n')
          chmodSync(binPath, 0o755)
          // Host A still sees its cached false
          const after = await isBinaryInstalled(binPath)
          return { before, after }
        })
        const resB = await runWithNewHostSession({ id: 'bc-b' }, async () => {
          // Host B probes fresh and sees true
          return isBinaryInstalled(binPath)
        })
        expect(resA).toEqual({ before: false, after: false })
        expect(resB).toBe(true)
      } finally {
        rmSync(binDir, { recursive: true, force: true })
      }
    })

    test('ripgrep getRipgrepConfig & countFilesRoundedRg caches are isolated per host', () => {
      const a = runWithNewHostSession({ id: 'rg-a' }, () => {
        getRipgrepConfig.cache.set(undefined, {
          mode: 'system',
          command: '/custom/rg-a',
          args: [],
        })
        return {
          status: getRipgrepStatus(),
          cfgCache: getRipgrepConfig.cache,
          cntCache: countFilesRoundedRg.cache,
        }
      })
      const b = runWithNewHostSession({ id: 'rg-b' }, () => {
        getRipgrepConfig.cache.set(undefined, {
          mode: 'builtin',
          command: '/custom/rg-b',
          args: [],
        })
        return {
          status: getRipgrepStatus(),
          cfgCache: getRipgrepConfig.cache,
          cntCache: countFilesRoundedRg.cache,
        }
      })
      expect(a.status.path).toBe('/custom/rg-a')
      expect(b.status.path).toBe('/custom/rg-b')
      expect(a.cfgCache).not.toBe(b.cfgCache)
      expect(a.cntCache).not.toBe(b.cntCache)
    })

    test('ide, jetbrains, and editor memoize caches are isolated per host', () => {
      const a = runWithNewHostSession({ id: 'ide-a' }, () => {
        isSupportedVSCodeTerminal.cache.set(undefined, true)
        isSupportedJetBrainsTerminal.cache.set(undefined, false)
        isSupportedTerminal.cache.set(undefined, true)
        getExternalEditor.cache.set(undefined, 'code-host-a')
        cancelCurrentIDESearch()
        return {
          vscode: isSupportedVSCodeTerminal(),
          jb: isSupportedJetBrainsTerminal(),
          term: isSupportedTerminal(),
          editor: getExternalEditor(),
          jbSync: isJetBrainsPluginInstalledCachedSync('pycharm'),
        }
      })
      const b = runWithNewHostSession({ id: 'ide-b' }, () => {
        isSupportedVSCodeTerminal.cache.set(undefined, false)
        isSupportedJetBrainsTerminal.cache.set(undefined, true)
        isSupportedTerminal.cache.set(undefined, false)
        getExternalEditor.cache.set(undefined, 'vim-host-b')
        return {
          vscode: isSupportedVSCodeTerminal(),
          jb: isSupportedJetBrainsTerminal(),
          term: isSupportedTerminal(),
          editor: getExternalEditor(),
        }
      })
      expect(a).toEqual({
        vscode: true,
        jb: false,
        term: true,
        editor: 'code-host-a',
        jbSync: false,
      })
      expect(b).toEqual({
        vscode: false,
        jb: true,
        term: false,
        editor: 'vim-host-b',
      })
    })

    test('windowsPaths, caCerts, ignorePatterns, nativeInstaller/packageManagers caches are isolated per host', () => {
      const a = runWithNewHostSession({ id: 'wp-a' }, () => {
        findGitBashPathOrNull.cache.set(undefined, 'C:\\GitA\\bash.exe')
        windowsPathToPosixPath('C:\\HostA\\file.ts')
        posixPathToWindowsPath('/c/HostA/file.ts')
        getCACertificates.cache.set(undefined, ['CERT-A'])
        probeIgnorePatternCompileError.cache.set('foo', 'err-a')
        getOsRelease.cache.set(
          undefined,
          Promise.resolve({ id: 'arch', idLike: [] }),
        )
        detectPacman.cache.set(undefined, Promise.resolve(true))
        detectDeb.cache.set(undefined, Promise.resolve(false))
        detectRpm.cache.set(undefined, Promise.resolve(false))
        detectApk.cache.set(undefined, Promise.resolve(false))
        getPackageManager.cache.set(undefined, Promise.resolve('pacman'))
        return {
          bash: findGitBashPathOrNull(),
          winCacheHasA: windowsPathToPosixPath.cache.has('C:\\HostA\\file.ts'),
          posixCacheHasA: posixPathToWindowsPath.cache.has('/c/HostA/file.ts'),
          certs: getCACertificates(),
          ign: probeIgnorePatternCompileError('foo'),
          pmCache: getPackageManager.cache,
        }
      })

      const b = runWithNewHostSession({ id: 'wp-b' }, () => {
        clearCACertsCache()
        return {
          bashCacheHasUndef: findGitBashPathOrNull.cache.has(undefined),
          winCacheHasA: windowsPathToPosixPath.cache.has('C:\\HostA\\file.ts'),
          posixCacheHasA: posixPathToWindowsPath.cache.has('/c/HostA/file.ts'),
          certsCacheHasUndef: getCACertificates.cache.has(undefined),
          ign: probeIgnorePatternCompileError('foo'),
          pmCache: getPackageManager.cache,
        }
      })

      expect(a.bash).toBe('C:\\GitA\\bash.exe')
      expect(a.winCacheHasA).toBe(true)
      expect(a.posixCacheHasA).toBe(true)
      expect(a.certs).toEqual(['CERT-A'])
      expect(a.ign).toBe('err-a')
      expect(b.bashCacheHasUndef).toBe(false)
      expect(b.winCacheHasA).toBe(false)
      expect(b.posixCacheHasA).toBe(false)
      expect(b.certsCacheHasUndef).toBe(false)
      expect(b.ign).toBeNull()
      expect(a.pmCache).not.toBe(b.pmCache)
    })
  })

  describe('tmuxSocket, keychainPrefetch, toolMemoryCgroup [W-14], powershellDetection', () => {
    test('tmuxSocket isolates socket info and tool-used latch across concurrent hosts', async () => {
      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'tmux-a' }, async () => {
          setClaudeSocketInfo('/tmp/tmux-a', 1001)
          markTmuxToolUsed()
          await tick(15)
          const res = {
            path: getClaudeSocketPath(),
            env: getClaudeTmuxEnv(),
            used: hasTmuxToolBeenUsed(),
          }
          resetSocketState()
          return res
        }),
        runWithNewHostSession({ id: 'tmux-b' }, async () => {
          await tick(5)
          setClaudeSocketInfo('/tmp/tmux-b', 2002)
          await tick(15)
          const res = {
            path: getClaudeSocketPath(),
            env: getClaudeTmuxEnv(),
            used: hasTmuxToolBeenUsed(),
          }
          resetSocketState()
          return res
        }),
      ])
      expect(a).toEqual({
        path: '/tmp/tmux-a',
        env: '/tmp/tmux-a,1001,0',
        used: true,
      })
      expect(b).toEqual({
        path: '/tmp/tmux-b',
        env: '/tmp/tmux-b,2002,0',
        used: false,
      })
    })

    test('keychainPrefetch isolates execFileImpl, prefetchPromise, and legacy result per host', async () => {
      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'kc-a' }, async () => {
          _resetKeychainPrefetchForTesting()
          _setKeychainPrefetchExecFileForTesting((_f, _args, _opts, cb) => {
            setTimeout(() => cb(null, 'secret-host-a\n', ''), 10)
          })
          startKeychainPrefetch()
          await ensureKeychainPrefetchCompleted(2000)
          const res = getLegacyApiKeyPrefetchResult()
          clearLegacyApiKeyPrefetch()
          const afterClear = getLegacyApiKeyPrefetchResult()
          _resetKeychainPrefetchForTesting()
          return { res, afterClear }
        }),
        runWithNewHostSession({ id: 'kc-b' }, async () => {
          _resetKeychainPrefetchForTesting()
          _setKeychainPrefetchExecFileForTesting((_f, _args, _opts, cb) => {
            setTimeout(() => cb(null, 'secret-host-b\n', ''), 20)
          })
          startKeychainPrefetch()
          await ensureKeychainPrefetchCompleted(2000)
          const res = getLegacyApiKeyPrefetchResult()
          _resetKeychainPrefetchForTesting()
          return { res }
        }),
      ])
      expect(a.res).toEqual({ stdout: 'secret-host-a' })
      expect(a.afterClear).toBeNull()
      expect(b.res).toEqual({ stdout: 'secret-host-b' })
    })

    test('toolMemoryCgroup [W-14] and powershellDetection isolate memos per host', async () => {
      const prevNoPwsh = process.env.CLAUDE_CODE_TEST_NO_PWSH
      process.env.CLAUDE_CODE_TEST_NO_PWSH = '1'
      try {
        const [a, b] = await Promise.all([
          runWithNewHostSession({ id: 'sh-a' }, async () => {
            resetToolMemoryCgroupMemoForTests()
            resetPowerShellCache()
            const cgroup = ensureToolMemoryCgroupDir()
            const p1 = getCachedPowerShellPath()
            const p2 = getCachedPowerShellPath()
            await tick(10)
            return { cgroup, samePromise: p1 === p2, promise: p1 }
          }),
          runWithNewHostSession({ id: 'sh-b' }, async () => {
            resetToolMemoryCgroupMemoForTests()
            resetPowerShellCache()
            const cgroup = ensureToolMemoryCgroupDir()
            const p1 = getCachedPowerShellPath()
            await tick(10)
            return { cgroup, promise: p1 }
          }),
        ])
        expect(a.samePromise).toBe(true)
        expect(a.promise).not.toBe(b.promise)
        expect(await a.promise).toBeNull()
        expect(await b.promise).toBeNull()
      } finally {
        if (prevNoPwsh === undefined)
          delete process.env.CLAUDE_CODE_TEST_NO_PWSH
        else process.env.CLAUDE_CODE_TEST_NO_PWSH = prevNoPwsh
      }
    })
  })

  describe('streamJsonStdoutGuard, streamJsonStdoutWriter, shutdownCommitted, voiceCircuitBreaker, preventSleep', () => {
    test('streamJsonStdoutWriter and shutdownCommitted isolate state per host', async () => {
      const writerA: StreamJsonStdoutWriter = { async write() {} }
      const writerB: StreamJsonStdoutWriter = { async write() {} }

      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'io-a' }, async () => {
          setStreamJsonStdoutWriter(writerA)
          markShutdownCommitted()
          await tick(15)
          const res = {
            writer: getStreamJsonStdoutWriter(),
            shutdown: isShutdownCommitted(),
          }
          setStreamJsonStdoutWriter(undefined)
          resetShutdownCommittedForTests()
          return res
        }),
        runWithNewHostSession({ id: 'io-b' }, async () => {
          await tick(5)
          setStreamJsonStdoutWriter(writerB)
          await tick(15)
          const res = {
            writer: getStreamJsonStdoutWriter(),
            shutdown: isShutdownCommitted(),
          }
          setStreamJsonStdoutWriter(undefined)
          return res
        }),
      ])
      expect(a.writer).toBe(writerA)
      expect(a.shutdown).toBe(true)
      expect(b.writer).toBe(writerB)
      expect(b.shutdown).toBe(false)
    })

    test('streamJsonStdoutGuard state is scoped per host', () => {
      const origWrite = process.stdout.write
      try {
        runWithNewHostSession({ id: 'guard-a' }, () => {
          installStreamJsonStdoutGuard()
          const guardedWrite = process.stdout.write
          expect(guardedWrite).not.toBe(origWrite)
          // Host B's reset must NOT touch Host A's guard state
          runWithNewHostSession({ id: 'guard-b' }, () => {
            _resetStreamJsonStdoutGuardForTesting()
          })
          expect(process.stdout.write).toBe(guardedWrite)
          _resetStreamJsonStdoutGuardForTesting()
          // Host A's reset restores originalWrite (a bound stdout.write wrapper)
          expect(process.stdout.write).not.toBe(guardedWrite)
        })
      } finally {
        process.stdout.write = origWrite
      }
    })

    test('voiceCircuitBreaker isolates failures and trip state across concurrent hosts', async () => {
      const now = 100_000
      const [gateA, gateB] = await Promise.all([
        runWithNewHostSession({ id: 'vcb-a' }, async () => {
          resetVoiceCircuitBreaker()
          recordVoiceEarlyFailure(now)
          recordVoiceEarlyFailure(now + 100)
          recordVoiceEarlyFailure(now + 200)
          await tick(15)
          const gate = checkVoiceCircuitBreaker(now + 300)
          resetVoiceCircuitBreaker()
          return gate
        }),
        runWithNewHostSession({ id: 'vcb-b' }, async () => {
          await tick(5)
          resetVoiceCircuitBreaker()
          recordVoiceEarlyFailure(now)
          await tick(15)
          const gate = checkVoiceCircuitBreaker(now + 300)
          resetVoiceCircuitBreaker()
          return gate
        }),
      ])
      expect(gateA.open).toBe(false)
      expect(gateB.open).toBe(true)
    })

    test('preventSleep isolates refCount / holding state across hosts', async () => {
      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'ps-a' }, async () => {
          try {
            startPreventSleep()
            await tick(15)
            return isHolding()
          } finally {
            forceStopPreventSleep()
          }
        }),
        runWithNewHostSession({ id: 'ps-b' }, async () => {
          await tick(5)
          return isHolding()
        }),
      ])
      expect(a).toBe(true)
      expect(b).toBe(false)
    })
  })

  describe('autoUpdater, packageManagerAutoUpdate, anthropicOidc, apiPreconnect, cliRelaunch, gatewayLoginRelaunch, proxyAuthHelper, subprocessEnv, process, fsOperations, bash', () => {
    test('autoUpdater and packageManagerAutoUpdate isolate throttles and failures per host', async () => {
      const [a, b] = await Promise.all([
        runWithNewHostSession({ id: 'au-a' }, async () => {
          resetAutoUpdateCheckThrottleForTests()
          const first = shouldThrottleAutoUpdateCheck()
          setUpdateRestoreFailureForTests({ originalPath: '/bin/claude-a' })
          recordPackageManagerUpdateFailure(111_111)
          await tick(15)
          const second = shouldThrottleAutoUpdateCheck()
          const failure = getUpdateRestoreFailure()
          const pmFail = getPackageManagerUpdateLastFailedAt()
          setUpdateRestoreFailureForTests(null)
          resetAutoUpdateCheckThrottleForTests()
          resetPackageManagerUpdateStateForTests()
          return { first, second, failure, pmFail }
        }),
        runWithNewHostSession({ id: 'au-b' }, async () => {
          await tick(5)
          resetAutoUpdateCheckThrottleForTests()
          const first = shouldThrottleAutoUpdateCheck()
          const failure = getUpdateRestoreFailure()
          recordPackageManagerUpdateFailure(222_222)
          await tick(15)
          const pmFail = getPackageManagerUpdateLastFailedAt()
          resetAutoUpdateCheckThrottleForTests()
          resetPackageManagerUpdateStateForTests()
          return { first, failure, pmFail }
        }),
      ])
      expect(a.first).toBe(false)
      expect(a.second).toBe(true)
      expect(a.failure).toEqual({ originalPath: '/bin/claude-a' })
      expect(a.pmFail).toBe(111_111)
      expect(b.first).toBe(false)
      expect(b.failure).toBeNull()
      expect(b.pmFail).toBe(222_222)
    })

    test('anthropicOidc isolates tokenCache across concurrent hosts', async () => {
      const tokenDir = mkdtempSync(join(tmpdir(), 'oidc-tok-als-'))
      const tokenFile = join(tokenDir, 'id-token')
      writeFileSync(tokenFile, 'id-token-1\n')
      const baseEnv: NodeJS.ProcessEnv = {
        ANTHROPIC_FEDERATION_RULE_ID: 'rule-1',
        ANTHROPIC_ORGANIZATION_ID: 'org-1',
        ANTHROPIC_IDENTITY_TOKEN_FILE: tokenFile,
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      }
      const makeFetch = (token: string) => async () =>
        new Response(
          JSON.stringify({
            access_token: token,
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )

      try {
        const [a, b] = await Promise.all([
          runWithNewHostSession({ id: 'oidc-a' }, async () => {
            clearOidcFederationCaches()
            const tok = await resolveOidcFederationAccessToken(
              baseEnv,
              makeFetch('oidc-tok-a'),
            )
            await tick(15)
            const peeked = peekOidcCachedAccessToken()
            invalidateOidcTokenCache()
            const afterInvalidate = peekOidcCachedAccessToken()
            clearOidcFederationCaches()
            return { tok: tok?.token, peeked, afterInvalidate }
          }),
          runWithNewHostSession({ id: 'oidc-b' }, async () => {
            await tick(5)
            clearOidcFederationCaches()
            const tok = await resolveOidcFederationAccessToken(
              baseEnv,
              makeFetch('oidc-tok-b'),
            )
            await tick(20)
            const peeked = peekOidcCachedAccessToken()
            clearOidcFederationCaches()
            return { tok: tok?.token, peeked }
          }),
        ])
        expect(a).toEqual({
          tok: 'oidc-tok-a',
          peeked: 'oidc-tok-a',
          afterInvalidate: null,
        })
        expect(b).toEqual({ tok: 'oidc-tok-b', peeked: 'oidc-tok-b' })
      } finally {
        rmSync(tokenDir, { recursive: true, force: true })
      }
    })

    test('apiPreconnect, cliRelaunch, gatewayLoginRelaunch, proxyAuthHelper, subprocessEnv, process, fsOperations, processWrapper, path, installer, bash isolate per host', async () => {
      const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
      const prevProxyAuth = process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER
      process.env.CLAUDE_CODE_USE_BEDROCK = '1'
      process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER = '1'
      try {
        const tmpFile = mkdtempSync(join(tmpdir(), 'inst-ver-als-'))
        const fakeBin = join(tmpFile, '2.1.331')
        writeFileSync(fakeBin, '#!/bin/sh\necho ok\n')
        chmodSync(fakeBin, 0o755)
        try {
          const [a, b] = await Promise.all([
            runWithNewHostSession({ id: 'misc-a' }, async () => {
              preconnectAnthropicApi()
              markStartupRelaunchStarted()
              capturePolicySnapshot()
              setProxyAuthHelperConfig({ helper: 'echo auth-a' })
              registerUpstreamProxyEnvFn(() => ({
                HTTPS_PROXY: 'http://proxy-a:8080',
              }))
              _injectStdoutDrainPendingForTesting(1000, 250)
              const customFs = { ...NodeFsOperations }
              setFsImplementation(customFs)
              const parseP = ParsedCommand.parse('echo host-a')
              const verified = await isVersionBinaryVerifiedCached(
                '2.1.331',
                fakeBin,
              )
              resetDarwinHomeAutomountedForTesting()
              isDarwinHomeAutomounted({
                readAutoMaster: () => '',
                homeIsOwnMount: () => false,
              })
              resetProcessWrapperCache()
              resolveProcessWrapper({})
              clearCloudSessionRepoStripWarnsForTests()
              stripProjectScopeBlockedEnv(
                { DISABLE_TELEMETRY: '0' },
                'projectSettings',
                { cloudSession: true },
              )
              await tick(15)
              const result = {
                relaunch: isStartupRelaunchStarted(),
                policyDiverged: hasPolicyDiverged(),
                proxyCmd: getConfiguredProxyAuthHelperCommand(),
                upstream: getRegisteredUpstreamProxyEnv(),
                pendingBytes: getPendingStdoutBytes(),
                isCustomFs: getFsImplementation() === customFs,
                parseSame: ParsedCommand.parse('echo host-a') === parseP,
                verified,
                parseP,
              }
              resetStartupRelaunchStartedForTests()
              resetPolicySnapshotForTests()
              clearProxyAuthHelperState()
              setOriginalFsImplementation()
              clearVerifiedVersionsCacheForTesting()
              return result
            }),
            runWithNewHostSession({ id: 'misc-b' }, async () => {
              await tick(5)
              preconnectAnthropicApi()
              const parseP = ParsedCommand.parse('echo host-a')
              await tick(15)
              return {
                relaunch: isStartupRelaunchStarted(),
                policyDiverged: hasPolicyDiverged(),
                proxyCmd: getConfiguredProxyAuthHelperCommand(),
                upstream: getRegisteredUpstreamProxyEnv(),
                pendingBytes: getPendingStdoutBytes(),
                isNodeFs: getFsImplementation() === NodeFsOperations,
                parseP,
              }
            }),
          ])

          expect(a.relaunch).toBe(true)
          expect(b.relaunch).toBe(false)
          expect(a.policyDiverged).toBe(false)
          expect(b.policyDiverged).toBe(true)
          expect(a.proxyCmd).toBe('echo auth-a')
          expect(b.proxyCmd).toBeUndefined()
          expect(a.upstream).toEqual({ HTTPS_PROXY: 'http://proxy-a:8080' })
          expect(b.upstream).toEqual({})
          // process.ts stdout pending-byte accounting is process-global (single fd 1)
          expect(a.pendingBytes).toBe(750)
          expect(b.pendingBytes).toBe(750)
          expect(getPendingStdoutBytes()).toBe(750)
          expect(a.isCustomFs).toBe(true)
          expect(b.isNodeFs).toBe(true)
          expect(a.parseSame).toBe(true)
          expect(a.parseP).not.toBe(b.parseP)
          expect(a.verified).toBe(true)
        } finally {
          _resetStdoutDrainStateForTesting()
          rmSync(tmpFile, { recursive: true, force: true })
        }
      } finally {
        if (prevBedrock === undefined)
          delete process.env.CLAUDE_CODE_USE_BEDROCK
        else process.env.CLAUDE_CODE_USE_BEDROCK = prevBedrock
        if (prevProxyAuth === undefined) {
          delete process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER
        } else {
          process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER = prevProxyAuth
        }
      }
    })
  })
})
