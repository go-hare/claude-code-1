import { describe, expect, mock, test } from 'bun:test'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'
import * as realMessageQueue from 'src/utils/messageQueueManager.js'
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

// Spread reals so process-global mock.module does not strip exports
// (getCommandQueue / DiskTaskOutput) for co-running suites.
function messageQueueMock() {
  return {
    ...realMessageQueue,
    enqueuePendingNotification: noop,
    dequeueAllMatching: () => [],
    getCommandQueue: () => [],
  }
}
mock.module('src/utils/messageQueueManager.js', messageQueueMock)

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

const { registerLocalWorkflowTask, failWorkflowTask } = await import(
  '../LocalWorkflowTask.js'
)

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
