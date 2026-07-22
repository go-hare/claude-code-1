import { afterEach, describe, expect, test } from 'bun:test'
import type { AppState } from '../../../state/AppState.js'
import type { AgentToolResult } from '@claude-code/builtin-tools/tools/AgentTool/agentToolUtils.js'
import {
  clearAllIdleWindowTimersForTests,
  completeAgentTask,
  drainPendingMessages,
  isLocalAgentTask,
  queuePendingMessage,
  strandedAgentResume,
  type LocalAgentTaskState,
} from '../LocalAgentTask.js'

/**
 * Stranded pending resume: complete with pending → emit; drain empties;
 * re-queue rest path covered in hook.
 */

function makeSetAppState(holder: { state: AppState }) {
  return (f: (prev: AppState) => AppState) => {
    holder.state = f(holder.state)
  }
}

function asPending(
  entries: Array<
    string | { text: string; isMeta?: boolean; origin?: { kind: string } }
  >,
) {
  return entries.map(e =>
    typeof e === 'string'
      ? { text: e, isMeta: false }
      : {
          text: e.text,
          isMeta: e.isMeta ?? false,
          ...(e.origin ? { origin: e.origin } : {}),
        },
  )
}

function seedRunningAgent(
  holder: { state: AppState },
  id: string,
  pending: Array<
    string | { text: string; isMeta?: boolean; origin?: { kind: string } }
  > = [],
): void {
  const task = {
    id,
    type: 'local_agent',
    status: 'running',
    description: 't',
    startTime: Date.now(),
    outputFile: '',
    outputOffset: 0,
    notified: false,
    isBackgrounded: true,
    agentId: id,
    prompt: 'p',
    agentType: 'general-purpose',
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    pendingMessages: asPending(pending),
    retain: false,
    diskLoaded: false,
  } as unknown as LocalAgentTaskState
  holder.state = {
    ...holder.state,
    tasks: { ...(holder.state.tasks ?? {}), [id]: task },
  } as AppState
}

function fakeResult(agentId: string): AgentToolResult {
  return {
    agentId,
    content: [{ type: 'text', text: 'done' }],
    totalTokens: 1,
    totalToolUseCount: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as AgentToolResult
}

describe('strandedAgentResume pending resume', () => {
  afterEach(() => {
    clearAllIdleWindowTimersForTests()
    strandedAgentResume.clear()
  })

  test('queuePendingMessage / drainPendingMessages pure', () => {
    const holder = { state: { tasks: {} } as AppState }
    const set = makeSetAppState(holder)
    seedRunningAgent(holder, 'a1')
    queuePendingMessage('a1', 'm1', set)
    queuePendingMessage('a1', 'm2', set, {
      isMeta: true,
      origin: { kind: 'human' },
    })
    const t = holder.state.tasks['a1']
    expect(isLocalAgentTask(t) && t.pendingMessages).toEqual([
      { text: 'm1', isMeta: false },
      { text: 'm2', isMeta: true, origin: { kind: 'human' } },
    ])
    const drained = drainPendingMessages('a1', () => holder.state, set)
    expect(drained).toEqual([
      { text: 'm1', isMeta: false },
      { text: 'm2', isMeta: true, origin: { kind: 'human' } },
    ])
    const after = holder.state.tasks['a1']
    expect(isLocalAgentTask(after) && after.pendingMessages).toEqual([])
    expect(drainPendingMessages('a1', () => holder.state, set)).toEqual([])
  })

  test('drainPendingMessages CAS: second drain of same batch is empty', () => {
    // Product fortify: capture+clear inside one setAppState so concurrent
    // callers cannot both return the same pending batch.
    const holder = { state: { tasks: {} } as AppState }
    const set = makeSetAppState(holder)
    seedRunningAgent(holder, 'a1-cas')
    queuePendingMessage('a1-cas', 'only-once', set)
    const first = drainPendingMessages('a1-cas', () => holder.state, set)
    const second = drainPendingMessages('a1-cas', () => holder.state, set)
    expect(first).toEqual([{ text: 'only-once', isMeta: false }])
    expect(second).toEqual([])
  })

  test('completeAgentTask emits strandedAgentResume when pendingMessages non-empty', () => {
    const holder = { state: { tasks: {} } as AppState }
    const set = makeSetAppState(holder)
    seedRunningAgent(holder, 'a2', ['queued-mid-turn'])
    const seen: string[] = []
    const unsub = strandedAgentResume.subscribe(id => seen.push(id))
    completeAgentTask(fakeResult('a2'), set)
    unsub()
    expect(seen).toEqual(['a2'])
    const t = holder.state.tasks['a2']
    expect(isLocalAgentTask(t) && t.status).toBe('completed')
    // pending still present until hook drains (complete only emits, does not drain)
    expect(isLocalAgentTask(t) && t.pendingMessages).toEqual([
      { text: 'queued-mid-turn', isMeta: false },
    ])
  })

  test('completeAgentTask does not emit when pending empty', () => {
    const holder = { state: { tasks: {} } as AppState }
    const set = makeSetAppState(holder)
    seedRunningAgent(holder, 'a3', [])
    const seen: string[] = []
    const unsub = strandedAgentResume.subscribe(id => seen.push(id))
    completeAgentTask(fakeResult('a3'), set)
    unsub()
    expect(seen).toEqual([])
  })

  test('completeAgentTask does not emit when not running', () => {
    const holder = { state: { tasks: {} } as AppState }
    const set = makeSetAppState(holder)
    seedRunningAgent(holder, 'a4', ['x'])
    // force completed first
    completeAgentTask(fakeResult('a4'), set)
    const seen: string[] = []
    const unsub = strandedAgentResume.subscribe(id => seen.push(id))
    // second complete is no-op
    completeAgentTask(fakeResult('a4'), set)
    unsub()
    // only first complete emitted once earlier — this subscription saw nothing
    expect(seen).toEqual([])
  })

  test('hook deliver order: head resume + rest re-queue (pure sequence mock)', async () => {
    // Unit the drain/re-queue algorithm without mounting React.
    const holder = { state: { tasks: {} } as AppState }
    const set = makeSetAppState(holder)
    seedRunningAgent(holder, 'a5', ['first', 'second', 'third'])
    // mark completed so status matches post-complete
    completeAgentTask(fakeResult('a5'), set)

    const drained = drainPendingMessages('a5', () => holder.state, set)
    expect(drained.map(e => e.text)).toEqual(['first', 'second', 'third'])
    const [head, ...rest] = drained
    expect(head?.text).toBe('first')
    for (const msg of rest) {
      queuePendingMessage('a5', msg, set)
    }
    const t = holder.state.tasks['a5']
    expect(isLocalAgentTask(t) && t.pendingMessages).toEqual([
      { text: 'second', isMeta: false },
      { text: 'third', isMeta: false },
    ])
  })

  test('queuePendingMessage re-queue entry preserves origin/isMeta', () => {
    const holder = { state: { tasks: {} } as AppState }
    const set = makeSetAppState(holder)
    seedRunningAgent(holder, 'a6')
    queuePendingMessage(
      'a6',
      {
        text: 'observer digest',
        isMeta: true,
        origin: { kind: 'observer-activity' },
      },
      set,
    )
    const drained = drainPendingMessages('a6', () => holder.state, set)
    expect(drained).toEqual([
      {
        text: 'observer digest',
        isMeta: true,
        origin: { kind: 'observer-activity' },
      },
    ])
  })
})
