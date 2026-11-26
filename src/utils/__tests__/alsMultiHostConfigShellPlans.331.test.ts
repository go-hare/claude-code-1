import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  getCwdState,
  getOriginalCwd,
  setOriginalCwd,
  setSessionTrustAccepted,
} from '../../bootstrap/state.js'
import {
  _resetOutsideReadBlockLatchForTests,
  clearAutoMemPathCache,
  getAutoMemPath,
  isBlockReadsOutsideWorkingDirectoriesLatched,
  latchBlockReadsOutsideWorkingDirectories,
} from '../../memdir/paths.js'
import { shouldShowProjectOnboarding } from '../../projectOnboardingState.js'
import type { SessionId } from '../../types/ids.js'
import {
  _resetGlobalConfigFreshnessWatchForTesting,
  checkFolderTrustFailClosed,
  checkHasTrustDialogAccepted,
  enableConfigs,
  getCurrentProjectConfig,
  getGlobalConfig,
  getProjectPathForConfig,
  resetEnableConfigsForTesting,
  resetGlobalConfigWriteFlagsForTesting,
  resetTrustDialogAcceptedCacheForTesting,
  saveCurrentProjectConfig,
} from '../config.js'
import { getCwd, pwd, runWithCwd } from '../cwd.js'
import { resetGlobalClaudeFileForTests, seedGlobalClaudeFile } from '../env.js'
import {
  getExampleCommandFromCache,
  leftoverJee,
  refreshExampleCommands,
} from '../exampleCommands.js'
import { normalizePathForConfigKey } from '../path.js'
import {
  activatePlanFileCache,
  assertPlanWriteContained,
  clearAllPlanSlugs,
  getPlan,
  getPlanFilePath,
  getPlansDirectory,
  hydratePlanFromBackend,
  notePlanFileWritten,
  persistApprovedPlanEdit,
  resetPlanFileCacheForTests,
  setPlanSlug,
  writePlanFileContained,
} from '../plans.js'
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'
import { createRootSession } from '../sessionRoot.js'
import {
  resetSettingsCache,
  setCachedSettingsForSource,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'
import {
  consumeBashSnapshotHeadStart,
  exec,
  getBashSnapshotHeadStartState,
  getPowerShellPluginBinPaths,
  getPsProvider,
  getShellConfig,
  resetBashSnapshotHeadStartForTesting,
  setCwd as setShellCwd,
  SNAPSHOT_HEAD_START_MAX_AGE_MS,
  startBashSnapshotHeadStart,
} from '../Shell.js'

const tick = (ms = 3): Promise<void> =>
  new Promise(resolveTick => {
    setTimeout(resolveTick, ms)
  })

describe('2.1.331 Multi-Host Isolation: config, trust, memdir, plans, onboarding, exampleCommands & Shell', () => {
  const tempDirs: string[] = []
  const savedEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string | undefined): void {
    if (!(key in savedEnv)) {
      savedEnv[key] = process.env[key]
    }
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  function makeTempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k]
      } else {
        process.env[k] = v
      }
    }
    for (const k of Object.keys(savedEnv)) {
      delete savedEnv[k]
    }
    _resetGlobalConfigFreshnessWatchForTesting()
    resetGlobalConfigWriteFlagsForTesting()
    resetEnableConfigsForTesting()
    resetGlobalClaudeFileForTests()
    resetTrustDialogAcceptedCacheForTesting()
    getProjectPathForConfig.cache.clear()
    clearAutoMemPathCache()
    _resetOutsideReadBlockLatchForTests()
    getPlansDirectory.cache.clear()
    resetPlanFileCacheForTests()
    shouldShowProjectOnboarding.cache.clear()
    getExampleCommandFromCache.cache.clear()
    refreshExampleCommands.cache.clear()
    resetSettingsCache()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('config.ts: getProjectPathForConfig & _trustAccepted HostSlot isolation', () => {
    test('concurrent runWithNewHostSession hosts in /tmp/proj-A and /tmp/proj-B isolate getProjectPathForConfig and dynamic .cache', async () => {
      const defaultOrig = getOriginalCwd()
      const defaultKey = getProjectPathForConfig()

      const descriptor = Object.getOwnPropertyDescriptor(
        getProjectPathForConfig,
        'cache',
      )
      expect(typeof descriptor?.get).toBe('function')

      let cacheRefA: Map<string, string> | undefined
      let cacheRefB: Map<string, string> | undefined

      const [resA, resB] = await Promise.all([
        runWithNewHostSession(
          {
            id: 'cfg-host-a',
            cwd: '/tmp/proj-A',
            originalCwd: '/tmp/proj-A',
            projectRoot: '/tmp/proj-A',
          },
          async () => {
            cacheRefA = getProjectPathForConfig.cache
            const first = getProjectPathForConfig()
            expect(getProjectPathForConfig.cache.has('/tmp/proj-A')).toBe(true)
            expect(getProjectPathForConfig.cache.get('/tmp/proj-A')).toBe(first)

            await tick(6)
            // Host B ran and cleared its own cache; Host A's cache must remain intact!
            const stillCached = getProjectPathForConfig.cache.has('/tmp/proj-A')
            const second = getProjectPathForConfig()

            // Verify set / delete / clear on dynamic .cache work per-host
            getProjectPathForConfig.cache.set('/tmp/custom-A', '/custom/key/A')
            expect(getProjectPathForConfig.cache.get('/tmp/custom-A')).toBe(
              '/custom/key/A',
            )
            expect(getProjectPathForConfig.cache.delete('/tmp/custom-A')).toBe(
              true,
            )

            // Updating originalCwd inside Host A re-keys cleanly
            setOriginalCwd('/tmp/proj-A-relocated')
            const relocated = getProjectPathForConfig()
            return { first, second, stillCached, relocated }
          },
        ),
        runWithNewHostSession(
          {
            id: 'cfg-host-b',
            cwd: '/tmp/proj-B',
            originalCwd: '/tmp/proj-B',
            projectRoot: '/tmp/proj-B',
          },
          async () => {
            await tick(2)
            cacheRefB = getProjectPathForConfig.cache
            expect(getProjectPathForConfig.cache.has('/tmp/proj-A')).toBe(false)
            const first = getProjectPathForConfig()
            expect(getProjectPathForConfig.cache.has('/tmp/proj-B')).toBe(true)

            // Clearing Host B's cache must NOT clear Host A's cache
            getProjectPathForConfig.cache.clear()
            expect(getProjectPathForConfig.cache.size).toBe(0)
            await tick(2)
            const recomputed = getProjectPathForConfig()
            return { first, recomputed }
          },
        ),
      ])

      expect(cacheRefA).toBeDefined()
      expect(cacheRefB).toBeDefined()
      expect(cacheRefA).not.toBe(cacheRefB)

      const expectedA = normalizePathForConfigKey(resolve('/tmp/proj-A'))
      const expectedARelocated = normalizePathForConfigKey(
        resolve('/tmp/proj-A-relocated'),
      )
      const expectedB = normalizePathForConfigKey(resolve('/tmp/proj-B'))

      expect(resA).toEqual({
        first: expectedA,
        second: expectedA,
        stillCached: true,
        relocated: expectedARelocated,
      })
      expect(resB).toEqual({
        first: expectedB,
        recomputed: expectedB,
      })

      // Default host was never polluted
      expect(getOriginalCwd()).toBe(defaultOrig)
      expect(getProjectPathForConfig()).toBe(defaultKey)
    })

    test('Host A accepting folder trust or saving project config NEVER leaks into Host B', async () => {
      const configHome = makeTempDir('als-331-claude-cfg-')
      const projA = makeTempDir('als-331-trust-proj-A-')
      const projB = makeTempDir('als-331-trust-proj-B-')
      const claudeFile = join(configHome, '.claude.json')
      setEnv('CLAUDE_CONFIG_DIR', configHome)
      setEnv('NODE_ENV', 'development')
      resetGlobalClaudeFileForTests()
      seedGlobalClaudeFile(claudeFile)
      resetGlobalConfigWriteFlagsForTesting()

      const keyA = normalizePathForConfigKey(resolve(projA))
      const keyB = normalizePathForConfigKey(resolve(projB))
      writeFileSync(
        claudeFile,
        JSON.stringify({
          projects: {
            [keyA]: {
              allowedTools: ['Bash(echo:a)'],
              mcpContextUris: [],
              hasTrustDialogAccepted: true,
              projectOnboardingSeenCount: 0,
            },
          },
        }),
        'utf-8',
      )
      enableConfigs()

      const [trustA, trustB] = await Promise.all([
        runWithNewHostSession(
          {
            id: 'trust-host-a',
            cwd: projA,
            originalCwd: projA,
            projectRoot: projA,
          },
          async () => {
            // Host A has persisted trust -> latches true on Host A's HostSlot
            const persistedTrusted = checkHasTrustDialogAccepted()
            const failClosedA = checkFolderTrustFailClosed()
            setSessionTrustAccepted(true)
            saveCurrentProjectConfig(curr => ({
              ...curr,
              lastCost: 1.25,
            }))
            await tick(6)
            return {
              persistedTrusted,
              failClosedTrusted: failClosedA.trusted,
              afterTickTrusted: checkHasTrustDialogAccepted(),
              allowedTools: getCurrentProjectConfig().allowedTools,
              lastCost: getCurrentProjectConfig().lastCost,
            }
          },
        ),
        runWithNewHostSession(
          {
            id: 'trust-host-b',
            cwd: projB,
            originalCwd: projB,
            projectRoot: projB,
          },
          async () => {
            // Wait until Host A has already latched trust = true and saved its project config
            await tick(3)
            const dialogAcceptedB = checkHasTrustDialogAccepted()
            const failClosedB = checkFolderTrustFailClosed()

            saveCurrentProjectConfig(curr => ({
              ...curr,
              allowedTools: ['Bash(echo:b)'],
              lastCost: 9.5,
            }))

            // Now accept session trust inside Host B mid-session and confirm false -> true -> reset false
            setSessionTrustAccepted(true)
            const afterAcceptB = checkHasTrustDialogAccepted()
            resetTrustDialogAcceptedCacheForTesting()
            setSessionTrustAccepted(false)
            const afterResetB = checkHasTrustDialogAccepted()

            return {
              dialogAcceptedB,
              failClosedTrusted: failClosedB.trusted,
              afterAcceptB,
              afterResetB,
              allowedTools: getCurrentProjectConfig().allowedTools,
              lastCost: getCurrentProjectConfig().lastCost,
            }
          },
        ),
      ])

      expect(trustA).toEqual({
        persistedTrusted: true,
        failClosedTrusted: true,
        afterTickTrusted: true,
        allowedTools: ['Bash(echo:a)'],
        lastCost: 1.25,
      })
      expect(trustB).toEqual({
        dialogAcceptedB: false,
        failClosedTrusted: false,
        afterAcceptB: true,
        afterResetB: false,
        allowedTools: ['Bash(echo:b)'],
        lastCost: 9.5,
      })

      // Verify both distinct project entries were persisted separately in .claude.json
      const finalGlobal = getGlobalConfig()
      expect(finalGlobal.projects?.[keyA]?.lastCost).toBe(1.25)
      expect(finalGlobal.projects?.[keyB]?.lastCost).toBe(9.5)
      expect(finalGlobal.projects?.[keyB]?.hasTrustDialogAccepted).not.toBe(
        true,
      )
    })
  })

  describe('memdir/paths.ts: getAutoMemPath & outsideReadBlockLatched HostSlot isolation', () => {
    test('concurrent hosts isolate getAutoMemPath, clearAutoMemPathCache, and outside-read block latch', async () => {
      const memOverrideA = makeTempDir('als-331-mem-override-a-')

      const [resA, resB] = await Promise.all([
        runWithNewHostSession(
          {
            id: 'mem-host-a',
            cwd: '/tmp/proj-A',
            originalCwd: '/tmp/proj-A',
            projectRoot: '/tmp/proj-A',
          },
          async () => {
            const defaultMemA = getAutoMemPath()
            expect(getAutoMemPath.cache.has('/tmp/proj-A')).toBe(true)

            // Configure host-scoped userSettings autoMemoryDirectory on Host A
            setCachedSettingsForSource('userSettings', {
              autoMemoryDirectory: memOverrideA,
            })
            clearAutoMemPathCache()
            const overriddenMemA = getAutoMemPath()

            // Latch outside-read block on Host A
            latchBlockReadsOutsideWorkingDirectories()
            expect(isBlockReadsOutsideWorkingDirectoriesLatched()).toBe(true)

            await tick(6)
            // Host B cleared its cache and reset its latch; Host A's must still hold!
            return {
              defaultMemA,
              overriddenMemA,
              stillCached: getAutoMemPath.cache.has('/tmp/proj-A'),
              stillLatched: isBlockReadsOutsideWorkingDirectoriesLatched(),
            }
          },
        ),
        runWithNewHostSession(
          {
            id: 'mem-host-b',
            cwd: '/tmp/proj-B',
            originalCwd: '/tmp/proj-B',
            projectRoot: '/tmp/proj-B',
          },
          async () => {
            await tick(2)
            // Host A latched outsideReadBlock, but Host B MUST NOT be latched!
            const latchedFromHostA =
              isBlockReadsOutsideWorkingDirectoriesLatched()
            const memB = getAutoMemPath()
            expect(getAutoMemPath.cache.has('/tmp/proj-B')).toBe(true)
            expect(getAutoMemPath.cache.has('/tmp/proj-A')).toBe(false)

            // Clear Host B's cache and reset Host B's latch — must not affect Host A
            getAutoMemPath.cache.clear()
            _resetOutsideReadBlockLatchForTests()
            expect(getAutoMemPath.cache.size).toBe(0)
            const memBAfterClear = getAutoMemPath()

            return { latchedFromHostA, memB, memBAfterClear }
          },
        ),
      ])

      expect(resA.defaultMemA).toContain('proj-A')
      expect(resA.overriddenMemA.startsWith(memOverrideA)).toBe(true)
      expect(resA.stillCached).toBe(true)
      expect(resA.stillLatched).toBe(true)

      expect(resB.latchedFromHostA).toBe(false)
      expect(resB.memB).toContain('proj-B')
      expect(resB.memB).not.toBe(resA.defaultMemA)
      expect(resB.memB).not.toBe(resA.overriddenMemA)
      expect(resB.memBAfterClear).toBe(resB.memB)
    })
  })

  describe('plans.ts: getPlansDirectory, vettedCustomPlansRoot, planFileCache & slugsInDefault isolation', () => {
    test('concurrent hosts with custom plansDirectory isolate getPlansDirectory, containment vetting, planFileCache, and fallback slugs', async () => {
      const configHome = makeTempDir('als-331-plans-cfg-')
      const projA = makeTempDir('als-331-plans-proj-A-')
      const projB = makeTempDir('als-331-plans-proj-B-')
      setEnv('CLAUDE_CONFIG_DIR', configHome)

      const [resA, resB] = await Promise.all([
        runWithNewHostSession(
          {
            id: 'plans-host-a',
            cwd: projA,
            originalCwd: projA,
            projectRoot: projA,
          },
          async () => {
            setSessionSettingsCache({
              settings: { plansDirectory: './plans-a' },
              errors: [],
            })
            const plansDirA = getPlansDirectory()
            setPlanSlug('plans-host-a' as SessionId, 'alpha-slug')

            // Wait so Host B also computes its own getPlansDirectory() (previously clobbering vettedCustomPlansRoot!)
            await tick(5)

            // Host A must STILL pass containment vetting and write its plan cleanly!
            const planFileA = getPlanFilePath()
            await writePlanFileContained(planFileA, '# Host A Plan\n')
            const diskContentA = readFileSync(planFileA, 'utf-8')

            // Host A must reject writing into Host B's plans dir
            let crossWriteBlocked = false
            try {
              await assertPlanWriteContained(
                join(projB, 'plans-b', 'hijack.md'),
              )
            } catch {
              crossWriteBlocked = true
            }

            // Activate backend + planFileCache on Host A
            activatePlanFileCache({
              readText: async () => '# Hydrated Host A',
            })
            rmSync(planFileA, { force: true })
            const hydratedA = await hydratePlanFromBackend()

            return {
              plansDirA,
              planFileA,
              diskContentA,
              crossWriteBlocked,
              hydratedA,
              getPlanAfterHydrate: getPlan(),
            }
          },
        ),
        runWithNewHostSession(
          {
            id: 'plans-host-b',
            cwd: projB,
            originalCwd: projB,
            projectRoot: projB,
          },
          async () => {
            await tick(2)
            setSessionSettingsCache({
              settings: { plansDirectory: './plans-b' },
              errors: [],
            })
            const plansDirB = getPlansDirectory()
            setPlanSlug('plans-host-b' as SessionId, 'alpha-slug')
            const planFileB = getPlanFilePath()
            await writePlanFileContained(planFileB, '# Host B Plan\n')
            notePlanFileWritten(planFileB, '# Host B Cached\n')

            // Simulate fallback to default plans folder for 'shared-fallback-slug' on Host B only
            setPlanSlug('plans-host-b' as SessionId, 'shared-fallback-slug')
            const symlinkedBadTarget = join(
              plansDirB,
              'shared-fallback-slug.md',
            )
            symlinkSync(join(projB, 'outside.md'), symlinkedBadTarget)
            const fallbackOutcome = await persistApprovedPlanEdit(
              symlinkedBadTarget,
              '# Host B Approved Fallback\n',
            )

            // Clearing Host B's getPlansDirectory.cache must not affect Host A
            await tick(6)
            getPlansDirectory.cache.clear()
            clearAllPlanSlugs()
            resetPlanFileCacheForTests()

            return {
              plansDirB,
              fallbackSavedTo: fallbackOutcome?.savedTo,
            }
          },
        ),
      ])

      expect(resA.plansDirA).toBe(join(projA, 'plans-a'))
      expect(resB.plansDirB).toBe(join(projB, 'plans-b'))
      expect(resA.planFileA).toBe(join(projA, 'plans-a', 'alpha-slug.md'))
      expect(resA.diskContentA).toBe('# Host A Plan\n')
      expect(resA.crossWriteBlocked).toBe(true)
      expect(resA.hydratedA).toBe('# Hydrated Host A')
      expect(resA.getPlanAfterHydrate).toBe('# Hydrated Host A')
      expect(resB.fallbackSavedTo?.startsWith(join(configHome, 'plans'))).toBe(
        true,
      )
    })
  })

  describe('projectOnboardingState.ts & exampleCommands.ts: RootSessionSlot isolation', () => {
    test('isolates shouldShowProjectOnboarding, getExampleCommandFromCache, and refreshExampleCommands across concurrent sessions', async () => {
      const projWithClaudeMd = makeTempDir('als-331-onboard-complete-')
      const projWithoutClaudeMd = makeTempDir('als-331-onboard-incomplete-')
      writeFileSync(join(projWithClaudeMd, 'CLAUDE.md'), '# Guide\n', 'utf-8')
      writeFileSync(
        join(projWithoutClaudeMd, 'index.ts'),
        'export const x = 1\n',
        'utf-8',
      )

      // Also verify two distinct RootSessions sharing the same SessionHost via runWithSession
      const sharedHost = getBootstrapSessionHost()
      const sessionA = createRootSession({
        host: sharedHost,
        id: 'root-onboard-a',
        project: {
          originalCwd: projWithClaudeMd,
          projectRoot: projWithClaudeMd,
          cwd: projWithClaudeMd,
        },
      })
      const sessionB = createRootSession({
        host: sharedHost,
        id: 'root-onboard-b',
        project: {
          originalCwd: projWithoutClaudeMd,
          projectRoot: projWithoutClaudeMd,
          cwd: projWithoutClaudeMd,
        },
      })

      const [resA, resB] = await Promise.all([
        runWithSession(sessionA, async () => {
          expect(getBootstrapSession()).toBe(sessionA)
          const showA = shouldShowProjectOnboarding()
          const cmdA = getExampleCommandFromCache()
          const refreshPromiseA = refreshExampleCommands()
          await refreshPromiseA
          await tick(5)
          return {
            showA,
            cmdA,
            stillCachedOnboarding:
              shouldShowProjectOnboarding.cache.has(undefined),
            stillCachedExample: getExampleCommandFromCache.cache.has(undefined),
            refreshPromiseA,
          }
        }),
        runWithSession(sessionB, async () => {
          await tick(2)
          expect(getBootstrapSession()).toBe(sessionB)
          const showB = shouldShowProjectOnboarding()
          const cmdB = getExampleCommandFromCache()
          const refreshPromiseB = refreshExampleCommands()
          await refreshPromiseB

          // Clearing Session B's caches must NOT clear Session A's caches
          shouldShowProjectOnboarding.cache.clear()
          getExampleCommandFromCache.cache.clear()
          refreshExampleCommands.cache.clear()

          return {
            showB,
            cmdB,
            clearedOnboarding: shouldShowProjectOnboarding.cache.size,
            clearedExample: getExampleCommandFromCache.cache.size,
            refreshPromiseB,
          }
        }),
      ])

      expect(resA.showA).toBe(false)
      expect(resB.showB).toBe(true)
      expect(resA.stillCachedOnboarding).toBe(true)
      expect(resA.stillCachedExample).toBe(true)
      expect(resB.clearedOnboarding).toBe(0)
      expect(resB.clearedExample).toBe(0)
      expect(resA.refreshPromiseA).not.toBe(resB.refreshPromiseB)

      // Verify example command seed came from each session's own cwd
      const expectedSeedA = Math.abs(leftoverJee(projWithClaudeMd))
      const expectedSeedB = Math.abs(leftoverJee(projWithoutClaudeMd))
      if (((expectedSeedA >>> 8) & 7) !== ((expectedSeedB >>> 8) & 7)) {
        expect(resA.cmdA).not.toBe(resB.cmdB)
      }
    })
  })

  describe('Shell.ts: concurrent Bash working directory, ShellConfig & head-start isolation', () => {
    test('Host A running `cd subA` in Bash NEVER mutates Host B or default host working directory', async () => {
      const configHome = makeTempDir('als-331-shell-cfg-')
      setEnv('CLAUDE_CONFIG_DIR', configHome)
      setEnv('CLAUDE_CODE_DISABLE_SHELL_HEAD_START', '1')

      const projA = makeTempDir('als-331-shell-proj-A-')
      const projB = makeTempDir('als-331-shell-proj-B-')
      const subA = join(projA, 'sub-dir-A')
      const subB = join(projB, 'sub-dir-B')
      mkdirSync(subA, { recursive: true })
      mkdirSync(subB, { recursive: true })

      const defaultCwdBefore = getCwdState()
      let shellCfgA: Awaited<ReturnType<typeof getShellConfig>> | undefined
      let shellCfgB: Awaited<ReturnType<typeof getShellConfig>> | undefined

      const [resA, resB] = await Promise.all([
        runWithNewHostSession(
          {
            id: 'shell-host-a',
            cwd: projA,
            originalCwd: projA,
            projectRoot: projA,
          },
          async () => {
            shellCfgA = await getShellConfig()
            const abort = new AbortController()

            let out1 = ''
            const cmd1 = await exec(
              `cd ${JSON.stringify(subA)} && pwd -P`,
              abort.signal,
              'bash',
              {
                onStdout: chunk => {
                  out1 += chunk
                },
              },
            )
            const r1 = await cmd1.result
            expect(r1.code).toBe(0)

            const cwdAfterCdA = pwd()
            await tick(10)

            // Run a second command in Host A to verify subA persisted in Host A
            let out2 = ''
            const cmd2 = await exec('pwd -P', abort.signal, 'bash', {
              onStdout: chunk => {
                out2 += chunk
              },
            })
            const r2 = await cmd2.result
            expect(r2.code).toBe(0)

            return {
              out1: out1.trim(),
              cwdAfterCdA,
              out2: out2.trim(),
              finalCwdA: getCwd(),
            }
          },
        ),
        runWithNewHostSession(
          {
            id: 'shell-host-b',
            cwd: projB,
            originalCwd: projB,
            projectRoot: projB,
          },
          async () => {
            shellCfgB = await getShellConfig()
            const abort = new AbortController()

            // Wait slightly so Host A's `cd subA` runs concurrently
            await tick(5)
            expect(pwd()).toBe(projB)

            // Verify Host B starts in projB (never subA!)
            let outBeforeCdB = ''
            const cmdBefore = await exec('pwd -P', abort.signal, 'bash', {
              onStdout: chunk => {
                outBeforeCdB += chunk
              },
            })
            const rBefore = await cmdBefore.result
            expect(rBefore.code).toBe(0)

            // Now Host B cds into subB
            let outAfterCdB = ''
            const cmdAfter = await exec(
              `cd ${JSON.stringify(subB)} && pwd -P`,
              abort.signal,
              'bash',
              {
                onStdout: chunk => {
                  outAfterCdB += chunk
                },
              },
            )
            const rAfter = await cmdAfter.result
            expect(rAfter.code).toBe(0)

            return {
              outBeforeCdB: outBeforeCdB.trim(),
              outAfterCdB: outAfterCdB.trim(),
              finalCwdB: getCwd(),
            }
          },
        ),
      ])

      expect(shellCfgA).toBeDefined()
      expect(shellCfgB).toBeDefined()
      expect(shellCfgA).not.toBe(shellCfgB)
      expect(shellCfgA?.provider).not.toBe(shellCfgB?.provider)

      expect(resA).toEqual({
        out1: subA,
        cwdAfterCdA: subA,
        out2: subA,
        finalCwdA: subA,
      })
      expect(resB).toEqual({
        outBeforeCdB: projB,
        outAfterCdB: subB,
        finalCwdB: subB,
      })

      // Default host cwd remained completely untouched
      expect(getCwdState()).toBe(defaultCwdBefore)
    })

    test('Shell.setCwd and exec respect runWithCwd ALS frames without mutating outer session cwd', async () => {
      const outerDir = makeTempDir('als-331-shell-outer-')
      const branch1 = makeTempDir('als-331-shell-branch1-')
      const branch1Sub = join(branch1, 'nested')
      const branch2 = makeTempDir('als-331-shell-branch2-')
      mkdirSync(branch1Sub, { recursive: true })

      await runWithNewHostSession(
        {
          id: 'shell-scoped-cwd-host',
          cwd: outerDir,
          originalCwd: outerDir,
          projectRoot: outerDir,
        },
        async () => {
          const [b1, b2] = await Promise.all([
            runWithCwd(branch1, async () => {
              setShellCwd(branch1Sub)
              await tick(4)
              return getCwd()
            }),
            runWithCwd(branch2, async () => {
              await tick(2)
              return getCwd()
            }),
          ])

          expect(b1).toBe(branch1Sub)
          expect(b2).toBe(branch2)
          // Outer session cwd was NOT mutated by branch1's Shell.setCwd!
          expect(getCwd()).toBe(outerDir)
          expect(getCwdState()).toBe(outerDir)
        },
      )
    })

    test('isolates BashSnapshotHeadStart state and shell provider caches per host', async () => {
      setEnv('CLAUDE_CODE_DISABLE_SHELL_HEAD_START', undefined)

      const [stateA, stateB] = await Promise.all([
        runWithNewHostSession(
          { id: 'headstart-host-a', cwd: '/tmp/proj-A' },
          async () => {
            resetBashSnapshotHeadStartForTesting()
            // Inject dummy cached shellConfig promise so startBashSnapshotHeadStart doesn't spawn a login shell
            getShellConfig.cache.set(
              undefined,
              new Promise(() => {
                // intentionally pending during test
              }),
            )
            const started = startBashSnapshotHeadStart(() => 1_000)
            expect(started).toBe(true)
            await tick(4)
            // Host B expired & cleared its head-start; Host A's must still be at t=1000 and cached!
            const beforeConsume = getBashSnapshotHeadStartState()
            const hasCacheBeforeConsume = getShellConfig.cache.has(undefined)
            const consumed = consumeBashSnapshotHeadStart(() => 5_000)
            resetBashSnapshotHeadStartForTesting()
            return {
              beforeConsume,
              hasCacheBeforeConsume,
              consumed,
              psCacheSize: getPsProvider.cache.size,
              pluginPathsCacheSize: getPowerShellPluginBinPaths.cache.size,
            }
          },
        ),
        runWithNewHostSession(
          { id: 'headstart-host-b', cwd: '/tmp/proj-B' },
          async () => {
            await tick(1)
            resetBashSnapshotHeadStartForTesting()
            getShellConfig.cache.set(
              undefined,
              new Promise(() => {
                // intentionally pending during test
              }),
            )
            startBashSnapshotHeadStart(() => 1_000)
            // Expire Host B's head start (> 20s)
            const consumedStale = consumeBashSnapshotHeadStart(
              () => 1_000 + SNAPSHOT_HEAD_START_MAX_AGE_MS + 500,
            )
            const afterStale = getBashSnapshotHeadStartState()
            const cacheClearedOnStale = !getShellConfig.cache.has(undefined)
            return { consumedStale, afterStale, cacheClearedOnStale }
          },
        ),
      ])

      expect(stateA.beforeConsume.snapshotStartedAheadAt).toBe(1_000)
      expect(stateA.hasCacheBeforeConsume).toBe(true)
      expect(stateA.consumed).toEqual({
        startedAhead: true,
        discardedStale: false,
      })

      expect(stateB.consumedStale).toEqual({
        startedAhead: true,
        discardedStale: true,
      })
      expect(stateB.afterStale.skipReason).toBe('too_old')
      expect(stateB.cacheClearedOnStale).toBe(true)
    })

    test('deleted-cwd recovery in Host A recovers Host A (and runWithCwd) without mutating Host B', async () => {
      setEnv('CLAUDE_CODE_DISABLE_SHELL_HEAD_START', '1')
      const projA = makeTempDir('als-331-shell-rec-A-')
      const doomedA = join(projA, 'ephemeral-sub')
      mkdirSync(doomedA, { recursive: true })
      const projB = makeTempDir('als-331-shell-rec-B-')

      const [recA, recB] = await Promise.all([
        runWithNewHostSession(
          {
            id: 'rec-host-a',
            cwd: doomedA,
            originalCwd: projA,
            projectRoot: projA,
          },
          async () => {
            rmSync(doomedA, { recursive: true, force: true })
            const abort = new AbortController()
            const cmd = await exec('pwd -P', abort.signal, 'bash')
            const res = await cmd.result
            return {
              code: res.code,
              stderr: res.stderr,
              recoveredCwd: getCwd(),
            }
          },
        ),
        runWithNewHostSession(
          {
            id: 'rec-host-b',
            cwd: projB,
            originalCwd: projB,
            projectRoot: projB,
          },
          async () => {
            await tick(5)
            return { cwdB: getCwd() }
          },
        ),
      ])

      expect(recA.code).not.toBe(0)
      expect(recA.stderr).toContain('was deleted; shell cwd recovered to')
      expect(recA.recoveredCwd).toBe(projA)
      expect(recB.cwdB).toBe(projB)
    })
  })
})
