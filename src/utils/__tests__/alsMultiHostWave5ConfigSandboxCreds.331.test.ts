import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as tls from 'tls'
import {
  SandboxManager as BaseSandboxManager,
  type SandboxAskCallback,
  type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { populateOAuthAccountInfoIfNeeded } from '../../services/oauth/client.js'
import {
  clearAnthropicProfileCaches,
  getAnthropicProfileAccountInfo,
  getAnthropicProfileAuthKind,
  getAnthropicProfileSource,
  getLastIssuedWifAccessToken,
  invalidateWifToken,
} from '../anthropicProfile.js'
import { AwsAuthStatusManager } from '../awsAuthStatusManager.js'
import {
  clearClassifierApprovals,
  subscribeClassifierChecking,
} from '../classifierApprovals.js'
import { runCleanupFunctions } from '../cleanupRegistry.js'
import {
  _getConfigForTesting,
  _isGlobalConfigFreshnessWatcherStartedForTesting,
  _resetGlobalConfigFreshnessWatchForTesting,
  _setGlobalConfigCacheForTesting,
  _startGlobalConfigFreshnessWatchCdForTesting,
  _wouldLoseAuthStateForTesting,
  enableConfigs,
  getGlobalConfigWriteFlagsForTesting,
  hasOwedReloadThroughStorage,
  isUnparseableFileLeftAlone,
  leaveUnparseableFileAlone,
  oweReloadThroughStorage,
  resetEnableConfigsForTesting,
  resetGlobalConfigWriteFlagsForTesting,
} from '../config.js'
import { knownHashes, knownRootOf } from '../mtls.js'
import {
  _getBroadRuleCacheForTesting,
  _resetBroadRuleCacheForTesting,
  isBroadRule,
} from '../permissions/broadRuleFilter.js'
import {
  clearClassifierBetaLatchForTests,
  isControlMonitorsBetaRejectedForTests,
  latchAutoModeClassifierBetaRejected,
} from '../permissions/classifierBetaLatch.js'
import {
  getCompletedClassifierLlmHost,
  resetCompletedClassifierLlmHostForTests,
  setCompletedClassifierLlmHost,
} from '../permissions/classifierSummary.js'
import {
  getOutsideReadPrompt,
  resetOutsideReadPromptForTests,
} from '../permissions/outsideReads.js'
import {
  isPlanModeResumeGuardEnabled,
  resetPlanModeResumeGuardForTests,
} from '../permissions/planModeResume.js'
import {
  getReadDenyRecheckBaseline,
  recordReadDenyRecheckBaseline,
  resetReadDenyRecheckState,
} from '../sandbox/readDenyRecheck.js'
import {
  getActiveGitDirSnapshotCountForTesting,
  getLastSandboxAskCallbackForTests,
  hasSandboxStartedOnce,
  SandboxManager,
  snapshotGitDirBeforeSandboxWrap,
} from '../sandbox/sandbox-adapter.js'
import {
  getSandboxNetworkHeadlessMessages,
  getSandboxNetworkHeadlessTools,
  setSandboxNetworkHeadlessMessages,
  setSandboxNetworkHeadlessTools,
} from '../sandbox/sandboxNetworkHeadlessRefs.js'
import {
  getStagingDirIdentity,
  recordStagingDirIdentity,
  resetStagingDirIdentities,
} from '../sandbox/wrapPreflight.js'
import {
  clearKeychainCache,
  keychainCacheState,
  primeKeychainCacheFromPrefetch,
} from '../secureStorage/macOsKeychainHelpers.js'
import {
  resetSessionHostForTests,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'
import {
  ensureProjectWatchedForCurrentHost,
  settingsChangeDetector,
} from '../settings/changeDetector.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import {
  CREDENTIALS_STORE_HANDLE,
  type CredentialsStoreHandle,
  getPinnedCredentials,
  pinCredentialsStore,
  resetPinnedCredentialsForTests,
} from '../storageV5/credentialsStore.js'
import {
  clearWifCredentialRaceStateForTests,
  declareNoWifTokenRenewal,
  getWifFailedAccessTokensForTests,
  isWifFailedAccessToken,
  isWifTokenRenewalAllowed,
  recordWifFailedAccessToken,
  releaseAllHeldWifLocks,
  setWifCredentialsLockForTests,
  wrapWifCredentialsLock,
} from '../wifCredentialRace.js'

const createdTempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  createdTempDirs.push(dir)
  return dir
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 3000,
  stepMs = 25,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, stepMs))
  }
  return predicate()
}

describe('2.1.331 Wave 5 — Config, Permissions, Sandbox, ChangeDetector & Credentials multi-host isolation', () => {
  beforeEach(() => {
    resetSessionHostForTests()
  })

  afterEach(async () => {
    await settingsChangeDetector.resetForTesting().catch(() => {})
    while (createdTempDirs.length > 0) {
      const dir = createdTempDirs.pop()!
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore cleanup races
      }
    }
    resetEnableConfigsForTesting()
    resetGlobalConfigWriteFlagsForTesting()
    _resetGlobalConfigFreshnessWatchForTesting()
    resetSessionHostForTests()
  })

  test('config.ts isolates globalConfigCache, write flags, freshness watcher per host AND propagates boot enableConfigs() to isolated hosts', () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const configDir = makeTempDir('w5-cfg-boot-')
    const configFile = join(configDir, '.claude.json')
    writeFileSync(configFile, JSON.stringify({ numStartups: 7 }))

    try {
      // 1. Per-host cache, write-flag, and freshness-watcher isolation
      runWithNewHostSession({ id: 'cfg-host-a' }, () => {
        _setGlobalConfigCacheForTesting({
          numStartups: 1,
          hasCompletedOnboarding: true,
        } as unknown as Parameters<typeof _setGlobalConfigCacheForTesting>[0])
        leaveUnparseableFileAlone()
        oweReloadThroughStorage()
        _startGlobalConfigFreshnessWatchCdForTesting()

        expect(
          _wouldLoseAuthStateForTesting({ hasCompletedOnboarding: false }),
        ).toBe(true)
        expect(isUnparseableFileLeftAlone()).toBe(true)
        expect(hasOwedReloadThroughStorage()).toBe(true)
        expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(true)

        runWithNewHostSession({ id: 'cfg-host-b' }, () => {
          expect(
            _wouldLoseAuthStateForTesting({ hasCompletedOnboarding: false }),
          ).toBe(false)
          expect(isUnparseableFileLeftAlone()).toBe(false)
          expect(hasOwedReloadThroughStorage()).toBe(false)
          expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(false)
          expect(getGlobalConfigWriteFlagsForTesting().doubtsNoFile).toBe(false)

          _setGlobalConfigCacheForTesting({
            numStartups: 2,
          } as unknown as Parameters<typeof _setGlobalConfigCacheForTesting>[0])
          expect(
            _wouldLoseAuthStateForTesting({ hasCompletedOnboarding: false }),
          ).toBe(false)
        })

        // Host A retains its own state intact
        expect(
          _wouldLoseAuthStateForTesting({ hasCompletedOnboarding: false }),
        ).toBe(true)
        expect(isUnparseableFileLeftAlone()).toBe(true)
        expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(true)
        _resetGlobalConfigFreshnessWatchForTesting()
      })

      // 2. configReadingAllowed propagation from process-boot enableConfigs()
      process.env.CLAUDE_CONFIG_DIR = configDir
      resetEnableConfigsForTesting()
      process.env.NODE_ENV = 'production'

      // Before boot enableConfigs(), isolated hosts must reject reads
      runWithNewHostSession({ id: 'cfg-before-boot' }, () => {
        expect(() =>
          _getConfigForTesting(configFile, () => ({ numStartups: 0 })),
        ).toThrow('Config accessed before allowed.')
      })

      // Calling enableConfigs() inside Host A only unlocks Host A, not Host B
      runWithNewHostSession({ id: 'cfg-local-a' }, () => {
        enableConfigs()
        expect(
          _getConfigForTesting(configFile, () => ({ numStartups: 0 })),
        ).toMatchObject({ numStartups: 7 })

        runWithNewHostSession({ id: 'cfg-local-b' }, () => {
          expect(() =>
            _getConfigForTesting(configFile, () => ({ numStartups: 0 })),
          ).toThrow('Config accessed before allowed.')
        })
      })

      // Boot enableConfigs() outside ALS propagates defaultConfigReadingAllowed
      // to isolated hosts spawned afterward so they never throw.
      enableConfigs()
      runWithNewHostSession({ id: 'cfg-after-boot' }, () => {
        const loaded = _getConfigForTesting(configFile, () => ({
          numStartups: 0,
        }))
        expect(loaded.numStartups).toBe(7)
      })
    } finally {
      process.env.NODE_ENV = prevNodeEnv
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      resetEnableConfigsForTesting()
    }
  })

  test('permissions residuals isolate outsideReads, broadRuleFilter, classifierBetaLatch, classifierSummary, classifierApprovals signal, and planModeResume', () => {
    runWithNewHostSession({ id: 'perm-host-a' }, sessionA => {
      // outsideReads: RootSessionSlot shared with withProject fork, isolated across sessions
      const promptA = getOutsideReadPrompt()
      promptA.open('tool-a')
      promptA.markAnswered()
      const forkA = sessionA.withProject({ cwd: '/tmp/fork-a' })
      runWithSession(forkA, () => {
        expect(getOutsideReadPrompt()).toBe(promptA)
        expect(getOutsideReadPrompt().answered).toBe(true)
      })

      // broadRuleFilter: HostSlot
      expect(isBroadRule('Bash', 'python:*')).toBe(true)
      const cacheA = _getBroadRuleCacheForTesting()
      expect(cacheA.size).toBeGreaterThan(0)

      // classifierBetaLatch: HostSlot
      latchAutoModeClassifierBetaRejected(new Error('400'), {
        classifierModel: 'haiku',
        classifierStage: 'fast',
      })
      expect(isControlMonitorsBetaRejectedForTests()).toBe(true)

      // classifierSummary: HostSlot
      const llmHostA = { generate: async () => ({ status_detail: 'host-a' }) }
      setCompletedClassifierLlmHost(llmHostA)
      expect(getCompletedClassifierLlmHost()).toBe(llmHostA)

      // classifierApprovals checking signal: RootSessionSlot
      let checkingEventsA = 0
      const unsubA = subscribeClassifierChecking(() => {
        checkingEventsA++
      })

      // planModeResumeGuardEnabled: HostSlot
      const guardVal = getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_tranquil_fern',
        true,
      )
      expect(isPlanModeResumeGuardEnabled()).toBe(guardVal)

      runWithNewHostSession({ id: 'perm-host-b' }, () => {
        // outsideReads isolated
        const promptB = getOutsideReadPrompt()
        expect(promptB).not.toBe(promptA)
        expect(promptB.answered).toBe(false)
        expect(promptB.openToolUseId).toBeUndefined()

        // broadRuleFilter isolated
        const cacheB = _getBroadRuleCacheForTesting()
        expect(cacheB).not.toBe(cacheA)
        expect(cacheB.size).toBe(0)
        expect(isBroadRule('Bash', 'node:*')).toBe(true)
        expect(cacheB.size).toBe(1)
        _resetBroadRuleCacheForTesting()
        expect(cacheB.size).toBe(0)

        // classifierBetaLatch isolated
        expect(isControlMonitorsBetaRejectedForTests()).toBe(false)
        clearClassifierBetaLatchForTests()

        // classifierSummary isolated
        expect(getCompletedClassifierLlmHost()).toBeNull()
        const llmHostB = { generate: async () => ({ status_detail: 'host-b' }) }
        setCompletedClassifierLlmHost(llmHostB)
        expect(getCompletedClassifierLlmHost()).toBe(llmHostB)
        resetCompletedClassifierLlmHostForTests()

        // classifierApprovals checking signal isolated: emitting in B does NOT notify A
        let checkingEventsB = 0
        const unsubB = subscribeClassifierChecking(() => {
          checkingEventsB++
        })
        clearClassifierApprovals()
        expect(checkingEventsB).toBe(1)
        expect(checkingEventsA).toBe(0)
        unsubB()

        // planModeResume isolated
        resetPlanModeResumeGuardForTests()
        expect(isPlanModeResumeGuardEnabled()).toBe(guardVal)
      })

      // Host A still intact
      expect(cacheA.size).toBeGreaterThan(0)
      expect(isControlMonitorsBetaRejectedForTests()).toBe(true)
      expect(getCompletedClassifierLlmHost()).toBe(llmHostA)
      clearClassifierApprovals()
      expect(checkingEventsA).toBe(1)
      unsubA()
      resetOutsideReadPromptForTests()
      resetCompletedClassifierLlmHostForTests()
      clearClassifierBetaLatchForTests()
    })
  })

  test('sandbox-adapter Bug #5: Host A reset does not fail-close Host B askCallback, init without callback keeps Host B live, and wrapWithSandbox isolates per-host allowWrite', async () => {
    if (!SandboxManager.isSupportedPlatform()) {
      return
    }

    const tempConfigDir = makeTempDir('w5-sbx-cfg-')
    writeFileSync(
      join(tempConfigDir, 'settings.json'),
      JSON.stringify({ sandbox: { enabled: true } }),
    )
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
    resetSettingsCache()

    const origInitialize = BaseSandboxManager.initialize
    const origUpdateConfig = BaseSandboxManager.updateConfig
    const origGetConfig = BaseSandboxManager.getConfig
    const origWrapWithSandbox = BaseSandboxManager.wrapWithSandbox
    const origReset = BaseSandboxManager.reset
    const origCheckDeps = BaseSandboxManager.checkDependencies

    let singletonConfig: SandboxRuntimeConfig | undefined
    let capturedWrappedAsk: SandboxAskCallback | undefined
    const wrapCustomConfigs: Array<Partial<SandboxRuntimeConfig> | undefined> =
      []

    BaseSandboxManager.checkDependencies = () => ({ errors: [], warnings: [] })
    BaseSandboxManager.initialize = async (
      runtimeConfig: SandboxRuntimeConfig,
      askCallback?: SandboxAskCallback,
    ) => {
      singletonConfig = runtimeConfig
      capturedWrappedAsk = askCallback
    }
    BaseSandboxManager.updateConfig = (runtimeConfig: SandboxRuntimeConfig) => {
      singletonConfig = runtimeConfig
    }
    BaseSandboxManager.getConfig = () => singletonConfig
    BaseSandboxManager.wrapWithSandbox = async (
      command: string,
      _binShell?: string,
      customConfig?: Partial<SandboxRuntimeConfig>,
    ) => {
      wrapCustomConfigs.push(customConfig)
      return `wrapped:${command}`
    }
    BaseSandboxManager.reset = async () => {
      singletonConfig = undefined
      capturedWrappedAsk = undefined
    }

    await SandboxManager.reset()

    try {
      const wsA = makeTempDir('w5-sbx-wsa-')
      const wsB = makeTempDir('w5-sbx-wsb-')
      const wsC = makeTempDir('w5-sbx-wsc-')
      const allowWriteA = join(wsA, 'out-a')
      const allowWriteB = join(wsB, 'out-b')
      const denyWriteA = join(wsA, 'locked-a')
      const denyWriteB = join(wsB, 'locked-b')
      mkdirSync(join(wsA, '.claude'), { recursive: true })
      mkdirSync(join(wsB, '.claude'), { recursive: true })
      mkdirSync(allowWriteA, { recursive: true })
      mkdirSync(allowWriteB, { recursive: true })
      mkdirSync(denyWriteA, { recursive: true })
      mkdirSync(denyWriteB, { recursive: true })
      writeFileSync(
        join(wsA, '.claude', 'settings.json'),
        JSON.stringify({
          sandbox: {
            enabled: true,
            filesystem: {
              allowWrite: [allowWriteA],
              denyWrite: [denyWriteA],
            },
          },
        }),
      )
      writeFileSync(
        join(wsB, '.claude', 'settings.json'),
        JSON.stringify({
          sandbox: {
            enabled: true,
            filesystem: {
              allowWrite: [allowWriteB],
              denyWrite: [denyWriteB],
            },
          },
        }),
      )

      // --- Scenario A: Host A initializes WITH askA, Host B joins WITH askB,
      //     wrapWithSandbox isolates allowWrite/denyWrite per host, then Host A resets
      //     and proxy callback running in Host A's captured ALS STILL reaches askB!
      const askACalls: string[] = []
      const askBCalls: string[] = []
      const askA: SandboxAskCallback = async pattern => {
        askACalls.push(pattern.host)
        return true
      }
      const askB: SandboxAskCallback = async pattern => {
        askBCalls.push(pattern.host)
        return true
      }

      await runWithNewHostSession(
        { id: 'w5-sbx-a', cwd: wsA, originalCwd: wsA },
        async sessionA => {
          await SandboxManager.initialize(askA)
          expect(capturedWrappedAsk).toBeDefined()

          await runWithNewHostSession(
            { id: 'w5-sbx-b', cwd: wsB, originalCwd: wsB },
            async sessionB => {
              await SandboxManager.initialize(askB)
              // Singleton config was just overwritten with Host B's workspace rules
              expect(singletonConfig?.filesystem.allowWrite).toContain(
                allowWriteB,
              )
              expect(singletonConfig?.filesystem.denyWrite).toContain(
                denyWriteB,
              )

              // Fix 3: Host A wraps command WITHOUT customConfig -> MUST receive Host A's allowWrite/denyWrite (NOT Host B's)!
              wrapCustomConfigs.length = 0
              await runWithSession(sessionA, () =>
                SandboxManager.wrapWithSandbox('echo from-a'),
              )
              expect(wrapCustomConfigs).toHaveLength(1)
              expect(wrapCustomConfigs[0]?.filesystem?.allowWrite).toContain(
                allowWriteA,
              )
              expect(
                wrapCustomConfigs[0]?.filesystem?.allowWrite,
              ).not.toContain(allowWriteB)
              expect(wrapCustomConfigs[0]?.filesystem?.denyWrite).toContain(
                denyWriteA,
              )
              expect(wrapCustomConfigs[0]?.filesystem?.denyWrite).not.toContain(
                denyWriteB,
              )

              // And Host B wraps command WITHOUT customConfig -> receives Host B's allowWrite/denyWrite (NOT Host A's)!
              wrapCustomConfigs.length = 0
              await runWithSession(sessionB, () =>
                SandboxManager.wrapWithSandbox('echo from-b'),
              )
              expect(wrapCustomConfigs).toHaveLength(1)
              expect(wrapCustomConfigs[0]?.filesystem?.allowWrite).toContain(
                allowWriteB,
              )
              expect(
                wrapCustomConfigs[0]?.filesystem?.allowWrite,
              ).not.toContain(allowWriteA)
              expect(wrapCustomConfigs[0]?.filesystem?.denyWrite).toContain(
                denyWriteB,
              )
              expect(wrapCustomConfigs[0]?.filesystem?.denyWrite).not.toContain(
                denyWriteA,
              )

              // Fix 1: Host A resets -> proxy callback still running under Host A's captured ALS
              // MUST fall through to surviving Host B's askB instead of failing closed!
              await runWithSession(sessionA, async () => {
                await SandboxManager.reset()
                expect(hasSandboxStartedOnce()).toBe(false)
                expect(getLastSandboxAskCallbackForTests()).toBeUndefined()
              })

              const routedAfterAReset = await runWithSession(sessionA, () =>
                capturedWrappedAsk!({
                  host: 'after-a-reset.example',
                  port: 443,
                }),
              )
              expect(routedAfterAReset).toBe(true)
              expect(askBCalls).toEqual(['after-a-reset.example'])
              expect(askACalls).toEqual([])

              // Unrelated Host C that never started sandbox still fails closed (no leak)
              const routedInHostC = await runWithNewHostSession(
                { id: 'w5-sbx-c', cwd: wsC, originalCwd: wsC },
                () =>
                  capturedWrappedAsk!({
                    host: 'unrelated-c.example',
                    port: 443,
                  }),
              )
              expect(routedInHostC).toBe(false)
              expect(askBCalls).toEqual(['after-a-reset.example'])

              // Host B resets -> singleton resets cleanly
              await SandboxManager.reset()
              expect(capturedWrappedAsk).toBeUndefined()
            },
          )
        },
      )

      // --- Scenario B (Fix 2): Host A initializes WITHOUT a callback, then Host B joins WITH askB.
      //     Delegating wrappedCallback MUST still be installed so Host B's callback is live!
      const askB2Calls: string[] = []
      const askB2: SandboxAskCallback = async pattern => {
        askB2Calls.push(pattern.host)
        return true
      }

      await runWithNewHostSession(
        { id: 'w5-sbx-nocb-a', cwd: wsA, originalCwd: wsA },
        async sessionA => {
          await SandboxManager.initialize()
          expect(capturedWrappedAsk).toBeDefined()
          // Before Host B joins, no callback exists -> fails closed to false
          expect(
            await capturedWrappedAsk!({
              host: 'nobody-yet.example',
              port: 443,
            }),
          ).toBe(false)

          await runWithNewHostSession(
            { id: 'w5-sbx-nocb-b', cwd: wsB, originalCwd: wsB },
            async () => {
              await SandboxManager.initialize(askB2)
              // Even when invoked in Host A's captured ALS, delegating callback reaches Host B's askB2!
              const allowed = await runWithSession(sessionA, () =>
                capturedWrappedAsk!({ host: 'via-b2.example', port: 443 }),
              )
              expect(allowed).toBe(true)
              expect(askB2Calls).toEqual(['via-b2.example'])
              await SandboxManager.reset()
            },
          )

          await SandboxManager.reset()
        },
      )
    } finally {
      BaseSandboxManager.initialize = origInitialize
      BaseSandboxManager.updateConfig = origUpdateConfig
      BaseSandboxManager.getConfig = origGetConfig
      BaseSandboxManager.wrapWithSandbox = origWrapWithSandbox
      BaseSandboxManager.reset = origReset
      BaseSandboxManager.checkDependencies = origCheckDeps
      await SandboxManager.reset().catch(() => {})
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      resetSettingsCache()
    }
  })

  test('sandbox helpers isolate gitDirSnapshots, readDenyRecheck, sandboxNetworkHeadlessRefs, and wrapPreflight FD cleanup', async () => {
    const repoA = makeTempDir('w5-git-a-')
    mkdirSync(join(repoA, '.git'))
    const stageA = makeTempDir('w5-stage-a-')
    const stageB = makeTempDir('w5-stage-b-')

    let fdA = -1
    let fdB = -1

    try {
      await runWithNewHostSession(
        { id: 'sbx-helper-a', cwd: repoA, originalCwd: repoA },
        async () => {
          // gitDirSnapshotsBeforeWrap isolated
          snapshotGitDirBeforeSandboxWrap(repoA)
          expect(getActiveGitDirSnapshotCountForTesting()).toBe(1)

          // readDenyRecheck isolated
          recordReadDenyRecheckBaseline({
            trustedDenyRoots: ['/secret-a'],
            forwardedUntrustedGrants: [
              { literal: '/grant-a', list: 'allowRead' },
            ],
          })
          expect(getReadDenyRecheckBaseline().trustedDenyRoots).toHaveLength(1)

          // sandboxNetworkHeadlessRefs isolated
          const msgsA = [{ type: 'user' }] as unknown as Parameters<
            typeof setSandboxNetworkHeadlessMessages
          >[0]
          const toolsA = [{ name: 'ToolA' }] as unknown as Parameters<
            typeof setSandboxNetworkHeadlessTools
          >[0]
          setSandboxNetworkHeadlessMessages(msgsA)
          setSandboxNetworkHeadlessTools(toolsA)

          // wrapPreflight open FD + cleanup registration
          fdA = openSync(stageA, fsConstants.O_RDONLY)
          const stA = fstatSync(fdA)
          recordStagingDirIdentity(stageA, stA.dev, stA.ino, fdA)
          expect(getStagingDirIdentity(stageA)?.fd).toBe(fdA)

          await runWithNewHostSession(
            { id: 'sbx-helper-b', cwd: stageB, originalCwd: stageB },
            async () => {
              expect(getActiveGitDirSnapshotCountForTesting()).toBe(0)
              expect(
                getReadDenyRecheckBaseline().trustedDenyRoots,
              ).toHaveLength(0)
              expect(getSandboxNetworkHeadlessMessages()).toEqual([])
              expect(getSandboxNetworkHeadlessTools()).toEqual([])
              expect(getStagingDirIdentity(stageA)).toBeUndefined()

              fdB = openSync(stageB, fsConstants.O_RDONLY)
              const stB = fstatSync(fdB)
              recordStagingDirIdentity(stageB, stB.dev, stB.ino, fdB)
              expect(getStagingDirIdentity(stageB)?.fd).toBe(fdB)
            },
          )

          // Running Host A cleanup closes Host A's FD and clears its identity map,
          // while leaving Host B's FD open!
          await runCleanupFunctions()
          expect(getStagingDirIdentity(stageA)).toBeUndefined()
          expect(() => fstatSync(fdA)).toThrow()
          fdA = -1
          // Host B's FD is still open and valid
          expect(fstatSync(fdB).isDirectory()).toBe(true)

          resetReadDenyRecheckState()
        },
      )
    } finally {
      if (fdA >= 0) {
        try {
          closeSync(fdA)
        } catch {
          // already closed
        }
      }
      if (fdB >= 0) {
        try {
          closeSync(fdB)
        } catch {
          // already closed
        }
      }
      resetStagingDirIdentities()
    }
  })

  test('changeDetector Bug #6: Host A teardown does not dispose process-wide watcher and Host B project settings are watched alongside Host A', async () => {
    const configDir = makeTempDir('w5-cd-cfg-')
    const wsA = makeTempDir('w5-cd-wsa-')
    const wsB = makeTempDir('w5-cd-wsb-')
    mkdirSync(join(wsA, '.claude'), { recursive: true })
    mkdirSync(join(wsB, '.claude'), { recursive: true })
    const settingsA = join(wsA, '.claude', 'settings.json')
    const settingsB = join(wsB, '.claude', 'settings.json')
    writeFileSync(settingsA, JSON.stringify({ model: 'host-a-init' }))
    writeFileSync(settingsB, JSON.stringify({ model: 'host-b-init' }))

    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configDir
    resetSettingsCache()

    await settingsChangeDetector.resetForTesting({
      stabilityThreshold: 40,
      pollInterval: 20,
      watchPollInterval: 100,
      fsWatchProbe: async () => 'delivers',
    })

    const receivedSources: string[] = []
    const unsub = settingsChangeDetector.subscribe(source => {
      receivedSources.push(source)
    })

    try {
      // Host A initializes the process-wide watcher inside an isolated ALS host
      await runWithNewHostSession(
        { id: 'cd-host-a', cwd: wsA, originalCwd: wsA },
        async () => {
          await settingsChangeDetector.initialize()
          // Host A tears down -> MUST NOT dispose the process-wide settings watcher!
          await runCleanupFunctions()
        },
      )

      // Host B joins and registers its own project settings path alongside Host A
      await runWithNewHostSession(
        { id: 'cd-host-b', cwd: wsB, originalCwd: wsB },
        async () => {
          await ensureProjectWatchedForCurrentHost()

          // Give chokidar a moment to finish wiring both directories
          await new Promise(resolve => setTimeout(resolve, 150))

          // Edit Host B's project settings -> watcher MUST fire 'projectSettings'
          receivedSources.length = 0
          writeFileSync(settingsB, JSON.stringify({ model: 'host-b-updated' }))
          const sawB = await waitUntil(
            () => receivedSources.includes('projectSettings'),
            4000,
          )
          expect(sawB).toBe(true)

          // Edit Host A's project settings -> Host A's path MUST STILL be watched!
          receivedSources.length = 0
          writeFileSync(settingsA, JSON.stringify({ model: 'host-a-updated' }))
          const sawA = await waitUntil(
            () => receivedSources.includes('projectSettings'),
            4000,
          )
          expect(sawA).toBe(true)
        },
      )
    } finally {
      unsub()
      await settingsChangeDetector.resetForTesting()
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      resetSettingsCache()
    }
  })

  test('credentials & storageV5 isolate macOsKeychainHelpers, mtls knownHashes, wifCredentialRace, awsAuthStatusManager, anthropicProfile, oauth client, and credentialsStore', async () => {
    const profileDirA = makeTempDir('w5-prof-a-')
    const profileDirB = makeTempDir('w5-prof-b-')
    mkdirSync(join(profileDirA, 'configs'), { recursive: true })
    mkdirSync(join(profileDirA, 'credentials'), { recursive: true })
    writeFileSync(
      join(profileDirA, 'configs', 'default.json'),
      JSON.stringify({ authentication: { type: 'user_oauth' } }),
    )
    writeFileSync(
      join(profileDirA, 'credentials', 'default.json'),
      JSON.stringify({
        access_token: 'tok-a',
        organization_uuid: 'org-a',
      }),
    )

    const sampleRootPem = tls.rootCertificates[0]!

    await runWithNewHostSession({ id: 'cred-host-a' }, async () => {
      // 1. macOsKeychainHelpers
      clearKeychainCache()
      const genA = keychainCacheState.generation
      primeKeychainCacheFromPrefetch('{"accessToken":"kc-a"}', genA)
      keychainCacheState.keychainHoldsItem = true
      expect(keychainCacheState.cache.data).toEqual({ accessToken: 'kc-a' })

      // 2. mtls knownHashes
      knownHashes.clear()
      knownHashes.registerKnownRoots([sampleRootPem])
      expect(knownRootOf(sampleRootPem)).toBeDefined()

      // 3. wifCredentialRace
      clearWifCredentialRaceStateForTests()
      recordWifFailedAccessToken('bad-tok-a')
      declareNoWifTokenRenewal()
      expect(isWifFailedAccessToken('bad-tok-a')).toBe(true)
      expect(isWifTokenRenewalAllowed()).toBe(false)

      // 4. awsAuthStatusManager
      AwsAuthStatusManager.reset()
      const awsA = AwsAuthStatusManager.getInstance()
      awsA.startAuthentication()
      awsA.addOutput('line-a')
      expect(awsA.getStatus().isAuthenticating).toBe(true)

      // 5. anthropicProfile (including .cache getter/setter)
      clearAnthropicProfileCaches()
      const envA: NodeJS.ProcessEnv = { ANTHROPIC_CONFIG_DIR: profileDirA }
      expect(getAnthropicProfileSource(envA)).toBe('profile-implicit')
      expect(getAnthropicProfileAuthKind(envA)).toBe('user_oauth')
      expect(getAnthropicProfileAccountInfo(envA)?.organizationUuid).toBe(
        'org-a',
      )
      const sourceCacheA = getAnthropicProfileSource.cache
      expect(sourceCacheA.size).toBeGreaterThan(0)
      await invalidateWifToken('failed-wif-a')

      // 6. storageV5/credentialsStore
      const storeA = {
        name: 'store-a',
        read: () => null,
        readAsync: async () => null,
        update: () => ({ success: true }),
        delete: () => true,
        [CREDENTIALS_STORE_HANDLE]: 'CredentialsStoreHandle' as const,
      } satisfies CredentialsStoreHandle
      pinCredentialsStore(storeA)
      expect(getPinnedCredentials()).toBe(storeA)

      // 7. oauth/client populateOAuthAccountInfoIfNeeded (per-host slot)
      const prevAcct = process.env.CLAUDE_CODE_ACCOUNT_UUID
      const prevEmail = process.env.CLAUDE_CODE_USER_EMAIL
      const prevOrg = process.env.CLAUDE_CODE_ORGANIZATION_UUID
      delete process.env.CLAUDE_CODE_ACCOUNT_UUID
      delete process.env.CLAUDE_CODE_USER_EMAIL
      delete process.env.CLAUDE_CODE_ORGANIZATION_UUID
      try {
        const resA = await populateOAuthAccountInfoIfNeeded()
        expect(typeof resA).toBe('boolean')
      } finally {
        if (prevAcct !== undefined)
          process.env.CLAUDE_CODE_ACCOUNT_UUID = prevAcct
        if (prevEmail !== undefined)
          process.env.CLAUDE_CODE_USER_EMAIL = prevEmail
        if (prevOrg !== undefined)
          process.env.CLAUDE_CODE_ORGANIZATION_UUID = prevOrg
      }

      // Now enter isolated Host B and verify ZERO leakage!
      await runWithNewHostSession({ id: 'cred-host-b' }, async () => {
        // 1. macOsKeychainHelpers isolated
        expect(keychainCacheState.cache.data).toBeNull()
        expect(keychainCacheState.keychainHoldsItem).toBe(false)
        keychainCacheState.cache = {
          data: {
            accessToken: 'kc-b',
          } as unknown as typeof keychainCacheState.cache.data,
          cachedAt: Date.now(),
        }

        // 2. mtls knownHashes isolated
        expect(knownRootOf(sampleRootPem)).toBeUndefined()
        knownHashes.clear()

        // 3. wifCredentialRace isolated (including activeWifLockReleases)
        expect(isWifFailedAccessToken('bad-tok-a')).toBe(false)
        expect(getWifFailedAccessTokensForTests().size).toBe(0)
        expect(isWifTokenRenewalAllowed()).toBe(true)
        let lockReleasedB = 0
        setWifCredentialsLockForTests({
          lock: async () => async () => {
            lockReleasedB++
          },
        })
        const lockedB = wrapWifCredentialsLock(
          async () => ({ token: 'fresh-b', expiresAt: null }),
          join(profileDirB, 'creds.json'),
          'fail-closed',
        )
        const tokB = await lockedB({ forceRefresh: true })
        expect(tokB.token).toBe('fresh-b')
        expect(lockReleasedB).toBe(1)
        await releaseAllHeldWifLocks()
        clearWifCredentialRaceStateForTests()

        // 4. awsAuthStatusManager isolated
        const awsB = AwsAuthStatusManager.getInstance()
        expect(awsB).not.toBe(awsA)
        expect(awsB.getStatus().isAuthenticating).toBe(false)
        expect(awsB.getStatus().output).toEqual([])
        AwsAuthStatusManager.reset()

        // 5. anthropicProfile isolated (including .cache setter!)
        expect(getAnthropicProfileSource.cache).not.toBe(sourceCacheA)
        expect(getAnthropicProfileSource.cache.size).toBe(0)
        const customCacheB = new Map<
          unknown,
          'profile-explicit' | 'profile-implicit' | 'env-quad' | null
        >()
        getAnthropicProfileSource.cache = customCacheB
        expect(getAnthropicProfileSource.cache).toBe(customCacheB)
        const envB: NodeJS.ProcessEnv = { ANTHROPIC_CONFIG_DIR: profileDirB }
        expect(getAnthropicProfileSource(envB)).toBeNull()
        expect(getLastIssuedWifAccessToken()).toBeUndefined()
        clearAnthropicProfileCaches()

        // 6. storageV5/credentialsStore isolated
        expect(getPinnedCredentials()).toBeUndefined()
        resetPinnedCredentialsForTests()
      })

      // Host A's state remains completely intact after Host B's mutations & resets!
      expect(keychainCacheState.cache.data).toEqual({ accessToken: 'kc-a' })
      expect(keychainCacheState.keychainHoldsItem).toBe(true)
      expect(knownRootOf(sampleRootPem)).toBeDefined()
      expect(isWifFailedAccessToken('bad-tok-a')).toBe(true)
      expect(isWifTokenRenewalAllowed()).toBe(false)
      expect(AwsAuthStatusManager.getInstance()).toBe(awsA)
      expect(awsA.getStatus().isAuthenticating).toBe(true)
      expect(awsA.getStatus().output).toEqual(['line-a'])
      expect(getAnthropicProfileSource.cache).toBe(sourceCacheA)
      expect(getAnthropicProfileSource.cache.size).toBeGreaterThan(0)
      expect(getPinnedCredentials()).toBe(storeA)

      // Clean up Host A
      clearKeychainCache()
      knownHashes.clear()
      clearWifCredentialRaceStateForTests()
      AwsAuthStatusManager.reset()
      clearAnthropicProfileCaches()
      resetPinnedCredentialsForTests()
    })
  })
})
