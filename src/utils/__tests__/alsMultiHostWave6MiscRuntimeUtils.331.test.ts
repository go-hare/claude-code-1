import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addSessionCronTask,
  setSessionPersistenceDisabled,
} from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import {
  clearOAuthAccountOnHoldCaches,
  isAccountOnHoldGateEnabled,
  isOAuthRefreshTokenKnownDead,
  isOAuthRefreshTokenOnHold,
  isOAuthScopeExpansionAttempted,
  recordOAuthScopeExpansionAttempt,
  registerAccountOnHoldGateReader,
  rememberOAuthAccountOnHold,
} from '../accountOnHold.js'
import {
  clearAutoModeDenialsForTesting,
  getAutoModeDenials,
  recordAutoModeDenial,
} from '../autoModeDenials.js'
import {
  commitPreparedAutonomyTurn,
  prepareAutonomyTurnPrompt,
  resetAutonomyAuthorityForTests,
} from '../autonomyAuthority.js'
import {
  getAutonomyPersistenceLockCountForTests,
  withAutonomyPersistenceLock,
} from '../autonomyPersistence.js'
import {
  peekDeferredAdoptStash,
  resetDeferredAdoptStash,
  resetLeftArrowCheckpointLive,
  stashDeferredAdoptResume,
  stashLeftArrowCheckpointLive,
  takeDeferredAdoptStash,
  takeLeftArrowCheckpointLive,
} from '../bgCheckpoint.js'
import { _resetBgCommandNeedsParkForTests } from '../bgCommandNeedsPark.js'
import {
  _resetBgNeedsInputBridgeForTests,
  emitBgNeedsInput,
  emitBgWorktreeMeta,
  getBgInFlightRegistry,
  getBgNeedsInputSnapshot,
  getBgWorktreeMetaSnapshot,
  noteHookFailure,
  setBgInFlightRegistry,
  subscribeBgNeedsInput,
} from '../bgNeedsInputBridge.js'
import {
  clearHeldClearedDraft,
  holdCleared,
  peekHeldClearedDraftForTests,
  resetHeldClearedDraftForTests,
  restoreCleared,
} from '../clearedDraftHold.js'
import {
  fetchesClientDataEnabled,
  leftoverD2SetClientData,
  leftoverIhrBind,
  leftoverIhrGet,
  leftoverIhrMarkStoreMounted,
  leftoverIhrPeek,
  leftoverQrr,
  leftoverQrrSetReadGate,
  setFetchesClientData,
} from '../collapseReadSearch.js'
import {
  notifyCommandLifecycle,
  setCommandLifecycleListener,
} from '../commandLifecycle.js'
import {
  clearContextWindowEnforcementNoticesLatchForTests,
  logContextWindowEnforcementStartupNotices,
} from '../context.js'
import { getOwnProcStartToken, peekOwnProcStartToken } from '../cronTasks.js'
import {
  clearSessionOrgEffortCaps,
  getSessionOrgEffortCap,
  markOrgEffortCapNotified,
  stepDownOrgEffortCap,
} from '../effort.js'
import { envDynamic } from '../envDynamic.js'
import {
  clearSessionFastModeRejections,
  handleFastModeOverageRejection,
  isModelFastModeRejectedForSession,
  markModelFastModeRejectedForSession,
  onFastModeOverageRejection,
  onOrgFastModeChanged,
} from '../fastMode.js'
import {
  loadFastPathPolicy,
  resetFastPathPolicyForTesting,
} from '../fastPathPolicy.js'
import {
  getFeedbackNoticeState,
  queueFeedbackDraftNotice,
  resetFeedbackNoticeStateForTests,
  subscribeFeedbackNotice,
  tryConsumeSendFeedbackCall,
} from '../feedbackDrafts/notice.js'
import {
  clearApprovedFileToolPathsForTests,
  noteApprovedFileToolPath,
  takeApprovedFileToolPath,
} from '../fileToolApprovedOpen.js'
import {
  _resetFleetNeedsInputNudgeStoreForTests,
  getFleetNeedsInputNudgeSnapshot,
  getFleetNeedsInputNudgeStore,
} from '../fleetNeedsInputNudge.js'
import {
  backgroundForegroundToolCalls,
  listForegroundToolCalls,
  queryForegroundSession,
  registerForegroundToolCall,
} from '../foregroundToolCalls.js'
import {
  getForkReplayLaunchConfig,
  getSettingsEffortAtStartup,
  resetForkReplayLaunchConfig,
  setForkReplayLaunchConfig,
  setSettingsEffortAtStartup,
} from '../forkReplayLaunchConfig.js'
import {
  resetForkSubagentSessionSource,
  resolveForkSubagentSource,
} from '../forkSubagentGate.js'
import { clearResolveGitDirCache, resolveGitDir } from '../git/gitFilesystem.js'
import {
  clearHandbackClassifierResultsForTests,
  stashHandbackClassifierResult,
  takeHandbackClassifierResult,
} from '../handbackClassifierResult.js'
import {
  AUTONOMOUS_LOOP_SENTINEL,
  cancelLoopWakeupsOnUserAbort,
  subscribeLoopWakeupsCancelled,
} from '../loopDynamic.js'
import {
  resetAutonomousLoopDelivered,
  resolveAutonomousLoopFire,
} from '../loopFire.js'
import {
  armObserverPairing,
  clearAllObserverPairings,
  getArmedObserverPairing,
  getObserverPairingByObservedKey,
  getObserverRuntimeHost,
  isMainSessionObserverBlocked,
  resetObserverRuntimeHostForTests,
  setMainSessionObserverBlocked,
  setObserverRuntimeHost,
} from '../observerAgents.js'
import {
  clearAgentResumeInFlightForTests,
  isAgentResumeInFlight,
  releaseAgentResumeInFlight,
  tryClaimAgentResumeInFlight,
} from '../orphanAgentResume.js'
import {
  _setAllowRuleSecretScannerForTesting,
  downgradePermissionUpdateForPersistence,
} from '../permissions/PermissionUpdate.js'
import {
  addSendOverride,
  clearMasterMutedPipes,
  clearSendOverrides,
  getSendOverrideVersion,
  hasSendOverride,
  isMasterPipeMuted,
  setMasterMutedPipes,
  subscribeSendOverride,
} from '../pipeMuteState.js'
import {
  clearPendingPipePermissions,
  getPipeRelay,
  isRelayMuted,
  setPipeRelay,
  setRelayMuted,
} from '../pipePermissionRelay.js'
import { getMachineId } from '../pipeRegistry.js'
import {
  clearGithubAuthCacheForTests,
  getPrStatusShared,
  resolveGithubAuthCached,
} from '../prStatusPoller.js'
import {
  _resetChangelogCacheForTesting,
  getStoredChangelogFromMemory,
} from '../releaseNotes.js'
import {
  clearTimedOutRenameTargetsForTesting,
  hasTimedOutRenameTarget,
  renameSyncWithAdaptiveRetry,
} from '../renameRetry.js'
import {
  clearNamesNotShownForTests,
  getNamesNotShown,
  recordNameNotShown,
} from '../sanitization.js'
import { runWithNewHostSession } from '../sessionHost.js'
import {
  getBgJobDirectory,
  getBgJobTakeover,
  resetBgJobTakeoverForTests,
  setBgJobTakeover,
} from '../sessionNameJobSidecar.js'
import {
  appendBtwHistory,
  clearBtwHistory,
  getBtwHistory,
} from '../sideQuestion.js'
import { clearStreamingToolJsonPreview } from '../streamingToolJsonPreview.js'
import {
  dedupeCommandsByName,
  dropShadowedBundledSkills,
} from '../suggestions/commandSuggestions.js'
import {
  clearDirectoryCache,
  scanDirectory,
} from '../suggestions/directoryCompletion.js'
import {
  clearShellHistoryCache,
  prependToShellHistoryCache,
} from '../suggestions/shellHistoryCompletion.js'
import {
  clearSlackChannelCache,
  findSlackChannelPositions,
  getKnownChannelsVersion,
  getSlackChannelSuggestions,
  subscribeKnownChannels,
} from '../suggestions/slackChannelSuggestions.js'
import {
  clearSyncSkillMaterializations,
  registerSyncSkillMaterialization,
  waitForSyncSkillMaterialization,
} from '../syncSkillsMaterialization.js'
import {
  getActiveSyncerForTest,
  startSyncedFileSyncer,
  stopActiveSyncerForTest,
} from '../syncedFileSyncer.js'
import {
  getJFaAppStateReader,
  resolveSessionTodos,
  setJFaAppStateReader,
} from '../task/jfaInFlightStamp.js'
import {
  maybeGenerateTaskSummary,
  shouldGenerateTaskSummary,
} from '../taskSummary.js'
import { withInProcessMailboxLock } from '../teammateMailbox.js'
import {
  __resetCloudPeerSessionsMemoForTests,
  listCloudPeerSessions,
} from '../teleport/cloudPeerSessions.js'
import {
  dropPreSettingsEnvSnapshot,
  getPreSettingsEnvSnapshot,
  peekPreSettingsEnvSnapshot,
  seedGitS,
} from '../teleport/seedGitHardened.js'
import {
  _resetEphemeralToolResultsForTests,
  cleanupEphemeralToolResultsDirs,
  getToolResultsDir,
} from '../toolResultStorage.js'
import {
  getWorktreeGitIsolationContext,
  registerWorktreeSessionProvider,
} from '../worktreeGitIsolation.js'

const tick = (ms = 4): Promise<void> =>
  new Promise(resolveTick => {
    setTimeout(resolveTick, ms)
  })

describe('2.1.331 Wave 6 Multi-Host Isolation: Misc Runtime Utils, Suggestions, Autonomy, Pipes, Teleport & ToolResultStorage', () => {
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
      delete savedEnv[k]
    }
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup
      }
    }
  })

  test('accountOnHold isolates gate reader, on-hold map, scope-expansion & dead token sets per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'aoh-a' }, async () => {
        clearOAuthAccountOnHoldCaches()
        registerAccountOnHoldGateReader(() => true)
        rememberOAuthAccountOnHold('tok-a', 'https://claude.ai/appeal-a')
        recordOAuthScopeExpansionAttempt('tok-a')
        await tick()
        return {
          gate: isAccountOnHoldGateEnabled(),
          hasA: isOAuthRefreshTokenOnHold('tok-a'),
          hasB: isOAuthRefreshTokenOnHold('tok-b'),
          scopeA: isOAuthScopeExpansionAttempted('tok-a'),
          scopeB: isOAuthScopeExpansionAttempted('tok-b'),
          deadA: isOAuthRefreshTokenKnownDead('tok-a'),
        }
      }),
      runWithNewHostSession({ id: 'aoh-b' }, async () => {
        clearOAuthAccountOnHoldCaches()
        registerAccountOnHoldGateReader(() => false)
        rememberOAuthAccountOnHold('tok-b', 'https://claude.ai/appeal-b')
        await tick()
        return {
          gate: isAccountOnHoldGateEnabled(),
          hasA: isOAuthRefreshTokenOnHold('tok-a'),
          hasB: isOAuthRefreshTokenOnHold('tok-b'),
          scopeA: isOAuthScopeExpansionAttempted('tok-a'),
          scopeB: isOAuthScopeExpansionAttempted('tok-b'),
          deadB: isOAuthRefreshTokenKnownDead('tok-b'),
        }
      }),
    ])

    expect(resA).toEqual({
      gate: true,
      hasA: true,
      hasB: false,
      scopeA: true,
      scopeB: false,
      deadA: false,
    })
    expect(resB).toEqual({
      gate: false,
      hasA: false,
      hasB: true,
      scopeA: false,
      scopeB: false,
      deadB: false,
    })
  })

  test('autonomyAuthority isolates heartbeat last-run per session/host and autonomyPersistence serializes locks process-globally', async () => {
    const rootA = makeTempDir('auto-a-')
    const rootB = makeTempDir('auto-b-')
    mkdirSync(join(rootA, '.claude', 'autonomy'), { recursive: true })
    mkdirSync(join(rootB, '.claude', 'autonomy'), { recursive: true })
    const hb = [
      '---',
      'tasks:',
      '  - name: ping',
      '    interval: 1h',
      '    prompt: check health',
      '---',
      'Heartbeat guide',
    ].join('\n')
    writeFileSync(join(rootA, '.claude', 'autonomy', 'HEARTBEAT.md'), hb)
    writeFileSync(join(rootB, '.claude', 'autonomy', 'HEARTBEAT.md'), hb)

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'auto-s-a', cwd: rootA }, async () => {
        resetAutonomyAuthorityForTests()
        const t0 = 1_000_000
        const first = await prepareAutonomyTurnPrompt({
          basePrompt: 'tick',
          trigger: 'proactive-tick',
          rootDir: rootA,
          currentDir: rootA,
          nowMs: t0,
        })
        commitPreparedAutonomyTurn(first)
        await tick()
        const second = await prepareAutonomyTurnPrompt({
          basePrompt: 'tick',
          trigger: 'proactive-tick',
          rootDir: rootA,
          currentDir: rootA,
          nowMs: t0 + 1000,
        })
        let lockCountDuring = 0
        await withAutonomyPersistenceLock(rootA, async () => {
          lockCountDuring = getAutonomyPersistenceLockCountForTests()
          await tick()
        })
        return {
          firstDue: first.dueHeartbeatTasks.length,
          secondDue: second.dueHeartbeatTasks.length,
          lockCountDuring,
          lockCountAfter: getAutonomyPersistenceLockCountForTests(),
        }
      }),
      runWithNewHostSession({ id: 'auto-s-b', cwd: rootB }, async () => {
        resetAutonomyAuthorityForTests()
        await tick()
        // Same rootA tested from Session B must NOT be suppressed by Session A's commit
        const forRootAInB = await prepareAutonomyTurnPrompt({
          basePrompt: 'tick',
          trigger: 'proactive-tick',
          rootDir: rootA,
          currentDir: rootA,
          nowMs: 1_001_000,
        })
        return {
          forRootAInBDue: forRootAInB.dueHeartbeatTasks.length,
        }
      }),
    ])

    expect(resA.firstDue).toBe(1)
    expect(resA.secondDue).toBe(0)
    expect(resA.lockCountDuring).toBe(1)
    expect(resA.lockCountAfter).toBe(0)
    expect(resB.forRootAInBDue).toBe(1)
    expect(getAutonomyPersistenceLockCountForTests()).toBe(0)
  })

  test('bgCheckpoint, bgNeedsInputBridge & bgCommandNeedsPark isolate stashes and needs-input slots per session', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'bg-a' }, async () => {
        resetDeferredAdoptStash()
        resetLeftArrowCheckpointLive()
        _resetBgNeedsInputBridgeForTests()
        _resetBgCommandNeedsParkForTests()

        const events: Array<string | null> = []
        const unsub = subscribeBgNeedsInput(p => events.push(p?.text ?? null))

        stashDeferredAdoptResume(
          '/tmp/job-a',
          [{ agentId: 'ag-a' } as never],
          [],
        )
        stashLeftArrowCheckpointLive({ agentIds: ['a'] } as never)
        noteHookFailure('tu-a', 'hook-err-a')
        emitBgNeedsInput('approve Bash: ls', 'permission', {
          toolUseID: 'tu-a',
        })
        setBgInFlightRegistry({
          tasks: 2,
          queued: 1,
          kinds: ['bash'],
          items: [],
        })
        emitBgWorktreeMeta({ worktreePath: '/wt-a', worktreeBranch: 'br-a' })

        await tick()
        const peekA = peekDeferredAdoptStash('/tmp/job-a')
        const tookA = takeDeferredAdoptStash('/tmp/job-a')
        const liveA = takeLeftArrowCheckpointLive()
        const snapA = getBgNeedsInputSnapshot()
        const regA = getBgInFlightRegistry()
        const wtA = getBgWorktreeMetaSnapshot()
        unsub()
        return { peekA, tookA, liveA, snapA, regA, wtA, events }
      }),
      runWithNewHostSession({ id: 'bg-b' }, async () => {
        resetDeferredAdoptStash()
        resetLeftArrowCheckpointLive()
        _resetBgNeedsInputBridgeForTests()
        _resetBgCommandNeedsParkForTests()

        stashDeferredAdoptResume(
          '/tmp/job-b',
          [{ agentId: 'ag-b' } as never],
          [],
        )
        emitBgNeedsInput('approve Edit: foo.ts', 'permission')
        emitBgWorktreeMeta({ worktreePath: '/wt-b', worktreeBranch: 'br-b' })

        await tick()
        const crossPeekA = peekDeferredAdoptStash('/tmp/job-a')
        const tookB = takeDeferredAdoptStash('/tmp/job-b')
        const liveB = takeLeftArrowCheckpointLive()
        const snapB = getBgNeedsInputSnapshot()
        const regB = getBgInFlightRegistry()
        const wtB = getBgWorktreeMetaSnapshot()
        return { crossPeekA, tookB, liveB, snapB, regB, wtB }
      }),
    ])

    expect(resA.peekA.agents).toHaveLength(1)
    expect(resA.tookA.agents).toHaveLength(1)
    expect(resA.liveA).not.toBeNull()
    expect(resA.snapA?.text).toContain('hook-err-a')
    expect(resA.regA.tasks).toBe(2)
    expect(resA.wtA?.worktreeBranch).toBe('br-a')
    expect(resA.events).toHaveLength(1)

    expect(resB.crossPeekA.agents).toHaveLength(0)
    expect(resB.tookB.agents).toHaveLength(1)
    expect(resB.liveB).toBeNull()
    expect(resB.snapB?.text).toBe('approve Edit: foo.ts')
    expect(resB.regB.tasks).toBe(0)
    expect(resB.wtB?.worktreeBranch).toBe('br-b')
  })

  test('clearedDraftHold, commandLifecycle, autoModeDenials & sideQuestion isolate per session', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'ui-a' }, async () => {
        resetHeldClearedDraftForTests()
        clearAutoModeDenialsForTesting()
        clearBtwHistory()
        const seenLifecycle: string[] = []
        setCommandLifecycleListener((uuid, state) =>
          seenLifecycle.push(`${uuid}:${state}`),
        )
        holdCleared({
          text: 'draft-a',
          mode: 'prompt',
          pastedContents: {},
          intoHistory: false,
        })
        notifyCommandLifecycle('cmd-a', 'started')
        recordAutoModeDenial({
          toolName: 'Bash',
          display: 'rm -rf /tmp/a',
          inputKey: 'k-a',
          reason: 'r-a',
          timestamp: 1,
        })
        appendBtwHistory('q-a', 'ans-a')
        await tick()
        const peekA = peekHeldClearedDraftForTests()?.text ?? null
        const restoredA = restoreCleared('')?.text ?? null
        clearHeldClearedDraft()
        return {
          peekA,
          restoredA,
          seenLifecycle,
          denialsLen: getAutoModeDenials().length,
          btw: getBtwHistory(),
        }
      }),
      runWithNewHostSession({ id: 'ui-b' }, async () => {
        resetHeldClearedDraftForTests()
        clearAutoModeDenialsForTesting()
        clearBtwHistory()
        const seenLifecycle: string[] = []
        setCommandLifecycleListener((uuid, state) =>
          seenLifecycle.push(`${uuid}:${state}`),
        )
        holdCleared({
          text: 'draft-b',
          mode: 'prompt',
          pastedContents: {},
          intoHistory: false,
        })
        notifyCommandLifecycle('cmd-b', 'completed')
        appendBtwHistory('q-b', 'ans-b')
        await tick()
        const peekB = peekHeldClearedDraftForTests()?.text ?? null
        const restoredB = restoreCleared('')?.text ?? null
        return {
          peekB,
          restoredB,
          seenLifecycle,
          denialsLen: getAutoModeDenials().length,
          btw: getBtwHistory(),
        }
      }),
    ])

    expect(resA.peekA).toBe('draft-a')
    expect(resA.restoredA).toBe('draft-a')
    expect(resA.seenLifecycle).toEqual(['cmd-a:started'])
    expect(resA.btw).toEqual([{ question: 'q-a', response: 'ans-a' }])

    expect(resB.peekB).toBe('draft-b')
    expect(resB.restoredB).toBe('draft-b')
    expect(resB.seenLifecycle).toEqual(['cmd-b:completed'])
    expect(resB.btw).toEqual([{ question: 'q-b', response: 'ans-b' }])
    expect(resB.denialsLen).toBe(0)
  })

  test('collapseReadSearch isolates spinner store per session and D2/Qrr client data per host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'crs-a' }, async () => {
        leftoverIhrMarkStoreMounted(true)
        leftoverIhrBind('agent-1').setMessage('msg-a')
        setFetchesClientData(true)
        leftoverQrrSetReadGate(() => true)
        leftoverD2SetClientData({ flagA: true }, 'claude-opus-4-7')
        await tick()
        return {
          msg: leftoverIhrGet('agent-1').overrideMessage,
          fetches: fetchesClientDataEnabled(),
          qrr: leftoverQrr('claude-opus-4-7')?.data,
        }
      }),
      runWithNewHostSession({ id: 'crs-b' }, async () => {
        leftoverIhrMarkStoreMounted(true)
        leftoverIhrBind('agent-1').setMessage('msg-b')
        setFetchesClientData(false)
        leftoverQrrSetReadGate(() => false)
        await tick()
        return {
          msg: leftoverIhrPeek('agent-1').overrideMessage,
          fetches: fetchesClientDataEnabled(),
          qrr: leftoverQrr('claude-opus-4-7'),
        }
      }),
    ])

    expect(resA.msg).toBe('msg-a')
    expect(resA.fetches).toBe(true)
    expect(resA.qrr).toEqual({ flagA: true })

    expect(resB.msg).toBe('msg-b')
    expect(resB.fetches).toBe(false)
    expect(resB.qrr).toBeNull()
  })

  test('effort, fastMode, fastPathPolicy, envDynamic, context & cronTasks isolate per session/host', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'ef-a' }, async () => {
        clearSessionOrgEffortCaps()
        clearSessionFastModeRejections()
        clearContextWindowEnforcementNoticesLatchForTests()
        resetFastPathPolicyForTesting()

        stepDownOrgEffortCap('claude-opus-4-7', 'max')
        const notifiedFirst = markOrgEffortCapNotified('claude-opus-4-7')
        markModelFastModeRejectedForSession('claude-opus-4-7')
        const overageMsgs: string[] = []
        const unsubOverage = onFastModeOverageRejection(m =>
          overageMsgs.push(m),
        )
        const orgChanges: boolean[] = []
        const unsubOrg = onOrgFastModeChanged(v => orgChanges.push(v))
        handleFastModeOverageRejection('out_of_credits')

        envDynamic.getIsDocker.cache.set('probe', Promise.resolve(true))
        logContextWindowEnforcementStartupNotices('unknown-custom-model-a')
        const tokA = getOwnProcStartToken()
        const policyA = await loadFastPathPolicy()

        await tick()
        const result = {
          cap: getSessionOrgEffortCap('claude-opus-4-7'),
          notifiedFirst,
          notifiedSecond: markOrgEffortCapNotified('claude-opus-4-7'),
          rejected: isModelFastModeRejectedForSession('claude-opus-4-7'),
          overageCount: overageMsgs.length,
          orgChanges,
          dockerCacheHasProbe: envDynamic.getIsDocker.cache.has('probe'),
          peekedTok: peekOwnProcStartToken(),
          tokA,
          policyA,
        }
        unsubOverage()
        unsubOrg()
        return result
      }),
      runWithNewHostSession({ id: 'ef-b' }, async () => {
        clearSessionOrgEffortCaps()
        clearSessionFastModeRejections()
        clearContextWindowEnforcementNoticesLatchForTests()
        resetFastPathPolicyForTesting()

        const overageMsgs: string[] = []
        const unsubOverage = onFastModeOverageRejection(m =>
          overageMsgs.push(m),
        )

        await tick()
        const result = {
          cap: getSessionOrgEffortCap('claude-opus-4-7'),
          rejected: isModelFastModeRejectedForSession('claude-opus-4-7'),
          overageCount: overageMsgs.length,
          dockerCacheHasProbe: envDynamic.getIsDocker.cache.has('probe'),
          peekedTokBeforeGet: peekOwnProcStartToken(),
        }
        unsubOverage()
        return result
      }),
    ])

    expect(resA.cap).toBeDefined()
    expect(resA.notifiedFirst).toBe(true)
    expect(resA.notifiedSecond).toBe(false)
    expect(resA.rejected).toBe(true)
    expect(resA.overageCount).toBe(1)
    expect(resA.dockerCacheHasProbe).toBe(true)
    expect(resA.peekedTok).toBe(resA.tokA)
    expect(resA.policyA).toBeNull()

    expect(resB.cap).toBeUndefined()
    expect(resB.rejected).toBe(false)
    expect(resB.overageCount).toBe(0)
    expect(resB.dockerCacheHasProbe).toBe(false)
    expect(resB.peekedTokBeforeGet).toBeUndefined()
  })

  test('feedbackDrafts/notice, fileToolApprovedOpen, fleetNeedsInputNudge & foregroundToolCalls isolate concurrently', async () => {
    const tmpA = makeTempDir('ft-a-')
    const tmpB = makeTempDir('ft-b-')
    const fileA = join(tmpA, 'a.txt')
    const fileB = join(tmpB, 'b.txt')
    writeFileSync(fileA, 'a')
    writeFileSync(fileB, 'b')

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'fg-a', cwd: tmpA }, async () => {
        resetFeedbackNoticeStateForTests()
        clearApprovedFileToolPathsForTests()
        _resetFleetNeedsInputNudgeStoreForTests()

        let noticeHits = 0
        const unsubNotice = subscribeFeedbackNotice(() => {
          noticeHits++
        })
        tryConsumeSendFeedbackCall()
        queueFeedbackDraftNotice({
          draftId: 'd-a',
          title: 'Title A',
          type: 'bug',
          detailsPreview: 'prev-a',
        })
        noteApprovedFileToolPath(fileA)
        const store = getFleetNeedsInputNudgeStore()
        store._setSnapshotForTests({ needsInput: 3, done: 1, succeeded: 1 })

        let bgCalledA = false
        const unregFg = registerForegroundToolCall(queryForegroundSession, {
          toolUseId: 'fg-tu-a',
          backgroundNow: () => {
            bgCalledA = true
            return true
          },
        })

        await tick()
        const fgCountBefore = listForegroundToolCalls(
          queryForegroundSession,
        ).length
        const moved = backgroundForegroundToolCalls(queryForegroundSession)
        const approvedSet = takeApprovedFileToolPath(fileA)
        const snap = getFleetNeedsInputNudgeSnapshot()
        const noticeState = getFeedbackNoticeState()
        unregFg()
        unsubNotice()
        return {
          noticeHits,
          noticeDraftId: noticeState.notice?.draftId ?? null,
          toolCalls: noticeState.toolCallCount,
          approvedHasFileA: approvedSet.has(fileA),
          fleetNeeds: snap?.needsInput,
          fgCountBefore,
          moved,
          bgCalledA,
        }
      }),
      runWithNewHostSession({ id: 'fg-b', cwd: tmpB }, async () => {
        resetFeedbackNoticeStateForTests()
        clearApprovedFileToolPathsForTests()
        _resetFleetNeedsInputNudgeStoreForTests()

        let bgCalledB = false
        const unregFg = registerForegroundToolCall(queryForegroundSession, {
          toolUseId: 'fg-tu-b',
          backgroundNow: () => {
            bgCalledB = true
            return true
          },
        })

        await tick()
        const fgCalls = listForegroundToolCalls(queryForegroundSession)
        const snap = getFleetNeedsInputNudgeSnapshot()
        const noticeState = getFeedbackNoticeState()
        unregFg()
        return {
          noticeDraftId: noticeState.notice?.draftId ?? null,
          toolCalls: noticeState.toolCallCount,
          fleetSnap: snap,
          fgIds: fgCalls.map(c => c.toolUseId),
          bgCalledB,
        }
      }),
    ])

    expect(resA.noticeHits).toBeGreaterThan(0)
    expect(resA.noticeDraftId).toBe('d-a')
    expect(resA.toolCalls).toBe(1)
    expect(resA.approvedHasFileA).toBe(true)
    expect(resA.fleetNeeds).toBe(3)
    expect(resA.fgCountBefore).toBe(1)
    expect(resA.moved).toBe(1)
    expect(resA.bgCalledA).toBe(true)

    expect(resB.noticeDraftId).toBeNull()
    expect(resB.toolCalls).toBe(0)
    expect(resB.fleetSnap).toBeUndefined()
    expect(resB.fgIds).toEqual(['fg-tu-b'])
    expect(resB.bgCalledB).toBe(false)
  })

  test('forkReplayLaunchConfig, forkSubagentGate, handbackClassifierResult, loopDynamic & loopFire isolate per host/session', async () => {
    setEnv('CLAUDE_CODE_FORK_SUBAGENT', undefined)
    setEnv('USER_TYPE', 'external')

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'lp-a' }, async () => {
        resetForkReplayLaunchConfig()
        resetForkSubagentSessionSource()
        clearHandbackClassifierResultsForTests()
        resetAutonomousLoopDelivered()

        setForkReplayLaunchConfig({ agent: 'agent-a' })
        setSettingsEffortAtStartup('high')
        const srcFirst = resolveForkSubagentSource()
        stashHandbackClassifierResult('hb-1', { kind: 'refused' })

        const cancelledReasons: string[] = []
        const unsub = subscribeLoopWakeupsCancelled(e =>
          cancelledReasons.push(`${e.reason}:${e.loopsCancelled}`),
        )
        addSessionCronTask({
          id: 'loop-a-1',
          cron: '* * * * *',
          prompt: AUTONOMOUS_LOOP_SENTINEL,
          createdAt: Date.now(),
          kind: 'loop',
        })
        const firstFire = resolveAutonomousLoopFire(AUTONOMOUS_LOOP_SENTINEL)
        await tick()
        const secondFire = resolveAutonomousLoopFire(AUTONOMOUS_LOOP_SENTINEL)
        const cancelledCount = cancelLoopWakeupsOnUserAbort('user_abort')
        const hb = takeHandbackClassifierResult('hb-1')
        unsub()
        return {
          agent: getForkReplayLaunchConfig().agent,
          effortAtStartup: getSettingsEffortAtStartup(),
          srcFirst,
          hbKind: hb?.kind,
          firstHasPreamble: firstFire?.includes('Autonomous loop check'),
          secondHasPreamble: secondFire?.includes('Autonomous loop check'),
          cancelledCount,
          cancelledReasons,
        }
      }),
      runWithNewHostSession({ id: 'lp-b' }, async () => {
        resetForkReplayLaunchConfig()
        resetForkSubagentSessionSource()
        clearHandbackClassifierResultsForTests()
        resetAutonomousLoopDelivered()

        setForkReplayLaunchConfig({ agent: 'agent-b' })
        setSettingsEffortAtStartup('low')

        const cancelledReasons: string[] = []
        const unsub = subscribeLoopWakeupsCancelled(e =>
          cancelledReasons.push(`${e.reason}:${e.loopsCancelled}`),
        )
        await tick()
        // First fire in Session B MUST still include the autonomous preamble!
        const firstFireB = resolveAutonomousLoopFire(AUTONOMOUS_LOOP_SENTINEL)
        const hbCross = takeHandbackClassifierResult('hb-1')
        unsub()
        return {
          agent: getForkReplayLaunchConfig().agent,
          effortAtStartup: getSettingsEffortAtStartup(),
          hbCross,
          firstHasPreamble: firstFireB?.includes('Autonomous loop check'),
          cancelledReasons,
        }
      }),
    ])

    expect(resA.agent).toBe('agent-a')
    expect(resA.effortAtStartup).toBe('high')
    expect(resA.srcFirst).toBe('default')
    expect(resA.hbKind).toBe('refused')
    expect(resA.firstHasPreamble).toBe(true)
    expect(resA.secondHasPreamble).toBe(false)
    expect(resA.cancelledCount).toBe(1)
    expect(resA.cancelledReasons).toEqual(['user_abort:1'])

    expect(resB.agent).toBe('agent-b')
    expect(resB.effortAtStartup).toBe('low')
    expect(resB.hbCross).toBeUndefined()
    expect(resB.firstHasPreamble).toBe(true)
    expect(resB.cancelledReasons).toEqual([])
  })

  test('observerAgents, orphanAgentResume, PermissionUpdate, sanitization & sessionNameJobSidecar isolate concurrently', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'obs-a' }, async () => {
        clearAllObserverPairings()
        resetObserverRuntimeHostForTests()
        clearAgentResumeInFlightForTests()
        clearNamesNotShownForTests()
        resetBgJobTakeoverForTests()

        const hostObjA = {
          spawnFirstRun: async () => {},
          deliver: async () => {},
        }
        setObserverRuntimeHost(hostObjA)
        setMainSessionObserverBlocked(true)
        armObserverPairing({
          observerTaskId: 'obs-task-1',
          observedKey: 'main-key',
          observerAgentType: 'watcher-a',
          observedEnvelopeName: 'main',
          observerDefinition: { agentType: 'watcher-a' },
        })
        const claimed = tryClaimAgentResumeInFlight('orphan-1')
        _setAllowRuleSecretScannerForTesting(() => true)
        const downgradedA = downgradePermissionUpdateForPersistence({
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'echo ok' }],
          behavior: 'allow',
          destination: 'userSettings',
        })
        recordNameNotShown('bad-name-a', 'invalid')
        setBgJobTakeover({ jobDir: '/tmp/takeover-a' })

        await tick()
        const result = {
          hostMatches: getObserverRuntimeHost() === hostObjA,
          blocked: isMainSessionObserverBlocked(),
          armedType: getArmedObserverPairing('obs-task-1')?.observerAgentType,
          byKey: getObserverPairingByObservedKey('main-key')?.observerAgentType,
          claimed,
          inFlight: isAgentResumeInFlight('orphan-1'),
          secretReason: downgradedA.reason,
          namesNotShown: [...getNamesNotShown()],
          takeoverDir: getBgJobDirectory(),
        }
        releaseAgentResumeInFlight('orphan-1')
        _setAllowRuleSecretScannerForTesting(undefined)
        return result
      }),
      runWithNewHostSession({ id: 'obs-b' }, async () => {
        clearAllObserverPairings()
        resetObserverRuntimeHostForTests()
        clearAgentResumeInFlightForTests()
        clearNamesNotShownForTests()
        resetBgJobTakeoverForTests()

        await tick()
        const claimedSameIdInB = tryClaimAgentResumeInFlight('orphan-1')
        const downgradedB = downgradePermissionUpdateForPersistence({
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'echo ok' }],
          behavior: 'allow',
          destination: 'userSettings',
        })
        const result = {
          host: getObserverRuntimeHost(),
          blocked: isMainSessionObserverBlocked(),
          armed: getArmedObserverPairing('obs-task-1'),
          claimedSameIdInB,
          secretReasonB: downgradedB.reason,
          namesNotShown: [...getNamesNotShown()],
          takeover: getBgJobTakeover(),
        }
        releaseAgentResumeInFlight('orphan-1')
        return result
      }),
    ])

    expect(resA.hostMatches).toBe(true)
    expect(resA.blocked).toBe(true)
    expect(resA.armedType).toBe('watcher-a')
    expect(resA.byKey).toBe('watcher-a')
    expect(resA.claimed).toBe(true)
    expect(resA.inFlight).toBe(true)
    expect(resA.secretReason).toBe('holds_secret')
    expect(resA.namesNotShown).toEqual(['bad-name-a invalid'])
    expect(resA.takeoverDir).toBe('/tmp/takeover-a')

    expect(resB.host).toBeNull()
    expect(resB.blocked).toBe(false)
    expect(resB.armed).toBeUndefined()
    expect(resB.claimedSameIdInB).toBe(true)
    expect(resB.secretReasonB).toBeUndefined()
    expect(resB.namesNotShown).toEqual([])
    expect(resB.takeover).toBeNull()
  })

  test('pipes (pipeMuteState, pipePermissionRelay, pipeRegistry), prStatusPoller, releaseNotes & renameRetry isolate per host', async () => {
    const renameDir = makeTempDir('ren-')
    const targetA = join(renameDir, 'target-a')
    writeFileSync(targetA, 'existing')

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'pipe-a' }, async () => {
        clearMasterMutedPipes()
        clearSendOverrides()
        clearPendingPipePermissions()
        clearGithubAuthCacheForTests()
        _resetChangelogCacheForTesting()
        clearTimedOutRenameTargetsForTesting()

        let overrideEvents = 0
        const unsub = subscribeSendOverride(() => {
          overrideEvents++
        })
        setMasterMutedPipes(['slave-a'])
        addSendOverride('slave-a')
        const relayA = () => {}
        setPipeRelay(relayA)
        setRelayMuted(true)
        const prSharedA = getPrStatusShared()
        prSharedA.pollerDisabled = true
        const machineIdA = await getMachineId()

        // Trigger timedOutRenameTarget in Host A
        try {
          renameSyncWithAdaptiveRetry(
            join(renameDir, 'src-a'),
            targetA,
            () => {
              const err = new Error('EBUSY') as NodeJS.ErrnoException
              err.code = 'EBUSY'
              throw err
            },
            () => {},
          )
        } catch {
          // expected
        }

        await tick()
        const result = {
          mutedA: isMasterPipeMuted('slave-a'),
          overrideA: hasSendOverride('slave-a'),
          overrideVer: getSendOverrideVersion(),
          overrideEvents,
          relayIsA: getPipeRelay() === relayA,
          relayMuted: isRelayMuted(),
          prDisabled: getPrStatusShared().pollerDisabled,
          machineIdLen: machineIdA.length,
          changelog: getStoredChangelogFromMemory(),
          timedOutA: hasTimedOutRenameTarget(targetA),
        }
        unsub()
        return result
      }),
      runWithNewHostSession({ id: 'pipe-b' }, async () => {
        clearMasterMutedPipes()
        clearSendOverrides()
        clearPendingPipePermissions()
        clearGithubAuthCacheForTests()
        _resetChangelogCacheForTesting()
        clearTimedOutRenameTargetsForTesting()

        await tick()
        setEnv('GH_TOKEN', 'gh-tok-b')
        const authB = await resolveGithubAuthCached('github.com')
        return {
          mutedAInB: isMasterPipeMuted('slave-a'),
          overrideAInB: hasSendOverride('slave-a'),
          overrideVer: getSendOverrideVersion(),
          relay: getPipeRelay(),
          relayMuted: isRelayMuted(),
          prDisabled: getPrStatusShared().pollerDisabled,
          authKind: authB.kind,
          timedOutAInB: hasTimedOutRenameTarget(targetA),
        }
      }),
    ])

    expect(resA.mutedA).toBe(true)
    expect(resA.overrideA).toBe(true)
    expect(resA.overrideVer).toBe(1)
    expect(resA.overrideEvents).toBe(1)
    expect(resA.relayIsA).toBe(true)
    expect(resA.relayMuted).toBe(true)
    expect(resA.prDisabled).toBe(true)
    expect(resA.machineIdLen).toBeGreaterThan(0)
    expect(resA.changelog).toBe('')
    expect(resA.timedOutA).toBe(true)

    expect(resB.mutedAInB).toBe(false)
    expect(resB.overrideAInB).toBe(false)
    expect(resB.overrideVer).toBe(0)
    expect(resB.relay).toBeNull()
    expect(resB.relayMuted).toBe(false)
    expect(resB.prDisabled).toBe(false)
    expect(resB.authKind).toBe('token')
    expect(resB.timedOutAInB).toBe(false)
  })

  test('suggestions/* (commandSuggestions, directoryCompletion, shellHistoryCompletion, slackChannelSuggestions) isolate per host', async () => {
    const dirA = makeTempDir('sug-a-')
    const dirB = makeTempDir('sug-b-')
    mkdirSync(join(dirA, 'alpha-dir'))
    mkdirSync(join(dirB, 'beta-dir'))

    const fakeSlackClientA = {
      type: 'connected',
      name: 'slack',
      client: {
        callTool: async () => ({
          content: [{ type: 'text', text: 'Name: #eng-alpha\n' }],
        }),
      },
    } as unknown as MCPServerConnection

    const fakeSlackClientB = {
      type: 'connected',
      name: 'slack',
      client: {
        callTool: async () => ({
          content: [{ type: 'text', text: 'Name: #eng-beta\n' }],
        }),
      },
    } as unknown as MCPServerConnection

    const fakeCmdsA = [
      {
        name: 'dup',
        type: 'prompt',
        source: 'userSettings',
        description: 'u',
      },
      { name: 'dup', type: 'prompt', source: 'bundled', description: 'b' },
    ] as unknown as Command[]

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'sug-h-a', cwd: dirA }, async () => {
        clearDirectoryCache()
        clearShellHistoryCache()
        clearSlackChannelCache()

        let knownChangedA = 0
        const unsub = subscribeKnownChannels(() => {
          knownChangedA++
        })
        const dirsA = await scanDirectory(dirA)
        const slackA = await getSlackChannelSuggestions(
          [fakeSlackClientA],
          'eng',
        )
        const dedupedA = dedupeCommandsByName(
          dropShadowedBundledSkills(fakeCmdsA),
        )
        prependToShellHistoryCache('echo hello')

        await tick()
        const posAlpha = findSlackChannelPositions('see #eng-alpha')
        const posBeta = findSlackChannelPositions('see #eng-beta')
        const verA = getKnownChannelsVersion()
        unsub()
        return {
          dirsA: dirsA.map(d => d.name),
          slackA: slackA.map(s => s.displayText),
          posAlphaLen: posAlpha.length,
          posBetaLen: posBeta.length,
          verA,
          knownChangedA,
          dedupedLen: dedupedA.length,
        }
      }),
      runWithNewHostSession({ id: 'sug-h-b', cwd: dirB }, async () => {
        clearDirectoryCache()
        clearShellHistoryCache()
        clearSlackChannelCache()

        const dirsB = await scanDirectory(dirB)
        const slackB = await getSlackChannelSuggestions(
          [fakeSlackClientB],
          'eng',
        )
        await tick()
        const posAlpha = findSlackChannelPositions('see #eng-alpha')
        const posBeta = findSlackChannelPositions('see #eng-beta')
        return {
          dirsB: dirsB.map(d => d.name),
          slackB: slackB.map(s => s.displayText),
          posAlphaLen: posAlpha.length,
          posBetaLen: posBeta.length,
          verB: getKnownChannelsVersion(),
        }
      }),
    ])

    expect(resA.dirsA).toEqual(['alpha-dir'])
    expect(resA.slackA).toEqual(['#eng-alpha'])
    expect(resA.posAlphaLen).toBe(1)
    expect(resA.posBetaLen).toBe(0)
    expect(resA.verA).toBe(1)
    expect(resA.knownChangedA).toBe(1)
    expect(resA.dedupedLen).toBe(1)

    expect(resB.dirsB).toEqual(['beta-dir'])
    expect(resB.slackB).toEqual(['#eng-beta'])
    expect(resB.posAlphaLen).toBe(0)
    expect(resB.posBetaLen).toBe(1)
    expect(resB.verB).toBe(1)
  })

  test('syncSkillsMaterialization, syncedFileSyncer, jfaInFlightStamp, taskSummary, teammateMailbox, teleport, toolResultStorage & worktreeGitIsolation isolate concurrently', async () => {
    const dirA = makeTempDir('misc-a-')
    const dirB = makeTempDir('misc-b-')
    const syncRootA = join(dirA, 'sync-a')
    const syncRootB = join(dirB, 'sync-b')
    const tmpRootA = join(dirA, 'tmp-a')
    const tmpRootB = join(dirB, 'tmp-b')

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'misc-s-a', cwd: dirA }, async () => {
        clearSyncSkillMaterializations()
        stopActiveSyncerForTest()
        clearStreamingToolJsonPreview()
        clearResolveGitDirCache()
        __resetCloudPeerSessionsMemoForTests()
        dropPreSettingsEnvSnapshot()
        _resetEphemeralToolResultsForTests()

        // syncSkillsMaterialization
        const resolveA = registerSyncSkillMaterialization('skill-shared')
        const waitPromiseA = waitForSyncSkillMaterialization('skill-shared', {
          env: { CLAUDE_CODE_SYNC_SKILLS: '1' },
          timeoutMs: 500,
        })

        // syncedFileSyncer
        const syncerA = await startSyncedFileSyncer(syncRootA)
        await syncerA?.initialReconcile

        // jfaInFlightStamp
        setJFaAppStateReader(() => ({
          todos: {
            'misc-s-a': [
              { content: 'todo-a', status: 'in_progress', activeForm: 'a' },
            ],
          },
        }))

        // taskSummary
        maybeGenerateTaskSummary({})

        // teammateMailbox in-process lock
        const mbResultA = await withInProcessMailboxLock(
          join(dirA, 'inbox.json'),
          async () => 'locked-a',
        )

        // teleport: seedGitHardened + cloudPeerSessions
        const snapA = getPreSettingsEnvSnapshot()
        const seedDirA = seedGitS({ CLAUDE_CODE_TMPDIR: tmpRootA })
        const cloudA = await listCloudPeerSessions()

        // toolResultStorage ephemeral dir isolation
        setSessionPersistenceDisabled(true)
        const trDirA = getToolResultsDir()

        // worktreeGitIsolation host provider override
        registerWorktreeSessionProvider(() => ({
          worktreePath: '/wt-host-a',
          originalCwd: dirA,
        }))

        // gitFilesystem
        const gitDirA = await resolveGitDir(dirA)

        await tick()
        resolveA({ ok: true })
        const matA = await waitPromiseA
        const result = {
          matOk: matA.ok,
          hasActiveSyncer: getActiveSyncerForTest() === syncerA,
          todosA: resolveSessionTodos(),
          jfaSet: getJFaAppStateReader() !== null,
          shouldSumImmediately: shouldGenerateTaskSummary(),
          mbResultA,
          hasSnapA: peekPreSettingsEnvSnapshot() === snapA,
          seedDirA,
          cloudA,
          trDirA,
          wtCtxA: getWorktreeGitIsolationContext(dirA),
          gitDirA,
        }
        stopActiveSyncerForTest()
        await cleanupEphemeralToolResultsDirs()
        setJFaAppStateReader(null)
        return result
      }),
      runWithNewHostSession({ id: 'misc-s-b', cwd: dirB }, async () => {
        clearSyncSkillMaterializations()
        stopActiveSyncerForTest()
        clearResolveGitDirCache()
        __resetCloudPeerSessionsMemoForTests()
        dropPreSettingsEnvSnapshot()
        _resetEphemeralToolResultsForTests()

        // Without registering in Host B, wait returns ok immediately (does not block on Host A!)
        const matB = await waitForSyncSkillMaterialization('skill-shared', {
          env: { CLAUDE_CODE_SYNC_SKILLS: '1' },
          timeoutMs: 500,
        })

        // syncedFileSyncer in Host B is independent
        const syncerBeforeB = getActiveSyncerForTest()
        const syncerB = await startSyncedFileSyncer(syncRootB)
        await syncerB?.initialReconcile

        // toolResultStorage ephemeral dir in Host B
        setSessionPersistenceDisabled(true)
        const trDirB = getToolResultsDir()

        // worktreeGitIsolation host B override
        registerWorktreeSessionProvider(() => ({
          worktreePath: '/wt-host-b',
          originalCwd: dirB,
        }))

        const seedDirB = seedGitS({ CLAUDE_CODE_TMPDIR: tmpRootB })

        await tick()
        const result = {
          matOk: matB.ok,
          syncerBeforeB,
          hasActiveSyncerB: getActiveSyncerForTest() === syncerB,
          jfaReaderB: getJFaAppStateReader(),
          todosB: resolveSessionTodos(),
          peekSnapBeforeGetB: peekPreSettingsEnvSnapshot(),
          seedDirB,
          trDirB,
          wtCtxB: getWorktreeGitIsolationContext(dirB),
        }
        stopActiveSyncerForTest()
        await cleanupEphemeralToolResultsDirs()
        return result
      }),
    ])

    expect(resA.matOk).toBe(true)
    expect(resA.hasActiveSyncer).toBe(true)
    expect(resA.todosA).toHaveLength(1)
    expect(resA.todosA?.[0]?.content).toBe('todo-a')
    expect(resA.jfaSet).toBe(true)
    expect(resA.shouldSumImmediately).toBe(false)
    expect(resA.mbResultA).toBe('locked-a')
    expect(resA.hasSnapA).toBe(true)
    expect(resA.seedDirA).toBe(join(tmpRootA, 'claude'))
    expect(resA.cloudA.sessions).toEqual([])
    expect(resA.wtCtxA?.worktreePath).toBe('/wt-host-a')
    expect(resA.gitDirA).toBeNull()

    expect(resB.matOk).toBe(true)
    expect(resB.syncerBeforeB).toBeNull()
    expect(resB.hasActiveSyncerB).toBe(true)
    expect(resB.jfaReaderB).toBeNull()
    expect(resB.todosB).toBeNull()
    expect(resB.peekSnapBeforeGetB).toBeUndefined()
    expect(resB.seedDirB).toBe(join(tmpRootB, 'claude'))
    expect(resB.trDirB).not.toBe(resA.trDirA)
    expect(resB.wtCtxB?.worktreePath).toBe('/wt-host-b')
  })
})
