import { describe, expect, mock, test } from 'bun:test'
import * as realMessageQueue from 'src/utils/messageQueueManager.js'
import type { RunProgress } from '../progress/store.js'
import type { WorkflowService } from '../service.js'

// Capture defaultNotifier enqueue for Jeo stamps (agentId + panel taskId).
// Spread real exports so process-global mock.module does not strip isSlashCommand
// (framework / LocalWorkflow sibling suites import the full surface).
const enqueued: Array<Record<string, unknown>> = []
function messageQueueMock() {
  return {
    ...realMessageQueue,
    enqueuePendingNotification: (cmd: Record<string, unknown>) => {
      enqueued.push(cmd)
    },
  }
}
mock.module('src/utils/messageQueueManager.js', messageQueueMock)
mock.module('../../utils/messageQueueManager.js', messageQueueMock)

function makeMockService(runs: RunProgress[]): {
  service: WorkflowService
  emit: () => void
  setRuns: (runs: RunProgress[]) => void
} {
  let current = runs
  const listeners = new Set<() => void>()
  return {
    service: {
      ports: {},
      launch: async () => ({ runId: 'x' }),
      kill: () => {},
      listRuns: () => current,
      getRun: () => undefined,
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => {
          listeners.delete(fn)
        }
      },
      listNamed: async () => [],
    } as unknown as WorkflowService,
    emit: () => {
      for (const fn of listeners) fn()
    },
    setRuns: r => {
      current = r
    },
  }
}

function makeRun(
  runId: string,
  status: RunProgress['status'],
  overrides: Partial<RunProgress> = {},
): RunProgress {
  return {
    runId,
    workflowName: 'wf',
    status,
    phases: [],
    declaredPhases: [],
    currentPhase: null,
    agents: [],
    agentCount: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('installWorkflowNotifications', () => {
  test('running → completed triggers notification (incl. workflow name)', async () => {
    const { installWorkflowNotifications } = await import('../notifications.js')
    const { service, emit, setRuns } = makeMockService([
      makeRun('r1', 'running'),
    ])
    const calls: string[] = []
    const unsubscribe = installWorkflowNotifications(service, msg =>
      calls.push(msg),
    )

    // first emit: listener records initial running state, no notification
    emit()
    expect(calls.length).toBe(0)

    setRuns([makeRun('r1', 'completed')])
    emit()

    expect(calls.length).toBe(1)
    expect(calls[0]).toMatch(/task-notification/)
    expect(calls[0]).toMatch(/completed successfully/)
    expect(calls[0]).toMatch(/"wf"/)
    unsubscribe()
  })

  test('running → failed triggers notification, includes error text', async () => {
    const { installWorkflowNotifications } = await import('../notifications.js')
    const { service, emit, setRuns } = makeMockService([
      makeRun('r1', 'running'),
    ])
    const calls: string[] = []
    installWorkflowNotifications(service, msg => calls.push(msg))

    emit() // record initial running
    setRuns([makeRun('r1', 'failed', { error: 'agent X boom' })])
    emit()

    expect(calls.length).toBe(1)
    expect(calls[0]).toMatch(/failed/)
    expect(calls[0]).toMatch(/agent X boom/)
  })

  test('running → killed triggers notification', async () => {
    const { installWorkflowNotifications } = await import('../notifications.js')
    const { service, emit, setRuns } = makeMockService([
      makeRun('r1', 'running'),
    ])
    const calls: string[] = []
    installWorkflowNotifications(service, msg => calls.push(msg))

    emit() // record initial running
    setRuns([makeRun('r1', 'killed')])
    emit()

    expect(calls.length).toBe(1)
    expect(calls[0]).toMatch(/was stopped/)
  })

  test('first time seeing run (no prev) does not notify (avoid notifying historical runs on startup)', async () => {
    const { installWorkflowNotifications } = await import('../notifications.js')
    const { service, emit, setRuns } = makeMockService([])
    const calls: string[] = []
    installWorkflowNotifications(service, msg => calls.push(msg))

    // first emit after startup, sees r1 already completed — should not notify (not a transition from running)
    setRuns([makeRun('r1', 'completed')])
    emit()

    expect(calls.length).toBe(0)
  })

  test('running → running does not notify', async () => {
    const { installWorkflowNotifications } = await import('../notifications.js')
    const { service, emit, setRuns } = makeMockService([
      makeRun('r1', 'running'),
    ])
    const calls: string[] = []
    installWorkflowNotifications(service, msg => calls.push(msg))

    emit() // record initial running
    setRuns([makeRun('r1', 'running', { agentCount: 1 })])
    emit()

    expect(calls.length).toBe(0)
  })

  test('already completed run emitting again does not repeat notification', async () => {
    const { installWorkflowNotifications } = await import('../notifications.js')
    const { service, emit, setRuns } = makeMockService([
      makeRun('r1', 'running'),
    ])
    const calls: string[] = []
    installWorkflowNotifications(service, msg => calls.push(msg))

    emit() // record initial running
    setRuns([makeRun('r1', 'completed')])
    emit()
    expect(calls.length).toBe(1)

    emit()
    expect(calls.length).toBe(1)
  })

  test('after unsubscribe no more notifications', async () => {
    const { installWorkflowNotifications } = await import('../notifications.js')
    const { service, emit, setRuns } = makeMockService([
      makeRun('r1', 'running'),
    ])
    const calls: string[] = []
    const unsubscribe = installWorkflowNotifications(service, msg =>
      calls.push(msg),
    )

    emit() // record initial running
    unsubscribe()
    setRuns([makeRun('r1', 'completed')])
    emit()

    expect(calls.length).toBe(0)
  })

  test('passes meta (panel taskId + owner) to custom notifier', async () => {
    const {
      installWorkflowNotifications,
      registerWorkflowNotifyMeta,
      clearWorkflowNotifyMeta,
    } = await import('../notifications.js')
    const { service, emit, setRuns } = makeMockService([
      makeRun('run-resume', 'running'),
    ])
    registerWorkflowNotifyMeta('run-resume', {
      taskId: 'local_workflow_panel_1',
      agentId: 'owner-agent-1',
    })
    const metas: Array<{ taskId?: string; agentId?: string } | undefined> = []
    installWorkflowNotifications(service, (_msg, _runId, meta) => {
      metas.push(meta)
    })
    emit()
    setRuns([makeRun('run-resume', 'completed')])
    emit()
    expect(metas.length).toBe(1)
    expect(metas[0]).toEqual({
      taskId: 'local_workflow_panel_1',
      agentId: 'owner-agent-1',
    })
    clearWorkflowNotifyMeta('run-resume')
  })

  test('defaultNotifier stamps Jeo taskId=panel + agentId=owner (not runId alone)', async () => {
    enqueued.length = 0
    const {
      installWorkflowNotifications,
      registerWorkflowNotifyMeta,
      getWorkflowNotifyMeta,
    } = await import('../notifications.js')
    const { service, emit, setRuns } = makeMockService([
      makeRun('run-from-resume', 'running'),
    ])
    registerWorkflowNotifyMeta('run-from-resume', {
      taskId: 'wf_task_abc',
      agentId: 'owner42',
    })
    // Use default notifier (no custom spy)
    installWorkflowNotifications(service)
    emit()
    setRuns([makeRun('run-from-resume', 'completed')])
    emit()
    expect(enqueued.length).toBe(1)
    expect(enqueued[0]!.mode).toBe('task-notification')
    // Panel taskId for workflow: KA child id — not resume runId.
    expect(enqueued[0]!.taskId).toBe('wf_task_abc')
    expect(enqueued[0]!.agentId).toBe('owner42')
    // Meta cleared after enqueue
    expect(getWorkflowNotifyMeta('run-from-resume')).toBeUndefined()
  })

  test('source-scan: ports registers notify meta with taskId + owner', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    const ports = fs.readFileSync(
      path.join(import.meta.dir, '../ports.ts'),
      'utf8',
    )
    const notif = fs.readFileSync(
      path.join(import.meta.dir, '../notifications.ts'),
      'utf8',
    )
    expect(ports).toContain('registerWorkflowNotifyMeta')
    expect(ports).toMatch(/taskId,\s*\n\s*\.\.\.\(ownerAgentId/)
    expect(notif).toContain('agentId')
    expect(notif).toContain('taskId')
    expect(notif).toContain('registerWorkflowNotifyMeta')
  })
})
