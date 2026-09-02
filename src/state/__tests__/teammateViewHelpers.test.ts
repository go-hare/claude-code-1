import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const analyticsSnap = {
  logEvent: () => {},
}

mock.module('src/services/analytics/index.js', () => ({
  logEvent: analyticsSnap.logEvent,
}))

import { enterTeammateView } from '../teammateViewHelpers.js'
import type { AppState } from '../AppState.js'

function apply(
  prev: Pick<AppState, 'tasks' | 'viewingAgentTaskId' | 'viewSelectionMode'>,
  taskId: string,
): Pick<AppState, 'tasks' | 'viewingAgentTaskId' | 'viewSelectionMode'> {
  let next = prev
  enterTeammateView(taskId, updater => {
    next = updater(prev as AppState)
  })
  return next
}

describe('enterTeammateView', () => {
  beforeAll(() => {
    mock.module('src/services/analytics/index.js', () => ({
      ...analyticsSnap,
    }))
  })

  afterAll(() => {
    mock.module('src/services/analytics/index.js', () => ({
      ...analyticsSnap,
    }))
  })

  test('unknown task id does not set viewingAgentTaskId (no flash auto-exit)', () => {
    const prev = {
      tasks: {},
      viewingAgentTaskId: undefined,
      viewSelectionMode: 'none' as const,
    }
    const next = apply(prev, 'missing-agent')
    expect(next).toBe(prev)
    expect(next.viewingAgentTaskId).toBeUndefined()
    expect(next.viewSelectionMode).toBe('none')
  })

  test('source: teammate Enter accepts return and enter', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../hooks/useBackgroundTaskNavigation.ts'),
      'utf8',
    )
    expect(src).toMatch(/e\.key === 'return' \|\| e\.key === 'enter'/)
  })
})
