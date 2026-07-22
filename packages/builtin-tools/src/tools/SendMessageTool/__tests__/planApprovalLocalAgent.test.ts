import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { AppState } from 'src/state/AppState.js'
import { asAgentId } from 'src/types/ids.js'
import {
  clearDynamicTeamContext,
  setDynamicTeamContext,
} from 'src/utils/teammate.js'
import { SendMessageTool } from '../SendMessageTool.js'

// Avoid real disk for observer sidecar gate (missing file → null → allow).
mock.module('src/utils/sessionStorage.js', () => ({
  readAgentMetadata: async () => null,
}))

const writeToMailboxMock = mock(async () => {})
mock.module('src/utils/teammateMailbox.js', () => ({
  writeToMailbox: writeToMailboxMock,
  createShutdownApprovedMessage: () => ({}),
  createShutdownRejectedMessage: () => ({}),
  createShutdownRequestMessage: () => ({}),
}))

type TaskSlice = {
  type: 'local_agent'
  status: 'running' | 'completed' | 'failed' | 'killed'
  agentId: string
  agentType: string
  pendingMessages: Array<{ text: string; isMeta?: boolean; origin?: unknown }>
  isBackgrounded?: boolean
  retain?: boolean
  isIdle?: boolean
  resuming?: boolean
  stoppedByUser?: boolean
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
  registry?: Map<string, ReturnType<typeof asAgentId>>
  teamContext?: AppState['teamContext']
  toolPermissionMode?: string
}) {
  let tasks = { ...opts.tasks }
  const registry = opts.registry ?? new Map()
  let teamContext = opts.teamContext
  const setAppState = (f: (prev: AppState) => AppState) => {
    const prev = {
      tasks,
      agentNameRegistry: registry,
      teamContext,
      toolPermissionContext: {
        mode: opts.toolPermissionMode ?? 'default',
      },
    } as unknown as AppState
    const next = f(prev)
    tasks = { ...(next.tasks as Record<string, TaskSlice>) }
    teamContext = next.teamContext
  }
  return {
    context: {
      agentId: opts.agentId,
      getAppState: () =>
        ({
          tasks,
          agentNameRegistry: registry,
          teamContext,
          toolPermissionContext: {
            mode: opts.toolPermissionMode ?? 'default',
          },
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

describe('SendMessage plan_approval_response local_agent vs team mailbox', () => {
  afterEach(() => {
    clearDynamicTeamContext()
    writeToMailboxMock.mockClear()
  })

  test('main → running local agentId plan approve queues (no team lead error)', async () => {
    // User-reported failure: SendMessage(approve plan from: ad693c4f6c414386b)
    // hit isTeamLead gate with no teamContext. Subagent ids must route local.
    const agentId = 'ad693c4f6c414386b'
    const { context, getTasks } = makeContext({
      tasks: { [agentId]: makeRunningAgent(agentId) },
    })

    const result = await SendMessageTool.call!(
      {
        to: agentId,
        message: {
          type: 'plan_approval_response',
          request_id: 'plan_approval-1',
          approve: true,
        },
      },
      context,
      allow,
      parentMessage,
    )

    expect(result.data.success).toBe(true)
    expect(result.data.message).toContain('Message queued for delivery')
    const pending = getTasks()[agentId]?.pendingMessages ?? []
    expect(pending.length).toBe(1)
    expect(pending[0]?.text).toContain('[Plan Approved]')
    expect(pending[0]?.text).toContain('plan_approval-1')
    expect(writeToMailboxMock).not.toHaveBeenCalled()
  })

  test('main → running local agentId plan reject queues rejection text', async () => {
    const agentId = 'a81c8d8229cca26eb'
    const { context, getTasks } = makeContext({
      tasks: { [agentId]: makeRunningAgent(agentId) },
    })

    const result = await SendMessageTool.call!(
      {
        to: agentId,
        message: {
          type: 'plan_approval_response',
          request_id: 'plan_approval-2',
          approve: false,
          feedback: 'add tests',
        },
      },
      context,
      allow,
      parentMessage,
    )

    expect(result.data.success).toBe(true)
    const pending = getTasks()[agentId]?.pendingMessages ?? []
    expect(pending[0]?.text).toContain('[Plan Rejected]')
    expect(pending[0]?.text).toContain('add tests')
    expect(writeToMailboxMock).not.toHaveBeenCalled()
  })

  test('team lead → teammate name plan approve still uses mailbox', async () => {
    const leadId = 'team-lead@demo'
    const { context } = makeContext({
      tasks: {},
      teamContext: {
        teamName: 'demo',
        teamFilePath: '/tmp/demo',
        leadAgentId: leadId,
        teammates: {
          [leadId]: {
            name: 'team-lead',
            agentType: 'team-lead',
            color: 'red',
            tmuxSessionName: '',
            tmuxPaneId: '',
            cwd: '/tmp',
            spawnedAt: Date.now(),
          },
        },
      },
    })
    // Lead has no agent id (main session / TeamCreate parity).
    clearDynamicTeamContext()

    const result = await SendMessageTool.call!(
      {
        to: 'researcher',
        message: {
          type: 'plan_approval_response',
          request_id: 'plan_approval-3',
          approve: true,
        },
      },
      context,
      allow,
      parentMessage,
    )

    expect(result.data.success).toBe(true)
    expect(result.data.message).toContain('Plan approved for researcher')
    expect(writeToMailboxMock).toHaveBeenCalled()
  })

  test('teammate (wrong identity) plan approve still refused by team lead gate', async () => {
    const leadId = 'team-lead@demo'
    setDynamicTeamContext({
      agentId: 'worker@demo',
      agentName: 'worker',
      teamName: 'demo',
      planModeRequired: false,
    })
    const { context } = makeContext({
      tasks: {},
      teamContext: {
        teamName: 'demo',
        teamFilePath: '/tmp/demo',
        leadAgentId: leadId,
        teammates: {
          [leadId]: {
            name: 'team-lead',
            agentType: 'team-lead',
            color: 'red',
            tmuxSessionName: '',
            tmuxPaneId: '',
            cwd: '/tmp',
            spawnedAt: Date.now(),
          },
        },
      },
    })

    await expect(
      SendMessageTool.call!(
        {
          to: 'researcher',
          message: {
            type: 'plan_approval_response',
            request_id: 'plan_approval-4',
            approve: true,
          },
        },
        context,
        allow,
        parentMessage,
      ),
    ).rejects.toThrow('Only the team lead can approve plans')
  })
})
