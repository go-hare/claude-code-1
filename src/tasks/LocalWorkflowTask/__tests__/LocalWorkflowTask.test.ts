import { describe, expect, mock, test } from 'bun:test'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

// ─── Mocks（仅 mock 有副作用的依赖链）───

const noop = () => {}
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

// Do not mock messageQueueManager — process-global stubs break SleepTool.

mock.module('src/utils/sdkEventQueue.js', () => ({
  enqueueSdkEvent: noop,
}))

function diskOutputMock() {
  return {
    ...realDiskOutput,
    getTaskOutputDelta: async () => null,
    getTaskOutputPath: (id: string) => `/tmp/${id}`,
    evictTaskOutput: noop,
    initTaskOutputAsSymlink: async () => {},
    initTaskOutput: async () => {},
  }
}
mock.module('src/utils/task/diskOutput.js', diskOutputMock)

// ─── Import after mocks ───

const {
  registerLocalWorkflowTask,
  failWorkflowTask,
  applyWorkflowProgressDeltas,
  consumePendingAgentAction,
  skipWorkflowAgent,
  WORKFLOW_PROGRESS_LOG_CAP,
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

describe('registerLocalWorkflowTask densable defaults', () => {
  test('initializes workflowProgress/progressVersion/totals', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'd',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
      workflowRunId: 'run-1',
    })
    const task = getState().tasks[taskId]
    expect(task.workflowProgress).toEqual([])
    expect(task.progressVersion).toBe(0)
    expect(task.agentCount).toBe(0)
    expect(task.totalTokens).toBe(0)
    expect(task.totalToolCalls).toBe(0)
    expect(task.workflowRunId).toBe('run-1')
  })
})

describe('applyWorkflowProgressDeltas (densable tm8)', () => {
  test('upserts agent/phase by type:index and sums tokens/tools', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'd',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
    })
    applyWorkflowProgressDeltas(
      taskId,
      [
        { type: 'workflow_phase', index: 0, title: 'P', state: 'start' },
        {
          type: 'workflow_agent',
          index: 2,
          label: 'a',
          state: 'start',
          tokens: 5,
          toolCalls: 1,
        },
      ],
      setAppState as any,
    )
    applyWorkflowProgressDeltas(
      taskId,
      [
        {
          type: 'workflow_agent',
          index: 2,
          label: 'a',
          state: 'done',
          tokens: 20,
          toolCalls: 3,
        },
      ],
      setAppState as any,
    )
    const task = getState().tasks[taskId]
    expect(
      task.workflowProgress.filter(
        (x: { type: string }) => x.type === 'workflow_agent',
      ),
    ).toHaveLength(1)
    expect(task.totalTokens).toBe(20)
    expect(task.totalToolCalls).toBe(3)
    expect(task.agentCount).toBe(2)
    expect(task.progressVersion).toBe(3)
  })

  test('appends logs and trims when over 2*cap', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'd',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
    })
    const cap = 5
    const logs = Array.from({ length: 12 }, (_, i) => ({
      type: 'workflow_log' as const,
      message: `m${i}`,
    }))
    applyWorkflowProgressDeltas(taskId, logs, setAppState as any, cap)
    const task = getState().tasks[taskId]
    // length was 12 > 2*5 → drop oldest logs until ~cap remaining for log-heavy list
    expect(task.workflowProgress.length).toBeLessThanOrEqual(cap + 2)
    expect(WORKFLOW_PROGRESS_LOG_CAP).toBe(500)
  })

  test('no-ops when task not running', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'd',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
    })
    failWorkflowTask(taskId, setAppState as any, 'x')
    const r = applyWorkflowProgressDeltas(
      taskId,
      [{ type: 'workflow_log', message: 'nope' }],
      setAppState as any,
    )
    expect(r).toBeNull()
    expect(getState().tasks[taskId].workflowProgress).toEqual([])
  })
})

describe('pendingAgentAction skip/retry', () => {
  test('skipWorkflowAgent sets pending; consume clears it', () => {
    const { setAppState, getState } = createSetState()
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'd',
      workflowName: 'wf',
      workflowFile: '/tmp/wf.ts',
    })
    skipWorkflowAgent(taskId, '1' as any, setAppState as any)
    expect(getState().tasks[taskId].pendingAgentAction?.kind).toBe('skip')
    const c = consumePendingAgentAction(taskId, setAppState as any)
    expect(c?.kind).toBe('skip')
    expect(getState().tasks[taskId].pendingAgentAction).toBeUndefined()
  })
})
