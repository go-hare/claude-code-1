import { describe, expect, test } from 'bun:test'
import { runWorkflow } from '../runWorkflow.js'
import type { JournalEntry } from '../../types.js'
import {
  createHostHandle,
  type JournalStore,
  type WorkflowPorts,
} from '../../ports.js'

function createInMemoryJournalStore(): JournalStore {
  const store = new Map<string, JournalEntry[]>()
  return {
    async read(runId) {
      return [...(store.get(runId) ?? [])].sort(
        (a, b) => (a.seq ?? 0) - (b.seq ?? 0),
      )
    },
    async append(runId, entry) {
      const list = store.get(runId) ?? []
      list.push(entry)
      store.set(runId, list)
    },
    async truncate(runId) {
      store.delete(runId)
    },
  }
}

function makePorts(
  journalStore: JournalStore,
  runAgentToResult: WorkflowPorts['agentRunner']['runAgentToResult'],
): WorkflowPorts {
  return {
    journalStore,
    progressEmitter: { emit: () => {} },
    logger: { debug: () => {}, event: () => {} },
    permissionGate: { isAborted: () => false },
    hostFactory: () => ({
      handle: createHostHandle(null),
      cwd: '/tmp',
      budgetTotal: null,
    }),
    taskRegistrar: {
      register: opts => ({
        runId: opts.runId ?? 'run',
        signal: new AbortController().signal,
      }),
      complete: () => {},
      fail: () => {},
      kill: () => {},
      pendingAction: () => null,
    },
    agentRunner: { runAgentToResult },
  }
}

describe('#1044 Workflow resume per-slot journal isolation for parallel() and pipeline()', () => {
  test('parallel() resume serves completed agents from journal even when completion order differed', async () => {
    const journalStore = createInMemoryJournalStore()
    const runId = 'run-parallel-resume'
    let calls: string[] = []
    let failSecond = true

    const ports = makePorts(journalStore, async params => {
      calls.push(params.prompt)
      if (params.prompt === 'task-0') {
        await new Promise(r => setTimeout(r, 20))
        return {
          kind: 'ok',
          output: 'res-0',
          usage: { outputTokens: 1 },
        }
      }
      if (failSecond) {
        throw new Error('transient crash')
      }
      return {
        kind: 'ok',
        output: 'res-1',
        usage: { outputTokens: 1 },
      }
    })

    const script = `
      export const meta = { name: 'p', description: 'p' }
      return parallel([
        () => agent('task-0'),
        () => agent('task-1'),
      ])
    `

    await runWorkflow({
      runId,
      script,
      ports,
      host: createHostHandle(null),
      signal: new AbortController().signal,
      cwd: '/tmp',
      budgetTotal: null,
    })
    expect(calls).toEqual(['task-0', 'task-1', 'task-1'])

    const entries = await journalStore.read(runId)
    const onlyTask0 = entries.filter(e => e.result.kind === 'ok')
    await journalStore.truncate(runId)
    for (const e of onlyTask0) {
      await journalStore.append(runId, e)
    }

    calls = []
    failSecond = false
    const resumed = await runWorkflow({
      runId,
      script,
      ports,
      host: createHostHandle(null),
      signal: new AbortController().signal,
      cwd: '/tmp',
      budgetTotal: null,
      resume: true,
    })

    expect(resumed.status).toBe('completed')
    expect(resumed.returnValue).toEqual(['res-0', 'res-1'])
    expect(calls).toEqual(['task-1'])
  })

  test('pipeline() resume serves completed stage agents from journal without re-running', async () => {
    const journalStore = createInMemoryJournalStore()
    const runId = 'run-pipeline-resume'
    let calls: string[] = []

    const ports = makePorts(journalStore, async params => {
      calls.push(params.prompt)
      return {
        kind: 'ok',
        output: `done:${params.prompt}`,
        usage: { outputTokens: 1 },
      }
    })

    const script = `
      export const meta = { name: 'pipe', description: 'pipe' }
      return pipeline(
        ['a', 'b'],
        (item) => agent('s1:' + item),
        (prev, item) => agent('s2:' + item + ':' + prev),
      )
    `

    const r1 = await runWorkflow({
      runId,
      script,
      ports,
      host: createHostHandle(null),
      signal: new AbortController().signal,
      cwd: '/tmp',
      budgetTotal: null,
    })
    expect(r1.status).toBe('completed')
    expect(calls.length).toBe(4)

    calls = []
    const r2 = await runWorkflow({
      runId,
      script,
      ports,
      host: createHostHandle(null),
      signal: new AbortController().signal,
      cwd: '/tmp',
      budgetTotal: null,
      resume: true,
    })
    expect(r2.status).toBe('completed')
    expect(r2.returnValue).toEqual([
      'done:s2:a:done:s1:a',
      'done:s2:b:done:s1:b',
    ])
    expect(calls).toEqual([])
  })
})
