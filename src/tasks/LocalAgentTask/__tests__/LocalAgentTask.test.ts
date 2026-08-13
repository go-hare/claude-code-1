import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realBootstrapState from '../../../bootstrap/state.js'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realMessageQueue from 'src/utils/messageQueueManager.js'
import { createMessageQueueManagerMock } from '../../../../tests/mocks/messageQueueManager.js'

// ─── Mocks ───

const noop = () => {}

// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
const bootstrapSnap = snapshotModuleExports(realBootstrapState)
const diskOutputSnap = snapshotModuleExports(realDiskOutput)
// Snapshot BEFORE mock — live namespace rebinds under Bun; afterAll must restore
// the pre-mock plain object, not the live rebinding.
const mqmSnap = snapshotModuleExports(realMessageQueue)

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

// Snapshot BEFORE mock — incomplete sessionStorage strip breaks resume/metadata co-suites.
const realSessionStorage = await import('src/utils/sessionStorage.js')
const sessionStorageSnap = snapshotModuleExports(realSessionStorage)
mock.module('src/utils/sessionStorage.js', () => ({
  ...sessionStorageSnap,
  getAgentTranscriptPath: (id: string) => `/tmp/transcripts/${id}.jsonl`,
  isTranscriptPersistenceDisabled: () => false,
  recordSidechainTranscript: async () => {},
  recordQueueOperation: noop,
  writeAgentMetadata: async () => {},
  readAgentMetadata: async () => null,
  patchAgentMetadata: async (_id: string, patch: Record<string, unknown>) => ({
    agentType: 'unknown',
    ...patch,
  }),
}))

// Spread pre-mock diskOutput snapshot so DiskTaskOutput and other named exports
// stay intact for sibling suites (process-global mock.module pollution).
function diskOutputMock() {
  return {
    ...diskOutputSnap,
    evictTaskOutput: noop,
    getTaskOutputPath: (id: string) => `/tmp/output/${id}`,
    initTaskOutput: async () => {},
    initTaskOutputAsSymlink: async () => {},
    getTaskOutputDelta: async () => null,
  }
}
mock.module('src/utils/task/diskOutput.js', diskOutputMock)
mock.module('../../utils/task/diskOutput.js', diskOutputMock)

// Capture enqueuePendingNotification calls for verification.
// Call through to the real queue — never stub hasCommandsInQueue/enqueue/reset.
// Bun mock.module is process-global; empty stubs break SleepTool co-suites
// (static enqueue vs runtime hasCommandsInQueue on different stores).
const enqueuedNotifications: string[] = []
const realEnqueuePendingNotification =
  realMessageQueue.enqueuePendingNotification
mock.module(
  'src/utils/messageQueueManager.js',
  createMessageQueueManagerMock(realMessageQueue, {
    enqueuePendingNotification: (cmd: any) => {
      enqueuedNotifications.push(
        typeof cmd.value === 'string' ? cmd.value : String(cmd.value),
      )
      realEnqueuePendingNotification(cmd)
    },
  }),
)

// Snapshot bootstrap so getSessionId stays defined for Agent Teams co-suites.
function bootstrapStateMock() {
  return {
    ...bootstrapSnap,
    getSdkAgentProgressSummariesEnabled: () => false,
    getSessionId: () => 'test-session-001',
    getProjectRoot: () => '/test/project',
    getOriginalCwd: () => '/test/project',
    getCwdState: () => '/test/project',
    getIsNonInteractiveSession: () => false,
    getAllowedSettingSources: () => ['user', 'project', 'local'],
    getFlagSettingsPath: () => undefined,
    getFlagSettingsInline: () => null,
    setCwdState: noop,
    waitForScrollIdle: async () => {},
    addSlowOperation: noop,
  }
}
mock.module('src/bootstrap/state.js', bootstrapStateMock)
mock.module('../../bootstrap/state.js', bootstrapStateMock)
afterAll(() => {
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/utils/task/diskOutput.js', () => ({ ...diskOutputSnap }))
  mock.module('../../utils/task/diskOutput.js', () => ({ ...diskOutputSnap }))
  // Restore real messageQueueManager for co-suites (process-global mock.module).
  mock.module('src/utils/messageQueueManager.js', () => ({ ...mqmSnap }))
  mock.module('src/utils/sessionStorage.js', () => ({ ...sessionStorageSnap }))
  mock.module('src/utils/sdkEventQueue.js', () => ({ ...sdkEventQueueSnap }))
})

mock.module('src/services/PromptSuggestion/speculation.js', () => ({
  abortSpeculation: noop,
}))

const cleanupFns: (() => void)[] = []
mock.module('src/utils/cleanupRegistry.js', () => ({
  registerCleanup: () => noop,
}))

mock.module('src/utils/abortController.js', () => ({
  createAbortController: () => new AbortController(),
  createChildAbortController: (parent: AbortController) => {
    const ac = new AbortController()
    parent.signal.addEventListener('abort', () => ac.abort())
    return ac
  },
}))

mock.module('src/utils/task/sdkProgress.js', () => ({
  emitTaskProgress: noop,
}))

// Spread real sdkEventQueue + restore in afterAll — incomplete strip empties
// workflow notifications co-suite under process-global mock.module.
const realSdkEventQueue = await import('src/utils/sdkEventQueue.js')
const sdkEventQueueSnap = snapshotModuleExports(realSdkEventQueue)
mock.module('src/utils/sdkEventQueue.js', () => ({
  ...sdkEventQueueSnap,
  enqueueSdkEvent: noop,
}))

mock.module('src/constants/xml.js', () => ({
  TASK_NOTIFICATION_TAG: 'task_notification',
  TASK_ID_TAG: 'task_id',
  TOOL_USE_ID_TAG: 'tool_use_id',
  OUTPUT_FILE_TAG: 'output_file',
  STATUS_TAG: 'status',
  SUMMARY_TAG: 'summary',
  WORKTREE_TAG: 'worktree',
  WORKTREE_PATH_TAG: 'worktree_path',
  WORKTREE_BRANCH_TAG: 'worktree_branch',
  TASK_TYPE_TAG: 'task_type',
}))

mock.module('src/services/analytics/index.js', () => ({
  logEvent: noop,
  logEventAsync: async () => {},
  stripProtoFields: (v: any) => v,
  attachAnalyticsSink: noop,
  _resetForTesting: noop,
  AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS: undefined,
}))

mock.module('src/utils/collapseReadSearch.js', () => ({
  getSearchExtraToolsOrReadInfo: () => undefined,
  getToolSearchOrReadInfo: () => undefined,
}))

// ─── Import after mocks ───

const {
  createProgressTracker,
  updateProgressFromMessage,
  rebuildProgressFromMessages,
  getTokenCountFromTracker,
  getProgressUpdate,
  estimateContentTokensCached,
  completeAgentTask,
  failAgentTask,
  killAsyncAgent,
  enqueueAgentNotification,
  registerAsyncAgent,
  updateAgentProgress,
  scheduleDeferredAgentProgressRebuild,
  clearDeferredAgentProgressRebuild,
  clearAllDeferredAgentProgressRebuildsForTests,
  isLocalAgentTask,
  clearAllIdleWindowTimersForTests,
  tryClaimAgentResume,
  clearAgentResuming,
  isLocalAgentPanelActive,
} = await import('../LocalAgentTask.js')
const { IDLE_WINDOW_KEEPALIVE_REASON } = await import(
  '../../../utils/task/framework.js'
)

// ─── Helpers ───

type AppStateLike = { tasks: Record<string, any> }
type SetAppStateLike = (f: (prev: AppStateLike) => AppStateLike) => void

function createSetAppState(initial: AppStateLike = { tasks: {} }): {
  setAppState: SetAppStateLike
  getState: () => AppStateLike
} {
  let state = initial
  return {
    setAppState: f => {
      state = f(state)
    },
    getState: () => state,
  }
}

function makeRunningTask(overrides: Record<string, any> = {}): any {
  return {
    id: 'test-agent-001',
    type: 'local_agent',
    status: 'running',
    description: 'Test agent',
    agentId: 'test-agent-001',
    prompt: 'do something',
    agentType: 'general-purpose',
    abortController: new AbortController(),
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
    notified: false,
    startTime: Date.now(),
    outputFile: '/tmp/output/test-agent-001',
    outputOffset: 0,
    ...overrides,
  }
}

function makeAssistantMessage(
  usage: any,
  content: any[] = [],
  id?: string,
): any {
  return {
    type: 'assistant',
    message: {
      ...(id !== undefined ? { id } : {}),
      usage,
      content,
    },
  }
}

afterEach(() => {
  enqueuedNotifications.length = 0
  realMessageQueue.resetCommandQueue()
})

// ─── Tests ───

describe('createProgressTracker', () => {
  test('returns initial state with zero counts', () => {
    const tracker = createProgressTracker()
    expect(tracker.toolUseCount).toBe(0)
    expect(tracker.latestInputTokens).toBe(0)
    expect(tracker.cumulativeOutputTokens).toBe(0)
    expect(tracker.recentActivities).toEqual([])
  })
})

describe('tryClaimAgentResume (densable Aye CAS)', () => {
  test('cold resume (no task) returns true and is no-op', () => {
    const { setAppState, getState } = createSetAppState()
    expect(
      tryClaimAgentResume(
        'missing',
        setAppState as any,
        () => getState() as any,
      ),
    ).toBe(true)
    expect(getState().tasks).toEqual({})
  })

  test('claims completed agent (sets resuming:true)', () => {
    const task = makeRunningTask({ status: 'completed', resuming: false })
    const { setAppState, getState } = createSetAppState({
      tasks: { [task.id]: task },
    })
    expect(
      tryClaimAgentResume(task.id, setAppState as any, () => getState() as any),
    ).toBe(true)
    expect(getState().tasks[task.id].resuming).toBe(true)
  })

  test('claims PSu adopt placeholder without treating adoptResumePending as CAS block', () => {
    // Product: PSu sets status completed + adoptResumePending; Aye CAS must still claim.
    const task = makeRunningTask({
      status: 'completed',
      resuming: false,
      adoptResumePending: true,
    })
    const { setAppState, getState } = createSetAppState({
      tasks: { [task.id]: task },
    })
    expect(
      tryClaimAgentResume(task.id, setAppState as any, () => getState() as any),
    ).toBe(true)
    const next = getState().tasks[task.id]
    expect(next.resuming).toBe(true)
    expect(next.adoptResumePending).toBe(false)
  })

  test('blocks when status is running', () => {
    const task = makeRunningTask({ status: 'running' })
    const { setAppState, getState } = createSetAppState({
      tasks: { [task.id]: task },
    })
    expect(
      tryClaimAgentResume(task.id, setAppState as any, () => getState() as any),
    ).toBe(false)
    expect(getState().tasks[task.id].resuming).not.toBe(true)
  })

  test('blocks when already resuming', () => {
    const task = makeRunningTask({ status: 'completed', resuming: true })
    const { setAppState, getState } = createSetAppState({
      tasks: { [task.id]: task },
    })
    expect(
      tryClaimAgentResume(task.id, setAppState as any, () => getState() as any),
    ).toBe(false)
  })

  test('clearAgentResuming only clears when resuming', () => {
    const task = makeRunningTask({ status: 'completed', resuming: true })
    const { setAppState, getState } = createSetAppState({
      tasks: { [task.id]: task },
    })
    clearAgentResuming(task.id, setAppState as any)
    expect(getState().tasks[task.id].resuming).toBe(false)
  })

  test('clearAgentResuming also clears adoptResumePending', () => {
    const task = makeRunningTask({
      status: 'completed',
      resuming: false,
      adoptResumePending: true,
    })
    const { setAppState, getState } = createSetAppState({
      tasks: { [task.id]: task },
    })
    clearAgentResuming(task.id, setAppState as any)
    expect(getState().tasks[task.id].adoptResumePending).toBe(false)
  })

  test('killAsyncAgent does NOT clear resuming (densable XV)', () => {
    // densable XV terminal update omits resuming:!1 — only S()/Sot/complete clear.
    // Sticky resuming blocks tryClaimAgentResume dual-worker race after stop mid-resume.
    const task = makeRunningTask({ status: 'running', resuming: true })
    const { setAppState, getState } = createSetAppState({
      tasks: { [task.id]: task },
    })
    killAsyncAgent(task.id, setAppState as any)
    expect(getState().tasks[task.id].status).toBe('killed')
    expect(getState().tasks[task.id].resuming).toBe(true)
    // Production resumeAgent always passes getAppState — dual claim blocked.
    expect(
      tryClaimAgentResume(task.id, setAppState as any, () => getState() as any),
    ).toBe(false)
    // Without getAppState, blocked update must still return false (not cold-ok).
    expect(tryClaimAgentResume(task.id, setAppState as any)).toBe(false)
  })

  test('tryClaim without getAppState still blocks sticky resuming', () => {
    const task = makeRunningTask({ status: 'killed', resuming: true })
    const { setAppState, getState } = createSetAppState({
      tasks: { [task.id]: task },
    })
    expect(tryClaimAgentResume(task.id, setAppState as any)).toBe(false)
    expect(getState().tasks[task.id].resuming).toBe(true)
  })

  test('completeAgentTask clears resuming flag', () => {
    const task = makeRunningTask({ status: 'running', resuming: true })
    const { setAppState, getState } = createSetAppState({
      tasks: { [task.id]: task },
    })
    completeAgentTask(
      {
        agentId: task.id,
        content: [{ type: 'text', text: 'done' }],
        totalTokens: 1,
        totalToolUseCount: 0,
        totalDurationMs: 1,
      } as any,
      setAppState as any,
    )
    expect(getState().tasks[task.id].status).toBe('completed')
    expect(getState().tasks[task.id].resuming).toBe(false)
  })
})

describe('isLocalAgentPanelActive (product adopt UX)', () => {
  test('completed alone is not active', () => {
    expect(
      isLocalAgentPanelActive(
        makeRunningTask({ status: 'completed', resuming: false }),
      ),
    ).toBe(false)
  })

  test('adoptResumePending completed is active', () => {
    expect(
      isLocalAgentPanelActive(
        makeRunningTask({
          status: 'completed',
          adoptResumePending: true,
        }),
      ),
    ).toBe(true)
  })

  test('resuming completed is active', () => {
    expect(
      isLocalAgentPanelActive(
        makeRunningTask({ status: 'completed', resuming: true }),
      ),
    ).toBe(true)
  })

  test('completed with keepalive is active (densable YC)', () => {
    expect(
      isLocalAgentPanelActive(
        makeRunningTask({
          status: 'completed',
          keepaliveReasons: new Set(['agent:child']),
        }),
      ),
    ).toBe(true)
  })
})

describe('updateProgressFromMessage', () => {
  test('skips non-assistant messages', () => {
    const tracker = createProgressTracker()
    updateProgressFromMessage(tracker, { type: 'user', message: {} } as any)
    expect(tracker.toolUseCount).toBe(0)
    expect(tracker.latestInputTokens).toBe(0)
  })

  test('updates token counts from assistant message usage', () => {
    const tracker = createProgressTracker()
    const msg = makeAssistantMessage({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 30,
    })
    updateProgressFromMessage(tracker, msg)
    expect(tracker.latestInputTokens).toBe(150) // 100 + 20 + 30
    expect(tracker.cumulativeOutputTokens).toBe(50)
  })

  test('zero-usage assistant turns do not wipe prior token counts', () => {
    const tracker = createProgressTracker()
    updateProgressFromMessage(
      tracker,
      makeAssistantMessage({
        input_tokens: 1000,
        output_tokens: 40,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 500,
      }),
    )
    expect(tracker.latestInputTokens).toBe(1500)
    expect(tracker.cumulativeOutputTokens).toBe(40)

    // Tool-only / streaming placeholder with all-zero usage (common on some providers)
    updateProgressFromMessage(
      tracker,
      makeAssistantMessage({ input_tokens: 0, output_tokens: 0 }, [
        { type: 'tool_use', name: 'Read', input: { file_path: '/x' } },
      ]),
    )
    expect(tracker.latestInputTokens).toBe(1500)
    expect(tracker.cumulativeOutputTokens).toBe(40)
    expect(tracker.toolUseCount).toBe(1)
  })

  test('counts tool_use blocks and tracks recent activities', () => {
    const tracker = createProgressTracker()
    const msg = makeAssistantMessage({ input_tokens: 0, output_tokens: 0 }, [
      { type: 'tool_use', name: 'Read', input: { file_path: '/foo.ts' } },
      { type: 'text', text: 'thinking...' },
      { type: 'tool_use', name: 'Write', input: { file_path: '/bar.ts' } },
    ])
    updateProgressFromMessage(tracker, msg)
    expect(tracker.toolUseCount).toBe(2)
    expect(tracker.recentActivities).toHaveLength(2)
    expect(tracker.recentActivities[0]!.toolName).toBe('Read')
    expect(tracker.recentActivities[1]!.toolName).toBe('Write')
  })

  test('caps recentActivities at 5', () => {
    const tracker = createProgressTracker()
    for (let i = 0; i < 7; i++) {
      const msg = makeAssistantMessage({ input_tokens: 0, output_tokens: 0 }, [
        { type: 'tool_use', name: `Tool${i}`, input: {} },
      ])
      updateProgressFromMessage(tracker, msg)
    }
    expect(tracker.recentActivities).toHaveLength(5)
  })

  test('skips without usage', () => {
    const tracker = createProgressTracker()
    const msg = makeAssistantMessage(null)
    updateProgressFromMessage(tracker, msg)
    expect(tracker.latestInputTokens).toBe(0)
  })

  test('still counts tool_use when usage is missing', () => {
    const tracker = createProgressTracker()
    const msg = makeAssistantMessage(null, [
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
    ])
    updateProgressFromMessage(tracker, msg)
    expect(tracker.toolUseCount).toBe(1)
    expect(tracker.latestInputTokens).toBe(0)
  })
})

describe('rebuildProgressFromMessages', () => {
  test('picks up in-place usage mutations after the original yield', () => {
    const tracker = createProgressTracker()
    const msg = makeAssistantMessage({
      input_tokens: 0,
      output_tokens: 0,
    })

    // First pass at content_block_stop: zero usage
    updateProgressFromMessage(tracker, msg)
    expect(getTokenCountFromTracker(tracker)).toBe(0)

    // message_delta mutates the same object in place (first-party streaming)
    msg.message.usage = {
      input_tokens: 1200,
      output_tokens: 80,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 400,
    }

    rebuildProgressFromMessages(tracker, [msg])
    expect(tracker.latestInputTokens).toBe(1600)
    expect(tracker.cumulativeOutputTokens).toBe(80)
    expect(getTokenCountFromTracker(tracker)).toBe(1680)
  })

  test('does not double-count when rebuilt multiple times', () => {
    const tracker = createProgressTracker()
    const msg = makeAssistantMessage(
      {
        input_tokens: 100,
        output_tokens: 25,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      [{ type: 'tool_use', name: 'Read', input: {} }],
    )

    rebuildProgressFromMessages(tracker, [msg])
    rebuildProgressFromMessages(tracker, [msg])
    expect(tracker.toolUseCount).toBe(1)
    expect(tracker.cumulativeOutputTokens).toBe(25)
    expect(tracker.latestInputTokens).toBe(100)
  })

  test('counts shared-usage split assistant records once per response id', () => {
    const tracker = createProgressTracker()
    const usage = {
      input_tokens: 500,
      output_tokens: 40,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 100,
    }
    const textPart = {
      type: 'assistant',
      message: {
        id: 'msg_same',
        usage,
        content: [{ type: 'text', text: 'hi' }],
      },
    } as any
    const toolPart = {
      type: 'assistant',
      message: {
        id: 'msg_same',
        usage,
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/x' } },
        ],
      },
    } as any

    rebuildProgressFromMessages(tracker, [textPart, toolPart])
    expect(tracker.toolUseCount).toBe(1)
    expect(tracker.latestInputTokens).toBe(600)
    // output counted once, not 40+40
    expect(tracker.cumulativeOutputTokens).toBe(40)
    expect(getTokenCountFromTracker(tracker)).toBe(640)
  })

  test('last-wins usage when message_delta only updates the last sibling', () => {
    // Mirrors first-party streaming: each content_block_stop yields a usage
    // snapshot copy; message_delta assigns final usage only to newMessages.at(-1).
    const tracker = createProgressTracker()
    const earlyUsage = {
      input_tokens: 1200,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 400,
    }
    const finalUsage = {
      input_tokens: 1200,
      output_tokens: 80,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 400,
    }
    const thinkingPart = {
      type: 'assistant',
      message: {
        id: 'msg_agent_1',
        usage: { ...earlyUsage },
        content: [{ type: 'thinking', thinking: 'plan' }],
      },
    } as any
    const toolPart = {
      type: 'assistant',
      message: {
        id: 'msg_agent_1',
        usage: { ...earlyUsage },
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
      },
    } as any
    // message_delta only mutates the last yielded sibling
    toolPart.message.usage = finalUsage

    rebuildProgressFromMessages(tracker, [thinkingPart, toolPart])
    expect(tracker.toolUseCount).toBe(1)
    expect(tracker.latestInputTokens).toBe(1600)
    expect(tracker.cumulativeOutputTokens).toBe(80)
    expect(getTokenCountFromTracker(tracker)).toBe(1680)
  })

  test('max-score keeps earlier sibling when last has zeros', () => {
    // Some providers leave zeros on the last sibling while an earlier one
    // already carries real input counts — pure last-wins freezes footer.
    const tracker = createProgressTracker()
    const rich = {
      input_tokens: 7000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 800,
    }
    const zeros = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    const early = {
      type: 'assistant',
      message: {
        id: 'msg_score',
        usage: rich,
        content: [{ type: 'text', text: 'hi' }],
      },
    } as any
    const late = {
      type: 'assistant',
      message: {
        id: 'msg_score',
        usage: zeros,
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
      },
    } as any

    rebuildProgressFromMessages(tracker, [early, late])
    expect(tracker.latestInputTokens).toBe(7800)
    expect(tracker.cumulativeOutputTokens).toBe(100)
    expect(getTokenCountFromTracker(tracker)).toBe(7900)
  })

  test('high-water input across multi-turn responses', () => {
    const tracker = createProgressTracker()
    const turn1 = makeAssistantMessage(
      {
        input_tokens: 5000,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      [],
      'msg_t1',
    )
    const turn2 = makeAssistantMessage(
      {
        // Shorter second turn (e.g. after compact) must not wipe higher HWM
        input_tokens: 1200,
        output_tokens: 30,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      [],
      'msg_t2',
    )
    rebuildProgressFromMessages(tracker, [turn1, turn2])
    expect(tracker.latestInputTokens).toBe(5000)
    expect(tracker.cumulativeOutputTokens).toBe(80)
  })
})

describe('scheduleDeferredAgentProgressRebuild', () => {
  test('picks up in-place message_delta usage after yield', async () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        'test-agent-001': makeRunningTask({
          progress: { toolUseCount: 0, tokenCount: 0 },
        }),
      },
    })
    const tracker = createProgressTracker()
    const msg = makeAssistantMessage({
      input_tokens: 0,
      output_tokens: 0,
    })

    // content_block_stop snapshot: zeros
    rebuildProgressFromMessages(tracker, [msg])
    updateAgentProgress(
      'test-agent-001',
      getProgressUpdate(tracker),
      setAppState as any,
    )
    expect(getState().tasks['test-agent-001'].progress.tokenCount).toBe(0)

    scheduleDeferredAgentProgressRebuild(
      'test-agent-001',
      tracker,
      [msg],
      setAppState as any,
    )

    // message_delta mutates after yield, before deferred rebuild runs
    msg.message.usage = {
      input_tokens: 7800,
      output_tokens: 120,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }

    await new Promise(resolve => setTimeout(resolve, 20))

    expect(getState().tasks['test-agent-001'].progress.tokenCount).toBe(7920)
    expect(tracker.latestInputTokens).toBe(7800)
    expect(tracker.cumulativeOutputTokens).toBe(120)
  })

  test('clearDeferredAgentProgressRebuild cancels timers; no-ops after complete', async () => {
    clearAllDeferredAgentProgressRebuildsForTests()
    const { setAppState, getState } = createSetAppState({
      tasks: {
        'test-agent-clear': makeRunningTask({
          progress: { toolUseCount: 0, tokenCount: 0 },
        }),
      },
    })
    const tracker = createProgressTracker()
    const msg = makeAssistantMessage({
      input_tokens: 0,
      output_tokens: 0,
    })
    rebuildProgressFromMessages(tracker, [msg])
    updateAgentProgress(
      'test-agent-clear',
      getProgressUpdate(tracker),
      setAppState as any,
    )

    scheduleDeferredAgentProgressRebuild(
      'test-agent-clear',
      tracker,
      [msg],
      setAppState as any,
    )
    // Cancel before deferred ticks fire — tokenCount stays 0 even if usage mutates.
    clearDeferredAgentProgressRebuild('test-agent-clear')
    msg.message.usage = {
      input_tokens: 9000,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(getState().tasks['test-agent-clear'].progress.tokenCount).toBe(0)

    // Re-schedule then complete: stillRunning guard + clear on complete path.
    scheduleDeferredAgentProgressRebuild(
      'test-agent-clear',
      tracker,
      [msg],
      setAppState as any,
    )
    completeAgentTask(
      {
        agentId: 'test-agent-clear',
        content: [{ type: 'text', text: 'done' }],
        totalTokens: 0,
        totalToolUseCount: 0,
      } as any,
      setAppState as any,
    )
    await new Promise(resolve => setTimeout(resolve, 60))
    // complete clears timers; progress must not jump after status left running.
    expect(getState().tasks['test-agent-clear'].status).not.toBe('running')
  })
})

describe('getProgressUpdate', () => {
  test('returns correct progress snapshot', () => {
    const tracker = createProgressTracker()
    tracker.toolUseCount = 3
    tracker.latestInputTokens = 100
    tracker.cumulativeOutputTokens = 50
    tracker.recentActivities.push({ toolName: 'Read', input: {} })

    const progress = getProgressUpdate(tracker)
    expect(progress.toolUseCount).toBe(3)
    expect(progress.tokenCount).toBe(150)
    expect(progress.lastActivity).toBeDefined()
    expect(progress.lastActivity!.toolName).toBe('Read')
  })

  test('returns undefined lastActivity when no activities', () => {
    const tracker = createProgressTracker()
    const progress = getProgressUpdate(tracker)
    expect(progress.lastActivity).toBeUndefined()
  })

  test('falls back to content estimate when usage is all zeros', () => {
    const tracker = createProgressTracker()
    const msg = makeAssistantMessage({ input_tokens: 0, output_tokens: 0 }, [
      {
        type: 'text',
        text: 'x'.repeat(400), // ~100 tokens at 4 bytes/token
      },
    ])
    rebuildProgressFromMessages(tracker, [msg])
    expect(getTokenCountFromTracker(tracker)).toBe(0)
    const progress = getProgressUpdate(tracker, [msg])
    expect(progress.tokenCount).toBeGreaterThan(0)
  })

  test('takes max(usage, contentEstimate) after non-zero usage', () => {
    // First response has small usage; later content is large with zero usage.
    // Footer must keep growing (not freeze on the early usage total).
    const tracker = createProgressTracker()
    const early = makeAssistantMessage(
      { input_tokens: 100, output_tokens: 50 },
      [{ type: 'text', text: 'short' }],
    )
    const late = makeAssistantMessage({ input_tokens: 0, output_tokens: 0 }, [
      {
        type: 'text',
        text: 'y'.repeat(8000), // >> 150 tokens at rough estimate
      },
    ])
    rebuildProgressFromMessages(tracker, [early, late])
    const usageOnly = getTokenCountFromTracker(tracker)
    expect(usageOnly).toBeGreaterThan(0)
    const progress = getProgressUpdate(tracker, [early, late])
    expect(progress.tokenCount).toBeGreaterThan(usageOnly)
  })

  test('content estimate cache reuses stable prefix across ticks', () => {
    const tracker = createProgressTracker()
    const prefix = makeAssistantMessage({ input_tokens: 0, output_tokens: 0 }, [
      { type: 'text', text: 'a'.repeat(400) },
    ])
    const first = estimateContentTokensCached(tracker, [prefix])
    expect(first).toBeGreaterThan(0)
    // Same object + same contentLen → cache hit (same total).
    const second = estimateContentTokensCached(tracker, [prefix])
    expect(second).toBe(first)
    // Grow tail with a new message — total must increase; prefix still cached.
    const tail = makeAssistantMessage({ input_tokens: 0, output_tokens: 0 }, [
      { type: 'text', text: 'b'.repeat(400) },
    ])
    const third = estimateContentTokensCached(tracker, [prefix, tail])
    expect(third).toBeGreaterThan(first)
    // Mutate content in place — contentLen changes → re-estimate.
    ;(
      prefix.message!.content as Array<{ type: string; text: string }>
    )[0]!.text = 'c'.repeat(2000)
    const fourth = estimateContentTokensCached(tracker, [prefix, tail])
    expect(fourth).toBeGreaterThan(third)
  })
})

describe('completeAgentTask', () => {
  afterEach(() => {
    clearAllIdleWindowTimersForTests()
  })

  test('transitions running task to completed', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: { 'test-agent-001': makeRunningTask() },
    })

    completeAgentTask(
      {
        agentId: 'test-agent-001',
        content: [],
        totalToolUseCount: 0,
        totalDurationMs: 100,
      } as any,
      setAppState as any,
    )

    const task = getState().tasks['test-agent-001']
    expect(task.status).toBe('completed')
    expect(task.endTime).toBeDefined()
    // densable DSu a=!1: no bot stamp; empty KA → panel grace (not YC)
    expect(task.keepaliveReasons?.has(IDLE_WINDOW_KEEPALIVE_REASON)).toBe(false)
    expect(task.evictAfter).toBeDefined()
  })

  test('syncs progress token count from finalized result', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        'test-agent-001': makeRunningTask({
          progress: { toolUseCount: 1, tokenCount: 0 },
        }),
      },
    })

    completeAgentTask(
      {
        agentId: 'test-agent-001',
        content: [],
        totalToolUseCount: 4,
        totalTokens: 6100,
        totalDurationMs: 100,
      } as any,
      setAppState as any,
    )

    const task = getState().tasks['test-agent-001']
    expect(task.status).toBe('completed')
    expect(task.progress?.tokenCount).toBe(6100)
    expect(task.progress?.toolUseCount).toBe(4)
  })

  test('no-op if task not running', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: { 'test-agent-001': makeRunningTask({ status: 'completed' }) },
    })

    completeAgentTask(
      {
        agentId: 'test-agent-001',
        content: [],
        totalToolUseCount: 0,
        totalDurationMs: 100,
      } as any,
      setAppState as any,
    )

    const task = getState().tasks['test-agent-001']
    expect(task.status).toBe('completed')
  })
})

describe('failAgentTask', () => {
  test('transitions running task to failed with error message', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: { 'test-agent-001': makeRunningTask() },
    })

    failAgentTask('test-agent-001', 'Stream idle timeout', setAppState as any)

    const task = getState().tasks['test-agent-001']
    expect(task.status).toBe('failed')
    expect(task.error).toBe('Stream idle timeout')
    expect(task.endTime).toBeDefined()
  })

  test('no-op if task not running', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: { 'test-agent-001': makeRunningTask({ status: 'killed' }) },
    })

    failAgentTask('test-agent-001', 'error', setAppState as any)

    const task = getState().tasks['test-agent-001']
    expect(task.status).toBe('killed')
    expect(task.error).toBeUndefined()
  })
})

describe('killAsyncAgent', () => {
  test('transitions running task to killed', () => {
    const ac = new AbortController()
    const cleanup = mock(() => {})
    const { setAppState, getState } = createSetAppState({
      tasks: {
        'test-agent-001': makeRunningTask({
          abortController: ac,
          unregisterCleanup: cleanup,
        }),
      },
    })

    killAsyncAgent('test-agent-001', setAppState as any)

    const task = getState().tasks['test-agent-001']
    expect(task.status).toBe('killed')
    expect(ac.signal.aborted).toBe(true)
    expect(cleanup).toHaveBeenCalled()
    expect(task.abortController).toBeUndefined()
  })

  test('no-op if task not running', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: { 'test-agent-001': makeRunningTask({ status: 'completed' }) },
    })

    killAsyncAgent('test-agent-001', setAppState as any)

    const task = getState().tasks['test-agent-001']
    expect(task.status).toBe('completed')
  })
})

describe('enqueueAgentNotification', () => {
  test('enqueues completed notification with correct XML format', async () => {
    const { setAppState } = createSetAppState({
      tasks: { 'test-agent-001': makeRunningTask({ notified: false }) },
    })

    await enqueueAgentNotification({
      taskId: 'test-agent-001',
      description: 'refactor auth',
      status: 'completed',
      setAppState: setAppState as any,
      finalMessage: 'Done!',
      usage: { totalTokens: 5000, toolUses: 3, durationMs: 10000 },
    })

    expect(enqueuedNotifications).toHaveLength(1)
    expect(enqueuedNotifications[0]).toContain('<task_notification>')
    expect(enqueuedNotifications[0]).toContain(
      '<task_id>test-agent-001</task_id>',
    )
    expect(enqueuedNotifications[0]).toContain('<status>completed</status>')
    expect(enqueuedNotifications[0]).toContain('Agent "refactor auth" finished')
    expect(enqueuedNotifications[0]).toContain('<result>Done!</result>')
    expect(enqueuedNotifications[0]).toContain(
      '<subagent_tokens>5000</subagent_tokens>',
    )
    expect(enqueuedNotifications[0]).toContain(
      'A task-notification fires each time this agent stops',
    )
  })

  test('enqueues failed notification with error', async () => {
    const { setAppState } = createSetAppState({
      tasks: { 'test-agent-001': makeRunningTask({ notified: false }) },
    })

    await enqueueAgentNotification({
      taskId: 'test-agent-001',
      description: 'test',
      status: 'failed',
      error: 'Stream idle timeout',
      setAppState: setAppState as any,
    })

    expect(enqueuedNotifications).toHaveLength(1)
    expect(enqueuedNotifications[0]).toContain('<status>failed</status>')
    expect(enqueuedNotifications[0]).toContain(
      'Agent "test" failed: Stream idle timeout',
    )
  })

  test('enqueues killed notification', async () => {
    const { setAppState } = createSetAppState({
      tasks: { 'test-agent-001': makeRunningTask({ notified: false }) },
    })

    await enqueueAgentNotification({
      taskId: 'test-agent-001',
      description: 'test',
      status: 'killed',
      setAppState: setAppState as any,
    })

    expect(enqueuedNotifications).toHaveLength(1)
    expect(enqueuedNotifications[0]).toContain('<status>killed</status>')
    expect(enqueuedNotifications[0]).toContain('Agent "test" was stopped')
  })

  test('prevents duplicate notifications', async () => {
    const { setAppState } = createSetAppState({
      tasks: { 'test-agent-001': makeRunningTask({ notified: false }) },
    })

    await enqueueAgentNotification({
      taskId: 'test-agent-001',
      description: 'test',
      status: 'completed',
      setAppState: setAppState as any,
    })

    // Second call — notified flag already set by first call
    await enqueueAgentNotification({
      taskId: 'test-agent-001',
      description: 'test',
      status: 'completed',
      setAppState: setAppState as any,
    })

    expect(enqueuedNotifications).toHaveLength(1)
  })

  test('skips if task already notified', async () => {
    const { setAppState } = createSetAppState({
      tasks: { 'test-agent-001': makeRunningTask({ notified: true }) },
    })

    await enqueueAgentNotification({
      taskId: 'test-agent-001',
      description: 'test',
      status: 'completed',
      setAppState: setAppState as any,
    })

    expect(enqueuedNotifications).toHaveLength(0)
  })
})

describe('isLocalAgentTask', () => {
  test('returns true for local_agent type', () => {
    expect(isLocalAgentTask(makeRunningTask())).toBe(true)
  })

  test('returns false for other types', () => {
    expect(isLocalAgentTask({ type: 'local_bash' })).toBe(false)
  })

  test('returns false for null/undefined', () => {
    expect(isLocalAgentTask(null)).toBe(false)
    expect(isLocalAgentTask(undefined)).toBe(false)
  })
})

describe('updateAgentProgress', () => {
  test('updates progress while preserving summary', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        'test-agent-001': makeRunningTask({
          progress: { summary: 'Working on auth' },
        }),
      },
    })

    updateAgentProgress(
      'test-agent-001',
      {
        toolUseCount: 5,
        tokenCount: 1000,
        lastActivity: { toolName: 'Write', input: {} },
      },
      setAppState as any,
    )

    const task = getState().tasks['test-agent-001']
    expect(task.progress.toolUseCount).toBe(5)
    expect(task.progress.tokenCount).toBe(1000)
    expect(task.progress.summary).toBe('Working on auth')
  })

  test('no-op if task not running', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        'test-agent-001': makeRunningTask({
          status: 'completed',
          progress: {},
        }),
      },
    })

    updateAgentProgress(
      'test-agent-001',
      { toolUseCount: 5, tokenCount: 1000 },
      setAppState as any,
    )

    const task = getState().tasks['test-agent-001']
    expect(task.progress.toolUseCount).toBeUndefined()
  })

  test('never regresses token or tool counts', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        'test-agent-001': makeRunningTask({
          progress: { toolUseCount: 3, tokenCount: 7800, summary: 'keep me' },
        }),
      },
    })

    updateAgentProgress(
      'test-agent-001',
      { toolUseCount: 1, tokenCount: 100 },
      setAppState as any,
    )

    const task = getState().tasks['test-agent-001']
    expect(task.progress.tokenCount).toBe(7800)
    expect(task.progress.toolUseCount).toBe(3)
    expect(task.progress.summary).toBe('keep me')
  })
})
