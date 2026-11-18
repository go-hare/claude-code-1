import { afterEach, describe, expect, test } from 'bun:test'
import {
  exclusiveCallQueuedBehind,
  StreamingToolExecutor,
} from '../../../services/tools/StreamingToolExecutor.js'
import { createTaskRegistry } from '../../../utils/taskRegistry.js'
import {
  autoBackgroundAgentIfNotHeld,
  getAutoBackgroundHoldReason,
  isAutoBackgroundHeld,
  type LocalAgentTaskState,
} from '../LocalAgentTask.js'

function makeAgentTask(
  overrides: Partial<LocalAgentTaskState> = {},
): LocalAgentTaskState {
  return {
    id: 'agent-1',
    type: 'local_agent',
    status: 'running',
    description: 'test agent',
    startTime: Date.now(),
    outputFile: '/tmp/out.txt',
    outputOffset: 0,
    notified: false,
    agentId: 'agent-1',
    prompt: 'do work',
    model: 'claude-sonnet-4-6',
    agentType: 'general-purpose',
    isBackgrounded: false,
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
    toolUseId: 'toolu_agent_1',
    ...overrides,
  } as LocalAgentTaskState
}

describe('exclusiveCallQueuedBehind (#368)', () => {
  afterEach(() => {
    exclusiveCallQueuedBehind.clear()
  })

  test('getAutoBackgroundHoldReason returns call_queued_behind and blocks auto-backgrounding', () => {
    exclusiveCallQueuedBehind.set('toolu_agent_1', {
      isQueued: () => true,
      mayYetBeQueued: () => true,
      holdLogged: false,
    })
    const task = makeAgentTask()
    expect(getAutoBackgroundHoldReason(task)).toBe('call_queued_behind')
    expect(isAutoBackgroundHeld(task)).toBe(true)

    let state = { tasks: { [task.id]: task } } as any
    const registry = createTaskRegistry(
      () => state,
      updater => {
        state = updater(state)
      },
    )
    expect(autoBackgroundAgentIfNotHeld(task.id, registry)).toBe(false)
    expect((registry.get(task.id) as LocalAgentTaskState).isBackgrounded).toBe(
      false,
    )
  })

  test('getAutoBackgroundHoldReason returns response_streaming when not queued yet but response is open', () => {
    exclusiveCallQueuedBehind.set('toolu_agent_1', {
      isQueued: () => false,
      mayYetBeQueued: () => true,
      holdLogged: false,
    })
    const task = makeAgentTask()
    expect(getAutoBackgroundHoldReason(task)).toBe('response_streaming')
    expect(isAutoBackgroundHeld(task)).toBe(true)
  })

  test('autoBackgroundAgentIfNotHeld promotes when neither queued nor streaming', () => {
    exclusiveCallQueuedBehind.set('toolu_agent_1', {
      isQueued: () => false,
      mayYetBeQueued: () => false,
      holdLogged: false,
    })
    const task = makeAgentTask()
    let state = { tasks: { [task.id]: task } } as any
    const registry = createTaskRegistry(
      () => state,
      updater => {
        state = updater(state)
      },
    )
    expect(autoBackgroundAgentIfNotHeld(task.id, registry)).toBe(true)
    expect((registry.get(task.id) as LocalAgentTaskState).isBackgrounded).toBe(
      true,
    )
  })

  test('StreamingToolExecutor closes responseOpen when getRemainingResults starts', async () => {
    const executor = new StreamingToolExecutor(
      [],
      async () => ({ behavior: 'allow', updatedInput: {} }),
      {
        abortController: new AbortController(),
        setInProgressToolUseIDs: () => {},
        setResponseLength: () => {},
        options: {
          tools: [],
          commands: [],
          mainLoopModel: 'claude-sonnet-4-6',
          thinkingConfig: { type: 'disabled' },
          mcpClients: [],
          mcpResources: {},
          isNonInteractiveSession: false,
          debug: false,
          verbose: false,
          agentDefinitions: { activeAgents: [], allAgents: [] },
        },
        getAppState: () => ({}) as any,
        setAppState: () => {},
        messages: [],
        readFileState: new Map() as any,
        setToolPermissionContext: () => {},
        setSessionToolPermissionContext: () => {},
        updateFileHistoryState: () => {},
        updateAttributionState: () => {},
      } as any,
    )
    // Drain empty generator to trigger responseOpen = false
    for await (const _ of executor.getRemainingResults()) {
      // no-op
    }
    expect(
      (executor as unknown as { responseOpen: boolean }).responseOpen,
    ).toBe(false)
  })
})
