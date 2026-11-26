import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSideConnection } from '@agentclientprotocol/sdk'
import type { SDKMessage } from '../../../entrypoints/agentSdkTypes.js'
import type { SessionId } from '../../../types/ids.js'
import type { UserMessage } from '../../../types/message.js'
import {
  getSessionId as getSessionIdDirect,
  onSessionSwitch as onSessionSwitchDirect,
  type SessionSwitchReason,
} from '../../../bootstrap/state.js'
import {
  getActiveSessionFromAls,
  hasActiveSessionAls,
} from '../../../utils/sessionRoot.js'

// Module-top-level subscriber registered during ESM module evaluation (matching
// production subscribers in effortThinkingGuard.ts, filesystem.ts, withRetry.ts).
type CapturedModuleSwitchEvent = {
  id: string
  reason: SessionSwitchReason | undefined
  alsActive: boolean
  activeSessionId: string
  activeOriginalCwd: string | undefined
}
const moduleTopLevelSwitchEvents: CapturedModuleSwitchEvent[] = []
let captureModuleTopLevelEvents = false

onSessionSwitchDirect(
  (id, reason) => {
    if (!captureModuleTopLevelEvents) return
    moduleTopLevelSwitchEvents.push({
      id: String(id),
      reason,
      alsActive: hasActiveSessionAls(),
      activeSessionId: String(getSessionIdDirect()),
      activeOriginalCwd: getActiveSessionFromAls()?.project.originalCwd,
    })
  },
  { scope: 'global' },
)

// Dynamic imports inside beforeAll ensure sibling agent.test.ts afterAll mock
// restoration has completed before binding functions under test.
let AcpAgentCtor: typeof import('../agent.js').AcpAgent
let QueryEngineClass: typeof import('../../../QueryEngine.js').QueryEngine
let stateMod: typeof import('../../../bootstrap/state.js')
let sessionHostMod: typeof import('../../../utils/sessionHost.js')
let sessionRootMod: typeof import('../../../utils/sessionRoot.js')
let sessionStorageMod: typeof import('../../../utils/sessionStorage.js')
let plansMod: typeof import('../../../utils/plans.js')
let onboardingMod: typeof import('../../../projectOnboardingState.js')
let exampleCommandsMod: typeof import('../../../utils/exampleCommands.js')
let bashDeliveryMod: typeof import('../../../utils/bashTaskDelivery.js')
let bashOutcomesMod: typeof import('../../../utils/bashTaskDeliveryOutcomes.js')
let localShellMod: typeof import('../../../tasks/LocalShellTask/LocalShellTask.js')
let taskRegistryMod: typeof import('../../../utils/taskRegistry.js')

beforeAll(async () => {
  ;[
    { AcpAgent: AcpAgentCtor },
    { QueryEngine: QueryEngineClass },
    stateMod,
    sessionHostMod,
    sessionRootMod,
    sessionStorageMod,
    plansMod,
    onboardingMod,
    exampleCommandsMod,
    bashDeliveryMod,
    bashOutcomesMod,
    localShellMod,
    taskRegistryMod,
  ] = await Promise.all([
    import('../agent.js'),
    import('../../../QueryEngine.js'),
    import('../../../bootstrap/state.js'),
    import('../../../utils/sessionHost.js'),
    import('../../../utils/sessionRoot.js'),
    import('../../../utils/sessionStorage.js'),
    import('../../../utils/plans.js'),
    import('../../../projectOnboardingState.js'),
    import('../../../utils/exampleCommands.js'),
    import('../../../utils/bashTaskDelivery.js'),
    import('../../../utils/bashTaskDeliveryOutcomes.js'),
    import('../../../tasks/LocalShellTask/LocalShellTask.js'),
    import('../../../utils/taskRegistry.js'),
    import('../../../utils/effortThinkingGuard.js'),
  ])
})

function makeConn(): AgentSideConnection {
  return {
    sessionUpdate: mock(async () => {}),
    requestPermission: mock(async () => ({
      outcome: { outcome: 'cancelled' as const },
    })),
  } as unknown as AgentSideConnection
}

function makeUserMessage(text: string): UserMessage {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: text,
    },
  } as unknown as UserMessage
}

function restoreEnvVar(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = previous
  }
}

describe('2.1.331 ALS Core Self-Review & ACP Multi-Host Edge Cases', () => {
  const tempDirs: string[] = []
  const activeSpies: Array<{ mockRestore(): void }> = []
  const savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  const savedTestPersistence = process.env.TEST_ENABLE_SESSION_PERSISTENCE
  const savedCustomHeaders = process.env.ANTHROPIC_CUSTOM_HEADERS

  function makeTempDir(prefix: string): string {
    const raw = mkdtempSync(join(tmpdir(), prefix))
    const canonical = realpathSync(raw).normalize('NFC')
    tempDirs.push(canonical)
    return canonical
  }

  beforeEach(() => {
    captureModuleTopLevelEvents = false
    moduleTopLevelSwitchEvents.length = 0
    sessionRootMod.registerSessionContextReader(
      sessionRootMod.getSessionAlsStore,
    )
    stateMod.resetStateForTests()
    plansMod.getPlansDirectory.cache.clear()
    onboardingMod.shouldShowProjectOnboarding.cache.clear()
    exampleCommandsMod.getExampleCommandFromCache.cache.clear()
    exampleCommandsMod.refreshExampleCommands.cache.clear()
  })

  afterEach(() => {
    captureModuleTopLevelEvents = false
    moduleTopLevelSwitchEvents.length = 0
    for (let i = activeSpies.length - 1; i >= 0; i--) {
      activeSpies[i]?.mockRestore()
    }
    activeSpies.length = 0
    localShellMod.resetQuietCheckinOwnersForTests()
    restoreEnvVar('CLAUDE_CONFIG_DIR', savedClaudeConfigDir)
    restoreEnvVar('TEST_ENABLE_SESSION_PERSISTENCE', savedTestPersistence)
    restoreEnvVar('ANTHROPIC_CUSTOM_HEADERS', savedCustomHeaders)
    sessionRootMod.registerSessionContextReader(
      sessionRootMod.getSessionAlsStore,
    )
    stateMod.resetStateForTests()
    sessionStorageMod.resetProjectForTesting()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  test('preserves Plan Mode slug and mid-session worktree originalCwd across multi-turn ACP prompt() calls, and makes switchSession(sameId) a no-op for forgetPlanSlug', async () => {
    const configDir = makeTempDir('acp-edge-cfg-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    const dirA = makeTempDir('acp-edge-plan-a-')
    const worktreeDir = join(dirA, 'worktree-feature')
    mkdirSync(worktreeDir, { recursive: true })

    // 1) Direct unit check: switchSession(sameId) keeps plan slug & skips listeners
    await sessionHostMod.runWithNewHostSession({ cwd: dirA }, async () => {
      const sid = stateMod.getSessionId()
      plansMod.setPlanSlug(sid, 'pinned-direct-slug')
      const switchEvents: string[] = []
      const unsub = stateMod.onSessionSwitch(nextId => {
        switchEvents.push(String(nextId))
      })
      try {
        stateMod.switchSession(sid, dirA)
        expect(plansMod.getPlanSlug()).toBe('pinned-direct-slug')
        expect(stateMod.getSessionProjectDir()).toBe(dirA)
        expect(switchEvents).toEqual([])

        const nextSid = randomUUID() as SessionId
        stateMod.switchSession(nextSid, null, 'resume')
        expect(stateMod.getPlanSlugCache().has(sid)).toBe(false)
        expect(switchEvents).toEqual([String(nextSid)])
      } finally {
        unsub()
      }
    })

    // 2) Multi-turn ACP prompt() check
    const agent = new AcpAgentCtor(makeConn())
    await agent.initialize({ protocolVersion: 1 } as never)
    const { sessionId } = await agent.newSession({
      cwd: dirA,
      mcpServers: [],
      _meta: { permissionMode: 'plan' },
    })

    const observedSlugs: string[] = []
    const observedOriginalCwds: string[] = []
    let turnNumber = 0

    const submitSpy = spyOn(
      QueryEngineClass.prototype,
      'submitMessage',
    ).mockImplementation(async function* () {
      turnNumber += 1
      if (turnNumber === 1) {
        const slug = plansMod.getPlanSlug()
        observedSlugs.push(slug)
        observedOriginalCwds.push(stateMod.getOriginalCwd())
        // Simulate EnterWorktreeTool switching originalCwd during Turn 1
        stateMod.setOriginalCwd(worktreeDir)
      } else {
        observedSlugs.push(plansMod.getPlanSlug())
        observedOriginalCwds.push(stateMod.getOriginalCwd())
      }

      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 5,
        duration_api_ms: 5,
        num_turns: 1,
        result: `turn-${turnNumber}`,
        stop_reason: 'end_turn',
        session_id: stateMod.getSessionId(),
        total_cost_usd: 0,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: randomUUID(),
      } as unknown as SDKMessage
    })
    activeSpies.push(submitSpy)

    await agent.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'turn 1 draft plan' }],
    })
    await agent.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'turn 2 refine plan' }],
    })

    expect(observedSlugs).toHaveLength(2)
    expect(observedSlugs[0]?.length).toBeGreaterThan(0)
    expect(observedSlugs[1]).toBe(observedSlugs[0])
    expect(observedOriginalCwds).toEqual([dirA, worktreeDir])
  })

  test('fires module-top-level onSessionSwitch subscribers inside isolated ALS session context on regenerateSessionId and switchSession(newId)', async () => {
    const dirIso = makeTempDir('acp-edge-switch-iso-')

    // Mark default session's once-latch to prove isolated switch does not touch it
    sessionRootMod
      .getSessionOnceLatches()
      .markFired('stream_no_events_fallback_warning')

    const defaultRuntimeEvents: string[] = []
    const unsubDefaultRuntime = stateMod.onSessionSwitch(id => {
      defaultRuntimeEvents.push(String(id))
    })

    captureModuleTopLevelEvents = true
    try {
      await sessionHostMod.runWithNewHostSession({ cwd: dirIso }, async () => {
        const latches = sessionRootMod.getSessionOnceLatches()
        latches.markFired('stream_no_events_fallback_warning')
        expect(latches.hasFired('stream_no_events_fallback_warning')).toBe(true)

        const clearedId = stateMod.regenerateSessionId()
        // effortThinkingGuard.ts module-top-level listener reset the isolated latch
        expect(latches.hasFired('stream_no_events_fallback_warning')).toBe(
          false,
        )

        // Same-ID switch must NOT fire module-top-level listeners or reset latch
        latches.markFired('stream_no_events_fallback_warning')
        stateMod.switchSession(clearedId, null)
        expect(latches.hasFired('stream_no_events_fallback_warning')).toBe(true)
        expect(moduleTopLevelSwitchEvents).toHaveLength(1)

        // Switching to a distinct session ID fires inside dirIso's ALS context
        const resumedId = randomUUID() as SessionId
        stateMod.switchSession(resumedId, null, 'resume')
        expect(latches.hasFired('stream_no_events_fallback_warning')).toBe(
          false,
        )

        expect(moduleTopLevelSwitchEvents).toEqual([
          {
            id: String(clearedId),
            reason: 'clear',
            alsActive: true,
            activeSessionId: String(clearedId),
            activeOriginalCwd: dirIso,
          },
          {
            id: String(resumedId),
            reason: 'resume',
            alsActive: true,
            activeSessionId: String(resumedId),
            activeOriginalCwd: dirIso,
          },
        ])
      })

      // Runtime listener on defaultBootstrapSession never fired for isolated host
      expect(defaultRuntimeEvents).toEqual([])
      expect(
        sessionRootMod
          .getSessionOnceLatches()
          .hasFired('stream_no_events_fallback_warning'),
      ).toBe(true)
    } finally {
      unsubDefaultRuntime()
    }
  })

  test('flushes buffered transcript writes and exit drains for isolated runWithNewHostSession hosts when flushSessionStorageAtExit runs outside ALS', async () => {
    const configDir = makeTempDir('acp-edge-exit-cfg-')
    const dirHostA = makeTempDir('acp-edge-exit-a-')
    const dirHostB = makeTempDir('acp-edge-exit-b-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

    let drainObservedCwdA: string | undefined
    let drainObservedCwdB: string | undefined
    let transcriptPathA = ''
    let transcriptPathB = ''

    const hostA = sessionHostMod.createSessionHost()
    const sessionA = sessionRootMod.createRootSession({
      host: hostA,
      id: randomUUID(),
      project: { originalCwd: dirHostA, projectRoot: dirHostA, cwd: dirHostA },
    })
    const hostB = sessionHostMod.createSessionHost()
    const sessionB = sessionRootMod.createRootSession({
      host: hostB,
      id: randomUUID(),
      project: { originalCwd: dirHostB, projectRoot: dirHostB, cwd: dirHostB },
    })

    await Promise.all([
      sessionRootMod.runWithSession(sessionA, async () => {
        sessionStorageMod.registerSessionExitDrain(() => {
          drainObservedCwdA = stateMod.getOriginalCwd()
        })
        await sessionStorageMod.recordTranscript([
          makeUserMessage('hello from isolated host A'),
        ])
        // Queue a 100ms-debounced custom-title write that has NOT drained yet
        sessionStorageMod.cacheSessionTitle('Title A')
        await sessionStorageMod.getProject().appendEntry({
          type: 'tag',
          tag: 'tag-from-host-a',
          sessionId: stateMod.getSessionId() as ReturnType<typeof randomUUID>,
        })
        transcriptPathA = sessionStorageMod.getTranscriptPath()
      }),
      sessionRootMod.runWithSession(sessionB, async () => {
        sessionStorageMod.registerSessionExitDrain(() => {
          drainObservedCwdB = stateMod.getOriginalCwd()
        })
        await sessionStorageMod.recordTranscript([
          makeUserMessage('hello from isolated host B'),
        ])
        sessionStorageMod.cacheSessionTitle('Title B')
        await sessionStorageMod.getProject().appendEntry({
          type: 'tag',
          tag: 'tag-from-host-b',
          sessionId: stateMod.getSessionId() as ReturnType<typeof randomUUID>,
        })
        transcriptPathB = sessionStorageMod.getTranscriptPath()
      }),
    ])

    // Confirm process-exit flush happens strictly OUTSIDE any ALS context
    expect(sessionRootMod.hasActiveSessionAls()).toBe(false)
    await sessionStorageMod.flushSessionStorageAtExit()

    expect(drainObservedCwdA).toBe(dirHostA)
    expect(drainObservedCwdB).toBe(dirHostB)
    expect(existsSync(transcriptPathA)).toBe(true)
    expect(existsSync(transcriptPathB)).toBe(true)

    const contentA = readFileSync(transcriptPathA, 'utf-8')
    const contentB = readFileSync(transcriptPathB, 'utf-8')
    expect(contentA).toContain('hello from isolated host A')
    expect(contentA).toContain('tag-from-host-a')
    expect(contentA).toContain('Title A')
    expect(contentA).not.toContain('host B')

    expect(contentB).toContain('hello from isolated host B')
    expect(contentB).toContain('tag-from-host-b')
    expect(contentB).toContain('Title B')
    expect(contentB).not.toContain('host A')
  })

  test('shares the exact same BashTaskDeliveryBag across bashTaskDelivery.ts and bashTaskDeliveryOutcomes.ts inside and outside hostB ALS context', () => {
    const dirB = makeTempDir('acp-edge-bag-b-')
    const hostB = sessionHostMod.createSessionHost()
    const sessionB = sessionRootMod.createRootSession({
      host: hostB,
      id: randomUUID(),
      project: { originalCwd: dirB, projectRoot: dirB, cwd: dirB },
    })

    // Access bashTaskDeliveryBagOf(hostB) OUTSIDE hostB's ALS context first
    const outsideDeliveryBag = bashDeliveryMod.bashTaskDeliveryBagOf(hostB)
    const outsideOutcomesBag = bashOutcomesMod.bashTaskDeliveryBagOf(hostB)
    const defaultHostBag = bashDeliveryMod.getBashTaskDeliveryBag()

    expect(outsideDeliveryBag).toBe(outsideOutcomesBag)
    expect(outsideDeliveryBag).not.toBe(defaultHostBag)

    sessionRootMod.runWithSession(sessionB, () => {
      const insideDeliveryBag = bashDeliveryMod.getBashTaskDeliveryBag()
      const insideOutcomesBag = bashOutcomesMod.getBashTaskDeliveryBag()
      expect(insideDeliveryBag).toBe(outsideDeliveryBag)
      expect(insideOutcomesBag).toBe(outsideDeliveryBag)
      expect(bashDeliveryMod.bashTaskDeliveryBagOf(hostB)).toBe(
        outsideDeliveryBag,
      )
      expect(bashOutcomesMod.bashTaskDeliveryBagOf(hostB)).toBe(
        outsideDeliveryBag,
      )

      // Mutate via bashTaskDeliveryOutcomes, observe via bashTaskDelivery
      bashOutcomesMod.setBashTaskDeliveryOutcome('msg-1', 'no_host')
      bashOutcomesMod.rememberBashTaskSnapshot('task-1', { ok: true })
      expect(bashDeliveryMod.isBashTaskDeliveryHosted('msg-1')).toBe(false)
      expect(
        bashDeliveryMod.lookupBashTaskSnapshot('task-1')?.snapshot,
      ).toEqual({ ok: true })
    })

    // Default host bag was untouched
    expect(bashDeliveryMod.isBashTaskDeliveryHosted('msg-1')).toBe(true)
    expect(bashDeliveryMod.lookupBashTaskSnapshot('task-1')).toBeUndefined()
  })

  test('keys RootSessionSlot memos by getCwd() so session.withProject({ cwd }) forks compute distinct getPlansDirectory, onboarding, and example commands', async () => {
    const configDir = makeTempDir('acp-edge-fork-cfg-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    const dirA = makeTempDir('acp-edge-fork-a-')
    const dirB = makeTempDir('acp-edge-fork-b-')

    // Populate dirA with CLAUDE.md + source file; leave dirB empty
    writeFileSync(join(dirA, 'CLAUDE.md'), '# Project A\n')
    writeFileSync(join(dirA, 'index.ts'), 'export const a = 1\n')

    const host = sessionHostMod.createSessionHost()
    const rootSession = sessionRootMod.createRootSession({
      host,
      id: randomUUID(),
      project: { originalCwd: dirA, projectRoot: dirA, cwd: dirA },
    })
    const forkedSession = rootSession.withProject({
      originalCwd: dirB,
      projectRoot: dirB,
      cwd: dirB,
    })
    expect(forkedSession.root).toBe(rootSession.root)

    await sessionRootMod.runWithSession(rootSession, async () => {
      stateMod.setFlagSettingsInline({ plansDirectory: './custom-plans' })

      const plansA = plansMod.getPlansDirectory()
      expect(plansA).toBe(join(dirA, 'custom-plans'))
      expect(plansMod.getPlansDirectory.cache.has(dirA)).toBe(true)
      expect(plansMod.getPlansDirectory.cache.has(undefined)).toBe(true)

      const showOnboardingA = onboardingMod.shouldShowProjectOnboarding()
      const exampleCmdA = exampleCommandsMod.getExampleCommandFromCache()
      expect(showOnboardingA).toBe(false)
      expect(
        onboardingMod.shouldShowProjectOnboarding.cache.has(undefined),
      ).toBe(true)
      expect(
        exampleCommandsMod.getExampleCommandFromCache.cache.has(undefined),
      ).toBe(true)

      await sessionRootMod.runWithSession(forkedSession, async () => {
        const plansB = plansMod.getPlansDirectory()
        expect(plansB).toBe(join(dirB, 'custom-plans'))
        expect(plansB).not.toBe(plansA)

        const showOnboardingB = onboardingMod.shouldShowProjectOnboarding()
        expect(showOnboardingB).toBe(true)

        // Both vetted custom plans roots remain writable in their own CWD
        await plansMod.writePlanFileContained(
          join(plansB, 'plan-b.md'),
          '# Plan B\n',
        )
        expect(readFileSync(join(plansB, 'plan-b.md'), 'utf-8')).toBe(
          '# Plan B\n',
        )
      })

      // Parent rootSession still resolves dirA's plansDirectory and can write to it
      expect(plansMod.getPlansDirectory()).toBe(plansA)
      await plansMod.writePlanFileContained(
        join(plansA, 'plan-a.md'),
        '# Plan A\n',
      )
      expect(readFileSync(join(plansA, 'plan-a.md'), 'utf-8')).toBe(
        '# Plan A\n',
      )
      expect(exampleCommandsMod.getExampleCommandFromCache()).toBe(exampleCmdA)
    })
  })

  test('runs ACP cancel() abort listeners inside session.hostSession ALS context, guards multi-session process.env, and deletes session transcript in session.cwd', async () => {
    const configDir = makeTempDir('acp-edge-cancel-del-cfg-')
    const repoA = makeTempDir('acp-edge-repo-a-')
    const repoB = makeTempDir('acp-edge-repo-b-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    delete process.env.ANTHROPIC_CUSTOM_HEADERS

    // repoB defines a safe env var in settings.local.json — creating Session B
    // while Session A is active must NOT mutate process.env under Session A.
    mkdirSync(join(repoB, '.claude'), { recursive: true })
    writeFileSync(
      join(repoB, '.claude', 'settings.local.json'),
      JSON.stringify({
        env: { ANTHROPIC_CUSTOM_HEADERS: 'x-leaked-from-repo-b: 1' },
      }),
    )

    const agent = new AcpAgentCtor(makeConn())
    await agent.initialize({ protocolVersion: 1 } as never)

    const resA = await agent.newSession({ cwd: repoA, mcpServers: [] })
    const resB = await agent.newSession({ cwd: repoB, mcpServers: [] })
    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    expect(resA.sessionId).not.toBe(resB.sessionId)

    const sessionB = agent.sessions.get(resB.sessionId)!
    expect(sessionB).toBeDefined()

    // 1) Verify cancel() runs synchronous 'abort' listeners in sessionB.hostSession ALS context
    let abortAlsActive = false
    let abortObservedSid = ''
    let abortObservedCwd = ''
    sessionB.queryEngine.getAbortSignal().addEventListener(
      'abort',
      () => {
        abortAlsActive = sessionRootMod.hasActiveSessionAls()
        abortObservedSid = String(stateMod.getSessionId())
        abortObservedCwd = stateMod.getOriginalCwd()
      },
      { once: true },
    )

    expect(sessionRootMod.hasActiveSessionAls()).toBe(false)
    await agent.cancel({ sessionId: resB.sessionId })
    expect(abortAlsActive).toBe(true)
    expect(abortObservedSid).toBe(resB.sessionId)
    expect(abortObservedCwd).toBe(repoB)

    // 2) Persist a transcript in repoB for sessionB with an unflushed 100ms-debounced
    // tag write still buffered in writeQueues, then delete via unstable_deleteSession.
    let sessionBTranscriptPath = ''
    await sessionRootMod.runWithSession(sessionB.hostSession, async () => {
      await sessionStorageMod.recordTranscript([
        makeUserMessage('persisted turn in repoB'),
      ])
      await sessionStorageMod.flushSessionStorage()
      sessionBTranscriptPath = sessionStorageMod.getTranscriptPath()
      // Enqueue a debounced tag entry without manually flushing so teardownSession's
      // flush runs BEFORE unlink (preventing a late timer from recreating the file).
      await sessionStorageMod.getProject().appendEntry({
        type: 'tag',
        tag: 'delete-order-check',
        sessionId: resB.sessionId as ReturnType<typeof randomUUID>,
      })
    })
    expect(existsSync(sessionBTranscriptPath)).toBe(true)

    // Delete sessionB while outside ALS (default host is NOT in repoB)
    await agent.unstable_deleteSession({ sessionId: resB.sessionId })
    expect(agent.sessions.has(resB.sessionId)).toBe(false)
    expect(existsSync(sessionBTranscriptPath)).toBe(false)
    expect(agent.sessions.has(resA.sessionId)).toBe(true)

    // 3) Verify unstable_closeSession (teardownSession) flushes buffered writes for sessionA
    const sessionA = agent.sessions.get(resA.sessionId)!
    let sessionATranscriptPath = ''
    await sessionRootMod.runWithSession(sessionA.hostSession, async () => {
      await sessionStorageMod.recordTranscript([
        makeUserMessage('turn in repoA before close'),
      ])
      await sessionStorageMod.getProject().appendEntry({
        type: 'tag',
        tag: 'flushed-on-teardown',
        sessionId: resA.sessionId as ReturnType<typeof randomUUID>,
      })
      sessionATranscriptPath = sessionStorageMod.getTranscriptPath()
    })
    await agent.unstable_closeSession({ sessionId: resA.sessionId })
    expect(agent.sessions.has(resA.sessionId)).toBe(false)
    expect(existsSync(sessionATranscriptPath)).toBe(true)
    expect(readFileSync(sessionATranscriptPath, 'utf-8')).toContain(
      'flushed-on-teardown',
    )
    // Confirm deleted sessionB file was never resurrected after timer window
    expect(existsSync(sessionBTranscriptPath)).toBe(false)
  })

  test('prunes WeakRef entries in LocalShellTask quiet check-in owner registry without pinning ephemeral SessionHosts', () => {
    const liveRefs: Array<WeakRef<object>> = []
    for (let i = 0; i < 70; i++) {
      const host = sessionHostMod.createSessionHost()
      liveRefs.push(new WeakRef(host))
      const dir = tmpdir()
      const session = sessionRootMod.createRootSession({
        host,
        id: randomUUID(),
        project: { originalCwd: dir, projectRoot: dir, cwd: dir },
      })
      sessionRootMod.runWithSession(session, () => {
        const registry = taskRegistryMod.createTaskRegistry(
          () => ({ tasks: {} }) as never,
          () => {},
        )
        const stop = localShellMod.startQuietCheckin(
          {
            taskId: `quiet-task-${i}`,
            description: `ephemeral-${i}`,
            taskRegistry: registry,
          },
          { thresholdMs: 20_000, pollMs: 60_000 },
        )
        stop()
      })
    }

    Bun.gc(true)
    localShellMod.resetQuietCheckinOwnersForTests()
    const collectedCount = liveRefs.filter(
      ref => ref.deref() === undefined,
    ).length
    expect(collectedCount).toBeGreaterThan(0)
  })
})
