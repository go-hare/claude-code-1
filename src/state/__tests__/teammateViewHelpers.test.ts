import { describe, expect, test } from 'bun:test'
import {
  enterTeammateView,
  exitTeammateView,
  stopOrDismissAgent,
} from '../teammateViewHelpers.js'
import type { AppState } from '../AppState.js'

type Tasks = NonNullable<AppState['tasks']>

function makeLocalAgent(
  id: string,
  overrides: Record<string, unknown> = {},
): Tasks[string] {
  return {
    id,
    type: 'local_agent',
    status: 'completed',
    description: 'agent',
    startTime: Date.now(),
    notified: true,
    retain: false,
    diskLoaded: true,
    messages: [{ type: 'user', message: { role: 'user', content: 'hi' } }],
    ...overrides,
  } as unknown as Tasks[string]
}

function makeTeammate(
  id: string,
  overrides: Record<string, unknown> = {},
): Tasks[string] {
  return {
    id,
    type: 'in_process_teammate',
    status: 'running',
    description: 'teammate',
    startTime: Date.now(),
    notified: false,
    isIdle: false,
    shutdownRequested: false,
    awaitingPlanApproval: false,
    permissionMode: 'default',
    pendingUserMessages: [],
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    identity: {
      agentId: id,
      agentName: id,
      teamName: 't',
      color: 'red',
      planModeRequired: false,
    },
    prompt: 'hi',
    ...overrides,
  } as unknown as Tasks[string]
}

function store(tasks: Tasks = {}, extra: Partial<AppState> = {}) {
  let state = {
    tasks,
    viewingAgentTaskId: undefined as string | undefined,
    viewSelectionMode: 'none' as AppState['viewSelectionMode'],
    ...extra,
  }
  const setAppState = (updater: (prev: AppState) => AppState) => {
    state = updater(state as AppState) as typeof state
  }
  return {
    setAppState,
    get: () => state,
  }
}

describe('teammateViewHelpers densable Aba/wba/gze/nie', () => {
  test('enter local_agent sets retain true and clears evictAfter', () => {
    const { setAppState, get } = store({
      a: makeLocalAgent('a', { retain: false, evictAfter: 123 }),
    })
    enterTeammateView('a', setAppState)
    const t = get().tasks.a as { retain?: boolean; evictAfter?: number }
    expect(get().viewingAgentTaskId).toBe('a')
    expect(get().viewSelectionMode).toBe('viewing-agent')
    expect(t.retain).toBe(true)
    expect(t.evictAfter).toBeUndefined()
  })

  test('enter in_process_teammate clears evictAfter without retain', () => {
    // densable gze: Cba? retain : only evictAfter void
    const { setAppState, get } = store({
      tm: makeTeammate('tm', { isIdle: true, evictAfter: 99 }),
    })
    enterTeammateView('tm', setAppState)
    const t = get().tasks.tm as {
      retain?: boolean
      evictAfter?: number
      isIdle?: boolean
    }
    expect(get().viewingAgentTaskId).toBe('tm')
    expect(t.retain).toBeUndefined()
    expect(t.evictAfter).toBeUndefined()
    expect(t.isIdle).toBe(true)
  })

  test('exit in_process_teammate idle sets grace evictAfter (Aba teammate)', () => {
    const { setAppState, get } = store(
      { tm: makeTeammate('tm', { isIdle: true }) },
      { viewingAgentTaskId: 'tm', viewSelectionMode: 'viewing-agent' },
    )
    const before = Date.now()
    exitTeammateView(setAppState)
    const t = get().tasks.tm as { evictAfter?: number }
    expect(get().viewingAgentTaskId).toBeUndefined()
    expect(get().viewSelectionMode).toBe('none')
    expect(t.evictAfter).toBeGreaterThanOrEqual(before + 29_000)
    expect(t.evictAfter).toBeLessThanOrEqual(Date.now() + 31_000)
  })

  test('exit in_process_teammate non-idle clears evictAfter', () => {
    const { setAppState, get } = store(
      { tm: makeTeammate('tm', { isIdle: false, evictAfter: 1 }) },
      { viewingAgentTaskId: 'tm', viewSelectionMode: 'viewing-agent' },
    )
    exitTeammateView(setAppState)
    const t = get().tasks.tm as { evictAfter?: number }
    expect(t.evictAfter).toBeUndefined()
  })

  test('switch away Aba-releases previous viewable (incl teammate)', () => {
    const { setAppState, get } = store(
      {
        tm: makeTeammate('tm', { isIdle: true }),
        a: makeLocalAgent('a', { retain: false }),
      },
      { viewingAgentTaskId: 'tm', viewSelectionMode: 'viewing-agent' },
    )
    enterTeammateView('a', setAppState)
    const tm = get().tasks.tm as { evictAfter?: number }
    const a = get().tasks.a as { retain?: boolean }
    expect(get().viewingAgentTaskId).toBe('a')
    expect(a.retain).toBe(true)
    expect(tm.evictAfter).toBeGreaterThan(0)
  })

  test('exit local_agent drops retain and schedules terminal eviction', () => {
    const { setAppState, get } = store(
      {
        a: makeLocalAgent('a', {
          status: 'completed',
          retain: true,
          diskLoaded: true,
        }),
      },
      { viewingAgentTaskId: 'a', viewSelectionMode: 'viewing-agent' },
    )
    exitTeammateView(setAppState)
    const a = get().tasks.a as {
      retain?: boolean
      diskLoaded?: boolean
      messages?: unknown
      evictAfter?: number
    }
    expect(a.retain).toBe(false)
    expect(a.diskLoaded).toBe(false)
    expect(a.messages).toBeUndefined()
    expect(a.evictAfter).toBeGreaterThan(0)
  })

  test('stopOrDismissAgent is Cba-only (ignores in_process_teammate)', () => {
    const { setAppState, get } = store({
      tm: makeTeammate('tm', { isIdle: true }),
    })
    stopOrDismissAgent('tm', setAppState)
    expect(get().tasks.tm).toEqual(
      expect.objectContaining({ type: 'in_process_teammate', isIdle: true }),
    )
  })

  test('stopOrDismissAgent dismisses terminal local_agent with evictAfter 0', () => {
    const { setAppState, get } = store({
      a: makeLocalAgent('a', { status: 'completed', retain: true }),
    })
    stopOrDismissAgent('a', setAppState)
    const a = get().tasks.a as { evictAfter?: number; retain?: boolean }
    expect(a.evictAfter).toBe(0)
    expect(a.retain).toBe(false)
  })
})
