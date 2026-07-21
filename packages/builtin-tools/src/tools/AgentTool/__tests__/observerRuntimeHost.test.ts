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

  test('deliver is densable G0t→Aye observer-activity (not queuePendingMessage)', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../observerRuntimeHost.ts'),
      'utf8',
    ) as string
    // densable: await Aye({promptOrigin:{kind:"observer-activity"},
    //   suppressOwnerNotification:!0, awaitCompletion:!0})
    expect(src).toContain("promptOriginKind: 'observer-activity'")
    expect(src).toContain('suppressOwnerNotification: true')
    expect(src).toContain('awaitCompletion: true')
    expect(src).toContain('resumeAgentBackground')
    expect(src).not.toContain('queuePendingMessage')
    // densable lYy sidecar marker + spawn Kle
    expect(src).toContain('isObserver: true')
    expect(src).toContain('observer marker read-back failed')
    expect(src).toContain('markAgentsNotified')
    // densable G0t.deliver: workerPermissionMode from armingPermissionMode (MJe)
    expect(src).toContain('workerPermissionMode')
    expect(src).toContain('armingPermissionMode')
    expect(src).toMatch(/workerPermissionMode:\s*pairing\.armingPermissionMode/)
  })

  test('spawnFirstRun uses densable MJe arming + two user messages (framing + digest)', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../observerRuntimeHost.ts'),
      'utf8',
    ) as string
    // densable: c = MJe(armingPermissionMode, session) ?? session
    expect(src).toContain('resolveWorkerPermissionMode')
    expect(src).toContain('pairing.armingPermissionMode')
    // densable: Nr(framing), Nr(digest, origin observer-activity) — not merged plan.prompt alone
    expect(src).toContain("origin: { kind: 'observer-activity' }")
    expect(src).toContain('createUserMessage({ content: framing })')
    expect(src).toContain('createUserMessage({')
    expect(src).toContain('content: digest')
    // Must not only use single merged plan.prompt for first-run messages
    expect(src).not.toMatch(
      /observerPromptMessages\s*=\s*\[\s*createUserMessage\(\{\s*content:\s*plan\.prompt\s*\}\)\s*\]/,
    )
  })

  test('spawnFirstRun densable Lco + useExactTools so ObserverReport is not re-stripped', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../observerRuntimeHost.ts'),
      'utf8',
    ) as string
    expect(src).toContain('applyObserverExactToolPool')
    expect(src).toContain('resolveAgentTools')
    expect(src).toContain('useExactTools: true')
  })
})
