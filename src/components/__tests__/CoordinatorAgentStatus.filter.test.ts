import { describe, expect, test } from 'bun:test'
import { filterTasksByDecorationContent } from '../CoordinatorAgentStatus.js'
import {
  isLocalAgentPanelActive,
  type LocalAgentTaskState,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js'

function task(id: string): LocalAgentTaskState {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    description: id,
    startTime: 1,
    pendingMessages: [],
  } as unknown as LocalAgentTaskState
}

describe('filterTasksByDecorationContent densable G7', () => {
  test('keeps rows without decoration', () => {
    const tasks = [task('a'), task('b')]
    expect(filterTasksByDecorationContent(tasks, {})).toEqual(tasks)
    expect(filterTasksByDecorationContent(tasks, undefined)).toEqual(tasks)
  })

  test('hides rows with empty decoration content', () => {
    const tasks = [task('a'), task('b')]
    const filtered = filterTasksByDecorationContent(tasks, {
      a: { content: '' },
      b: { content: 'alive' },
    })
    expect(filtered.map(t => t.id)).toEqual(['b'])
  })

  test('keeps rows with non-empty decoration content', () => {
    const tasks = [task('a')]
    expect(
      filterTasksByDecorationContent(tasks, { a: { content: 'x' } }),
    ).toEqual(tasks)
  })
})

describe('isLocalAgentPanelActive panel adopt UX', () => {
  test('PSu completed + adoptResumePending is panel-active (not tick-done)', () => {
    const t = {
      ...task('adopt'),
      status: 'completed' as const,
      adoptResumePending: true,
    }
    expect(isLocalAgentPanelActive(t)).toBe(true)
  })

  test('plain completed is not panel-active', () => {
    const t = {
      ...task('done'),
      status: 'completed' as const,
    }
    expect(isLocalAgentPanelActive(t)).toBe(false)
  })
})
