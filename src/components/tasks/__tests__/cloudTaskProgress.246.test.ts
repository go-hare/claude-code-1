/**
 * densable 2.1.246 HAVE #48 — cloud bg 3/5 missing a task.
 *
 * Official Ie @229463832 = RemoteSessionProgress:
 *   empty todoList → `${status}…`
 *   else children [Te(todoList,vu), "/", todoList.length]
 * Official poll kGn @213807560: todoList: W.todos() while running.
 * W = pGn @213791282 (TaskCreate pending + TaskUpdate + TodoWrite fallback).
 * Skip only when (running|starting) && ge===et.todoList &&
 * reviewProgress===undefined.
 *
 * Count is whatever todos() returns. Invent-ban: padMissing / second counter.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const progress = readFileSync(
  join(import.meta.dir, '../RemoteSessionProgress.tsx'),
  'utf8',
)
const poll = readFileSync(
  join(import.meta.dir, '../../../tasks/RemoteAgentTask/RemoteAgentTask.tsx'),
  'utf8',
)
const observer = readFileSync(
  join(import.meta.dir, '../../../tasks/RemoteAgentTask/remoteTodoObserver.ts'),
  'utf8',
)

describe('HAVE #48 cloud task progress (2.1.246)', () => {
  test('client count is todoList completed/total — no padMissing', () => {
    expect(progress).toContain('session.todoList')
    expect(progress).toContain('{completed}/{total}')
    expect(progress).toContain("_.status === 'completed'")
    expect(progress).not.toContain('missing a task')
    expect(progress).not.toContain('padMissing')
  })

  test('poll source is pGn observer.todos() — official skip', () => {
    expect(poll).toContain('createRemoteTodoObserver')
    expect(poll).toContain('observer.observe(ev)')
    expect(poll).toContain('observer.todos()')
    expect(poll).toContain(
      'todoList === prevTask.todoList && newProgress === undefined',
    )
    expect(poll).not.toContain('extractTodoListFromLog(accumulatedLog)')
    expect(poll).not.toContain('padMissing')
    expect(observer).toContain('pendingCreates')
    expect(observer).toContain('TASK_CREATE_TOOL_NAME')
    expect(observer).toContain('TASK_UPDATE_TOOL_NAME')
    expect(observer).toContain('TODO_WRITE_TOOL_NAME')
    expect(observer).toContain('Task #(\\S+) created successfully')
  })
})
