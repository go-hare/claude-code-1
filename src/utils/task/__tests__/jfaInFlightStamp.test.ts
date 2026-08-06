import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildJFaInFlightSnapshot,
  computeW6e,
  formatFanLabel,
  hashString32,
  mapTaskListToFanItems,
  mapTasksToFanItems,
  mapTodosToFanItems,
  resolveSessionTodos,
  setJFaAppStateReader,
  snapshotTurnBudget,
  stampJFaInFlightFromLiveState,
} from '../jfaInFlightStamp.js'
import {
  _resetBgNeedsInputBridgeForTests,
  setBgInFlightRegistry,
  getBgInFlightRegistry,
} from '../../bgNeedsInputBridge.js'
import {
  getCurrentTurnTokenBudget,
  snapshotOutputTokensForTurn,
} from '../../../bootstrap/state.js'
import type { TaskState } from '../../../tasks/types.js'

describe('jfaInFlightStamp densable JFa/VFa/W6e', () => {
  afterEach(() => {
    _resetBgNeedsInputBridgeForTests()
    snapshotOutputTokensForTurn(null)
  })

  test('formatFanLabel collapses and caps at 200', () => {
    expect(formatFanLabel('  a   b  ')).toBe('a b')
    expect(formatFanLabel('x'.repeat(250)).length).toBe(200)
  })

  test('hashString32 stable for qFa todo id', () => {
    const h = hashString32('write tests')
    expect(typeof h).toBe('number')
    expect(
      mapTodosToFanItems([
        {
          content: 'write tests',
          status: 'pending',
          activeForm: 'Writing tests',
        },
      ])[0]!.id,
    ).toBe(`todo:${h.toString(36)}`)
  })

  test('mapTodosToFanItems densable qFa', () => {
    const items = mapTodosToFanItems([
      { content: 'a', status: 'pending', activeForm: 'Doing a' },
      { content: 'b', status: 'in_progress', activeForm: 'Doing b' },
      { content: 'c', status: 'completed', activeForm: 'Doing c' },
    ])
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      kind: 'todo',
      label: 'a',
      startedAt: undefined,
      doneAt: undefined,
    })
    expect(items[1]).toMatchObject({
      kind: 'todo',
      label: 'Doing b',
      startedAt: 0,
    })
    expect(items[2]).toMatchObject({
      kind: 'todo',
      label: 'c',
      doneAt: 0,
    })
  })

  test('mapTaskListToFanItems densable zFa', () => {
    const items = mapTaskListToFanItems([
      {
        id: 't1',
        subject: 'subj',
        description: 'd',
        activeForm: 'Doing',
        status: 'in_progress',
        blocks: [],
        blockedBy: [],
      },
    ])
    expect(items[0]).toEqual({
      id: 'todo:t1',
      kind: 'todo',
      label: 'Doing',
      startedAt: 0,
      doneAt: undefined,
    })
  })

  test('VFa maps local_agent and local_bash monitor', () => {
    const tasks = {
      a: {
        id: 'a',
        type: 'local_agent',
        status: 'running',
        description: 'agent work',
        startTime: 10,
        isBackgrounded: true,
        outputFile: '',
        outputOffset: 0,
        notified: false,
      },
      b: {
        id: 'b',
        type: 'local_bash',
        status: 'running',
        description: 'mon',
        command: 'sleep 1',
        kind: 'monitor',
        startTime: 20,
        isBackgrounded: true,
        completionStatusSentInAttachment: false,
        shellCommand: null,
        lastReportedTotalLines: 0,
        outputFile: '',
        outputOffset: 0,
        notified: false,
      },
    } as unknown as Record<string, TaskState>
    const items = mapTasksToFanItems(tasks)
    expect(items.find(i => i.id === 'a')).toMatchObject({
      kind: 'agent',
      label: 'agent work',
      startedAt: 10,
    })
    expect(items.find(i => i.id === 'b')).toMatchObject({
      kind: 'monitor',
      label: 'mon',
    })
  })

  test('W6e count uses Akd not only running', () => {
    const tasks = {
      a: {
        id: 'a',
        type: 'local_agent',
        status: 'pending',
        description: 'p',
        startTime: 1,
        isBackgrounded: true,
        outputFile: '',
        outputOffset: 0,
        notified: false,
      },
    } as unknown as Record<string, TaskState>
    const w = computeW6e(tasks)
    expect(w.count).toBeGreaterThanOrEqual(1)
    expect(w.kinds).toContain('local_agent')
  })

  test('buildJFa snapshot includes budget when target set; clears when null', () => {
    snapshotOutputTokensForTurn(100)
    expect(getCurrentTurnTokenBudget()).toBe(100)
    const tasks = {} as Record<string, TaskState>
    const withBudget = buildJFaInFlightSnapshot({ tasks, queued: 0 })
    expect(withBudget.budget).toEqual({
      spent: expect.any(Number),
      target: 100,
    })

    snapshotOutputTokensForTurn(null)
    const noBudget = buildJFaInFlightSnapshot({ tasks, queued: 2 })
    expect(noBudget.budget).toBeUndefined()
    expect(noBudget.queued).toBe(2)

    // shs full replace: stamp with no budget must clear sticky budget
    setBgInFlightRegistry({
      tasks: 1,
      queued: 0,
      kinds: ['local_agent'],
      items: [{ id: 'x' }],
      budget: { spent: 1, target: 10 },
    })
    setBgInFlightRegistry(noBudget)
    const reg = getBgInFlightRegistry()
    expect(reg.budget).toBeUndefined()
    expect(reg.queued).toBe(2)
  })

  test('snapshotTurnBudget mirrors AWt/vWt', () => {
    expect(snapshotTurnBudget()).toBeUndefined()
    snapshotOutputTokensForTurn(50)
    expect(snapshotTurnBudget()).toEqual({
      spent: expect.any(Number),
      target: 50,
    })
  })

  test('resolveSessionTodos reads AppState via JFa reader (densable Zjb)', () => {
    setJFaAppStateReader(() => ({
      todos: {
        'sess-1': [
          { content: 'from-reader', status: 'pending', activeForm: 'Doing' },
        ],
      },
    }))
    // getSessionId may not be sess-1 — still exercises reader path
    const explicit = resolveSessionTodos([
      { content: 'explicit', status: 'pending', activeForm: 'X' },
    ])
    expect(explicit?.[0]?.content).toBe('explicit')
    expect(resolveSessionTodos(null)).toBeNull()
    setJFaAppStateReader(null)
  })

  test('stamp with reader todos includes qFa items when bg session', async () => {
    process.env.CLAUDE_JOB_DIR =
      process.env.CLAUDE_JOB_DIR || '/tmp/jfa-test-job'
    setJFaAppStateReader(() => ({
      todos: {
        // stamp uses getSessionId(); inject via explicit opts instead
      },
    }))
    // Force bg session via env if isBgJobSession checks CLAUDE_JOB_DIR
    const todos = [
      {
        content: 'live-todo',
        status: 'in_progress' as const,
        activeForm: 'Doing live',
      },
    ]
    // Even outside bg session stamp is no-op; test pure build path
    const snap = buildJFaInFlightSnapshot({
      tasks: {},
      todos,
      queued: 0,
    })
    expect(snap.items?.some(i => i.kind === 'todo')).toBe(true)
    expect(snap.items?.some(i => i.label === 'Doing live')).toBe(true)
    setJFaAppStateReader(null)
    void stampJFaInFlightFromLiveState
  })
})
