/**
 * densable 2.1.218 #11 — S8o host engine closed-gate (Ye / Ke / Ne / Y6o).
 */
import { describe, expect, test } from 'bun:test'
import {
  createHostEngine,
  HOST_ENGINE_DROPPED_TURN_LOG,
  isCancelledTerminalReason,
  isErrorClassTerminalReason,
  isUserAbortTerminalReason,
  resolveTurnLifecycleState,
  type HostTurnIntent,
} from '../hostEngine.js'

async function collect(
  engine: AsyncGenerator<unknown>,
  opts?: { max?: number },
): Promise<unknown[]> {
  const out: unknown[] = []
  const max = opts?.max ?? 100
  for await (const v of engine) {
    out.push(v)
    if (out.length >= max) break
  }
  return out
}

function lifecycleStates(frames: unknown[]): string[] {
  return frames
    .filter(
      (f): f is { type: string; state: string; command_uuid: string } =>
        !!f &&
        typeof f === 'object' &&
        (f as { type?: string }).type === 'command_lifecycle',
    )
    .map(f => `${f.command_uuid}:${f.state}`)
}

async function* emptyTurn(
  _p: HostTurnIntent,
  _ac: AbortController,
  _intent: HostTurnIntent,
): AsyncGenerator<unknown> {
  // no-op turn body
}

async function* yieldOnce(
  _p: HostTurnIntent,
  _ac: AbortController,
  intent: HostTurnIntent,
): AsyncGenerator<unknown> {
  yield { type: 'assistant', uuid: intent.uuid, text: 'ok' }
}

describe('densable 2.1.218 #11 Y6o / WEo taxonomy', () => {
  test('Y6o: aborted → cancelled regardless of reason', () => {
    expect(resolveTurnLifecycleState(undefined, true)).toBe('cancelled')
    expect(resolveTurnLifecycleState('completed', true)).toBe('cancelled')
  })

  test('Y6o: user-abort reasons → cancelled', () => {
    expect(isUserAbortTerminalReason('aborted_streaming')).toBe(true)
    expect(isUserAbortTerminalReason('aborted_tools')).toBe(true)
    expect(resolveTurnLifecycleState('aborted_streaming', false)).toBe(
      'cancelled',
    )
  })

  test('Y6o: error-class reasons → cancelled', () => {
    expect(isErrorClassTerminalReason('api_error')).toBe(true)
    expect(isErrorClassTerminalReason('turn_setup_failed')).toBe(true)
    expect(isCancelledTerminalReason('prompt_too_long')).toBe(true)
    expect(resolveTurnLifecycleState('api_error', false)).toBe('cancelled')
  })

  test('Y6o: non-error terminals → completed when not aborted', () => {
    expect(isErrorClassTerminalReason('max_turns')).toBe(false)
    expect(isErrorClassTerminalReason('completed')).toBe(false)
    expect(isErrorClassTerminalReason('stop_hook_prevented')).toBe(false)
    expect(resolveTurnLifecycleState('max_turns', false)).toBe('completed')
    expect(resolveTurnLifecycleState('completed', false)).toBe('completed')
    expect(resolveTurnLifecycleState(undefined, false)).toBe('completed')
  })
})

describe('densable 2.1.218 #11 S8o closed-gate', () => {
  test('close then turn intent is dropped (no start)', async () => {
    const logs: string[] = []
    const engine = createHostEngine({
      runTurn: emptyTurn,
      log: msg => logs.push(msg),
    })
    engine.close()
    engine.dispatch({ type: 'turn', uuid: 'u-late', message: 'x' })
    expect(engine.isClosed()).toBe(true)
    expect(engine.pendingTurnCount()).toBe(0)
    expect(logs.some(l => l.includes(HOST_ENGINE_DROPPED_TURN_LOG))).toBe(true)

    // Generator should end immediately (queue done, empty)
    const frames = await collect(engine)
    expect(lifecycleStates(frames).some(s => s.includes('started'))).toBe(false)
    expect(engine.turnCount()).toBe(0)
  })

  test('streamInput finally closes; late turn after stream ends is dropped', async () => {
    const logs: string[] = []
    const engine = createHostEngine({
      runTurn: yieldOnce,
      log: msg => logs.push(msg),
    })

    async function* source() {
      yield { uuid: 'u1', message: 'one' }
      yield { uuid: 'u2', message: 'two' }
    }

    // Drive streamInput concurrently with consume
    const inputP = engine.streamInput(source())
    const frames = await collect(engine)
    await inputP

    const states = lifecycleStates(frames)
    expect(states).toContain('u1:queued')
    expect(states).toContain('u1:started')
    expect(states).toContain('u1:completed')
    expect(states).toContain('u2:queued')
    expect(states).toContain('u2:started')
    expect(states).toContain('u2:completed')
    expect(engine.isClosed()).toBe(true)
    expect(engine.turnCount()).toBe(2)

    // After streamInput finally Ye — further turns drop
    engine.dispatch({ type: 'turn', uuid: 'u3', message: 'late' })
    expect(logs.some(l => l.includes(HOST_ENGINE_DROPPED_TURN_LOG))).toBe(true)
  })

  test('generator.return closes gate before teardown', async () => {
    const logs: string[] = []
    let runCount = 0
    const engine = createHostEngine({
      runTurn: async function* (_p, _ac, intent) {
        runCount++
        yield { type: 'assistant', uuid: intent.uuid }
      },
      log: msg => logs.push(msg),
    })

    engine.dispatch({ type: 'turn', uuid: 'a', message: 1 })
    engine.dispatch({ type: 'turn', uuid: 'b', message: 2 })
    engine.dispatch({ type: 'turn', uuid: 'c', message: 3 })

    // Consume first turn only, then return (densable pt.return → Ye first)
    const first = await engine.next()
    expect(first.done).toBe(false)
    await engine.return()
    expect(engine.isClosed()).toBe(true)

    // Remaining queued should be discarded (not started after close)
    // Depending on when return hits, at least one discard or no further starts
    // of turns still only in L. Collect remaining (should be empty/done).
    const rest = await collect(engine)
    void rest
    // No new dispatch accepted
    engine.dispatch({ type: 'turn', uuid: 'd' })
    expect(logs.some(l => l.includes(HOST_ENGINE_DROPPED_TURN_LOG))).toBe(true)
    expect(runCount).toBeLessThanOrEqual(3)
  })

  test('generator.return after start discards remaining L (Ne finally)', async () => {
    // densable Ne finally: for (Ve of L) discarded.
    // JS: async-generator finally runs only after the generator has started
    // (at least one next). densable unmount uses close(); Host consumer
    // drop/return after start is what runs Ne finally discard.
    const lifecycle: string[] = []
    let runs = 0
    const engine = createHostEngine({
      onCommandLifecycle: (uuid, state) => lifecycle.push(`${uuid}:${state}`),
      runTurn: async function* (_p, _ac, intent) {
        runs++
        yield { type: 'assistant', uuid: intent.uuid }
      },
      log: () => {},
    })

    engine.dispatch({ type: 'turn', uuid: 'first' })
    engine.dispatch({ type: 'turn', uuid: 'queued-2' })
    engine.dispatch({ type: 'turn', uuid: 'queued-3' })

    // Start Me and drain until first turn fully completes (N cleared).
    // Stop before the next next() would start queued-2 — L still mirrors it.
    for (let i = 0; i < 30; i++) {
      if (lifecycle.includes('first:completed')) break
      const step = await engine.next()
      if (step.done) break
    }
    expect(runs).toBe(1)
    expect(lifecycle).toContain('first:completed')
    expect(lifecycle).toContain('queued-2:queued')
    expect(lifecycle).toContain('queued-3:queued')
    // Must not have started subsequent turns yet
    expect(lifecycle.includes('queued-2:started')).toBe(false)

    // densable pt.return → Ye first, then Ne finally discards remaining L
    await engine.return()
    expect(engine.isClosed()).toBe(true)
    expect(lifecycle).toContain('queued-2:discarded')
    expect(lifecycle).toContain('queued-3:discarded')
    // first already completed — N was null so not cancelled by Ne
    expect(lifecycle).toContain('first:completed')
    expect(lifecycle.includes('first:cancelled')).toBe(false)
    expect(runs).toBe(1)
  })

  test('turn throw → cancelled; subsequent turn still drains after close', async () => {
    const lifecycle: string[] = []
    let inflightEntered = false
    const engine = createHostEngine({
      onCommandLifecycle: (uuid, state) => lifecycle.push(`${uuid}:${state}`),
      runTurn: async function* (_p, ac, intent) {
        if (intent.uuid === 'inflight') {
          inflightEntered = true
          await new Promise<void>((_resolve, reject) => {
            const onAbort = () => reject(new Error('aborted'))
            if (ac.signal.aborted) {
              onAbort()
              return
            }
            ac.signal.addEventListener('abort', onAbort, { once: true })
          })
        }
        yield { type: 'assistant', uuid: intent.uuid }
      },
      log: () => {},
    })

    engine.dispatch({ type: 'turn', uuid: 'inflight' })
    engine.dispatch({ type: 'turn', uuid: 'next' })
    const pump = collect(engine)
    for (let i = 0; i < 40 && !inflightEntered; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    expect(inflightEntered).toBe(true)
    // Abort in-flight → Er set → cancelled; Me continues; close drains rest
    await engine.interrupt('user')
    engine.close()
    await pump
    expect(lifecycle).toContain('inflight:cancelled')
    expect(lifecycle).toContain('next:completed')
  })

  test('close alone drains already-queued turns (no discard of H backlog)', async () => {
    // densable Ye: ae=true; H.done() — items already enqueued still process.
    const lifecycle: string[] = []
    const engine = createHostEngine({
      onCommandLifecycle: (u, s) => lifecycle.push(`${u}:${s}`),
      runTurn: yieldOnce,
      log: () => {},
    })
    engine.dispatch({ type: 'turn', uuid: 'a' })
    engine.dispatch({ type: 'turn', uuid: 'b' })
    engine.close()
    // late turn rejected
    engine.dispatch({ type: 'turn', uuid: 'late' })
    await collect(engine)
    expect(lifecycle).toContain('a:completed')
    expect(lifecycle).toContain('b:completed')
    expect(lifecycle.some(s => s.includes('late:'))).toBe(false)
    expect(lifecycle.some(s => s.endsWith(':discarded'))).toBe(false)
  })

  test('interrupt returns still_queued uuids', async () => {
    let runEntered = false
    const engine = createHostEngine({
      runTurn: async function* (_p, ac) {
        runEntered = true
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => reject(new Error('aborted'))
          if (ac.signal.aborted) {
            onAbort()
            return
          }
          ac.signal.addEventListener('abort', onAbort, { once: true })
        })
      },
      log: () => {},
    })
    engine.dispatch({ type: 'turn', uuid: 'run' })
    engine.dispatch({ type: 'turn', uuid: 'q1' })
    engine.dispatch({ type: 'turn', uuid: 'q2' })
    // Pump until first turn is in-flight (q set) so L still holds q1/q2
    const pumps: Promise<IteratorResult<unknown>>[] = []
    for (let i = 0; i < 20 && !runEntered; i++) {
      pumps.push(engine.next())
      await new Promise(r => setTimeout(r, 5))
    }
    expect(runEntered).toBe(true)
    const { still_queued } = await engine.interrupt('user')
    expect(still_queued).toContain('q1')
    expect(still_queued).toContain('q2')
    // Tear down fully (return aborts Me; interrupt alone leaves H backlog)
    await engine.return()
    await Promise.all(pumps.map(p => p.catch(() => {})))
    await collect(engine)
  })

  test('prepareTurn failure → cancelled, does not start runTurn', async () => {
    let runs = 0
    const lifecycle: string[] = []
    const engine = createHostEngine({
      onCommandLifecycle: (u, s) => lifecycle.push(`${u}:${s}`),
      prepareTurn: async intent => {
        if (intent.uuid === 'bad') throw new Error('setup fail')
        return intent
      },
      runTurn: async function* () {
        runs++
        yield 1
      },
      log: () => {},
    })
    engine.dispatch({ type: 'turn', uuid: 'bad' })
    engine.dispatch({ type: 'turn', uuid: 'good' })
    await engine.streamInput(
      (async function* () {
        /* empty — just close after pre-dispatched */
      })(),
    )
    const frames = await collect(engine)
    void frames
    expect(lifecycle).toContain('bad:queued')
    expect(lifecycle).toContain('bad:cancelled')
    expect(lifecycle).toContain('good:completed')
    expect(runs).toBe(1)
  })

  test('runTurn return reason api_error → cancelled (Y6o/WEo)', async () => {
    const lifecycle: string[] = []
    const engine = createHostEngine({
      onCommandLifecycle: (u, s) => lifecycle.push(`${u}:${s}`),
      runTurn: async function* () {
        yield { type: 'assistant' }
        return { reason: 'api_error' }
      },
      log: () => {},
    })
    engine.dispatch({ type: 'turn', uuid: 'err' })
    engine.close()
    await collect(engine)
    expect(lifecycle).toContain('err:started')
    expect(lifecycle).toContain('err:cancelled')
    expect(lifecycle).not.toContain('err:completed')
  })

  test('runTurn return reason max_turns → completed (Y6o non-error)', async () => {
    const lifecycle: string[] = []
    const engine = createHostEngine({
      onCommandLifecycle: (u, s) => lifecycle.push(`${u}:${s}`),
      runTurn: async function* () {
        yield { type: 'assistant' }
        return { reason: 'max_turns' }
      },
      log: () => {},
    })
    engine.dispatch({ type: 'turn', uuid: 'mt' })
    engine.close()
    await collect(engine)
    expect(lifecycle).toContain('mt:completed')
    expect(lifecycle).not.toContain('mt:cancelled')
  })

  test('abort mid-turn without throw still cancelled via Ur (Y6o t flag)', async () => {
    const lifecycle: string[] = []
    let entered = false
    const engine = createHostEngine({
      onCommandLifecycle: (u, s) => lifecycle.push(`${u}:${s}`),
      runTurn: async function* (_p, ac) {
        entered = true
        // Observe abort then finish without throwing (densable still sets Ur)
        await new Promise<void>(resolve => {
          if (ac.signal.aborted) {
            resolve()
            return
          }
          ac.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        yield { type: 'assistant' }
      },
      log: () => {},
    })
    engine.dispatch({ type: 'turn', uuid: 'soft' })
    const pump = collect(engine)
    for (let i = 0; i < 40 && !entered; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    expect(entered).toBe(true)
    await engine.interrupt('user')
    engine.close()
    await pump
    expect(lifecycle).toContain('soft:cancelled')
  })
})
