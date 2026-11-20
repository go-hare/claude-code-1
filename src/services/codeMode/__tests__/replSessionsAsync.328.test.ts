import { afterEach, describe, expect, test } from 'bun:test'
import { REPL_MAIN_THREAD_KEY } from '../constants.js'
import { clearCodeModeVmSession, executeCodeModeScript } from '../executor.js'
import {
  ASYNC_LANE_DEBOUNCE_MS,
  ASYNC_LANE_MAX_WAIT_MS,
  ASYNC_REPL_MAX_EVALS,
  formatReplOutputEnvelope,
  getAsyncLaneDebounceConfig,
  getReplSessions,
  mainThreadStoppableWork,
  NO_EVALS,
  ReplSessions,
  resetReplSessionsForTests,
  waitAsyncLaneLinger,
} from '../replSessions.js'

afterEach(() => {
  resetReplSessionsForTests()
  clearCodeModeVmSession()
})

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ReplSessions (2.1.328)', () => {
  test('serializes evals per key and delivers sequentially', async () => {
    const sessions = new ReplSessions()
    const order: string[] = []
    const gate1 = deferred<string>()
    const delivered: Array<{ evalId: number; output: string }> = []
    const ac = new AbortController()

    const h1 = sessions.dispatch(
      'main',
      async () => {
        order.push('start-1')
        const v = await gate1.promise
        order.push('end-1')
        return v
      },
      {
        signal: ac.signal,
        detachAfterMs: 5_000,
        deliver: (evalId, output) => {
          delivered.push({ evalId, output })
        },
      },
      'first()',
    )

    const h2 = sessions.dispatch(
      'main',
      async () => {
        order.push('start-2')
        return 'second'
      },
      {
        signal: ac.signal,
        detachAfterMs: 5_000,
        deliver: (evalId, output) => {
          delivered.push({ evalId, output })
        },
      },
      'second()',
    )

    // Let microtasks settle so h1 starts while h2 waits
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['start-1'])
    expect(sessions.depth('main')).toBe(2)
    expect(sessions.ledger('main').map(e => e.state)).toEqual([
      'running',
      'waiting',
    ])

    gate1.resolve('first')
    await Promise.all([h1.ended, h2.ended])

    expect(order).toEqual(['start-1', 'end-1', 'start-2'])
    expect(delivered).toEqual([
      { evalId: h1.evalId, output: 'first' },
      { evalId: h2.evalId, output: 'second' },
    ])
    expect(sessions.depth('main')).toBe(0)
    expect(sessions.outstanding()).toBe(0)
  })

  test('enforces ASYNC_REPL_MAX_EVALS (8) cap with official rejection message', async () => {
    const sessions = new ReplSessions()
    const gate = deferred<string>()
    const ac = new AbortController()
    const handles = []

    for (let i = 0; i < ASYNC_REPL_MAX_EVALS; i++) {
      handles.push(
        sessions.dispatch(
          'main',
          () => gate.promise,
          { signal: ac.signal, detachAfterMs: 5_000, deliver: () => {} },
          `eval-${i}`,
        ),
      )
    }

    expect(() =>
      sessions.dispatch(
        'main',
        () => 'overflow',
        { signal: ac.signal, detachAfterMs: 5_000, deliver: () => {} },
        'eval-9',
      ),
    ).toThrow(
      'async REPL dispatch rejected: 8 evals already waiting or running on this context — wait for their settles (Poll) before dispatching more',
    )

    gate.resolve('ok')
    await Promise.all(handles.map(h => h.ended))
  })

  test('detaches after detachAfterMs so next queued eval runs concurrently', async () => {
    const sessions = new ReplSessions()
    const gate1 = deferred<string>()
    const started2 = deferred<void>()
    const ac = new AbortController()

    const h1 = sessions.dispatch(
      'main',
      () => gate1.promise,
      { signal: ac.signal, detachAfterMs: 15, deliver: () => {} },
      'slow()',
    )
    const h2 = sessions.dispatch(
      'main',
      async () => {
        started2.resolve()
        return 'fast'
      },
      { signal: ac.signal, detachAfterMs: 5_000, deliver: () => {} },
      'fast()',
    )

    await started2.promise
    await h2.ended
    const ledger = sessions.ledger('main')
    expect(ledger).toHaveLength(1)
    expect(ledger[0]?.id).toBe(h1.evalId)
    expect(ledger[0]?.state).toBe('detached')

    gate1.resolve('done-slow')
    await h1.ended
  })

  test('abort produces exact official cancelled-before-start messages by requester', async () => {
    const cases: Array<{
      requester: 'person' | 'declined' | 'taskStop' | 'session' | 'script'
      expected: string
    }> = [
      {
        requester: 'person',
        expected:
          'cancelled before start — the user stopped this eval while it waited for its turn; the script never ran',
      },
      {
        requester: 'declined',
        expected:
          "cancelled before start — the user declined the permission dialog for an earlier script's call (a No or an Esc), which also cancels the scripts behind that one; the script never ran",
      },
      {
        requester: 'taskStop',
        expected:
          'cancelled before start — a TaskStop call stopped this eval while it waited for its turn; the script never ran',
      },
      {
        requester: 'session',
        expected:
          'cancelled before start — Claude Code stopped this eval while it waited for its turn; the script never ran',
      },
      {
        requester: 'script',
        expected:
          'cancelled before start — a script aborted this eval (self.running().abort()) while it waited for its turn; it never ran',
      },
    ]

    for (const { requester, expected } of cases) {
      const sessions = new ReplSessions()
      const gate = deferred<string>()
      const ac = new AbortController()
      let deliveredMsg = ''
      let deliveredErr = false

      const h1 = sessions.dispatch('main', () => gate.promise, {
        signal: ac.signal,
        detachAfterMs: 5_000,
        deliver: () => {},
      })
      const h2 = sessions.dispatch('main', () => 'should-not-run', {
        signal: ac.signal,
        detachAfterMs: 5_000,
        deliver: (_id, output, isError) => {
          deliveredMsg = output
          deliveredErr = isError
        },
      })

      await Promise.resolve()
      expect(sessions.abort('main', h2.evalId, requester)).toBe('')
      expect(sessions.abort('main', 99999)).toBe(
        'no such eval (it may have settled already)',
      )

      gate.resolve('done')
      await Promise.all([h1.ended, h2.ended])
      expect(deliveredErr).toBe(true)
      expect(deliveredMsg).toBe(expected)
    }
  })

  test('cancelWaiting cancels waiting evals and subsequent same-replyId evals', async () => {
    const sessions = new ReplSessions()
    const gate = deferred<string>()
    const ac = new AbortController()
    const outputs: string[] = []

    const h1 = sessions.dispatch('main', () => gate.promise, {
      signal: ac.signal,
      replyId: 'reply-1',
      detachAfterMs: 5_000,
      deliver: () => {},
    })
    const h2 = sessions.dispatch('main', () => 'never', {
      signal: ac.signal,
      replyId: 'reply-1',
      detachAfterMs: 5_000,
      deliver: (_id, out) => {
        outputs.push(out)
      },
    })

    await Promise.resolve()
    sessions.cancelWaiting('main', new Error('declined'), 'reply-1')

    const h3 = sessions.dispatch('main', () => 'never-either', {
      signal: ac.signal,
      replyId: 'reply-1',
      detachAfterMs: 5_000,
      deliver: (_id, out) => {
        outputs.push(out)
      },
    })

    gate.resolve('ok')
    await Promise.all([h1.ended, h2.ended, h3.ended])
    expect(outputs).toHaveLength(2)
    expect(outputs[0]).toContain('declined the permission dialog')
    expect(outputs[1]).toContain('declined the permission dialog')
  })

  test('holdLate tracks late state and releases on idle', async () => {
    const sessions = new ReplSessions()
    const gate = deferred<string>()
    const idleGate = deferred<void>()
    const ac = new AbortController()
    let aborted = false
    let discarded = false

    const h = sessions.dispatch('main', () => gate.promise, {
      signal: ac.signal,
      detachAfterMs: 5_000,
      deliver: () => {},
    })
    await Promise.resolve()

    sessions.holdLate('main', h.evalId, {
      abort: () => {
        aborted = true
      },
      discard: () => {
        discarded = true
      },
      idle: idleGate.promise,
    })

    expect(sessions.ledger('main')[0]?.state).toBe('late')
    expect(sessions.pending('main')).toHaveLength(0)

    idleGate.resolve()
    gate.resolve('done')
    await h.ended
    expect(aborted).toBe(false)
    expect(discarded).toBe(false)
    expect(sessions.outstanding()).toBe(0)
  })

  test('dropRewound / bringBackRewound / clear / interrupt / mainThreadStoppableWork', async () => {
    const sessions = new ReplSessions()
    const gate = deferred<string>()
    const ac = new AbortController()
    let changes = 0
    const work = mainThreadStoppableWork(sessions)
    const unsub = work.onOutstandingChange(() => {
      changes++
    })

    const h = sessions.dispatch(
      REPL_MAIN_THREAD_KEY,
      controller =>
        new Promise<string>(resolve => {
          controller.signal.addEventListener('abort', () => resolve('aborted'))
          void gate.promise.then(resolve)
        }),
      {
        signal: ac.signal,
        toolUseId: 'tu-1',
        detachAfterMs: 5_000,
        deliver: () => {},
      },
    )

    await Promise.resolve()
    expect(work.outstanding()).toBe(1)
    expect(work.stoppable()).toBe(1)
    expect(sessions.tracks(REPL_MAIN_THREAD_KEY, h.evalId)).toBe(true)
    expect(sessions.evalIdsOf(REPL_MAIN_THREAD_KEY, ['tu-1'])).toEqual(
      new Set([h.evalId]),
    )

    sessions.dropRewound(REPL_MAIN_THREAD_KEY, ['tu-1'])
    expect(h.retired()).toBe(true)
    sessions.bringBackRewound(REPL_MAIN_THREAD_KEY, ['tu-1'])
    expect(h.retired()).toBe(false)

    work.interrupt()
    await h.ended
    expect(work.outstanding()).toBe(0)
    expect(changes).toBeGreaterThan(0)
    unsub()
  })

  test('NO_EVALS returns empty list and no such eval on abort', () => {
    expect(NO_EVALS.list()).toEqual([])
    expect(NO_EVALS.abort(1)).toBe('no such eval')
  })
})

describe('waitAsyncLaneLinger (2.1.328)', () => {
  test('exposes official 750ms debounce and 3000ms maxWait defaults', () => {
    expect(ASYNC_LANE_DEBOUNCE_MS).toBe(750)
    expect(ASYNC_LANE_MAX_WAIT_MS).toBe(3_000)
    expect(getAsyncLaneDebounceConfig()).toEqual({
      debounceMs: 750,
      maxWaitMs: 3_000,
    })
  })

  test('debounces news and caps wait at maxWaitMs', async () => {
    const listeners = new Set<() => void>()
    let news = false
    const ac = new AbortController()
    const start = Date.now()

    const p = waitAsyncLaneLinger({
      hasNews: () => news,
      subscribe: fn => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      signal: ac.signal,
      debounceMs: 40,
      maxWaitMs: 100,
    })

    // Repeatedly trigger news every 20ms so debounce keeps resetting until maxWaitMs
    const interval = setInterval(() => {
      news = true
      for (const fn of listeners) fn()
    }, 20)

    await p
    clearInterval(interval)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(80)
    expect(elapsed).toBeLessThan(300)
  })

  test('resolves immediately when signal aborts or settled + nothingToLingerFor', async () => {
    const ac = new AbortController()
    ac.abort()
    await waitAsyncLaneLinger({
      hasNews: () => false,
      subscribe: () => () => {},
      signal: ac.signal,
      debounceMs: 5_000,
      maxWaitMs: 10_000,
    })

    const ac2 = new AbortController()
    const settled = new AbortController()
    settled.abort()
    await waitAsyncLaneLinger({
      hasNews: () => false,
      subscribe: () => () => {},
      signal: ac2.signal,
      settled: settled.signal,
      nothingToLingerFor: () => true,
      debounceMs: 5_000,
      maxWaitMs: 10_000,
    })
  })
})

describe('self.running() VM sandbox isolation & ReplSessions wiring (2.1.328)', () => {
  test('exposes self.running().list() and abort() inside VM without host escape', async () => {
    const sessions = getReplSessions()
    const gate = deferred<string>()
    const ac = new AbortController()

    const bg = sessions.dispatch(
      'vm-test-key',
      () => gate.promise,
      { signal: ac.signal, detachAfterMs: 5_000, deliver: () => {} },
      'backgroundWork()',
    )
    await Promise.resolve()

    const res = await executeCodeModeScript({
      sessionKey: 'vm-test-key',
      evalId: bg.evalId,
      code: `
        const running = self.running();
        const list = running.list();
        let escaped = false;
        try {
          const fnCtor = list.constructor.constructor;
          fnCtor('return process')();
          escaped = true;
        } catch {
          escaped = false;
        }
        const abortResult = running.abort(99999);
        return {
          count: list.length,
          firstId: list[0]?.id,
          firstSelf: list[0]?.self,
          escaped,
          abortResult,
        };
      `,
      invokeTool: async () => ({}),
    })

    expect(res.result).toContain(`"count": 1`)
    expect(res.result).toContain(`"firstId": ${bg.evalId}`)
    expect(res.result).toContain(`"firstSelf": true`)
    expect(res.result).toContain(`"escaped": false`)
    expect(res.result).toContain('no such eval')

    gate.resolve('done')
    await bg.ended
  })

  test('clearCodeModeVmSession clears ReplSessions for that key', async () => {
    const sessions = getReplSessions()
    const gate = deferred<string>()
    const ac = new AbortController()
    const h = sessions.dispatch(
      'clear-key',
      controller =>
        new Promise<string>(resolve => {
          controller.signal.addEventListener('abort', () => resolve('aborted'))
          void gate.promise.then(resolve)
        }),
      { signal: ac.signal, detachAfterMs: 5_000, deliver: () => {} },
    )
    await Promise.resolve()
    expect(sessions.outstanding('clear-key')).toBe(1)

    clearCodeModeVmSession('clear-key')
    await h.ended
    expect(sessions.outstanding('clear-key')).toBe(0)
  })

  test('formatReplOutputEnvelope formats result and error envelopes', () => {
    expect(
      formatReplOutputEnvelope({ evalId: 3, ms: 123.6, result: 'hello' }),
    ).toBe(
      '<repl-output eval="3" ms="124">\n<result>hello</result>\n</repl-output>',
    )
    expect(
      formatReplOutputEnvelope({
        evalId: 4,
        ms: 5,
        result: 'boom',
        isError: true,
      }),
    ).toBe('<repl-output eval="4" ms="5">\n<error>boom</error>\n</repl-output>')
  })
})
