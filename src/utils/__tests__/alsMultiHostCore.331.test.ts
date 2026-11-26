import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  addToTotalLinesChanged,
  getAutoCompactWindowSurface,
  getCachedClaudeMdContent,
  getCwdState,
  getFlagMcpConfigFilePaths,
  getFlagSettingsInline,
  getIsInteractive,
  getIsNonInteractiveSession,
  getIsRemoteMode,
  getMainLoopBusy,
  getMainThreadAgentId,
  getMainThreadAgentType,
  getOriginalCwd,
  getParentSessionId,
  getProjectRoot,
  getSdkBetas,
  getSessionId,
  getSessionProjectDir,
  getStickyBetas,
  getTotalCostUSD,
  getTotalInputTokens,
  getTotalLinesAdded,
  getTotalLinesRemoved,
  getTotalOutputTokens,
  isSessionPersistenceDisabled,
  isStickyBetaRejected,
  isStickyBetaSentActive,
  isTeleportedSessionId,
  markTeleportedSessionId,
  onSessionSwitch,
  regenerateSessionId,
  resetStateForTests,
  resetStickyBetas,
  setAttacherCaps,
  setAutoCompactWindowSurface,
  setCachedClaudeMdContent,
  setCwdState,
  setFlagMcpConfigFilePaths,
  setFlagSettingsInline,
  setIsInteractive,
  setIsRemoteMode,
  setMainLoopBusy,
  setMainThreadAgentType,
  setOriginalCwd,
  setProjectRoot,
  setSdkBetas,
  setSessionOverridesGetter,
  setSessionPersistenceDisabled,
  stickyRejectBeta,
  stickySendBeta,
  subscribeAttacherCaps,
  subscribeMainLoopBusy,
  switchSession,
} from '../../bootstrap/state.js'
import { addToTotalSessionCost } from '../../cost-tracker.js'
import type { SessionId } from '../../types/ids.js'
import { HostSlot, RootSessionSlot } from '../hostSlot.js'
import {
  createSafeAsyncLocalStorage,
  exitSessionContext,
  getActiveSessionFromAls,
  getActiveSubconversationFromAls,
  getSessionAlsStore,
  hasActiveSessionAls,
  runWithNewHostSession,
  runWithSession,
  runWithSubconversationContext,
} from '../sessionContextAls.js'
import {
  emitProcessEnvChange,
  getBootstrapSession,
  getBootstrapSessionHost,
  installStoppedByPerson,
  isAgentStoppedByPerson,
  isDisklessLaunch,
  markWarmSpareClaimed,
  subscribeProcessEnvChange,
  wasWarmSpareClaimed,
} from '../sessionHost.js'
import {
  getActiveSubconversation,
  getSessionOnceLatches,
  ofDefaultHost,
  registerSessionContextReader,
} from '../sessionRoot.js'

function makeUsage(inputTokens: number, outputTokens: number): Usage {
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: null,
    server_tool_use: null,
    service_tier: null,
    inference_geo: null,
    iterations: null,
    speed: null,
  }
}

const tick = (ms = 2): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

beforeEach(() => {
  registerSessionContextReader(getSessionAlsStore)
  resetStateForTests()
})

afterEach(() => {
  registerSessionContextReader(getSessionAlsStore)
  resetStateForTests()
})

describe('2.1.331 HostSlot (W) & RootSessionSlot ($e / Ln)', () => {
  test('HostSlot lazily instantiates per host, peeks without allocating, and drops cleanly', () => {
    let factoryCalls = 0
    const slot = new HostSlot(() => ({
      id: ++factoryCalls,
      tags: new Set<string>(),
    }))
    const hostA = {}
    const hostB = {}

    expect(slot.peek(hostA)).toBeUndefined()
    expect(factoryCalls).toBe(0)

    const valA1 = slot.of(hostA)
    expect(valA1.id).toBe(1)
    expect(slot.peek(hostA)).toBe(valA1)
    expect(slot.of(hostA)).toBe(valA1)
    expect(factoryCalls).toBe(1)

    const valB = slot.of(hostB)
    expect(valB.id).toBe(2)
    expect(valB).not.toBe(valA1)
    expect(factoryCalls).toBe(2)

    slot.drop(hostA)
    expect(slot.peek(hostA)).toBeUndefined()
    expect(slot.peek(hostB)).toBe(valB)

    const valA2 = slot.of(hostA)
    expect(valA2.id).toBe(3)
    expect(valA2).not.toBe(valA1)
  })

  test('HostSlot memoizes undefined factory values without re-invoking factory', () => {
    let calls = 0
    const slot = new HostSlot<string | undefined>(() => {
      calls++
      return undefined
    })
    const host = {}
    expect(slot.of(host)).toBeUndefined()
    expect(slot.of(host)).toBeUndefined()
    expect(calls).toBe(1)
  })

  test('RootSessionSlot shares state across withProject forks of the same root session', () => {
    let calls = 0
    const rootSlot = new RootSessionSlot(() => ({ seq: ++calls }))

    runWithNewHostSession({ id: 'root-1', cwd: '/tmp/r1' }, rootA => {
      const forkA1 = rootA.withProject({ cwd: '/tmp/r1/sub1' })
      const forkA2 = forkA1.withProject({ cwd: '/tmp/r1/sub2' })

      const bagFromRoot = rootSlot.of(rootA)
      expect(rootSlot.of(forkA1)).toBe(bagFromRoot)
      expect(rootSlot.of(forkA2)).toBe(bagFromRoot)
      expect(rootSlot.peek(forkA2)).toBe(bagFromRoot)
      expect(calls).toBe(1)

      runWithNewHostSession({ id: 'root-2', cwd: '/tmp/r2' }, rootB => {
        const bagB = rootSlot.of(rootB)
        expect(bagB).not.toBe(bagFromRoot)
        expect(calls).toBe(2)
      })

      rootSlot.drop(forkA1)
      expect(rootSlot.peek(rootA)).toBeUndefined()
    })
  })
})

describe('2.1.331 safe graceful fallback (@21221655) & Ayd reader wiring', () => {
  test('createSafeAsyncLocalStorage(undefined) provides stack-safe run/exit/getStore fallback', () => {
    const fallback = createSafeAsyncLocalStorage<{ name: string }>(undefined)
    expect(fallback.getStore()).toBeUndefined()

    const result = fallback.run({ name: 'outer' }, () => {
      expect(fallback.getStore()?.name).toBe('outer')
      const inner = fallback.run({ name: 'inner' }, () => {
        expect(fallback.getStore()?.name).toBe('inner')
        const exited = fallback.exit(() => fallback.getStore())
        expect(exited).toBeUndefined()
        expect(fallback.getStore()?.name).toBe('inner')
        return 'ok'
      })
      expect(fallback.getStore()?.name).toBe('outer')
      return inner
    })

    expect(result).toBe('ok')
    expect(fallback.getStore()).toBeUndefined()
  })

  test('setSessionOverridesGetter (Ayd) allows custom session reader override and restore', () => {
    const defaultId = getSessionId()
    setSessionOverridesGetter(() => ({
      sessionId: 'custom-override-session',
      parentSessionId: 'custom-parent-session',
    }))
    expect(getSessionId()).toBe('custom-override-session' as SessionId)
    expect(getParentSessionId()).toBe('custom-parent-session' as SessionId)

    setSessionOverridesGetter(getSessionAlsStore)
    expect(getSessionId()).toBe(defaultId)
  })
})

describe('2.1.331 concurrent multi-host AsyncLocalStorage isolation', () => {
  test('4 concurrent runWithNewHostSession workers with interleaved awaits never clobber state', async () => {
    const defaultSession = getBootstrapSession()
    const defaultHost = getBootstrapSessionHost()
    const defaultSessionId = getSessionId()
    const defaultOrigCwd = getOriginalCwd()
    setFlagSettingsInline({ tier: 'default-bootstrap' })
    setIsInteractive(false)

    const defaultSwitchEvents: Array<{ id: string; reason?: string }> = []
    const unsubDefaultSwitch = onSessionSwitch((id, reason) => {
      defaultSwitchEvents.push({ id, reason })
    })

    const hostCounterSlot = new HostSlot(() => ({ hits: 0, label: '' }))
    ofDefaultHost(hostCounterSlot).label = 'default-host'

    const workerConfigs = [
      {
        idx: 0,
        initialId: 'sess-alpha-0',
        switchedId: 'sess-alpha-resumed',
        parentId: 'parent-alpha',
        origCwd: '/workspace/alpha',
        nextCwd: '/workspace/alpha/packages/api',
        projectRoot: '/workspace/alpha-root',
        interactive: true,
        diskless: false,
        remote: true,
        persistenceDisabled: false,
        cost1: 0.25,
        cost2: 0.5,
        inTokens: 100,
        outTokens: 40,
        linesAdded: 12,
        linesRemoved: 3,
      },
      {
        idx: 1,
        initialId: 'sess-bravo-0',
        switchedId: 'sess-bravo-resumed',
        parentId: 'parent-bravo',
        origCwd: '/workspace/bravo',
        nextCwd: '/workspace/bravo/apps/web',
        projectRoot: '/workspace/bravo-root',
        interactive: false,
        diskless: true,
        remote: false,
        persistenceDisabled: true,
        cost1: 1.0,
        cost2: 2.25,
        inTokens: 200,
        outTokens: 80,
        linesAdded: 25,
        linesRemoved: 7,
      },
      {
        idx: 2,
        initialId: 'sess-charlie-0',
        switchedId: 'sess-charlie-resumed',
        parentId: 'parent-charlie',
        origCwd: '/workspace/charlie',
        nextCwd: '/workspace/charlie/services/worker',
        projectRoot: '/workspace/charlie-root',
        interactive: true,
        diskless: true,
        remote: true,
        persistenceDisabled: true,
        cost1: 3.5,
        cost2: 0.75,
        inTokens: 300,
        outTokens: 120,
        linesAdded: 40,
        linesRemoved: 10,
      },
      {
        idx: 3,
        initialId: 'sess-delta-0',
        switchedId: 'sess-delta-resumed',
        parentId: 'parent-delta',
        origCwd: '/workspace/delta',
        nextCwd: '/workspace/delta/tools/cli',
        projectRoot: '/workspace/delta-root',
        interactive: false,
        diskless: false,
        remote: false,
        persistenceDisabled: false,
        cost1: 5.0,
        cost2: 1.5,
        inTokens: 400,
        outTokens: 160,
        linesAdded: 60,
        linesRemoved: 15,
      },
    ] as const

    const results = await Promise.all(
      workerConfigs.map(cfg =>
        runWithNewHostSession(
          {
            id: cfg.initialId,
            parentId: cfg.parentId,
            originalCwd: cfg.origCwd,
            projectRoot: cfg.projectRoot,
            cwd: cfg.origCwd,
            isInteractive: cfg.interactive,
            diskless: cfg.diskless,
          },
          async session => {
            expect(hasActiveSessionAls()).toBe(true)
            expect(getActiveSessionFromAls()).toBe(session)
            expect(getActiveSubconversationFromAls()).toBeUndefined()
            expect(getBootstrapSession()).toBe(session)
            expect(getBootstrapSessionHost()).toBe(session.host)
            expect(session.host).not.toBe(defaultHost)

            // Do(slot) always resolves against the process-default host, while
            // slot.of(getBootstrapSessionHost()) isolates per ALS host.
            expect(ofDefaultHost(hostCounterSlot).label).toBe('default-host')
            const mySlot = hostCounterSlot.of(getBootstrapSessionHost())
            mySlot.label = `worker-${cfg.idx}`
            mySlot.hits += 1

            const switchLog: Array<{ id: string; reason?: string }> = []
            const unsubSwitch = onSessionSwitch((id, reason) => {
              switchLog.push({ id, reason })
            })

            let busyNotifications = 0
            const unsubBusy = subscribeMainLoopBusy(() => {
              busyNotifications++
            })

            let attacherNotifications = 0
            const unsubAttacher = subscribeAttacherCaps(() => {
              attacherNotifications++
            })

            let envNotifications = 0
            const unsubEnv = subscribeProcessEnvChange(() => {
              envNotifications++
            })

            installStoppedByPerson(agentId => agentId === `person-${cfg.idx}`)

            expect(getSessionId()).toBe(cfg.initialId as SessionId)
            expect(getParentSessionId()).toBe(cfg.parentId as SessionId)
            expect(getOriginalCwd()).toBe(cfg.origCwd)
            expect(getProjectRoot()).toBe(cfg.projectRoot)
            expect(getCwdState()).toBe(cfg.origCwd)
            expect(getIsInteractive()).toBe(cfg.interactive)
            expect(getIsNonInteractiveSession()).toBe(!cfg.interactive)
            expect(isDisklessLaunch()).toBe(cfg.diskless)

            // Interleaved yield #1
            await Promise.resolve()
            await tick((cfg.idx + 1) * 3)

            // Mutate CWD, flags, settings, remote mode, cost, host slots
            setCwdState(cfg.nextCwd)
            setFlagSettingsInline({ worker: cfg.idx, name: cfg.initialId })
            setFlagMcpConfigFilePaths([`/etc/mcp-${cfg.idx}.json`])
            setAutoCompactWindowSurface(`surface-${cfg.idx}`)
            setIsRemoteMode(cfg.remote)
            setSessionPersistenceDisabled(cfg.persistenceDisabled)
            markTeleportedSessionId(`session_tp_${cfg.idx}`)
            if (cfg.idx % 2 === 0) {
              markWarmSpareClaimed()
            }
            setMainLoopBusy(true)
            setAttacherCaps({ workerIdx: cfg.idx })
            emitProcessEnvChange()

            expect(getSessionOnceLatches().once('shared-latch-key')).toBe(true)
            expect(getSessionOnceLatches().once('shared-latch-key')).toBe(false)

            addToTotalSessionCost(
              cfg.cost1,
              makeUsage(cfg.inTokens, cfg.outTokens),
              'claude-sonnet-4-6',
            )
            addToTotalLinesChanged(cfg.linesAdded, cfg.linesRemoved)

            // Interleaved yield #2
            await tick((4 - cfg.idx) * 3)
            await Promise.resolve()

            // Switch session mid-flight and accumulate more cost
            switchSession(
              cfg.switchedId as SessionId,
              `/projects/dir-${cfg.idx}`,
              'resume',
            )
            mySlot.hits += 1
            addToTotalSessionCost(
              cfg.cost2,
              makeUsage(cfg.inTokens, cfg.outTokens),
              'claude-sonnet-4-6',
            )

            // Interleaved yield #3 + temporary exitSessionContext check
            await tick(2)
            const exitedSnapshot = await exitSessionContext(async () => {
              expect(hasActiveSessionAls()).toBe(false)
              await Promise.resolve()
              return {
                id: getSessionId(),
                origCwd: getOriginalCwd(),
                inline: getFlagSettingsInline(),
                interactive: getIsInteractive(),
              }
            })
            expect(exitedSnapshot).toEqual({
              id: defaultSessionId,
              origCwd: defaultOrigCwd,
              inline: { tier: 'default-bootstrap' },
              interactive: false,
            })

            // Verify ALS context is still intact after exitSessionContext returns!
            expect(getSessionId()).toBe(cfg.switchedId as SessionId)
            expect(getParentSessionId()).toBeUndefined()
            expect(getSessionProjectDir()).toBe(`/projects/dir-${cfg.idx}`)
            expect(getOriginalCwd()).toBe(cfg.origCwd)
            expect(getProjectRoot()).toBe(cfg.projectRoot)
            expect(getCwdState()).toBe(cfg.nextCwd)
            expect(getIsInteractive()).toBe(cfg.interactive)
            expect(isDisklessLaunch()).toBe(cfg.diskless)
            expect(getIsRemoteMode()).toBe(cfg.remote)
            expect(isSessionPersistenceDisabled()).toBe(cfg.persistenceDisabled)
            expect(getFlagSettingsInline()).toEqual({
              worker: cfg.idx,
              name: cfg.initialId,
            })
            expect(getFlagMcpConfigFilePaths()).toEqual([
              `/etc/mcp-${cfg.idx}.json`,
            ])
            expect(getAutoCompactWindowSurface()).toBe(`surface-${cfg.idx}`)
            expect(getTotalCostUSD()).toBeCloseTo(cfg.cost1 + cfg.cost2, 6)
            expect(getTotalInputTokens()).toBe(cfg.inTokens * 2)
            expect(getTotalOutputTokens()).toBe(cfg.outTokens * 2)
            expect(getTotalLinesAdded()).toBe(cfg.linesAdded)
            expect(getTotalLinesRemoved()).toBe(cfg.linesRemoved)
            expect(hostCounterSlot.of(getBootstrapSessionHost())).toEqual({
              hits: 2,
              label: `worker-${cfg.idx}`,
            })

            // Host-scoped bags in sessionHost.ts never leak across workers
            expect(isTeleportedSessionId(`tp_${cfg.idx}`)).toBe(true)
            for (const other of workerConfigs) {
              if (other.idx !== cfg.idx) {
                expect(isTeleportedSessionId(`tp_${other.idx}`)).toBe(false)
              }
            }
            expect(wasWarmSpareClaimed()).toBe(cfg.idx % 2 === 0)
            expect(isAgentStoppedByPerson(`person-${cfg.idx}`, false)).toBe(
              true,
            )
            expect(isAgentStoppedByPerson(`person-other`, false)).toBe(false)

            // Per-session listeners only fired for THIS session
            expect(switchLog).toEqual([
              { id: cfg.switchedId, reason: 'resume' },
            ])
            expect(getMainLoopBusy()).toBe(true)
            expect(busyNotifications).toBe(1)
            expect(attacherNotifications).toBe(1)
            expect(envNotifications).toBe(1)

            // Regenerate session ID with setCurrentAsParent inside this worker
            const regeneratedId = regenerateSessionId({
              setCurrentAsParent: true,
            })
            expect(getSessionId()).toBe(regeneratedId)
            expect(getParentSessionId()).toBe(cfg.switchedId as SessionId)
            expect(switchLog).toEqual([
              { id: cfg.switchedId, reason: 'resume' },
              { id: regeneratedId, reason: 'clear' },
            ])

            unsubSwitch()
            unsubBusy()
            unsubAttacher()
            unsubEnv()
            return regeneratedId
          },
        ),
      ),
    )

    unsubDefaultSwitch()

    // All 4 regenerated IDs must be distinct
    expect(new Set(results).size).toBe(4)

    // Default bootstrap session was NEVER mutated or notified by any worker
    expect(hasActiveSessionAls()).toBe(false)
    expect(getBootstrapSession()).toBe(defaultSession)
    expect(getBootstrapSessionHost()).toBe(defaultHost)
    expect(getSessionId()).toBe(defaultSessionId)
    expect(getOriginalCwd()).toBe(defaultOrigCwd)
    expect(getFlagSettingsInline()).toEqual({ tier: 'default-bootstrap' })
    expect(getIsInteractive()).toBe(false)
    expect(getTotalCostUSD()).toBe(0)
    expect(defaultSwitchEvents).toEqual([])
  })

  test('runWithSession isolates withProject fork CWD while sharing root costLedger and switch signal', async () => {
    await runWithNewHostSession(
      { id: 'root-main', originalCwd: '/repo', cwd: '/repo' },
      async rootSession => {
        const fork = rootSession.withProject({ cwd: '/repo/packages/sub' })
        const rootSwitches: string[] = []
        const unsub = onSessionSwitch(id => rootSwitches.push(id))

        await Promise.all([
          (async () => {
            await tick(2)
            expect(getCwdState()).toBe('/repo')
            addToTotalSessionCost(1.5, makeUsage(50, 25), 'claude-sonnet-4-6')
          })(),
          runWithSession(fork, async () => {
            expect(getCwdState()).toBe('/repo/packages/sub')
            expect(getOriginalCwd()).toBe('/repo')
            setCwdState('/repo/packages/sub/deep')
            await tick(4)
            expect(getCwdState()).toBe('/repo/packages/sub/deep')
            addToTotalSessionCost(2.5, makeUsage(70, 35), 'claude-sonnet-4-6')
          }),
        ])

        // Root CWD stayed '/repo', fork CWD updated independently, costLedger shared!
        expect(getCwdState()).toBe('/repo')
        expect(fork.project.cwd).toBe('/repo/packages/sub/deep')
        expect(getTotalCostUSD()).toBeCloseTo(4.0, 6)

        switchSession('root-switched' as SessionId, null, 'resume')
        expect(fork.id).toBe('root-switched')
        expect(rootSwitches).toEqual(['root-switched'])
        unsub()
      },
    )
  })

  test('runWithSubconversationContext (h()) overrides subconversation fields without replacing root Session (n())', async () => {
    await runWithNewHostSession(
      {
        id: 'main-conv-id',
        parentId: 'main-parent-id',
        originalCwd: '/main/orig',
        projectRoot: '/main/root',
        cwd: '/main/orig',
      },
      async rootSession => {
        setSdkBetas(['main-beta'])
        stickySendBeta('main-sticky')
        setCachedClaudeMdContent('MAIN_CLAUDE_MD')
        setMainThreadAgentType('main-agent')

        const subStickySet = new Set<string>(['sub-initial-beta'])
        await runWithSubconversationContext(
          {
            sessionId: 'subconv-id-1',
            parentSessionId: 'main-conv-id',
            originalCwd: '/sub/orig',
            projectRoot: '/sub/root',
            sessionProjectDir: '/sub/transcripts',
            sdkBetas: ['sub-sdk-beta'],
            stickyBetas: subStickySet,
            conversationAtisLatch: { latched: true },
            conversationToolsUsed: ['Bash'],
          },
          async () => {
            await tick(2)
            // n() still points to rootSession, while h() returns the subconversation overlay
            expect(getBootstrapSession()).toBe(rootSession)
            expect(getActiveSessionFromAls()).toBe(rootSession)
            expect(getActiveSubconversation()?.sessionId).toBe('subconv-id-1')
            expect(getActiveSubconversation()?.conversationAtisLatch).toEqual({
              latched: true,
            })
            expect(getActiveSubconversation()?.conversationToolsUsed).toEqual([
              'Bash',
            ])

            // B(), y_t(), rt(), ve(), Fr(), xae(), Yh() read subconversation context
            expect(getSessionId()).toBe('subconv-id-1' as SessionId)
            expect(getParentSessionId()).toBe('main-conv-id' as SessionId)
            expect(String(getMainThreadAgentId())).toBe('subconv-id-1')
            expect(getOriginalCwd()).toBe('/sub/orig')
            expect(getProjectRoot()).toBe('/sub/root')
            expect(getSessionProjectDir()).toBe('/sub/transcripts')
            expect(getSdkBetas()).toEqual(['sub-sdk-beta'])

            // Subconversation stickyBetas & ClaudeMd & agentType isolate from rootSession
            expect(isStickyBetaSentActive('sub-initial-beta')).toBe(true)
            expect(isStickyBetaSentActive('main-sticky')).toBe(false)
            stickySendBeta('sub-added-beta')
            expect(subStickySet.has('sub-added-beta')).toBe(true)
            stickyRejectBeta('sub-initial-beta')
            expect(isStickyBetaRejected('sub-initial-beta')).toBe(true)

            setCachedClaudeMdContent('SUB_CLAUDE_MD')
            expect(getCachedClaudeMdContent()).toBe('SUB_CLAUDE_MD')
            setMainThreadAgentType('sub-agent')
            expect(getMainThreadAgentType()).toBe('sub-agent')

            resetStickyBetas()
            expect(getStickyBetas().sent.size).toBe(0)
          },
        )

        // Root session state is completely untouched after subconversation exits
        expect(getActiveSubconversation()).toBeUndefined()
        expect(getSessionId()).toBe('main-conv-id' as SessionId)
        expect(getParentSessionId()).toBe('main-parent-id' as SessionId)
        expect(getOriginalCwd()).toBe('/main/orig')
        expect(getProjectRoot()).toBe('/main/root')
        expect(getSdkBetas()).toEqual(['main-beta'])
        expect(isStickyBetaSentActive('main-sticky')).toBe(true)
        expect(getCachedClaudeMdContent()).toBe('MAIN_CLAUDE_MD')
        expect(getMainThreadAgentType()).toBe('main-agent')
      },
    )

    // Also verify top-level runWithSubconversationContext outside runWithNewHostSession
    const defaultBootstrap = getBootstrapSession()
    runWithSubconversationContext(
      { sessionId: 'top-level-subconv', parentSessionId: defaultBootstrap.id },
      () => {
        expect(hasActiveSessionAls()).toBe(true)
        expect(getActiveSessionFromAls()).toBeUndefined()
        expect(getActiveSubconversationFromAls()?.sessionId).toBe(
          'top-level-subconv',
        )
        expect(getBootstrapSession()).toBe(defaultBootstrap)
        expect(getSessionId()).toBe('top-level-subconv' as SessionId)
        expect(getParentSessionId()).toBe(defaultBootstrap.id as SessionId)
      },
    )
  })

  test('backwards compatibility when no ALS context is active', () => {
    expect(hasActiveSessionAls()).toBe(false)
    expect(getActiveSessionFromAls()).toBeUndefined()
    expect(getActiveSubconversationFromAls()).toBeUndefined()
    expect(getActiveSubconversation()).toBeUndefined()

    const initialId = getSessionId()
    expect(initialId.length).toBeGreaterThan(0)

    setOriginalCwd('/compat/orig')
    setProjectRoot('/compat/root')
    setCwdState('/compat/cwd')
    expect(getOriginalCwd()).toBe('/compat/orig')
    expect(getProjectRoot()).toBe('/compat/root')
    expect(getCwdState()).toBe('/compat/cwd')

    const seen: string[] = []
    const unsub = onSessionSwitch(id => seen.push(id))
    switchSession('compat-next-id' as SessionId, '/compat/dir', 'resume')
    expect(getSessionId()).toBe('compat-next-id' as SessionId)
    expect(getSessionProjectDir()).toBe('/compat/dir')
    expect(seen).toEqual(['compat-next-id'])
    unsub()
  })
})
