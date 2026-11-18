import { describe, expect, test } from 'bun:test'
import {
  completeAgentTask,
  forfeitAllChatPins,
  forfeitChatPins,
  getPanelParentAgentId,
  isChatEngagedAgent,
  markAgentChatEngaged,
  queuePendingMessage,
  type LocalAgentTaskState,
} from '../LocalAgentTask.js'
import type { TaskStateBase } from '../../../Task.js'
import type { AppState } from '../../../state/AppState.js'
type TaskState = AppState['tasks'][string]

function makeAgent(
  id: string,
  overrides: Partial<LocalAgentTaskState> = {},
): LocalAgentTaskState {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    description: `agent ${id}`,
    startTime: 1000,
    outputFile: '',
    outputOffset: 0,
    notified: false,
    agentId: id,
    prompt: 'hello',
    selectedAgent: undefined,
    agentType: 'Explore',
    model: 'claude-sonnet-4-6',
    messages: [],
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
    isBackgrounded: true,
    ...overrides,
  } as LocalAgentTaskState
}

describe('LocalAgentTask #769 chatEngaged & #770 getPanelParentAgentId', () => {
  test('#769: queuePendingMessage with human origin sets chatEngaged and prevents eviction on complete', () => {
    let state: Record<string, TaskState> = {
      a1: makeAgent('a1'),
    }
    const setAppState = (
      fn: (prev: { tasks: Record<string, TaskState> }) => {
        tasks: Record<string, TaskState>
      },
    ) => {
      state = fn({ tasks: state }).tasks
    }
    const getAppState = () => ({ tasks: state }) as never

    queuePendingMessage('a1', 'follow up', setAppState as never, {
      origin: { kind: 'human' },
    })
    expect((state.a1 as LocalAgentTaskState).chatEngaged).toBe(true)

    const registry = {
      get: (id: string) => state[id],
      all: () => state,
      register: () => {},
      update: (
        id: string,
        updater: (t: LocalAgentTaskState) => LocalAgentTaskState,
      ) => {
        const cur = state[id] as LocalAgentTaskState | undefined
        if (cur) state = { ...state, [id]: updater(cur) }
      },
      remove: () => {},
    } as never

    completeAgentTask(
      {
        agentId: 'a1',
        content: [{ type: 'text', text: 'done' }],
        totalDurationMs: 10,
        totalTokens: 1,
        totalToolUseCount: 0,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use: null,
          service_tier: null,
          cache_creation: null,
        } as never,
      },
      registry,
    )

    const completed = state.a1 as LocalAgentTaskState
    expect(completed.status).toBe('completed')
    expect(isChatEngagedAgent(completed)).toBe(true)
    expect(completed.evictAfter).toBeUndefined()

    const forfeited = forfeitChatPins(state, 50_000, 30_000)
    const afterForfeit = forfeited.a1 as LocalAgentTaskState
    expect(afterForfeit.chatPinForfeited).toBe(true)
    expect(afterForfeit.evictAfter).toBeGreaterThanOrEqual(50_000)
    expect(isChatEngagedAgent(afterForfeit)).toBe(false)

    // markAgentChatEngaged does not re-engage after forfeit
    markAgentChatEngaged('a1', {
      get: (id: string) => forfeited[id],
      all: () => forfeited,
      register: () => {},
      remove: () => {},
      update: (
        id: string,
        updater: (t: LocalAgentTaskState) => LocalAgentTaskState,
      ) => {
        const cur = forfeited[id] as LocalAgentTaskState | undefined
        if (cur) forfeited[id] = updater(cur)
      },
    } as never)
    expect((forfeited.a1 as LocalAgentTaskState).chatEngaged).toBe(true)
    expect(isChatEngagedAgent(forfeited.a1)).toBe(false)

    // forfeitAllChatPins updates AppState tasks
    forfeitAllChatPins(setAppState as never, 60_000)
    expect((state.a1 as LocalAgentTaskState).chatPinForfeited).toBe(true)
    expect((state.a1 as LocalAgentTaskState).evictAfter).toBeGreaterThanOrEqual(
      60_000,
    )
    void getAppState
  })

  test('#770: getPanelParentAgentId resolves panel parent for local_agent, local_workflow, and local_bash', () => {
    const parent = makeAgent('parent')
    const observer = makeAgent('obs', { isObserver: true })
    const tasks: Record<string, TaskStateBase> = {
      parent,
      obs: observer,
    }
    expect(
      getPanelParentAgentId(
        makeAgent('c1', { parentAgentId: 'parent' }),
        tasks,
      ),
    ).toBe('parent')
    expect(
      getPanelParentAgentId(makeAgent('c2', { parentAgentId: 'obs' }), tasks),
    ).toBeUndefined()
    expect(
      getPanelParentAgentId(
        { type: 'local_workflow', spawnerAgentId: 'parent' },
        tasks,
      ),
    ).toBe('parent')
    expect(
      getPanelParentAgentId({ type: 'local_bash', agentId: 'parent' }, tasks),
    ).toBe('parent')
  })
})
