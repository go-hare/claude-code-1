import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import type { QueryParams } from '../../../query.js'
import type { AppState } from '../../../state/AppStateStore.js'
import { Stream } from '../../../utils/stream.js'
import { createStore } from '../../../state/store.js'
import { TurnController } from '../TurnController.js'
import { createHostEngine } from '../../../engine/hostEngine.js'
import { runHostEngineTurn } from '../../../engine/hostEngineTurn.js'
import type {
  DispatchReplStreamEventDeps,
  RunReplTurnDeps,
} from '../runReplTurn.js'
import {
  SubmitController,
  type ExecuteQueuedInputDeps,
} from '../SubmitController.js'
import { createMessageQueue } from '../../../utils/messageQueueManager.js'
import { getMainThreadAgentId } from '../../../bootstrap/state.js'

function createTurn(initialLoading = false): TurnController {
  const store = createStore({ tasks: {} } as AppState)
  return new TurnController({ store, initialLoading })
}

describe('2.1.328 iie loading publication (#185 queued Escape)', () => {
  test('queue reservation and cancellation publish before guard observers run', () => {
    const turn = createTurn()
    const observations: boolean[] = []
    const unsubscribe = turn.guard.subscribe(() => {
      const snapshot = turn.getSnapshot()
      expect(snapshot.isQueryActive).toBe(turn.guard.isActive)
      expect(snapshot.isLoading).toBe(turn.guard.isActive)
      observations.push(turn.isLoading)
    })
    try {
      expect(turn.guard.reserve()).toBe(true)
      turn.guard.cancelReservation()
      expect(observations).toEqual([true, false])
    } finally {
      unsubscribe()
      turn.dispose()
    }
  })

  test('Escape followed by another queued turn cannot be cleared by the old turn', () => {
    const turn = createTurn()
    const observations: boolean[] = []
    const unsubscribe = turn.loading.subscribe(() => {
      observations.push(turn.loading.getSnapshot())
    })
    try {
      turn.guard.reserve()
      const stoppedGeneration = turn.guard.tryStart()!
      turn.guard.forceEnd()
      expect(turn.getSnapshot().isLoading).toBe(false)
      turn.guard.reserve()
      const nextGeneration = turn.guard.tryStart()!
      const running = turn.getSnapshot()
      expect(turn.guard.end(stoppedGeneration)).toBe(false)
      expect(turn.getSnapshot()).toBe(running)
      expect(turn.isLoading).toBe(true)
      expect(turn.guard.end(nextGeneration)).toBe(true)
      expect(observations).toEqual([true, false, true, false])
    } finally {
      unsubscribe()
      turn.dispose()
    }
  })

  test('external loading and local query loading share one coherent snapshot', () => {
    const turn = createTurn(true)
    try {
      expect(turn.getSnapshot()).toMatchObject({
        isQueryActive: false,
        isExternalLoading: true,
        isLoading: true,
      })
      const generation = turn.guard.tryStart()!
      turn.setExternalLoading(false)
      expect(turn.getSnapshot()).toMatchObject({
        isQueryActive: true,
        isExternalLoading: false,
        isLoading: true,
      })
      turn.setExternalLoading(true)
      turn.guard.end(generation)
      expect(turn.getSnapshot().isLoading).toBe(true)
      turn.setExternalLoading(false)
      expect(turn.getSnapshot().isLoading).toBe(false)
    } finally {
      turn.dispose()
    }
  })

  test('unchanged sources do not publish or invalidate the snapshot', () => {
    const turn = createTurn()
    let notifications = 0
    const unsubscribe = turn.subscribe(() => notifications++)
    try {
      const idle = turn.getSnapshot()
      turn.setExternalLoading(false)
      turn.guard.forceEnd()
      turn.guard.cancelReservation()
      expect(turn.getSnapshot()).toBe(idle)
      expect(notifications).toBe(0)
      turn.guard.reserve()
      const dispatching = turn.getSnapshot()
      turn.guard.tryStart()
      expect(turn.getSnapshot()).toBe(dispatching)
      turn.setExternalLoading(false)
      expect(notifications).toBe(1)
    } finally {
      unsubscribe()
      turn.dispose()
    }
  })

  test('reentrant queue reservation observes each loading state synchronously', () => {
    const turn = createTurn()
    const observations: boolean[] = []
    let queued = true
    const unsubscribe = turn.subscribe(() => {
      observations.push(turn.isLoading)
      if (queued && !turn.isLoading) {
        queued = false
        turn.guard.reserve()
      }
    })
    try {
      turn.guard.tryStart()
      turn.guard.forceEnd()
      expect(observations).toEqual([true, false, true])
      expect(turn.getSnapshot()).toMatchObject({
        isQueryActive: true,
        isLoading: true,
      })
    } finally {
      unsubscribe()
      turn.dispose()
    }
  })

  test('live cancellation reads the newly armed controller before a render commits', () => {
    const turn = createTurn()
    const oldController = new AbortController()
    const nextController = new AbortController()
    try {
      turn.setAbortController(oldController)
      const oldRender = turn.getSnapshot()
      turn.guard.tryStart()
      oldController.abort('user-cancel')
      turn.guard.forceEnd()
      turn.setAbortController(nextController)
      turn.guard.reserve()
      expect(oldRender.abortController).toBe(oldController)
      expect(turn.abortController).toBe(nextController)
      expect(turn.getSnapshot()).toMatchObject({
        abortController: nextController,
        isLoading: true,
      })
      turn.abortController?.abort('interrupt')
      expect(nextController.signal.reason).toBe('interrupt')
      expect(oldController.signal.reason).toBe('user-cancel')
    } finally {
      turn.dispose()
    }
  })

  test('the actual background callback aborts a controller armed after its render', () => {
    const path = join(import.meta.dir, '../useReplTurnOrchestration.tsx')
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    let callback: ts.ArrowFunction | undefined
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(source) === 'handleBackgroundQuery' &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      ) {
        const first = node.initializer.arguments[0]
        if (first && ts.isArrowFunction(first)) callback = first
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(callback).toBeDefined()
    const js = ts.transpileModule(
      `const callback = ${callback!.getText(source)};`,
      {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      },
    ).outputText
    const turn = createTurn()
    const controller = new AbortController()
    const stop = new Error('stop after the actual abort statement')
    const createCallback = new Function(
      'turnController',
      'abortController',
      'isCodeModeEnabled',
      'collapseBacklogTaskNotifications',
      'messageQueue',
      `${js}\nreturn callback;`,
    ) as (...args: unknown[]) => () => void
    const background = createCallback(
      turn,
      null,
      () => false,
      (x: unknown) => x,
      {
        removeByFilter() {
          throw stop
        },
      },
    )
    try {
      turn.setAbortController(controller)
      expect(background).toThrow(stop)
      expect(controller.signal.reason).toBe('background')
    } finally {
      turn.dispose()
    }
  })

  test('the next queued submission is not dropped while the cancelled submission unwinds', async () => {
    const store = createStore({ tasks: {} } as AppState)
    const turn = new TurnController({ store })
    const submit = new SubmitController({
      store,
      turnController: turn,
      queryGuard: turn.guard,
      messageQueue: createMessageQueue(),
    })
    const entered = Promise.withResolvers<void>()
    const hooks = Promise.withResolvers<void>()
    let waits = 0
    turn.bindSessionStartHooks(() => {
      waits++
      entered.resolve()
      return hooks.promise
    })
    const deps: ExecuteQueuedInputDeps = {
      commands: [],
      mainLoopModel: 'claude-opus-5',
      ideSelection: undefined,
      querySource: 'repl_main_thread',
      getCurrentInput: () => '',
      getMessages: () => [],
      setAppState: () => {},
      setMessages: () => {},
      setInputValue: () => {},
      setPastedContents: () => {},
      setUserInputOnProcessing: () => {},
      setToolJSX: () => {},
      setAbortControllerForQuery: turn.setAbortController,
      addNotification: () => {},
      getToolUseContext: () => {
        throw new Error('cancelled before processing')
      },
      onQuery: async () => {
        throw new Error('cancelled before querying')
      },
      onBeforeQuery: undefined,
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      consumeIdeSelection: () => {},
      recordIdeSelectionConsumedBy: () => {},
      restoreIdeSelectionConsumedBy: () => {},
      restoreHandedBackPrompt: () => {},
    }
    const command = {
      mode: 'prompt' as const,
      value: 'prompt',
      origin: { kind: 'human' as const },
      agentId: getMainThreadAgentId(),
    }
    const first = submit.executeQueuedInput([command], deps)
    await entered.promise
    const previous = turn.abortController!
    turn.guard.forceEnd()
    previous.abort('user-cancel')
    const next = submit.executeQueuedInput([command], deps)
    await Promise.resolve()
    await Promise.resolve()
    try {
      expect(waits).toBe(2)
      expect(turn.abortController).not.toBe(previous)
      expect(turn.guard.isActive).toBe(true)
    } finally {
      turn.guard.forceEnd()
      turn.abortController?.abort('user-cancel')
      hooks.resolve()
      await Promise.all([first, next])
      submit.dispose()
      turn.dispose()
    }
  })

  test('Esc releases only the current SessionStart wait before shared hooks finish', async () => {
    const turn = createTurn()
    const hooks = Promise.withResolvers<void>()
    let ready = false
    void hooks.promise.then(
      () => {
        ready = true
      },
      () => {
        ready = true
      },
    )
    turn.bindSessionStartHooks(() => (ready ? undefined : hooks.promise))
    const first = new AbortController()
    const second = new AbortController()
    let secondDone = false
    const firstWait = turn.awaitSessionStartHooks(first.signal)!
    const secondWait = turn.awaitSessionStartHooks(second.signal)!.then(() => {
      secondDone = true
    })
    try {
      first.abort('user-cancel')
      await firstWait
      expect(ready).toBe(false)
      expect(secondDone).toBe(false)
      hooks.resolve()
      await secondWait
      expect(secondDone).toBe(true)
      expect(
        turn.awaitSessionStartHooks(new AbortController().signal),
      ).toBeUndefined()
    } finally {
      hooks.resolve()
      turn.dispose()
    }
  })

  test('direct run cancellation exits its head-hook wait without settling shared hooks or the next reservation', async () => {
    const turn = createTurn()
    const hooks = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    let sharedSettled = false
    void hooks.promise.then(() => {
      sharedSettled = true
    })
    turn.bindSessionStartHooks(() => {
      entered.resolve()
      return hooks.promise
    })
    const abortController = new AbortController()
    turn.setAbortController(abortController)
    const messagesRef = {
      current: [] as import('../../../types/message.js').Message[],
    }
    let beforeQuery = 0
    const pending = turn.runTurn(
      {
        newMessages: [],
        abortController,
        shouldQuery: true,
        additionalAllowedTools: [],
        mainLoopModelParam: 'fixture',
        input: 'fixture',
        onBeforeQueryCallback: async () => {
          beforeQuery++
          return false
        },
      },
      {
        queryGuard: turn.guard,
        awaitSessionStartHooks: turn.awaitSessionStartHooks,
        pipeReturnHadErrorRef: { current: false },
        resetTimingRefs() {},
        setMessages: (
          action: Parameters<RunReplTurnDeps['setMessages']>[0],
        ) => {
          messagesRef.current =
            typeof action === 'function' ? action(messagesRef.current) : action
        },
        messagesRef,
        responseLengthRef: { current: 0 },
        apiMetricsRef: { current: [] },
        setStreamingToolUses() {},
        clearStreamingText() {},
        displayTransform: { newTurn() {} },
        mrOnBeforeQuery: async () => {},
        inputValueRef: { current: '' },
      } as unknown as RunReplTurnDeps,
    )
    await entered.promise
    turn.guard.forceEnd()
    abortController.abort('user-cancel')
    turn.guard.reserve()
    try {
      expect(await pending).toBe(true)
      expect(beforeQuery).toBe(1)
      expect(sharedSettled).toBe(false)
      expect(turn.guard.isActive).toBe(true)
    } finally {
      hooks.resolve()
      turn.dispose()
    }
  })

  test('SessionStart failure is rethrown unless this turn was cancelled', async () => {
    const turn = createTurn()
    const error = new Error('hook failed')
    turn.bindSessionStartHooks(() => Promise.reject(error))
    try {
      await expect(
        turn.awaitSessionStartHooks(new AbortController().signal)!,
      ).rejects.toBe(error)
      const cancelled = new AbortController()
      cancelled.abort()
      await expect(
        turn.awaitSessionStartHooks(cancelled.signal)!,
      ).resolves.toBeUndefined()
    } finally {
      turn.dispose()
    }
  })

  test('real engine status and stream metrics drive request evidence independently of the guard', async () => {
    const turn = createTurn()
    const observed: boolean[][] = []
    const readEvidence = () => [
      turn.isMainRequestAwaitingResponse,
      turn.isMainResponseStreaming,
    ]
    const terminal = {
      type: 'result' as const,
      subtype: 'success',
      terminal_reason: 'completed',
    }
    const engine = createHostEngine({
      prepareTurn: () => turn.engineFeed.pendingQueryParams.shift()!,
      runTurn: async function* () {
        yield { type: 'system', subtype: 'status', status: 'requesting' }
        yield {
          type: 'stream_event',
          ttftMs: 1,
          event: { type: 'message_start', message: { id: 'msg-fixture' } },
        }
        yield {
          type: 'stream_event',
          event: { type: 'message_delta', usage: { output_tokens: 1 } },
        }
        yield terminal
      },
    })
    const deps = {
      responseLengthRef: { current: 0 },
      apiMetricsRef: { current: [] },
      setStreamMode: turn.setStreamMode,
      setStreamingToolUses: turn.setStreamingToolUses,
      setStreamingThinking: turn.setStreamingThinking,
      setResponseLength: () => {},
      onStreamingText: () => {},
      displayTransform: { begin() {}, finalize() {} },
    } as unknown as Omit<DispatchReplStreamEventDeps, 'event'>
    turn.guard.tryStart()
    try {
      expect(readEvidence()).toEqual([false, false])
      const result = await runHostEngineTurn({
        engine,
        feed: turn.engineFeed,
        turnInput: {},
        newMessages: [],
        onRead: turn.beginEngineRead,
        onMainRequestStart: () => {
          turn.noteMainRequestAnnounced()
          observed.push(readEvidence())
        },
        onQueryEvent: event => {
          turn.dispatchStreamEvent({
            ...deps,
            event: event as DispatchReplStreamEventDeps['event'],
          })
          observed.push(readEvidence())
        },
      })
      expect(result).toBe(terminal)
      expect(observed).toEqual([
        [true, false],
        [false, true],
        [false, false],
      ])
      expect(turn.guard.isRunning).toBe(true)
      turn.noteMainRequestAnnounced()
      turn.resetRequestState()
      expect(readEvidence()).toEqual([false, false])
    } finally {
      engine.close()
      turn.dispose()
    }
  })

  test('controller replacement publishes once and does not toggle loading', () => {
    const turn = createTurn()
    const controller = new AbortController()
    const observed: (AbortController | null)[] = []
    const unsubscribe = turn.subscribe(() =>
      observed.push(turn.abortController),
    )
    try {
      turn.setAbortController(controller)
      const armed = turn.getSnapshot()
      turn.setAbortController(controller)
      expect(turn.getSnapshot()).toBe(armed)
      expect(turn.isLoading).toBe(false)
      turn.setAbortController(null)
      turn.setAbortController(null)
      expect(observed).toEqual([controller, null])
    } finally {
      unsubscribe()
      turn.dispose()
    }
  })

  test('disposed controllers unsubscribe from guard changes', () => {
    const turn = createTurn()
    const initial = turn.getSnapshot()
    let notifications = 0
    turn.subscribe(() => notifications++)
    turn.dispose()
    turn.guard.reserve()
    turn.setExternalLoading(true)
    expect(turn.getSnapshot()).toBe(initial)
    expect(notifications).toBe(0)
  })

  test('turn parameters use the controller feed in send order', () => {
    const turn = createTurn()
    const first = { querySource: 'first' } as unknown as QueryParams
    const second = { querySource: 'second' } as unknown as QueryParams
    try {
      turn.engineFeed.pendingQueryParams.push(first, second)
      expect(turn.readPendingQueryParams()).toBe(first)
      expect(turn.readPendingQueryParams()).toBe(second)
      expect(() => turn.readPendingQueryParams()).toThrow(
        'engine: queryParams called before send',
      )
    } finally {
      turn.dispose()
    }
  })

  test('disposing owned input ends its stream; external input stays open', async () => {
    const owned = createTurn()
    const ownedInput = new Stream<Record<string, unknown>>()
    owned.engineFeed.input = ownedInput
    owned.dispose()
    expect(owned.engineFeed.input).toBeNull()
    expect(await ownedInput.next()).toMatchObject({ done: true })

    const store = createStore({ tasks: {} } as AppState)
    const external = new TurnController({ store, ownsEngine: false })
    const externalInput = new Stream<Record<string, unknown>>()
    external.engineFeed.input = externalInput
    external.dispose()
    expect(external.engineFeed.input).toBeNull()
    externalInput.enqueue({ type: 'user' })
    expect(await externalInput.next()).toEqual({
      done: false,
      value: { type: 'user' },
    })
    externalInput.done()
  })

  test('REPL consumes the controller snapshot without a loading effect bridge', () => {
    const source = [
      readFileSync(join(import.meta.dir, '../../REPL.tsx'), 'utf8'),
      readFileSync(
        join(import.meta.dir, '../useReplTurnOrchestration.tsx'),
        'utf8',
      ),
    ].join('\n')
    expect(source).toContain('const queryGuard = turnController.guard')
    expect(source).not.toContain('turnController.setLoading(')
    expect(source).not.toContain('setIsExternalLoadingRaw')
    expect(source).not.toContain('new QueryGuard()')
    expect(source).toContain('engineFeed: turnController.engineFeed')
    expect(source).toContain(
      'onQueryParamsChange?.(turnController.readPendingQueryParams)',
    )
    expect(source).not.toContain('onQueryParamsChangeRef')
    expect(source).not.toContain('hostInputRef')
    expect(source).not.toContain('pendingQueryParamsRef')
    expect(source).not.toContain('abortControllerRef')
    expect(source).toContain(
      'const setAbortController = turnController.setAbortController',
    )
    expect(source).toContain(
      'const abortController = turnController.abortController',
    )
  })
})
