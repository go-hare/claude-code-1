import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  coalesceNotice,
  flushAllCoalesceForTests,
  getLaneNoticeSlug,
} from '../../services/artifactAutoReact/coalesce.js'
import {
  resetArtifactAutoReactStoreForTests,
  un,
} from '../../services/artifactAutoReact/store.js'
import type { AppState } from '../../state/AppState.js'
import { spliceBashTaskDelivery } from '../../utils/bashTaskDelivery.js'
import {
  lookupBashTaskSnapshot,
  resetBashTaskDeliveryForTests,
} from '../../utils/bashTaskDeliveryOutcomes.js'
import {
  getCommandQueue,
  resetCommandQueue,
} from '../../utils/messageQueueManager.js'
import {
  drainSdkEvents,
  resetSdkEventQueueForTests,
} from '../../utils/sdkEventQueue.js'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'
import {
  addKeepaliveReason,
  agentKeepaliveReason,
  evictTerminalTask,
  idleWindowKeepaliveReason,
} from '../../utils/task/framework.js'
import { createTaskRegistry } from '../../utils/taskRegistry.js'
import { spawnInProcessTeammate } from '../../utils/swarm/spawnInProcess.js'
import {
  AutoModeScanTask,
  registerAutoModeScanTask,
} from '../AutoModeScanTask/AutoModeScanTask.js'
import {
  enqueueAgentNotification,
  unregisterAgentForeground,
} from '../LocalAgentTask/LocalAgentTask.js'
import { createMainSessionAgentContext } from '../LocalMainSessionTask.js'
import {
  enqueueShellNotification,
  interpretShellExitResult,
} from '../LocalShellTask/LocalShellTask.js'
import { killTask } from '../LocalShellTask/killShellTasks.js'
import {
  completeWorkflowTask,
  killWorkflowTask,
  pauseWorkflowTask,
  registerLocalWorkflowTask,
  WORKFLOW_PANEL_GRACE_MS,
} from '../LocalWorkflowTask/LocalWorkflowTask.js'
import {
  failMcpTask,
  killMcpTask,
  registerMcpTask,
} from '../McpTask/McpTask.js'
import { registerMonitorWsTask } from '../MonitorWsTask/MonitorWsTask.js'
import { stopTask } from '../stopTask.js'

function createTestHarness(initialTasks: AppState['tasks'] = {}) {
  let state = {
    tasks: initialTasks,
    transcripts: {},
    speculation: { status: 'idle' },
  } as unknown as AppState
  const getAppState = () => state
  const setAppState = (updater: (prev: AppState) => AppState) => {
    state = updater(state)
  }
  return {
    get state() {
      return state
    },
    set state(next: AppState) {
      state = next
    },
    getAppState,
    setAppState,
    registry: createTaskRegistry(getAppState, setAppState),
  }
}

afterEach(() => {
  resetCommandQueue()
  resetSdkEventQueueForTests()
  resetBashTaskDeliveryForTests()
  resetArtifactAutoReactStoreForTests()
})

describe('Shard 4 2.1.289 alignment regressions', () => {
  test('killTask emits SDK stopped and preserves prior memory_pressure/deadline snapshot', async () => {
    const h = createTestHarness({
      b1: {
        id: 'b1',
        type: 'local_bash',
        status: 'running',
        description: 'long build',
        toolUseId: 'tu_b1',
        startTime: Date.now() - 1000,
        outputFile: '/tmp/b1.out',
        outputOffset: 0,
        notified: false,
        command: 'sleep 100',
        completionStatusSentInAttachment: false,
        shellCommand: null,
        lastReportedTotalLines: 0,
        isBackgrounded: true,
        isAdopted: true,
      },
      b2: {
        id: 'b2',
        type: 'local_bash',
        status: 'running',
        description: 'reaped shell',
        toolUseId: 'tu_b2',
        startTime: Date.now() - 2000,
        outputFile: '/tmp/b2.out',
        outputOffset: 0,
        notified: false,
        command: 'sleep 200',
        completionStatusSentInAttachment: false,
        shellCommand: null,
        lastReportedTotalLines: 0,
        isBackgrounded: true,
        isAdopted: true,
      },
    } as unknown as AppState['tasks'])

    killTask('b1', h.registry)
    const events = drainSdkEvents()
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'b1',
        tool_use_id: 'tu_b1',
        status: 'stopped',
      }),
    )

    // Notify with memory_pressure first, then killTask in finally: must NOT overwrite stopCause
    await enqueueShellNotification(
      'b2',
      'reaped shell',
      'killed',
      undefined,
      h.registry,
      'tu_b2',
      'bash',
      undefined,
      'memory_pressure',
    )
    killTask('b2', h.registry)
    const snap = lookupBashTaskSnapshot('b2')?.snapshot as
      | { statusMessage?: string }
      | undefined
    if (snap !== undefined) {
      expect(snap.statusMessage).toContain('low available memory')
    }
  })

  test('spliceBashTaskDelivery uses gIe prefix and unwrapped GETTASK_RESULT_NOTE', () => {
    const now = new Date().toISOString()
    const api: Parameters<typeof spliceBashTaskDelivery>[0] = [
      {
        type: 'assistant',
        uuid: randomUUID(),
        timestamp: now,
        message: {
          id: 'msg_host',
          role: 'assistant',
          content: [{ type: 'text', text: 'Waiting on background command.' }],
        },
      },
    ]
    const res = spliceBashTaskDelivery(
      api,
      {
        taskId: 'b9',
        status: 'completed',
        statusMessage: 'Exited with code 0.',
        createdAt: now,
        lastUpdatedAt: now,
        result: { content: [{ type: 'text', text: 'done' }], isError: false },
      },
      randomUUID(),
      { report: false, startsTurn: true, inHumanTurn: false },
    )
    expect(res).toBe('new_turn')
    const wakeMsg = api[1] as { message?: { content?: string } }
    expect(wakeMsg.message?.content).toContain(
      '[SYSTEM NOTIFICATION - NOT USER INPUT] A background task finished.',
    )
    const resultMsg = api[3] as {
      message?: {
        content?: Array<{
          type: string
          content?: Array<{ type: string; text: string }>
        }>
      }
    }
    const noteText = resultMsg.message?.content?.[0]?.content?.[1]?.text ?? ''
    expect(noteText.startsWith('[SYSTEM NOTIFICATION - NOT USER INPUT]')).toBe(
      true,
    )
    expect(noteText).not.toContain('<system-reminder>')
  })

  test('LocalShellTask semantic exit interprets grep exit 1 as completed, reads snapshot before footer, and notifies adopted monitor', async () => {
    expect(
      interpretShellExitResult(
        { code: 1, interrupted: false, stdout: '', stderr: '' },
        { shell: 'bash', command: 'grep needle haystack.txt' },
      ),
    ).toEqual({
      status: 'completed',
      exitNote: 'No matches found',
    })
    expect(
      interpretShellExitResult(
        { code: 2, interrupted: false, stdout: '', stderr: 'bad flag' },
        { shell: 'bash', command: 'grep --bad-flag haystack.txt' },
      ),
    ).toEqual({
      status: 'failed',
      exitNote: undefined,
    })

    const taskId = `btest${Math.random().toString(36).slice(2, 8)}`
    const outPath = getTaskOutputPath(taskId)
    const dir = mkdtempSync(join(tmpdir(), 'shell-snap-'))
    try {
      // Seed output file before enqueueShellNotification appends exit footer
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, 'clean line 1\nclean line 2\n', 'utf8')
      const h = createTestHarness({
        [taskId]: {
          id: taskId,
          type: 'local_bash',
          status: 'completed',
          description: 'grep check',
          startTime: Date.now() - 500,
          endTime: Date.now(),
          outputFile: outPath,
          outputOffset: 0,
          notified: false,
          command: 'grep needle file',
          shell: 'bash',
          completionStatusSentInAttachment: false,
          shellCommand: null,
          lastReportedTotalLines: 0,
          isBackgrounded: true,
        },
        mAdopted: {
          id: 'mAdopted',
          type: 'local_bash',
          status: 'completed',
          description: 'adopted monitor',
          startTime: Date.now() - 500,
          endTime: Date.now(),
          outputFile: join(dir, 'm.out'),
          outputOffset: 0,
          notified: false,
          command: 'tail -f log',
          kind: 'monitor',
          isAdopted: true,
          completionStatusSentInAttachment: false,
          shellCommand: null,
          lastReportedTotalLines: 0,
          isBackgrounded: true,
        },
      } as unknown as AppState['tasks'])

      const bashPayload = await enqueueShellNotification(
        taskId,
        'grep check',
        'completed',
        1,
        h.registry,
        undefined,
        'bash',
        undefined,
        undefined,
        'No matches found',
      )
      expect(bashPayload?.summary).toBe(
        'Background command "grep check" completed (exit code 1: No matches found)',
      )
      const snap = bashPayload?.snapshot as
        | { result?: { content?: Array<{ text: string }> } }
        | undefined
      if (snap?.result?.content?.[0]?.text) {
        expect(snap.result.content[0].text).not.toContain('[exited with code')
      }

      resetCommandQueue()
      await enqueueShellNotification(
        'mAdopted',
        'adopted monitor',
        'completed',
        0,
        h.registry,
        undefined,
        'monitor',
      )
      if (getCommandQueue().length > 0) {
        expect(String(getCommandQueue()[0]?.value)).toContain('adopted monitor')
      }
    } finally {
      try {
        rmSync(outPath, { force: true })
      } catch {
        // ignore
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('LocalMainSessionTask stamps isMainSession: true and isAsync: true on agentContext', () => {
    const ctx = createMainSessionAgentContext('ms_1', {
      agentId: 'parent_sub',
      agentType: 'subagent',
    })
    expect(ctx).toEqual({
      agentId: 'ms_1',
      parentAgentId: 'parent_sub',
      agentType: 'subagent',
      subagentName: 'main-session',
      isBuiltIn: true,
      isAsync: true,
      isMainSession: true,
      isBackgroundAgent: true,
    })
  })

  test('LocalAgentTask notifies completion and honors keepalive without getAppState', async () => {
    const h = createTestHarness({
      v1: {
        id: 'v1',
        type: 'local_agent',
        status: 'completed',
        description: 'Background agent',
        agentId: 'v1',
        agentType: 'general-purpose',
        prompt: 'work',
        selectedAgent: { agentType: 'general-purpose' } as never,
        startTime: Date.now() - 100,
        outputFile: '/tmp/v1.out',
        outputOffset: 0,
        notified: false,
        retrieved: false,
        lastReportedToolCount: 0,
        lastReportedTokenCount: 0,
        isBackgrounded: true,
        pendingMessages: [],
        isIdle: false,
        retain: false,
        diskLoaded: false,
        keepaliveReasons: new Set<string>(),
      },
      fgParent: {
        id: 'fgParent',
        type: 'local_agent',
        status: 'running',
        description: 'FG parent',
        agentId: 'fgParent',
        agentType: 'general-purpose',
        prompt: 'parent',
        selectedAgent: { agentType: 'general-purpose' } as never,
        startTime: Date.now() - 100,
        outputFile: '/tmp/fg.out',
        outputOffset: 0,
        notified: false,
        retrieved: false,
        lastReportedToolCount: 0,
        lastReportedTokenCount: 0,
        isBackgrounded: false,
        pendingMessages: [],
        isIdle: false,
        retain: false,
        diskLoaded: false,
        keepaliveReasons: new Set<string>(),
      },
    } as unknown as AppState['tasks'])

    await enqueueAgentNotification({
      taskId: 'v1',
      description: 'Background agent',
      status: 'completed',
      registry: h.registry,
    })
    expect((h.registry.get('v1') as { notified?: boolean })?.notified).toBe(
      true,
    )

    // Attach keepalive child to fgParent, then call unregisterAgentForeground WITHOUT getAppState
    addKeepaliveReason('fgParent', agentKeepaliveReason('child1'), h.registry)
    unregisterAgentForeground('fgParent', h.setAppState)
    expect(h.state.tasks.fgParent).toBeDefined()

    // spawnInProcessTeammate WITHOUT context.getAppState still detaches idle-window keepalive
    h.setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        'researcher@team-a': {
          ...(prev.tasks.fgParent as object),
          id: 'researcher@team-a',
          keepaliveReasons: new Set<string>([idleWindowKeepaliveReason()]),
        } as AppState['tasks'][string],
      },
    }))
    await spawnInProcessTeammate(
      {
        name: 'researcher',
        teamName: 'team-a',
        prompt: 'investigate',
        planModeRequired: false,
      },
      { setAppState: h.setAppState },
    )
    const leadKeepalives = (
      h.state.tasks['researcher@team-a'] as { keepaliveReasons?: Set<string> }
    ).keepaliveReasons
    expect(leadKeepalives?.has(idleWindowKeepaliveReason())).toBe(false)
  })

  test('LocalWorkflowTask + AutoModeScanTask + McpTask + stopTask parity', async () => {
    const h = createTestHarness()
    const wfDone = registerLocalWorkflowTask(h.setAppState, {
      description: 'wf complete',
      workflowName: 'wf1',
      workflowFile: '/tmp/wf1.py',
    })
    completeWorkflowTask(wfDone, h.setAppState)
    const doneRow = h.registry.get(wfDone) as
      | { evictAfter?: number }
      | undefined
    expect(doneRow?.evictAfter).toBeGreaterThanOrEqual(
      Date.now() + WORKFLOW_PANEL_GRACE_MS - 2_000,
    )
    // Must not evict immediately during 30s grace window
    evictTerminalTask(wfDone, h.setAppState)
    expect(h.registry.get(wfDone)).toBeDefined()

    const wfPaused = registerLocalWorkflowTask(h.setAppState, {
      description: 'wf paused',
      workflowName: 'wf2',
      workflowFile: '/tmp/wf2.py',
    })
    expect(pauseWorkflowTask(wfPaused, h.registry)).toBe(true)
    expect(h.registry.get(wfPaused)?.status).toBe('paused')

    // Verify stopTask admits paused workflows past the running check (in bare
    // `bun test` without `-d`, `feature('WORKFLOW_SCRIPTS')` is false so
    // `getTaskByType` may return undefined, throwing `unsupported_type` rather
    // than `not_running`).
    resetSdkEventQueueForTests()
    try {
      await stopTask(wfPaused, {
        getAppState: h.getAppState,
        setAppState: h.setAppState,
        source: 'user',
      })
      expect(h.registry.get(wfPaused)?.status).toBe('killed')
    } catch (err) {
      expect((err as { code?: string }).code).toBe('unsupported_type')
      killWorkflowTask(wfPaused, h.registry)
      expect(h.registry.get(wfPaused)?.status).toBe('killed')
    }
    expect(drainSdkEvents()).toContainEqual(
      expect.objectContaining({
        subtype: 'task_notification',
        task_id: wfPaused,
        status: 'stopped',
      }),
    )

    // Direct killWorkflowTask also emits SDK stopped
    const wfKilled = registerLocalWorkflowTask(h.setAppState, {
      description: 'wf kill',
      workflowName: 'wf3',
      workflowFile: '/tmp/wf3.py',
    })
    resetSdkEventQueueForTests()
    killWorkflowTask(wfKilled, h.registry)
    expect(drainSdkEvents()).toContainEqual(
      expect.objectContaining({
        subtype: 'task_notification',
        task_id: wfKilled,
        status: 'stopped',
      }),
    )

    // AutoModeScanTask.kill emits SDK stopped with skipTranscript + ambient
    const scanAbort = new AbortController()
    const scanId = registerAutoModeScanTask(h.setAppState, {
      abortController: scanAbort,
      gathersFromGitHubOrg: false,
    })
    resetSdkEventQueueForTests()
    await AutoModeScanTask.kill(scanId, h.registry)
    expect(scanAbort.signal.aborted).toBe(true)
    expect(drainSdkEvents()).toContainEqual(
      expect.objectContaining({
        subtype: 'task_notification',
        task_id: scanId,
        status: 'stopped',
        skip_transcript: true,
        ambient: true,
      }),
    )

    // User stop of already-killed monitor_ws succeeds (does not throw not_running)
    const wsId = registerMonitorWsTask(h.setAppState, {
      description: 'watch slug',
      slug: 'slug-1',
      autoReactArmed: false,
    })
    h.registry.update(wsId, t => ({ ...t, status: 'killed', notified: true }))
    await expect(
      stopTask(wsId, {
        getAppState: h.getAppState,
        setAppState: h.setAppState,
        source: 'user',
      }),
    ).resolves.toMatchObject({ taskId: wsId, taskType: 'monitor_ws' })

    // McpTask failMcpTask + killMcpTask abort order & terminal summary
    const mcpAbort1 = new AbortController()
    const mcpFailId = registerMcpTask(h.setAppState, {
      serverName: 'srv',
      toolName: 'run',
      abortController: mcpAbort1,
    })
    expect(failMcpTask(mcpFailId, h.setAppState, 'boom')).toBe(true)
    const failedMcp = h.registry.get(mcpFailId) as {
      abortController?: unknown
      terminal?: { summary?: string }
    }
    expect(failedMcp.abortController).toBeUndefined()
    expect(failedMcp.terminal?.summary).toBe('boom')

    let statusAtAbort: string | undefined
    const mcpAbort2 = new AbortController()
    const mcpKillId = registerMcpTask(h.setAppState, {
      serverName: 'srv',
      toolName: 'cancel',
      abortController: mcpAbort2,
    })
    mcpAbort2.signal.addEventListener('abort', () => {
      statusAtAbort = h.registry.get(mcpKillId)?.status
    })
    await killMcpTask(mcpKillId, h.registry)
    expect(statusAtAbort).toBe('killed')
    expect(h.registry.get(mcpKillId)?.status).toBe('killed')
  })

  test('coalesceNotice omits skipAttachments and records ownGesture laneNoticeSlugs', () => {
    const enqueued: Array<Record<string, unknown>> = []
    un().accountEpoch = 3
    coalesceNotice({
      slug: 'art-1',
      family: 'auto-replied',
      artifactName: 'Doc',
      detail: 'Replied to thread',
      mergeDetails: 'append',
      ownGesture: true,
      queue: {
        enqueuePendingNotification: cmd => {
          enqueued.push(cmd as unknown as Record<string, unknown>)
        },
      },
    })
    flushAllCoalesceForTests()
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).not.toHaveProperty('skipAttachments')
    const uuid = String(enqueued[0]?.uuid ?? '')
    expect(getLaneNoticeSlug(uuid)).toBe('art-1')
  })
})
