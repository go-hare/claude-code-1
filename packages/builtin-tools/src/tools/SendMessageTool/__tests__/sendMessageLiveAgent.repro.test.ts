import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { AppState } from 'src/state/AppState.js'
import { registerAsyncAgent } from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import type { AgentId } from 'src/types/ids.js'
import * as realSessionStorage from 'src/utils/sessionStorage.js'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'
import { GENERAL_PURPOSE_AGENT } from '../../AgentTool/built-in/generalPurposeAgent.js'
import { SendMessageTool } from '../SendMessageTool.js'

// Snapshot BEFORE mock — process-global last-write-wins. Re-apply in beforeEach
// so co-suites that restore real sessionStorage cannot make resume find a transcript.
const sessionStorageSnap = snapshotModuleExports(realSessionStorage)
function sessionStorageMock() {
  return {
    ...sessionStorageSnap,
    readAgentMetadata: async () => null,
    getAgentTranscript: async () => null,
    writeAgentMetadata: async () => {},
    recordSidechainTranscript: async () => {},
  }
}
mock.module('src/utils/sessionStorage.js', sessionStorageMock)
beforeEach(() => {
  mock.module('src/utils/sessionStorage.js', sessionStorageMock)
})
afterAll(() => {
  mock.module('src/utils/sessionStorage.js', () => ({ ...sessionStorageSnap }))
})

function store() {
  let state = {
    tasks: {} as AppState['tasks'],
    agentNameRegistry: new Map(),
    toolPermissionContext: {
      mode: 'default' as const,
      additionalWorkingDirectories: new Map(),
    },
    agentDefinitions: { activeAgents: [GENERAL_PURPOSE_AGENT] },
  } as unknown as AppState
  const setAppState = (f: (p: AppState) => AppState) => {
    state = f(state)
  }
  return {
    getAppState: () => state,
    setAppState,
    setAppStateForTasks: setAppState,
  }
}

const parentMessage = {
  type: 'assistant',
  uuid: '00000000-0000-4000-8000-000000000099',
  message: { role: 'assistant', content: [] },
} as any

const allow = (async () => ({
  behavior: 'allow' as const,
  updatedInput: {},
})) as any

// Fixed createAgentId-shaped id — do NOT call createAgentId() here.
// Bun mock.module is process-global; claudeCodeBackend stubs createAgentId
// to 'agent-1', which fails toAgentId() and routes SendMessage to team mailbox.
const VALID_AGENT_ID = 'a0123456789abcdef' as AgentId

describe('real registerAsyncAgent + SendMessage', () => {
  test('main sends to live registered agent', async () => {
    const s = store()
    const agentId = VALID_AGENT_ID
    registerAsyncAgent({
      agentId,
      description: 'test worker',
      prompt: 'do work',
      selectedAgent: GENERAL_PURPOSE_AGENT,
      setAppState: s.setAppState,
      attachOwnerKeepalive: false,
    })
    const task = s.getAppState().tasks[agentId]
    console.log('registered task', {
      id: (task as { id?: string } | undefined)?.id,
      agentId: (task as { agentId?: string } | undefined)?.agentId,
      status: (task as { status?: string } | undefined)?.status,
      type: (task as { type?: string } | undefined)?.type,
    })
    expect((task as { status?: string } | undefined)?.status).toBe('running')

    const result = await SendMessageTool.call!(
      { to: agentId, summary: 'ping', message: 'hello worker' },
      {
        agentId: undefined,
        ...s,
        options: {
          agentDefinitions: { activeAgents: [GENERAL_PURPOSE_AGENT] },
          tools: [],
          mainLoopModel: 'test',
        },
      } as any,
      allow,
      parentMessage,
    )
    console.log('send result', result.data)
    const after = s.getAppState().tasks[agentId] as
      | { pendingMessages?: unknown[] }
      | undefined
    console.log('pending', after?.pendingMessages)
    expect(result.data.success).toBe(true)
    expect(after?.pendingMessages?.length).toBe(1)
  })

  test('main sends to completed agent (resume path)', async () => {
    const s = store()
    const agentId = VALID_AGENT_ID
    registerAsyncAgent({
      agentId,
      description: 'done worker',
      prompt: 'done',
      selectedAgent: GENERAL_PURPOSE_AGENT,
      setAppState: s.setAppState,
      attachOwnerKeepalive: false,
    })
    s.setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        // Test-only incomplete TaskState shape — cast through unknown so
        // typecheck does not require full LocalAgentTask fields.
        [agentId]: {
          ...(prev.tasks[agentId] as object),
          status: 'completed',
          abortController: undefined,
          selectedAgent: undefined,
        } as unknown as AppState['tasks'][string],
      },
    }))
    const result = await SendMessageTool.call!(
      { to: agentId, summary: 'wake', message: 'continue' },
      {
        agentId: undefined,
        ...s,
        options: {
          agentDefinitions: { activeAgents: [GENERAL_PURPOSE_AGENT] },
          tools: [],
          mainLoopModel: 'test',
        },
      } as any,
      allow,
      parentMessage,
    )
    console.log('completed send result', result.data)
    expect(result.data.success).toBe(false)
    expect(result.data.message).toMatch(/could not be resumed|no transcript/i)
  })
})
