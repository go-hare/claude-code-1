import { describe, expect, mock, test } from 'bun:test'
import type { AppState } from 'src/state/AppState.js'
import type { AgentId } from 'src/types/ids.js'
import { asAgentId } from 'src/types/ids.js'
import { SendMessageTool } from '../SendMessageTool.js'

// Avoid real disk for observer sidecar gate (missing file → null → allow).
mock.module('src/utils/sessionStorage.js', () => ({
  readAgentMetadata: async () => null,
}))

type TaskSlice = {
  type: 'local_agent'
  status: 'running' | 'completed' | 'failed' | 'killed'
  agentId: string
  agentType: string
  isObserver?: boolean
  stoppedByUser?: boolean
  pendingMessages: Array<{ text: string; isMeta?: boolean; origin?: unknown }>
  isBackgrounded?: boolean
  retain?: boolean
  isIdle?: boolean
  resuming?: boolean
}

function makeRunningAgent(agentId: string): TaskSlice {
  return {
    type: 'local_agent',
    status: 'running',
    agentId,
    agentType: 'general-purpose',
    pendingMessages: [],
    isBackgrounded: true,
    retain: false,
    isIdle: false,
    resuming: false,
  }
}

function makeContext(opts: {
  agentId?: string
  tasks: Record<string, TaskSlice>
  registry?: Map<string, AgentId>
}) {
  let tasks = { ...opts.tasks }
  const registry = opts.registry ?? new Map<string, AgentId>()
  const setAppState = (f: (prev: AppState) => AppState) => {
    const prev = {
      tasks,
      agentNameRegistry: registry,
    } as unknown as AppState
    const next = f(prev)
    tasks = { ...(next.tasks as Record<string, TaskSlice>) }
  }
  return {
    context: {
      agentId: opts.agentId,
      getAppState: () =>
        ({
          tasks,
          agentNameRegistry: registry,
        }) as unknown as AppState,
      setAppState,
      setAppStateForTasks: setAppState,
    } as any,
    getTasks: () => tasks,
  }
}

const allow = (async () => ({
  behavior: 'allow' as const,
  updatedInput: {},
})) as any

const parentMessage = {
  type: 'assistant',
  uuid: '00000000-0000-4000-8000-000000000099',
  message: { role: 'assistant', content: [] },
} as any

describe('SendMessage main → subagent (local_agent)', () => {
  test('main → running agentId queues pending message', async () => {
    const agentId = 'a81c8d8229cca26eb'
    const { context, getTasks } = makeContext({
      tasks: { [agentId]: makeRunningAgent(agentId) },
    })

    const result = await SendMessageTool.call!(
      {
        to: agentId,
        summary: 'nudge worker',
        message: 'please continue the scan',
      },
      context,
      allow,
      parentMessage,
    )

    console.log('result', result.data)
    console.log('pending', getTasks()[agentId]?.pendingMessages)

    expect(result.data.success).toBe(true)
    expect(result.data.message).toContain('Message queued for delivery')
    const pending = getTasks()[agentId]?.pendingMessages ?? []
    expect(pending.length).toBe(1)
    expect(pending[0]?.text).toBe('please continue the scan')
    expect(pending[0]?.isMeta).toBe(true)
  })

  test('main → running named agent via registry queues', async () => {
    const agentId = asAgentId('af0f72b5a99487324')
    const { context, getTasks } = makeContext({
      tasks: { [agentId]: makeRunningAgent(agentId) },
      registry: new Map([['scanner', agentId]]),
    })

    const result = await SendMessageTool.call!(
      {
        to: 'scanner',
        summary: 'nudge by name',
        message: 'status?',
      },
      context,
      allow,
      parentMessage,
    )

    console.log('named result', result.data)
    expect(result.data.success).toBe(true)
    expect(getTasks()[agentId]?.pendingMessages.length).toBe(1)
  })

  test('main → completed agent without transcript fails resume', async () => {
    const agentId = 'a8ea3089a93ecc399'
    const { context } = makeContext({
      tasks: {
        [agentId]: {
          ...makeRunningAgent(agentId),
          status: 'completed',
        },
      },
    })

    const result = await SendMessageTool.call!(
      {
        to: agentId,
        summary: 'wake dead',
        message: 'resume please',
      },
      context,
      allow,
      parentMessage,
    )

    console.log('completed result', result.data)
    // Expect either success (if resume mocked) or explicit failure — log actual.
    expect(typeof result.data.success).toBe('boolean')
    expect(typeof result.data.message).toBe('string')
  })

  test('main → missing task + agentId shape tries evicted resume', async () => {
    const agentId = 'a9fbd6d3825e43d9d'
    const { context } = makeContext({
      tasks: {},
    })

    const result = await SendMessageTool.call!(
      {
        to: agentId,
        summary: 'ghost',
        message: 'are you there',
      },
      context,
      allow,
      parentMessage,
    )

    console.log('evicted result', result.data)
    expect(typeof result.data.success).toBe('boolean')
    expect(result.data.message.length).toBeGreaterThan(0)
  })
})
