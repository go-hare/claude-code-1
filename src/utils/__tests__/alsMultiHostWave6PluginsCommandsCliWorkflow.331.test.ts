import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type BridgeDebugHandle,
  clearBridgeDebugHandle,
  getBridgeDebugHandle,
  injectBridgeFault,
  registerBridgeDebugHandle,
  wrapApiForFaultInjection,
} from '../../bridge/bridgeDebug.js'
import type { BridgeApiClient } from '../../bridge/types.js'
import {
  resetAwaitInitializeForTesting,
  startAwaitInitializeStdinRead,
  takeAdoptedAwaitInitializeStdin,
  waitForAwaitInitialize,
} from '../../cli/awaitInitialize.js'
import {
  type ClientDataDocument,
  getLoadedClientDataDocument,
  getPublishedCatalogFloorVersion,
  resetClientDataUrlStateForTests,
  setClientDataVersionFloorForTests,
  setLoadedClientDataDocumentForTests,
} from '../../cli/clientDataUrl.js'
import {
  notePendingDirSyncSeed,
  takePendingDirSyncSeed,
} from '../../cli/cloudSession.js'
import {
  declareSdkRapidFollowupPreempt,
  getSdkRapidFollowupPreempt,
  resetSdkRapidFollowupPreemptForTesting,
} from '../../cli/rapidFollowupPreempt.js'
import {
  peekPendingWatchArtifact,
  setPendingWatchArtifact,
  takePendingWatchArtifact,
} from '../../cli/watchArtifactCli.js'
import {
  fetchMemberPrograms,
  setMemberProgramsFetcherForTesting,
} from '../../commands/access/access.js'
import {
  clearActiveMonitor,
  getActiveMonitor,
  isMonitoring,
  trySetActiveMonitor,
  updateActiveMonitor,
} from '../../commands/autofix-pr/monitorState.js'
import {
  getCdPathRewriteMap,
  resetCdPathRewriteMapForTests,
} from '../../commands/cd/cdPermission.js'
import {
  formatPromptCacheCostLine,
  promptCacheCommandFields,
  resetPromptCacheTrackerForTests,
  setPromptCacheTrackerForTests,
} from '../../commands/cost/promptCacheStatus.js'
import {
  getLastPluginUiClickAt,
  recordPluginUiClick,
  resetPluginUiClickForTests,
  shouldIgnorePluginEnterAction,
} from '../../commands/plugin/pluginListHelpers.js'
import {
  getActiveAttachHandle,
  setActiveAttachHandle,
} from '../../commands/stop/stopCore.js'
import {
  forgetSavedProgramUseCase,
  getCurrentProgramUseCaseId,
  getProgramUseCaseChoiceMode,
  getProgramUseCaseChoices,
  resetProgramUseCaseStoreForTesting,
  selectProgramUseCase,
  setProgramUseCaseChoices,
} from '../../commands/use-case/useCaseStore.js'
import {
  clearWorkflowLaunchHandoffsForTests,
  registerWorkflowLaunchHandoff,
  takeWorkflowLaunchHandoff,
} from '../../commands/workflow-launch-exec/workflow-launch-exec.js'
import { getSessionStartDate } from '../../constants/common.js'
import { getAllOutputStyles } from '../../constants/outputStyles.js'
import { getOutputStyleDirStyles } from '../../outputStyles/loadOutputStylesDir.js'
import {
  clearBuiltinPlugins,
  getBuiltinPluginDefinition,
  getBuiltinPluginFailures,
  isBuiltinPluginsInitialized,
  markBuiltinPluginsInitialized,
  registerBuiltinPlugin,
  registerBuiltinPluginModule,
} from '../../plugins/builtinPlugins.js'
import {
  getManagedEnabledPluginIds,
  setVouchedTierCache,
} from '../../plugins/bundled/secDefault.js'
import {
  _resetEgressProxyAuthForTesting,
  commandEnvWithOriginalProxy,
  rewriteProcessProxyEnv,
  sessionChildProxyEnvOverlay,
} from '../../self-hosted-runner/egressProxyAuth.js'
import {
  __resetTokenPushSeqForTests,
  type PendingTokenAck,
  pushTokenToChild,
} from '../../self-hosted-runner/tokenRefresh.js'
import {
  getAgentProxyNote,
  resetAgentProxyNoteForTests,
  setAgentProxyNote,
} from '../../upstreamproxy/agentProxyPrompt.js'
import {
  buildAgentProxyStatusBody,
  clearRecentRelayFailuresForTests,
  getRecentRelayFailures,
  getUpstreamProxyRelayStats,
  resetUpstreamProxyRelayStatsForTests,
  startUpstreamProxyRelay,
} from '../../upstreamproxy/relay.js'
import {
  getUpstreamProxyEnv,
  resetUpstreamProxyForTests,
} from '../../upstreamproxy/upstreamproxy.js'
import {
  clearCompletedWorkflowAgentResults,
  getCompletedWorkflowAgentResult,
  markWorkflowUsageLimitRecovery,
  recordCompletedWorkflowAgentResult,
} from '../../workflow/backends/claudeCodeBackend.js'
import {
  getWorkflowPrefixStagger,
  resetWorkflowPrefixStaggerForTests,
} from '../../workflow/prefixStagger.js'
import { getWorkflowService } from '../../workflow/service.js'
import { createWorkflowToolCore } from '../../workflow/wiring.js'
import { getHookEventMetadata } from '../hooks/hooksConfigManager.js'
import {
  checkGitAvailable,
  clearGitAvailabilityCache,
  markGitUnavailable,
} from '../plugins/gitAvailability.js'
import { waitForHeadlessPluginInstallDrain } from '../plugins/headlessPluginInstall.js'
import { _resetHintRecommendationForTesting } from '../plugins/hintRecommendation.js'
import { clearMarketplaceHeadersHelperMemo } from '../plugins/marketplaceHeadersHelper.js'
import { onPluginsAutoUpdated } from '../plugins/pluginAutoupdate.js'
import {
  bindPluginDevModsSession,
  canAutoEnablePluginDevMods,
  pluginDevModsRefusal,
} from '../plugins/pluginDevMods.js'
import {
  Jmn,
  L1t,
  resetDrawErrorNotes,
  tellerOf,
} from '../plugins/pluginDrawError.js'
import {
  assertPluginEvalGitVersion,
  clearPluginEvalGitVersionCache,
} from '../plugins/pluginEvalGit.js'
import {
  fetchSkillManifestOnce,
  getSessionRefsStore,
  resetSessionRefsStoreForTests,
  setSkillManifestGsGetForTests,
} from '../plugins/sessionRefsManifest.js'
import {
  attachSurfaceViewportClient,
  detachSurfaceViewportClient,
  listSurfaceViewportClients,
  onSurfaceViewportClientDetach,
  resetSurfaceViewportClientsForTests,
} from '../plugins/surfaceViewportClients.js'
import {
  endSyncedPluginReloadHold,
  getPluginsSyncState,
  holdSyncedPluginReload,
  markSyncedDirsLoaded,
  markSyncedPluginsReloaded,
  recordSyncedPluginError,
  resetSyncedLaneState,
} from '../plugins/syncedPluginCloudSync.js'
import {
  deferralOf,
  invalidateToolDescriptions,
  providerForTool,
  recordDeferral,
  resolveToolDescription,
  setMcpRecordLookup,
  setToolDescribeResolver,
} from '../plugins/toolDescribe.js'
import {
  getTranscriptRevealHost,
  revealInTranscript,
  setTranscriptRevealHost,
} from '../plugins/transcriptReveal.js'
import {
  beginKeptSelectionRun,
  bindUiSelectionSource,
  clearKeptUiSelection,
  endKeptSelectionRun,
  getKeptUiSelection,
  getUiSelectionRowHolding,
  setUiSelectionRowHolding,
} from '../plugins/uiSelectionRowHolding.js'
import {
  cleanupSessionPluginCache,
  getSessionPluginCachePath,
  resetSessionPluginCache,
} from '../plugins/zipCache.js'
import { runWithNewHostSession } from '../sessionHost.js'
import {
  checkMidSessionSettingsFileErrors,
  getActiveSettingsFileErrorNotices,
  type SettingsFileErrorNotice,
  subscribeSettingsFileErrorNotices,
} from '../settings/changeDetector.js'
import {
  getManagedFilePath,
  getManagedSettingsDropInDir,
} from '../settings/managedPath.js'
import {
  getMdmRawReadPromise,
  startMdmRawRead,
} from '../settings/mdm/rawRead.js'

const tick = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 10))

describe('Wave 6 multi-host ALS isolation: commands', () => {
  test('useCaseStore [W-67] isolates offered choices, mode, and selection across concurrent hosts', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'usecase-a-'))
    const dirB = mkdtempSync(join(tmpdir(), 'usecase-b-'))
    try {
      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'host-uc-a' }, async () => {
          setProgramUseCaseChoices(
            [{ id: 'alpha', name: 'Alpha' }],
            'per_grant',
          )
          await tick()
          const selected = selectProgramUseCase('alpha', dirA)
          const notOffered = selectProgramUseCase('beta', dirA)
          const snapshot = {
            choices: getProgramUseCaseChoices().map(c => c.id),
            mode: getProgramUseCaseChoiceMode(),
            selected,
            notOffered,
            current: getCurrentProgramUseCaseId(dirA),
          }
          forgetSavedProgramUseCase(dirA)
          resetProgramUseCaseStoreForTesting()
          return snapshot
        }),
        runWithNewHostSession({ id: 'host-uc-b' }, async () => {
          setProgramUseCaseChoices([{ id: 'beta', name: 'Beta' }], 'per_user')
          await tick()
          const selected = selectProgramUseCase('beta', dirB)
          const notOffered = selectProgramUseCase('alpha', dirB)
          const snapshot = {
            choices: getProgramUseCaseChoices().map(c => c.id),
            mode: getProgramUseCaseChoiceMode(),
            selected,
            notOffered,
            current: getCurrentProgramUseCaseId(dirB),
          }
          forgetSavedProgramUseCase(dirB)
          resetProgramUseCaseStoreForTesting()
          return snapshot
        }),
      ])

      expect(resA).toEqual({
        choices: ['alpha'],
        mode: 'per_grant',
        selected: 'saved',
        notOffered: 'not_offered',
        current: 'alpha',
      })
      expect(resB).toEqual({
        choices: ['beta'],
        mode: 'per_user',
        selected: 'saved',
        notOffered: 'not_offered',
        current: 'beta',
      })
    } finally {
      rmSync(dirA, { recursive: true, force: true })
      rmSync(dirB, { recursive: true, force: true })
    }
  })

  test('autofix-pr/monitorState isolates active monitor lock per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-mon-a' }, async () => {
        const ac = new AbortController()
        const acquired = trySetActiveMonitor({
          taskId: 'task-a',
          owner: 'org-a',
          repo: 'repo-a',
          prNumber: 101,
          abortController: ac,
          startedAt: 1,
        })
        await tick()
        updateActiveMonitor({ sessionId: 'sess-a' })
        const seen = {
          acquired,
          monitoringOwn: isMonitoring('org-a', 'repo-a', 101),
          monitoringOther: isMonitoring('org-b', 'repo-b', 202),
          sessionId: getActiveMonitor()?.sessionId,
        }
        clearActiveMonitor('task-a')
        return { ...seen, afterClear: getActiveMonitor() }
      }),
      runWithNewHostSession({ id: 'host-mon-b' }, async () => {
        const ac = new AbortController()
        const acquired = trySetActiveMonitor({
          taskId: 'task-b',
          owner: 'org-b',
          repo: 'repo-b',
          prNumber: 202,
          abortController: ac,
          startedAt: 2,
        })
        await tick()
        updateActiveMonitor({ sessionId: 'sess-b' })
        const seen = {
          acquired,
          monitoringOwn: isMonitoring('org-b', 'repo-b', 202),
          monitoringOther: isMonitoring('org-a', 'repo-a', 101),
          sessionId: getActiveMonitor()?.sessionId,
        }
        clearActiveMonitor('task-b')
        return { ...seen, afterClear: getActiveMonitor() }
      }),
    ])

    expect(resA).toEqual({
      acquired: true,
      monitoringOwn: true,
      monitoringOther: false,
      sessionId: 'sess-a',
      afterClear: null,
    })
    expect(resB).toEqual({
      acquired: true,
      monitoringOwn: true,
      monitoringOther: false,
      sessionId: 'sess-b',
      afterClear: null,
    })
  })

  test('cdPermission, promptCacheStatus, pluginListHelpers, stopCore, access, and workflow-launch-exec isolate per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-cmd-a' }, async () => {
        const cdMapBefore = getCdPathRewriteMap()
        setPromptCacheTrackerForTests(
          {
            requests: 5,
            lastRequest: { ttl: '5m', at: 1000 },
            warm: true,
            cachingObserved: true,
            expiresAt: 6000,
            misses: 0,
            expectedRebuilds: 0,
            hitRatio: 0.9,
            cacheWriteTokens: 100,
            missRecacheTokens: 0,
            lastMissAt: null,
            lastActivityAt: 1000,
          },
          500,
        )
        recordPluginUiClick(10_000)
        const handleA = { close: () => {} }
        setActiveAttachHandle(handleA)
        setMemberProgramsFetcherForTesting(async () => [
          { name: 'Program A', lines: [] },
        ])
        registerWorkflowLaunchHandoff('tok-1', {
          script: 'scriptA',
          onRunSettled: () => {},
          postResultLine: () => {},
        })

        await tick()

        const out = {
          cdMapSame: getCdPathRewriteMap() === cdMapBefore,
          promptFields: promptCacheCommandFields(2000),
          costLine: formatPromptCacheCostLine(2000),
          clickAt: getLastPluginUiClickAt(),
          ignoreEnter: shouldIgnorePluginEnterAction({ now: 10_100 }),
          attachSame: getActiveAttachHandle() === handleA,
          programs: await fetchMemberPrograms(),
          handoffScript: takeWorkflowLaunchHandoff('tok-1')?.script,
        }

        resetCdPathRewriteMapForTests()
        resetPromptCacheTrackerForTests()
        resetPluginUiClickForTests()
        setActiveAttachHandle(null)
        setMemberProgramsFetcherForTesting(null)
        clearWorkflowLaunchHandoffsForTests()
        return out
      }),
      runWithNewHostSession({ id: 'host-cmd-b' }, async () => {
        const cdMapBefore = getCdPathRewriteMap()
        setPromptCacheTrackerForTests(
          {
            requests: 12,
            lastRequest: { ttl: '1h', at: 2000 },
            warm: false,
            cachingObserved: true,
            expiresAt: null,
            misses: 2,
            expectedRebuilds: 0,
            hitRatio: 0.5,
            cacheWriteTokens: 200,
            missRecacheTokens: 300,
            lastMissAt: 1500,
            lastActivityAt: 2000,
          },
          900,
        )
        recordPluginUiClick(50_000)
        const handleB = { close: () => {} }
        setActiveAttachHandle(handleB)
        setMemberProgramsFetcherForTesting(async () => [
          { name: 'Program B', lines: [] },
        ])
        registerWorkflowLaunchHandoff('tok-1', {
          script: 'scriptB',
          onRunSettled: () => {},
          postResultLine: () => {},
        })

        await tick()

        const out = {
          cdMapSame: getCdPathRewriteMap() === cdMapBefore,
          promptFields: promptCacheCommandFields(3000),
          costLine: formatPromptCacheCostLine(3000),
          clickAt: getLastPluginUiClickAt(),
          ignoreEnter: shouldIgnorePluginEnterAction({ now: 10_100 }),
          attachSame: getActiveAttachHandle() === handleB,
          programs: await fetchMemberPrograms(),
          handoffScript: takeWorkflowLaunchHandoff('tok-1')?.script,
        }

        resetCdPathRewriteMapForTests()
        resetPromptCacheTrackerForTests()
        resetPluginUiClickForTests()
        setActiveAttachHandle(null)
        setMemberProgramsFetcherForTesting(null)
        clearWorkflowLaunchHandoffsForTests()
        return out
      }),
    ])

    expect(resA.cdMapSame).toBe(true)
    expect(resB.cdMapSame).toBe(true)
    expect(
      'prompt_cache' in resA.promptFields &&
        resA.promptFields.prompt_cache.requests,
    ).toBe(5)
    expect(
      'prompt_cache' in resB.promptFields &&
        resB.promptFields.prompt_cache.requests,
    ).toBe(12)
    expect(resA.costLine).toContain('5 requests')
    expect(resB.costLine).toContain('12 requests')
    expect(resA.clickAt).toBe(10_000)
    expect(resB.clickAt).toBe(50_000)
    expect(resA.ignoreEnter).toBe(true)
    expect(resB.ignoreEnter).toBe(false)
    expect(resA.attachSame).toBe(true)
    expect(resB.attachSame).toBe(true)
    expect(resA.programs).toEqual([{ name: 'Program A', lines: [] }])
    expect(resB.programs).toEqual([{ name: 'Program B', lines: [] }])
    expect(resA.handoffScript).toBe('scriptA')
    expect(resB.handoffScript).toBe('scriptB')
  })
})

describe('Wave 6 multi-host ALS isolation: plugins & bundled', () => {
  test('builtinPlugins and secDefault isolate registry, failures, and vouched tier cache per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-plg-a' }, async () => {
        clearBuiltinPlugins()
        markBuiltinPluginsInitialized()
        registerBuiltinPlugin({
          name: 'only-a',
          description: 'A plugin',
        })
        registerBuiltinPluginModule('fail-a', () => {
          throw new Error('boom-a')
        })
        setVouchedTierCache({
          managedIds: new Set(['org-a@corp']),
          order: {
            prepend: ['org-a@corp'],
            append: [],
            from: { prepend: 'policy', append: 'none' },
            shadowed: [],
            outermost: [],
            seat: 'none',
          },
        })
        await tick()
        const out = {
          initialized: isBuiltinPluginsInitialized(),
          hasA: getBuiltinPluginDefinition('only-a') !== undefined,
          hasB: getBuiltinPluginDefinition('only-b') !== undefined,
          failureNames: [...getBuiltinPluginFailures().keys()],
          managedIds: [...(getManagedEnabledPluginIds() ?? [])],
        }
        setVouchedTierCache(undefined)
        clearBuiltinPlugins()
        return out
      }),
      runWithNewHostSession({ id: 'host-plg-b' }, async () => {
        clearBuiltinPlugins()
        registerBuiltinPlugin({
          name: 'only-b',
          description: 'B plugin',
        })
        setVouchedTierCache({
          managedIds: new Set(['org-b@corp']),
          order: {
            prepend: ['org-b@corp'],
            append: [],
            from: { prepend: 'policy', append: 'none' },
            shadowed: [],
            outermost: [],
            seat: 'none',
          },
        })
        await tick()
        const out = {
          initialized: isBuiltinPluginsInitialized(),
          hasA: getBuiltinPluginDefinition('only-a') !== undefined,
          hasB: getBuiltinPluginDefinition('only-b') !== undefined,
          failureNames: [...getBuiltinPluginFailures().keys()],
          managedIds: [...(getManagedEnabledPluginIds() ?? [])],
        }
        setVouchedTierCache(undefined)
        clearBuiltinPlugins()
        return out
      }),
    ])

    expect(resA).toEqual({
      initialized: true,
      hasA: true,
      hasB: false,
      failureNames: ['fail-a'],
      managedIds: ['org-a@corp'],
    })
    expect(resB).toEqual({
      initialized: false,
      hasA: false,
      hasB: true,
      failureNames: [],
      managedIds: ['org-b@corp'],
    })
  })

  test('pluginDevMods, pluginAutoupdate, headlessPluginInstall, hintRecommendation, marketplaceHeadersHelper isolate per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-devmod-a' }, async () => {
        bindPluginDevModsSession({
          canUseTool: async () => ({
            behavior: 'deny',
            message: 'denied',
            decisionReason: { type: 'other', reason: 'test' },
          }),
          toolContext: () => ({}) as never,
          permissionMode: () => 'bypassPermissions',
        })
        const receivedA: string[][] = []
        const unsub = onPluginsAutoUpdated(items => receivedA.push(items))
        await tick()
        const out = {
          canAutoEnable: canAutoEnablePluginDevMods(),
          refusal: pluginDevModsRefusal(),
          drained: await waitForHeadlessPluginInstallDrain(100),
          receivedCount: receivedA.length,
        }
        unsub()
        bindPluginDevModsSession(undefined)
        _resetHintRecommendationForTesting()
        clearMarketplaceHeadersHelperMemo()
        return out
      }),
      runWithNewHostSession({ id: 'host-devmod-b' }, async () => {
        bindPluginDevModsSession({
          canUseTool: async () => ({
            behavior: 'deny',
            message: 'denied',
            decisionReason: { type: 'other', reason: 'test' },
          }),
          toolContext: () => ({}) as never,
          permissionMode: () => 'dontAsk',
        })
        const receivedB: string[][] = []
        const unsub = onPluginsAutoUpdated(items => receivedB.push(items))
        await tick()
        const out = {
          canAutoEnable: canAutoEnablePluginDevMods(),
          refusal: pluginDevModsRefusal(),
          drained: await waitForHeadlessPluginInstallDrain(100),
          receivedCount: receivedB.length,
        }
        unsub()
        bindPluginDevModsSession(undefined)
        _resetHintRecommendationForTesting()
        clearMarketplaceHeadersHelperMemo()
        return out
      }),
    ])

    expect(resA.canAutoEnable).toBe(true)
    expect(resB.canAutoEnable).toBe(false)
    expect(resA.drained).toBe(true)
    expect(resB.drained).toBe(true)
  })

  test('surfaceViewportClients, uiSelectionRowHolding, transcriptReveal, pluginDrawError, pluginEvalGit, gitAvailability isolate per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-surf-a' }, async () => {
        resetSurfaceViewportClientsForTests()
        resetDrawErrorNotes()
        clearPluginEvalGitVersionCache()
        clearGitAvailabilityCache()
        const detachedA: string[] = []
        const unsubDetach = onSurfaceViewportClientDetach(id =>
          detachedA.push(id),
        )
        attachSurfaceViewportClient({
          clientId: 'client-a',
          surface: 'desktop',
          attachedAt: 1,
        })
        setTranscriptRevealHost({
          reveal: async id => id === 'req-a',
        })
        let triggerTakeDownA: (() => void) | undefined
        setUiSelectionRowHolding(() => 'row-a')
        bindUiSelectionSource({
          selection: {} as never,
          hasTextSelection: () => true,
          getSelectedText: () => 'selected-from-a',
          subscribeToSelectionTakeDown: cb => {
            triggerTakeDownA = cb
            return () => {}
          },
        })
        const runA = beginKeptSelectionRun()
        triggerTakeDownA?.()
        const teller = tellerOf(['mod-shared'])
        const firstReport = L1t('Pane', teller, 'answer')
        const firstToast = Jmn({
          component: 'Pane',
          teller,
          error: new Error('err-a'),
        })
        markGitUnavailable()
        let probeCallsA = 0
        await assertPluginEvalGitVersion({ PATH: '/shared/bin' }, async () => {
          probeCallsA++
          return { stdout: 'git version 2.40.0', stderr: '', code: 0 }
        })
        await tick()
        detachSurfaceViewportClient('client-a')
        const out = {
          clientsAfterDetach: listSurfaceViewportClients(),
          detached: detachedA,
          revealOwn: await revealInTranscript('req-a'),
          revealOther: await revealInTranscript('req-b'),
          keptSelection: getKeptUiSelection(),
          rowHoldingSet: getUiSelectionRowHolding() !== undefined,
          firstReportNonNull: firstReport !== null,
          firstToastNonNull: firstToast !== null,
          gitAvailable: await checkGitAvailable(),
          probeCalls: probeCallsA,
        }
        endKeptSelectionRun(runA + 1)
        clearKeptUiSelection()
        setUiSelectionRowHolding(undefined)
        setTranscriptRevealHost(undefined)
        unsubDetach()
        resetSurfaceViewportClientsForTests()
        resetDrawErrorNotes()
        clearPluginEvalGitVersionCache()
        clearGitAvailabilityCache()
        return out
      }),
      runWithNewHostSession({ id: 'host-surf-b' }, async () => {
        resetSurfaceViewportClientsForTests()
        resetDrawErrorNotes()
        clearPluginEvalGitVersionCache()
        clearGitAvailabilityCache()
        const detachedB: string[] = []
        const unsubDetach = onSurfaceViewportClientDetach(id =>
          detachedB.push(id),
        )
        attachSurfaceViewportClient({
          clientId: 'client-b',
          surface: 'vscode',
          attachedAt: 2,
        })
        setTranscriptRevealHost({
          reveal: async id => id === 'req-b',
        })
        setUiSelectionRowHolding(() => 'row-b')
        const teller = tellerOf(['mod-shared'])
        const firstReport = L1t('Pane', teller, 'answer')
        const firstToast = Jmn({
          component: 'Pane',
          teller,
          error: new Error('err-b'),
        })
        checkGitAvailable.cache.set(undefined, Promise.resolve(true))
        let probeCallsB = 0
        await assertPluginEvalGitVersion({ PATH: '/shared/bin' }, async () => {
          probeCallsB++
          return { stdout: 'git version 2.41.0', stderr: '', code: 0 }
        })
        await tick()
        const clientsSeen = listSurfaceViewportClients().map(c => c.clientId)
        const out = {
          clientsSeen,
          detached: detachedB,
          revealOwn: await revealInTranscript('req-b'),
          revealOther: await revealInTranscript('req-a'),
          keptSelection: getKeptUiSelection(),
          rowHoldingSet: getUiSelectionRowHolding() !== undefined,
          firstReportNonNull: firstReport !== null,
          firstToastNonNull: firstToast !== null,
          gitAvailable: await checkGitAvailable(),
          probeCalls: probeCallsB,
        }
        setUiSelectionRowHolding(undefined)
        setTranscriptRevealHost(undefined)
        unsubDetach()
        resetSurfaceViewportClientsForTests()
        resetDrawErrorNotes()
        clearPluginEvalGitVersionCache()
        clearGitAvailabilityCache()
        return out
      }),
    ])

    expect(resA.detached).toEqual(['client-a'])
    expect(resB.detached).toEqual([])
    expect(resB.clientsSeen).toEqual(['client-b'])
    expect(resA.revealOwn).toBe('revealed')
    expect(resA.revealOther).toBe('unknown')
    expect(resB.revealOwn).toBe('revealed')
    expect(resB.revealOther).toBe('unknown')
    expect(resA.keptSelection).toEqual({
      text: 'selected-from-a',
      instance_id: 'row-a',
    })
    expect(resB.keptSelection).toBeUndefined()
    expect(resA.firstReportNonNull).toBe(true)
    expect(resB.firstReportNonNull).toBe(true)
    expect(resA.firstToastNonNull).toBe(true)
    expect(resB.firstToastNonNull).toBe(true)
    expect(resA.gitAvailable).toBe(false)
    expect(resB.gitAvailable).toBe(true)
    expect(resA.probeCalls).toBe(1)
    expect(resB.probeCalls).toBe(1)
  })

  test('sessionRefsManifest, syncedPluginCloudSync, toolDescribe, and zipCache isolate per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-sync-a' }, async () => {
        resetSessionRefsStoreForTests()
        resetSyncedLaneState()
        resetSessionPluginCache()
        setSkillManifestGsGetForTests(async () => ({
          ok: true,
          status: 200,
          data: { skills: [{ id: 's-a', name: 'skill-a' }], plugins: [] },
        }))
        const storeA = getSessionRefsStore()
        const manifestA = await fetchSkillManifestOnce()
        const holdA = holdSyncedPluginReload()
        markSyncedPluginsReloaded(7)
        markSyncedDirsLoaded(['/tmp/sync-a'])
        recordSyncedPluginError(
          {
            pluginId: 'p-a',
            name: 'plugin-a',
            description: 'Plugin A',
            version: '1.0.0',
            updatedAt: null,
            requestedVersion: '1.0.0',
          },
          'generic-error',
          'err-a',
        )
        setToolDescribeResolver(async (_tool, desc) => ({
          description: `[A] ${desc}`,
          isDeferred: true,
        }))
        recordDeferral('SharedTool', true)
        setMcpRecordLookup(async () => ({ pluginSource: 'plug-a@corp' }))
        const zipPathA = await getSessionPluginCachePath()

        await tick()

        const out = {
          storeRef: storeA,
          manifestSkillId: manifestA.ok ? manifestA.skills[0]?.id : null,
          reloadHeld: getPluginsSyncState().reloadHeld,
          reloadsCompleted: getPluginsSyncState().reloadsCompleted,
          loadedDirs: [...getPluginsSyncState().syncedDirsLoadedHere],
          syncErrorCount: getPluginsSyncState().syncErrors.length,
          resolved: await resolveToolDescription(
            { name: 'SharedTool' },
            'orig',
            false,
          ),
          deferral: deferralOf('SharedTool'),
          provider: await providerForTool({
            name: 'mcp__srv__tool',
            isMcp: true,
            mcpInfo: { serverName: 'srv' },
          }),
          zipPath: zipPathA,
        }

        endSyncedPluginReloadHold(holdA)
        await cleanupSessionPluginCache()
        invalidateToolDescriptions()
        setMcpRecordLookup(null)
        resetSessionRefsStoreForTests()
        resetSyncedLaneState()
        return out
      }),
      runWithNewHostSession({ id: 'host-sync-b' }, async () => {
        resetSessionRefsStoreForTests()
        resetSyncedLaneState()
        resetSessionPluginCache()
        setSkillManifestGsGetForTests(async () => ({
          ok: true,
          status: 200,
          data: { skills: [{ id: 's-b', name: 'skill-b' }], plugins: [] },
        }))
        const storeB = getSessionRefsStore()
        const manifestB = await fetchSkillManifestOnce()
        markSyncedDirsLoaded(['/tmp/sync-b'])
        setToolDescribeResolver(async (_tool, desc) => ({
          description: `[B] ${desc}`,
          isDeferred: false,
        }))
        recordDeferral('SharedTool', false)
        setMcpRecordLookup(async () => ({ pluginSource: 'plug-b@corp' }))
        const zipPathB = await getSessionPluginCachePath()

        await tick()

        const out = {
          storeRef: storeB,
          manifestSkillId: manifestB.ok ? manifestB.skills[0]?.id : null,
          reloadHeld: getPluginsSyncState().reloadHeld,
          reloadsCompleted: getPluginsSyncState().reloadsCompleted,
          loadedDirs: [...getPluginsSyncState().syncedDirsLoadedHere],
          syncErrorCount: getPluginsSyncState().syncErrors.length,
          resolved: await resolveToolDescription(
            { name: 'SharedTool' },
            'orig',
            false,
          ),
          deferral: deferralOf('SharedTool'),
          provider: await providerForTool({
            name: 'mcp__srv__tool',
            isMcp: true,
            mcpInfo: { serverName: 'srv' },
          }),
          zipPath: zipPathB,
        }

        await cleanupSessionPluginCache()
        invalidateToolDescriptions()
        setMcpRecordLookup(null)
        resetSessionRefsStoreForTests()
        resetSyncedLaneState()
        return out
      }),
    ])

    expect(resA.storeRef).not.toBe(resB.storeRef)
    expect(resA.manifestSkillId).toBe('s-a')
    expect(resB.manifestSkillId).toBe('s-b')
    expect(resA.reloadHeld).toBe(true)
    expect(resB.reloadHeld).toBe(false)
    expect(resA.reloadsCompleted).toBe(1)
    expect(resB.reloadsCompleted).toBe(0)
    expect(resA.loadedDirs).toEqual(['/tmp/sync-a'])
    expect(resB.loadedDirs).toEqual(['/tmp/sync-b'])
    expect(resA.syncErrorCount).toBe(1)
    expect(resB.syncErrorCount).toBe(0)
    expect(resA.resolved).toEqual({ description: '[A] orig', isDeferred: true })
    expect(resB.resolved).toEqual({
      description: '[B] orig',
      isDeferred: false,
    })
    expect(resA.deferral).toBe(true)
    expect(resB.deferral).toBe(false)
    expect(resA.provider.plugin).toBe('plug-a@corp')
    expect(resB.provider.plugin).toBe('plug-b@corp')
    expect(resA.zipPath).not.toBe(resB.zipPath)
  })
})

describe('Wave 6 multi-host ALS isolation: CLI & Bridge', () => {
  test('awaitInitialize, clientDataUrl, cloudSession, rapidFollowupPreempt, watchArtifactCli, and bridgeDebug isolate per host', async () => {
    const docA: ClientDataDocument = {
      version: 10,
      issued_at: '2026-01-01T00:00:00Z',
      entries: [],
    }
    const docB: ClientDataDocument = {
      version: 20,
      issued_at: '2026-01-02T00:00:00Z',
      entries: [],
    }

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-cli-a' }, async () => {
        resetAwaitInitializeForTesting()
        resetClientDataUrlStateForTests()
        resetSdkRapidFollowupPreemptForTesting()
        clearBridgeDebugHandle()

        startAwaitInitializeStdinRead(async function* () {
          yield `${JSON.stringify({ type: 'control_request', request_id: 'r1', request: { subtype: 'initialize', plugins: [{ type: 'local', path: '/a' }] } })}\n`
        })
        setLoadedClientDataDocumentForTests(docA)
        setClientDataVersionFloorForTests('catalog-key', 100)
        notePendingDirSyncSeed('shared-sid', {
          state: () => 'started',
          completion: Promise.resolve(),
        })
        declareSdkRapidFollowupPreempt(true)
        setPendingWatchArtifact({
          slug: 'slug-a',
          url: 'https://claude.ai/artifacts/slug-a',
        })
        const dbgA: BridgeDebugHandle = {
          fireClose: () => {},
          forceReconnect: () => {},
          injectFault: () => {},
          wakePollLoop: () => {},
          describe: () => 'bridge-a',
        }
        registerBridgeDebugHandle(dbgA)
        injectBridgeFault({
          method: 'pollForWork',
          kind: 'transient',
          status: 503,
          count: 1,
        })
        const wrappedApi = wrapApiForFaultInjection({
          pollForWork: async () => null,
        } as unknown as BridgeApiClient)

        await tick()

        let faultThrown = false
        try {
          await wrappedApi.pollForWork('e', 's', new AbortController().signal)
        } catch {
          faultThrown = true
        }

        const out = {
          initResult: await waitForAwaitInitialize(),
          adoptedDefined: takeAdoptedAwaitInitializeStdin() !== undefined,
          docVersion: getLoadedClientDataDocument()?.version,
          floorVersion: await getPublishedCatalogFloorVersion('catalog-key'),
          seedState: takePendingDirSyncSeed('shared-sid')?.state(),
          preempt: getSdkRapidFollowupPreempt(),
          watchPeek: peekPendingWatchArtifact()?.slug,
          watchTaken: takePendingWatchArtifact()?.slug,
          bridgeDescribe: getBridgeDebugHandle()?.describe(),
          faultThrown,
        }

        resetAwaitInitializeForTesting()
        resetClientDataUrlStateForTests()
        resetSdkRapidFollowupPreemptForTesting()
        clearBridgeDebugHandle()
        return out
      }),
      runWithNewHostSession({ id: 'host-cli-b' }, async () => {
        resetAwaitInitializeForTesting()
        resetClientDataUrlStateForTests()
        resetSdkRapidFollowupPreemptForTesting()
        clearBridgeDebugHandle()

        startAwaitInitializeStdinRead(async function* () {
          yield `${JSON.stringify({ type: 'control_request', request_id: 'r2', request: { subtype: 'initialize', plugins: [{ type: 'local', path: '/b' }] } })}\n`
        })
        setLoadedClientDataDocumentForTests(docB)
        setClientDataVersionFloorForTests('catalog-key', 200)
        notePendingDirSyncSeed('shared-sid', {
          state: () => 'done',
          completion: Promise.resolve(),
        })
        declareSdkRapidFollowupPreempt(false)
        setPendingWatchArtifact({
          slug: 'slug-b',
          url: 'https://claude.ai/artifacts/slug-b',
        })
        const dbgB: BridgeDebugHandle = {
          fireClose: () => {},
          forceReconnect: () => {},
          injectFault: () => {},
          wakePollLoop: () => {},
          describe: () => 'bridge-b',
        }
        registerBridgeDebugHandle(dbgB)
        const wrappedApi = wrapApiForFaultInjection({
          pollForWork: async () => null,
        } as unknown as BridgeApiClient)

        await tick()

        let faultThrown = false
        try {
          await wrappedApi.pollForWork('e', 's', new AbortController().signal)
        } catch {
          faultThrown = true
        }

        const out = {
          initResult: await waitForAwaitInitialize(),
          adoptedDefined: takeAdoptedAwaitInitializeStdin() !== undefined,
          docVersion: getLoadedClientDataDocument()?.version,
          floorVersion: await getPublishedCatalogFloorVersion('catalog-key'),
          seedState: takePendingDirSyncSeed('shared-sid')?.state(),
          preempt: getSdkRapidFollowupPreempt(),
          watchPeek: peekPendingWatchArtifact()?.slug,
          watchTaken: takePendingWatchArtifact()?.slug,
          bridgeDescribe: getBridgeDebugHandle()?.describe(),
          faultThrown,
        }

        resetAwaitInitializeForTesting()
        resetClientDataUrlStateForTests()
        resetSdkRapidFollowupPreemptForTesting()
        clearBridgeDebugHandle()
        return out
      }),
    ])

    expect(resA.initResult).toEqual({
      kind: 'applied',
      pluginDirs: ['/a'],
      pluginDirsNoMcp: [],
    })
    expect(resB.initResult).toEqual({
      kind: 'applied',
      pluginDirs: ['/b'],
      pluginDirsNoMcp: [],
    })
    expect(resA.adoptedDefined).toBe(true)
    expect(resB.adoptedDefined).toBe(true)
    expect(resA.docVersion).toBe(10)
    expect(resB.docVersion).toBe(20)
    expect(resA.floorVersion).toBe(100)
    expect(resB.floorVersion).toBe(200)
    expect(resA.seedState).toBe('started')
    expect(resB.seedState).toBe('done')
    expect(resA.preempt).toBe(true)
    expect(resB.preempt).toBe(false)
    expect(resA.watchPeek).toBe('slug-a')
    expect(resA.watchTaken).toBe('slug-a')
    expect(resB.watchPeek).toBe('slug-b')
    expect(resB.watchTaken).toBe('slug-b')
    expect(resA.bridgeDescribe).toBe('bridge-a')
    expect(resB.bridgeDescribe).toBe('bridge-b')
    expect(resA.faultThrown).toBe(true)
    expect(resB.faultThrown).toBe(false)
  })
})

describe('Wave 6 multi-host ALS isolation: constants, outputStyles, hooks & settings', () => {
  test('memoized .cache proxies isolate across hosts (common, outputStyles, loadOutputStylesDir, hooksConfigManager, managedPath)', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-memo-a' }, async () => {
        getSessionStartDate.cache.set(undefined, '2026-01-01')
        getManagedFilePath.cache.set(undefined, '/managed/host-a')
        getManagedSettingsDropInDir.cache.clear?.()
        getAllOutputStyles.cache.set(
          '/cwd-a',
          Promise.resolve({ StyleA: null }),
        )
        getOutputStyleDirStyles.cache.set('/cwd-a', Promise.resolve([]))
        const metaA = getHookEventMetadata(['ToolA'])
        await tick()
        return {
          startDate: getSessionStartDate(),
          managedPath: getManagedFilePath(),
          dropInDir: getManagedSettingsDropInDir(),
          allStyles: await getAllOutputStyles('/cwd-a'),
          dirStylesCacheHasA: getOutputStyleDirStyles.cache.has('/cwd-a'),
          dirStylesCacheHasB: getOutputStyleDirStyles.cache.has('/cwd-b'),
          metaSame: getHookEventMetadata(['ToolA']) === metaA,
          metaCacheRef: getHookEventMetadata.cache,
        }
      }),
      runWithNewHostSession({ id: 'host-memo-b' }, async () => {
        getSessionStartDate.cache.set(undefined, '2026-12-31')
        getManagedFilePath.cache.set(undefined, '/managed/host-b')
        getManagedSettingsDropInDir.cache.clear?.()
        getAllOutputStyles.cache.set(
          '/cwd-b',
          Promise.resolve({ StyleB: null }),
        )
        getOutputStyleDirStyles.cache.set('/cwd-b', Promise.resolve([]))
        const metaB = getHookEventMetadata(['ToolA'])
        await tick()
        return {
          startDate: getSessionStartDate(),
          managedPath: getManagedFilePath(),
          dropInDir: getManagedSettingsDropInDir(),
          allStyles: await getAllOutputStyles('/cwd-b'),
          dirStylesCacheHasA: getOutputStyleDirStyles.cache.has('/cwd-a'),
          dirStylesCacheHasB: getOutputStyleDirStyles.cache.has('/cwd-b'),
          metaSame: getHookEventMetadata(['ToolA']) === metaB,
          metaCacheRef: getHookEventMetadata.cache,
        }
      }),
    ])

    expect(resA.startDate).toBe('2026-01-01')
    expect(resB.startDate).toBe('2026-12-31')
    expect(resA.managedPath).toBe('/managed/host-a')
    expect(resB.managedPath).toBe('/managed/host-b')
    expect(resA.dropInDir).toBe(join('/managed/host-a', 'managed-settings.d'))
    expect(resB.dropInDir).toBe(join('/managed/host-b', 'managed-settings.d'))
    expect(resA.allStyles).toEqual({ StyleA: null })
    expect(resB.allStyles).toEqual({ StyleB: null })
    expect(resA.dirStylesCacheHasA).toBe(true)
    expect(resA.dirStylesCacheHasB).toBe(false)
    expect(resB.dirStylesCacheHasA).toBe(false)
    expect(resB.dirStylesCacheHasB).toBe(true)
    expect(resA.metaSame).toBe(true)
    expect(resB.metaSame).toBe(true)
    expect(resA.metaCacheRef).not.toBe(resB.metaCacheRef)
  })

  test('changeDetector mid-session error notices and mdm/rawRead isolate per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-set-a' }, async () => {
        const seenA: SettingsFileErrorNotice[] = []
        const unsub = subscribeSettingsFileErrorNotices(n => seenA.push(n))
        checkMidSessionSettingsFileErrors('projectSettings', [
          {
            file: '/proj-a/.claude/settings.json',
            path: '',
            message: 'Invalid JSON',
            severity: 'error',
          },
        ])
        startMdmRawRead()
        const mdmPromiseA = getMdmRawReadPromise()
        await tick()
        const out = {
          activeFiles: getActiveSettingsFileErrorNotices().map(n => n.file),
          seenFiles: seenA.map(n => n.file),
          hasMdmPromise: mdmPromiseA !== null,
          mdmPromise: mdmPromiseA,
        }
        checkMidSessionSettingsFileErrors('projectSettings', [])
        unsub()
        return out
      }),
      runWithNewHostSession({ id: 'host-set-b' }, async () => {
        const seenB: SettingsFileErrorNotice[] = []
        const unsub = subscribeSettingsFileErrorNotices(n => seenB.push(n))
        checkMidSessionSettingsFileErrors('projectSettings', [
          {
            file: '/proj-b/.claude/settings.json',
            path: '',
            message: 'Invalid JSON',
            severity: 'error',
          },
        ])
        const mdmPromiseBeforeB = getMdmRawReadPromise()
        await tick()
        const out = {
          activeFiles: getActiveSettingsFileErrorNotices().map(n => n.file),
          seenFiles: seenB.map(n => n.file),
          hasMdmPromiseBefore: mdmPromiseBeforeB !== null,
        }
        checkMidSessionSettingsFileErrors('projectSettings', [])
        unsub()
        return out
      }),
    ])

    expect(resA.activeFiles).toEqual(['/proj-a/.claude/settings.json'])
    expect(resA.seenFiles).toEqual(['/proj-a/.claude/settings.json'])
    expect(resB.activeFiles).toEqual(['/proj-b/.claude/settings.json'])
    expect(resB.seenFiles).toEqual(['/proj-b/.claude/settings.json'])
    expect(resA.hasMdmPromise).toBe(true)
    expect(resB.hasMdmPromiseBefore).toBe(false)
  })
})

describe('Wave 6 multi-host ALS isolation: workflow, self-hosted-runner & upstreamproxy', () => {
  test('workflow backend recovery, prefixStagger, service, and wiring isolate per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-wf-a' }, async () => {
        clearCompletedWorkflowAgentResults()
        resetWorkflowPrefixStaggerForTests()
        markWorkflowUsageLimitRecovery('run-shared')
        recordCompletedWorkflowAgentResult('run-shared', 1, {
          kind: 'ok',
          output: 'result-a',
          usage: { outputTokens: 10 },
        })
        const staggerA = getWorkflowPrefixStagger()
        const serviceA = getWorkflowService()
        const toolA = createWorkflowToolCore()
        await tick()
        const out = {
          result: getCompletedWorkflowAgentResult('run-shared', 1),
          staggerSame: getWorkflowPrefixStagger() === staggerA,
          serviceSame: getWorkflowService() === serviceA,
          toolSame: createWorkflowToolCore() === toolA,
          staggerA,
          serviceA,
          toolA,
        }
        clearCompletedWorkflowAgentResults()
        resetWorkflowPrefixStaggerForTests()
        return out
      }),
      runWithNewHostSession({ id: 'host-wf-b' }, async () => {
        clearCompletedWorkflowAgentResults()
        resetWorkflowPrefixStaggerForTests()
        recordCompletedWorkflowAgentResult('run-shared', 1, {
          kind: 'ok',
          output: 'result-b',
          usage: { outputTokens: 20 },
        })
        const staggerB = getWorkflowPrefixStagger()
        const serviceB = getWorkflowService()
        const toolB = createWorkflowToolCore()
        await tick()
        const out = {
          result: getCompletedWorkflowAgentResult('run-shared', 1),
          staggerSame: getWorkflowPrefixStagger() === staggerB,
          serviceSame: getWorkflowService() === serviceB,
          toolSame: createWorkflowToolCore() === toolB,
          staggerB,
          serviceB,
          toolB,
        }
        clearCompletedWorkflowAgentResults()
        resetWorkflowPrefixStaggerForTests()
        return out
      }),
    ])

    expect(resA.result).toEqual({
      kind: 'ok',
      output: 'result-a',
      usage: { outputTokens: 10 },
    })
    expect(resB.result).toEqual({
      kind: 'ok',
      output: 'result-b',
      usage: { outputTokens: 20 },
    })
    expect(resA.staggerSame).toBe(true)
    expect(resB.staggerSame).toBe(true)
    expect(resA.staggerA).not.toBe(resB.staggerB)
    expect(resA.serviceSame).toBe(true)
    expect(resB.serviceSame).toBe(true)
    expect(resA.serviceA).not.toBe(resB.serviceB)
    expect(resA.toolSame).toBe(true)
    expect(resB.toolSame).toBe(true)
    // Process-wide Tool singleton preserves `tool === WorkflowTool` identity;
    // per-host WorkflowService routing lives inside descriptorHostSlot.
    expect(resA.toolA).toBe(resB.toolB)
  })

  test('self-hosted-runner (egressProxyAuth, tokenRefresh) and upstreamproxy (agentProxyPrompt, relay, upstreamproxy) isolate per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'host-proxy-a' }, async () => {
        _resetEgressProxyAuthForTesting()
        __resetTokenPushSeqForTests()
        resetAgentProxyNoteForTests()
        resetUpstreamProxyRelayStatsForTests()
        clearRecentRelayFailuresForTests()
        resetUpstreamProxyForTests()

        const envA: NodeJS.ProcessEnv = { HTTPS_PROXY: 'http://corp-a:8080' }
        rewriteProcessProxyEnv('http://127.0.0.1:41001', envA)
        const acksA = new Map<string, PendingTokenAck>()
        const req1A = pushTokenToChild({
          label: 'oauth',
          sessionId: 'sid-a',
          envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
          token: 'tok-a',
          write: () => {},
          pendingAcks: acksA,
          onStatus: () => {},
        })
        setAgentProxyNote('note-host-a')
        const relayA = await startUpstreamProxyRelay({
          wsUrl: 'ws://127.0.0.1:1/unused',
          sessionId: 'sid-a',
          token: 'tok-a',
          maxClientConnections: 11,
          requestHeadTimeoutMs: 1111,
        })

        await tick()

        const out = {
          origProxy: commandEnvWithOriginalProxy(envA).HTTPS_PROXY,
          overlayProxy: sessionChildProxyEnvOverlay(envA).HTTPS_PROXY,
          reqId: req1A,
          note: getAgentProxyNote(),
          relayStats: getUpstreamProxyRelayStats(),
          statusBody: JSON.parse(buildAgentProxyStatusBody()) as {
            maxClientConnections: number
          },
          failures: getRecentRelayFailures().length,
          proxyEnvEmpty: Object.keys(getUpstreamProxyEnv()).length === 0,
        }

        relayA.stop()
        _resetEgressProxyAuthForTesting()
        __resetTokenPushSeqForTests()
        resetAgentProxyNoteForTests()
        resetUpstreamProxyRelayStatsForTests()
        clearRecentRelayFailuresForTests()
        resetUpstreamProxyForTests()
        return out
      }),
      runWithNewHostSession({ id: 'host-proxy-b' }, async () => {
        _resetEgressProxyAuthForTesting()
        __resetTokenPushSeqForTests()
        resetAgentProxyNoteForTests()
        resetUpstreamProxyRelayStatsForTests()
        clearRecentRelayFailuresForTests()
        resetUpstreamProxyForTests()

        const envB: NodeJS.ProcessEnv = { HTTPS_PROXY: 'http://corp-b:9090' }
        rewriteProcessProxyEnv('http://127.0.0.1:42002', envB)
        const acksB = new Map<string, PendingTokenAck>()
        const req1B = pushTokenToChild({
          label: 'oauth',
          sessionId: 'sid-b',
          envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
          token: 'tok-b',
          write: () => {},
          pendingAcks: acksB,
          onStatus: () => {},
        })
        setAgentProxyNote('note-host-b')
        const relayB = await startUpstreamProxyRelay({
          wsUrl: 'ws://127.0.0.1:1/unused',
          sessionId: 'sid-b',
          token: 'tok-b',
          maxClientConnections: 22,
          requestHeadTimeoutMs: 2222,
        })

        await tick()

        const out = {
          origProxy: commandEnvWithOriginalProxy(envB).HTTPS_PROXY,
          overlayProxy: sessionChildProxyEnvOverlay(envB).HTTPS_PROXY,
          reqId: req1B,
          note: getAgentProxyNote(),
          relayStats: getUpstreamProxyRelayStats(),
          statusBody: JSON.parse(buildAgentProxyStatusBody()) as {
            maxClientConnections: number
          },
          failures: getRecentRelayFailures().length,
          proxyEnvEmpty: Object.keys(getUpstreamProxyEnv()).length === 0,
        }

        relayB.stop()
        _resetEgressProxyAuthForTesting()
        __resetTokenPushSeqForTests()
        resetAgentProxyNoteForTests()
        resetUpstreamProxyRelayStatsForTests()
        clearRecentRelayFailuresForTests()
        resetUpstreamProxyForTests()
        return out
      }),
    ])

    expect(resA.origProxy).toBe('http://corp-a:8080')
    expect(resB.origProxy).toBe('http://corp-b:9090')
    expect(resA.overlayProxy).toBe('http://127.0.0.1:41001')
    expect(resB.overlayProxy).toBe('http://127.0.0.1:42002')
    expect(resA.reqId).toBe('shr-token-oauth-1')
    expect(resB.reqId).toBe('shr-token-oauth-1')
    expect(resA.note).toBe('note-host-a')
    expect(resB.note).toBe('note-host-b')
    expect(resA.relayStats.maxClientConnections).toBe(11)
    expect(resA.relayStats.requestHeadTimeoutMs).toBe(1111)
    expect(resB.relayStats.maxClientConnections).toBe(22)
    expect(resB.relayStats.requestHeadTimeoutMs).toBe(2222)
    expect(resA.statusBody.maxClientConnections).toBe(11)
    expect(resB.statusBody.maxClientConnections).toBe(22)
    expect(resA.failures).toBe(0)
    expect(resB.failures).toBe(0)
  })
})
