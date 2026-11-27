import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createExplicitToolDeps,
  createToolCallContext,
  type ToolDeps,
  type ToolPermissionContext,
} from 'src/Tool.js'
import type { AppState } from 'src/state/AppState.js'
import type { LocalAgentTaskState } from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import type { LocalShellTaskState } from 'src/tasks/LocalShellTask/guards.js'
import { asAgentId } from 'src/types/ids.js'
import { clearHandbackDeliveriesForTests } from 'src/utils/subagentHandback.js'
import { createTaskRegistry } from 'src/utils/taskRegistry.js'
import { getTasksDir } from 'src/utils/tasks.js'
import type { TodoList } from 'src/utils/todo/types.js'
import { AgentTool } from '../AgentTool/AgentTool.js'
import { EnterPlanModeTool } from '../EnterPlanModeTool/EnterPlanModeTool.js'
import { EnterWorktreeTool } from '../EnterWorktreeTool/EnterWorktreeTool.js'
import { ExitPlanModeV2Tool } from '../ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { ExitWorktreeTool } from '../ExitWorktreeTool/ExitWorktreeTool.js'
import { GetTaskTool } from '../GetTaskTool/GetTaskTool.js'
import {
  LIST_AGENTS_INVALID_CURSOR_MESSAGE,
  ListAgentsTool,
  ListPeersTool,
} from '../ListPeersTool/ListPeersTool.js'
import { ProposeGoalTool } from '../ProposeGoalTool/ProposeGoalTool.js'
import { SendMessageTool } from '../SendMessageTool/SendMessageTool.js'
import { SubagentHandbackTool } from '../SubagentHandbackTool/SubagentHandbackTool.js'
import { TaskCreateTool } from '../TaskCreateTool/TaskCreateTool.js'
import { TaskGetTool } from '../TaskGetTool/TaskGetTool.js'
import { TaskListTool } from '../TaskListTool/TaskListTool.js'
import { TaskStopTool } from '../TaskStopTool/TaskStopTool.js'
import { TaskUpdateTool } from '../TaskUpdateTool/TaskUpdateTool.js'
import { TodoWriteTool } from '../TodoWriteTool/TodoWriteTool.js'

const ALL_BUCKET3_TOOLS = [
  { name: 'AgentTool', file: 'AgentTool/AgentTool.tsx', tool: AgentTool },
  {
    name: 'SubagentHandbackTool',
    file: 'SubagentHandbackTool/SubagentHandbackTool.ts',
    tool: SubagentHandbackTool,
  },
  {
    name: 'SendMessageTool',
    file: 'SendMessageTool/SendMessageTool.ts',
    tool: SendMessageTool,
  },
  {
    name: 'ListPeersTool',
    file: 'ListPeersTool/ListPeersTool.ts',
    tool: ListPeersTool,
  },
  {
    name: 'TaskCreateTool',
    file: 'TaskCreateTool/TaskCreateTool.ts',
    tool: TaskCreateTool,
  },
  {
    name: 'TaskGetTool',
    file: 'TaskGetTool/TaskGetTool.ts',
    tool: TaskGetTool,
  },
  {
    name: 'TaskListTool',
    file: 'TaskListTool/TaskListTool.ts',
    tool: TaskListTool,
  },
  {
    name: 'TaskStopTool',
    file: 'TaskStopTool/TaskStopTool.ts',
    tool: TaskStopTool,
  },
  {
    name: 'TaskUpdateTool',
    file: 'TaskUpdateTool/TaskUpdateTool.ts',
    tool: TaskUpdateTool,
  },
  {
    name: 'GetTaskTool',
    file: 'GetTaskTool/GetTaskTool.ts',
    tool: GetTaskTool,
  },
  {
    name: 'TodoWriteTool',
    file: 'TodoWriteTool/TodoWriteTool.ts',
    tool: TodoWriteTool,
  },
  {
    name: 'EnterWorktreeTool',
    file: 'EnterWorktreeTool/EnterWorktreeTool.ts',
    tool: EnterWorktreeTool,
  },
  {
    name: 'ExitWorktreeTool',
    file: 'ExitWorktreeTool/ExitWorktreeTool.ts',
    tool: ExitWorktreeTool,
  },
  {
    name: 'EnterPlanModeTool',
    file: 'EnterPlanModeTool/EnterPlanModeTool.ts',
    tool: EnterPlanModeTool,
  },
  {
    name: 'ExitPlanModeV2Tool',
    file: 'ExitPlanModeTool/ExitPlanModeV2Tool.ts',
    tool: ExitPlanModeV2Tool,
  },
  {
    name: 'ProposeGoalTool',
    file: 'ProposeGoalTool/ProposeGoalTool.ts',
    tool: ProposeGoalTool,
  },
] as const

const taskListDirsToCleanup: string[] = []
const prevTaskListId = process.env.CLAUDE_CODE_TASK_LIST_ID

function makePermContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

afterEach(async () => {
  clearHandbackDeliveriesForTests()
  if (prevTaskListId === undefined) {
    delete process.env.CLAUDE_CODE_TASK_LIST_ID
  } else {
    process.env.CLAUDE_CODE_TASK_LIST_ID = prevTaskListId
  }
  for (const dir of taskListDirsToCleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Official 2.1.331 Bucket 3 Tool.create(deps) DI Migration (16 tools)', () => {
  test('all 16 tools expose native create(deps), survive Proxy probe without eager deps reads, and instantiate without ALS', () => {
    const probeDeps = new Proxy({} as ToolDeps, {
      get: () => undefined,
    })
    const explicitDeps = createExplicitToolDeps()

    for (const entry of ALL_BUCKET3_TOOLS) {
      expect(typeof entry.tool.create).toBe('function')

      // Must NOT eagerly read or invoke deps.*() before returning the instance
      const probed = entry.tool.create(probeDeps)
      expect(typeof probed.call).toBe('function')

      const inst = entry.tool.create(explicitDeps)
      expect(typeof inst.call).toBe('function')

      // Source check: defines create(deps) inside buildTool rather than legacy top-level call
      const src = readFileSync(join(import.meta.dir, '..', entry.file), 'utf8')
      expect(src).toMatch(/\bcreate\s*\(\s*_?deps/)
    }
  })

  test('TodoWriteTool.create(deps) reads & writes deps.todos and deps.agentId directly (ZERO ALS)', async () => {
    const store = new Map<string, TodoList>()
    const deps = createExplicitToolDeps({
      agentId: asAgentId('agent-todo-di'),
      todos: {
        get: key => store.get(key),
        set: (key, items) => {
          store.set(key, items)
        },
      },
    })

    const inst = TodoWriteTool.create(deps)
    const callCtx = createToolCallContext({ toolUseId: 'tu-todo-1' })

    const perm = await inst.checkPermissions?.({ todos: [] }, callCtx)
    expect(perm?.behavior).toBe('allow')

    const initial: TodoList = [
      {
        content: 'Migrate Bucket 3 tools',
        status: 'in_progress',
        activeForm: 'Migrating Bucket 3 tools',
      },
    ]
    const res1 = await inst.call({ todos: initial }, callCtx)
    expect(res1.data.oldTodos).toEqual([])
    expect(res1.data.newTodos).toEqual(initial)
    expect(store.get('agent-todo-di')).toEqual(initial)

    // Completing all todos clears the persisted list while returning the completed snapshot
    const completed: TodoList = [
      {
        content: 'Migrate Bucket 3 tools',
        status: 'completed',
        activeForm: 'Migrating Bucket 3 tools',
      },
    ]
    const res2 = await inst.call({ todos: completed }, callCtx)
    expect(res2.data.oldTodos).toEqual(initial)
    expect(res2.data.newTodos).toEqual(completed)
    expect(store.get('agent-todo-di')).toEqual([])
  })

  test('EnterPlanModeTool.create(deps) updates permission mode via deps.setToolPermissionContext and blocks subagents', async () => {
    let permCtx = makePermContext({ mode: 'acceptEdits' })
    let setPermCalls = 0
    const deps = createExplicitToolDeps({
      permissions: () => permCtx,
      setToolPermissionContext: update => {
        setPermCalls++
        permCtx = typeof update === 'function' ? update(permCtx) : update
      },
    })

    const res = await EnterPlanModeTool.create(deps).call(
      {},
      createToolCallContext(),
    )
    expect(res.data.message).toContain('Entered plan mode')
    expect(setPermCalls).toBe(1)
    expect(permCtx.mode).toBe('plan')
    expect(permCtx.prePlanMode).toBe('acceptEdits')

    const subagentDeps = createExplicitToolDeps({
      agentId: asAgentId('sub-enter-plan'),
    })
    await expect(
      EnterPlanModeTool.create(subagentDeps).call({}, createToolCallContext()),
    ).rejects.toThrow('EnterPlanMode tool cannot be used in agent contexts')
  })

  test('ExitPlanModeV2Tool.create(deps) validates mode via deps.permissions(), restores prePlanMode on main, and skips mutation for subagents', async () => {
    let permCtx = makePermContext({ mode: 'default' })
    const deps = createExplicitToolDeps({
      loopModel: () => 'claude-sonnet-4-6',
      permissions: () => permCtx,
      setToolPermissionContext: update => {
        permCtx = typeof update === 'function' ? update(permCtx) : update
      },
    })

    const inst = ExitPlanModeV2Tool.create(deps)
    const callCtx = createToolCallContext()

    const outside = await inst.validateInput?.({}, callCtx)
    expect(outside?.result).toBe(false)

    permCtx = makePermContext({ mode: 'plan', prePlanMode: 'acceptEdits' })
    const inside = await inst.validateInput?.({}, callCtx)
    expect(inside?.result).toBe(true)

    const perm = await inst.checkPermissions?.({}, callCtx)
    expect(perm?.behavior).toBe('ask')

    const mainRes = await inst.call({}, callCtx)
    expect(mainRes.data.isAgent).toBe(false)
    expect(permCtx.mode).toBe('acceptEdits')
    expect(permCtx.prePlanMode).toBeUndefined()

    // Subagent exit must not mutate shared permission context
    let subSetCalls = 0
    const subDeps = createExplicitToolDeps({
      agentId: asAgentId('sub-exit-plan'),
      permissions: () => makePermContext({ mode: 'plan', prePlanMode: 'auto' }),
      setToolPermissionContext: () => {
        subSetCalls++
      },
    })
    const subRes = await ExitPlanModeV2Tool.create(subDeps).call({}, callCtx)
    expect(subRes.data.isAgent).toBe(true)
    expect(subSetCalls).toBe(0)
  })

  test('ProposeGoalTool.create(deps) reads deps.agentId directly without ALS', async () => {
    const subagentDeps = createExplicitToolDeps({
      agentId: asAgentId('sub-goal-1'),
    })
    await expect(
      ProposeGoalTool.create(subagentDeps).call(
        { condition: 'all tests pass' },
        createToolCallContext(),
      ),
    ).rejects.toThrow('SetGoal cannot be used in agent contexts')
  })

  test('GetTaskTool.create(deps) reads deps.taskRegistry and enforces deps.agentId ownership', async () => {
    const ownerId = asAgentId('agent-shell-owner')
    const shellTask: LocalShellTaskState = {
      id: 'shell-di-1',
      type: 'local_bash',
      status: 'running',
      description: 'sleep 10',
      command: 'sleep 10',
      startTime: Date.now(),
      outputFile: '/tmp/shell-di-1.output',
      outputOffset: 0,
      notified: false,
      agentId: ownerId,
    } as unknown as LocalShellTaskState

    let state = {
      tasks: { 'shell-di-1': shellTask },
    } as unknown as AppState
    const registry = createTaskRegistry(
      () => state,
      updater => {
        state = updater(state)
      },
    )

    const ownerDeps = createExplicitToolDeps({
      agentId: ownerId,
      taskRegistry: registry,
    })
    const ownerInst = GetTaskTool.create(ownerDeps)
    const callCtx = createToolCallContext({ toolUseId: 'tu-gettask-1' })

    expect(
      await ownerInst.validateInput?.({ taskId: 'missing-id' }, callCtx),
    ).toMatchObject({ result: false, errorCode: 1 })
    expect(
      await ownerInst.validateInput?.({ taskId: 'shell-di-1' }, callCtx),
    ).toEqual({ result: true })

    const res = await ownerInst.call({ taskId: 'shell-di-1' }, callCtx)
    expect(res.data).toMatchObject({
      taskId: 'shell-di-1',
      status: 'working',
    })

    // Different agentId cannot see another agent's shell task
    const otherDeps = createExplicitToolDeps({
      agentId: asAgentId('agent-other'),
      taskRegistry: registry,
    })
    expect(
      await GetTaskTool.create(otherDeps).validateInput?.(
        { taskId: 'shell-di-1' },
        callCtx,
      ),
    ).toMatchObject({ result: false, errorCode: 1 })
  })

  test('TaskStopTool.create(deps) validates & stops tasks directly via deps.tasks and deps.setAppStateForTasks', async () => {
    const memAbort = new AbortController()
    let state = {
      tasks: {
        'pm-di-1': {
          id: 'pm-di-1',
          type: 'post_turn_memory',
          status: 'running',
          description: 'saving memories',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          abortController: memAbort,
        },
      },
    } as unknown as AppState

    const deps = createExplicitToolDeps({
      getAppState: () => state,
      tasks: () => state.tasks,
      setAppStateForTasks: updater => {
        state = updater(state)
      },
      setAppState: updater => {
        state = updater(state)
      },
    })

    const inst = TaskStopTool.create(deps)
    const callCtx = createToolCallContext()

    expect(await inst.validateInput?.({}, callCtx)).toMatchObject({
      result: false,
      errorCode: 1,
    })
    expect(await inst.validateInput?.({ task_id: 'pm-di-1' }, callCtx)).toEqual(
      { result: true },
    )

    const res = await inst.call({ task_id: 'pm-di-1' }, callCtx)
    expect(res.data.task_id).toBe('pm-di-1')
    expect(res.data.task_type).toBe('post_turn_memory')
    expect(memAbort.signal.aborted).toBe(true)
    expect(state.tasks['pm-di-1']?.status).toBe('killed')
  })

  test('SubagentHandbackTool.create(deps) delivers one-shot handback to running parent via deps.tasks & deps.setAppStateForTasks', async () => {
    const childId = asAgentId('agent-child-di-hb')
    const parentId = asAgentId('agent-parent-di-hb')

    let state = {
      tasks: {
        [childId]: {
          id: childId,
          type: 'local_agent',
          agentId: childId,
          agentType: 'Explore',
          status: 'running',
          description: 'explore task',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          handbackContract: true,
          handbackRecipient: parentId,
        },
        [parentId]: {
          id: parentId,
          type: 'local_agent',
          agentId: parentId,
          agentType: 'general-purpose',
          status: 'running',
          description: 'parent task',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          pendingMessages: [],
        },
      },
    } as unknown as AppState

    const deps = createExplicitToolDeps({
      agentId: childId,
      getAppState: () => state,
      tasks: () => state.tasks,
      setAppStateForTasks: updater => {
        state = updater(state)
      },
    })

    const inst = SubagentHandbackTool.create(deps)
    const callCtx = createToolCallContext({ toolUseId: 'tu-hb-di-1' })

    expect(
      await inst.validateInput?.({ message: '   ' }, callCtx),
    ).toMatchObject({ result: false, errorCode: 9 })
    expect(
      await inst.validateInput?.({ message: 'findings ready' }, callCtx),
    ).toEqual({ result: true })
    expect(
      await inst.checkPermissions?.({ message: 'findings ready' }, callCtx),
    ).toEqual({
      behavior: 'allow',
      updatedInput: { message: 'findings ready' },
    })

    const first = await inst.call({ message: 'findings ready' }, callCtx)
    expect(first.data.success).toBe(true)
    expect(first.data.message).toBe('Report delivered to your caller.')

    const parentTask = state.tasks[parentId] as LocalAgentTaskState
    expect(parentTask.pendingMessages?.length).toBe(1)
    expect(parentTask.pendingMessages?.[0]?.text).toContain('findings ready')

    const childTask = state.tasks[childId] as LocalAgentTaskState
    expect(childTask.handbackReport?.text).toBe('findings ready')

    // Second report is refused by the one-report lock
    const second = await inst.call({ message: 'second report' }, callCtx)
    expect(second.data.success).toBe(false)
    expect(second.data.message).toContain('already delivered')
  })

  test('ListPeersTool / ListAgentsTool.create(deps) handles invalid cursor and lists named subagents via deps.tasks', async () => {
    expect(ListPeersTool).toBe(ListAgentsTool)
    const subId = asAgentId('agent-listed-di-1')
    const state = {
      tasks: {
        [subId]: {
          id: subId,
          type: 'local_agent',
          agentId: subId,
          agentType: 'Explore',
          status: 'running',
          description: 'scan repo',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
        },
      },
      agentNameRegistry: new Map([['scanner', subId]]),
    } as unknown as AppState

    const deps = createExplicitToolDeps({
      getAppState: () => state,
      tasks: () => state.tasks,
    })

    const inst = ListPeersTool.create(deps)
    const callCtx = createToolCallContext()

    const badCursor = await inst.call({ cursor: 'bogus-cursor' }, callCtx)
    expect(badCursor.data.listing).toBe(LIST_AGENTS_INVALID_CURSOR_MESSAGE)

    const listingRes = await inst.call({}, callCtx)
    expect(listingRes.data.listing).toContain('scanner')
  })

  test('TaskCreateTool / TaskGetTool / TaskListTool / TaskUpdateTool round-trip directly via create(deps)', async () => {
    const listId = `bucket3-di-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    process.env.CLAUDE_CODE_TASK_LIST_ID = listId
    taskListDirsToCleanup.push(getTasksDir(listId))

    const deps = createExplicitToolDeps()
    const progressEvents: unknown[] = []
    const callCtx = createToolCallContext({
      onProgress: ev => {
        progressEvents.push(ev)
      },
    })

    const created = await TaskCreateTool.create(deps).call(
      {
        subject: 'Verify Bucket 3 DI',
        description: 'Run TaskCreate/Get/List/Update via Tool.create(deps)',
      },
      callCtx,
    )
    const taskId = created.data.task.id
    expect(created.data.task.subject).toBe('Verify Bucket 3 DI')
    expect(progressEvents).toContainEqual({
      type: 'set_expanded_view',
      expandedView: 'tasks',
    })

    const fetched = await TaskGetTool.create(deps).call({ taskId }, callCtx)
    expect(fetched.data.task?.subject).toBe('Verify Bucket 3 DI')
    expect(fetched.data.task?.status).toBe('pending')

    const listed = await TaskListTool.create(deps).call({}, callCtx)
    expect(listed.data.tasks.some(t => t.id === taskId)).toBe(true)

    const updated = await TaskUpdateTool.create(deps).call(
      { taskId, status: 'in_progress' },
      callCtx,
    )
    expect(updated.data.success).toBe(true)
    expect(updated.data.statusChange).toEqual({
      from: 'pending',
      to: 'in_progress',
    })
    expect(typeof updated.contextModifier).toBe('function')

    const deleted = await TaskUpdateTool.create(deps).call(
      { taskId, status: 'deleted' },
      callCtx,
    )
    expect(deleted.data.success).toBe(true)
    expect(
      (await TaskGetTool.create(deps).call({ taskId }, callCtx)).data.task,
    ).toBeNull()
  })

  test('AgentTool.create(deps) checkPermissions reads deps.permissions() and call enforces endedByModel', async () => {
    const defaultDeps = createExplicitToolDeps({
      permissions: () => makePermContext({ mode: 'default' }),
    })
    const inst = AgentTool.create(defaultDeps)
    const callCtx = createToolCallContext()

    const perm = await inst.checkPermissions?.(
      { description: 'inspect', prompt: 'check files' },
      callCtx,
    )
    expect(perm?.behavior).toBe('allow')

    const endedState = {
      ...defaultDeps.getAppState(),
      endedByModel: true,
    } as AppState
    const endedDeps = createExplicitToolDeps({
      getAppState: () => endedState,
    })
    await expect(
      AgentTool.create(endedDeps).call(
        { description: 'inspect', prompt: 'check files' },
        callCtx,
      ),
    ).rejects.toThrow()
  })

  test('SendMessageTool.create(deps) validateInput, checkPermissions, and call work directly without ALS', async () => {
    const callCtx = createToolCallContext()

    const autoDeps = createExplicitToolDeps({
      permissions: () => makePermContext({ mode: 'auto' }),
    })
    const autoInst = SendMessageTool.create(autoDeps)
    expect(
      await autoInst.checkPermissions?.(
        { to: 'worker', message: 'ping' },
        callCtx,
      ),
    ).toMatchObject({ behavior: 'passthrough' })

    const defaultDeps = createExplicitToolDeps({
      permissions: () => makePermContext({ mode: 'default' }),
    })
    const inst = SendMessageTool.create(defaultDeps)
    expect(
      await inst.checkPermissions?.({ to: 'worker', message: 'ping' }, callCtx),
    ).toMatchObject({ behavior: 'allow' })

    // validateInput checks
    expect(
      await inst.validateInput?.({ to: '*', message: 'hi' }, callCtx),
    ).toMatchObject({ result: false, errorCode: 9 })
    expect(
      await inst.validateInput?.({ to: 'worker@team', message: 'hi' }, callCtx),
    ).toMatchObject({ result: false, errorCode: 9 })
    expect(
      await inst.validateInput?.({ to: 'worker', message: '   ' }, callCtx),
    ).toMatchObject({ result: false, errorCode: 9 })
    expect(
      await inst.validateInput?.({ to: 'worker', message: 'hello' }, callCtx),
    ).toEqual({ result: true })

    // Main sending to "main" is refused cleanly
    const selfMain = await inst.call({ to: 'main', message: 'hello' }, callCtx)
    expect(selfMain.data.success).toBe(false)
    expect(selfMain.data.message).toContain('You are the main conversation')

    // Local subagent sending structured team-protocol message is refused via deps.agentId + deps.tasks()
    const workerId = asAgentId('agent-sub-di-1')
    let state = {
      tasks: {
        [workerId]: {
          id: workerId,
          type: 'local_agent',
          agentId: workerId,
          agentType: 'general-purpose',
          status: 'running',
          description: 'worker',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          pendingMessages: [],
        },
      },
      agentNameRegistry: new Map([['worker', workerId]]),
      toolPermissionContext: makePermContext({ mode: 'default' }),
    } as unknown as AppState

    const subDeps = createExplicitToolDeps({
      agentId: workerId,
      getAppState: () => state,
      tasks: () => state.tasks,
    })
    const protoRefusal = await SendMessageTool.create(subDeps).call(
      {
        to: 'team-lead',
        message: { type: 'shutdown_request', reason: 'done' },
      },
      callCtx,
    )
    expect(protoRefusal.data.success).toBe(false)
    expect(protoRefusal.data.message).toContain(
      'cannot be sent by a background subagent',
    )

    // Main delivering plain text to a running named local subagent queues into pendingMessages
    const mainToWorkerDeps = createExplicitToolDeps({
      getAppState: () => state,
      tasks: () => state.tasks,
      setAppState: updater => {
        state = updater(state)
      },
      setAppStateForTasks: updater => {
        state = updater(state)
      },
    })
    const delivered = await SendMessageTool.create(mainToWorkerDeps).call(
      { to: 'worker', message: 'continue scanning' },
      callCtx,
    )
    expect(delivered.data.success).toBe(true)
    const workerTask = state.tasks[workerId] as LocalAgentTaskState
    expect(workerTask.pendingMessages?.length).toBe(1)
    expect(workerTask.pendingMessages?.[0]?.text).toBe('continue scanning')
  })

  test('EnterWorktreeTool.create(deps) and ExitWorktreeTool.create(deps) validateInput & checkPermissions without ALS', async () => {
    const callCtx = createToolCallContext()
    const deps = createExplicitToolDeps({
      cwd: () => '/tmp/bucket3-workspace',
    })

    const enterInst = EnterWorktreeTool.create(deps)
    expect(await enterInst.validateInput?.({}, callCtx)).toEqual({
      result: true,
    })
    expect(await enterInst.checkPermissions?.({}, callCtx)).toEqual({
      behavior: 'allow',
      updatedInput: {},
    })
    const externalPerm = await enterInst.checkPermissions?.(
      { path: 'other-worktree' },
      callCtx,
    )
    expect(externalPerm?.behavior).toBe('ask')
    if (externalPerm?.behavior === 'ask') {
      expect(externalPerm.updatedInput).toEqual({
        path: '/tmp/bucket3-workspace/other-worktree',
      })
    }

    const exitInst = ExitWorktreeTool.create(deps)
    expect(
      await exitInst.validateInput?.({ action: 'keep' }, callCtx),
    ).toMatchObject({ result: false, errorCode: 1 })
    expect(
      await exitInst.checkPermissions?.({ action: 'keep' }, callCtx),
    ).toEqual({ behavior: 'allow', updatedInput: { action: 'keep' } })
    expect(
      await exitInst.checkPermissions?.(
        { action: 'remove', discard_changes: true },
        callCtx,
      ),
    ).toMatchObject({ behavior: 'deny' })
  })
})
