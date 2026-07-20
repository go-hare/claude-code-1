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
 * densable Weo / sqe / Qeo pure matrix:
 * complete with pending → emit; drain empties; re-queue rest path covered in hook.
 */

function makeSetAppState(holder: { state: AppState }) {
  return (f: (prev: AppState) => AppState) => {
    holder.state = f(holder.state)
  }
}

function seedRunningAgent(
  holder: { state: AppState },
  id: string,
  pending: string[] = [],
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
    pendingMessages: pending,
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

describe('densable Weo stranded pending resume', () => {
  afterEach(() => {
    clearAllIdleWindowTimersForTests()
    strandedAgentResume.clear()
  })

  test('queuePendingMessage / drainPendingMessages Qeo pure', () => {
    const holder = { state: { tasks: {} } as AppState }
    const set = makeSetAppState(holder)
    seedRunningAgent(holder, 'a1')
    queuePendingMessage('a1', 'm1', set)
    queuePendingMessage('a1', 'm2', set)
    const t = holder.state.tasks['a1']
    expect(isLocalAgentTask(t) && t.pendingMessages).toEqual(['m1', 'm2'])
    const drained = drainPendingMessages('a1', () => holder.state, set)
    expect(drained).toEqual(['m1', 'm2'])
    const after = holder.state.tasks['a1']
    expect(isLocalAgentTask(after) && after.pendingMessages).toEqual([])
    expect(drainPendingMessages('a1', () => holder.state, set)).toEqual([])
  })

  test('completeAgentTask emits Weo when pendingMessages non-empty', () => {
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
    // pending still present until hook drains (DSu only emits, does not Qeo)
    expect(isLocalAgentTask(t) && t.pendingMessages).toEqual([
      'queued-mid-turn',
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

  test('hook deliver order: head Aye + rest re-queue (pure sequence mock)', async () => {
    // Unit the drain/re-queue algorithm without mounting React.
    const holder = { state: { tasks: {} } as AppState }
    const set = makeSetAppState(holder)
    seedRunningAgent(holder, 'a5', ['first', 'second', 'third'])
    // mark completed so status matches post-DSu
    completeAgentTask(fakeResult('a5'), set)

    const drained = drainPendingMessages('a5', () => holder.state, set)
    expect(drained).toEqual(['first', 'second', 'third'])
    const [head, ...rest] = drained
    expect(head).toBe('first')
    for (const msg of rest) {
      queuePendingMessage('a5', msg, set)
    }
    const t = holder.state.tasks['a5']
    expect(isLocalAgentTask(t) && t.pendingMessages).toEqual([
      'second',
      'third',
    ])
  })
})
