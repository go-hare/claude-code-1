import { afterEach, describe, expect, test } from 'bun:test'
import {
  armObserverPairing,
  buildObserverActivityEnvelope,
  buildObserverFramingPrompt,
  buildObserverFreshRestartFramingPrompt,
  buildObserverPostamble,
  classifyObserverDeliverError,
  classifyStreamMessageToObserverActivity,
  clearAllObserverPairings,
  composeObserverDeliveryBatch,
  createObserverActivityTap,
  deliverObserverBatchWithHost,
  deliverObserverReport,
  drainObserverActivityBuffer,
  drainObserverActivityBufferWithHost,
  enqueueObserverActivity,
  ensureMainSessionObserver,
  ensureObserverRuntimeHost,
  escapeObserverXmlFragments,
  extractObserverTextContent,
  extractObserverTriggerFromMessages,
  formatObserverActivityEvent,
  formatObserverReportDelivery,
  formatObserverResolveWarn,
  getArmedObserverPairing,
  getObserverPairingByObservedKey,
  getObserverPairingByObserverTaskId,
  getObserverRuntimeHost,
  getQuerySourceFamily,
  gateObserverDelivery,
  installObserverPairing,
  isMainSessionObserverBlocked,
  isObserverTaskId,
  kickObserverDeliveryLoop,
  writeObserverStoppedTombstone,
  MAIN_SESSION_OBSERVED_KEY,
  OBSERVER_DEFAULT_POSTAMBLE,
  OBSERVER_FRESH_RESTART_NOTE,
  OBSERVER_PAYLOAD_MAX_CHARS,
  buildObserverSpawnPrompt,
  planMainSessionObserverEnsure,
  planObserverPairingInstall,
  planObserverReattach,
  planObserverSpawnFirstRun,
  resetObserverRuntimeHostForTests,
  resolveObserverAgent,
  runQueryWithObserverActivityTap,
  sanitizeObserverNameToken,
  serializeObserverToolInput,
  setObserverPairingState,
  setObserverRuntimeHost,
  stopMainSessionObserver,
  stopObserverPairing,
  stopObserverPairingForObserved,
  maybeStopObserverForObservedTerminal,
  truncateObserverPayload,
} from '../observerAgents.js'

describe('resolveObserverAgent', () => {
  const agents = [
    { agentType: 'worker', observer: 'watcher' },
    { agentType: 'watcher' },
  ]

  test('none when no observer field', () => {
    expect(
      resolveObserverAgent({
        observedDefinition: { agentType: 'worker' },
        activeAgents: agents,
        env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      }),
    ).toEqual({ status: 'none' })
  })

  test('chaining forbidden', () => {
    expect(
      resolveObserverAgent({
        observedDefinition: { agentType: 'watcher', observer: 'other' },
        activeAgents: agents,
        observedIsObserver: true,
        env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      }).status,
    ).toBe('chaining_forbidden')
  })

  test('disabled when gate off', () => {
    expect(
      resolveObserverAgent({
        observedDefinition: { agentType: 'worker', observer: 'watcher' },
        activeAgents: agents,
        env: {},
      }).status,
    ).toBe('disabled')
  })

  test('missing observer type', () => {
    expect(
      resolveObserverAgent({
        observedDefinition: { agentType: 'worker', observer: 'nope' },
        activeAgents: agents,
        env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      }).status,
    ).toBe('missing_observer')
  })

  test('ok resolves definition', () => {
    const r = resolveObserverAgent({
      observedDefinition: {
        agentType: 'worker',
        observer: 'watcher',
        observerMessage: 'watch me',
      },
      activeAgents: agents,
      env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
    })
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.observerDefinition.agentType).toBe('watcher')
      expect(r.observerMessage).toBe('watch me')
    }
  })

  test('format warn strings', () => {
    expect(
      formatObserverResolveWarn({
        status: 'chaining_forbidden',
        agentType: 'watcher',
      }),
    ).toContain('no chaining')
    expect(
      formatObserverResolveWarn({
        status: 'missing_observer',
        agentType: 'worker',
        observer: 'nope',
      }),
    ).toContain('unobserved')
    expect(formatObserverResolveWarn({ status: 'none' })).toBeNull()
  })
})

describe('observer payload helpers', () => {
  test('escape xml fragments for activity tags', () => {
    expect(escapeObserverXmlFragments('a</tool-call>c')).toBe(
      'a<\\/tool-call>c',
    )
    expect(escapeObserverXmlFragments('plain')).toBe('plain')
  })
  test('truncate default Q8i=2000', () => {
    expect(truncateObserverPayload('hi', 10)).toBe('hi')
    expect(truncateObserverPayload('abcdefghijK', 10)).toContain('truncated')
    expect(OBSERVER_PAYLOAD_MAX_CHARS).toBe(2000)
  })
  test('sanitize name token', () => {
    expect(sanitizeObserverNameToken('Foo Bar!')).toBe('Foo-Bar-')
    // Official EUr: non-empty after replace is kept; only empty → "agent"
    expect(sanitizeObserverNameToken('@@@')).toBe('---')
    expect(sanitizeObserverNameToken('')).toBe('agent')
  })
})

describe('observer activity envelope', () => {
  test('format tool_call / turn_ended', () => {
    expect(
      formatObserverActivityEvent({
        type: 'tool_call',
        name: 'Bash',
        input: 'echo hi',
      }),
    ).toContain('<tool-call name="Bash">')
    expect(
      formatObserverActivityEvent({ type: 'turn_ended', reason: 'done' }),
    ).toBe('<turn-ended reason="done" />')
  })

  test('postamble default + custom message', () => {
    expect(buildObserverPostamble()).toBe(OBSERVER_DEFAULT_POSTAMBLE)
    expect(buildObserverPostamble('extra')).toContain('extra')
  })

  test('build envelope with postamble', () => {
    const xml = buildObserverActivityEnvelope({
      observedEnvelopeName: 'worker',
      trigger: 'start',
      activity: [
        { type: 'user_message', text: 'hi' },
        { type: 'turn_ended', reason: 'ok' },
      ],
      observerMessage: 'be careful',
    })
    expect(xml).toContain('<worker-activity>')
    expect(xml).toContain('</worker-activity>')
    expect(xml).toContain('<user-message>')
    expect(xml).toContain(OBSERVER_DEFAULT_POSTAMBLE)
    expect(xml).toContain('be careful')
  })

  test('withPostamble false skips postamble', () => {
    const xml = buildObserverActivityEnvelope({
      observedEnvelopeName: 'worker',
      activity: [],
      withPostamble: false,
    })
    expect(xml).not.toContain('ObserverReport')
  })
})

describe('observer pairing registry + deliverObserverReport', () => {
  afterEach(() => {
    clearAllObserverPairings()
    resetObserverRuntimeHostForTests()
  })

  test('arm/get/isObserverTaskId', () => {
    armObserverPairing({
      observerTaskId: 'obs-1',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
    })
    expect(isObserverTaskId('obs-1')).toBe(true)
    expect(getArmedObserverPairing('obs-1')?.observedEnvelopeName).toBe(
      'worker',
    )
    setObserverPairingState('obs-1', 'stopped')
    expect(getArmedObserverPairing('obs-1')).toBeUndefined()
  })

  test('formatObserverReportDelivery wraps report in densable agent-message', () => {
    const xml = formatObserverReportDelivery('observer:watcher', 'look out')
    // densable Ll keeps colon in from= (not EUr dash-sanitize)
    expect(xml).toContain('<agent-message from="observer:watcher">')
    expect(xml).toContain('look out')
    expect(xml).toContain('</agent-message>')
  })

  test('deliver to main when no observedTaskId', () => {
    armObserverPairing({
      observerTaskId: 'obs-1',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'main',
    })
    const main: Array<{ v: string; origin: { kind: string; from: string } }> =
      []
    const r = deliverObserverReport({
      observerTaskId: 'obs-1',
      report: 'fix the bug',
      enqueueMain: (v, origin) => main.push({ v, origin }),
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.target).toBe('main')
    expect(main.length).toBe(1)
    expect(main[0]!.v).toContain('fix the bug')
    expect(main[0]!.origin.kind).toBe('observer')
    expect(main[0]!.origin.from).toBe('observer:watcher')
  })

  test('deliver to agent when observedTaskId set and running', () => {
    armObserverPairing({
      observerTaskId: 'obs-2',
      observerAgentType: 'watcher',
      observedTaskId: 'agent-9',
      observedEnvelopeName: 'worker',
    })
    const agent: Array<{
      id: string
      v: string
      origin: { kind: string }
    }> = []
    const r = deliverObserverReport({
      observerTaskId: 'obs-2',
      report: 'missed constraint',
      isObservedRunning: id => id === 'agent-9',
      enqueueMain: () => {},
      enqueueAgent: (id, v, origin) => agent.push({ id, v, origin }),
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.target).toBe('agent')
    expect(agent).toHaveLength(1)
    expect(agent[0]!.id).toBe('agent-9')
    expect(agent[0]!.v).toContain('missed constraint')
    expect(agent[0]!.origin.kind).toBe('observer')
  })

  test('fails without pairing / without agentId', () => {
    expect(
      deliverObserverReport({
        observerTaskId: undefined,
        report: 'x',
        enqueueMain: () => {},
      }).success,
    ).toBe(false)
    expect(
      deliverObserverReport({
        observerTaskId: 'nope',
        report: 'x',
        enqueueMain: () => {},
      }).success,
    ).toBe(false)
  })

  test('fails when observed agent not running', () => {
    armObserverPairing({
      observerTaskId: 'obs-3',
      observerAgentType: 'watcher',
      observedTaskId: 'agent-dead',
      observedEnvelopeName: 'worker',
    })
    const r = deliverObserverReport({
      observerTaskId: 'obs-3',
      report: 'late',
      isObservedRunning: () => false,
      enqueueMain: () => {},
      enqueueAgent: () => {},
    })
    expect(r.success).toBe(false)
    expect(r.message).toContain('not running')
  })

  test('qOu framing prompt densable', () => {
    const p = buildObserverFramingPrompt({
      observedEnvelopeName: 'worker',
      observedTaskId: 'agent-9',
    })
    expect(p).toContain('background observer paired with the agent "worker"')
    expect(p).toContain('<worker-activity>')
    expect(p).toContain('it delivers to "agent-9"')
  })

  test('YOu enqueue + SOg drain densables', async () => {
    armObserverPairing({
      observerTaskId: 'obs-4',
      observerAgentType: 'watcher',
      observedTaskId: 'agent-9',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-9',
      observerMessage: 'be careful',
    })
    expect(getObserverPairingByObservedKey('agent-9')?.observerTaskId).toBe(
      'obs-4',
    )
    expect(
      enqueueObserverActivity({
        observedKey: 'agent-9',
        activity: [{ type: 'turn_ended', reason: 'ok' }],
        trigger: 'start',
      }),
    ).toBe(true)
    const pairing = getArmedObserverPairing('obs-4')
    expect(pairing?.buffer?.length).toBe(1)
    const spawned: string[] = []
    const delivered: string[] = []
    const status = await drainObserverActivityBuffer({
      pairing: pairing!,
      gate: () => 'allow',
      spawnFirstRun: async digest => {
        spawned.push(digest)
      },
      deliver: async digest => {
        delivered.push(digest)
      },
    })
    expect(status).toBe('ok')
    expect(spawned.length).toBe(1)
    expect(delivered.length).toBe(0)
    expect(spawned[0]).toContain('worker-activity')
    expect(spawned[0]).toContain(OBSERVER_DEFAULT_POSTAMBLE)
    expect(pairing?.firstRunDone).toBe(true)
    expect(pairing?.buffer?.length).toBe(0)

    // second drain uses deliver path
    enqueueObserverActivity({
      observedKey: 'agent-9',
      activity: [{ type: 'user_message', text: 'hi' }],
    })
    const status2 = await drainObserverActivityBuffer({
      pairing: pairing!,
      gate: () => 'allow',
      spawnFirstRun: async digest => {
        spawned.push(digest)
      },
      deliver: async digest => {
        delivered.push(digest)
      },
    })
    expect(status2).toBe('ok')
    expect(delivered.length).toBe(1)
  })

  test('composeObserverDeliveryBatch joins digests + postamble', () => {
    const composed = composeObserverDeliveryBatch(
      { observedEnvelopeName: 'worker', observerMessage: 'x' },
      [{ digest: '<worker-activity>\nok\n</worker-activity>' }],
    )
    expect(composed).toContain('<worker-activity>')
    expect(composed).toContain(OBSERVER_DEFAULT_POSTAMBLE)
    expect(composed).toContain('x')
  })

  test('drain deny clears buffer and sets denied', async () => {
    armObserverPairing({
      observerTaskId: 'obs-5',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'k5',
    })
    enqueueObserverActivity({
      observedKey: 'k5',
      activity: [{ type: 'turn_ended', reason: 'x' }],
    })
    const pairing = getArmedObserverPairing('obs-5')!
    const status = await drainObserverActivityBuffer({
      pairing,
      gate: () => 'deny',
      spawnFirstRun: async () => {},
      deliver: async () => {},
    })
    expect(status).toBe('denied')
    expect(pairing.state).toBe('denied')
    expect(pairing.buffer?.length).toBe(0)
  })

  test('G0t host registry + n5r stop densables', async () => {
    expect(getObserverRuntimeHost()).toBeNull()
    expect(
      await drainObserverActivityBufferWithHost({
        pairing: {
          observerTaskId: 'x',
          observerAgentType: 'w',
          observedEnvelopeName: 'm',
          state: 'armed',
        },
        gate: () => 'allow',
      }),
    ).toBe('disabled')

    const spawned: string[] = []
    const tombs: string[] = []
    setObserverRuntimeHost({
      spawnFirstRun: async ({ digest }) => {
        spawned.push(digest)
      },
      deliver: async () => {},
      writeTombstone: async ({ observerTaskId }) => {
        tombs.push(observerTaskId)
      },
    })
    expect(getObserverRuntimeHost()).not.toBeNull()

    armObserverPairing({
      observerTaskId: 'obs-host',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'main-key',
    })
    enqueueObserverActivity({
      observedKey: 'main-key',
      activity: [{ type: 'turn_ended', reason: 'done' }],
    })
    const pairing = getArmedObserverPairing('obs-host')!
    const status = await drainObserverActivityBufferWithHost({
      pairing,
      gate: () => 'allow',
    })
    expect(status).toBe('ok')
    expect(spawned.length).toBe(1)
    expect(pairing.firstRunDone).toBe(true)

    const stopped = await stopObserverPairing('obs-host')
    expect(stopped?.state).toBe('stopped')
    expect(tombs).toEqual(['obs-host'])
  })

  test('GOu stopMainSessionObserver densable', async () => {
    armObserverPairing({
      observerTaskId: 'obs-main',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'main',
      observedKey: 'zCe',
    })
    expect(await stopMainSessionObserver('zCe')).toBe(true)
    expect(isMainSessionObserverBlocked()).toBe(true)
    expect(getArmedObserverPairing('obs-main')).toBeUndefined()
    expect(await stopMainSessionObserver('zCe')).toBe(false)
  })

  test('stopObserverPairingForObserved agent-end densable', async () => {
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs-end',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-end-1',
    })
    expect(getObserverPairingByObservedKey('agent-end-1')?.state).toBe('armed')
    const stopped = await stopObserverPairingForObserved('agent-end-1')
    expect(stopped?.observerTaskId).toBe('obs-end')
    expect(stopped?.state).toBe('stopped')
    expect(getArmedObserverPairing('obs-end')).toBeUndefined()
    // idempotent when already stopped
    expect(await stopObserverPairingForObserved('agent-end-1')).toBeUndefined()
    expect(await stopObserverPairingForObserved('missing')).toBeUndefined()

    armObserverPairing({
      observerTaskId: 'obs-term',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-term',
    })
    const logs: string[] = []
    maybeStopObserverForObservedTerminal(null)
    maybeStopObserverForObservedTerminal(undefined)
    // Deterministic path (maybeStop is fire-and-forget)
    const stoppedTerm = await stopObserverPairingForObserved('agent-term')
    expect(stoppedTerm?.observerTaskId).toBe('obs-term')
    expect(getArmedObserverPairing('obs-term')).toBeUndefined()

    armObserverPairing({
      observerTaskId: 'obs-term-ff',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-term-ff',
    })
    await new Promise<void>(resolve => {
      maybeStopObserverForObservedTerminal('agent-term-ff', msg => {
        logs.push(msg)
        resolve()
      })
      // Resolve even if log path is skipped (should not happen when armed)
      setTimeout(resolve, 50)
    })
    expect(getArmedObserverPairing('obs-term-ff')).toBeUndefined()
    expect(
      logs.some(l => l.includes('obs-term-ff') && l.includes('agent-term-ff')),
    ).toBe(true)
  })

  test('planObserverSpawnFirstRun o5r densable', () => {
    const plan = planObserverSpawnFirstRun({
      pairing: {
        observerTaskId: 'obs-spawn',
        observerAgentType: 'watcher',
        observedEnvelopeName: 'worker',
        observedTaskId: 'agent-1',
        state: 'armed',
        observerMessage: 'be careful',
      },
      digest: '<activity>tool</activity>',
      framingPrompt: 'FRAME',
    })
    expect(plan.observerTaskId).toBe('obs-spawn')
    expect(plan.querySource).toBe('agent:observer:watcher')
    expect(plan.description).toContain('watcher')
    expect(plan.prompt).toContain('FRAME')
    expect(plan.prompt).toContain('<activity>tool</activity>')
    expect(
      buildObserverSpawnPrompt({
        digest: 'd',
        framingPrompt: 'f',
      }),
    ).toBe('f\n\nd')
  })

  test('ensureObserverRuntimeHost jOu densable installs default host', async () => {
    resetObserverRuntimeHostForTests()
    clearAllObserverPairings()
    expect(getObserverRuntimeHost()).toBeNull()
    const host = ensureObserverRuntimeHost()
    expect(getObserverRuntimeHost()).toBe(host)
    // Idempotent without force
    expect(ensureObserverRuntimeHost()).toBe(host)

    armObserverPairing({
      observerTaskId: 'obs-ensure',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'k-ensure',
    })
    enqueueObserverActivity({
      observedKey: 'k-ensure',
      activity: [{ type: 'turn_ended', reason: 'done' }],
    })
    const pairing = getArmedObserverPairing('obs-ensure')!
    // Default host refuses first-run so firstRunDone is never advanced by a
    // log-only stub (batch restored for a later real-host inject).
    await expect(
      drainObserverActivityBufferWithHost({
        pairing,
        gate: () => 'allow',
      }),
    ).rejects.toThrow(/spawnFirstRun not injected/)
    expect(pairing.firstRunDone).toBe(false)
    expect(pairing.buffer?.length).toBe(1)
  })

  test('planObserverPairingInstall + installObserverPairing o5r densable', async () => {
    resetObserverRuntimeHostForTests()
    clearAllObserverPairings()
    const planned = planObserverPairingInstall({
      observedKey: 'agent-1',
      observedTaskId: 'agent-1',
      observedName: 'Worker Agent!',
      observerDefinition: { agentType: 'watcher', observerMessage: 'careful' },
      generateObserverTaskId: () => 'obs-plan',
    })
    expect(planned.observerTaskId).toBe('obs-plan')
    expect(planned.observedEnvelopeName).toBe('Worker-Agent-')
    expect(planned.firstRunDone).toBe(false)
    expect(planned.observerMessage).toBe('careful')

    // Cold reattach (no live process): firstRunDone=false AND fresh id
    // (never re-register under residual dead observerTaskId).
    const coldReattach = planObserverPairingInstall({
      observedKey: 'agent-1',
      observedName: 'worker',
      observerDefinition: { agentType: 'watcher' },
      reattachObserverTaskId: 'obs-reattach',
      generateObserverTaskId: () => 'obs-fresh-cold',
    })
    expect(coldReattach.firstRunDone).toBe(false)
    expect(coldReattach.observerTaskId).toBe('obs-fresh-cold')
    expect(coldReattach.observerTaskId).not.toBe('obs-reattach')

    // Hot reattach (observer process still running): deliver-only path.
    const hotReattach = planObserverPairingInstall({
      observedKey: 'agent-1',
      observedName: 'worker',
      observerDefinition: { agentType: 'watcher' },
      reattachObserverTaskId: 'obs-reattach-hot',
      observerProcessRunning: true,
    })
    expect(hotReattach.firstRunDone).toBe(true)
    expect(hotReattach.observerTaskId).toBe('obs-reattach-hot')

    // require host by default
    expect(
      await installObserverPairing({
        observedKey: 'k',
        observedName: 'worker',
        observerDefinition: { agentType: 'watcher' },
      }),
    ).toBeUndefined()

    ensureObserverRuntimeHost()
    const installed = await installObserverPairing({
      observedKey: 'k-install',
      observedName: 'worker',
      observerDefinition: { agentType: 'watcher' },
      observerTaskId: 'obs-install',
    })
    expect(installed?.observerTaskId).toBe('obs-install')
    expect(getObserverPairingByObservedKey('k-install')?.state).toBe('armed')

    const denied = await installObserverPairing({
      observedKey: 'main',
      observedName: 'main',
      observerDefinition: { agentType: 'watcher' },
      observerTaskId: 'obs-deny',
      mainSessionKey: 'main',
      armGate: () => 'deny',
    })
    expect(denied).toBeUndefined()
    // main-session deny records denied pairing
    expect(getObserverPairingByObservedKey('main')?.state).toBe('denied')
  })

  test('deliverObserverBatchWithHost vOg densable', async () => {
    resetObserverRuntimeHostForTests()
    clearAllObserverPairings()
    const spawned: string[] = []
    const delivered: string[] = []
    setObserverRuntimeHost({
      spawnFirstRun: async ({ framingPrompt, digest }) => {
        spawned.push(`${framingPrompt ?? ''}|${digest}`)
      },
      deliver: async ({ digest }) => {
        delivered.push(digest)
      },
    })
    armObserverPairing({
      observerTaskId: 'obs-vog',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'k-vog',
      observerDefinition: { agentType: 'watcher' },
    })
    const pairing = getArmedObserverPairing('obs-vog')!
    expect(
      await deliverObserverBatchWithHost({
        pairing,
        digest: 'first',
      }),
    ).toBe('spawned')
    // firstRunDone is drain-owned (gen validation); direct vOg spawn leaves it false.
    expect(pairing.firstRunDone).toBe(false)
    expect(spawned.length).toBe(1)
    expect(spawned[0]).toContain('background observer')

    // Simulate drain advancing firstRunDone after successful gen check.
    pairing.firstRunDone = true
    expect(
      await deliverObserverBatchWithHost({
        pairing,
        digest: 'second',
      }),
    ).toBe('delivered')
    expect(delivered).toEqual(['second'])

    // ResumeAgentStateError → restart with new task id; firstRunDone cleared.
    setObserverRuntimeHost({
      spawnFirstRun: async () => {
        spawned.push('restart')
      },
      deliver: async () => {
        const err = new Error('resume')
        err.name = 'ResumeAgentStateError'
        throw err
      },
    })
    const status = await deliverObserverBatchWithHost({
      pairing,
      digest: 'third',
      allocateObserverTaskId: () => 'obs-vog-2',
    })
    expect(status).toBe('restarted')
    expect(pairing.observerTaskId).toBe('obs-vog-2')
    expect(pairing.firstRunDone).toBe(false)
    expect(getArmedObserverPairing('obs-vog-2')).toBeDefined()
    expect(spawned.at(-1)).toBe('restart')
    expect(buildObserverFreshRestartFramingPrompt(pairing)).toContain(
      OBSERVER_FRESH_RESTART_NOTE,
    )

    // AgentStoppedByUserError → stopped
    setObserverRuntimeHost({
      spawnFirstRun: async () => {},
      deliver: async () => {
        const err = new Error('stop')
        err.name = 'AgentStoppedByUserError'
        throw err
      },
    })
    const live = getArmedObserverPairing('obs-vog-2')!
    live.firstRunDone = true
    expect(
      await deliverObserverBatchWithHost({ pairing: live, digest: 'x' }),
    ).toBe('stopped')
    expect(live.state as string).toBe('stopped')

    expect(
      classifyObserverDeliverError({ name: 'AgentStoppedByUserError' }),
    ).toBe('stopped_by_user')
  })

  test('drain advances firstRunDone after restart spawn', async () => {
    resetObserverRuntimeHostForTests()
    clearAllObserverPairings()
    const spawnedFraming: string[] = []
    setObserverRuntimeHost({
      spawnFirstRun: async ({ framingPrompt, digest }) => {
        spawnedFraming.push(`${framingPrompt ?? ''}|${digest}`)
      },
      deliver: async () => {
        const err = new Error('resume')
        err.name = 'ResumeAgentStateError'
        throw err
      },
    })
    armObserverPairing({
      observerTaskId: 'obs-restart-drain',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'k-restart-drain',
      observerDefinition: { agentType: 'watcher' },
    })
    const pairing = getArmedObserverPairing('obs-restart-drain')!
    pairing.firstRunDone = true
    pairing.buffer = [{ digest: 'restart-digest' }]
    const status = await drainObserverActivityBufferWithHost({
      pairing,
      gate: () => 'allow',
    })
    expect(status).toBe('ok')
    // Drain owns firstRunDone advancement after successful restart spawn.
    expect(pairing.firstRunDone).toBe(true)
    expect(pairing.observerTaskId).not.toBe('obs-restart-drain')
    expect(spawnedFraming.length).toBe(1)
    expect(spawnedFraming[0]).toContain(OBSERVER_FRESH_RESTART_NOTE)
  })
})

describe('observer activity tap JOu/wOg densable', () => {
  afterEach(() => {
    clearAllObserverPairings()
    resetObserverRuntimeHostForTests()
  })

  test('getQuerySourceFamily TN densable', () => {
    expect(getQuerySourceFamily(undefined)).toBeUndefined()
    expect(getQuerySourceFamily('repl_main_thread')).toBe('main')
    expect(getQuerySourceFamily('repl_main_thread:resume')).toBe('main')
    expect(getQuerySourceFamily('sdk')).toBe('main')
    expect(getQuerySourceFamily('agent:worker')).toBe('subagent')
    expect(getQuerySourceFamily('hook_agent')).toBe('subagent')
    expect(getQuerySourceFamily('compact')).toBe('auxiliary')
    expect(getQuerySourceFamily('tool_use_summary_generation')).toBe(
      'auxiliary',
    )
  })

  test('extractObserverTextContent HZi densable', () => {
    expect(extractObserverTextContent('  hi  ')).toBe('  hi  ')
    expect(extractObserverTextContent('   ')).toBeUndefined()
    expect(
      extractObserverTextContent([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
        { type: 'image' },
      ]),
    ).toBe('a\nb')
    expect(extractObserverTextContent([{ type: 'image' }])).toBeUndefined()
    expect(extractObserverTextContent(null)).toBeUndefined()
  })

  test('serializeObserverToolInput AOg densable', () => {
    expect(serializeObserverToolInput({ a: 1 })).toBe('{"a":1}')
    expect(serializeObserverToolInput('x')).toBe('"x"')
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(serializeObserverToolInput(circular)).toBe('[unserializable]')
  })

  test('classifyStreamMessageToObserverActivity wOg densable', () => {
    expect(classifyStreamMessageToObserverActivity(null)).toBeNull()
    expect(
      classifyStreamMessageToObserverActivity({ type: 'stream_event' }),
    ).toBeNull()

    const assistant = classifyStreamMessageToObserverActivity({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } },
          { type: 'text', text: '   ' },
        ],
      },
    })
    expect(assistant).toEqual([
      { type: 'assistant_text', text: 'hello' },
      {
        type: 'tool_call',
        name: 'Bash',
        input: '{"cmd":"ls"}',
      },
    ])

    const toolResults = classifyStreamMessageToObserverActivity({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', content: 'ok' },
          {
            type: 'tool_result',
            content: [{ type: 'text', text: 'more' }],
          },
        ],
      },
    })
    expect(toolResults).toEqual([
      { type: 'tool_result', content: 'ok' },
      { type: 'tool_result', content: 'more' },
    ])

    const userMsg = classifyStreamMessageToObserverActivity({
      type: 'user',
      message: { content: 'please fix' },
    })
    expect(userMsg).toEqual([{ type: 'user_message', text: 'please fix' }])
  })

  test('extractObserverTriggerFromMessages COg densable', () => {
    expect(
      extractObserverTriggerFromMessages([
        { type: 'assistant', message: { content: 'x' } },
        { type: 'user', message: { content: 'one' } },
        {
          type: 'user',
          message: { content: [{ type: 'text', text: 'two' }] },
        },
      ]),
    ).toBe('one\ntwo')
    expect(extractObserverTriggerFromMessages([])).toBeUndefined()
  })

  test('createObserverActivityTap JOu densable capture/flush/finish', () => {
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs-tap',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-tap',
    })

    const enqueued: Array<{
      activity: unknown
      trigger?: string
      kickDrain?: boolean
    }> = []
    const tap = createObserverActivityTap({
      querySource: 'agent:worker',
      toolUseContext: { agentId: 'agent-tap' },
      messages: [
        { type: 'user', message: { content: 'do the thing' } },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'ok' }] },
        },
      ],
      turnStartIndex: 0,
      enqueue: input => {
        enqueued.push({
          activity: input.activity,
          ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
          kickDrain: input.kickDrain,
        })
        return true
      },
    })
    expect(tap).not.toBeNull()

    tap!.capture({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'working' },
          { type: 'tool_use', name: 'Read', input: { path: 'a.ts' } },
        ],
      },
    })
    // mid-turn stream_request_start flush (without turn_ended)
    tap!.flushSegment()
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]!.trigger).toBe('do the thing')
    expect(enqueued[0]!.kickDrain).toBe(true)
    expect(enqueued[0]!.activity).toEqual([
      { type: 'assistant_text', text: 'working' },
      {
        type: 'tool_call',
        name: 'Read',
        input: '{"path":"a.ts"}',
      },
    ])

    tap!.capture({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', content: 'file body' }],
      },
    })
    tap!.finish('completed')
    expect(enqueued).toHaveLength(2)
    // trigger only on first flush
    expect(enqueued[1]!.trigger).toBeUndefined()
    expect(enqueued[1]!.activity).toEqual([
      { type: 'tool_result', content: 'file body' },
      { type: 'turn_ended', reason: 'completed' },
    ])

    // finish is idempotent
    tap!.finish('completed')
    expect(enqueued).toHaveLength(2)
  })

  test('createObserverActivityTap skips auxiliary and unarmed', () => {
    clearAllObserverPairings()
    expect(
      createObserverActivityTap({
        querySource: 'compact',
        toolUseContext: { agentId: 'x' },
        messages: [],
      }),
    ).toBeNull()

    expect(
      createObserverActivityTap({
        querySource: 'repl_main_thread',
        toolUseContext: {},
        messages: [],
      }),
    ).toBeNull()

    armObserverPairing({
      observerTaskId: 'obs-main-tap',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'main',
      observedKey: MAIN_SESSION_OBSERVED_KEY,
    })
    expect(
      createObserverActivityTap({
        querySource: 'repl_main_thread',
        toolUseContext: {},
        messages: [{ type: 'user', message: { content: 'hi' } }],
      }),
    ).not.toBeNull()
  })

  test('createObserverActivityTap skips when turn already has observer origin', () => {
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs-self',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-self',
    })
    expect(
      createObserverActivityTap({
        querySource: 'agent:worker',
        toolUseContext: { agentId: 'agent-self' },
        messages: [
          {
            type: 'user',
            origin: {
              kind: 'observer',
              from: 'observer:watcher',
              senderTaskId: 'obs-self',
            },
            message: { content: 'report' },
          },
        ],
      }),
    ).toBeNull()
  })

  test('runQueryWithObserverActivityTap wrapper densable', async () => {
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs-wrap',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-wrap',
    })
    const enqueued: unknown[] = []
    const tap = createObserverActivityTap({
      querySource: 'agent:worker',
      toolUseContext: { agentId: 'agent-wrap' },
      messages: [{ type: 'user', message: { content: 'go' } }],
      enqueue: input => {
        enqueued.push(input.activity)
        return true
      },
    })

    async function* inner() {
      yield { type: 'stream_request_start' as const }
      yield {
        type: 'assistant' as const,
        message: { content: [{ type: 'text', text: 'hi' }] },
      }
      return { reason: 'completed' as const }
    }

    const yielded: unknown[] = []
    const gen = runQueryWithObserverActivityTap(inner(), tap)
    for await (const v of gen) {
      yielded.push(v)
    }
    // for-await does not capture return; re-drive via manual next after done
    // — runQueryWithObserverActivityTap finishes on done before return.
    expect(yielded).toHaveLength(2)
    expect((yielded[0] as { type: string }).type).toBe('stream_request_start')
    // finish should have enqueued assistant_text + turn_ended
    expect(enqueued.length).toBeGreaterThanOrEqual(1)
    const last = enqueued[enqueued.length - 1] as Array<{ type: string }>
    expect(last.some(e => e.type === 'turn_ended')).toBe(true)
    expect(last.some(e => e.type === 'assistant_text')).toBe(true)
  })
})

describe('observer production densables cont.12', () => {
  afterEach(() => {
    clearAllObserverPairings()
    resetObserverRuntimeHostForTests()
  })

  test('drain restores batch on spawn throw', async () => {
    armObserverPairing({
      observerTaskId: 'obs-restore',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'k-restore',
    })
    enqueueObserverActivity({
      observedKey: 'k-restore',
      activity: [{ type: 'turn_ended', reason: 'x' }],
    })
    const pairing = getArmedObserverPairing('obs-restore')!
    expect(pairing.buffer?.length).toBe(1)
    await expect(
      drainObserverActivityBuffer({
        pairing,
        gate: () => 'allow',
        spawnFirstRun: async () => {
          throw new Error('spawn boom')
        },
        deliver: async () => {},
      }),
    ).rejects.toThrow('spawn boom')
    expect(pairing.buffer?.length).toBe(1)
    expect(pairing.delivering).toBe(false)
    expect(pairing.firstRunDone).toBe(false)
  })

  test('kick while delivering sets drainDirty and re-drains', async () => {
    let resolveFirst!: () => void
    const firstGate = new Promise<void>(r => {
      resolveFirst = r
    })
    const delivered: string[] = []
    setObserverRuntimeHost({
      spawnFirstRun: async ({ digest }) => {
        delivered.push(`spawn:${digest.length}`)
        await firstGate
      },
      deliver: async ({ digest }) => {
        delivered.push(`deliver:${digest.length}`)
      },
    })
    armObserverPairing({
      observerTaskId: 'obs-dirty',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'k-dirty',
    })
    enqueueObserverActivity({
      observedKey: 'k-dirty',
      activity: [{ type: 'assistant_text', text: 'a' }],
    })
    const pairing = getArmedObserverPairing('obs-dirty')!
    const first = drainObserverActivityBufferWithHost({
      pairing,
      gate: () => 'allow',
    })
    // Concurrent enqueue + kick while first drain holds delivering
    await Promise.resolve()
    enqueueObserverActivity({
      observedKey: 'k-dirty',
      activity: [{ type: 'assistant_text', text: 'b' }],
      kickDrain: true,
    })
    expect(pairing.drainDirty).toBe(true)
    resolveFirst()
    await first
    // wait for re-kick deliver
    await new Promise(r => setTimeout(r, 30))
    expect(delivered.length).toBeGreaterThanOrEqual(1)
    expect(pairing.buffer?.length ?? 0).toBe(0)
  })

  test('stop aborts observer and clears map', async () => {
    const aborted: string[] = []
    setObserverRuntimeHost({
      spawnFirstRun: async () => {},
      deliver: async () => {},
      abortObserver: ({ observerTaskId }) => {
        aborted.push(observerTaskId)
      },
    })
    armObserverPairing({
      observerTaskId: 'obs-abort',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'k-abort',
    })
    const stopped = await stopObserverPairing('obs-abort')
    expect(stopped?.state).toBe('stopped')
    expect(aborted).toEqual(['obs-abort'])
    expect(getObserverPairingByObserverTaskId('obs-abort')).toBeUndefined()
    expect(getObserverPairingByObservedKey('k-abort')).toBeUndefined()
  })

  test('planObserverReattach KOu densable', async () => {
    expect(
      await planObserverReattach({
        declaredObserverType: 'watcher',
      }),
    ).toEqual({ mode: 'fresh' })

    expect(
      await planObserverReattach({
        priorObserverTaskId: 'obs-1',
        declaredObserverType: 'watcher',
        loadSidecar: async () => ({ observerStopped: true }),
      }),
    ).toEqual({ mode: 'blocked' })

    expect(
      await planObserverReattach({
        priorObserverTaskId: 'obs-1',
        declaredObserverType: 'watcher',
        loadSidecar: async () => ({ agentType: 'other' }),
      }),
    ).toEqual({ mode: 'fresh' })

    expect(
      await planObserverReattach({
        priorObserverTaskId: 'obs-1',
        declaredObserverType: 'watcher',
        loadSidecar: async () => ({ agentType: 'watcher' }),
        isSidecarReattachable: async () => true,
      }),
    ).toEqual({ mode: 'reattach', observerTaskId: 'obs-1' })
  })

  test('planMainSessionObserverEnsure + ensureMainSessionObserver VOu densable', async () => {
    expect(
      planMainSessionObserverEnsure({
        mainAgentDefinition: { agentType: 'main' },
        activeAgents: [{ agentType: 'watcher' }],
        env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      }).status,
    ).toBe('skip')

    const plan = planMainSessionObserverEnsure({
      mainAgentDefinition: { agentType: 'main', observer: 'watcher' },
      activeAgents: [{ agentType: 'watcher' }],
      env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
    })
    expect(plan.status).toBe('arm')
    if (plan.status === 'arm') {
      expect(plan.observedKey).toBe(MAIN_SESSION_OBSERVED_KEY)
      expect(plan.observerDefinition.agentType).toBe('watcher')
    }

    ensureObserverRuntimeHost()
    const pairing = await ensureMainSessionObserver({
      mainAgentDefinition: { agentType: 'main', observer: 'watcher' },
      activeAgents: [{ agentType: 'watcher' }],
      env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      generateObserverTaskId: () => 'obs-main-ensure',
      // unit path: no disk HXt
      persistPointer: false,
    })
    expect(pairing?.observerTaskId).toBe('obs-main-ensure')
    expect(
      getObserverPairingByObservedKey(MAIN_SESSION_OBSERVED_KEY)?.state,
    ).toBe('armed')
    // second ensure skips
    expect(
      await ensureMainSessionObserver({
        mainAgentDefinition: { agentType: 'main', observer: 'watcher' },
        activeAgents: [{ agentType: 'watcher' }],
        env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
        persistPointer: false,
      }),
    ).toBeUndefined()
  })

  test('ensureMainSessionObserver main HXt pointer load + cold remint rewrite', async () => {
    ensureObserverRuntimeHost()
    const store: {
      observerTaskId?: string
      armingPermissionMode?: string
      observerAgentType?: string
    } = {
      observerTaskId: 'obs-main-prior',
      armingPermissionMode: 'bypassPermissions',
      observerAgentType: 'watcher',
    }
    let saves = 0

    // Cold: prior pointer, process not running → fresh id + rewrite pointer
    const cold = await ensureMainSessionObserver({
      mainAgentDefinition: { agentType: 'main', observer: 'watcher' },
      activeAgents: [{ agentType: 'watcher' }],
      env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      generateObserverTaskId: () => 'obs-main-fresh',
      loadMainObserverPointer: async () => ({ ...store }),
      saveMainObserverPointer: async p => {
        saves++
        store.observerTaskId = p.observerTaskId
        if (p.armingPermissionMode !== undefined) {
          store.armingPermissionMode = p.armingPermissionMode
        }
        if (p.observerAgentType !== undefined) {
          store.observerAgentType = p.observerAgentType
        }
      },
      reattach: {
        loadSidecar: async () => ({ agentType: 'watcher' }),
        isSidecarReattachable: async () => true,
      },
      isObserverProcessRunning: () => false,
    })
    expect(cold?.observerTaskId).toBe('obs-main-fresh')
    expect(cold?.observerTaskId).not.toBe('obs-main-prior')
    expect(cold?.firstRunDone).toBe(false)
    // bypassPermissions normalized when loaded from pointer into arming mode
    expect(cold?.armingPermissionMode).toBe('default')
    expect(saves).toBe(1)
    expect(store.observerTaskId).toBe('obs-main-fresh')

    // Clear in-memory pairing to simulate process restart; hot reattach
    clearAllObserverPairings()
    store.observerTaskId = 'obs-main-hot'
    store.armingPermissionMode = 'acceptEdits'
    const hot = await ensureMainSessionObserver({
      mainAgentDefinition: { agentType: 'main', observer: 'watcher' },
      activeAgents: [{ agentType: 'watcher' }],
      env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      generateObserverTaskId: () => 'obs-should-not-use',
      loadMainObserverPointer: async () => ({ ...store }),
      saveMainObserverPointer: async p => {
        saves++
        store.observerTaskId = p.observerTaskId
        if (p.armingPermissionMode !== undefined) {
          store.armingPermissionMode = p.armingPermissionMode
        }
      },
      reattach: {
        loadSidecar: async () => ({ agentType: 'watcher' }),
        isSidecarReattachable: async () => true,
      },
      isObserverProcessRunning: id => id === 'obs-main-hot',
    })
    expect(hot?.observerTaskId).toBe('obs-main-hot')
    expect(hot?.firstRunDone).toBe(true)
    expect(hot?.armingPermissionMode).toBe('acceptEdits')
    expect(store.observerTaskId).toBe('obs-main-hot')
  })

  test('ensureMainSessionObserver blocked when observerStopped on sidecar', async () => {
    ensureObserverRuntimeHost()
    const blocked = await ensureMainSessionObserver({
      mainAgentDefinition: { agentType: 'main', observer: 'watcher' },
      activeAgents: [{ agentType: 'watcher' }],
      env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      priorObserverTaskId: 'obs-main-stopped',
      reattach: {
        loadSidecar: async () => ({
          agentType: 'watcher',
          observerStopped: true,
        }),
      },
      persistPointer: false,
    })
    expect(blocked).toBeUndefined()
    expect(isMainSessionObserverBlocked()).toBe(true)
    // subsequent ensure skips while blocked
    expect(
      await ensureMainSessionObserver({
        mainAgentDefinition: { agentType: 'main', observer: 'watcher' },
        activeAgents: [{ agentType: 'watcher' }],
        env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
        persistPointer: false,
      }),
    ).toBeUndefined()
  })

  test('ensureObserverRuntimeHost merges without force clobber', () => {
    const a: string[] = []
    const b: string[] = []
    ensureObserverRuntimeHost({
      spawnFirstRun: async () => {
        a.push('spawn-a')
      },
      deliver: async () => {
        a.push('deliver-a')
      },
    })
    // second install without force merges abort only
    ensureObserverRuntimeHost({
      abortObserver: () => {
        b.push('abort')
      },
    })
    const host = getObserverRuntimeHost()!
    expect(host.abortObserver).toBeDefined()
    // spawn still from first install
    void host.spawnFirstRun({
      pairing: {
        observerTaskId: 'x',
        observerAgentType: 'w',
        observedEnvelopeName: 'm',
        state: 'armed',
      },
      digest: 'd',
    })
    expect(a).toContain('spawn-a')
  })

  test('kickObserverDeliveryLoop when no host is no-op', () => {
    armObserverPairing({
      observerTaskId: 'obs-nohost',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'k-nohost',
    })
    const pairing = getArmedObserverPairing('obs-nohost')!
    kickObserverDeliveryLoop(pairing)
    expect(pairing.delivering).toBe(false)
  })

  test('ensureObservedAgentObserver zOu densable reattach + skip existing', async () => {
    const {
      ensureObservedAgentObserver,
      normalizePersistedObserverArmingMode,
    } = await import('../observerAgents.js')
    expect(normalizePersistedObserverArmingMode('bypassPermissions')).toBe(
      'default',
    )
    expect(normalizePersistedObserverArmingMode('acceptEdits')).toBe(
      'acceptEdits',
    )

    ensureObserverRuntimeHost()
    // fresh arm from declaration
    const armed = await ensureObservedAgentObserver({
      observedTaskId: 'agent-zou-1',
      observedDefinition: { agentType: 'worker', observer: 'watcher' },
      observedName: 'worker',
      activeAgents: [
        { agentType: 'worker', observer: 'watcher' },
        { agentType: 'watcher' },
      ],
      env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      generateObserverTaskId: () => 'obs-zou-fresh',
    })
    expect(armed?.observerTaskId).toBe('obs-zou-fresh')
    expect(getObserverPairingByObservedKey('agent-zou-1')?.state).toBe('armed')

    // already present → return existing
    const again = await ensureObservedAgentObserver({
      observedTaskId: 'agent-zou-1',
      observedDefinition: { agentType: 'worker', observer: 'watcher' },
      activeAgents: [
        { agentType: 'worker', observer: 'watcher' },
        { agentType: 'watcher' },
      ],
      env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
    })
    expect(again?.observerTaskId).toBe('obs-zou-fresh')

    // Cold reattach (prior id, process not running) → firstRunDone=false
    // + fresh observerTaskId (not residual prior id).
    clearAllObserverPairings()
    const coldRearmed = await ensureObservedAgentObserver({
      observedTaskId: 'agent-zou-2',
      observedDefinition: { agentType: 'worker', observer: 'watcher' },
      observedMeta: {
        observerTaskId: 'obs-prior',
        armingPermissionMode: 'bypassPermissions',
      },
      activeAgents: [
        { agentType: 'worker', observer: 'watcher' },
        { agentType: 'watcher' },
      ],
      env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      generateObserverTaskId: () => 'obs-fresh-zou',
      reattach: {
        priorObserverTaskId: 'obs-prior',
        declaredObserverType: 'watcher',
        loadSidecar: async () => ({ agentType: 'watcher' }),
        isSidecarReattachable: async () => true,
      },
    })
    expect(coldRearmed?.observerTaskId).toBe('obs-fresh-zou')
    expect(coldRearmed?.observerTaskId).not.toBe('obs-prior')
    expect(coldRearmed?.firstRunDone).toBe(false)
    expect(coldRearmed?.armingPermissionMode).toBe('default')

    // Hot reattach when process still running → firstRunDone=true (deliver path)
    clearAllObserverPairings()
    const hotRearmed = await ensureObservedAgentObserver({
      observedTaskId: 'agent-zou-3',
      observedDefinition: { agentType: 'worker', observer: 'watcher' },
      observedMeta: {
        observerTaskId: 'obs-prior-hot',
        armingPermissionMode: 'acceptEdits',
      },
      activeAgents: [
        { agentType: 'worker', observer: 'watcher' },
        { agentType: 'watcher' },
      ],
      env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      isObserverProcessRunning: id => id === 'obs-prior-hot',
      reattach: {
        priorObserverTaskId: 'obs-prior-hot',
        declaredObserverType: 'watcher',
        loadSidecar: async () => ({ agentType: 'watcher' }),
        isSidecarReattachable: async () => true,
      },
    })
    expect(hotRearmed?.observerTaskId).toBe('obs-prior-hot')
    expect(hotRearmed?.firstRunDone).toBe(true)
  })

  test('createObserverDeliveryGateForPairing densifies tools from arming context', async () => {
    const { createObserverDeliveryGateForPairing } = await import(
      '../observerAgents.js'
    )
    // No tools / no arming context → structural allow
    const allowGate = createObserverDeliveryGateForPairing({
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
    })
    expect(await allowGate()).toBe('allow')

    // armingToolUseContext with only Bash → deny (Agent tool missing)
    const denyGate = createObserverDeliveryGateForPairing({
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      armingToolUseContext: {
        options: { tools: [{ name: 'Bash' }] },
      },
    })
    expect(await denyGate()).toBe('deny')

    // Agent present + checkPermissions deny → deny
    const permsDeny = createObserverDeliveryGateForPairing({
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      armingToolUseContext: {
        options: {
          tools: [
            {
              name: 'Agent',
              checkPermissions: async () => ({ behavior: 'deny' }),
            },
          ],
        },
      },
    })
    expect(await permsDeny()).toBe('deny')

    // Agent present + checkPermissions allow → allow
    const permsAllow = createObserverDeliveryGateForPairing({
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      armingToolUseContext: {
        options: {
          tools: [
            {
              name: 'Agent',
              checkPermissions: async () => ({ behavior: 'allow' }),
            },
          ],
        },
      },
    })
    expect(await permsAllow()).toBe('allow')
  })

  test('gateObserverDelivery wZi densable', async () => {
    expect(
      await gateObserverDelivery({
        observerAgentType: 'watcher',
        tools: [{ name: 'Bash' }],
      }),
    ).toBe('deny')
    expect(
      await gateObserverDelivery({
        observerAgentType: 'watcher',
        tools: [{ name: 'Agent' }],
        allowedAgentTypes: ['worker'],
      }),
    ).toBe('deny')
    expect(
      await gateObserverDelivery({
        observerAgentType: 'watcher',
        tools: [{ name: 'Agent' }],
        allowedAgentTypes: ['watcher'],
      }),
    ).toBe('allow')
    expect(
      await gateObserverDelivery({
        observerAgentType: 'watcher',
        tools: [{ name: 'Agent' }],
        canUseTool: async (): Promise<'deny'> => 'deny',
      }),
    ).toBe('deny')
    expect(
      await gateObserverDelivery({
        observerAgentType: 'watcher',
        canUseTool: async (): Promise<'allow'> => {
          throw new Error('boom')
        },
      }),
    ).toBe('error')
  })

  test('writeObserverStoppedTombstone HXt densable', async () => {
    const patches: Array<{ id: string; stopped?: boolean; type?: string }> = []
    await writeObserverStoppedTombstone({
      observerTaskId: 'obs-tomb',
      observerAgentType: 'watcher',
      patch: async (id, meta) => {
        patches.push({
          id,
          stopped: meta.observerStopped,
          type: meta.agentType,
        })
      },
    })
    expect(patches).toEqual([
      { id: 'obs-tomb', stopped: true, type: 'watcher' },
    ])

    // stop path uses host writeTombstone
    const tombs: string[] = []
    setObserverRuntimeHost({
      spawnFirstRun: async () => {},
      deliver: async () => {},
      writeTombstone: async ({ observerTaskId }) => {
        tombs.push(observerTaskId)
      },
    })
    armObserverPairing({
      observerTaskId: 'obs-tomb-stop',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'k-tomb-stop',
    })
    await stopObserverPairing('obs-tomb-stop')
    expect(tombs).toEqual(['obs-tomb-stop'])
  })

  test('planObserverReattach blocked by observerStopped sidecar', async () => {
    expect(
      await planObserverReattach({
        priorObserverTaskId: 'obs-stopped',
        declaredObserverType: 'watcher',
        loadSidecar: async () => ({
          observerStopped: true,
          agentType: 'watcher',
        }),
      }),
    ).toEqual({ mode: 'blocked' })
  })

  test('stop mid first-run discards spawn and bumps generation', async () => {
    let resolveSpawn!: () => void
    const spawnHold = new Promise<void>(r => {
      resolveSpawn = r
    })
    const aborted: string[] = []
    setObserverRuntimeHost({
      spawnFirstRun: async () => {
        await spawnHold
      },
      deliver: async () => {},
      abortObserver: ({ observerTaskId }) => {
        aborted.push(observerTaskId)
      },
    })
    armObserverPairing({
      observerTaskId: 'obs-race',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'k-race',
    })
    enqueueObserverActivity({
      observedKey: 'k-race',
      activity: [{ type: 'assistant_text', text: 'x' }],
    })
    const pairing = getArmedObserverPairing('obs-race')!
    const drainP = drainObserverActivityBufferWithHost({
      pairing,
      gate: () => 'allow',
    })
    await Promise.resolve()
    // observed ends while first-run in flight
    await stopObserverPairing('obs-race')
    resolveSpawn()
    await drainP
    // firstRunDone must not stick after stop mid-spawn; map cleared
    expect(getArmedObserverPairing('obs-race')).toBeUndefined()
    expect(aborted).toContain('obs-race')
  })
})
