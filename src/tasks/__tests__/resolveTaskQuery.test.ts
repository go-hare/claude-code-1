import { describe, expect, test } from 'bun:test'
import {
  editDistance,
  formatTaskNotFoundMessage,
  normalizeTaskQueryName,
  resolveTaskQuery,
} from '../resolveTaskQuery.js'

function agent(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    description: id,
    startTime: 1,
    outputFile: `/t/${id}`,
    outputOffset: 0,
    notified: false,
    agentId: id,
    prompt: '',
    agentType: 'general-purpose',
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
    keepaliveReasons: new Set(),
    ...overrides,
  }
}

function teammate(
  taskId: string,
  agentName: string,
  teamName = 'team',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const agentId = `${agentName}@${teamName}`
  return {
    id: taskId,
    type: 'in_process_teammate',
    status: 'running',
    description: agentName,
    startTime: 1,
    outputFile: `/t/${taskId}`,
    outputOffset: 0,
    notified: false,
    identity: {
      agentId,
      agentName,
      teamName,
      planModeRequired: false,
      parentSessionId: 'main',
    },
    prompt: '',
    permissionMode: 'default',
    awaitingPlanApproval: false,
    pendingUserMessages: [],
    isIdle: false,
    shutdownRequested: false,
    ...overrides,
  }
}

describe('normalizeTaskQueryName / editDistance', () => {
  test('G2: NFKC + lower + spaces to dashes', () => {
    expect(normalizeTaskQueryName('  Foo  Bar ')).toBe('foo-bar')
    expect(normalizeTaskQueryName('Researcher')).toBe('researcher')
  })

  test('_er: distance 0 for equal, adjacent transposition ≤1', () => {
    expect(editDistance('abc', 'abc')).toBe(0)
    expect(editDistance('ab', 'ba')).toBe(1)
    expect(editDistance('researcher', 'researcehr')).toBe(1)
  })
})

describe('resolveTaskQuery Elo', () => {
  test('exact agentNameRegistry hit', () => {
    const tasks = { a1: agent('a1') }
    const registry = new Map([['researcher', 'a1']])
    const r = resolveTaskQuery('researcher', tasks as any, () =>
      ({ agentNameRegistry: registry }) as any,
    )
    expect(r.status).toBe('found')
    if (r.status === 'found') expect(r.task.id).toBe('a1')
  })

  test('normalized registry name (spaces / case)', () => {
    const tasks = { a1: agent('a1') }
    const registry = new Map([['Code Reviewer', 'a1']])
    const r = resolveTaskQuery('code reviewer', tasks as any, () =>
      ({ agentNameRegistry: registry }) as any,
    )
    expect(r.status).toBe('found')
    if (r.status === 'found') expect(r.task.id).toBe('a1')
  })

  test('exact teammate agentId', () => {
    const tasks = {
      t1: teammate('t1', 'researcher'),
    }
    const r = resolveTaskQuery('researcher@team', tasks as any)
    expect(r.status).toBe('found')
    if (r.status === 'found') expect(r.task.id).toBe('t1')
  })

  test('exact teammate agentName prefers running', () => {
    const tasks = {
      tOld: teammate('tOld', 'researcher', 'team', { status: 'completed' }),
      tNew: teammate('tNew', 'researcher', 'team'),
    }
    const r = resolveTaskQuery('researcher', tasks as any)
    expect(r.status).toBe('found')
    if (r.status === 'found') expect(r.task.id).toBe('tNew')
  })

  test('ambiguous multi teammate same name', () => {
    const tasks = {
      t1: teammate('t1', 'worker', 'alpha'),
      t2: teammate('t2', 'worker', 'beta'),
    }
    const r = resolveTaskQuery('worker', tasks as any)
    expect(r.status).toBe('ambiguous')
    if (r.status === 'ambiguous') {
      expect(r.message).toContain('Multiple teammates match')
      expect(r.message).toContain('worker@alpha')
      expect(r.message).toContain('worker@beta')
    }
  })

  test('both kinds: teammate name + registry name', () => {
    const tasks = {
      t1: teammate('t1', 'researcher'),
      a1: agent('a1'),
    }
    const registry = new Map([['researcher', 'a1']])
    const r = resolveTaskQuery('researcher', tasks as any, () =>
      ({ agentNameRegistry: registry }) as any,
    )
    expect(r.status).toBe('ambiguous')
    if (r.status === 'ambiguous') {
      expect(r.message).toContain('matches both teammate')
      expect(r.message).toContain('background agent')
    }
  })

  test('local_agent agentId field when map key differs', () => {
    const tasks = {
      mapKey: agent('mapKey', { agentId: 'agent-uuid-xyz', id: 'mapKey' }),
    }
    const r = resolveTaskQuery('agent-uuid-xyz', tasks as any)
    expect(r.status).toBe('found')
    if (r.status === 'found') expect(r.task.id).toBe('mapKey')
  })

  test('not_found suggestion Did you mean via edit distance', () => {
    const tasks = { a1: agent('a1') }
    const registry = new Map([['researcher', 'a1']])
    const r = resolveTaskQuery('researcehr', tasks as any, () =>
      ({ agentNameRegistry: registry }) as any,
    )
    expect(r.status).toBe('not_found')
    if (r.status === 'not_found') {
      expect(r.suggestion).toBe('researcher')
    }
  })

  test('formatTaskNotFoundMessage sas + vlo lists', () => {
    const tasks = {
      t1: teammate('t1', 'alice'),
      a1: agent('a1', { description: 'bg work' }),
      a2: agent('a2', {
        description: 'named',
      }),
    }
    const registry = new Map([['named-agent', 'a2']])
    const msg = formatTaskNotFoundMessage(
      'missing',
      tasks as any,
      () => ({ agentNameRegistry: registry }) as any,
      'named-agent',
      'caller-x',
    )
    expect(msg).toContain('No task found with ID: missing')
    expect(msg).toContain('Did you mean: named-agent?')
    expect(msg).toContain('Running teammates: alice@team')
    expect(msg).toContain('Running named agents: named-agent')
    // a1 is backgrounded, not in registry → vlo list
    expect(msg).toContain('Running background agents:')
    expect(msg).toContain('a1 (bg work)')
  })
})
