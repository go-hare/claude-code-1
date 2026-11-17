import { describe, expect, test } from 'bun:test'
import { createAbortErrorReason } from '../../../utils/abortController.js'
import {
  mergeToolDrainEvents,
  StreamingToolExecutor,
} from '../StreamingToolExecutor.js'
import { createAssistantMessage } from '../../../utils/messages.js'
import type { ToolUseContext } from '../../../Tool.js'

function makeMinimalContext(): ToolUseContext {
  const abortController = new AbortController()
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { builtinAgents: [], customAgents: [] },
    },
    abortController,
    readFileState: {
      get: () => undefined,
      set: () => {},
      delete: () => false,
      has: () => false,
      clear: () => {},
    } as any,
    getAppState: () => ({}) as any,
    setAppState: () => {},
    session: { root: {} },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
}

describe('StreamingToolExecutor.discard()', () => {
  test('clears the internal tools array', () => {
    const ctx = makeMinimalContext()
    const executor = new StreamingToolExecutor([], () => true as any, ctx)

    // Access internal state via reflection
    const toolsBefore = (executor as unknown as { tools: unknown[] }).tools
    expect(toolsBefore).toHaveLength(0)

    executor.discard()

    const toolsAfter = (executor as unknown as { tools: unknown[] }).tools
    expect(toolsAfter).toHaveLength(0)
  })

  test('aborts the sibling abort controller', () => {
    const ctx = makeMinimalContext()
    const executor = new StreamingToolExecutor([], () => true as any, ctx)

    const siblingController = (
      executor as unknown as { siblingAbortController: AbortController }
    ).siblingAbortController
    expect(siblingController.signal.aborted).toBe(false)

    executor.discard()

    expect(siblingController.signal.aborted).toBe(true)
  })

  test('sets discarded flag so getCompletedResults yields nothing', () => {
    const ctx = makeMinimalContext()
    const executor = new StreamingToolExecutor([], () => true as any, ctx)

    executor.discard()

    const results = [...executor.getCompletedResults()]
    expect(results).toHaveLength(0)
  })

  test('sets discarded flag so getRemainingResults yields nothing', async () => {
    const ctx = makeMinimalContext()
    const executor = new StreamingToolExecutor([], () => true as any, ctx)

    executor.discard()

    const results: unknown[] = []
    for await (const update of executor.getRemainingResults()) {
      results.push(update)
    }
    expect(results).toHaveLength(0)
  })

  test('clears progressAvailableResolve', () => {
    const ctx = makeMinimalContext()
    const executor = new StreamingToolExecutor([], () => true as any, ctx)

    executor.discard()

    const resolve = (
      executor as unknown as { progressAvailableResolve?: () => void }
    ).progressAvailableResolve
    expect(resolve).toBeUndefined()
  })

  test('can be called multiple times without error', () => {
    const ctx = makeMinimalContext()
    const executor = new StreamingToolExecutor([], () => true as any, ctx)

    expect(() => {
      executor.discard()
      executor.discard()
      executor.discard()
    }).not.toThrow()
  })

  test('releases references to allow GC of discarded executor', () => {
    const ctx = makeMinimalContext()
    const executor = new StreamingToolExecutor([], () => true as any, ctx)

    executor.discard()

    // All internal references should be cleared/released
    const internals = executor as unknown as {
      tools: unknown[]
      progressAvailableResolve?: () => void
      turnSpan: unknown
    }
    expect(internals.tools).toHaveLength(0)
    expect(internals.progressAvailableResolve).toBeUndefined()
    expect(internals.turnSpan).toBeNull()
  })
})

type ContextModifier = (context: ToolUseContext) => ToolUseContext

type ConcurrentTestTool = {
  id: string
  status: 'executing' | 'completed' | 'yielded' | 'queued'
  isConcurrencySafe: boolean
  contextModifiers: ContextModifier[]
  pendingProgress: []
  pendingBridgeEvents: []
  results: []
  promise?: Promise<void>
}

function concurrentRun() {
  const context = makeMinimalContext()
  const executor = new StreamingToolExecutor([], () => true as any, context)
  const host = executor as unknown as {
    tools: ConcurrentTestTool[]
    processQueue(): Promise<void>
    executeTool(tool: ConcurrentTestTool): Promise<void>
    applyFinishedConcurrentContextModifiers(): void
  }
  const applied: string[] = []
  const tool = (id: string): ConcurrentTestTool => ({
    id,
    status: 'executing',
    isConcurrencySafe: true,
    contextModifiers: [
      ctx => {
        applied.push(id)
        return { ...ctx, agentType: `${ctx.agentType ?? ''}${id}` }
      },
    ],
    pendingProgress: [],
    pendingBridgeEvents: [],
    results: [],
  })
  const first = tool('A')
  const second = tool('B')
  host.tools.push(first, second)
  return { executor, host, applied, first, second, tool, context }
}

describe('StreamingToolExecutor concurrent context modifiers (289)', () => {
  test('waits for the entire run and merges out-of-order completion in queue order once', () => {
    const { executor, host, applied, first, second, context } = concurrentRun()
    second.status = 'completed'
    host.applyFinishedConcurrentContextModifiers()
    expect(executor.getUpdatedContext()).toBe(context)
    expect(applied).toEqual([])

    first.status = 'completed'
    host.applyFinishedConcurrentContextModifiers()
    host.applyFinishedConcurrentContextModifiers()
    expect(applied).toEqual(['A', 'B'])
    expect(executor.getUpdatedContext().agentType).toBe('AB')
  })

  test('merges a settled run before starting the next exclusive call', async () => {
    const { executor, host, applied, first, second, tool } = concurrentRun()
    first.status = 'completed'
    second.status = 'completed'
    const next = tool('C')
    next.isConcurrencySafe = false
    next.status = 'queued'
    host.tools.push(next)
    let received: ToolUseContext | undefined
    host.executeTool = async call => {
      received = executor.getUpdatedContext()
      call.status = 'completed'
    }
    await host.processQueue()
    expect(received?.agentType).toBe('AB')
    expect(applied).toEqual(['A', 'B'])
  })

  test('does not merge a completed sibling while another call can join the active run', async () => {
    const { executor, host, applied, second, tool, context } = concurrentRun()
    second.status = 'completed'
    const next = tool('C')
    next.status = 'queued'
    host.tools.push(next)
    let received: ToolUseContext | undefined
    host.executeTool = async call => {
      received = executor.getUpdatedContext()
      call.status = 'executing'
    }
    await host.processQueue()
    expect(received).toBe(context)
    expect(applied).toEqual([])
  })

  test('returns the final context even after completed results were already yielded', async () => {
    const { executor, host, applied, first, second } = concurrentRun()
    first.status = 'completed'
    second.status = 'completed'
    expect([...executor.getCompletedResults()]).toEqual([])
    expect(applied).toEqual([])
    const updates = []
    for await (const update of executor.getRemainingResults())
      updates.push(update)
    expect(updates).toHaveLength(1)
    expect(updates[0]?.newContext?.agentType).toBe('AB')
    expect(updates[0]?.message).toBeUndefined()
    host.applyFinishedConcurrentContextModifiers()
    expect(applied).toEqual(['A', 'B'])
  })

  test('leaves exclusive modifiers to their immediate application path', async () => {
    const { executor, applied, first, second, context } = concurrentRun()
    first.status = 'yielded'
    second.status = 'yielded'
    first.isConcurrencySafe = false
    second.contextModifiers = []
    const updates = []
    for await (const update of executor.getRemainingResults())
      updates.push(update)
    expect(updates).toEqual([])
    expect(applied).toEqual([])
    expect(executor.getUpdatedContext()).toBe(context)
  })
})

describe('mergeToolDrainEvents (289)', () => {
  function stalledStream() {
    let resolve!: (result: IteratorResult<{ type: 'model' }>) => void
    let returned = false
    let reads = 0
    const stream = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            reads++
            return new Promise<IteratorResult<{ type: 'model' }>>(done => {
              resolve = done
            })
          },
          async return() {
            returned = true
            resolve({ done: true, value: undefined })
            return { done: true as const, value: undefined }
          },
        }
      },
    }
    return {
      stream,
      finish: () => resolve({ done: true, value: undefined }),
      emit: () => resolve({ done: false, value: { type: 'model' } }),
      reads: () => reads,
      returned: () => returned,
    }
  }

  test('drains a real completed unknown-tool result while the model stream is stalled', async () => {
    const context = makeMinimalContext()
    const executor = new StreamingToolExecutor([], () => true as any, context)
    const source = stalledStream()
    const merged = mergeToolDrainEvents(source.stream, () => executor)
    const waiting = merged.next()
    executor.addTool(
      {
        type: 'tool_use',
        id: 'unknown',
        name: 'Missing',
        input: {},
        caller: { type: 'direct' },
      },
      createAssistantMessage({ content: [] }),
    )
    expect((await waiting).value).toEqual({ type: 'tool_drain_tick' })
    const results = [...executor.getCompletedResults()]
    expect(results).toHaveLength(1)
    expect(results[0]?.message?.type).toBe('user')
    expect(source.reads()).toBe(1)
    const next = merged.next()
    source.finish()
    expect((await next).done).toBe(true)
    expect(source.returned()).toBe(true)
  })

  test('observes an already-signaled generation and does not re-read a pending stream on ticks', async () => {
    const executor = new StreamingToolExecutor(
      [],
      () => true as any,
      makeMinimalContext(),
    )
    const host = executor as unknown as { wakeWaiters(): void }
    host.wakeWaiters()
    const source = stalledStream()
    const merged = mergeToolDrainEvents(source.stream, () => executor)
    expect((await merged.next()).value).toEqual({ type: 'tool_drain_tick' })
    const waiting = merged.next()
    host.wakeWaiters()
    expect((await waiting).value).toEqual({ type: 'tool_drain_tick' })
    expect(source.reads()).toBe(1)
    await merged.return(undefined)
    expect(source.returned()).toBe(true)
  })

  test('resets the generation when fallback replaces the executor', async () => {
    let executor = new StreamingToolExecutor(
      [],
      () => true as any,
      makeMinimalContext(),
    )
    const source = stalledStream()
    const merged = mergeToolDrainEvents(source.stream, () => executor)
    const waiting = merged.next()
    executor.discard()
    expect((await waiting).value).toEqual({ type: 'tool_drain_tick' })
    executor = new StreamingToolExecutor(
      [],
      () => true as any,
      makeMinimalContext(),
    )
    const replaced = merged.next()
    executor.discard()
    expect((await replaced).value).toEqual({ type: 'tool_drain_tick' })
    await merged.return(undefined)
  })

  test('preserves model events and iterator cleanup without streaming tools', async () => {
    const source = stalledStream()
    const merged = mergeToolDrainEvents(source.stream, () => undefined)
    const waiting = merged.next()
    source.emit()
    expect((await waiting).value).toEqual({ type: 'model' })
    await merged.return(undefined)
    expect(source.returned()).toBe(true)
  })

  test('discard wakes the result-drain waiter as well as the model-stream waiter', async () => {
    const executor = new StreamingToolExecutor(
      [],
      () => true as any,
      makeMinimalContext(),
    )
    let resultDrainWoken = false
    const host = executor as unknown as {
      progressAvailableResolve?: () => void
    }
    host.progressAvailableResolve = () => {
      resultDrainWoken = true
    }
    const waiting = executor.waitForDrainable(0)
    executor.discard()
    expect(await waiting).toBe(1)
    expect(resultDrainWoken).toBe(true)
  })
})

describe('StreamingToolExecutor remote-cancel (236 #27)', () => {
  test('getAbortReason maps remote-cancel DOMException to remote_cancel, not user_interrupted', () => {
    const ctx = makeMinimalContext()
    ctx.abortController.abort(createAbortErrorReason('remote-cancel'))
    const executor = new StreamingToolExecutor([], () => true as any, ctx)
    const reason = (
      executor as unknown as {
        getAbortReason: (tool: { block: { name: string } }) => string | null
      }
    ).getAbortReason({ block: { name: 'Bash' } })
    expect(reason).toBe('remote_cancel')
  })

  test('getAbortReason string interrupt + default block interruptBehavior is null', () => {
    const ctx = makeMinimalContext()
    ctx.abortController.abort('interrupt')
    const executor = new StreamingToolExecutor([], () => true as any, ctx)
    const reason = (
      executor as unknown as {
        getAbortReason: (tool: { block: { name: string } }) => string | null
      }
    ).getAbortReason({ block: { name: 'Bash' } })
    // interruptBehavior default is 'block' → null (do not cancel)
    expect(reason).toBe(null)
  })
})
