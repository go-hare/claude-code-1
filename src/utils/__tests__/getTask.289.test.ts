import { afterEach, beforeEach, describe, expect, test, mock } from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import * as growthbook from '../../services/analytics/growthbook.js'
import { killTask } from '../../tasks/LocalShellTask/killShellTasks.js'
import { applyTaskOffsetsAndEvictions } from '../task/framework.js'
import { GetTaskTool } from '../../../packages/builtin-tools/src/tools/GetTaskTool/GetTaskTool.js'
import { getBootstrapSession, getBootstrapSessionHost } from '../sessionRoot.js'
import {
  setUserPromptWaitingFor,
  getUserPromptWaitingFor,
  isUserPromptWaiting,
  setSessionWorking,
  isSessionWorking,
  subscribeSessionWorking,
} from '../sessionHost.js'
import {
  getBashTaskDeliveryBag,
  lookupBashTaskSnapshot,
  rememberBashTaskSnapshot,
  resetBashTaskDeliveryForTests,
  withdrawQueuedBashTaskNotification,
} from '../bashTaskDeliveryOutcomes.js'
import {
  RemoteBackgroundShells,
  RemoteToolHosts,
  ToolStateSlots,
} from '../toolState.js'
import {
  disableBackgroundDeadline,
  getSessionBackgroundGates,
} from '../sessionBackgroundGates.js'
import { installBackgroundDeadline } from '../../tasks/LocalShellTask/LocalShellTask.js'
import type { AppState } from '../../state/AppState.js'
import { createTaskRegistry } from '../taskRegistry.js'
import { getMainThreadAgentId } from '../../bootstrap/state.js'
import type { Message } from '../../types/message.js'
import type { AgentId } from '../../types/ids.js'
import { createAssistantMessage, createUserMessage } from '../messages.js'
import {
  enqueuePendingNotification,
  getCommandQueue,
  resetCommandQueue,
} from '../messageQueueManager.js'

let originalInteractive: boolean
beforeEach(() => {
  originalInteractive = getBootstrapSessionHost().launchOptions.isInteractive()
})

afterEach(() => {
  getBootstrapSessionHost().launchOptions.replaceIsInteractive(
    originalInteractive,
  )
  resetBashTaskDeliveryForTests()
  resetCommandQueue()
  setUserPromptWaitingFor(getBootstrapSession(), undefined)
  setSessionWorking(getBootstrapSession(), false)
  getSessionBackgroundGates().backgroundDeadlineDisabled = false
})

function makeContext(opts?: {
  toolState?: ToolStateSlots
  tasks?: AppState['tasks']
  innerCall?: boolean
}) {
  const abortController = new AbortController()
  let state = { tasks: opts?.tasks ?? {}, transcripts: {} } as AppState
  const getAppState = () => state
  const setAppState = (updater: (prev: AppState) => AppState) => {
    state = updater(state)
  }
  return {
    abortController,
    messages: [] as Message[],
    innerCall: opts?.innerCall === true,
    toolState: opts?.toolState,
    // densable `Xm` — GetTask `Po(r, e.taskRegistry, s)`.
    taskRegistry: createTaskRegistry(getAppState, setAppState),
    getAppState,
    setAppState,
  }
}

describe('GetTask queued delivery withdrawal and abort restoration', () => {
  function queueDelivery(taskId = 'delivery-task', agentId?: AgentId) {
    enqueuePendingNotification({
      mode: 'task-notification',
      value: `Completed ${taskId}`,
      taskId,
      agentId,
      taskDelivery: { taskId, status: 'completed' },
    })
    getBashTaskDeliveryBag().withdrawShellNotification =
      withdrawQueuedBashTaskNotification
  }

  function resultPair(taskId = 'delivery-task', isError = false): Message[] {
    return [
      createAssistantMessage({
        content: [
          {
            type: 'tool_use',
            id: 'get-task-call',
            name: 'GetTask',
            input: { taskId },
          },
        ],
      }),
      createUserMessage({
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'get-task-call',
            content: JSON.stringify({ taskId, status: 'completed' }),
            is_error: isError,
          },
        ],
      }),
    ]
  }

  function liveContext() {
    return makeContext({
      tasks: {
        'delivery-task': {
          type: 'local_bash',
          id: 'delivery-task',
          status: 'killed',
          description: 'done',
          startTime: Date.now(),
          outputFile: '/tmp/gettask-delivery-output',
          outputOffset: 0,
          notified: false,
          command: 'sleep 9',
          completionStatusSentInAttachment: false,
          lastReportedTotalLines: 0,
          isBackgrounded: true,
          shellCommand: null,
        },
      },
    })
  }

  test('TaskStop retains a killed GetTask snapshot after polling removes its row', async () => {
    const original = snapshotModuleExports(growthbook)
    mock.module('src/services/analytics/growthbook.ts', () => ({
      ...original,
      getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) =>
        key === 'tengu_violin_rosin' ? true : fallback,
    }))
    const context = liveContext()
    context.taskRegistry.update('delivery-task', task => ({
      ...task,
      status: 'running',
    }))
    try {
      killTask('delivery-task', context.taskRegistry)
      expect(context.taskRegistry.get('delivery-task')).toMatchObject({
        status: 'killed',
        notified: true,
      })
      applyTaskOffsetsAndEvictions(context.setAppState, {}, ['delivery-task'])
      expect(context.taskRegistry.get('delivery-task')).toBeUndefined()
      expect(lookupBashTaskSnapshot('delivery-task')?.snapshot).toMatchObject({
        status: 'cancelled',
      })
      const result = await GetTaskTool.call(
        { taskId: 'delivery-task' },
        context as never,
      )
      expect(result.data).toMatchObject({ status: 'cancelled' })
      expect(getCommandQueue()).toHaveLength(0)
    } finally {
      mock.module('src/services/analytics/growthbook.ts', () => ({
        ...original,
      }))
    }
  })

  test('main-thread queue uses sticky owner while snapshots keep raw agentId', () => {
    queueDelivery()
    const owner = getMainThreadAgentId()
    expect(getCommandQueue()[0]?.agentId).toBe(owner)
    rememberBashTaskSnapshot('delivery-task', { status: 'completed' })
    expect(lookupBashTaskSnapshot('delivery-task')?.agentId).toBeUndefined()
    expect(
      lookupBashTaskSnapshot('delivery-task', owner)?.agentId,
    ).toBeUndefined()
    expect(
      lookupBashTaskSnapshot('delivery-task', 'another-agent'),
    ).toBeUndefined()
    rememberBashTaskSnapshot('sub-task', { status: 'completed' }, 'sub-agent')
    expect(lookupBashTaskSnapshot('sub-task')?.agentId).toBe('sub-agent')
    expect(lookupBashTaskSnapshot('sub-task', 'sub-agent')?.agentId).toBe(
      'sub-agent',
    )
    expect(lookupBashTaskSnapshot('sub-task', 'another-agent')).toBeUndefined()
    expect(
      withdrawQueuedBashTaskNotification('delivery-task', 'another-agent'),
    ).toBeUndefined()
    const restore = withdrawQueuedBashTaskNotification('delivery-task', owner)
    expect(getCommandQueue()).toHaveLength(0)
    restore?.()
    restore?.()
    expect(getCommandQueue()).toHaveLength(1)
    expect(getCommandQueue()[0]?.agentId).toBe(owner)
    const again = withdrawQueuedBashTaskNotification('delivery-task')
    expect(getCommandQueue()).toHaveLength(0)
    again?.()
    expect(getCommandQueue()).toHaveLength(1)
  })

  test('live registry task without settled snapshot does not withdraw queued notifications', async () => {
    queueDelivery()
    const context = liveContext()
    await GetTaskTool.call({ taskId: 'delivery-task' }, context as never)
    expect(getCommandQueue()).toHaveLength(1)
    expect(lookupBashTaskSnapshot('delivery-task')).toBeUndefined()
  })

  test('settled snapshot does not restore after paired non-error result enters context messages', async () => {
    queueDelivery()
    rememberBashTaskSnapshot('delivery-task', {
      taskId: 'delivery-task',
      status: 'completed',
      statusMessage: 'done',
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      result: { content: [{ type: 'text', text: 'ok' }], isError: false },
    })
    const context = makeContext()
    await GetTaskTool.call({ taskId: 'delivery-task' }, context as never)
    expect(getCommandQueue()).toHaveLength(0)
    context.messages = resultPair()
    context.abortController.abort()
    expect(getCommandQueue()).toHaveLength(0)
    expect(lookupBashTaskSnapshot('delivery-task')?.fetched).toBe(true)
  })

  test('settled snapshot does not restore after paired non-error result enters owner transcript', async () => {
    queueDelivery()
    rememberBashTaskSnapshot('delivery-task', {
      taskId: 'delivery-task',
      status: 'completed',
      statusMessage: 'done',
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      result: { content: [{ type: 'text', text: 'ok' }], isError: false },
    })
    const context = makeContext()
    await GetTaskTool.call({ taskId: 'delivery-task' }, context as never)
    context.taskRegistry.updateTranscript(getMainThreadAgentId(), prev => ({
      ...prev,
      messages: resultPair(),
    }))
    context.abortController.abort()
    expect(getCommandQueue()).toHaveLength(0)
    expect(lookupBashTaskSnapshot('delivery-task')?.fetched).toBe(true)
  })

  test('batch abort before paired tool_result restores notification, keepalive, and rolls back fetched', async () => {
    const owner = 'sub-owner' as AgentId
    queueDelivery('delivery-task', owner)
    rememberBashTaskSnapshot(
      'delivery-task',
      {
        taskId: 'delivery-task',
        status: 'completed',
        statusMessage: 'done',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        result: { content: [{ type: 'text', text: 'ok' }], isError: false },
      },
      owner,
    )
    const context = {
      ...makeContext({
        tasks: {
          [owner]: {
            id: owner,
            type: 'local_agent',
            status: 'running',
            retain: true,
            keepaliveReasons: new Set<string>(['bash:delivery-task']),
          } as unknown as AppState['tasks'][string],
        },
      }),
      agentId: owner,
    }
    context.messages = resultPair().slice(0, 1)
    await GetTaskTool.call({ taskId: 'delivery-task' }, context as never)
    expect(getCommandQueue()).toHaveLength(0)
    expect(lookupBashTaskSnapshot('delivery-task', owner)?.fetched).toBe(true)
    expect(
      (
        context.taskRegistry.get(owner) as { keepaliveReasons?: Set<string> }
      ).keepaliveReasons?.has('bash:delivery-task'),
    ).toBe(false)

    context.abortController.abort('sibling_error')
    expect(getCommandQueue()).toHaveLength(1)
    expect(lookupBashTaskSnapshot('delivery-task', owner)?.fetched).toBe(false)
    expect(
      (
        context.taskRegistry.get(owner) as { keepaliveReasons?: Set<string> }
      ).keepaliveReasons?.has('bash:delivery-task'),
    ).toBe(true)
  })

  test.each([
    'text',
    'pending',
    'error',
    'other-task',
    'unmatched-result',
    'other-tool',
    'other-call',
  ])('%s is not evidence of successful GetTask delivery; restore is idempotent', evidence => {
    queueDelivery()
    const pair = resultPair()
    if (evidence === 'other-tool' || evidence === 'other-call') {
      pair[0] = createAssistantMessage({
        content: [
          {
            type: 'tool_use',
            id: evidence === 'other-call' ? 'another-call' : 'get-task-call',
            name: evidence === 'other-tool' ? 'Bash' : 'GetTask',
            input: { taskId: 'delivery-task' },
          },
        ],
      })
    }
    const messages =
      evidence === 'text'
        ? [
            createUserMessage({
              content: 'GetTask delivery-task {"taskId":"delivery-task"}',
            }),
          ]
        : evidence === 'pending'
          ? pair.slice(0, 1)
          : evidence === 'error'
            ? resultPair('delivery-task', true)
            : evidence === 'other-task'
              ? resultPair('other-task')
              : evidence === 'unmatched-result'
                ? pair.slice(1)
                : pair
    const restore = withdrawQueuedBashTaskNotification(
      'delivery-task',
      undefined,
      undefined,
      () => messages,
    )
    expect(restore).toBeDefined()
    expect(getCommandQueue()).toHaveLength(0)
    restore?.()
    restore?.()
    expect(getCommandQueue()).toHaveLength(1)
  })
})

describe('densable 2.1.289 GetTask/Jbo live fire', () => {
  test('GetTask.call returns a remembered snapshot', async () => {
    const createdAt = new Date().toISOString()
    rememberBashTaskSnapshot('t1', {
      taskId: 't1',
      status: 'completed',
      statusMessage: 'done',
      createdAt,
      lastUpdatedAt: createdAt,
      result: {
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    })
    const result = await GetTaskTool.call(
      { taskId: 't1' },
      makeContext() as never,
    )
    expect(result.data).toMatchObject({
      taskId: 't1',
      status: 'completed',
    })
  })

  test('GetTask.call live-fires Po from taskRegistry', async () => {
    const startTime = Date.now()
    const result = await GetTaskTool.call(
      { taskId: 't-live' },
      makeContext({
        tasks: {
          't-live': {
            type: 'local_bash',
            id: 't-live',
            status: 'running',
            description: 'sleep',
            startTime,
            outputFile: '/tmp/out',
            outputOffset: 0,
            notified: false,
            command: 'sleep 9',
            completionStatusSentInAttachment: false,
            lastReportedTotalLines: 0,
            isBackgrounded: true,
            shellCommand: null,
          },
        },
      }) as never,
    )
    expect(result.data).toMatchObject({
      taskId: 't-live',
      status: 'working',
    })
  })

  test('GetTask.validateInput live-fires Po from taskRegistry', async () => {
    const startTime = Date.now()
    const ok = await GetTaskTool.validateInput(
      { taskId: 't-live' },
      makeContext({
        tasks: {
          't-live': {
            type: 'local_bash',
            id: 't-live',
            status: 'running',
            description: 'sleep',
            startTime,
            outputFile: '/tmp/out',
            outputOffset: 0,
            notified: false,
            command: 'sleep 9',
            completionStatusSentInAttachment: false,
            lastReportedTotalLines: 0,
            isBackgrounded: true,
            shellCommand: null,
          },
        },
      }) as never,
    )
    expect(ok).toMatchObject({ result: true })
    const denied = await GetTaskTool.validateInput(
      { taskId: 'missing' },
      makeContext() as never,
    )
    expect(denied).toMatchObject({ result: false, errorCode: 1 })
  })

  test('missing remote status reports the 16 completed-command retention copy', async () => {
    const toolState = new ToolStateSlots()
    toolState.get(RemoteBackgroundShells).started('remote-missing', {
      hostName: 'offline-desk',
      callId: 'offline-call',
    })
    await expect(
      GetTaskTool.call(
        { taskId: 'remote-missing' },
        makeContext({ toolState }) as never,
      ),
    ).rejects.toThrow('it keeps the last 16 that ended')
  })

  test('Jbo live-fires transport.call outcome_of', async () => {
    const toolState = new ToolStateSlots()
    toolState.get(RemoteBackgroundShells).started('t1', {
      hostName: 'desk',
      callId: 'call_1',
    })
    let called: { tool?: string; envelope?: Record<string, unknown> } = {}
    toolState.get(RemoteToolHosts).replaceRemoteHosts('bridge', [
      {
        source: 'bridge',
        name: 'desk',
        instanceId: 'i',
        transport: {
          call: async (toolName, _input, envelope) => {
            called = { tool: toolName, envelope }
            return {
              kind: 'result',
              envelope: {
                outcome: 'completed',
                output: {
                  background: {
                    state: 'exited',
                    ran_ms: 12,
                    exit_code: 0,
                    ended_ms_ago: 0,
                  },
                },
                content: 'remote-out',
              },
            }
          },
        },
      },
    ])
    const result = await GetTaskTool.call(
      { taskId: 't1' },
      makeContext({ toolState }) as never,
    )
    expect(called.tool).toBe('Bash')
    expect(called.envelope).toMatchObject({
      op: 'outcome_of',
      call_id: 'call_1',
    })
    expect(result.data).toMatchObject({
      taskId: 't1',
      status: 'completed',
      statusMessage: 'Exited on desk.',
    })
  })

  test('Jbo filters block.type === text and rejects missing content', async () => {
    const makeRemoteState = (content: unknown) => {
      const toolState = new ToolStateSlots()
      toolState.get(RemoteBackgroundShells).started('t-remote', {
        hostName: 'desk',
        callId: 'call_remote',
      })
      toolState.get(RemoteToolHosts).replaceRemoteHosts('bridge', [
        {
          source: 'bridge',
          name: 'desk',
          instanceId: 'i',
          transport: {
            call: async () => ({
              kind: 'result' as const,
              envelope: {
                outcome: 'completed' as const,
                output: {
                  background: {
                    state: 'exited',
                    ran_ms: 5,
                    exit_code: 0,
                    ended_ms_ago: 0,
                  },
                },
                ...(content !== undefined ? { content } : {}),
              },
            }),
          },
        },
      ])
      return toolState
    }

    const filtered = await GetTaskTool.call(
      { taskId: 't-remote' },
      makeContext({
        toolState: makeRemoteState([
          { type: 'text', text: 'hello ' },
          { type: 'other_block', text: 'MUST_NOT_APPEAR' },
          { type: 'text', text: 'world' },
        ]),
      }) as never,
    )
    const text = (
      filtered.data as {
        result: { content: Array<{ text: string }> }
      }
    ).result.content[0]?.text
    expect(text).toContain('hello world')
    expect(text).not.toContain('MUST_NOT_APPEAR')

    await expect(
      GetTaskTool.call(
        { taskId: 't-remote' },
        makeContext({ toolState: makeRemoteState(undefined) }) as never,
      ),
    ).rejects.toThrow('did not say what became of background command')
  })
})

describe('densable 2.1.289 xmn/Cvr live fire', () => {
  test('xmn Cvr kills a running backgrounded shell at the deadline', async () => {
    getBootstrapSessionHost().launchOptions.replaceIsInteractive(false)
    let app = {
      speculation: { status: 'idle' },
      tasks: {
        t1: {
          type: 'local_bash',
          status: 'running',
          notified: false,
          command: 'sleep 9',
          completionStatusSentInAttachment: false,
          lastReportedTotalLines: 0,
          isBackgrounded: true,
          shellCommand: {
            status: 'backgrounded',
            kill() {},
            cleanup() {},
          },
        },
      },
    } as unknown as AppState
    const setAppState = (f: (prev: AppState) => AppState) => {
      app = f(app)
    }
    const release = installBackgroundDeadline(
      't1',
      'sleep 9',
      createTaskRegistry(() => app, setAppState),
      undefined,
      'bash',
      undefined,
      40,
    )
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(app.tasks.t1?.status).toBe('killed')
    release()
  })

  test('Cvr re-checks gUr at fire and skips when deadline is disabled', async () => {
    getBootstrapSessionHost().launchOptions.replaceIsInteractive(false)
    let app = {
      speculation: { status: 'idle' },
      tasks: {
        t1: {
          type: 'local_bash',
          status: 'running',
          notified: false,
          command: 'sleep 9',
          completionStatusSentInAttachment: false,
          lastReportedTotalLines: 0,
          isBackgrounded: true,
          shellCommand: {
            status: 'backgrounded',
            kill() {},
            cleanup() {},
          },
        },
      },
    } as unknown as AppState
    const setAppState = (f: (prev: AppState) => AppState) => {
      app = f(app)
    }
    const release = installBackgroundDeadline(
      't1',
      'sleep 9',
      createTaskRegistry(() => app, setAppState),
      undefined,
      'bash',
      undefined,
      40,
    )
    disableBackgroundDeadline()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(app.tasks.t1?.status).toBe('running')
    release()
  })
})

describe('densable $en userPrompt waitingFor', () => {
  test('set/get/isWaiting round-trip on Se.of(session)', () => {
    const session = getBootstrapSession()
    expect(isUserPromptWaiting(session)).toBe(false)
    setUserPromptWaitingFor(session, 'permission')
    expect(getUserPromptWaitingFor(session)).toBe('permission')
    expect(isUserPromptWaiting(session)).toBe(true)
    setUserPromptWaitingFor(session, undefined)
    expect(isUserPromptWaiting(session)).toBe(false)
  })
})

describe('densable K3e/Fen working slot', () => {
  test('set/get identity-skip on Se.of(session)', () => {
    const session = getBootstrapSession()
    expect(isSessionWorking(session)).toBe(false)
    setSessionWorking(session, true)
    expect(isSessionWorking(session)).toBe(true)
    setSessionWorking(session, true)
    expect(isSessionWorking(session)).toBe(true)
    setSessionWorking(session, false)
    expect(isSessionWorking(session)).toBe(false)
  })
})

describe('densable V$n working subscribe', () => {
  test('subscribe fires on working change and unsubscribes', () => {
    const session = getBootstrapSession()
    const calls: boolean[] = []
    const unsubscribe = subscribeSessionWorking(session, () => {
      calls.push(isSessionWorking(session))
    })
    setSessionWorking(session, true)
    setSessionWorking(session, true)
    setSessionWorking(session, false)
    unsubscribe()
    setSessionWorking(session, true)
    expect(calls).toEqual([true, false])
  })
})

describe('densable GetTask hideRepeat render', () => {
  const REPEAT_MESSAGE = 'Repeated GetTask call; not answered again.'
  const REPEAT_ERROR = 'GetTask: the same call repeated within one response'
  const REPEAT_LONG =
    'GetTask was already answered 2 times for this task in this response (status: completed); the same call repeated within one response is not answered again.'

  test('renderToolUseMessage hides 4th+ repeat output while keeping 3rd call visible', () => {
    const hide = (toolUseResult: unknown) =>
      GetTaskTool.renderToolUseMessage(
        { taskId: 't1' },
        { verbose: false, isTranscriptMode: false, toolUseResult },
      )
    expect(hide(`Error: ${REPEAT_MESSAGE}`)).toBeNull()
    expect(hide(REPEAT_MESSAGE)).toBeNull()
    expect(hide({ content: `Error: ${REPEAT_MESSAGE}` })).toBeNull()
    expect(hide({ message: REPEAT_MESSAGE })).toBeNull()
    expect(hide(REPEAT_LONG)).toBe('t1')
    expect(hide(REPEAT_ERROR)).toBe('t1')
    expect(
      GetTaskTool.renderToolUseMessage(
        { taskId: 't1' },
        {
          verbose: true,
          isTranscriptMode: false,
          toolUseResult: `Error: ${REPEAT_MESSAGE}`,
        },
      ),
    ).toBe('t1')
    expect(
      GetTaskTool.renderToolUseMessage(
        { taskId: 't1' },
        {
          verbose: false,
          isTranscriptMode: true,
          toolUseResult: `Error: ${REPEAT_MESSAGE}`,
        },
      ),
    ).toBe('t1')
  })
})

describe('densable Xm taskRegistry', () => {
  test('get/all wrap appState.tasks', () => {
    const tasks = {
      a: { id: 'a', type: 'local_bash' },
    } as unknown as AppState['tasks']
    const registry = createTaskRegistry(
      () => ({ tasks }) as AppState,
      () => {},
    )
    expect(registry.get('a')).toBe(tasks.a)
    expect(registry.all()).toBe(tasks)
    expect(registry.get('missing')).toBeUndefined()
  })

  test('Xm takeConcurrencySlot writes runningSubagents', () => {
    let state = { tasks: {}, runningSubagents: 0 } as AppState
    const registry = createTaskRegistry(
      () => state,
      updater => {
        state = updater(state)
      },
    )
    const release = registry.takeConcurrencySlot()
    expect(registry.getConcurrentSubagents()).toBe(1)
    release()
    expect(registry.getConcurrentSubagents()).toBe(0)
  })
})
