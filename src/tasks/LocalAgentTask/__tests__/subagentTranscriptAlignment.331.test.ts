import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveViewedTask } from 'src/components/PromptInput/viewedAgent.js'
import type { AppState } from 'src/state/AppState.js'
import {
  enterTeammateView,
  exitTeammateView,
} from 'src/state/teammateViewHelpers.js'
import {
  appendTeammateMessage,
  injectUserMessageToTeammate,
} from 'src/tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import type { InProcessTeammateTaskState } from 'src/tasks/InProcessTeammateTask/types.js'
import {
  completeMainSessionTask,
  foregroundMainSessionTask,
  type LocalMainSessionTaskState,
} from 'src/tasks/LocalMainSessionTask.js'
import { asAgentId } from 'src/types/ids.js'
import type { Message } from 'src/types/message.js'
import { createUserMessage } from 'src/utils/messages.js'
import { extractTeammateTranscriptsFromTasks } from 'src/utils/sessionStorage.js'
import {
  applyTaskOffsetsAndEvictions,
  evictTerminalTask,
  registerTask,
} from 'src/utils/task/framework.js'
import {
  appendTranscriptMessage,
  applyMessageToInProgressToolUseIDs,
  clearTaskTranscriptInProgressToolUseIDs,
  createTaskRegistry,
  mergeDiskAndLiveTranscriptMessages,
  seedTaskTranscriptMessages,
  setTaskTranscriptTurnStart,
  updateTaskTranscriptMessage,
} from 'src/utils/taskRegistry.js'
import {
  appendMessageToLocalAgent,
  clearAllIdleWindowTimersForTests,
  completeAgentTask,
  failAgentTask,
  killAsyncAgent,
  type LocalAgentTaskState,
  unregisterAgentForeground,
} from '../LocalAgentTask.js'

function makeStateHarness(initial?: Partial<AppState>) {
  let state = {
    tasks: {},
    transcripts: {},
    viewingAgentTaskId: undefined,
    viewSelectionMode: 'none',
    agentNameRegistry: new Map(),
    ...initial,
  } as unknown as AppState

  const setAppState = (updater: (prev: AppState) => AppState) => {
    state = updater(state)
  }
  const getAppState = () => state
  const registry = createTaskRegistry(getAppState, setAppState)
  return { getAppState, setAppState, registry }
}

function makeRunningLocalAgent(
  id: string,
  overrides: Partial<LocalAgentTaskState> = {},
): LocalAgentTaskState {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    description: 'named ping agent',
    startTime: Date.now(),
    outputFile: `/tmp/${id}.output`,
    outputOffset: 0,
    notified: false,
    agentId: id,
    prompt: 'reply PONG',
    selectedAgent: {
      agentType: 'general-purpose',
      whenToUse: 'test',
      getSystemPrompt: () => '',
      source: 'built-in',
      baseDir: 'built-in',
    },
    agentType: 'general-purpose',
    abortController: new AbortController(),
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    pendingMessages: [],
    isIdle: false,
    keepaliveReasons: new Set(),
    retain: false,
    diskLoaded: false,
    ...overrides,
  }
}

function makeAssistantMessage(
  uuid: string,
  text: string,
  toolUses: Array<{ id: string; name: string }> = [],
): Message {
  const content: Array<Record<string, unknown>> = []
  if (text) content.push({ type: 'text', text })
  for (const tu of toolUses) {
    content.push({ type: 'tool_use', id: tu.id, name: tu.name, input: {} })
  }
  return {
    type: 'assistant',
    uuid: uuid as Message['uuid'],
    message: {
      id: `msg_${uuid}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content,
      stop_reason: toolUses.length > 0 ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    requestId: `req_${uuid}`,
  } as unknown as Message
}

function makeToolResultMessage(uuid: string, toolUseId: string): Message {
  return {
    type: 'user',
    uuid: uuid as Message['uuid'],
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }],
    },
  } as unknown as Message
}

describe('Official 2.1.331 subagent transcript alignment (AppState.transcripts)', () => {
  afterEach(() => {
    clearAllIdleWindowTimersForTests()
  })

  test('completeAgentTask preserves viewed transcript messages across Turn 1 -> complete -> SendMessage resume -> Turn 2 -> complete', () => {
    const agentId = 'a4dd87cb9038f6107'
    const { getAppState, setAppState, registry } = makeStateHarness()

    // Turn 1: launch + seed initial prompt
    const task1 = makeRunningLocalAgent(agentId)
    registerTask(task1, setAppState)
    const prompt1 = createUserMessage({
      content: 'Reply with PONG from named agent ping',
    })
    seedTaskTranscriptMessages(agentId, [prompt1], setAppState)

    // User opens subagent view
    enterTeammateView(agentId, setAppState)
    expect(getAppState().viewingAgentTaskId).toBe(agentId)
    expect((getAppState().tasks[agentId] as LocalAgentTaskState).retain).toBe(
      true,
    )

    // Turn 1 streams a tool_use, then tool_result, then final reply
    const asstTool = makeAssistantMessage('asst-1-tool', '', [
      { id: 'tu-1', name: 'Read' },
    ])
    updateTaskTranscriptMessage(agentId, asstTool, setAppState)
    expect(
      getAppState().transcripts[agentId]?.inProgressToolUseIDs.has('tu-1'),
    ).toBe(true)
    expect(
      getAppState().transcripts[agentId]?.toolWindowStartTime,
    ).toBeDefined()

    updateTaskTranscriptMessage(
      agentId,
      makeToolResultMessage('tr-1', 'tu-1'),
      setAppState,
    )
    expect(getAppState().transcripts[agentId]?.inProgressToolUseIDs.size).toBe(
      0,
    )

    const asstReply1 = makeAssistantMessage(
      'asst-1-reply',
      'PONG from named agent ping',
    )
    updateTaskTranscriptMessage(agentId, asstReply1, setAppState)

    // Turn 1 completes — MUST NOT wipe transcript while viewing (the root bug!)
    completeAgentTask(
      {
        agentId,
        content: [{ type: 'text', text: 'PONG from named agent ping' }],
        totalToolUseCount: 1,
        totalDurationMs: 2500,
        totalTokens: 500,
      } as never,
      registry,
    )

    expect(getAppState().tasks[agentId]?.status).toBe('completed')
    expect(getAppState().viewingAgentTaskId).toBe(agentId)
    expect(
      getAppState().transcripts[agentId]?.messages.map(m => String(m.uuid)),
    ).toEqual([String(prompt1.uuid), 'asst-1-tool', 'tr-1', 'asst-1-reply'])

    // SendMessage resumes Turn 2: registerTask carries retain, appendMessageToLocalAgent mirrors prompt
    const task2 = makeRunningLocalAgent(agentId)
    registerTask(task2, setAppState)
    const prompt2 = createUserMessage({
      content: 'Now send SENDMESSAGE_OK back to main',
    })
    appendMessageToLocalAgent(agentId, prompt2, setAppState)

    const asstReply2 = makeAssistantMessage(
      'asst-2-reply',
      'SENDMESSAGE_OK from ping',
    )
    updateTaskTranscriptMessage(agentId, asstReply2, setAppState)

    // Turn 2 completes — ALL messages from Turn 1 + Turn 2 remain visible
    completeAgentTask(
      {
        agentId,
        content: [{ type: 'text', text: 'SENDMESSAGE_OK from ping' }],
        totalToolUseCount: 2,
        totalDurationMs: 18000,
        totalTokens: 991,
      } as never,
      registry,
    )

    expect(
      getAppState().transcripts[agentId]?.messages.map(m => String(m.uuid)),
    ).toEqual([
      String(prompt1.uuid),
      'asst-1-tool',
      'tr-1',
      'asst-1-reply',
      String(prompt2.uuid),
      'asst-2-reply',
    ])

    // User exits view -> retain dropped, evictAfter scheduled, transcript stays until eviction
    exitTeammateView(setAppState)
    expect(getAppState().viewingAgentTaskId).toBeUndefined()
    const released = getAppState().tasks[agentId] as LocalAgentTaskState
    expect(released.retain).toBe(false)
    expect(released.diskLoaded).toBe(false)
    expect(released.evictAfter).toBeDefined()
    expect(getAppState().transcripts[agentId]?.messages.length).toBe(6)

    // Eviction frees BOTH task and transcript once notified + grace expired
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        [agentId]: { ...released, notified: true, evictAfter: Date.now() - 1 },
      },
    }))
    evictTerminalTask(agentId, setAppState)
    expect(getAppState().tasks[agentId]).toBeUndefined()
    expect(getAppState().transcripts[agentId]).toBeUndefined()
  })

  test('failAgentTask and killAsyncAgent preserve transcript messages and clear inProgressToolUseIDs', () => {
    const { getAppState, setAppState, registry } = makeStateHarness()

    const failId = 'agent-fail'
    registerTask(makeRunningLocalAgent(failId, { retain: true }), setAppState)
    updateTaskTranscriptMessage(
      failId,
      makeAssistantMessage('f-1', '', [{ id: 'tu-f', name: 'Bash' }]),
      setAppState,
    )
    expect(
      getAppState().transcripts[failId]?.inProgressToolUseIDs.has('tu-f'),
    ).toBe(true)

    failAgentTask(failId, 'network timeout', registry)
    expect(getAppState().tasks[failId]?.status).toBe('failed')
    expect(
      getAppState().transcripts[failId]?.messages.map(m => String(m.uuid)),
    ).toEqual(['f-1'])
    expect(getAppState().transcripts[failId]?.inProgressToolUseIDs.size).toBe(0)

    const killId = 'agent-kill'
    registerTask(makeRunningLocalAgent(killId, { retain: true }), setAppState)
    updateTaskTranscriptMessage(
      killId,
      makeAssistantMessage('k-1', '', [{ id: 'tu-k', name: 'Bash' }]),
      setAppState,
    )
    killAsyncAgent(killId, registry, 'user')
    expect(getAppState().tasks[killId]?.status).toBe('killed')
    expect(
      getAppState().transcripts[killId]?.messages.map(m => String(m.uuid)),
    ).toEqual(['k-1'])
    expect(getAppState().transcripts[killId]?.inProgressToolUseIDs.size).toBe(0)
  })

  test('updateTaskTranscriptMessage populates transcript even before retain (foreground / mid-bg / early spawn)', () => {
    const agentId = 'fg-agent-1'
    const { getAppState, setAppState } = makeStateHarness()
    registerTask(
      makeRunningLocalAgent(agentId, { isBackgrounded: false, retain: false }),
      setAppState,
    )

    const m1 = makeAssistantMessage('fg-m1', 'working in foreground')
    const apiErr = {
      type: 'system',
      subtype: 'api_error',
      uuid: 'err-1',
    } as unknown as Message
    updateTaskTranscriptMessage(agentId, m1, setAppState)
    updateTaskTranscriptMessage(agentId, apiErr, setAppState)

    // api_error skipped, real message present even though retain was false
    expect(
      getAppState().transcripts[agentId]?.messages.map(m => String(m.uuid)),
    ).toEqual(['fg-m1'])

    // User switches to view the running foreground task, then it finishes
    enterTeammateView(agentId, setAppState)
    expect(getAppState().viewingAgentTaskId).toBe(agentId)

    unregisterAgentForeground(agentId, setAppState, getAppState)
    expect(getAppState().tasks[agentId]).toBeUndefined()
    expect(getAppState().transcripts[agentId]).toBeUndefined()
    expect(getAppState().viewingAgentTaskId).toBeUndefined()
    expect(getAppState().viewSelectionMode).toBe('none')
  })

  test('appendTranscriptMessage handles Dfr UUID dedup and $s queued_command source_uuid replacement', () => {
    const humanPrompt = createUserMessage({
      content: 'follow up question',
      origin: { kind: 'human' },
    })
    const m1 = makeAssistantMessage('a-1', 'first reply')
    const list1 = appendTranscriptMessage([humanPrompt], m1)
    expect(list1.map(m => String(m.uuid))).toEqual([
      String(humanPrompt.uuid),
      'a-1',
    ])

    // queued_command attachment replaces humanPrompt UUID in place (no duplicate bubble)
    const queuedAttachment = {
      type: 'attachment',
      uuid: 'queued-uuid-99',
      attachment: {
        type: 'queued_command',
        source_uuid: humanPrompt.uuid,
      },
    } as unknown as Message
    const list2 = appendTranscriptMessage(list1, queuedAttachment)
    expect(list2.length).toBe(2)
    expect(String(list2[0]?.uuid)).toBe('queued-uuid-99')
    expect(list2[0]?.type).toBe('user')

    // Dfr UUID dedup replaces/moves existing UUID to tail
    const m1Updated = makeAssistantMessage('a-1', 'updated reply')
    const list3 = appendTranscriptMessage(list2, m1Updated)
    expect(list3.map(m => String(m.uuid))).toEqual(['queued-uuid-99', 'a-1'])
    expect(
      (list3[1] as { message: { content: Array<{ text: string }> } }).message
        .content[0]?.text,
    ).toBe('updated reply')
  })

  test('mergeDiskAndLiveTranscriptMessages preserves disk prefix order, prefers live refs, appends live tail', () => {
    const d1 = makeAssistantMessage('u1', 'disk-1')
    const d2 = makeAssistantMessage('u2', 'disk-2')
    const l2 = makeAssistantMessage('u2', 'live-2')
    const l3 = makeAssistantMessage('u3', 'live-3')

    const merged = mergeDiskAndLiveTranscriptMessages([d1, d2], [l2, l3])
    expect(merged.map(m => String(m.uuid))).toEqual(['u1', 'u2', 'u3'])
    expect(merged[1]).toBe(l2)
  })

  test('applyMessageToInProgressToolUseIDs and clearTaskTranscriptInProgressToolUseIDs manage active tools', () => {
    const empty = new Set<string>()
    const res1 = applyMessageToInProgressToolUseIDs(
      empty,
      makeAssistantMessage('m1', '', [{ id: 'tool-a', name: 'Read' }]),
    )
    expect(res1?.inProgressToolUseIDs.has('tool-a')).toBe(true)
    expect(typeof res1?.toolWindowStartTime).toBe('number')

    const res2 = applyMessageToInProgressToolUseIDs(
      res1!.inProgressToolUseIDs,
      makeToolResultMessage('m2', 'tool-a'),
    )
    expect(res2?.inProgressToolUseIDs.size).toBe(0)
    expect(res2?.toolWindowStartTime).toBeUndefined()

    const { getAppState, setAppState } = makeStateHarness()
    updateTaskTranscriptMessage(
      't-clear',
      makeAssistantMessage('m3', '', [{ id: 'tool-b', name: 'Bash' }]),
      setAppState,
    )
    expect(
      getAppState().transcripts['t-clear']?.inProgressToolUseIDs.size,
    ).toBe(1)
    clearTaskTranscriptInProgressToolUseIDs('t-clear', setAppState)
    expect(
      getAppState().transcripts['t-clear']?.inProgressToolUseIDs.size,
    ).toBe(0)
  })

  test('exitTeammateView release respects chatEngaged and keepaliveReasons before setting evictAfter', () => {
    const id = 'engaged-agent'
    const { getAppState, setAppState } = makeStateHarness()
    registerTask(
      makeRunningLocalAgent(id, {
        status: 'completed',
        retain: true,
        chatEngaged: true,
      }),
      setAppState,
    )
    enterTeammateView(id, setAppState)
    exitTeammateView(setAppState)
    const after = getAppState().tasks[id] as LocalAgentTaskState
    expect(after.retain).toBe(false)
    expect(after.evictAfter).toBeUndefined()
  })

  test('getAgentTranscript awaits in-flight recordSidechainTranscript and flushes queued writes before reading disk', async () => {
    const tempProjectDir = mkdtempSync(join(tmpdir(), 'subagent-tr-flush-'))
    const sessionStorage = await import('src/utils/sessionStorage.js')
    const bootstrapState = await import('src/bootstrap/state.js')
    const prevSessionId = bootstrapState.getSessionId()
    const prevProjectDir = bootstrapState.getSessionProjectDir()
    const prevPersistenceDisabled =
      bootstrapState.isSessionPersistenceDisabled()
    const prevNodeEnv = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      bootstrapState.setSessionPersistenceDisabled(false)
      bootstrapState.switchSession(
        '11111111-2222-4333-8444-555555555555' as never,
        tempProjectDir,
      )

      const agentId = asAgentId('flushrace001')
      const initialPrompt = createUserMessage({
        content: 'hello from fresh subagent',
      })

      // Fire-and-forget just like runAgent.ts:2192
      void sessionStorage.recordSidechainTranscript([initialPrompt], agentId)

      // Immediately read without manual sleep/flush — must NOT race ENOENT
      const loaded = await sessionStorage.getAgentTranscript(agentId)
      expect(loaded).not.toBeNull()
      expect(loaded!.messages.map(m => m.uuid)).toContain(initialPrompt.uuid)

      // Aborted signal returns null immediately
      const ac = new AbortController()
      ac.abort()
      const aborted = await sessionStorage.getAgentTranscript(agentId, {
        signal: ac.signal,
      })
      expect(aborted).toBeNull()
    } finally {
      await sessionStorage.flushSessionStorage().catch(() => {})
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      bootstrapState.setSessionPersistenceDisabled(prevPersistenceDisabled)
      bootstrapState.switchSession(prevSessionId, prevProjectDir)
      rmSync(tempProjectDir, { recursive: true, force: true })
    }
  })

  test('setTaskTranscriptTurnStart stamps turnStartTime and avoids redundant writes', () => {
    const { getAppState, setAppState } = makeStateHarness()
    const t0 = 1_700_000_000_000
    setTaskTranscriptTurnStart('agent-ts', t0, setAppState)
    expect(getAppState().transcripts['agent-ts']?.turnStartTime).toBe(t0)
    const refBefore = getAppState()
    setTaskTranscriptTurnStart('agent-ts', t0, setAppState)
    expect(getAppState()).toBe(refBefore)
  })

  test('InProcessTeammateTask writes AppState.transcripts so resolveViewedTask sees messages and active tools', () => {
    const taskId = 'tm-task-1'
    const teammate: InProcessTeammateTaskState = {
      id: taskId,
      type: 'in_process_teammate',
      status: 'running',
      description: 'researcher',
      startTime: Date.now(),
      outputFile: '/tmp/tm-1.out',
      outputOffset: 0,
      notified: false,
      identity: {
        agentId: 'researcher@team',
        agentName: 'researcher',
        teamName: 'team',
        planModeRequired: false,
        parentSessionId: 'parent-sess-1',
      },
      prompt: 'investigate',
      model: 'claude-sonnet-4-6',
      abortController: new AbortController(),
      awaitingPlanApproval: false,
      permissionMode: 'default',
      isIdle: false,
      shutdownRequested: false,
      lastReportedToolCount: 0,
      lastReportedTokenCount: 0,
      pendingUserMessages: [],
      evictAfter: Date.now() + 30_000,
    }
    const { getAppState, setAppState } = makeStateHarness({
      tasks: { [taskId]: teammate },
    })

    // Enter view clears evictAfter on in_process_teammate too (official K4)
    enterTeammateView(taskId, setAppState)
    expect(
      (getAppState().tasks[taskId] as InProcessTeammateTaskState).evictAfter,
    ).toBeUndefined()

    // Inject user prompt + append assistant tool_use → mirrored into AppState.transcripts
    expect(
      injectUserMessageToTeammate(taskId, 'check logs', undefined, setAppState),
    ).toBe(true)
    appendTeammateMessage(
      taskId,
      makeAssistantMessage('tm-a1', '', [{ id: 'tm-tu1', name: 'Read' }]),
      setAppState,
    )

    const resolved = resolveViewedTask({
      viewingAgentTaskId: taskId,
      tasks: getAppState().tasks,
      transcripts: getAppState().transcripts,
      mainIsBusy: false,
      mainConversationId: 'main-conv',
    })
    expect(resolved.isTeammate).toBe(true)
    expect(resolved.messages.length).toBe(2)
    expect(resolved.inProgressToolUseIDs.has('tm-tu1')).toBe(true)

    // extractTeammateTranscriptsFromTasks reads from AppState.transcripts first
    const extracted = extractTeammateTranscriptsFromTasks(
      getAppState().tasks as never,
      getAppState().transcripts,
    )
    expect(extracted['researcher@team']?.length).toBe(2)

    // Completed teammate must NOT be evicted while actively viewed
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...(prev.tasks[taskId] as InProcessTeammateTaskState),
          status: 'completed',
          notified: true,
          isIdle: true,
        },
      },
    }))
    evictTerminalTask(taskId, setAppState)
    applyTaskOffsetsAndEvictions(setAppState, {}, [taskId])
    expect(getAppState().tasks[taskId]).toBeDefined()
    expect(getAppState().transcripts[taskId]).toBeDefined()

    // Exit view schedules 30s evictAfter grace (official q4 / p$t); stays during grace
    exitTeammateView(setAppState)
    const afterExit = getAppState().tasks[taskId] as InProcessTeammateTaskState
    expect(afterExit.evictAfter).toBeGreaterThan(Date.now())
    evictTerminalTask(taskId, setAppState)
    expect(getAppState().tasks[taskId]).toBeDefined()

    // Once grace expires, evictTerminalTask frees BOTH task and transcript
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: { ...afterExit, evictAfter: Date.now() - 1 },
      },
    }))
    evictTerminalTask(taskId, setAppState)
    expect(getAppState().tasks[taskId]).toBeUndefined()
    expect(getAppState().transcripts[taskId]).toBeUndefined()
  })

  test('LocalMainSessionTask keeps full AppState.transcripts while viewed and foreground reads from transcripts', () => {
    const taskId = 's-main-bg-1'
    const mainTask = makeRunningLocalAgent(taskId, {
      agentType: 'main-session',
    }) as LocalMainSessionTaskState
    const { getAppState, setAppState } = makeStateHarness({
      tasks: { [taskId]: mainTask },
    })

    const m1 = createUserMessage({ content: 'prompt 1' })
    const m2 = makeAssistantMessage('bg-a1', 'reply 1', [
      { id: 'bg-tu1', name: 'Bash' },
    ])
    seedTaskTranscriptMessages(taskId, [m1], setAppState)
    updateTaskTranscriptMessage(taskId, m2, setAppState)

    // Viewing when it completes preserves full transcript and clears active tools
    enterTeammateView(taskId, setAppState)
    completeMainSessionTask(taskId, true, setAppState)
    expect(getAppState().tasks[taskId]?.status).toBe('completed')
    expect(
      getAppState().transcripts[taskId]?.messages.map(m => String(m.uuid)),
    ).toEqual([String(m1.uuid), 'bg-a1'])
    expect(getAppState().transcripts[taskId]?.inProgressToolUseIDs.size).toBe(0)

    // foregroundMainSessionTask reads messages from AppState.transcripts
    const fgMessages = foregroundMainSessionTask(taskId, setAppState)
    expect(fgMessages?.map(m => String(m.uuid))).toEqual([
      String(m1.uuid),
      'bg-a1',
    ])
  })
})
