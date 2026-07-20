import { describe, expect, test } from 'bun:test'
import {
  editDistance,
  formatTaskNotFoundMessage,
  normalizeAgentName,
  resolveTaskForStop,
} from '../resolveTaskForStop.js'

function app(tasks: Record<string, any>, registry?: Map<string, string>) {
  return {
    tasks,
    agentNameRegistry: registry ?? new Map(),
  }
}

function teammate(
  id: string,
  name: string,
  team = 'team',
  status: string = 'running',
) {
  return {
    id,
    type: 'in_process_teammate',
    status,
    description: name,
    identity: {
      agentId: `${name}@${team}`,
      agentName: name,
      teamName: team,
      planModeRequired: false,
      parentSessionId: 'sess',
    },
  }
}

function agent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    description: id,
    agentId: id,
    agentType: 'general-purpose',
    isBackgrounded: true,
    ...overrides,
  }
}

describe('resolveTaskForStop (densable Elo)', () => {
  test('normalizeAgentName lowercases and dashes spaces', () => {
    expect(normalizeAgentName('  Foo Bar  ')).toBe('foo-bar')
  })

  test('editDistance is 0 for equal strings', () => {
    expect(editDistance('abc', 'abc')).toBe(0)
    expect(editDistance('abc', 'abd')).toBe(1)
  })

  test('resolves teammate by agentName', () => {
    const getAppState = () =>
      app({
        t1: teammate('t1', 'researcher'),
      }) as any
    const r = resolveTaskForStop('researcher', getAppState)
    expect(r.status).toBe('found')
    if (r.status === 'found') {
      expect(r.taskId).toBe('t1')
    }
  })

  test('resolves named agent via agentNameRegistry', () => {
    const reg = new Map([['builder', 'a1']])
    const getAppState = () =>
      app(
        {
          a1: agent('a1', { description: 'build stuff' }),
        },
        reg,
      ) as any
    const r = resolveTaskForStop('builder', getAppState)
    expect(r.status).toBe('found')
    if (r.status === 'found') {
      expect(r.taskId).toBe('a1')
    }
  })

  test('ambiguous when teammate name matches named agent', () => {
    const reg = new Map([['researcher', 'a1']])
    const getAppState = () =>
      app(
        {
          t1: teammate('t1', 'researcher'),
          a1: agent('a1'),
        },
        reg,
      ) as any
    const r = resolveTaskForStop('researcher', getAppState)
    expect(r.status).toBe('ambiguous')
  })

  test('not_found suggests closest named agent', () => {
    const reg = new Map([['builder', 'a1']])
    const getAppState = () =>
      app(
        {
          a1: agent('a1'),
        },
        reg,
      ) as any
    const r = resolveTaskForStop('buildr', getAppState)
    expect(r.status).toBe('not_found')
    if (r.status === 'not_found') {
      expect(r.suggestion).toBe('builder')
    }
  })

  test('formatTaskNotFoundMessage includes Did you mean', () => {
    const getAppState = () =>
      app({
        a1: agent('a1', { description: 'x' }),
      }) as any
    const msg = formatTaskNotFoundMessage(
      'missing',
      getAppState,
      'a1',
      undefined,
    )
    expect(msg).toContain('No task found with ID: missing')
    expect(msg).toContain('Did you mean: a1?')
    expect(msg).toContain('Running background agents:')
  })
})
