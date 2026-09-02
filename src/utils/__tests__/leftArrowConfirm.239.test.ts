import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  countActiveInFlight,
  evaluateLeftArrowIhtGates,
  formatLeftArrowIhtQueuedToast,
  formatMonitorParkSubtitle,
  LEFT_ARROW_IHT_DRAFT_TOAST,
  LEFT_ARROW_IHT_ENDED_BY_MODEL_TOAST,
  LEFT_ARROW_IHT_PERSISTENCE_TOAST,
  shouldConfirmLeftArrowBackground,
} from '../leftArrowConfirm.js'
import {
  listExitBackgroundItems,
  listExitInFlightItems,
  summarizeAbandonableWork,
} from '../exitBackgroundItems.js'
import type { TaskState } from '../../tasks/types.js'

describe('listExitBackgroundItems (densable Jeh)', () => {
  test('lists running backgrounded shells; skips remote_agent and dream', () => {
    const tasks = {
      a: {
        id: 'a',
        type: 'local_bash',
        status: 'running',
        description: 'sleep 10',
        isBackgrounded: true,
      },
      b: {
        id: 'b',
        type: 'remote_agent',
        status: 'running',
        description: 'cloud',
      },
      c: {
        id: 'c',
        type: 'dream',
        status: 'running',
        description: 'zzz',
      },
      d: {
        id: 'd',
        type: 'local_agent',
        status: 'running',
        description: 'worker',
        isBackgrounded: false,
      },
    } as unknown as Record<string, TaskState>
    const items = listExitBackgroundItems(tasks)
    expect(items.some(i => i.label === 'shell')).toBe(true)
    expect(items.some(i => i.label === 'cloud session')).toBe(false)
    expect(items.some(i => i.label === 'dream')).toBe(false)
    expect(items.some(i => i.label === 'subagent')).toBe(false)
  })

  test('Jeh skips ambient monitor_ws only — keeps ambient monitor_mcp', () => {
    const tasks = {
      ws: {
        id: 'ws',
        type: 'monitor_ws',
        status: 'running',
        description: 'ws ambient',
        ambient: true,
        isBackgrounded: true,
      },
      mcp: {
        id: 'mcp',
        type: 'monitor_mcp',
        status: 'running',
        description: 'mcp ambient',
        ambient: true,
        isBackgrounded: true,
      },
    } as unknown as Record<string, TaskState>
    const items = listExitBackgroundItems(tasks)
    expect(items.some(i => i.detail.includes('ws ambient'))).toBe(false)
    expect(
      items.some(i => i.label === 'monitor' && i.detail.includes('mcp')),
    ).toBe(true)
  })
})

describe('listExitInFlightItems (densable Zeh)', () => {
  test('maps fan kinds via qfE; skips todo and doneAt', () => {
    const items = listExitInFlightItems({
      snapshot: {
        tasks: 2,
        queued: 0,
        kinds: ['local_bash', 'auto_mode_scan'],
        items: [
          { id: '1', kind: 'shell', label: 'sleep 1' },
          { id: '2', kind: 'todo', label: 'write tests' },
          { id: '3', kind: 'agent', label: 'worker', doneAt: 1 },
          { id: '4', kind: 'agent', label: 'live worker' },
        ],
      },
    })
    expect(
      items.some(i => i.label === 'shell' && i.detail.includes('sleep')),
    ).toBe(true)
    expect(
      items.some(i => i.label === 'subagent' && i.detail.includes('live')),
    ).toBe(true)
    expect(items.some(i => i.label === 'todo')).toBe(false)
    expect(items.some(i => i.detail.includes('write tests'))).toBe(false)
    expect(
      items.some(
        i =>
          i.label === 'auto-mode scan' && i.detail.includes('environment scan'),
      ),
    ).toBe(true)
  })

  test('live rebuild from tasks uses fan labels (agent→subagent)', () => {
    const tasks = {
      a: {
        id: 'a',
        type: 'local_agent',
        status: 'running',
        description: 'bg worker',
        isBackgrounded: true,
        startTime: 1,
      },
    } as unknown as Record<string, TaskState>
    const items = listExitInFlightItems({ tasks, todos: null })
    expect(items.some(i => i.label === 'subagent')).toBe(true)
  })
})

describe('leftArrowConfirm helpers (densable Swh/Tgn/tte)', () => {
  test('Tgn empty / singular / plural', () => {
    expect(formatMonitorParkSubtitle(0)).toBe('')
    expect(formatMonitorParkSubtitle(1)).toContain('Artifact comments')
    expect(formatMonitorParkSubtitle(3)).toContain('comments on 3 Artifacts')
  })

  test('Swh false when no active bg work', () => {
    expect(shouldConfirmLeftArrowBackground({})).toBe(false)
  })

  test('Swh true when running backgrounded shell (abandonable)', () => {
    const tasks = {
      a: {
        id: 'a',
        type: 'local_bash',
        status: 'running',
        description: 'sleep',
        isBackgrounded: true,
        // no detach → not handoff eligible
      },
    } as unknown as Record<string, TaskState>
    expect(shouldConfirmLeftArrowBackground(tasks)).toBe(true)
  })

  test('tte does not double-count frameLive on a task', () => {
    const tasks = {
      a: {
        id: 'a',
        type: 'local_bash',
        status: 'running',
        description: 'monitor',
        isBackgrounded: true,
        frameLive: { slug: 'art-1' },
      },
    } as unknown as Record<string, TaskState>
    // gold: count = Qeh.length (+ cron) — frameLive slug is Fan/h8e only
    expect(countActiveInFlight(tasks).count).toBe(1)
  })

  test('rAt summary labels local_bash monitor as monitor not shell', () => {
    const tasks = {
      a: {
        id: 'a',
        type: 'local_bash',
        status: 'running',
        description: 'watch',
        isBackgrounded: true,
        kind: 'monitor',
      },
    } as unknown as Record<string, TaskState>
    const { summary, kinds } = summarizeAbandonableWork(tasks, () => false)
    expect(kinds).toContain('monitor')
    expect(summary).toContain('monitor')
    expect(summary).not.toContain('shell')
  })
})

describe('Lbs visible row budget (densable Gw/uq)', () => {
  test('fullscreen outside modal uses floor(rows/2); modal or classic uses full rows', async () => {
    const { lbsVisibleRowBudget } = await import(
      '../../components/ExitBackgroundWorkDialog.js'
    )
    expect(lbsVisibleRowBudget(40, false, true)).toBe(20)
    expect(lbsVisibleRowBudget(41, false, true)).toBe(20)
    expect(lbsVisibleRowBudget(40, true, true)).toBe(40)
    expect(lbsVisibleRowBudget(40, false, false)).toBe(40)
    expect(lbsVisibleRowBudget(40, true, false)).toBe(40)
    const src = readFileSync(
      join(import.meta.dir, '../../components/ExitBackgroundWorkDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('useIsInsideModal')
    expect(src).toContain('useModalOrTerminalSize')
    expect(src).toContain('isFullscreenActive()')
  })
})

describe('iHt four gates before Ki (densable 239)', () => {
  const idle = { count: 2, kinds: ['local_agent'] }

  test('OA persistence blocks first and emits event', () => {
    const gate = evaluateLeftArrowIhtGates({
      persistenceDisabled: true,
      endedByModel: true,
      queuedCount: 3,
      draft: 'hello',
      inFlight: idle,
    })
    expect(gate).toEqual({
      blocked: true,
      reason: 'persistence',
      toast: LEFT_ARROW_IHT_PERSISTENCE_TOAST,
      emitBlockedEvent: true,
      inflightCount: 2,
    })
  })

  test('endedByModel toast has no tengu_left_arrow_blocked event', () => {
    const gate = evaluateLeftArrowIhtGates({
      persistenceDisabled: false,
      endedByModel: true,
      queuedCount: 3,
      draft: 'hello',
      inFlight: idle,
    })
    expect(gate).toEqual({
      blocked: true,
      reason: 'ended-by-model',
      toast: LEFT_ARROW_IHT_ENDED_BY_MODEL_TOAST,
      emitBlockedEvent: false,
      inflightCount: 2,
    })
  })

  test('WWi queued toast uses queued count as inflight_count', () => {
    expect(formatLeftArrowIhtQueuedToast(1)).toBe(
      'Cannot open agents — 1 queued command would be lost. Run or clear it first.',
    )
    expect(formatLeftArrowIhtQueuedToast(2)).toBe(
      'Cannot open agents — 2 queued commands would be lost. Run or clear them first.',
    )
    const gate = evaluateLeftArrowIhtGates({
      persistenceDisabled: false,
      endedByModel: false,
      queuedCount: 3,
      draft: 'hello',
      inFlight: idle,
    })
    expect(gate).toEqual({
      blocked: true,
      reason: 'queued-commands',
      toast: formatLeftArrowIhtQueuedToast(3),
      emitBlockedEvent: true,
      inflightCount: 3,
    })
  })

  test('Kb draft blocks after queue is clear', () => {
    const gate = evaluateLeftArrowIhtGates({
      persistenceDisabled: false,
      endedByModel: false,
      queuedCount: 0,
      draft: '  unsent  ',
      inFlight: idle,
    })
    expect(gate).toEqual({
      blocked: true,
      reason: 'draft',
      toast: LEFT_ARROW_IHT_DRAFT_TOAST,
      emitBlockedEvent: true,
      inflightCount: 2,
    })
  })

  test('empty draft and no other gates pass', () => {
    expect(
      evaluateLeftArrowIhtGates({
        persistenceDisabled: false,
        endedByModel: false,
        queuedCount: 0,
        draft: '   ',
        inFlight: idle,
      }),
    ).toEqual({ blocked: false })
  })
})

describe('Lbs / LAc Esc is Dialog-only (densable Ln)', () => {
  test('Select has no onCancel — Esc is Dialog onCancel', () => {
    const lbs = readFileSync(
      join(import.meta.dir, '../../components/ExitBackgroundWorkDialog.tsx'),
      'utf8',
    )
    const lac = readFileSync(
      join(import.meta.dir, '../../components/LeftArrowConfirmDialog.tsx'),
      'utf8',
    )
    expect(lbs).toContain(
      '<Select options={options} onChange={handleChange} />',
    )
    expect(lbs).not.toContain("onCancel={() => handleChange('stay')}")
    const lacSelect = lac.slice(lac.indexOf('<Select'))
    expect(lacSelect).toContain('onChange={v => {')
    expect(lacSelect).not.toContain('onCancel=')
    expect(lbs).toContain('Esc is Dialog onCancel only')
    expect(lac).toContain('Esc is Dialog onCancel only')
  })
})
