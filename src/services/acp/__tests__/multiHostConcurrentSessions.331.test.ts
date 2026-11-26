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
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSideConnection } from '@agentclientprotocol/sdk'
import type { SDKMessage } from '../../../entrypoints/agentSdkTypes.js'
import type { ModelUsage } from '../../../entrypoints/agentSdkTypes.js'

// Dynamic imports inside beforeAll ensure that if sibling agent.test.ts ran
// earlier in the same Bun worker, its afterAll restoration of module mocks
// has already completed before we bind exports.
let AcpAgentCtor: typeof import('../agent.js').AcpAgent
let QueryEngineClass: typeof import('../../../QueryEngine.js').QueryEngine
let stateMod: typeof import('../../../bootstrap/state.js')
let sessionRootMod: typeof import('../../../utils/sessionRoot.js')
let cwdMod: typeof import('../../../utils/cwd.js')

beforeAll(async () => {
  ;[
    { AcpAgent: AcpAgentCtor },
    { QueryEngine: QueryEngineClass },
    stateMod,
    sessionRootMod,
    cwdMod,
  ] = await Promise.all([
    import('../agent.js'),
    import('../../../QueryEngine.js'),
    import('../../../bootstrap/state.js'),
    import('../../../utils/sessionRoot.js'),
    import('../../../utils/cwd.js'),
  ])
})

const tick = (ms = 5): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

function makeConn(): AgentSideConnection {
  return {
    sessionUpdate: mock(async () => {}),
    requestPermission: mock(async () => ({
      outcome: { outcome: 'cancelled' as const },
    })),
  } as unknown as AgentSideConnection
}

function makeModelUsage(inputTokens: number, outputTokens: number): ModelUsage {
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 200_000,
    maxOutputTokens: 8192,
  }
}

describe('2.1.331 ACP multi-host concurrent sessions (AsyncLocalStorage)', () => {
  const tempDirs: string[] = []
  const activeSpies: Array<{ mockRestore(): void }> = []

  function makeTempProjectDir(prefix: string): string {
    const raw = mkdtempSync(join(tmpdir(), prefix))
    const canonical = realpathSync(raw).normalize('NFC')
    tempDirs.push(canonical)
    return canonical
  }

  beforeEach(() => {
    sessionRootMod.registerSessionContextReader(
      sessionRootMod.getSessionAlsStore,
    )
    stateMod.resetStateForTests()
  })

  afterEach(() => {
    for (let i = activeSpies.length - 1; i >= 0; i--) {
      activeSpies[i]?.mockRestore()
    }
    activeSpies.length = 0
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
    sessionRootMod.registerSessionContextReader(
      sessionRootMod.getSessionAlsStore,
    )
    stateMod.resetStateForTests()
  })

  test('attaches isolated Session + SessionHost per AcpSession during concurrent newSession without touching process cwd or default host', async () => {
    const dirA = makeTempProjectDir('acp-331-create-a-')
    const dirB = makeTempProjectDir('acp-331-create-b-')

    // Distinct per-project local settings to prove concurrent session creation
    // resolves each session's own SettingsOwner + originalCwd in ALS.
    mkdirSync(join(dirA, '.claude'), { recursive: true })
    writeFileSync(
      join(dirA, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }),
    )
    mkdirSync(join(dirB, '.claude'), { recursive: true })
    writeFileSync(
      join(dirB, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { defaultMode: 'plan' } }),
    )

    const outerDefaultSession = sessionRootMod.getBootstrapSession()
    const outerSessionIdBefore = stateMod.getSessionId()
    const outerOriginalCwdBefore = stateMod.getOriginalCwd()
    const processCwdBefore = process.cwd()

    const agent = new AcpAgentCtor(makeConn())
    await agent.initialize({ protocolVersion: 1 } as never)

    const [resA, resB] = await Promise.all([
      agent.newSession({ cwd: dirA, mcpServers: [] }),
      agent.newSession({ cwd: dirB, mcpServers: [] }),
    ])

    expect(process.cwd()).toBe(processCwdBefore)
    expect(resA.sessionId).not.toBe(resB.sessionId)
    expect(resA.modes?.currentModeId).toBe('acceptEdits')
    expect(resB.modes?.currentModeId).toBe('plan')

    const sessionA = agent.sessions.get(resA.sessionId)
    const sessionB = agent.sessions.get(resB.sessionId)
    expect(sessionA).toBeDefined()
    expect(sessionB).toBeDefined()

    // Distinct Session and SessionHost instances, isolated from default bootstrapSession
    expect(sessionA!.hostSession).not.toBe(sessionB!.hostSession)
    expect(sessionA!.hostSession.host).not.toBe(sessionB!.hostSession.host)
    expect(sessionA!.hostSession).not.toBe(outerDefaultSession)
    expect(sessionB!.hostSession).not.toBe(outerDefaultSession)

    expect(sessionA!.hostSession.id).toBe(resA.sessionId)
    expect(sessionB!.hostSession.id).toBe(resB.sessionId)
    expect(sessionA!.hostSession.project.originalCwd).toBe(dirA)
    expect(sessionB!.hostSession.project.originalCwd).toBe(dirB)
    expect(sessionA!.hostSession.costLedger.belongsTo(resA.sessionId)).toBe(
      true,
    )
    expect(sessionB!.hostSession.costLedger.belongsTo(resB.sessionId)).toBe(
      true,
    )

    // Process-default session outside ALS was never clobbered
    expect(sessionRootMod.hasActiveSessionAls()).toBe(false)
    expect(stateMod.getSessionId()).toBe(outerSessionIdBefore)
    expect(stateMod.getOriginalCwd()).toBe(outerOriginalCwdBefore)
  })

  test('runs 2 ACP sessions concurrently via Promise.all with interleaved async prompts without clobbering getSessionId, getOriginalCwd, cwd, or CostLedger', async () => {
    const dirA = makeTempProjectDir('acp-331-prompt-a-')
    const dirB = makeTempProjectDir('acp-331-prompt-b-')
    const subDirA = join(dirA, 'nested-work')
    mkdirSync(subDirA, { recursive: true })

    const outerSessionIdBefore = stateMod.getSessionId()
    const outerOriginalCwdBefore = stateMod.getOriginalCwd()

    const agent = new AcpAgentCtor(makeConn())
    await agent.initialize({ protocolVersion: 1 } as never)

    const [resA, resB] = await Promise.all([
      agent.newSession({ cwd: dirA, mcpServers: [] }),
      agent.newSession({ cwd: dirB, mcpServers: [] }),
    ])

    // Explicit rendezvous barriers guarantee both prompts overlap in flight
    // across multiple async continuations.
    const aEntered = createDeferred()
    const bEntered = createDeferred()
    const aRecordedCost = createDeferred()
    const bRecordedCost = createDeferred()

    type TurnObservation = {
      alsActive: boolean
      sessionIds: string[]
      originalCwds: string[]
      cwds: string[]
      totalCostUSD: number
      inputTokens: number
      outputTokens: number
      apiDurationMs: number
      linesAdded: number
      linesRemoved: number
    }
    const observations = new Map<string, TurnObservation>()

    const submitSpy = spyOn(
      QueryEngineClass.prototype,
      'submitMessage',
    ).mockImplementation(async function* (promptInput) {
      const text = typeof promptInput === 'string' ? promptInput : ''
      const isAlpha = text.includes('alpha')

      const obs: TurnObservation = {
        alsActive: sessionRootMod.hasActiveSessionAls(),
        sessionIds: [stateMod.getSessionId()],
        originalCwds: [stateMod.getOriginalCwd()],
        cwds: [cwdMod.getCwd()],
        totalCostUSD: 0,
        inputTokens: 0,
        outputTokens: 0,
        apiDurationMs: 0,
        linesAdded: 0,
        linesRemoved: 0,
      }

      if (isAlpha) {
        aEntered.resolve()
        await bEntered.promise
        await tick(4)
      } else {
        bEntered.resolve()
        await aEntered.promise
        await tick(2)
      }

      // After both sessions have entered and yielded across timers:
      obs.sessionIds.push(stateMod.getSessionId())
      obs.originalCwds.push(stateMod.getOriginalCwd())
      obs.cwds.push(cwdMod.getCwd())

      if (isAlpha) {
        // Mutate session A's working directory and CostLedger while B is live
        cwdMod.setCwd(subDirA)
        stateMod.addToTotalCostState(
          1.25,
          makeModelUsage(110, 40),
          'claude-sonnet-4-6',
        )
        stateMod.addToTotalDurationState(120, 100)
        stateMod.addToTotalLinesChanged(15, 3)
        aRecordedCost.resolve()
        await bRecordedCost.promise
        await tick(3)
      } else {
        // Mutate session B's CostLedger concurrently while A is live
        stateMod.addToTotalCostState(
          3.5,
          makeModelUsage(320, 90),
          'claude-opus-4-6',
        )
        stateMod.addToTotalDurationState(450, 410)
        stateMod.addToTotalLinesChanged(42, 11)
        bRecordedCost.resolve()
        await aRecordedCost.promise
        await tick(5)
      }

      // Final interleaved read after the peer session mutated its state:
      obs.sessionIds.push(stateMod.getSessionId())
      obs.originalCwds.push(stateMod.getOriginalCwd())
      obs.cwds.push(cwdMod.getCwd())
      obs.totalCostUSD = stateMod.getTotalCostUSD()
      obs.inputTokens = stateMod.getTotalInputTokens()
      obs.outputTokens = stateMod.getTotalOutputTokens()
      obs.apiDurationMs = stateMod.getTotalAPIDuration()
      obs.linesAdded = stateMod.getTotalLinesAdded()
      obs.linesRemoved = stateMod.getTotalLinesRemoved()

      observations.set(isAlpha ? 'A' : 'B', obs)

      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: obs.apiDurationMs,
        duration_api_ms: obs.apiDurationMs,
        num_turns: 1,
        result: isAlpha ? 'alpha done' : 'beta done',
        stop_reason: 'end_turn',
        session_id: stateMod.getSessionId(),
        total_cost_usd: obs.totalCostUSD,
        usage: {
          input_tokens: obs.inputTokens,
          output_tokens: obs.outputTokens,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: isAlpha
          ? '00000000-0000-4000-8000-000000000001'
          : '00000000-0000-4000-8000-000000000002',
      } as unknown as SDKMessage
    })
    activeSpies.push(submitSpy)

    const [promptResA, promptResB] = await Promise.all([
      agent.prompt({
        sessionId: resA.sessionId,
        prompt: [{ type: 'text', text: 'run alpha task' }],
      }),
      agent.prompt({
        sessionId: resB.sessionId,
        prompt: [{ type: 'text', text: 'run beta task' }],
      }),
    ])

    expect(promptResA.stopReason).toBe('end_turn')
    expect(promptResB.stopReason).toBe('end_turn')

    const obsA = observations.get('A')!
    const obsB = observations.get('B')!
    expect(obsA).toBeDefined()
    expect(obsB).toBeDefined()

    // Session A saw only its own sessionId, originalCwd, updated cwd, and CostLedger
    expect(obsA.alsActive).toBe(true)
    expect(obsA.sessionIds).toEqual([
      resA.sessionId,
      resA.sessionId,
      resA.sessionId,
    ])
    expect(obsA.originalCwds).toEqual([dirA, dirA, dirA])
    expect(obsA.cwds).toEqual([dirA, dirA, subDirA])
    expect(obsA.totalCostUSD).toBeCloseTo(1.25, 5)
    expect(obsA.inputTokens).toBe(110)
    expect(obsA.outputTokens).toBe(40)
    expect(obsA.apiDurationMs).toBe(120)
    expect(obsA.linesAdded).toBe(15)
    expect(obsA.linesRemoved).toBe(3)

    // Session B saw only its own sessionId, originalCwd, untouched cwd, and CostLedger
    expect(obsB.alsActive).toBe(true)
    expect(obsB.sessionIds).toEqual([
      resB.sessionId,
      resB.sessionId,
      resB.sessionId,
    ])
    expect(obsB.originalCwds).toEqual([dirB, dirB, dirB])
    expect(obsB.cwds).toEqual([dirB, dirB, dirB])
    expect(obsB.totalCostUSD).toBeCloseTo(3.5, 5)
    expect(obsB.inputTokens).toBe(320)
    expect(obsB.outputTokens).toBe(90)
    expect(obsB.apiDurationMs).toBe(450)
    expect(obsB.linesAdded).toBe(42)
    expect(obsB.linesRemoved).toBe(11)

    // Direct inspection via runWithSession confirms persistent per-session isolation
    const sessionA = agent.sessions.get(resA.sessionId)!
    const sessionB = agent.sessions.get(resB.sessionId)!
    sessionRootMod.runWithSession(sessionA.hostSession, () => {
      expect(String(stateMod.getSessionId())).toBe(resA.sessionId)
      expect(stateMod.getOriginalCwd()).toBe(dirA)
      expect(cwdMod.getCwd()).toBe(subDirA)
      expect(stateMod.getTotalCostUSD()).toBeCloseTo(1.25, 5)
    })
    sessionRootMod.runWithSession(sessionB.hostSession, () => {
      expect(String(stateMod.getSessionId())).toBe(resB.sessionId)
      expect(stateMod.getOriginalCwd()).toBe(dirB)
      expect(cwdMod.getCwd()).toBe(dirB)
      expect(stateMod.getTotalCostUSD()).toBeCloseTo(3.5, 5)
    })

    // Default host outside ALS remained completely untouched
    expect(sessionRootMod.hasActiveSessionAls()).toBe(false)
    expect(stateMod.getSessionId()).toBe(outerSessionIdBefore)
    expect(stateMod.getOriginalCwd()).toBe(outerOriginalCwdBefore)
    expect(stateMod.getTotalCostUSD()).toBe(0)
  })

  test('isolates resumeSession, loadSession, and forkSession lifecycles across concurrent sessions', async () => {
    const dirA = makeTempProjectDir('acp-331-life-a-')
    const dirB = makeTempProjectDir('acp-331-life-b-')

    const agent = new AcpAgentCtor(makeConn())
    await agent.initialize({ protocolVersion: 1 } as never)

    const resumeId = '11111111-1111-4111-8111-111111111111'
    const loadId = '22222222-2222-4222-8222-222222222222'

    const [resumed, loaded] = await Promise.all([
      agent.unstable_resumeSession({
        sessionId: resumeId,
        cwd: dirA,
        mcpServers: [],
      }),
      agent.loadSession({
        sessionId: loadId,
        cwd: dirB,
        mcpServers: [],
      }),
    ])

    expect(resumed.modes).toBeDefined()
    expect(loaded.modes).toBeDefined()
    expect(agent.sessions.has(resumeId)).toBe(true)
    expect(agent.sessions.has(loadId)).toBe(true)

    const resumedSession = agent.sessions.get(resumeId)!
    const loadedSession = agent.sessions.get(loadId)!
    expect(resumedSession.hostSession).not.toBe(loadedSession.hostSession)

    sessionRootMod.runWithSession(resumedSession.hostSession, () => {
      expect(String(stateMod.getSessionId())).toBe(resumeId)
      expect(stateMod.getOriginalCwd()).toBe(dirA)
    })
    sessionRootMod.runWithSession(loadedSession.hostSession, () => {
      expect(String(stateMod.getSessionId())).toBe(loadId)
      expect(stateMod.getOriginalCwd()).toBe(dirB)
    })

    // Fork from resumeId while loadedSession stays untouched
    const forked = await agent.unstable_forkSession({
      sessionId: resumeId,
      cwd: dirA,
      mcpServers: [],
    })
    expect(forked.sessionId).not.toBe(resumeId)
    const forkedSession = agent.sessions.get(forked.sessionId)!
    expect(forkedSession.hostSession).not.toBe(resumedSession.hostSession)
    expect(forkedSession.hostSession.host).not.toBe(
      resumedSession.hostSession.host,
    )

    sessionRootMod.runWithSession(forkedSession.hostSession, () => {
      expect(String(stateMod.getSessionId())).toBe(forked.sessionId)
      expect(String(stateMod.getParentSessionId())).toBe(resumeId)
      expect(stateMod.getOriginalCwd()).toBe(dirA)
    })
  })
})
