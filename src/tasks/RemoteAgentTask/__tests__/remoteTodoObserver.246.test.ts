/**
 * densable 2.1.246 HAVE #48 — pGn @213791282 remote todo observer.
 *
 * Priority: TaskCreate/TaskUpdate maps (incl. in-flight pendingCreates)
 *           ELSE last TodoWrite snapshot
 *           ELSE []
 * Cache same-ref until observe hits. No padMissing.
 */
import { describe, expect, test } from 'bun:test'
import {
  createRemoteTodoObserver,
  type ObservedRemoteEvent,
} from '../remoteTodoObserver.js'

function assistant(
  blocks: unknown[],
  parent_tool_use_id: string | null = null,
): ObservedRemoteEvent {
  return {
    type: 'assistant',
    parent_tool_use_id,
    message: { content: blocks },
  }
}

function user(blocks: unknown[]): ObservedRemoteEvent {
  return {
    type: 'user',
    message: { content: blocks },
  }
}

function taskCreate(
  id: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return { type: 'tool_use', name: 'TaskCreate', id, input }
}

function taskUpdate(
  id: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return { type: 'tool_use', name: 'TaskUpdate', id, input }
}

function todoWrite(
  todos: Array<{
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    activeForm: string
  }>,
): Record<string, unknown> {
  return {
    type: 'tool_use',
    name: 'TodoWrite',
    id: 'tw1',
    input: { todos },
  }
}

describe('createRemoteTodoObserver (densable 246 pGn)', () => {
  test('TaskCreate pending counts in todos() before result', () => {
    const w = createRemoteTodoObserver()
    w.observe(
      assistant([
        taskCreate('tu_a', { subject: 'Fix login', description: 'extra' }),
      ]),
    )
    expect(w.todos()).toEqual([
      {
        content: 'Fix login',
        activeForm: 'Fix login',
        status: 'pending',
      },
    ])
  })

  test('create result moves pending onto tasks; i2o is tasks then pending', () => {
    const w = createRemoteTodoObserver()
    w.observe(
      assistant([
        taskCreate('tu_a', { subject: 'A', activeForm: 'Doing A' }),
        taskCreate('tu_b', { subject: 'B' }),
      ]),
    )
    w.observe(
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tu_a',
          content: 'Task #task_a created successfully: A',
        },
      ]),
    )
    expect(w.todos()).toEqual([
      { content: 'A', activeForm: 'Doing A', status: 'pending' },
      { content: 'B', activeForm: 'B', status: 'pending' },
    ])
  })

  test('is_error drops the pending create', () => {
    const w = createRemoteTodoObserver()
    w.observe(assistant([taskCreate('tu_a', { subject: 'A' })]))
    w.observe(
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tu_a',
          is_error: true,
          content: 'failed',
        },
      ]),
    )
    expect(w.todos()).toEqual([])
  })

  test('TaskUpdate merge and delete', () => {
    const w = createRemoteTodoObserver()
    w.observe(assistant([taskCreate('tu_a', { subject: 'A' })]))
    w.observe(
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tu_a',
          content: 'Task #t1 created successfully: A',
        },
      ]),
    )
    w.observe(
      assistant([
        taskUpdate('tu_u', {
          taskId: 't1',
          status: 'in_progress',
          subject: 'A2',
          activeForm: 'Doing A2',
        }),
      ]),
    )
    expect(w.todos()).toEqual([
      { content: 'A2', activeForm: 'Doing A2', status: 'in_progress' },
    ])
    w.observe(
      assistant([taskUpdate('tu_d', { taskId: 't1', status: 'deleted' })]),
    )
    expect(w.todos()).toEqual([])
  })

  test('empty Task* falls back to last TodoWrite', () => {
    const w = createRemoteTodoObserver()
    w.observe(
      assistant([
        todoWrite([
          {
            content: 'Old list',
            status: 'completed',
            activeForm: 'Finishing old',
          },
        ]),
      ]),
    )
    expect(w.todos()).toEqual([
      {
        content: 'Old list',
        status: 'completed',
        activeForm: 'Finishing old',
      },
    ])
  })

  test('nonempty Task* wins over TodoWrite', () => {
    const w = createRemoteTodoObserver()
    w.observe(
      assistant([
        todoWrite([
          {
            content: 'Old list',
            status: 'completed',
            activeForm: 'Finishing old',
          },
        ]),
        taskCreate('tu_a', { subject: 'New' }),
      ]),
    )
    expect(w.todos()).toEqual([
      { content: 'New', activeForm: 'New', status: 'pending' },
    ])
  })

  test('cache same-ref until observe hits Task* or TodoWrite', () => {
    const w = createRemoteTodoObserver()
    const empty = w.todos()
    expect(w.todos()).toBe(empty)
    w.observe(assistant([{ type: 'text', text: 'working' }]))
    expect(w.todos()).toBe(empty)
    w.observe(assistant([taskCreate('tu_a', { subject: 'A' })]))
    const next = w.todos()
    expect(next).not.toBe(empty)
    expect(w.todos()).toBe(next)
  })

  test('nested parent_tool_use_id assistant is ignored', () => {
    const w = createRemoteTodoObserver()
    w.observe(
      assistant([taskCreate('tu_a', { subject: 'Nested' })], 'parent_1'),
    )
    expect(w.todos()).toEqual([])
  })

  test('unwraps nested {input} before n2o parse', () => {
    const w = createRemoteTodoObserver()
    w.observe(
      assistant([taskCreate('tu_a', { input: { subject: 'Wrapped' } })]),
    )
    expect(w.todos()).toEqual([
      {
        content: 'Wrapped',
        activeForm: 'Wrapped',
        status: 'pending',
      },
    ])
  })

  test('in-flight pending is counted in total (3/5 miss)', () => {
    const w = createRemoteTodoObserver()
    w.observe(
      assistant([
        taskCreate('tu_1', { subject: 'One' }),
        taskCreate('tu_2', { subject: 'Two' }),
      ]),
    )
    w.observe(
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tu_1',
          content: 'Task #t1 created successfully: One',
        },
        {
          type: 'tool_result',
          tool_use_id: 'tu_2',
          content: 'Task #t2 created successfully: Two',
        },
      ]),
    )
    w.observe(
      assistant([
        taskUpdate('tu_u1', { taskId: 't1', status: 'completed' }),
        taskUpdate('tu_u2', { taskId: 't2', status: 'completed' }),
        taskCreate('tu_3', { subject: 'Three' }),
        taskCreate('tu_4', { subject: 'Four' }),
        taskCreate('tu_5', { subject: 'Five' }),
      ]),
    )
    const list = w.todos()
    expect(list).toHaveLength(5)
    expect(list.filter(t => t.status === 'completed')).toHaveLength(2)
  })
})
