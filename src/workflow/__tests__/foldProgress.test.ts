import { describe, expect, test } from 'bun:test'
import type { SdkWorkflowProgress } from '../../types/workflowProgress.js'
import {
  agentDisplayStatus,
  collectFromProgress,
  foldPhaseGroup,
  foldWorkflowPhases,
  groupAgentsByPhase,
  isAgentLive,
} from '../foldProgress.js'

const agent = (
  partial: Partial<Extract<SdkWorkflowProgress, { type: 'workflow_agent' }>> & {
    index: number
  },
): Extract<SdkWorkflowProgress, { type: 'workflow_agent' }> => ({
  type: 'workflow_agent',
  state: 'start',
  ...partial,
})

describe('collectFromProgress', () => {
  test('upserts agents by index and keeps phase titles + logs', () => {
    const items: SdkWorkflowProgress[] = [
      { type: 'workflow_phase', index: 0, title: 'Review', state: 'start' },
      agent({ index: 1, label: 'a', phaseIndex: 0, tokens: 10 }),
      agent({
        index: 1,
        label: 'a-updated',
        phaseIndex: 0,
        tokens: 20,
        state: 'done',
      }),
      agent({ index: 2, label: 'b', phaseIndex: 1 }),
      { type: 'workflow_log', message: 'hello' },
      { type: 'workflow_phase', index: 1, title: 'Verify', state: 'start' },
    ]
    const c = collectFromProgress(items)
    expect(c.agents).toHaveLength(2)
    expect(c.agents[0]).toMatchObject({
      index: 1,
      label: 'a-updated',
      tokens: 20,
      state: 'done',
    })
    expect(c.agents[1]).toMatchObject({ index: 2, label: 'b' })
    expect(c.logs).toEqual(['hello'])
    expect(c.phaseTitles.get(0)?.title).toBe('Review')
    expect(c.phaseTitles.get(1)?.title).toBe('Verify')
  })

  test('handles undefined input', () => {
    const c = collectFromProgress(undefined)
    expect(c.agents).toEqual([])
    expect(c.logs).toEqual([])
    expect(c.phaseTitles.size).toBe(0)
  })
})

describe('groupAgentsByPhase', () => {
  test('returns null when no agent has phaseIndex', () => {
    const agents = [agent({ index: 1, label: 'solo' })]
    expect(groupAgentsByPhase(agents, new Map())).toBeNull()
  })

  test('groups by phaseIndex and uses phase title map', () => {
    const agents = [
      agent({ index: 1, phaseIndex: 0, phaseTitle: 'fallback' }),
      agent({ index: 2, phaseIndex: 0 }),
      agent({ index: 3, phaseIndex: 1 }),
    ]
    const titles = new Map<number, { title?: string }>([
      [0, { title: 'Review' }],
    ])
    const groups = groupAgentsByPhase(agents, titles)
    expect(groups).toHaveLength(2)
    expect(groups![0]).toMatchObject({ phaseIndex: 0, title: 'Review' })
    expect(groups![0]!.agents).toHaveLength(2)
    expect(groups![1]).toMatchObject({ phaseIndex: 1, title: 'Phase 1' })
  })
})

describe('foldPhaseGroup', () => {
  test('status done when all agents done', () => {
    const folded = foldPhaseGroup({
      phaseIndex: 0,
      title: 'R',
      agents: [
        agent({
          index: 1,
          state: 'done',
          tokens: 100,
          startedAt: 10,
          lastProgressAt: 30,
        }),
        agent({
          index: 2,
          state: 'done',
          tokens: 50,
          startedAt: 15,
          lastProgressAt: 40,
        }),
      ],
    })
    expect(folded.status).toBe('done')
    expect(folded.doneCount).toBe(2)
    expect(folded.tokens).toBe(150)
    expect(folded.durationMs).toBe(30)
  })

  test('status failed when any error and all complete', () => {
    const folded = foldPhaseGroup({
      phaseIndex: 0,
      title: 'R',
      agents: [
        agent({ index: 1, state: 'done' }),
        agent({ index: 2, state: 'error', error: 'boom' }),
      ],
    })
    expect(folded.status).toBe('failed')
  })

  test('status running while in flight', () => {
    const folded = foldPhaseGroup({
      phaseIndex: 0,
      title: 'R',
      agents: [
        agent({ index: 1, state: 'start' }),
        agent({ index: 2, state: 'done' }),
      ],
    })
    expect(folded.status).toBe('running')
    expect(folded.doneCount).toBe(1)
  })
})

describe('foldWorkflowPhases', () => {
  test('merges declared phases with live groups', () => {
    const progress: SdkWorkflowProgress[] = [
      { type: 'workflow_phase', index: 0, title: 'Review', state: 'start' },
      agent({
        index: 1,
        phaseIndex: 0,
        phaseTitle: 'Review',
        state: 'done',
        tokens: 10,
      }),
      agent({ index: 2, phaseIndex: 1, phaseTitle: 'Verify', state: 'start' }),
    ]
    const { phases, doneAgents, finishedAgents, totalAgents } =
      foldWorkflowPhases(progress, ['Review', 'Verify'], 0)
    expect(phases).toHaveLength(2)
    expect(phases[0]!.title).toBe('Review')
    expect(phases[0]!.status).toBe('done')
    expect(phases[1]!.title).toBe('Verify')
    expect(phases[1]!.status).toBe('running')
    expect(doneAgents).toBe(1)
    expect(finishedAgents).toBe(1)
    expect(totalAgents).toBe(2)
  })

  test('declaredPhases shows not-started skeleton before agents emit', () => {
    const { phases, totalAgents } = foldWorkflowPhases(
      [],
      ['Review', 'Verify'],
      0,
    )
    expect(phases).toHaveLength(2)
    expect(phases[0]).toMatchObject({ title: 'Review', status: 'not-started' })
    expect(phases[1]).toMatchObject({ title: 'Verify', status: 'not-started' })
    expect(totalAgents).toBe(0)
  })

  test('finishedAgents counts done + error', () => {
    const progress: SdkWorkflowProgress[] = [
      agent({ index: 1, phaseIndex: 0, state: 'done' }),
      agent({ index: 2, phaseIndex: 0, state: 'error', error: 'boom' }),
      agent({ index: 3, phaseIndex: 0, state: 'start' }),
    ]
    const { doneAgents, finishedAgents, totalAgents } = foldWorkflowPhases(
      progress,
      null,
      0,
    )
    expect(doneAgents).toBe(1)
    expect(finishedAgents).toBe(2)
    expect(totalAgents).toBe(3)
  })

  test('agentCountHint raises totalAgents floor', () => {
    const progress: SdkWorkflowProgress[] = [
      agent({ index: 1, state: 'done', phaseIndex: 0 }),
    ]
    const { totalAgents } = foldWorkflowPhases(progress, null, 5)
    expect(totalAgents).toBe(5)
  })

  test('synthetic Agents group when no phaseIndex', () => {
    const progress: SdkWorkflowProgress[] = [
      agent({ index: 1, state: 'start' }),
      agent({ index: 2, state: 'done' }),
    ]
    const { phases } = foldWorkflowPhases(progress, null, 0)
    expect(phases).toHaveLength(1)
    expect(phases[0]!.title).toBe('Agents')
    expect(phases[0]!.agents).toHaveLength(2)
  })
})

describe('agentDisplayStatus / isAgentLive', () => {
  test('maps done/error/skipped/queued/running/interrupted', () => {
    expect(agentDisplayStatus(agent({ index: 1, state: 'done' }), true)).toBe(
      'done',
    )
    expect(
      agentDisplayStatus(
        agent({ index: 1, state: 'done', error: 'skipped by user' }),
        true,
      ),
    ).toBe('skipped')
    expect(agentDisplayStatus(agent({ index: 1, state: 'error' }), true)).toBe(
      'failed',
    )
    expect(
      agentDisplayStatus(
        agent({ index: 1, state: 'error', error: 'skipped by user' }),
        true,
      ),
    ).toBe('skipped')
    expect(
      agentDisplayStatus(
        agent({ index: 1, state: 'start', queuedAt: 1 }),
        true,
      ),
    ).toBe('queued')
    expect(
      agentDisplayStatus(
        agent({ index: 1, state: 'start', startedAt: 1 }),
        true,
      ),
    ).toBe('running')
    expect(agentDisplayStatus(agent({ index: 1, state: 'start' }), false)).toBe(
      'interrupted',
    )
  })

  test('isAgentLive only for state start', () => {
    expect(isAgentLive(agent({ index: 1, state: 'start' }))).toBe(true)
    expect(isAgentLive(agent({ index: 1, state: 'done' }))).toBe(false)
    expect(isAgentLive(agent({ index: 1, state: 'error' }))).toBe(false)
  })
})
