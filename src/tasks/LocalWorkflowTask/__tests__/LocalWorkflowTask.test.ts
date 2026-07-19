import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import * as realBootstrapState from '../../../bootstrap/state.js'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'

// ─── Mocks（仅 mock 有副作用的依赖链）───

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

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

mock.module('src/utils/messageQueueManager.js', () => ({
  enqueuePendingNotification: () => {},
  dequeueAllMatching: () => [],
}))

mock.module('src/utils/sdkEventQueue.js', () => ({
  enqueueSdkEvent: () => {},
}))

// Spread real diskOutput so DiskTaskOutput survives process-global mock pollution.
function diskOutputMock() {
  return {
    ...realDiskOutput,
    getTaskOutputDelta: async () => null,
    getTaskOutputPath: (id: string) => `/tmp/${id}`,
    evictTaskOutput: () => {},
    initTaskOutputAsSymlink: async () => {},
  }
}
mock.module('src/utils/task/diskOutput.js', diskOutputMock)
mock.module('../../../utils/task/diskOutput.js', diskOutputMock)

// Official pn() = !isInteractive — product path skips Gge in headless.
// Unit tests exercise interactive Gge/tB attach/detach.
// Spread real bootstrap so sibling suites (agentKeepalive) keep full surface.
mock.module('src/bootstrap/state.js', () => ({
  ...realBootstrapState,
  getIsNonInteractiveSession: () => false,
  getSessionId: () => 'test-session',
  addSlowOperation: () => {},
}))

// ─── Import after mocks ───

const {
  registerLocalWorkflowTask,
  completeWorkflowTask,
  failWorkflowTask,
  pauseWorkflowTask,
  killWorkflowTask,
} = await import('../LocalWorkflowTask.js')

// ─── Helpers ───

type AppStateLike = { tasks: Record<string, any> }
type SetAppStateLike = (f: (prev: AppStateLike) => AppStateLike) => void

function createSetState(): {
  setAppState: SetAppStateLike
  getState: () => AppStateLike
} {
  let state: AppStateLike = { tasks: {} }
  return {
    setAppState: f => {
      state = f(state)
    },
    getState: () => state,
  }
}

// ─── Tests ───

describe('failWorkflowTask', () => {
  test('保存 error 字符串到 state（供 BackgroundTasksDialog 显示失败原因）', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
    })
    failWorkflowTask(taskId, setAppState as any, 'agent X 抛 Error: boom')
    const task = getState().tasks[taskId]
    expect(task.status).toBe('failed')
    expect(task.error).toBe('agent X 抛 Error: boom')
  })

  test('不传 error 时 state.error 保持 undefined（向后兼容现有调用）', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
    })
    failWorkflowTask(taskId, setAppState as any)
    const task = getState().tasks[taskId]
    expect(task.status).toBe('failed')
    expect(task.error).toBeUndefined()
  })
})

describe('pauseWorkflowTask (official zit)', () => {
  test('running → paused + notified + abortController cleared', () => {
    const { setAppState, getState } = createSetState()
    let aborted = false
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
      abortController: {
        abort: () => {
          aborted = true
        },
      } as AbortController,
    })
    const ok = pauseWorkflowTask(taskId, setAppState as any)
    expect(ok).toBe(true)
    const task = getState().tasks[taskId]
    expect(task.status).toBe('paused')
    expect(task.notified).toBe(true)
    expect(task.abortController).toBeUndefined()
    expect(typeof task.endTime).toBe('number')
    expect(aborted).toBe(true)
  })

  test('non-running is no-op (returns false)', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
    })
    pauseWorkflowTask(taskId, setAppState as any)
    const ok2 = pauseWorkflowTask(taskId, setAppState as any)
    expect(ok2).toBe(false)
    expect(getState().tasks[taskId].status).toBe('paused')
  })
})

describe('killWorkflowTask', () => {
  test('can kill paused workflows', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
    })
    pauseWorkflowTask(taskId, setAppState as any)
    killWorkflowTask(taskId, setAppState as any)
    expect(getState().tasks[taskId].status).toBe('killed')
  })
})

describe('workflow keepalive Gge/tB (official zit/bye/Hao)', () => {
  test('register with ownerAgentId adds workflow:id keepalive on owner', () => {
    const { setAppState, getState } = createSetState()
    // Seed a local_agent owner (Wl target for Gge).
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        owner1: {
          id: 'owner1',
          type: 'local_agent',
          status: 'running',
          description: 'owner',
          startTime: Date.now(),
          outputFile: '/tmp/o',
          outputOffset: 0,
          notified: false,
          agentId: 'owner1',
          prompt: '',
          agentType: 'general-purpose',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
        },
      },
    }))
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
      ownerAgentId: 'owner1',
      agentId: 'owner1' as any,
    })
    const owner = getState().tasks.owner1
    expect(owner.keepaliveReasons).toBeInstanceOf(Set)
    expect(owner.keepaliveReasons.has(`workflow:${taskId}`)).toBe(true)
    expect(getState().tasks[taskId].ownerAgentId).toBe('owner1')
  })

  test('pauseWorkflowTask detaches owner keepalive (official zit tB)', () => {
    const { setAppState, getState } = createSetState()
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        owner1: {
          id: 'owner1',
          type: 'local_agent',
          status: 'completed',
          description: 'owner',
          startTime: Date.now(),
          endTime: Date.now(),
          outputFile: '/tmp/o',
          outputOffset: 0,
          notified: true,
          agentId: 'owner1',
          prompt: '',
          agentType: 'general-purpose',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
          keepaliveReasons: new Set(['workflow:seed']),
        },
      },
    }))
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
      ownerAgentId: 'owner1',
    })
    // Owner should have workflow:taskId; seed reason still present.
    expect(getState().tasks.owner1.keepaliveReasons.has(`workflow:${taskId}`)).toBe(
      true,
    )
    const ok = pauseWorkflowTask(taskId, setAppState as any)
    expect(ok).toBe(true)
    const reasons: Set<string> = getState().tasks.owner1.keepaliveReasons
    expect(reasons.has(`workflow:${taskId}`)).toBe(false)
    // seed still there until emptied
    expect(reasons.has('workflow:seed')).toBe(true)
  })

  test('killWorkflowTask detaches keepalive and schedules evict when empty+terminal', () => {
    const { setAppState, getState } = createSetState()
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        owner1: {
          id: 'owner1',
          type: 'local_agent',
          status: 'completed',
          description: 'owner',
          startTime: Date.now(),
          endTime: Date.now(),
          outputFile: '/tmp/o',
          outputOffset: 0,
          notified: true,
          agentId: 'owner1',
          prompt: '',
          agentType: 'general-purpose',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
        },
      },
    }))
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
      ownerAgentId: 'owner1',
    })
    killWorkflowTask(taskId, setAppState as any)
    const owner = getState().tasks.owner1
    expect(owner.keepaliveReasons?.size ?? 0).toBe(0)
    // Official tB: empty + UE(status) + !retain → evictAfter = now+_re
    expect(typeof owner.evictAfter).toBe('number')
  })

  test('completeWorkflowTask skips tB when owner running (official Hao)', () => {
    const { setAppState, getState } = createSetState()
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        owner1: {
          id: 'owner1',
          type: 'local_agent',
          status: 'running',
          description: 'owner',
          startTime: Date.now(),
          outputFile: '/tmp/o',
          outputOffset: 0,
          notified: false,
          agentId: 'owner1',
          prompt: '',
          agentType: 'general-purpose',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
        },
      },
    }))
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
      ownerAgentId: 'owner1',
    })
    expect(getState().tasks.owner1.keepaliveReasons.has(`workflow:${taskId}`)).toBe(
      true,
    )
    completeWorkflowTask(taskId, setAppState as any)
    // firstNotify + owner running → keep hold (mirror BRt)
    expect(getState().tasks.owner1.keepaliveReasons.has(`workflow:${taskId}`)).toBe(
      true,
    )
    expect(getState().tasks[taskId].status).toBe('completed')
    expect(getState().tasks[taskId].notified).toBe(true)
  })

  test('failWorkflowTask detaches when owner not busy', () => {
    const { setAppState, getState } = createSetState()
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        owner1: {
          id: 'owner1',
          type: 'local_agent',
          // failed is not YC-parked (YC requires completed+KA)
          status: 'failed',
          description: 'owner',
          startTime: Date.now(),
          endTime: Date.now(),
          outputFile: '/tmp/o',
          outputOffset: 0,
          notified: true,
          agentId: 'owner1',
          prompt: '',
          agentType: 'general-purpose',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
        },
      },
    }))
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
      ownerAgentId: 'owner1',
    })
    failWorkflowTask(taskId, setAppState as any, 'boom')
    expect(getState().tasks.owner1.keepaliveReasons?.has(`workflow:${taskId}`)).toBe(
      false,
    )
    expect(getState().tasks[taskId].status).toBe('failed')
  })

  test('completeWorkflowTask always tB when already notified', () => {
    const { setAppState, getState } = createSetState()
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        owner1: {
          id: 'owner1',
          type: 'local_agent',
          status: 'running',
          description: 'owner',
          startTime: Date.now(),
          outputFile: '/tmp/o',
          outputOffset: 0,
          notified: false,
          agentId: 'owner1',
          prompt: '',
          agentType: 'general-purpose',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
        },
      },
    }))
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'test',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
      ownerAgentId: 'owner1',
    })
    // Pre-mark notified (suppress / double-complete path)
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: { ...prev.tasks[taskId], notified: true },
      },
    }))
    completeWorkflowTask(taskId, setAppState as any)
    // firstNotify=false → always detach even if owner running
    expect(getState().tasks.owner1.keepaliveReasons?.has(`workflow:${taskId}`)).toBe(
      false,
    )
  })
})

describe('workflow Gge pn() non-interactive guard', () => {
  test('source-scan: register skips Gge when getIsNonInteractiveSession', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(
      path.join(import.meta.dir, '../LocalWorkflowTask.ts'),
      'utf8',
    )
    expect(src).toContain('getIsNonInteractiveSession')
    expect(src).toMatch(
      /ownerAgentId\s*&&\s*!getIsNonInteractiveSession\(\)/,
    )
  })
})
