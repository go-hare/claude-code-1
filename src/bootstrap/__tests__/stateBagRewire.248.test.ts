/**
 * densable 2.1.248 leftover STATE → n() sibling bag rewires.
 * Locks getters/setters that already mint official bags; residuals stay on STATE.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  getBootstrapSession,
  getBootstrapSessionHost,
} from '../../utils/sessionHost.js'
import {
  addSessionCronTask,
  addSlowOperation,
  consumePostCompaction,
  flushInteractionTime,
  getBudgetContinuationCount,
  getCachedClaudeMdContent,
  getCurrentTurnTokenBudget,
  getIsRemoteMode,
  getLastInteractionTime,
  getLastMainRequestId,
  getMainLoopBusy,
  getRegisteredHooks,
  getSessionCronTasks,
  getSlowOperations,
  getTeleportedSessionInfo,
  getTotalCostUSD,
  hasUnknownModelCost,
  incrementBudgetContinuationCount,
  markFirstTeleportMessageLogged,
  markPostCompaction,
  onInteraction,
  registerHookCallbacks,
  removeSessionCronTasks,
  resetCostState,
  resetStateForTests,
  setCachedClaudeMdContent,
  setCostStateForRestore,
  setHasUnknownModelCost,
  setIsRemoteMode,
  setLastMainRequestId,
  setMainLoopBusy,
  setMainLoopModelOverride,
  setTeleportedSessionInfo,
  snapshotOutputTokensForTurn,
  updateLastInteractionTime,
} from '../state.js'

const stateSrc = () =>
  readFileSync(join(import.meta.dir, '../state.ts'), 'utf8')

describe('248 leftover STATE bag rewires', () => {
  afterEach(() => {
    resetStateForTests()
  })

  test('interaction time + onInteraction go through userPresence', () => {
    const src = stateSrc()
    expect(src).toContain(
      'getBootstrapSession().userPresence.recordInteraction(immediate)',
    )
    expect(src).toContain('getBootstrapSession().userPresence.flushIfDirty()')
    expect(src).toContain(
      'getBootstrapSession().userPresence.interactionFired.subscribe(listener)',
    )
    expect(src).not.toContain('STATE.lastInteractionTime')
    expect(src).not.toContain('interactionSignal')

    const before = getLastInteractionTime()
    let fired = 0
    const unsub = onInteraction(() => {
      fired++
    })
    updateLastInteractionTime()
    expect(getLastInteractionTime()).toBe(before)
    flushInteractionTime()
    expect(getLastInteractionTime()).toBeGreaterThanOrEqual(before)
    expect(fired).toBe(1)
    updateLastInteractionTime(true)
    expect(fired).toBe(2)
    expect(getBootstrapSession().userPresence.lastInteractionTime()).toBe(
      getLastInteractionTime(),
    )
    unsub()
  })

  test('mainLoopBusy reads/writes surfaceCapabilities only', () => {
    expect(getMainLoopBusy()).toBe(false)
    setMainLoopBusy(true)
    expect(getBootstrapSession().surfaceCapabilities.mainLoopBusy()).toBe(true)
    expect(getMainLoopBusy()).toBe(true)
    setMainLoopBusy(false)
    expect(stateSrc()).not.toMatch(/STATE\.mainLoopBusy\s*=/)
  })

  test('sessionCronTasks dual-write cut; getters read sessionCron', () => {
    const src = stateSrc()
    expect(src).not.toContain('STATE.sessionCronTasks')
    expect(src).not.toContain('STATE.loopChainStartedAt')
    addSessionCronTask({
      id: 't1',
      cron: '* * * * *',
      prompt: 'wake',
      createdAt: Date.now(),
    })
    expect(getSessionCronTasks()).toHaveLength(1)
    expect(getBootstrapSession().sessionCron.tasks()).toHaveLength(1)
    expect(removeSessionCronTasks(['t1'])).toBe(1)
    expect(getSessionCronTasks()).toHaveLength(0)
  })

  test('cachedClaudeMdContent + teleportedSessionInfo on sessionFlags', () => {
    const src = stateSrc()
    expect(src).not.toContain('STATE.cachedClaudeMdContent')
    expect(src).not.toContain('STATE.teleportedSessionInfo')

    setCachedClaudeMdContent('# hi')
    expect(getCachedClaudeMdContent()).toBe('# hi')
    expect(getBootstrapSession().sessionFlags.cachedClaudeMdContent()).toBe(
      '# hi',
    )

    setTeleportedSessionInfo({ sessionId: 'session_abc' })
    const info = getTeleportedSessionInfo()
    expect(info?.isTeleported).toBe(true)
    expect(info?.hasLoggedFirstMessage).toBe(false)
    markFirstTeleportMessageLogged()
    expect(getTeleportedSessionInfo()?.hasLoggedFirstMessage).toBe(true)
    expect(
      getBootstrapSession().sessionFlags.teleportedSessionInfo()
        ?.hasLoggedFirstMessage,
    ).toBe(true)
  })

  test('registeredHooks live on hookRegistry holder only', () => {
    expect(stateSrc()).not.toMatch(/STATE\.registeredHooks\s*=/)
    registerHookCallbacks({
      PreToolUse: [{ matcher: 'Bash', hooks: [] }],
    } as never)
    expect(getRegisteredHooks()?.PreToolUse).toHaveLength(1)
    expect(
      (
        getBootstrapSession().hookRegistry.holder() as {
          registeredHooks: { PreToolUse?: unknown[] } | null
        }
      ).registeredHooks?.PreToolUse,
    ).toHaveLength(1)
  })

  test('cost getters read costLedger; reset/restore cut dead STATE writes', () => {
    const src = stateSrc()
    expect(src).toContain('s.costLedger.reset(s.id)')
    expect(src).toContain('costLedger.restore({')
    expect(src).not.toMatch(/STATE\.totalCostUSD\s*=/)
    expect(src).not.toMatch(/STATE\.hasUnknownModelCost\s*=/)
    expect(src).not.toMatch(/STATE\.modelUsage\s*=/)

    setCostStateForRestore({
      totalCostUSD: 1.25,
      totalAPIDuration: 10,
      totalAPIDurationWithoutRetries: 8,
      totalToolDuration: 2,
      totalLinesAdded: 3,
      totalLinesRemoved: 1,
      lastDuration: 1000,
      modelUsage: undefined,
    })
    expect(getTotalCostUSD()).toBe(1.25)
    expect(getBootstrapSession().costLedger.totalCostUSD()).toBe(1.25)
    setHasUnknownModelCost()
    expect(hasUnknownModelCost()).toBe(true)
    resetCostState()
    expect(getTotalCostUSD()).toBe(0)
    expect(hasUnknownModelCost()).toBe(false)
  })

  test('model override setter is bag-only', () => {
    expect(stateSrc()).not.toMatch(/STATE\.mainLoopModelOverride\s*=/)
    setMainLoopModelOverride('claude-opus-4-6' as never)
    expect(getBootstrapSession().modelSelection.mainLoopModelOverride()).toBe(
      'claude-opus-4-6',
    )
  })

  test('requestJournal lastMain/postCompaction bag-only; header latches KEEP STATE', () => {
    const src = stateSrc()
    expect(src).not.toMatch(/STATE\.lastMainRequestId/)
    expect(src).not.toMatch(/STATE\.pendingPostCompaction/)
    expect(src).not.toMatch(/STATE\.lastApiCompletionTimestamp/)
    expect(src).toContain(
      'getBootstrapSession().requestJournal.lastMainRequestId()',
    )
    expect(src).toContain(
      'getBootstrapSession().requestJournal.replaceLastMainRequestId(requestId)',
    )
    expect(src).toContain(
      'getBootstrapSession().requestJournal.replacePendingPostCompaction(true)',
    )
    expect(src).toContain(
      'getBootstrapSession().requestJournal.pendingPostCompaction()',
    )

    setLastMainRequestId('req_abc')
    expect(getLastMainRequestId()).toBe('req_abc')
    expect(getBootstrapSession().requestJournal.lastMainRequestId()).toBe(
      'req_abc',
    )
    markPostCompaction()
    expect(getBootstrapSession().requestJournal.pendingPostCompaction()).toBe(
      true,
    )
    expect(consumePostCompaction()).toBe(true)
    expect(consumePostCompaction()).toBe(false)

    // KEEP STATE residuals — SEA hits=0 for these names (not qe/Ee)
    expect(src).toContain('STATE.promptCache1hEligible')
    expect(src).toContain('STATE.afkModeHeaderLatched')
    expect(src).toContain('STATE.fastModeHeaderLatched')
    expect(src).toContain('STATE.cacheEditingHeaderLatched')
    expect(src).toContain('STATE.teleportedSessionIds')
    expect(src).toContain('STATE.replBridgeSessionId')
    expect(src).toContain('KEEP STATE')
    expect(src).toMatch(
      /KEEP STATE\s+[—-].*promptCache1hEligible|KEEP STATE.*SEA.*"promptCache1hEligible"/,
    )
    expect(src).toMatch(
      /KEEP STATE\s+[—-].*Qo\(\)\.teleportedSessionIds|KEEP STATE.*official `Qo\(\)\.teleportedSessionIds`/,
    )
  })

  test('248 dead STATE type fields cut; bags own midConv/sticky/foundry/allowlist/directConnect/replBridge/hooks', () => {
    const src = stateSrc()
    // type+init residue removed (LAND)
    expect(src).not.toMatch(/midConvCachePromotionRejected:\s*boolean/)
    expect(src).not.toMatch(/stickyBetas:\s*\{/)
    expect(src).not.toMatch(/foundryDeploymentCapabilities:\s*Map/)
    expect(src).not.toMatch(/promptCache1hAllowlist:\s*string/)
    expect(src).not.toMatch(/directConnectServerUrl:\s*string/)
    expect(src).not.toMatch(/replBridgeActive:\s*boolean/)
    expect(src).not.toMatch(/mainThreadAgentHooks:\s*\n/)
    // costLedger / userPresence / surfaceCapabilities / sessionFlags / sessionCron
    // type fields cut — lock via LAND comments + init literals (param types may
    // still say `totalCostUSD: number` in setCostStateForRestore).
    expect(src).toContain('totalCostUSD / totalAPIDuration')
    expect(src).toContain('lastInteractionTime - LAND cut')
    expect(src).toContain('mainLoopBusy - LAND cut')
    expect(src).toContain('teleportedSessionInfo - LAND cut')
    expect(src).toContain('loopChainStartedAt / loopEnded')
    expect(src).not.toContain('foundryDeploymentCapabilities: new Map()')
    expect(src).not.toContain('midConvCachePromotionRejected: false')
    expect(src).not.toContain('directConnectServerUrl: undefined')
    expect(src).not.toContain('replBridgeActive: false')
    expect(src).not.toContain('promptCache1hAllowlist: null')
    expect(src).not.toContain('totalCostUSD: 0')
    expect(src).not.toContain('lastInteractionTime: Date.now()')
    expect(src).not.toContain('mainLoopBusy: false')
    expect(src).not.toContain('teleportedSessionInfo: null')
    expect(src).not.toContain('loopChainStartedAt: {}')
    expect(src).not.toContain(
      'stickyBetas: { sent: new Set(), rejected: new Set() }',
    )
    expect(src).not.toMatch(/STATE\.sdkDialogHostActive\s*=/)
    expect(src).not.toMatch(/STATE\.invokedSkills\./)

    // accessors stay bag-only
    expect(src).toContain(
      'getBootstrapSessionHost().requestLatches.midConvCachePromotionRejected()',
    )
    expect(src).toContain(
      'getBootstrapSession().conversationLatches.stickyBetas()',
    )
    expect(src).toContain(
      'getBootstrapSessionHost().requestLatches.foundryDeploymentCapabilities()',
    )
    expect(src).toContain(
      'getBootstrapSessionHost().requestLatches.promptCache1hAllowlist()',
    )
    expect(src).toContain(
      'getBootstrapSessionHost().mcpProcessWiring.directConnectServerUrl()',
    )
    expect(src).toContain(
      'getBootstrapSession().surfaceCapabilities.replBridgeActive()',
    )
    expect(src).toContain(
      'getBootstrapSession().hookRegistry.mainThreadAgentHooks()',
    )
    expect(src).toContain('getBootstrapSession().costLedger.totalCostUSD()')
    expect(src).toContain(
      'getBootstrapSession().userPresence.lastInteractionTime()',
    )
    expect(src).toContain(
      'getBootstrapSession().surfaceCapabilities.mainLoopBusy()',
    )
    expect(src).toContain(
      'getBootstrapSession().sessionFlags.teleportedSessionInfo()',
    )
    expect(src).toContain('getBootstrapSession().sessionCron.chainStartedAt')

    // KEEP type residuals — official g() dual-path parent shape
    expect(src).toContain('sessionCronTasks: SessionCronTask[]')
    expect(src).toContain('cachedClaudeMdContent: string | null')
    expect(src).toContain(
      'registeredHooks: Partial<Record<HookEvent, RegisteredHookMatcher[]>> | null',
    )
    expect(src).toContain('mainThreadAgentType: string | undefined')

    // already-cut promptAssembly fields stay cut
    expect(src).not.toContain('STATE.systemPromptSectionCache')
    expect(src).not.toMatch(/STATE\.lastEmittedDate/)
  })

  test('diagnostics wrappers go through host bag; kairosActive stays STATE; sessionSource cut', () => {
    const src = stateSrc()
    expect(src).not.toContain('STATE.slowOperations')
    expect(src).not.toMatch(/STATE\.inMemoryErrorLog/)
    expect(src).not.toContain('STATE.isRemoteMode')
    expect(src).not.toContain('STATE.systemPromptSectionCache')
    expect(src).not.toMatch(/STATE\.lastEmittedDate/)
    expect(src).toContain(
      'getBootstrapSessionHost().diagnostics.recordSlowOperation',
    )
    expect(src).toContain(
      'getBootstrapSessionHost().diagnostics.slowOperations()',
    )
    expect(src).toContain('getBootstrapSessionHost().diagnostics.recordError')
    expect(src).toContain(
      'getBootstrapSessionHost().diagnostics.recordDevBarAlert',
    )
    expect(src).toContain('getBootstrapSessionHost().diagnostics.devBarAlert')
    expect(src).toContain('turnBudget.snapshotForTurn')
    expect(src).toContain('turnBudget.incrementContinuation')
    expect(src).toContain("surfaceCapabilities.caps().workspace === 'remote'")
    expect(src).toContain('surfaceCapabilities.markRemote(value)')
    expect(src).toContain('promptAssembly.recordSection(name, value)')
    expect(src).toContain('pa.noteInvalidation()')
    expect(src).not.toContain('cache.size >= 100')

    addSlowOperation('x', 1)
    expect(getSlowOperations()).toEqual([])
    expect(getBootstrapSessionHost().diagnostics.slowOperations()).toEqual([])

    snapshotOutputTokensForTurn(100)
    expect(getCurrentTurnTokenBudget()).toBe(100)
    expect(getBudgetContinuationCount()).toBe(0)
    incrementBudgetContinuationCount()
    expect(getBudgetContinuationCount()).toBe(1)
    expect(getBootstrapSession().surfaceCapabilities.caps()).toEqual({
      renderTarget: 'ink',
      workspace: 'local',
      canDrive: true,
      transcriptSource: 'local-jsonl',
      remote: null,
    })
    expect(getIsRemoteMode()).toBe(false)
    setIsRemoteMode(true)
    expect(getIsRemoteMode()).toBe(true)
    expect(getBootstrapSession().surfaceCapabilities.caps().workspace).toBe(
      'remote',
    )
    setIsRemoteMode(false)
    expect(getIsRemoteMode()).toBe(false)

    expect(src).toContain('STATE.kairosActive')
    expect(src).toContain('Residual leftover-only kairosActive')
    expect(src).toContain('ge @178521439')
    expect(src).not.toContain('sessionSource')
    expect(src).not.toContain('setSessionSource')
  })
})
