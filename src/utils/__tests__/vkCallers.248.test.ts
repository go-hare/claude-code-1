import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { runPreExitFlush } from '../cleanupRegistry.js'
import {
  hasPendingPluginUsage,
  incrementPluginUsage,
  registerPluginUsageStorageV5,
  resetPendingPluginUsageForTests,
} from '../plugins/pluginUsagePending.js'
import { resetSessionHostForTests } from '../sessionRoot.js'
import {
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../storageV5/hoverRestPin.js'

function src(rel: string): string {
  return readFileSync(join(import.meta.dir, rel), 'utf8')
}

describe('densable 2.1.248 Vk → registerPreExitFlush callers', () => {
  beforeEach(() => {
    resetSessionHostForTests()
    resetHoverRestPinForTests()
    resetPendingPluginUsageForTests()
  })

  afterEach(() => {
    resetSessionHostForTests()
    resetHoverRestPinForTests()
    resetPendingPluginUsageForTests()
  })

  test('X$n: registerPluginUsageStorageV5 wires Et + Vk → Aln', () => {
    const body = src('../plugins/pluginUsagePending.ts')
    expect(body).toContain(
      'registerCleanup(() => flushPendingPluginUsageToStorageV5(e))',
    )
    expect(body).toContain(
      'registerPreExitFlush(() => flushPendingPluginUsageToStorageV5(e))',
    )
    expect(body).toContain('isHoverRestOn() && e !== undefined')
  })

  test('X$n behavioral: hover-rest + storageV5 preExitFlush drains pending usage', async () => {
    pinHoverRest(true)
    const handle = { kind: 'storageV5-test' }
    registerPluginUsageStorageV5(handle)
    incrementPluginUsage('demo@marketplace')
    expect(hasPendingPluginUsage('demo@marketplace')).toBe(true)
    await runPreExitFlush()
    expect(hasPendingPluginUsage('demo@marketplace')).toBe(false)
  })

  test('TIn: errorLogSink writerFor wires Vk(flushBeforeExit)', () => {
    const body = src('../errorLogSink.ts')
    expect(body).toContain('registerPreExitFlush(flushAllLogWriters)')
    expect(body).toContain('registerCleanup(async () => writer?.dispose())')
    expect(body).toContain('async function flushAllLogWriters')
  })

  test('wt: StatsProvider wires Vk lastSessionMetrics when hover-rest + storageV5', () => {
    const body = src('../../context/stats.tsx')
    expect(body).toContain('registerPreExitFlush')
    expect(body).toContain('isHoverRestOn() && storageV5 !== undefined')
    expect(body).toContain('lastSessionMetrics: metrics')
    expect(body).toContain('useSessionServices()')
    expect(body).toContain('if (asyncDone) return')
  })

  test('Aye: useCostSummary wires Vk ZFn when hover-rest + storageV5', () => {
    const body = src('../../costHook.ts')
    expect(body).toContain('registerPreExitFlush')
    expect(body).toContain('isHoverRestOn() && storageV5 !== undefined')
    expect(body).toContain(
      'saveCurrentSessionCosts(getFpsMetrics?.(), storageV5)',
    )
    expect(body).toContain('if (!asyncDone)')
    expect(body).not.toContain('Jhe(')
    expect(body).not.toContain('lastGracefulShutdown:')
  })

  test('be @190739086: durable pendingOps Promise set + Vk(wr) drain', () => {
    const ops = src('../../services/artifactAutoReact/durablePendingOps.ts')
    const store = src('../../services/artifactAutoReact/store.ts')
    const durable = src('../../services/artifactAutoReact/durableSubscribe.ts')
    expect(store).toContain('pendingOps: Set<Promise<unknown>>')
    expect(ops).toContain('registerPreExitFlush(wr)')
    expect(ops).toContain('pendingOps.add(e)')
    expect(ops).toContain('Promise.allSettled([...pendingOps])')
    expect(ops).toContain('DURABLE_PENDING_OPS_DRAIN_MS = 10_000')
    expect(durable).toContain('be(l)')
    expect(durable).toContain('densable D9t entry')
  })

  test('be behavioral: preExitFlush drains tracked subscribe promise', async () => {
    const { be, wr, DURABLE_PENDING_OPS_DRAIN_MS } = await import(
      '../../services/artifactAutoReact/durablePendingOps.js'
    )
    const { resetArtifactAutoReactStoreForTests, un } = await import(
      '../../services/artifactAutoReact/store.js'
    )
    const { resetSessionHostForTests } = await import('../sessionRoot.js')
    resetSessionHostForTests()
    resetArtifactAutoReactStoreForTests()
    let settled = false
    const p = new Promise<void>(resolve => {
      setTimeout(() => {
        settled = true
        resolve()
      }, 20)
    })
    be(p)
    expect(un().durable.pendingOps.has(p)).toBe(true)
    await runPreExitFlush()
    expect(settled).toBe(true)
    expect(un().durable.pendingOps.has(p)).toBe(false)
    void DURABLE_PENDING_OPS_DRAIN_MS
    void wr
  })

  test('qd @192241903: AgentView fleet composer draftForDisk + Vk(AIt)', () => {
    const agentView = src('../../screens/AgentView.tsx')
    const hook = src(
      '../../screens/fleetView/useFleetComposerDraftPersistence.ts',
    )
    const draft = src('../../screens/fleetView/launcherDraft.ts')
    expect(agentView).toContain('useFleetComposerDraftPersistence')
    expect(agentView).toContain('resolveFleetCanonicalLauncherCwd')
    expect(hook).toContain('registerPreExitFlush')
    expect(hook).toContain('isHoverRestOn() && storage !== undefined')
    expect(hook).toContain('fleetComposerDraftForDisk')
    expect(hook).toContain('persistFleetLauncherDraftAsync')
    expect(draft).toContain('export function fleetComposerDraftForDisk')
    expect(draft).toContain("mode === 'bash' ? `!${query}` : query")
    expect(draft).toContain('persistFleetLauncherDraftAsync')
    expect(draft).toContain("namespace: 'jobsRoot'")
    expect(src('../../costHook.ts')).not.toContain('draftForDisk')
    expect(src('../errorLogSink.ts')).not.toContain('draftForDisk')
  })

  test('saveCurrentProjectConfig / saveCurrentSessionCosts accept storageV5 slot', () => {
    const config = src('../config.ts')
    expect(config).toContain('_storageV5?: unknown')
    const tracker = src('../../cost-tracker.ts')
    expect(tracker).toContain('_storageV5?: unknown')
    expect(tracker).toContain('_storageV5,')
  })
})
