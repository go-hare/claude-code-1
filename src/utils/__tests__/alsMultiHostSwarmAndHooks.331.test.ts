/**
 * Official Claude Code 2.1.331 multi-host `WeakMap<SessionHost, ...>` and
 * `AsyncLocalStorage` hook-execution isolation tests (`02_host_slot_als.js`).
 *
 * Covers per-`SessionHost` isolation across:
 * 1. `src/utils/tasks.ts` (`leaderTeamName`, `sessionTaskListId`, `ownTaskListId`, `onTasksUpdated`)
 * 2. `src/utils/swarm/sessionTeam.ts` (`inheritedTeamName` latch)
 * 3. `src/utils/teammateMailbox.ts` (`pendingShutdownRequests`, `shownPlanDigests`, lead keys)
 * 4. `src/utils/hooks/sessionHooks.ts` & `src/utils/hooks/hookEvents.ts`
 *    (`addWeakRef` `GWo`, `collectWeakRefs` `kDt`, `collectHostRegisteredHooks` `Q8l`,
 *     `isInsideHookExecution` `Xye`, `skillDrawsByHost`, per-host hook events)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getRegisteredHooks,
  registerHookCallbacks,
  resetSdkInitState,
  setMainThreadAgentHooks,
  switchSession,
  getSessionId,
} from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import { createSessionHooksRegistry } from '../../state/sessionHooksRegistry.js'
import { asSessionId } from '../../types/ids.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  clearHookEventState,
  emitHookResponse,
  emitHookStarted,
  type HookExecutionEvent,
  registerHookEventHandler,
  setAllHookEventsEnabled,
} from '../hooks/hookEvents.js'
import {
  _resetHookExecutionStateForTesting,
  addFunctionHook,
  addSessionHook,
  addWeakRef,
  clearSessionHooks,
  collectHostRegisteredHooks,
  collectWeakRefs,
  exitHookExecution,
  type FunctionHook,
  getBootstrapSessionHooksState,
  getHookExecutionContext,
  getHostHookOwners,
  getHostSessionHookStores,
  getSessionHookCallback,
  getSkillHookDraws,
  hasEnteredHookExecution,
  hasHostEnteredHookExecution,
  isInsideHookExecution,
  registerHostHookOwner,
  runInsideHookExecution,
  type SessionHooksState,
} from '../hooks/sessionHooks.js'
import { runWithNewHostSession } from '../sessionContextAls.js'
import {
  createSessionHost,
  getBootstrapSession,
  getBootstrapSessionHost,
  resetSessionHostForTests,
  type SessionHost,
} from '../sessionHost.js'
import { createRootSession } from '../sessionRoot.js'
import {
  _resetInheritedTeamNameForTesting,
  initializeSessionTeam,
  rekeySessionTeamAtStartup,
  rekeySessionTeamInSession,
  sessionTeamName,
} from '../swarm/sessionTeam.js'
import {
  clearLeaderTeamName,
  getLeaderTeamName,
  getOwnTaskListId,
  getSessionTaskListId,
  getTaskListId,
  getTasksDir,
  noteSessionTaskListAfterClear,
  notifyTasksUpdated,
  onTasksUpdated,
  persistSessionTaskListId,
  resetTaskListState,
  SESSION_LIST_FILE,
  SESSION_TASK_LIST_FILE,
  setLeaderTeamName,
  setOwnTaskListId,
  setSessionTaskListId,
} from '../tasks.js'
import { setDynamicTeamContext } from '../teammate.js'
import { runWithTeammateContext } from '../teammateContext.js'
import {
  clearPendingShutdownRequestsForAddressee,
  clearShownPlanDigests,
  computePlanDigest,
  consumePendingShutdownRequest,
  createTeamLeadEntryKeyForInbox,
  getActiveLeadVerifyKey,
  getShownPlanDigest,
  hasPendingShutdownRequestForAddressee,
  hasTeamLeadEntryKeyForInbox,
  invalidateAllShownPlanDigests,
  recordPendingShutdownRequest,
  recordShownPlanDigest,
  removePendingShutdownRequest,
  resetPendingShutdownRequestsForTesting,
  resetTeamLeadVerificationOnSessionBoundary,
  setActiveLeadVerifyKey,
} from '../teammateMailbox.js'

let tempConfigDir: string
let savedConfigDir: string | undefined
let savedTaskListEnv: string | undefined
let savedTeamNameEnv: string | undefined
let savedInheritedTeamEnv: string | undefined
let savedSessionId: ReturnType<typeof getSessionId>
let savedHost: SessionHost

function withHost<T>(host: SessionHost, fn: () => T): T {
  const session = getBootstrapSession()
  const prev = session.host
  session.host = host
  try {
    return fn()
  } finally {
    session.host = prev
  }
}

async function withHostAsync<T>(
  host: SessionHost,
  fn: () => Promise<T>,
): Promise<T> {
  const session = getBootstrapSession()
  const prev = session.host
  session.host = host
  try {
    return await fn()
  } finally {
    session.host = prev
  }
}

function makeAppStateHarness(): {
  get: () => AppState
  set: (updater: (prev: AppState) => AppState) => void
} {
  let sessionHooks: SessionHooksState = new Map()
  return {
    get: () => ({ sessionHooks }) as unknown as AppState,
    set: updater => {
      const next = updater({ sessionHooks } as unknown as AppState)
      sessionHooks = next.sessionHooks
    },
  }
}

beforeEach(() => {
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  savedTaskListEnv = process.env.CLAUDE_CODE_TASK_LIST_ID
  savedTeamNameEnv = process.env.CLAUDE_CODE_TEAM_NAME
  savedInheritedTeamEnv = process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME
  savedSessionId = getSessionId()
  savedHost = getBootstrapSessionHost()

  tempConfigDir = join(
    tmpdir(),
    `als-multihost-331-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  mkdirSync(tempConfigDir, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = tempConfigDir
  getClaudeConfigHomeDir.cache?.clear?.()

  delete process.env.CLAUDE_CODE_TASK_LIST_ID
  delete process.env.CLAUDE_CODE_TEAM_NAME
  delete process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME

  setDynamicTeamContext(null)
  resetTaskListState()
  _resetInheritedTeamNameForTesting()
  resetPendingShutdownRequestsForTesting()
  clearShownPlanDigests()
  setActiveLeadVerifyKey(undefined)
  clearHookEventState()
  _resetHookExecutionStateForTesting()
})

afterEach(() => {
  getBootstrapSession().host = savedHost
  setDynamicTeamContext(null)
  resetTaskListState()
  _resetInheritedTeamNameForTesting()
  resetPendingShutdownRequestsForTesting()
  clearShownPlanDigests()
  setActiveLeadVerifyKey(undefined)
  clearHookEventState()
  _resetHookExecutionStateForTesting()
  resetSdkInitState()
  setMainThreadAgentHooks(undefined)
  switchSession(savedSessionId)

  if (savedConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  }
  if (savedTaskListEnv === undefined) {
    delete process.env.CLAUDE_CODE_TASK_LIST_ID
  } else {
    process.env.CLAUDE_CODE_TASK_LIST_ID = savedTaskListEnv
  }
  if (savedTeamNameEnv === undefined) {
    delete process.env.CLAUDE_CODE_TEAM_NAME
  } else {
    process.env.CLAUDE_CODE_TEAM_NAME = savedTeamNameEnv
  }
  if (savedInheritedTeamEnv === undefined) {
    delete process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME
  } else {
    process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME = savedInheritedTeamEnv
  }
  getClaudeConfigHomeDir.cache?.clear?.()
  rmSync(tempConfigDir, { recursive: true, force: true })
})

describe('2.1.331 per-SessionHost isolation: tasks.ts', () => {
  test('isolates leaderTeamName, sessionTaskListId, ownTaskListId, and getTaskListId across hosts', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()

    withHost(hostA, () => {
      setLeaderTeamName('team-host-a')
      setSessionTaskListId('session-list-a', { persist: false })
      setOwnTaskListId('own-list-a')
      expect(getLeaderTeamName()).toBe('team-host-a')
      expect(getSessionTaskListId()).toBe('session-list-a')
      expect(getOwnTaskListId('fallback-id')).toBe('own-list-a')
      expect(getTaskListId()).toBe('session-list-a')
    })

    withHost(hostB, () => {
      expect(getLeaderTeamName()).toBeUndefined()
      expect(getSessionTaskListId()).toBeUndefined()
      expect(getOwnTaskListId('fallback-id')).toBe('fallback-id')

      setLeaderTeamName('team-host-b')
      expect(getTaskListId()).toBe('team-host-b')

      // In-process teammate resolves hostB's sessionTaskListId override or teammate teamName
      const fromTeammateNoOverride = runWithTeammateContext(
        {
          agentId: 'worker@teammate-b',
          agentName: 'worker',
          teamName: 'teammate-b',
          parentSessionId: 'parent-b',
          isInProcess: true,
          abortController: new AbortController(),
          color: 'blue',
          planModeRequired: false,
        },
        () => getTaskListId(),
      )
      expect(fromTeammateNoOverride).toBe('teammate-b')

      setSessionTaskListId('session-list-b', { persist: false })
      clearLeaderTeamName()
      expect(getLeaderTeamName()).toBeUndefined()
      expect(getTaskListId()).toBe('session-list-b')

      resetTaskListState()
      expect(getSessionTaskListId()).toBeUndefined()
    })

    // Switching back to hostA proves hostB mutations/resets never touched hostA
    withHost(hostA, () => {
      expect(getLeaderTeamName()).toBe('team-host-a')
      expect(getSessionTaskListId()).toBe('session-list-a')
      expect(getOwnTaskListId('fallback-id')).toBe('own-list-a')
      expect(getTaskListId()).toBe('session-list-a')
    })
  })

  test('isolates onTasksUpdated subscribers and task-list persistence per host', async () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    let updatesA = 0
    let updatesB = 0

    const unsubA = withHost(hostA, () =>
      onTasksUpdated(() => {
        updatesA++
      }),
    )
    const unsubB = withHost(hostB, () =>
      onTasksUpdated(() => {
        updatesB++
      }),
    )

    try {
      withHost(hostA, () => {
        setSessionTaskListId('persisted-a', { persist: false })
      })
      expect(updatesA).toBe(1)
      expect(updatesB).toBe(0)

      withHost(hostB, () => {
        setSessionTaskListId('persisted-b', { persist: false })
        notifyTasksUpdated()
      })
      expect(updatesA).toBe(1)
      expect(updatesB).toBe(2)

      await withHostAsync(hostA, async () => {
        await persistSessionTaskListId('11111111-1111-1111-1111-111111111111')
        await noteSessionTaskListAfterClear(
          '22222222-2222-2222-2222-222222222222',
        )
      })
      await withHostAsync(hostB, async () => {
        await persistSessionTaskListId('33333333-3333-3333-3333-333333333333')
      })

      expect(
        readFileSync(
          join(getTasksDir('session-11111111'), SESSION_TASK_LIST_FILE),
          'utf8',
        ),
      ).toBe('persisted-a')
      expect(
        readFileSync(
          join(getTasksDir('session-22222222'), SESSION_LIST_FILE),
          'utf8',
        ),
      ).toBe('persisted-a')
      expect(
        readFileSync(
          join(getTasksDir('session-33333333'), SESSION_TASK_LIST_FILE),
          'utf8',
        ),
      ).toBe('persisted-b')
    } finally {
      unsubA()
      unsubB()
    }
  })

  test('resetSessionHostForTests mints a fresh host with clean task list state', () => {
    setLeaderTeamName('before-reset-team')
    setSessionTaskListId('before-reset-list', { persist: false })
    expect(getLeaderTeamName()).toBe('before-reset-team')

    const prevHost = getBootstrapSessionHost()
    resetSessionHostForTests()
    const nextHost = getBootstrapSessionHost()
    expect(nextHost).not.toBe(prevHost)
    expect(getLeaderTeamName()).toBeUndefined()
    expect(getSessionTaskListId()).toBeUndefined()
  })
})

describe('2.1.331 per-SessionHost isolation: swarm/sessionTeam.ts', () => {
  test('scopes inheritedTeamName latch and _resetInheritedTeamNameForTesting per SessionHost', async () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()

    switchSession(asSessionId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))

    // Host A consumes CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME = 'assistant-host-a'
    process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME = 'assistant-host-a'
    const resA1 = await withHostAsync(hostA, () => initializeSessionTeam())
    expect(resA1.teamContext.teamName).toBe('assistant-host-a')
    expect(process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME).toBeUndefined()

    // Host B has its own uninitialized latch; without env var it uses session-derived team name
    const resB1 = await withHostAsync(hostB, () => initializeSessionTeam())
    expect(resB1.teamContext.teamName).toBe(
      sessionTeamName('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    )

    // Resetting Host B and feeding a new env var latches 'assistant-host-b' on Host B only
    withHost(hostB, () => {
      _resetInheritedTeamNameForTesting()
    })
    process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME = 'assistant-host-b'
    const resB2 = await withHostAsync(hostB, () => initializeSessionTeam())
    expect(resB2.teamContext.teamName).toBe('assistant-host-b')

    // Host A still retains 'assistant-host-a' and skips startup rekeying
    const resA2 = await withHostAsync(hostA, () => initializeSessionTeam())
    expect(resA2.teamContext.teamName).toBe('assistant-host-a')

    switchSession(asSessionId('bbbbbbbb-cccc-dddd-eeee-ffffffffffff'))
    const startupRekeyA = await withHostAsync(hostA, () =>
      rekeySessionTeamAtStartup(),
    )
    expect(startupRekeyA).toBeUndefined()

    // Mid-session rekey on Host B clears Host B's inherited latch without clearing Host A's
    await withHostAsync(hostB, () => rekeySessionTeamInSession())
    const resA3 = await withHostAsync(hostA, () => initializeSessionTeam())
    expect(resA3.teamContext.teamName).toBe('assistant-host-a')
  })
})

describe('2.1.331 per-SessionHost isolation: teammateMailbox.ts', () => {
  test('isolates pendingShutdownRequests across concurrent SessionHost instances', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    const sharedReqId = 'shutdown-100@worker'

    withHost(hostA, () => {
      recordPendingShutdownRequest(sharedReqId, 'worker', true)
      recordPendingShutdownRequest('shutdown-101@helper', 'helper', true)
      expect(hasPendingShutdownRequestForAddressee(sharedReqId, 'worker')).toBe(
        true,
      )
    })

    // Host B cannot see, consume, or clear Host A's pending shutdown requests
    withHost(hostB, () => {
      expect(hasPendingShutdownRequestForAddressee(sharedReqId, 'worker')).toBe(
        false,
      )
      expect(consumePendingShutdownRequest(sharedReqId, 'worker')).toBe(false)

      recordPendingShutdownRequest(sharedReqId, 'worker', true)
      expect(consumePendingShutdownRequest(sharedReqId, 'worker')).toBe(true)
      // Second consume on Host B is rejected (replay guard)
      expect(consumePendingShutdownRequest(sharedReqId, 'worker')).toBe(false)

      clearPendingShutdownRequestsForAddressee('helper')
      removePendingShutdownRequest(sharedReqId)
      resetPendingShutdownRequestsForTesting()
    })

    // Host A's shutdown requests remain unused and valid
    withHost(hostA, () => {
      expect(hasPendingShutdownRequestForAddressee(sharedReqId, 'worker')).toBe(
        true,
      )
      expect(
        hasPendingShutdownRequestForAddressee('shutdown-101@helper', 'helper'),
      ).toBe(true)
      expect(consumePendingShutdownRequest(sharedReqId, 'worker')).toBe(true)
      expect(hasPendingShutdownRequestForAddressee(sharedReqId, 'worker')).toBe(
        false,
      )
    })
  })

  test('isolates shownPlanDigests and lead signing/verification state across hosts', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    const sharedPlanReqId = 'plan_approval-42@planner'
    const planContentA = '# Plan A\nStep 1: isolate per host'
    const planContentB = '# Plan B\nCompletely different plan in host B'
    const inboxPath = join(tempConfigDir, 'teams', 'alpha', 'inboxes', 'w.json')

    let keyA = ''
    withHost(hostA, () => {
      recordShownPlanDigest(sharedPlanReqId, planContentA)
      expect(getShownPlanDigest(sharedPlanReqId)).toBe(
        computePlanDigest(planContentA),
      )
      keyA = createTeamLeadEntryKeyForInbox(inboxPath)
      setActiveLeadVerifyKey(keyA)
      expect(hasTeamLeadEntryKeyForInbox(inboxPath)).toBe(true)
      expect(getActiveLeadVerifyKey()).toBe(keyA)
    })

    // Host B records a different plan under the same requestId without poisoning Host A
    withHost(hostB, () => {
      expect(getShownPlanDigest(sharedPlanReqId)).toBeUndefined()
      expect(hasTeamLeadEntryKeyForInbox(inboxPath)).toBe(false)
      expect(getActiveLeadVerifyKey()).toBeUndefined()

      recordShownPlanDigest(sharedPlanReqId, planContentB)
      expect(getShownPlanDigest(sharedPlanReqId)).toBe(
        computePlanDigest(planContentB),
      )

      invalidateAllShownPlanDigests()
      expect(getShownPlanDigest(sharedPlanReqId)).toBeUndefined()
      clearShownPlanDigests()
      resetTeamLeadVerificationOnSessionBoundary(Date.now() + 60_000)
    })

    // Host A's digest and lead signing key are completely unaffected
    withHost(hostA, () => {
      expect(getShownPlanDigest(sharedPlanReqId)).toBe(
        computePlanDigest(planContentA),
      )
      expect(hasTeamLeadEntryKeyForInbox(inboxPath)).toBe(true)
      expect(getActiveLeadVerifyKey()).toBe(keyA)
    })
  })
})

describe('2.1.331 WeakRef host slots & AsyncLocalStorage hook execution: sessionHooks.ts & hookEvents.ts', () => {
  test('addWeakRef (GWo) and collectWeakRefs (kDt) deduplicate live refs and prune collected WeakRefs', () => {
    const set = new Set<WeakRef<{ label: string }>>()
    const deadRef = {
      deref: () => undefined,
    } as unknown as WeakRef<{ label: string }>
    set.add(deadRef)

    const item1 = { label: 'one' }
    const item2 = { label: 'two' }

    expect(addWeakRef(set, item1)).toBe(true)
    // Dead ref was pruned during scan
    expect(set.has(deadRef)).toBe(false)
    // Duplicate add returns false without growing the set
    expect(addWeakRef(set, item1)).toBe(false)
    expect(addWeakRef(set, item2)).toBe(true)

    const deadRef2 = {
      deref: () => undefined,
    } as unknown as WeakRef<{ label: string }>
    set.add(deadRef2)

    expect(collectWeakRefs(set)).toEqual([item1, item2])
    expect(set.has(deadRef2)).toBe(false)
    expect(set.size).toBe(2)
  })

  test('registerHostHookOwner and collectHostRegisteredHooks (Q8l) scope WeakRef owners per SessionHost', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()

    const sessionA = createRootSession({
      host: hostA,
      id: 'session-a',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    sessionA.hookRegistry.holder().registeredHooks = { PreToolUse: [] }
    sessionA.hookRegistry.replaceMainThreadAgentHooks({ Stop: [] })

    const directOwnerB = {
      registeredHooks: { PostToolUse: [] },
      mainThreadAgentHooks: undefined,
    }

    withHost(hostA, () => {
      expect(registerHostHookOwner({ session: sessionA })).toBe(true)
      expect(getHostHookOwners()).toHaveLength(1)
      expect(collectHostRegisteredHooks()).toEqual([
        { PreToolUse: [] },
        { Stop: [] },
      ])
    })

    withHost(hostB, () => {
      expect(getHostHookOwners()).toHaveLength(0)
      expect(collectHostRegisteredHooks()).toEqual([])
      expect(registerHostHookOwner(directOwnerB)).toBe(true)
      expect(collectHostRegisteredHooks()).toEqual([
        { PostToolUse: [] },
        undefined,
      ])
    })

    // Also verifies bootstrap session's own hookRegistry works seamlessly
    registerHookCallbacks({ SessionStart: [] })
    setMainThreadAgentHooks({ SubagentStop: [] })
    expect(getRegisteredHooks()).toEqual({ SessionStart: [] })
  })

  test('isolates getSkillHookDraws, getHostSessionHookStores, and getBootstrapSessionHooksState per host', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    const sharedSessionId = 'shared-skill-session'
    const harnessA = makeAppStateHarness()
    const harnessB = makeAppStateHarness()

    withHost(hostA, () => {
      const drawsA = getSkillHookDraws(sharedSessionId)
      drawsA.set('skill-src', {
        hooks: 3,
        characters: 42,
        texts: new Map([['hash-a', undefined]]),
        unfitTexts: 0,
      })
      addSessionHook(harnessA.set, sharedSessionId, 'Stop', '', {
        type: 'command',
        command: 'echo host-a',
      })
      expect(getHostSessionHookStores()).toContain(harnessA.get().sessionHooks)
    })

    withHost(hostB, () => {
      const drawsB = getSkillHookDraws(sharedSessionId)
      expect(drawsB.size).toBe(0)
      drawsB.set('skill-src', {
        hooks: 1,
        characters: 10,
        texts: new Map(),
        unfitTexts: 0,
      })

      addSessionHook(harnessB.set, sharedSessionId, 'Stop', '', {
        type: 'command',
        command: 'echo host-b',
      })
      expect(getHostSessionHookStores()).toContain(harnessB.get().sessionHooks)
      expect(getHostSessionHookStores()).not.toContain(
        harnessA.get().sessionHooks,
      )

      // Clearing sharedSessionId on Host B must not clear Host A's skill hook draws
      clearSessionHooks(harnessB.set, sharedSessionId)
      expect(getSkillHookDraws(sharedSessionId).size).toBe(0)
    })

    withHost(hostA, () => {
      expect(getSkillHookDraws(sharedSessionId).get('skill-src')?.hooks).toBe(3)
      expect(getHostSessionHookStores()).toContain(harnessA.get().sessionHooks)
    })

    // Root-session scoped SessionHooksState is isolated per root session
    const root1 = createRootSession({
      host: hostA,
      id: 'root-1',
      project: { originalCwd: '/tmp', projectRoot: '/tmp', cwd: '/tmp' },
    })
    expect(root1.id).toBe('root-1')
    const defaultSessionMap = getBootstrapSessionHooksState()
    defaultSessionMap.set('s1', { hooks: {} })
    resetSessionHostForTests()
    expect(getBootstrapSessionHooksState().has('s1')).toBe(false)
  })

  test('tracks AsyncLocalStorage hook execution (isInsideHookExecution Xye) across concurrent async chains and callbacks', async () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()

    expect(isInsideHookExecution()).toBe(false)
    expect(hasEnteredHookExecution()).toBe(false)
    expect(withHost(hostA, () => hasHostEnteredHookExecution())).toBe(false)
    expect(withHost(hostB, () => hasHostEnteredHookExecution())).toBe(false)

    // Concurrent async branches: ALS isolates inside-hook vs outside-hook execution
    const [insideResult, outsideResult] = await Promise.all([
      withHostAsync(hostA, () =>
        runInsideHookExecution(
          async () => {
            const beforeAwait = isInsideHookExecution()
            await new Promise(resolve => setTimeout(resolve, 5))
            const afterAwait = isInsideHookExecution()
            const ctx = getHookExecutionContext()
            const exited = exitHookExecution(() => isInsideHookExecution())
            const restoredAfterExit = isInsideHookExecution()
            return { beforeAwait, afterAwait, ctx, exited, restoredAfterExit }
          },
          { hookEvent: 'PreToolUse', sessionId: 'sess-als', hookName: 'guard' },
        ),
      ),
      (async () => {
        const startOutside = isInsideHookExecution()
        await new Promise(resolve => setTimeout(resolve, 5))
        return {
          startOutside,
          afterAwaitOutside: isInsideHookExecution(),
          ctx: getHookExecutionContext(),
        }
      })(),
    ])

    expect(insideResult).toEqual({
      beforeAwait: true,
      afterAwait: true,
      ctx: {
        hookEvent: 'PreToolUse',
        sessionId: 'sess-als',
        hookName: 'guard',
      },
      exited: false,
      restoredAfterExit: true,
    })
    expect(outsideResult).toEqual({
      startOutside: false,
      afterAwaitOutside: false,
      ctx: undefined,
    })
    expect(isInsideHookExecution()).toBe(false)
    expect(hasEnteredHookExecution()).toBe(true)
    expect(withHost(hostA, () => hasHostEnteredHookExecution())).toBe(true)
    expect(withHost(hostB, () => hasHostEnteredHookExecution())).toBe(false)

    // FunctionHook callbacks (AppState & SessionHooksRegistry) and onHookSuccess enter ALS automatically
    const harness = makeAppStateHarness()
    let observedInAppStateFnHook = false
    let observedHookId: string | undefined
    addFunctionHook(
      harness.set,
      'sess-fn',
      'Stop',
      '',
      async () => {
        await Promise.resolve()
        observedInAppStateFnHook = isInsideHookExecution()
        observedHookId = getHookExecutionContext()?.hookId
        return true
      },
      'blocked',
      { id: 'fn-als-check' },
    )
    const storedFnHook = harness.get().sessionHooks.get('sess-fn')!.hooks
      .Stop![0]!.hooks[0]!.hook as FunctionHook
    expect(await storedFnHook.callback([])).toBe(true)
    expect(observedInAppStateFnHook).toBe(true)
    expect(observedHookId).toBe('fn-als-check')
    expect(isInsideHookExecution()).toBe(false)

    // SessionHooksRegistry-bound FunctionHook callback also enters ALS
    const registry = createSessionHooksRegistry()
    let regState = { sessionHooks: new Map() } as unknown as AppState
    const setRegState = (updater: (prev: AppState) => AppState) => {
      regState = updater(regState)
    }
    registry.bindStore({
      getState: () => regState,
      setState: setRegState,
    })
    let observedInRegistryFnHook = false
    addFunctionHook(
      setRegState,
      'sess-reg',
      'Stop',
      '',
      async () => {
        await Promise.resolve()
        observedInRegistryFnHook = isInsideHookExecution()
        return true
      },
      'blocked',
      { id: 'reg-fn-als' },
    )
    const regMatchers = registry
      .getFunctionHooks('sess-reg', 'Stop')
      .get('Stop')
    expect(await regMatchers![0]!.hooks[0]!.callback([])).toBe(true)
    expect(observedInRegistryFnHook).toBe(true)

    // onHookSuccess callback also runs inside ALS hook execution scope
    const cmdHook = { type: 'command' as const, command: 'echo ok' }
    let observedInOnHookSuccess = false
    addSessionHook(
      harness.set,
      'sess-cmd',
      'PostToolUse',
      'Bash',
      cmdHook,
      () => {
        observedInOnHookSuccess = isInsideHookExecution()
      },
    )
    const cbEntry = getSessionHookCallback(
      harness.get(),
      'sess-cmd',
      'PostToolUse',
      'Bash',
      cmdHook,
    )
    cbEntry?.onHookSuccess?.(cmdHook, {} as never)
    expect(observedInOnHookSuccess).toBe(true)
    expect(isInsideHookExecution()).toBe(false)
  })

  test('isolates hookEvents.ts pending buffer, eventHandler, and allHookEventsEnabled per SessionHost', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    const eventsA: HookExecutionEvent[] = []
    const eventsB: HookExecutionEvent[] = []

    // Buffer a SessionStart event on Host A before registering a handler
    withHost(hostA, () => {
      emitHookStarted('h-a-1', 'SessionStart:init', 'SessionStart')
      // Non-always event ignored while allHookEventsEnabled is false
      emitHookStarted('h-a-ignored', 'PreToolUse:Bash', 'PreToolUse')
      setAllHookEventsEnabled(true)
      emitHookStarted('h-a-2', 'PreToolUse:Bash', 'PreToolUse')
    })

    // Host B has an empty queue and allHookEventsEnabled === false
    withHost(hostB, () => {
      registerHookEventHandler(ev => eventsB.push(ev))
      expect(eventsB).toHaveLength(0)

      emitHookStarted('h-b-ignored', 'PreToolUse:Bash', 'PreToolUse')
      expect(eventsB).toHaveLength(0)

      emitHookResponse({
        hookId: 'h-b-setup',
        hookName: 'Setup:env',
        hookEvent: 'Setup',
        output: 'ready',
        stdout: 'ready',
        stderr: '',
        exitCode: 0,
        outcome: 'success',
      })
      expect(eventsB.map(e => e.hookId)).toEqual(['h-b-setup'])

      // Clearing Host B's hook event state does not affect Host A
      clearHookEventState()
    })

    // Registering handler on Host A flushes Host A's buffered events in order
    withHost(hostA, () => {
      registerHookEventHandler(ev => eventsA.push(ev))
      expect(eventsA.map(e => e.hookId)).toEqual(['h-a-1', 'h-a-2'])

      emitHookStarted('h-a-3', 'PostToolUse:Bash', 'PostToolUse')
      expect(eventsA.map(e => e.hookId)).toEqual(['h-a-1', 'h-a-2', 'h-a-3'])
    })
  })

  test('runWithNewHostSession isolates concurrent Promise.all hosts across await ticks', async () => {
    const reqId = 'shutdown-concurrent@worker'
    const planReqId = 'plan_approval-concurrent@planner'

    const [out1, out2] = await Promise.all([
      runWithNewHostSession(
        { id: '11111111-aaaa-bbbb-cccc-111111111111' },
        async session1 => {
          setLeaderTeamName('als-team-1')
          setSessionTaskListId('als-list-1', { persist: false })
          recordPendingShutdownRequest(reqId, 'worker', true)
          recordShownPlanDigest(planReqId, 'plan content for host 1')
          getSkillHookDraws('sess-x').set('src', {
            hooks: 7,
            characters: 70,
            texts: new Map(),
            unfitTexts: 0,
          })
          emitHookStarted('als-h1', 'SessionStart:1', 'SessionStart')

          await new Promise(resolve => setTimeout(resolve, 10))

          const flushed1: string[] = []
          registerHookEventHandler(ev => flushed1.push(ev.hookId))
          return {
            hostMatches: getBootstrapSessionHost() === session1.host,
            leaderTeam: getLeaderTeamName(),
            taskListId: getTaskListId(),
            canConsumeShutdown: consumePendingShutdownRequest(reqId, 'worker'),
            planDigest: getShownPlanDigest(planReqId),
            skillHooksCount: getSkillHookDraws('sess-x').get('src')?.hooks,
            flushedHookIds: flushed1,
          }
        },
      ),
      runWithNewHostSession(
        { id: '22222222-aaaa-bbbb-cccc-222222222222' },
        async session2 => {
          await new Promise(resolve => setTimeout(resolve, 3))
          setLeaderTeamName('als-team-2')
          recordPendingShutdownRequest(reqId, 'worker', true)
          const firstConsume = consumePendingShutdownRequest(reqId, 'worker')
          resetPendingShutdownRequestsForTesting()
          recordShownPlanDigest(planReqId, 'plan content for host 2')
          clearShownPlanDigests()
          clearHookEventState()

          await new Promise(resolve => setTimeout(resolve, 10))

          return {
            hostMatches: getBootstrapSessionHost() === session2.host,
            leaderTeam: getLeaderTeamName(),
            firstConsume,
            planDigestAfterClear: getShownPlanDigest(planReqId),
            skillDrawsSize: getSkillHookDraws('sess-x').size,
          }
        },
      ),
    ])

    expect(out1).toEqual({
      hostMatches: true,
      leaderTeam: 'als-team-1',
      taskListId: 'als-list-1',
      canConsumeShutdown: true,
      planDigest: computePlanDigest('plan content for host 1'),
      skillHooksCount: 7,
      flushedHookIds: ['als-h1'],
    })
    expect(out2).toEqual({
      hostMatches: true,
      leaderTeam: 'als-team-2',
      firstConsume: true,
      planDigestAfterClear: undefined,
      skillDrawsSize: 0,
    })
  })
})
