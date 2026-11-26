/**
 * Official Claude Code 2.1.331 multi-host ALS / HostSlot / RootSessionSlot
 * isolation tests covering:
 * 1. UDS messaging (`udsMessaging.ts`), UDS idle notify (`udsIdleNotify.ts`),
 *    and LAN beacon (`lanBeacon.ts`)
 * 2. Chdir guards & scoped CWD (`cdCommand.tsx`, `sessionRestore.ts`,
 *    `WorktreeExitDialog.tsx`, `worktree.ts`)
 * 3. Goal isolation (`goalIdleCheckin.ts`, `goal.ts`)
 * 4. Teammate & Swarm isolation (`teammate.ts`, `leaderPermissionBridge.ts`,
 *    `teammateModeSnapshot.ts`, `swarm/backends/registry.ts`, `inProcessRunner.ts`)
 * 5. GitDiff ALS CWD (`gitDiff.ts`) & GracefulShutdown HostSlot (`gracefulShutdown.ts`)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentDefinitionsResult } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  getOriginalCwd,
  getSessionId,
  resetStateForTests,
} from '../../bootstrap/state.js'
import { relocateSessionCwd } from '../../commands/cd/cdCommand.js'
import {
  applyGoalStateUpdateIfUnchanged,
  bumpGoalMutationEpoch,
  getGoalMutationEpoch,
} from '../../commands/goal.js'
import {
  armGoalIdleCheckin,
  cancelPendingGoalIdleCheckin,
  getPendingGoalIdleCheckin,
} from '../../services/goal/goalIdleCheckin.js'
import type { AppState } from '../../state/AppState.js'
import { getCwd, runWithCwd } from '../cwd.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getIsGit } from '../git.js'
import { fetchGitDiff, fetchGitDiffHunks } from '../gitDiff.js'
import {
  getInteractiveShutdownAbortForTests,
  getOwedSandboxCleanupPromise,
  getResumeHintLaunchFlags,
  registerInteractiveShutdownAbort,
  registerOwedSandboxCleanup,
  resetShutdownState,
  resolveOwedSandboxCleanup,
  setResumeHintLaunchFlags,
} from '../gracefulShutdown.js'
import { getLanBeacon, LanBeacon, setLanBeacon } from '../lanBeacon.js'
import {
  exitSessionContext,
  getSessionAlsStore,
  runWithNewHostSession,
  runWithSession,
} from '../sessionContextAls.js'
import { registerSessionContextReader } from '../sessionRoot.js'
import {
  exitRestoredWorktree,
  restoreAgentFromSession,
  restoreSessionStateFromLog,
  restoreWorktreeForResume,
} from '../sessionRestore.js'
import { resetDetectionCache } from '../swarm/backends/detection.js'
import {
  getInProcessBackend,
  isInProcessEnabled,
  markInProcessFallback,
  resetBackendDetection,
} from '../swarm/backends/registry.js'
import {
  captureTeammateModeSnapshot,
  clearCliTeammateModeOverride,
  getCliTeammateModeOverride,
  getTeammateModeFromSnapshot,
  setCliTeammateModeOverride,
} from '../swarm/backends/teammateModeSnapshot.js'
import {
  _sleepOrWakeForTesting,
  wakeIdleTeammate,
} from '../swarm/inProcessRunner.js'
import {
  getLeaderSetToolPermissionContext,
  getLeaderToolUseConfirmQueue,
  registerLeaderSetToolPermissionContext,
  registerLeaderToolUseConfirmQueue,
  unregisterLeaderSetToolPermissionContext,
  unregisterLeaderToolUseConfirmQueue,
} from '../swarm/leaderPermissionBridge.js'
import {
  clearDynamicTeamContext,
  getAgentId,
  getAgentName,
  getDynamicTeamContext,
  getParentSessionId,
  getTeamName,
  getTeammateColor,
  isPlanModeRequired,
  isTeammate,
  setDynamicTeamContext,
} from '../teammate.js'
import {
  acceptNotifyWhenIdle,
  correlatePeerIdleNotice,
  flushIdleSubscribers,
  hasOutstandingIdleSubscription,
  type IdleNoticeForModel,
  resetUdsIdleNotifyForTests,
  seedOutstandingIdleSubscriptionForTests,
  setIdleNoticeHandler,
  setPeerIdleNoticeSender,
} from '../udsIdleNotify.js'
import {
  drainInbox,
  getUdsMessagingSocketPath,
  sendUdsMessage,
  setOnEnqueue,
  startUdsMessaging,
  stopUdsMessaging,
} from '../udsMessaging.js'
import {
  cleanupWorktree,
  getCurrentWorktreeSession,
  keepWorktree,
  restoreWorktreeSession,
} from '../worktree.js'

const tempDirs: string[] = []
const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'TMUX',
  'TERM_PROGRAM',
  'WT_SESSION',
]

function makeShortTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join('/tmp', prefix)))
  tempDirs.push(dir)
  return dir
}

function initGitRepo(dir: string, label: string): string {
  mkdirSync(dir, { recursive: true })
  const real = realpathSync(dir)
  execFileSync('git', ['init', '-b', 'main'], { cwd: real, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', `${label}@example.test`], {
    cwd: real,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', `Test ${label}`], {
    cwd: real,
    stdio: 'ignore',
  })
  writeFileSync(join(real, 'README.md'), `# ${label}\n`, 'utf-8')
  execFileSync('git', ['add', 'README.md'], { cwd: real, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', `init ${label}`], {
    cwd: real,
    stdio: 'ignore',
  })
  return real
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
  }
  const configDir = makeShortTempDir('als-u6-cfg-')
  process.env.CLAUDE_CONFIG_DIR = configDir
  getClaudeConfigHomeDir.cache?.clear?.()
  registerSessionContextReader(getSessionAlsStore)
  resetStateForTests()
  getIsGit.cache?.clear?.()
})

afterEach(async () => {
  await stopUdsMessaging()
  resetUdsIdleNotifyForTests()
  setLanBeacon(null)
  restoreWorktreeSession(null)
  cancelPendingGoalIdleCheckin()
  clearDynamicTeamContext()
  unregisterLeaderToolUseConfirmQueue()
  unregisterLeaderSetToolPermissionContext()
  resetBackendDetection()
  resetDetectionCache()
  resetShutdownState()
  getIsGit.cache?.clear?.()
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

describe('2.1.331 multi-host ALS isolation: UDS Messaging, UDS Idle Notify & LAN Beacon', () => {
  test('isolates UDS server, socketPath, inbox, authToken, and onEnqueue ALS re-entry across concurrent hosts', async () => {
    const sockDirA = makeShortTempDir('u6a-')
    const sockDirB = makeShortTempDir('u6b-')
    const sockA = join(sockDirA, 'a.sock')
    const sockB = join(sockDirB, 'b.sock')

    const enqueueSessionsA: string[] = []
    const enqueueSessionsB: string[] = []

    let resolveBothStarted!: () => void
    let startedCount = 0
    const bothStarted = new Promise<void>(resolve => {
      resolveBothStarted = resolve
    })
    const markStarted = () => {
      startedCount++
      if (startedCount === 2) resolveBothStarted()
    }

    let resolveHostADone!: () => void
    const hostADone = new Promise<void>(resolve => {
      resolveHostADone = resolve
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'uds-host-a' }, async () => {
        await startUdsMessaging(sockA, {
          isExplicit: true,
          requireAuth: true,
        })
        expect(getUdsMessagingSocketPath()).toBe(sockA)

        let resolveMsgA!: () => void
        const gotMsgA = new Promise<void>(resolve => {
          resolveMsgA = resolve
        })
        setOnEnqueue(() => {
          enqueueSessionsA.push(getSessionId())
          resolveMsgA()
        })

        markStarted()
        await bothStarted

        // Send from Host A to Host B's socket
        await sendUdsMessage(sockB, {
          type: 'text',
          data: 'hello-to-b',
        })

        await gotMsgA

        // Host A rejects a bad auth token even while Host B is running
        await expect(
          sendUdsMessage(
            sockA,
            { type: 'text', data: 'wrong-token' },
            { authToken: '00000000000000000000000000000000' },
          ),
        ).rejects.toThrow()

        const drainedA = drainInbox()
        await stopUdsMessaging()
        expect(getUdsMessagingSocketPath()).toBeUndefined()
        resolveHostADone()
        return { drainedA }
      }),
      runWithNewHostSession({ id: 'uds-host-b' }, async () => {
        await startUdsMessaging(sockB, {
          isExplicit: true,
          requireAuth: true,
        })
        expect(getUdsMessagingSocketPath()).toBe(sockB)

        let resolveMsgB!: () => void
        const gotMsgB = new Promise<void>(resolve => {
          resolveMsgB = resolve
        })
        setOnEnqueue(() => {
          enqueueSessionsB.push(getSessionId())
          resolveMsgB()
        })

        markStarted()
        await bothStarted

        // Send from Host B to Host A's socket
        await sendUdsMessage(sockA, {
          type: 'text',
          data: 'hello-to-a',
        })

        await gotMsgB
        // Wait until Host A has stopped its own server to prove Host A's stop
        // did NOT tear down Host B's server or inbox
        await hostADone
        expect(getUdsMessagingSocketPath()).toBe(sockB)

        const drainedB = drainInbox()
        await stopUdsMessaging()
        expect(getUdsMessagingSocketPath()).toBeUndefined()
        return { drainedB }
      }),
    ])

    expect(enqueueSessionsA).toEqual(['uds-host-a'])
    expect(enqueueSessionsB).toEqual(['uds-host-b'])
    expect(resA.drainedA.map(e => e.message.data)).toEqual(['hello-to-a'])
    expect(resA.drainedA[0]?.message.from).toBe(sockB)
    expect(resB.drainedB.map(e => e.message.data)).toEqual(['hello-to-b'])
    expect(resB.drainedB[0]?.message.from).toBe(sockA)
  })

  test('isolates udsIdleNotify subscriptions, notices, subscribers, and senders per host', async () => {
    const noticesA: IdleNoticeForModel[] = []
    const noticesB: IdleNoticeForModel[] = []
    const sentByA: Array<{ target: string; frame: Record<string, unknown> }> =
      []
    const sentByB: Array<{ target: string; frame: Record<string, unknown> }> =
      []

    const sharedMsgId = 'idle-msg-shared-1'
    const sockDir = makeShortTempDir('u6-idle-')
    const sockA = join(sockDir, 'a.sock')
    const sockB = join(sockDir, 'b.sock')
    const sockPeer = join(sockDir, 'peer.sock')

    await Promise.all([
      runWithNewHostSession({ id: 'idle-host-a' }, async () => {
        setIdleNoticeHandler(notice => noticesA.push(notice))
        setPeerIdleNoticeSender(async (target, frame) => {
          sentByA.push({ target, frame })
        })
        seedOutstandingIdleSubscriptionForTests({
          msgId: sharedMsgId,
          label: 'peer-for-a',
          target: sockPeer,
        })
        expect(
          acceptNotifyWhenIdle({
            from: sockPeer,
            msgId: 'sub-on-a',
            ownSocketPath: sockA,
          }),
        ).toBe('full')

        await new Promise(resolve => setTimeout(resolve, 15))

        // Host A still has its own outstanding sub and inbound subscriber
        expect(hasOutstandingIdleSubscription(sharedMsgId)).toBe(true)
        expect(
          correlatePeerIdleNotice({
            origMsgId: sharedMsgId,
            state: 'idle',
            detail: 'done-for-a',
          }),
        ).toBe(true)
        await flushIdleSubscribers({ state: 'idle', detail: 'host-a-idle' })
      }),
      runWithNewHostSession({ id: 'idle-host-b' }, async () => {
        setIdleNoticeHandler(notice => noticesB.push(notice))
        setPeerIdleNoticeSender(async (target, frame) => {
          sentByB.push({ target, frame })
        })
        // Host B does not see Host A's subscription
        expect(hasOutstandingIdleSubscription(sharedMsgId)).toBe(false)
        seedOutstandingIdleSubscriptionForTests({
          msgId: sharedMsgId,
          label: 'peer-for-b',
          target: sockPeer,
        })
        expect(
          acceptNotifyWhenIdle({
            from: sockPeer,
            msgId: 'sub-on-b',
            ownSocketPath: sockB,
          }),
        ).toBe('full')

        // Resetting Host B must not wipe Host A
        resetUdsIdleNotifyForTests()
        expect(hasOutstandingIdleSubscription(sharedMsgId)).toBe(false)
        await flushIdleSubscribers({ state: 'idle' })
      }),
    ])

    expect(noticesA).toHaveLength(1)
    expect(noticesA[0]?.label).toBe('peer-for-a')
    expect(noticesA[0]?.detail).toBe('done-for-a')
    expect(noticesB).toHaveLength(0)
    expect(sentByA).toHaveLength(1)
    expect(sentByA[0]?.frame.orig_msg_id).toBe('sub-on-a')
    expect(sentByB).toHaveLength(0)
  })

  test('isolates lanBeacon singleton per SessionHost', () => {
    const beaconA = new LanBeacon({
      pipeName: 'pipe-a',
      machineId: 'm-a',
      hostname: 'host-a',
      ip: '127.0.0.1',
      tcpPort: 7102,
      role: 'main',
    })
    const beaconB = new LanBeacon({
      pipeName: 'pipe-b',
      machineId: 'm-b',
      hostname: 'host-b',
      ip: '127.0.0.1',
      tcpPort: 7103,
      role: 'sub',
    })

    runWithNewHostSession({ id: 'lan-host-a' }, () => {
      expect(getLanBeacon()).toBeNull()
      setLanBeacon(beaconA)
      expect(getLanBeacon()).toBe(beaconA)

      runWithNewHostSession({ id: 'lan-host-b' }, () => {
        expect(getLanBeacon()).toBeNull()
        setLanBeacon(beaconB)
        expect(getLanBeacon()).toBe(beaconB)
        setLanBeacon(null)
        expect(getLanBeacon()).toBeNull()
      })

      // Host A's beacon is untouched
      expect(getLanBeacon()).toBe(beaconA)
    })
  })
})

describe('2.1.331 multi-host ALS isolation: Chdir Guards, cdCommand, sessionRestore, WorktreeExitDialog & worktree', () => {
  test('relocateSessionCwd updates cwdAls/session CWD without mutating process.cwd()', async () => {
    const initialProcessCwd = process.cwd()
    const dirA1 = makeShortTempDir('cd-a1-')
    const dirA2 = makeShortTempDir('cd-a2-')
    const dirB1 = makeShortTempDir('cd-b1-')
    const dirB2 = makeShortTempDir('cd-b2-')

    const [resA, resB] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'cd-host-a',
          originalCwd: dirA1,
          projectRoot: dirA1,
          cwd: dirA1,
        },
        () =>
          runWithCwd(dirA1, async () => {
            expect(getCwd()).toBe(dirA1)
            await relocateSessionCwd(dirA2, 'cd_command')
            expect(process.cwd()).toBe(initialProcessCwd)
            expect(getCwd()).toBe(dirA2)
            expect(getOriginalCwd()).toBe(dirA2)
            return { cwd: getCwd(), orig: getOriginalCwd() }
          }),
      ),
      runWithNewHostSession(
        {
          id: 'cd-host-b',
          originalCwd: dirB1,
          projectRoot: dirB1,
          cwd: dirB1,
        },
        async () => {
          expect(getCwd()).toBe(dirB1)
          await relocateSessionCwd(dirB2, 'cd_command')
          expect(process.cwd()).toBe(initialProcessCwd)
          expect(getCwd()).toBe(dirB2)
          expect(getOriginalCwd()).toBe(dirB2)
          return { cwd: getCwd(), orig: getOriginalCwd() }
        },
      ),
    ])

    expect(process.cwd()).toBe(initialProcessCwd)
    expect(resA).toEqual({ cwd: dirA2, orig: dirA2 })
    expect(resB).toEqual({ cwd: dirB2, orig: dirB2 })
  })

  test('sessionRestore isolates pendingRestoredAgentModel per RootSessionSlot and never calls process.chdir under ALS', () => {
    const initialProcessCwd = process.cwd()
    const defs = {
      activeAgents: [
        {
          agentType: 'agent-alpha',
          whenToUse: 'alpha',
          source: 'userSettings',
          model: 'claude-sonnet-4-6',
          getSystemPrompt: () => 'alpha',
        },
        {
          agentType: 'agent-beta',
          whenToUse: 'beta',
          source: 'userSettings',
          model: 'claude-haiku-4-5-20251001',
          getSystemPrompt: () => 'beta',
        },
      ],
      allAgents: [],
    } as unknown as AgentDefinitionsResult

    const makeMockAppState = () => {
      let state = {
        mainLoopModel: undefined as string | undefined,
        agentNameRegistry: new Map<string, string>(),
        todos: {},
        fileHistory: {
          snapshots: [],
          trackedFiles: new Set<string>(),
          snapshotSequence: 0,
        },
      } as unknown as AppState
      const setAppState = (updater: (prev: AppState) => AppState) => {
        state = updater(state)
      }
      return { get: () => state, set: setAppState }
    }

    runWithNewHostSession({ id: 'restore-sess-a' }, sessionA => {
      // Seed pendingRestoredAgentModel in Session A (without setAppState)
      const restoredA = restoreAgentFromSession('agent-alpha', undefined, defs)
      expect(restoredA.restoredModel).toBe('claude-sonnet-4-6')

      // Session B seeds & consumes its own pendingRestoredAgentModel
      runWithNewHostSession({ id: 'restore-sess-b' }, () => {
        const restoredB = restoreAgentFromSession('agent-beta', undefined, defs)
        expect(restoredB.restoredModel).toBe('claude-haiku-4-5-20251001')

        const appB = makeMockAppState()
        restoreSessionStateFromLog({ messages: [] }, appB.set)
        expect(appB.get().mainLoopModel).toBe('claude-haiku-4-5-20251001')
      })

      // A withProject fork of Session A shares Session A's RootSessionSlot
      const forkA = sessionA.withProject({ cwd: '/tmp' })
      const appA = makeMockAppState()
      runWithSession(forkA, () => {
        restoreSessionStateFromLog({ messages: [] }, appA.set)
      })
      expect(appA.get().mainLoopModel).toBe('claude-sonnet-4-6')
    })

    // restoreWorktreeForResume & exitRestoredWorktree must never mutate process.cwd() under ALS
    const repoDir = initGitRepo(makeShortTempDir('sr-repo-'), 'sr')
    const wtDir = join(repoDir, '.claude', 'worktrees', 'resume-wt')
    mkdirSync(join(repoDir, '.claude', 'worktrees'), { recursive: true })
    execFileSync('git', ['worktree', 'add', '-b', 'wt-resume', wtDir], {
      cwd: repoDir,
      stdio: 'ignore',
    })
    const wtReal = realpathSync(wtDir)

    runWithNewHostSession(
      {
        id: 'sr-wt-host',
        originalCwd: repoDir,
        projectRoot: repoDir,
        cwd: repoDir,
      },
      () => {
        runWithCwd(repoDir, () => {
          restoreWorktreeForResume({
            originalCwd: repoDir,
            worktreePath: wtReal,
            worktreeName: 'resume-wt',
            worktreeBranch: 'wt-resume',
            sessionId: 'sr-wt-host',
          })
          expect(process.cwd()).toBe(initialProcessCwd)
          expect(getCwd()).toBe(wtReal)
          expect(getCurrentWorktreeSession()?.worktreePath).toBe(wtReal)

          exitRestoredWorktree()
          expect(process.cwd()).toBe(initialProcessCwd)
          expect(getCwd()).toBe(repoDir)
          expect(getCurrentWorktreeSession()).toBeNull()

          // Non-existent worktree directory under ALS returns cleanly without throwing
          restoreWorktreeForResume({
            originalCwd: repoDir,
            worktreePath: join(repoDir, '.claude', 'worktrees', 'missing-wt'),
            worktreeName: 'missing-wt',
            sessionId: 'sr-wt-host',
          })
          expect(process.cwd()).toBe(initialProcessCwd)
          expect(getCurrentWorktreeSession()).toBeNull()
        })
      },
    )
  })

  test('keepWorktree and cleanupWorktree restore ALS/scoped CWD even outside ExitWorktreeTool without mutating process.cwd()', async () => {
    const initialProcessCwd = process.cwd()
    const repoDir = initGitRepo(makeShortTempDir('wt-direct-'), 'wtd')
    mkdirSync(join(repoDir, '.claude', 'worktrees'), { recursive: true })

    // 1. keepWorktree directly under ALS + runWithCwd
    const keepWtDir = join(repoDir, '.claude', 'worktrees', 'direct-keep')
    execFileSync(
      'git',
      ['worktree', 'add', '-b', 'wt-direct-keep', keepWtDir],
      {
        cwd: repoDir,
        stdio: 'ignore',
      },
    )
    const keepWtReal = realpathSync(keepWtDir)

    await runWithNewHostSession(
      {
        id: 'wt-direct-keep-host',
        originalCwd: repoDir,
        projectRoot: repoDir,
        cwd: keepWtReal,
      },
      () =>
        runWithCwd(keepWtReal, async () => {
          restoreWorktreeSession({
            originalCwd: repoDir,
            worktreePath: keepWtReal,
            worktreeName: 'direct-keep',
            worktreeBranch: 'wt-direct-keep',
            sessionId: 'wt-direct-keep-host',
            enteredExisting: true,
          })
          expect(getCwd()).toBe(keepWtReal)
          await keepWorktree()
          expect(process.cwd()).toBe(initialProcessCwd)
          expect(getCwd()).toBe(repoDir)
          expect(getCurrentWorktreeSession()).toBeNull()
        }),
    )

    // 2. cleanupWorktree directly under ALS + runWithCwd
    const rmWtDir = join(repoDir, '.claude', 'worktrees', 'direct-rm')
    execFileSync('git', ['worktree', 'add', '-b', 'wt-direct-rm', rmWtDir], {
      cwd: repoDir,
      stdio: 'ignore',
    })
    const rmWtReal = realpathSync(rmWtDir)

    await runWithNewHostSession(
      {
        id: 'wt-direct-rm-host',
        originalCwd: repoDir,
        projectRoot: repoDir,
        cwd: rmWtReal,
      },
      () =>
        runWithCwd(rmWtReal, async () => {
          restoreWorktreeSession({
            originalCwd: repoDir,
            worktreePath: rmWtReal,
            worktreeName: 'direct-rm',
            worktreeBranch: 'wt-direct-rm',
            sessionId: 'wt-direct-rm-host',
          })
          expect(getCwd()).toBe(rmWtReal)
          const removed = await cleanupWorktree()
          expect(removed).toBe(true)
          expect(process.cwd()).toBe(initialProcessCwd)
          expect(getCwd()).toBe(repoDir)
          expect(getCurrentWorktreeSession()).toBeNull()
          expect(existsSync(rmWtReal)).toBe(false)
        }),
    )

    // 3. WorktreeExitDialog guards every process.chdir call with ALS + scoped-cwd check
    const dialogSrc = readFileSync(
      join(process.cwd(), 'src/components/WorktreeExitDialog.tsx'),
      'utf-8',
    )
    const chdirMatches = [...dialogSrc.matchAll(/process\.chdir\(/g)]
    expect(chdirMatches.length).toBeGreaterThanOrEqual(4)
    for (const match of chdirMatches) {
      const prefix = dialogSrc.slice(
        Math.max(0, match.index! - 120),
        match.index!,
      )
      expect(prefix).toContain('!hasActiveSessionAls() && !hasScopedCwd()')
    }
  })
})

describe('2.1.331 multi-host ALS isolation: Goal Idle Check-in & Goal Mutation Epoch', () => {
  test('isolates pendingGoalIdleCheckin per root session and re-enters ALS session on timer fire', async () => {
    const deliveredSessions: string[] = []
    const origSetTimeout = globalThis.setTimeout
    const capturedCallbacks: Array<() => void> = []

    const makeGoalAppState = (condition: string) => {
      let state = {
        activeGoal: {
          condition,
          setAt: 1_000,
          iterations: 1,
          tokensAtStart: 0,
          deferredSince: 1_000,
          checkinCount: 0,
          lastDeferralPassAt: 1_000,
        },
        tasks: {},
      } as unknown as AppState
      return {
        get: () => state,
        set: (updater: (prev: AppState) => AppState) => {
          state = updater(state)
        },
      }
    }

    try {
      globalThis.setTimeout = ((fn: (...args: unknown[]) => void) => {
        capturedCallbacks.push(() => fn())
        return {
          unref() {},
        } as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout

      const appA = makeGoalAppState('goal-a')
      const appB = makeGoalAppState('goal-b')

      runWithNewHostSession({ id: 'goal-sess-a' }, () => {
        armGoalIdleCheckin({
          goal: appA.get().activeGoal!,
          now: 120_000,
          getAppState: appA.get,
          setAppState: appA.set,
          getIntervalMs: () => 60_000,
          isMainLoopBusy: () => false,
          hasQueued: () => false,
          nowMs: () => 120_000,
          deliver: () => {
            deliveredSessions.push(getSessionId())
          },
        })
        const timerA = getPendingGoalIdleCheckin()
        expect(timerA).toBeDefined()

        runWithNewHostSession({ id: 'goal-sess-b' }, () => {
          expect(getPendingGoalIdleCheckin()).toBeUndefined()
          armGoalIdleCheckin({
            goal: appB.get().activeGoal!,
            now: 120_000,
            getAppState: appB.get,
            setAppState: appB.set,
            getIntervalMs: () => 60_000,
            isMainLoopBusy: () => false,
            hasQueued: () => false,
            nowMs: () => 120_000,
            deliver: () => {
              deliveredSessions.push(getSessionId())
            },
          })
          expect(getPendingGoalIdleCheckin()).toBeDefined()
          // Canceling Session B's timer must NOT cancel Session A's timer
          cancelPendingGoalIdleCheckin()
          expect(getPendingGoalIdleCheckin()).toBeUndefined()
        })

        // Session A still owns its armed timer
        expect(getPendingGoalIdleCheckin()).toBe(timerA)
      })

      // Fire Session A's timer callback completely OUTSIDE any ALS scope:
      // WeakRef(session.root) must re-enter goal-sess-a via runWithSession!
      expect(capturedCallbacks.length).toBeGreaterThanOrEqual(1)
      exitSessionContext(() => {
        capturedCallbacks[0]!()
      })
      expect(deliveredSessions).toEqual(['goal-sess-a'])
    } finally {
      globalThis.setTimeout = origSetTimeout
    }
  })

  test('isolates goalMutationEpoch per RootSessionSlot (shared by withProject fork)', () => {
    runWithNewHostSession({ id: 'epoch-sess-a' }, sessionA => {
      expect(getGoalMutationEpoch()).toBe(0)
      expect(bumpGoalMutationEpoch()).toBe(1)
      expect(bumpGoalMutationEpoch()).toBe(2)

      runWithNewHostSession({ id: 'epoch-sess-b' }, () => {
        expect(getGoalMutationEpoch()).toBe(0)
        expect(bumpGoalMutationEpoch()).toBe(1)
      })

      expect(getGoalMutationEpoch()).toBe(2)

      // withProject fork shares root session's mutation epoch
      const forkA = sessionA.withProject({ cwd: '/tmp' })
      runWithSession(forkA, () => {
        expect(getGoalMutationEpoch()).toBe(2)
        const snapshot = {
          condition: 'finish wave 4',
          setAt: 42,
          iterations: 0,
          tokensAtStart: 0,
        }
        let state = { activeGoal: snapshot } as unknown as AppState
        const applied = applyGoalStateUpdateIfUnchanged(
          updater => {
            state = updater(state)
          },
          snapshot,
          { ...snapshot, iterations: 1 },
          2,
        )
        expect(applied).toBe(true)
        expect(state.activeGoal?.iterations).toBe(1)
      })
    })
  })
})

describe('2.1.331 multi-host ALS isolation: Teammate & Swarm Subsystem', () => {
  test('isolates teammate.ts dynamicTeamContext per SessionHost', () => {
    runWithNewHostSession({ id: 'tm-host-a' }, () => {
      setDynamicTeamContext({
        agentId: 'alice@team-alpha',
        agentName: 'alice',
        teamName: 'team-alpha',
        color: 'blue',
        planModeRequired: true,
        parentSessionId: 'parent-a',
      })
      expect(isTeammate()).toBe(true)
      expect(getAgentId()).toBe('alice@team-alpha')
      expect(getAgentName()).toBe('alice')
      expect(getTeamName()).toBe('team-alpha')
      expect(getTeammateColor()).toBe('blue')
      expect(isPlanModeRequired()).toBe(true)
      expect(getParentSessionId()).toBe('parent-a')

      runWithNewHostSession({ id: 'tm-host-b' }, () => {
        expect(isTeammate()).toBe(false)
        expect(getDynamicTeamContext()).toBeNull()
        setDynamicTeamContext({
          agentId: 'bob@team-beta',
          agentName: 'bob',
          teamName: 'team-beta',
          color: 'green',
          planModeRequired: false,
          parentSessionId: 'parent-b',
        })
        expect(getAgentId()).toBe('bob@team-beta')
        expect(getTeamName()).toBe('team-beta')
        clearDynamicTeamContext()
        expect(isTeammate()).toBe(false)
      })

      // Host A's dynamicTeamContext is untouched by Host B's set/clear
      expect(isTeammate()).toBe(true)
      expect(getAgentId()).toBe('alice@team-alpha')
      expect(getTeamName()).toBe('team-alpha')
      expect(getParentSessionId()).toBe('parent-a')
    })
  })

  test('isolates leaderPermissionBridge per RootSessionSlot', () => {
    const queueSetterA = () => {}
    const queueSetterB = () => {}
    const permSetterA = () => {}
    const permSetterB = () => {}

    runWithNewHostSession({ id: 'bridge-sess-a' }, sessionA => {
      registerLeaderToolUseConfirmQueue(queueSetterA)
      registerLeaderSetToolPermissionContext(permSetterA)
      expect(getLeaderToolUseConfirmQueue()).toBe(queueSetterA)
      expect(getLeaderSetToolPermissionContext()).toBe(permSetterA)

      runWithNewHostSession({ id: 'bridge-sess-b' }, () => {
        expect(getLeaderToolUseConfirmQueue()).toBeNull()
        expect(getLeaderSetToolPermissionContext()).toBeNull()
        registerLeaderToolUseConfirmQueue(queueSetterB)
        registerLeaderSetToolPermissionContext(permSetterB)
        expect(getLeaderToolUseConfirmQueue()).toBe(queueSetterB)
        expect(getLeaderSetToolPermissionContext()).toBe(permSetterB)
        unregisterLeaderToolUseConfirmQueue()
        unregisterLeaderSetToolPermissionContext()
        expect(getLeaderToolUseConfirmQueue()).toBeNull()
      })

      // Session A and its fork still hold Session A's registered setters
      expect(getLeaderToolUseConfirmQueue()).toBe(queueSetterA)
      expect(getLeaderSetToolPermissionContext()).toBe(permSetterA)
      const forkA = sessionA.withProject({ cwd: '/tmp' })
      runWithSession(forkA, () => {
        expect(getLeaderToolUseConfirmQueue()).toBe(queueSetterA)
        expect(getLeaderSetToolPermissionContext()).toBe(permSetterA)
      })
    })
  })

  test('isolates teammateModeSnapshot and swarm/backends/registry per SessionHost', () => {
    // Simulate a pane-capable terminal so 'auto' resolves to pane mode unless
    // markInProcessFallback() was recorded on that specific host.
    process.env.WT_SESSION = 'test-wt-session'
    delete process.env.TERM_PROGRAM
    resetDetectionCache()

    runWithNewHostSession({ id: 'reg-host-a', isInteractive: true }, () => {
      setCliTeammateModeOverride('auto')
      captureTeammateModeSnapshot()
      expect(getCliTeammateModeOverride()).toBe('auto')
      expect(getTeammateModeFromSnapshot()).toBe('auto')
      expect(isInProcessEnabled()).toBe(false)

      markInProcessFallback()
      expect(isInProcessEnabled()).toBe(true)
      const inProcA = getInProcessBackend()

      runWithNewHostSession({ id: 'reg-host-b', isInteractive: true }, () => {
        expect(getCliTeammateModeOverride()).toBeNull()
        setCliTeammateModeOverride('tmux')
        captureTeammateModeSnapshot()
        expect(getTeammateModeFromSnapshot()).toBe('tmux')

        // Host B has NOT triggered in-process fallback even when switched to auto
        clearCliTeammateModeOverride('auto')
        expect(getCliTeammateModeOverride()).toBeNull()
        expect(getTeammateModeFromSnapshot()).toBe('auto')
        expect(isInProcessEnabled()).toBe(false)

        const inProcB = getInProcessBackend()
        expect(inProcB).not.toBe(inProcA)

        // Resetting Host B must not wipe Host A's fallback or cached backend
        resetBackendDetection()
        expect(getInProcessBackend()).not.toBe(inProcB)
      })

      // Host A still has its CLI override, fallback flag, and cached backend
      expect(getCliTeammateModeOverride()).toBe('auto')
      expect(isInProcessEnabled()).toBe(true)
      expect(getInProcessBackend()).toBe(inProcA)
    })
  })

  test('isolates inProcessRunner teammateWakeCallbacks per SessionHost', async () => {
    const acA = new AbortController()
    const acB = new AbortController()
    let wokeA = false
    let wokeB = false

    const hostAPromise = runWithNewHostSession(
      { id: 'wake-host-a' },
      async () => {
        const waitA = _sleepOrWakeForTesting(
          30_000,
          'worker@shared-team',
          acA.signal,
        ).then(() => {
          wokeA = true
        })

        // Host B calling wakeIdleTeammate for the same agentId must NOT wake Host A
        runWithNewHostSession({ id: 'wake-host-b' }, () => {
          expect(wakeIdleTeammate(undefined, 'worker', 'shared-team')).toBe(
            false,
          )
        })
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(wokeA).toBe(false)

        // Host A waking its own worker succeeds immediately
        expect(wakeIdleTeammate(undefined, 'worker', 'shared-team')).toBe(true)
        await waitA
        expect(wokeA).toBe(true)
      },
    )

    const hostBPromise = runWithNewHostSession(
      { id: 'wake-host-b-2' },
      async () => {
        const waitB = _sleepOrWakeForTesting(
          30_000,
          'worker@shared-team',
          acB.signal,
        ).then(() => {
          wokeB = true
        })
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(wokeB).toBe(false)
        expect(wakeIdleTeammate(undefined, 'worker', 'shared-team')).toBe(true)
        await waitB
        expect(wokeB).toBe(true)
      },
    )

    await Promise.all([hostAPromise, hostBPromise])
    acA.abort()
    acB.abort()
  })
})

describe('2.1.331 multi-host ALS isolation: gitDiff & gracefulShutdown', () => {
  test('gitDiff reads ALS session CWD (without runWithCwd) instead of process.cwd()', async () => {
    const initialProcessCwd = process.cwd()
    const repoA = initGitRepo(makeShortTempDir('gd-a-'), 'alpha')
    const repoB = initGitRepo(makeShortTempDir('gd-b-'), 'beta')

    // Create distinct tracked modifications in each repo
    writeFileSync(join(repoA, 'alpha.txt'), 'line 1\n', 'utf-8')
    execFileSync('git', ['add', 'alpha.txt'], { cwd: repoA, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'add alpha'], {
      cwd: repoA,
      stdio: 'ignore',
    })
    writeFileSync(join(repoA, 'alpha.txt'), 'line 1\nline 2 alpha\n', 'utf-8')

    writeFileSync(join(repoB, 'beta.txt'), 'start\n', 'utf-8')
    execFileSync('git', ['add', 'beta.txt'], { cwd: repoB, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'add beta'], {
      cwd: repoB,
      stdio: 'ignore',
    })
    writeFileSync(join(repoB, 'beta.txt'), 'start\nchanged beta\n', 'utf-8')

    const [diffA, diffB] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'gd-host-a',
          originalCwd: repoA,
          projectRoot: repoA,
          cwd: repoA,
        },
        async () => {
          const diff = await fetchGitDiff('uncommitted')
          const hunks = await fetchGitDiffHunks('HEAD')
          return { diff, hunks }
        },
      ),
      runWithNewHostSession(
        {
          id: 'gd-host-b',
          originalCwd: repoB,
          projectRoot: repoB,
          cwd: repoB,
        },
        async () => {
          const diff = await fetchGitDiff('uncommitted')
          const hunks = await fetchGitDiffHunks('HEAD')
          return { diff, hunks }
        },
      ),
    ])

    expect(process.cwd()).toBe(initialProcessCwd)
    expect(diffA.diff?.perFileStats.has('alpha.txt')).toBe(true)
    expect(diffA.diff?.perFileStats.has('beta.txt')).toBe(false)
    expect(diffA.hunks?.hunks.has('alpha.txt')).toBe(true)
    expect(diffA.hunks?.hunks.has('beta.txt')).toBe(false)

    expect(diffB.diff?.perFileStats.has('beta.txt')).toBe(true)
    expect(diffB.diff?.perFileStats.has('alpha.txt')).toBe(false)
    expect(diffB.hunks?.hunks.has('beta.txt')).toBe(true)
    expect(diffB.hunks?.hunks.has('alpha.txt')).toBe(false)
  })

  test('gracefulShutdown isolates resumeHintLaunchFlags, interactiveShutdownAbort, and owedSandboxCleanups per host', async () => {
    let abortedA = false
    let abortedB = false
    const tokenA = { name: 'sandbox-a' }
    const tokenB = { name: 'sandbox-b' }

    await runWithNewHostSession({ id: 'sd-host-a' }, async () => {
      setResumeHintLaunchFlags('--model sonnet')
      registerInteractiveShutdownAbort(() => {
        abortedA = true
      })
      registerOwedSandboxCleanup(tokenA)

      expect(getResumeHintLaunchFlags()).toBe('--model sonnet')
      expect(getOwedSandboxCleanupPromise()).not.toBeNull()

      await runWithNewHostSession({ id: 'sd-host-b' }, async () => {
        expect(getResumeHintLaunchFlags()).toBeUndefined()
        expect(getInteractiveShutdownAbortForTests()).toBeNull()
        expect(getOwedSandboxCleanupPromise()).toBeNull()

        setResumeHintLaunchFlags('--model haiku')
        registerInteractiveShutdownAbort(() => {
          abortedB = true
        })
        registerOwedSandboxCleanup(tokenB)
        const promiseB = getOwedSandboxCleanupPromise()
        expect(promiseB).not.toBeNull()
        resolveOwedSandboxCleanup(tokenB)
        await promiseB
        expect(getOwedSandboxCleanupPromise()).toBeNull()

        getInteractiveShutdownAbortForTests()?.()
        expect(abortedB).toBe(true)
        expect(abortedA).toBe(false)

        // Resetting Host B must not wipe Host A's state
        resetShutdownState()
        expect(getResumeHintLaunchFlags()).toBeUndefined()
      })

      // Host A's launch flags, abort handler, and pending sandbox cleanup survive intact
      expect(getResumeHintLaunchFlags()).toBe('--model sonnet')
      const promiseA = getOwedSandboxCleanupPromise()
      expect(promiseA).not.toBeNull()
      getInteractiveShutdownAbortForTests()?.()
      expect(abortedA).toBe(true)
      resolveOwedSandboxCleanup(tokenA)
      await promiseA
      expect(getOwedSandboxCleanupPromise()).toBeNull()
    })
  })
})
