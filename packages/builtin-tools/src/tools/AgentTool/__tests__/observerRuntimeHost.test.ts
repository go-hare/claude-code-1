import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearAllObserverPairings,
  getObserverRuntimeHost,
  resetObserverRuntimeHostForTests,
} from 'src/utils/observerAgents.js'
import {
  createAgentObserverRuntimeHostHandlers,
  installAgentObserverRuntimeHost,
} from '../observerRuntimeHost.js'

afterEach(() => {
  resetObserverRuntimeHostForTests()
  clearAllObserverPairings()
})

describe('createAgentObserverRuntimeHostHandlers', () => {
  test('exposes spawn/deliver/abort/writeTombstone', () => {
    const h = createAgentObserverRuntimeHostHandlers({
      log: () => {},
    })
    expect(typeof h.spawnFirstRun).toBe('function')
    expect(typeof h.deliver).toBe('function')
    expect(typeof h.abortObserver).toBe('function')
    expect(typeof h.writeTombstone).toBe('function')
  })

  test('installAgentObserverRuntimeHost sets process host', async () => {
    expect(getObserverRuntimeHost()).toBeNull()
    const host = await installAgentObserverRuntimeHost({
      log: () => {},
    })
    expect(getObserverRuntimeHost()).toBe(host)
    expect(host.spawnFirstRun).toBeDefined()
    // Real host is not the refuse-stub only install — deliver exists.
    expect(typeof host.deliver).toBe('function')
  })

  test('fallback observer agent def is read-only (not tools:* acceptEdits)', () => {
    // Source-level contract: createAgentObserverRuntimeHostHandlers embeds a
    // narrow fallback when activeAgents lacks the observer type.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../observerRuntimeHost.ts'),
      'utf8',
    ) as string
    expect(src).toContain("permissionMode: 'default'")
    expect(src).toContain('OBSERVER_FALLBACK_TOOLS')
    expect(src).not.toMatch(
      /agentType: plan\.observerAgentType[\s\S]{0,400}tools:\s*\['\*'\]/,
    )
  })

  test('source-scan: densable deliver uses Aye observer-activity + isObserver stamp', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../observerRuntimeHost.ts'),
      'utf8',
    ) as string
    // densable Cxt.deliver → Aye promptOrigin observer-activity
    expect(src).toContain("promptOriginKind: 'observer-activity'")
    expect(src).toContain('suppressOwnerNotification: true')
    expect(src).toContain('awaitCompletion: true')
    expect(src).toContain('resumeAgentBackground')
    // spawnFirstRun stamps Sot isObserver + sidecar meta
    expect(src).toContain('isObserver: true')
    expect(src).toContain('writeAgentMetadata')
  })
})
