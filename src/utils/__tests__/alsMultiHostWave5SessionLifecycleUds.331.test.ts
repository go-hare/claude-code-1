/**
 * Official Claude Code 2.1.331 Wave 5 multi-host ALS / HostSlot / RootSessionSlot
 * isolation tests covering all 14 Session Lifecycle, EnvVars, Activity, Paths,
 * FileHistory & UDS Companion modules:
 *  1. `sessionEnvVars.ts` (RootSessionSlot)
 *  2. `sessionState.ts` (HostSlot)
 *  3. `sessionActivity.ts` (HostSlot + WeakRef session re-entry)
 *  4. `sessionStart.ts` (RootSessionSlot)
 *  5. `sessionPaths.ts` (HostSlot + getProjectDir.cache getter/setter proxy)
 *  6. `sessionNameUniqueness.ts` (HostSlot Proxy + SurfaceCapabilities + recheck)
 *  7. `fileHistory.ts` (HostSlot inFlightBackupCopiesBySession)
 *  8. `activityManager.ts` (HostSlot + activityManager Proxy)
 *  9. `concurrentSessions.ts` (HostSlot)
 * 10. `peerAdmission.ts` (HostSlot)
 * 11. `peerReceipts.ts` (HostSlot)
 * 12. `crossSessionInbound.ts` (RootSessionSlot)
 * 13. `udsOutboundPacer.ts` (RootSessionSlot)
 * 14. `udsMessaging.ts` (Wave 4 Bug #6: dead sessionRef cleanup + env ownership/restore)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'fs'
import { join } from 'path'
import { getSessionId, resetStateForTests } from '../../bootstrap/state.js'
import { asAgentId } from '../../types/ids.js'
import { ActivityManager, activityManager } from '../activityManager.js'
import { runCleanupFunctions } from '../cleanupRegistry.js'
import {
  __resetRegisteredSessionNameForTests,
  _resetRegistrySweepPermittedForTests,
  getFormerSessionNames,
  getHeldSessionNames,
  getRegisteredSessionName,
  isRegistrySweepPermitted,
  registerSession,
  setRegisteredName,
  updateSessionActivity,
} from '../concurrentSessions.js'
import {
  clearPeerInboundHoldBuffer,
  clearPeerInboundModeGetter,
  gatePeerInboundMessage,
  getCrossSessionRelayCounters,
  getCrossSessionSendLimiter,
  getHeldPeerInboundMessages,
  getPeerInboundSelfMode,
  personWrote,
  releaseHeldPeerInboundMessages,
  resetCrossSessionRateLimitStateForTests,
  setPeerInboundHoldListeners,
  setPeerInboundModeGetter,
} from '../crossSessionInbound.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  _getInFlightFileHistoryCopiesForTests,
  awaitInFlightFileHistoryCopy,
} from '../fileHistory.js'
import {
  getDesktopForwardGuard,
  getOwnHopTokens,
  getOwnUdsHopToken,
  getPeerAdmissionGuard,
  hashAddressToHopToken,
  resetDesktopForwardGuardForTests,
  resetPeerAdmissionGuardForTests,
  setOwnBridgeHopAddressResolver,
  setOwnUdsHopAddress,
} from '../peerAdmission.js'
import {
  handlePeerMessageStatusFrame,
  matchOutstandingSend,
  noteOutstandingSend,
  resetPeerReceiptsForTests,
  sendPeerReceipt,
  setOnPeerMessageStatus,
  setSendPeerReceipt,
} from '../peerReceipts.js'
import {
  getMainLoopRefcount,
  getSessionActivityRefcountForTests,
  isSessionActivityReasonActive,
  isSessionActivityTrackingActive,
  notifyDropNestedBlockedChain,
  registerSessionActivityCallback,
  resetSessionActivityForTests,
  sendSessionActivitySignal,
  setDropNestedBlockedChainListener,
  setMainLoopBecameIdleListener,
  setMainLoopRefcountListener,
  startSessionActivity,
  stopSessionActivity,
  unregisterSessionActivityCallback,
} from '../sessionActivity.js'
import {
  getSessionAlsStore,
  runWithNewHostSession,
  runWithSession,
} from '../sessionContextAls.js'
import {
  clearSessionEnvVars,
  deleteSessionEnvVar,
  getSessionEnvVars,
  setSessionEnvVar,
} from '../sessionEnvVars.js'
import { getBootstrapSessionHost } from '../sessionHost.js'
import {
  getSurfaceCapabilities,
  getSurfaceRemoteHandle,
  noteSessionNameCorrespondent,
  replaceSurfaceCapabilities,
  resetSurfaceCapabilitiesForTests,
  sessionNameState,
} from '../sessionNameUniqueness.js'
import {
  clearAgentTranscriptSubdir,
  getAgentTranscriptPath,
  getProjectDir,
  setAgentTranscriptSubdir,
} from '../sessionPaths.js'
import { registerSessionContextReader } from '../sessionRoot.js'
import {
  _seedPendingSessionStartForTests,
  resetSessionStartCoverageForTesting,
  takeInitialUserMessage,
  takeSessionStartTitle,
} from '../sessionStart.js'
import {
  enableWorkerPermissionModeRecord,
  getSessionMetadataSnapshot,
  getSessionState,
  isWaitingOnUser,
  isWorkerPermissionModeRecordEnabled,
  notifyAutomationStateChanged,
  notifyInternalMetadataChanged,
  notifyNestedPromptBlocking,
  notifyPermissionModeChanged,
  notifySessionMetadataChanged,
  notifySessionStateChanged,
  notifyUltracodeActive,
  resetSessionStateForTests,
  resetUltracodeActiveForTesting,
  setInternalMetadataChangedListener,
  setMainLoopRefcount,
  setPermissionModeChangedListener,
  setSessionMetadataChangedListener,
  setSessionStateChangedListener,
  setWaitingOnUserChangedListener,
  ultracodeActivePatch,
} from '../sessionState.js'
import {
  acceptNotifyWhenIdle,
  resetUdsIdleNotifyForTests,
  setPeerIdleNoticeSender,
} from '../udsIdleNotify.js'
import {
  _runUdsDeadSessionCleanupForTests,
  drainInbox,
  formatUdsAddress,
  getUdsMessagingSocketPath,
  sendUdsMessage,
  startUdsMessaging,
  stopUdsMessaging,
} from '../udsMessaging.js'
import {
  getOutboundPacer,
  resetOutboundPacerForTests,
} from '../udsOutboundPacer.js'

const tempDirs: string[] = []
const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_REMOTE_SEND_KEEPALIVES',
  'CLAUDE_CODE_SESSION_KIND',
  'CLAUDE_BG_SOURCE',
  'CLAUDE_JOB_DIR',
]

function makeShortTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join('/tmp', prefix)))
  tempDirs.push(dir)
  return dir
}

function createBarrier(count: number): () => Promise<void> {
  let arrived = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  return async () => {
    arrived++
    if (arrived >= count) {
      release()
    }
    await gate
  }
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
  }
  const configDir = makeShortTempDir('w5-cfg-')
  process.env.CLAUDE_CONFIG_DIR = configDir
  getClaudeConfigHomeDir.cache?.clear?.()
  registerSessionContextReader(getSessionAlsStore)
  resetStateForTests()
})

afterEach(async () => {
  await stopUdsMessaging()
  resetUdsIdleNotifyForTests()
  resetPeerReceiptsForTests()
  resetPeerAdmissionGuardForTests()
  resetDesktopForwardGuardForTests()
  setOwnUdsHopAddress(undefined)
  setOwnBridgeHopAddressResolver(undefined)
  clearPeerInboundModeGetter()
  clearPeerInboundHoldBuffer()
  resetCrossSessionRateLimitStateForTests()
  resetOutboundPacerForTests()
  resetSessionStateForTests()
  resetUltracodeActiveForTesting()
  resetSessionActivityForTests()
  clearSessionEnvVars()
  ActivityManager.resetInstance()
  sessionNameState.reset()
  resetSurfaceCapabilitiesForTests()
  __resetRegisteredSessionNameForTests()
  _resetRegistrySweepPermittedForTests()
  resetSessionStartCoverageForTesting()
  getProjectDir.cache.clear()
  registerSessionContextReader(getSessionAlsStore)
  resetStateForTests()

  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
  getClaudeConfigHomeDir.cache?.clear?.()

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 5 multi-host ALS isolation: Session Lifecycle, EnvVars, Activity, Paths & FileHistory', () => {
  test('1. sessionEnvVars isolates /env variables per RootSessionSlot and shares across withProject forks', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    await Promise.all([
      runWithNewHostSession({ id: 'env-host-a' }, async sessionA => {
        setSessionEnvVar('SHARED_KEY', 'from-a')
        setSessionEnvVar('ONLY_A', 'alpha')
        await sync1()

        expect(getSessionEnvVars().get('SHARED_KEY')).toBe('from-a')
        expect(getSessionEnvVars().get('ONLY_A')).toBe('alpha')
        expect(getSessionEnvVars().has('ONLY_B')).toBe(false)

        // Fork sharing sessionA.root sees the same RootSessionSlot map
        const forkA = sessionA.withProject({ cwd: '/tmp/fork-a' })
        runWithSession(forkA, () => {
          expect(getSessionEnvVars().get('SHARED_KEY')).toBe('from-a')
          setSessionEnvVar('FROM_FORK_A', '1')
        })
        expect(getSessionEnvVars().get('FROM_FORK_A')).toBe('1')

        await sync2()
        // Host B cleared its own map — Host A must be completely untouched
        expect(getSessionEnvVars().get('SHARED_KEY')).toBe('from-a')
        expect(getSessionEnvVars().get('ONLY_A')).toBe('alpha')
      }),
      runWithNewHostSession({ id: 'env-host-b' }, async () => {
        setSessionEnvVar('SHARED_KEY', 'from-b')
        setSessionEnvVar('ONLY_B', 'beta')
        await sync1()

        expect(getSessionEnvVars().get('SHARED_KEY')).toBe('from-b')
        expect(getSessionEnvVars().has('ONLY_A')).toBe(false)
        expect(getSessionEnvVars().has('FROM_FORK_A')).toBe(false)

        deleteSessionEnvVar('SHARED_KEY')
        clearSessionEnvVars()
        expect(getSessionEnvVars().size).toBe(0)
        await sync2()
      }),
    ])
    expect(getSessionEnvVars().size).toBe(0)
  })

  test('2. sessionState isolates all listeners, state, metadata, nestedChainIdleTracker, workerPermissionModeRecord, and ultracodeActive per HostSlot', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    const eventsA: string[] = []
    const eventsB: string[] = []

    await Promise.all([
      runWithNewHostSession({ id: 'state-host-a' }, async () => {
        setSessionStateChangedListener(s => eventsA.push(`state:${s}`))
        setSessionMetadataChangedListener(m =>
          eventsA.push(`meta:${Object.keys(m).sort().join(',')}`),
        )
        setPermissionModeChangedListener(m => eventsA.push(`perm:${m}`))
        setWaitingOnUserChangedListener(w => eventsA.push(`wait:${w}`))
        setInternalMetadataChangedListener(m =>
          eventsA.push(`internal:${String(m.k)}`),
        )
        enableWorkerPermissionModeRecord()
        setMainLoopRefcount(1)
        notifyNestedPromptBlocking('agent-a')
        notifySessionStateChanged('requires_action', {
          tool_name: 'Bash',
          action_description: 'Run host A cmd',
          tool_use_id: 'tu-a',
          request_id: 'req-a',
        })
        notifyAutomationStateChanged({
          enabled: true,
          phase: 'standby',
          next_tick_at: 1234,
          sleep_until: null,
        })
        notifyPermissionModeChanged('acceptEdits')
        notifyInternalMetadataChanged({ k: 'a' })
        notifyUltracodeActive(true)
        await sync1()

        expect(getSessionState()).toBe('requires_action')
        expect(isWaitingOnUser()).toBe(true)
        expect(isWorkerPermissionModeRecordEnabled()).toBe(true)
        expect(getSessionMetadataSnapshot().pending_action?.request_id).toBe(
          'req-a',
        )
        expect(getSessionMetadataSnapshot().automation_state?.phase).toBe(
          'standby',
        )
        expect(ultracodeActivePatch(true)).toEqual({})

        await sync2()
        // Host B reset itself — Host A must stay intact
        expect(getSessionState()).toBe('requires_action')
        expect(isWaitingOnUser()).toBe(true)
        expect(isWorkerPermissionModeRecordEnabled()).toBe(true)
        expect(eventsA.some(e => e.includes('internal:b'))).toBe(false)
        expect(eventsA.some(e => e.includes('perm:plan'))).toBe(false)
      }),
      runWithNewHostSession({ id: 'state-host-b' }, async () => {
        setSessionStateChangedListener(s => eventsB.push(`state:${s}`))
        setPermissionModeChangedListener(m => eventsB.push(`perm:${m}`))
        setInternalMetadataChangedListener(m =>
          eventsB.push(`internal:${String(m.k)}`),
        )
        await sync1()

        expect(getSessionState()).toBe('idle')
        expect(isWaitingOnUser()).toBe(false)
        expect(isWorkerPermissionModeRecordEnabled()).toBe(false)
        expect(getSessionMetadataSnapshot().pending_action).toBeUndefined()
        expect(ultracodeActivePatch(true)).toEqual({
          is_ultracode_active: true,
        })

        notifySessionStateChanged('running')
        notifyPermissionModeChanged('plan')
        notifyInternalMetadataChanged({ k: 'b' })
        notifySessionMetadataChanged({ model: 'host-b-model' })

        resetSessionStateForTests()
        resetUltracodeActiveForTesting()
        expect(getSessionState()).toBe('idle')
        await sync2()
      }),
    ])

    expect(eventsB).toContain('state:running')
    expect(eventsB).toContain('perm:plan')
    expect(eventsB).toContain('internal:b')
    expect(eventsB.some(e => e.includes('internal:a'))).toBe(false)
  })

  test('3. sessionActivity isolates callbacks, refcounts, activeReasons, idle/drop listeners, and cleanup per HostSlot', async () => {
    process.env.CLAUDE_CODE_REMOTE_SEND_KEEPALIVES = '1'
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    const signalsA: string[] = []
    const signalsB: string[] = []
    const idleA: string[] = []
    const droppedA: string[] = []
    const droppedB: string[] = []

    await Promise.all([
      runWithNewHostSession({ id: 'act-host-a' }, async () => {
        registerSessionActivityCallback(() => signalsA.push(getSessionId()))
        setMainLoopRefcountListener(n => signalsA.push(`ref:${n}`))
        setMainLoopBecameIdleListener(() => idleA.push(getSessionId()))
        setDropNestedBlockedChainListener(id => droppedA.push(id))

        startSessionActivity('api_call')
        await sync1()

        expect(isSessionActivityTrackingActive()).toBe(true)
        expect(getSessionActivityRefcountForTests()).toBe(1)
        expect(getMainLoopRefcount()).toBe(1)
        expect(isSessionActivityReasonActive('api_call')).toBe(true)
        expect(isSessionActivityReasonActive('tool_exec')).toBe(false)

        sendSessionActivitySignal()
        notifyDropNestedBlockedChain('nested-a')
        await sync2()

        // Host B unregistered and reset — Host A must still fire its own idle listener
        expect(isSessionActivityTrackingActive()).toBe(true)
        expect(getMainLoopRefcount()).toBe(1)
        stopSessionActivity('api_call')
        expect(idleA).toEqual(['act-host-a'])
        unregisterSessionActivityCallback()
      }),
      runWithNewHostSession({ id: 'act-host-b' }, async () => {
        registerSessionActivityCallback(() => signalsB.push(getSessionId()))
        setDropNestedBlockedChainListener(id => droppedB.push(id))
        startSessionActivity('tool_exec')
        await sync1()

        expect(getSessionActivityRefcountForTests()).toBe(1)
        expect(isSessionActivityReasonActive('tool_exec')).toBe(true)
        expect(isSessionActivityReasonActive('api_call')).toBe(false)

        sendSessionActivitySignal()
        notifyDropNestedBlockedChain('nested-b')
        stopSessionActivity('tool_exec')
        unregisterSessionActivityCallback()
        resetSessionActivityForTests()
        await sync2()
      }),
    ])

    expect(signalsA).toContain('act-host-a')
    expect(signalsA).not.toContain('act-host-b')
    expect(signalsB).toEqual(['act-host-b'])
    expect(droppedA).toEqual(['nested-a'])
    expect(droppedB).toEqual(['nested-b'])
  })

  test('4. sessionStart isolates pendingInitialUserMessage and pendingSessionTitle per RootSessionSlot', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    await Promise.all([
      runWithNewHostSession({ id: 'start-host-a' }, async sessionA => {
        _seedPendingSessionStartForTests({
          initialUserMessage: 'hello-from-a',
          sessionTitle: 'Title A',
        })
        await sync1()
        // Host B takes its own values — Host A's pending values must remain intact
        await sync2()
        const forkA = sessionA.withProject({ cwd: '/tmp/start-fork-a' })
        const takenFromFork = runWithSession(forkA, () =>
          takeInitialUserMessage(),
        )
        expect(takenFromFork).toBe('hello-from-a')
        expect(takeInitialUserMessage()).toBeUndefined()
        expect(takeSessionStartTitle()).toBe('Title A')
        expect(takeSessionStartTitle()).toBeUndefined()
      }),
      runWithNewHostSession({ id: 'start-host-b' }, async () => {
        _seedPendingSessionStartForTests({
          initialUserMessage: 'hello-from-b',
          sessionTitle: 'Title B',
        })
        await sync1()
        expect(takeInitialUserMessage()).toBe('hello-from-b')
        expect(takeSessionStartTitle()).toBe('Title B')
        expect(takeInitialUserMessage()).toBeUndefined()
        await sync2()
      }),
    ])
  })

  test('5. sessionPaths isolates agentTranscriptSubdirs and getProjectDir.cache getter/setter per HostSlot', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    let cacheA: Map<string, string> | undefined
    let cacheB: Map<string, string> | undefined

    await Promise.all([
      runWithNewHostSession(
        { id: 'paths-host-a', originalCwd: '/tmp/proj-a' },
        async () => {
          setAgentTranscriptSubdir('shared-agent', 'workflows/run-a')
          const dirA = getProjectDir('/tmp/shared-cwd')
          cacheA = getProjectDir.cache
          expect(cacheA.size).toBeGreaterThan(0)
          await sync1()

          expect(getAgentTranscriptPath(asAgentId('shared-agent'))).toContain(
            join('subagents', 'workflows/run-a', 'agent-shared-agent.jsonl'),
          )
          await sync2()

          // Host B cleared & replaced its cache and deleted its subdir — Host A unaffected
          expect(getProjectDir.cache).toBe(cacheA)
          expect(getProjectDir('/tmp/shared-cwd')).toBe(dirA)
          expect(getAgentTranscriptPath(asAgentId('shared-agent'))).toContain(
            join('subagents', 'workflows/run-a', 'agent-shared-agent.jsonl'),
          )
        },
      ),
      runWithNewHostSession(
        { id: 'paths-host-b', originalCwd: '/tmp/proj-b' },
        async () => {
          setAgentTranscriptSubdir('shared-agent', 'workflows/run-b')
          getProjectDir('/tmp/shared-cwd')
          cacheB = getProjectDir.cache
          await sync1()

          expect(getAgentTranscriptPath(asAgentId('shared-agent'))).toContain(
            join('subagents', 'workflows/run-b', 'agent-shared-agent.jsonl'),
          )
          clearAgentTranscriptSubdir('shared-agent')
          const customCache = new Map<string, string>([
            ['/tmp/shared-cwd\0', '/custom/host-b-dir'],
          ])
          getProjectDir.cache = customCache
          expect(getProjectDir.cache).toBe(customCache)
          await sync2()
        },
      ),
    ])

    expect(cacheA).toBeDefined()
    expect(cacheB).toBeDefined()
    expect(cacheA).not.toBe(cacheB)
  })

  test('6. sessionNameUniqueness isolates sessionNameState Proxy and SurfaceCapabilities per HostSlot', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    await Promise.all([
      runWithNewHostSession({ id: 'name-host-a' }, async () => {
        sessionNameState.userTypedName = 'alpha-name'
        sessionNameState.hasAdopter = true
        sessionNameState.lastYield = { base: 'alpha', name: 'alpha-blue-fox' }
        noteSessionNameCorrespondent('uds:/tmp/peer-a.sock', 111)
        replaceSurfaceCapabilities({
          renderTarget: 'ink',
          workspace: 'remote',
          canDrive: false,
          transcriptSource: 'local-jsonl',
          remote: {
            kind: 'ccr',
            isRemoteMode: true,
            sessionId: 'session_host_a',
          },
        })
        await sync1()

        expect(sessionNameState.userTypedName).toBe('alpha-name')
        expect(
          sessionNameState.correspondents.has('uds:/tmp/peer-a.sock'),
        ).toBe(true)
        expect(
          sessionNameState.correspondents.has('uds:/tmp/peer-b.sock'),
        ).toBe(false)
        expect(getSurfaceCapabilities().workspace).toBe('remote')
        expect(getSurfaceRemoteHandle()?.sessionId).toBe('session_host_a')

        await sync2()
        // Host B reset itself — Host A unaffected
        expect(sessionNameState.userTypedName).toBe('alpha-name')
        expect(sessionNameState.hasAdopter).toBe(true)
        expect(getSurfaceRemoteHandle()?.sessionId).toBe('session_host_a')
      }),
      runWithNewHostSession({ id: 'name-host-b' }, async () => {
        sessionNameState.userTypedName = 'beta-name'
        noteSessionNameCorrespondent('uds:/tmp/peer-b.sock', 222)
        await sync1()

        expect(sessionNameState.userTypedName).toBe('beta-name')
        expect(sessionNameState.hasAdopter).toBe(false)
        expect(sessionNameState.lastYield).toBeUndefined()
        expect(
          sessionNameState.correspondents.has('uds:/tmp/peer-a.sock'),
        ).toBe(false)
        expect(getSurfaceCapabilities().workspace).toBe('local')
        expect(getSurfaceRemoteHandle()).toBeNull()

        sessionNameState.reset()
        resetSurfaceCapabilitiesForTests()
        await sync2()
      }),
    ])
  })

  test('7. fileHistory isolates inFlightBackupCopiesBySession per HostSlot so Host B does not block on Host A', async () => {
    const sharedSessionId = 'same-target-session-id'
    let releaseHostACopy!: () => void
    const hostACopyDeferred = new Promise<void>(resolve => {
      releaseHostACopy = resolve
    })

    const sync1 = createBarrier(2)
    let hostBResolvedBeforeHostAReleased = false

    await Promise.all([
      runWithNewHostSession({ id: 'fh-host-a' }, async () => {
        const mapA = _getInFlightFileHistoryCopiesForTests()
        mapA.set(sharedSessionId, hostACopyDeferred)
        await sync1()

        let hostADone = false
        const waitA = awaitInFlightFileHistoryCopy(sharedSessionId).then(() => {
          hostADone = true
        })
        await Promise.resolve()
        expect(hostADone).toBe(false)
        releaseHostACopy()
        await waitA
        expect(hostADone).toBe(true)
        mapA.delete(sharedSessionId)
      }),
      runWithNewHostSession({ id: 'fh-host-b' }, async () => {
        await sync1()
        // Host A's copy for the same sessionId is still pending — Host B must NOT wait on it!
        await awaitInFlightFileHistoryCopy(sharedSessionId)
        hostBResolvedBeforeHostAReleased = true
      }),
    ])

    expect(hostBResolvedBeforeHostAReleased).toBe(true)
  })

  test('8. activityManager isolates ActivityManager.getInstance() and activityManager Proxy per HostSlot', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    let instA: ActivityManager | undefined
    let instB: ActivityManager | undefined

    await Promise.all([
      runWithNewHostSession({ id: 'am-host-a' }, async () => {
        instA = ActivityManager.createInstance({ getNow: () => 10_000 })
        activityManager.startCLIActivity('op-a')
        await sync1()

        expect(ActivityManager.getInstance()).toBe(instA)
        expect(activityManager.getActivityStates().isCLIActive).toBe(true)
        expect(activityManager.getActivityStates().activeOperationCount).toBe(1)

        await sync2()
        // Host B called ActivityManager.resetInstance() — Host A unaffected
        expect(ActivityManager.getInstance()).toBe(instA)
        expect(activityManager.getActivityStates().isCLIActive).toBe(true)
        activityManager.endCLIActivity('op-a')
      }),
      runWithNewHostSession({ id: 'am-host-b' }, async () => {
        instB = ActivityManager.createInstance({ getNow: () => 20_000 })
        await sync1()

        expect(activityManager.getActivityStates().isCLIActive).toBe(false)
        expect(activityManager.getActivityStates().activeOperationCount).toBe(0)
        ActivityManager.resetInstance()
        await sync2()
      }),
    ])

    expect(instA).toBeDefined()
    expect(instB).toBeDefined()
    expect(instA).not.toBe(instB)
  })

  test('9. concurrentSessions isolates registeredName, formerNames, heldNames, registrySweepPermitted, and sessionBornSpare per HostSlot', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    let sweepPromiseA: Promise<boolean> | undefined
    let sweepPromiseB: Promise<boolean> | undefined

    await Promise.all([
      runWithNewHostSession(
        { id: 'cs-host-a', isInteractive: true },
        async () => {
          setRegisteredName('worker-alpha', 'user')
          setRegisteredName('worker-alpha-2', 'user')
          sweepPromiseA = isRegistrySweepPermitted()
          await sync1()

          expect(getRegisteredSessionName()?.name).toBe('worker-alpha-2')
          expect(getHeldSessionNames().has('worker-alpha')).toBe(true)
          expect(getHeldSessionNames().has('worker-beta')).toBe(false)
          expect(isRegistrySweepPermitted()).toBe(sweepPromiseA)

          await sync2()
          // Host B reset its registered names and sweep cache — Host A unaffected
          expect(getRegisteredSessionName()?.name).toBe('worker-alpha-2')
          expect(getFormerSessionNames().length).toBe(0)
          expect(isRegistrySweepPermitted()).toBe(sweepPromiseA)
        },
      ),
      runWithNewHostSession(
        { id: 'cs-host-b', isInteractive: false },
        async () => {
          setRegisteredName('worker-beta', 'user')
          sweepPromiseB = isRegistrySweepPermitted()
          await sync1()

          expect(getRegisteredSessionName()?.name).toBe('worker-beta')
          expect(getHeldSessionNames().size).toBe(0)

          __resetRegisteredSessionNameForTests()
          _resetRegistrySweepPermittedForTests()
          expect(getRegisteredSessionName()).toBeUndefined()
          await sync2()
        },
      ),
    ])

    expect(sweepPromiseA).toBeDefined()
    expect(sweepPromiseB).toBeDefined()
    expect(sweepPromiseA).not.toBe(sweepPromiseB)

    // Also exercise registerSession + sessionBornSpare isolation between two hosts
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_BG_SOURCE = 'spare'
    await runWithNewHostSession({ id: 'spare-host-a' }, async () => {
      expect(await registerSession()).toBe(true)
      await updateSessionActivity({ status: 'busy' })
    })
    delete process.env.CLAUDE_BG_SOURCE
    await runWithNewHostSession({ id: 'spare-host-b' }, async () => {
      expect(await registerSession()).toBe(true)
      await updateSessionActivity({ status: 'idle' })
    })
  })
})

describe('Wave 5 multi-host ALS isolation: UDS Companion Modules & Wave 4 Bug #6 Fixes', () => {
  test('10. peerAdmission isolates sharedGuard, sharedDesktopForwardGuard, ownUdsHopToken, and ownBridgeHopResolver per HostSlot', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    let guardA: ReturnType<typeof getPeerAdmissionGuard> | undefined
    let guardB: ReturnType<typeof getPeerAdmissionGuard> | undefined
    let dfA: ReturnType<typeof getDesktopForwardGuard> | undefined
    let dfB: ReturnType<typeof getDesktopForwardGuard> | undefined

    await Promise.all([
      runWithNewHostSession({ id: 'pa-host-a' }, async () => {
        guardA = getPeerAdmissionGuard()
        dfA = getDesktopForwardGuard()
        setOwnUdsHopAddress('uds:/tmp/host-a.sock')
        setOwnBridgeHopAddressResolver(() => 'bridge:session_a')

        expect(
          guardA.admit({
            senderKey: 'peer-1',
            body: 'dup-body',
            ownTokens: getOwnHopTokens(),
          }),
        ).toEqual({ admitted: true })
        // Immediate duplicate in Host A is rejected
        expect(
          guardA.admit({
            senderKey: 'peer-1',
            body: 'dup-body',
            ownTokens: getOwnHopTokens(),
          }),
        ).toEqual({ admitted: false, reason: 'duplicate' })

        dfA.checkForward(1)
        dfA.checkForward(1)
        expect(dfA.getForwardsSincePrompt()).toBe(2)
        await sync1()

        expect(getOwnUdsHopToken()).toBe(
          hashAddressToHopToken('uds:/tmp/host-a.sock'),
        )
        expect(
          getOwnHopTokens().has(hashAddressToHopToken('bridge:session_a')),
        ).toBe(true)
        expect(
          getOwnHopTokens().has(hashAddressToHopToken('bridge:session_b')),
        ).toBe(false)

        await sync2()
        // Host B cleared its own guards and hop addresses — Host A unaffected
        expect(getPeerAdmissionGuard()).toBe(guardA)
        expect(getDesktopForwardGuard().getForwardsSincePrompt()).toBe(2)
        expect(getOwnUdsHopToken()).toBe(
          hashAddressToHopToken('uds:/tmp/host-a.sock'),
        )
      }),
      runWithNewHostSession({ id: 'pa-host-b' }, async () => {
        guardB = getPeerAdmissionGuard()
        dfB = getDesktopForwardGuard()
        setOwnUdsHopAddress('uds:/tmp/host-b.sock')
        setOwnBridgeHopAddressResolver(() => 'bridge:session_b')
        await sync1()

        // Same senderKey + body is NOT duplicate in Host B
        expect(
          guardB.admit({
            senderKey: 'peer-1',
            body: 'dup-body',
            ownTokens: getOwnHopTokens(),
          }),
        ).toEqual({ admitted: true })
        expect(dfB.getForwardsSincePrompt()).toBe(0)
        expect(getOwnUdsHopToken()).toBe(
          hashAddressToHopToken('uds:/tmp/host-b.sock'),
        )

        resetPeerAdmissionGuardForTests()
        resetDesktopForwardGuardForTests()
        setOwnUdsHopAddress(undefined)
        setOwnBridgeHopAddressResolver(undefined)
        await sync2()
      }),
    ])

    expect(guardA).not.toBe(guardB)
    expect(dfA).not.toBe(dfB)
  })

  test('11. peerReceipts isolates sendPeerReceiptImpl, onPeerMessageStatus, outstandingSends, and awaitingTerminal per HostSlot', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    const sentA: string[] = []
    const sentB: string[] = []
    const statusesA: string[] = []
    const statusesB: string[] = []

    const msgId = '11111111-1111-4111-8111-111111111111'

    await Promise.all([
      runWithNewHostSession({ id: 'pr-host-a' }, async () => {
        setSendPeerReceipt((_msg, status) => sentA.push(`a:${status}`))
        setOnPeerMessageStatus((status, dest) =>
          statusesA.push(`${status}:${dest}`),
        )
        noteOutstandingSend(msgId, 'uds:/tmp/target-a.sock')
        await sync1()

        // Host B resets its receipts — Host A's sender & outstanding send remain intact
        await sync2()
        sendPeerReceipt({}, 'held')
        expect(
          handlePeerMessageStatusFrame({
            action: 'peer_message_status',
            status: 'delivered',
            orig_msg_id: msgId,
          }),
        ).toBe(true)
        expect(sentA).toEqual(['a:held'])
        expect(statusesA).toEqual(['delivered:uds:/tmp/target-a.sock'])
      }),
      runWithNewHostSession({ id: 'pr-host-b' }, async () => {
        setSendPeerReceipt((_msg, status) => sentB.push(`b:${status}`))
        setOnPeerMessageStatus((status, dest) =>
          statusesB.push(`${status}:${dest}`),
        )
        await sync1()

        // Host A's msgId is NOT visible in Host B
        expect(matchOutstandingSend(msgId, 'delivered')).toBeUndefined()
        sendPeerReceipt({}, 'refused')
        resetPeerReceiptsForTests()
        await sync2()
      }),
    ])

    expect(sentB).toEqual(['b:refused'])
    expect(statusesB).toEqual([])
  })

  test('12. crossSessionInbound isolates modeGetter, holdBuffer, holdListeners, sessionSendLimiter, and relay counters per RootSessionSlot', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    const releasedA: string[] = []
    const releasedB: string[] = []

    await Promise.all([
      runWithNewHostSession({ id: 'csi-host-a' }, async sessionA => {
        setPeerInboundModeGetter(() => ({ mode: 'bypassPermissions' }))
        setPeerInboundHoldListeners<{ id: string }>({
          onReleased: entries => {
            for (const e of entries) releasedA.push(e.message.id)
          },
        })
        expect(
          gatePeerInboundMessage(
            { id: 'msg-a1' },
            { explicit: undefined, honorFromMode: false },
          ),
        ).toBe('held')
        getCrossSessionSendLimiter().set(5, () => {})
        getCrossSessionSendLimiter().take()
        getCrossSessionRelayCounters().localSends = 3
        await sync1()

        expect(getPeerInboundSelfMode()?.mode).toBe('bypassPermissions')
        expect(getHeldPeerInboundMessages().length).toBe(1)
        expect(getCrossSessionSendLimiter().sinceAPersonWrote()).toBe(1)
        expect(getCrossSessionRelayCounters().localSends).toBe(3)

        // Fork shares the same RootSessionSlot holdBuffer & limiter
        const forkA = sessionA.withProject({ cwd: '/tmp/csi-fork-a' })
        runWithSession(forkA, () => {
          expect(getHeldPeerInboundMessages().length).toBe(1)
          expect(getCrossSessionRelayCounters().localSends).toBe(3)
        })

        await sync2()
        // Host B cleared buffer & called personWrote() — Host A unaffected
        expect(getHeldPeerInboundMessages().length).toBe(1)
        expect(getCrossSessionSendLimiter().sinceAPersonWrote()).toBe(1)
        expect(getCrossSessionRelayCounters().localSends).toBe(3)

        expect(
          releaseHeldPeerInboundMessages('policy-accepts', {
            explicit: 'accept',
          }),
        ).toBe(1)
        expect(releasedA).toEqual(['msg-a1'])
      }),
      runWithNewHostSession({ id: 'csi-host-b' }, async () => {
        setPeerInboundModeGetter(() => ({ mode: 'default' }))
        setPeerInboundHoldListeners<{ id: string }>({
          onReleased: entries => {
            for (const e of entries) releasedB.push(e.message.id)
          },
        })
        await sync1()

        expect(getPeerInboundSelfMode()?.mode).toBe('default')
        expect(getHeldPeerInboundMessages().length).toBe(0)
        expect(getCrossSessionSendLimiter().sinceAPersonWrote()).toBe(0)
        expect(getCrossSessionRelayCounters().localSends).toBe(0)

        clearPeerInboundModeGetter()
        clearPeerInboundHoldBuffer()
        personWrote()
        resetCrossSessionRateLimitStateForTests()
        await sync2()
      }),
    ])

    expect(releasedB).toEqual([])
  })

  test('13. udsOutboundPacer isolates sharedPacer per RootSessionSlot and shares across withProject forks', async () => {
    const sync1 = createBarrier(2)
    const sync2 = createBarrier(2)

    let pacerA: ReturnType<typeof getOutboundPacer> | undefined
    let pacerB: ReturnType<typeof getOutboundPacer> | undefined

    await Promise.all([
      runWithNewHostSession({ id: 'pacer-host-a' }, async sessionA => {
        pacerA = getOutboundPacer()
        // Exhaust Host A's entire default burst capacity (30) for '/tmp/shared-peer.sock'
        for (let i = 0; i < 30; i++) {
          expect(pacerA.reserve('/tmp/shared-peer.sock').ok).toBe(true)
        }
        expect(pacerA.reserve('/tmp/shared-peer.sock').ok).toBe(false)
        await sync1()

        // Fork shares Host A's RootSessionSlot pacer
        const forkA = sessionA.withProject({ cwd: '/tmp/pacer-fork-a' })
        runWithSession(forkA, () => {
          expect(getOutboundPacer()).toBe(pacerA!)
          expect(getOutboundPacer().reserve('/tmp/shared-peer.sock').ok).toBe(
            false,
          )
        })

        await sync2()
        // Host B reset its pacer — Host A is still exhausted
        expect(getOutboundPacer()).toBe(pacerA!)
        expect(getOutboundPacer().reserve('/tmp/shared-peer.sock').ok).toBe(
          false,
        )
      }),
      runWithNewHostSession({ id: 'pacer-host-b' }, async () => {
        pacerB = getOutboundPacer()
        await sync1()

        // Host B has a full bucket for the exact same target socket!
        expect(pacerB.reserve('/tmp/shared-peer.sock').ok).toBe(true)
        resetOutboundPacerForTests()
        await sync2()
      }),
    ])

    expect(pacerA).not.toBe(pacerB)
  })

  test('14a. stopping Host B UDS server does NOT wipe Host A peerReceipts, sessionActivity idle listener, peerAdmission hop token, or process.env', async () => {
    const sockDirA = makeShortTempDir('w5-u-a-')
    const sockDirB = makeShortTempDir('w5-u-b-')
    const sockA = join(sockDirA, 'a.sock')
    const sockB = join(sockDirB, 'b.sock')

    let resolveAStarted!: () => void
    const aStarted = new Promise<void>(resolve => {
      resolveAStarted = resolve
    })
    let resolveBStopped!: () => void
    const bStopped = new Promise<void>(resolve => {
      resolveBStopped = resolve
    })

    const receiptsFiredA: string[] = []
    const idleNoticesFiredA: string[] = []

    await Promise.all([
      runWithNewHostSession({ id: 'uds-w5-a' }, async () => {
        await startUdsMessaging(sockA, { isExplicit: true, requireAuth: true })
        const tokenA = process.env.CLAUDE_CODE_MESSAGING_TOKEN
        expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sockA)
        expect(tokenA).toBeDefined()

        // Wrap Host A's peerReceipts & idle sender so we can observe them directly
        setSendPeerReceipt((_msg, status) => receiptsFiredA.push(status))
        setPeerIdleNoticeSender(async (replySock, payload) => {
          idleNoticesFiredA.push(`${replySock}:${payload.state}`)
        })
        acceptNotifyWhenIdle({
          from: formatUdsAddress(join(sockDirA, 'watcher.sock')),
          msgId: '22222222-2222-4222-8222-222222222222',
          ownSocketPath: sockA,
        })

        resolveAStarted()
        await bStopped

        // Host B has started AND stopped — Host A's entire UDS companion stack must remain intact!
        expect(getUdsMessagingSocketPath()).toBe(sockA)
        expect(existsSync(sockA)).toBe(true)
        expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sockA)
        expect(process.env.CLAUDE_CODE_MESSAGING_TOKEN).toBe(tokenA)
        expect(getOwnUdsHopToken()).toBe(
          hashAddressToHopToken(formatUdsAddress(sockA)),
        )

        // peerReceipts still installed for Host A
        sendPeerReceipt({}, 'held')
        expect(receiptsFiredA).toEqual(['held'])

        // sessionActivity onMainLoopBecameIdle wired by startUdsMessaging still fires for Host A
        startSessionActivity('api_call')
        stopSessionActivity('api_call')
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(idleNoticesFiredA.length).toBe(1)
        expect(idleNoticesFiredA[0]).toContain(':idle')

        await stopUdsMessaging()
      }),
      runWithNewHostSession({ id: 'uds-w5-b' }, async () => {
        await aStarted
        await startUdsMessaging(sockB, { isExplicit: true, requireAuth: true })
        // Host B must NOT overwrite Host A's process.env ownership
        expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sockA)
        expect(getUdsMessagingSocketPath()).toBe(sockB)
        expect(getOwnUdsHopToken()).toBe(
          hashAddressToHopToken(formatUdsAddress(sockB)),
        )

        await stopUdsMessaging()
        expect(getUdsMessagingSocketPath()).toBeUndefined()
        expect(getOwnUdsHopToken()).toBeUndefined()
        resolveBStopped()
      }),
    ])

    expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBeUndefined()
    expect(process.env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined()
  })

  test('14b. stopping the env-owning UDS host restores surviving host CLAUDE_CODE_MESSAGING_SOCKET and TOKEN', async () => {
    const sockDirA = makeShortTempDir('w5-env-a-')
    const sockDirB = makeShortTempDir('w5-env-b-')
    const sockA = join(sockDirA, 'a.sock')
    const sockB = join(sockDirB, 'b.sock')

    let resolveAStarted!: () => void
    const aStarted = new Promise<void>(resolve => {
      resolveAStarted = resolve
    })
    let resolveBStarted!: () => void
    const bStarted = new Promise<void>(resolve => {
      resolveBStarted = resolve
    })
    let resolveAStopped!: () => void
    const aStopped = new Promise<void>(resolve => {
      resolveAStopped = resolve
    })

    let tokenA: string | undefined

    await Promise.all([
      runWithNewHostSession({ id: 'uds-env-a' }, async () => {
        await startUdsMessaging(sockA, { isExplicit: true, requireAuth: true })
        tokenA = process.env.CLAUDE_CODE_MESSAGING_TOKEN
        expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sockA)
        resolveAStarted()

        await bStarted
        // Now stop Host A while Host B is still running!
        await stopUdsMessaging()
        expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sockB)
        expect(process.env.CLAUDE_CODE_MESSAGING_TOKEN).toBeDefined()
        expect(process.env.CLAUDE_CODE_MESSAGING_TOKEN).not.toBe(tokenA)
        resolveAStopped()
      }),
      runWithNewHostSession({ id: 'uds-env-b' }, async () => {
        await aStarted
        await startUdsMessaging(sockB, { isExplicit: true, requireAuth: true })
        expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sockA)
        resolveBStarted()

        await aStopped
        expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sockB)
        await stopUdsMessaging()
        expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBeUndefined()
        expect(process.env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined()
      }),
    ])
  })

  test('14c. dead sessionRef cleanup closes ONLY the dead host server and does NOT stop default bootstrap host UDS server', async () => {
    const sockDirDefault = makeShortTempDir('w5-def-')
    const sockDirDead = makeShortTempDir('w5-dead-')
    const sockDefault = join(sockDirDefault, 'default.sock')
    const sockDead = join(sockDirDead, 'dead.sock')

    // Start UDS server on the default bootstrap host
    await startUdsMessaging(sockDefault, {
      isExplicit: true,
      requireAuth: true,
    })
    const defaultToken = process.env.CLAUDE_CODE_MESSAGING_TOKEN
    expect(getUdsMessagingSocketPath()).toBe(sockDefault)
    expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sockDefault)
    const defaultReceipts: string[] = []
    setSendPeerReceipt((_msg, status) => defaultReceipts.push(status))

    // Start UDS server on an isolated Host B without stopping it
    let isolatedHostB: object | undefined
    await runWithNewHostSession({ id: 'uds-dead-b' }, async () => {
      isolatedHostB = getBootstrapSessionHost()
      await startUdsMessaging(sockDead, { isExplicit: true, requireAuth: true })
      expect(getUdsMessagingSocketPath()).toBe(sockDead)
      expect(existsSync(sockDead)).toBe(true)
    })

    // Simulate Host B's root Session being GC'd before shutdown cleanup runs:
    // cleanupCapturedUdsSession must close deadState directly and NEVER call
    // stopUdsMessaging() on the default bootstrap host!
    expect(isolatedHostB).toBeDefined()
    await _runUdsDeadSessionCleanupForTests(isolatedHostB!)

    // Host B's orphaned socket is cleaned up
    expect(existsSync(sockDead)).toBe(false)

    // Default bootstrap host's UDS server, socket, env, hop token, and peerReceipts are 100% intact!
    expect(getUdsMessagingSocketPath()).toBe(sockDefault)
    expect(existsSync(sockDefault)).toBe(true)
    expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sockDefault)
    expect(process.env.CLAUDE_CODE_MESSAGING_TOKEN).toBe(defaultToken)
    expect(getOwnUdsHopToken()).toBe(
      hashAddressToHopToken(formatUdsAddress(sockDefault)),
    )
    sendPeerReceipt({}, 'delivered')
    expect(defaultReceipts).toEqual(['delivered'])

    // Verify default host still accepts real UDS messages!
    await sendUdsMessage(sockDefault, { type: 'text', data: 'still-alive' })
    const drained = drainInbox()
    expect(drained.map(e => e.message.data)).toEqual(['still-alive'])
  })

  test('14d. live sessionRef registerCleanup via runCleanupFunctions inside Host B stops ONLY Host B and preserves default host', async () => {
    const sockDirDefault = makeShortTempDir('w5-cln-def-')
    const sockDirB = makeShortTempDir('w5-cln-b-')
    const sockDefault = join(sockDirDefault, 'default.sock')
    const sockB = join(sockDirB, 'b.sock')

    await startUdsMessaging(sockDefault, {
      isExplicit: true,
      requireAuth: true,
    })

    await runWithNewHostSession({ id: 'uds-cln-b' }, async () => {
      await startUdsMessaging(sockB, { isExplicit: true, requireAuth: true })
      expect(existsSync(sockB)).toBe(true)
      // Inside Host B ALS, runCleanupFunctions drains ONLY Host B's cleanup bag
      await runCleanupFunctions()
      expect(getUdsMessagingSocketPath()).toBeUndefined()
      expect(existsSync(sockB)).toBe(false)
    })

    // Default host must remain untouched and alive
    expect(getUdsMessagingSocketPath()).toBe(sockDefault)
    expect(existsSync(sockDefault)).toBe(true)
    expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sockDefault)
  })
})
