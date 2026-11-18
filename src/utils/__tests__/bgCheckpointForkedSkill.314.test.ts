import { describe, expect, test } from 'bun:test'
import {
  collectPortableCheckpoint,
  hasCompletedAdoptedForkedSkill,
  rehydrateAdoptedAgents,
  shouldBlockForkedSkillRerun,
} from '../bgCheckpoint.js'

describe('bgCheckpoint forkedSkillName persistence (#1258)', () => {
  test('collectPortableCheckpoint preserves forkedSkillName (1..256 chars) and omits invalid lengths', () => {
    const res = collectPortableCheckpoint({
      tasks: {
        'agent-1': {
          id: 'agent-1',
          type: 'local_agent',
          status: 'running',
          agentId: 'agent-1',
          agentType: 'general-purpose',
          description: 'forked skill task',
          isBackgrounded: true,
          forkedSkillName: 'review-pr',
        },
        'agent-2': {
          id: 'agent-2',
          type: 'local_agent',
          status: 'running',
          agentId: 'agent-2',
          agentType: 'general-purpose',
          description: 'too long skill name',
          isBackgrounded: true,
          forkedSkillName: 'x'.repeat(257),
        },
      },
      cron: [],
      handoffEligibility: new Map([
        ['agent-1', true],
        ['agent-2', true],
      ]),
    })

    expect(res).not.toBeNull()
    expect(res!.payload.agents).toHaveLength(2)
    expect(
      (res!.payload.agents?.[0] as { forkedSkillName?: string })
        .forkedSkillName,
    ).toBe('review-pr')
    expect(
      (res!.payload.agents?.[1] as { forkedSkillName?: string })
        .forkedSkillName,
    ).toBeUndefined()
  })

  test('rehydrateAdoptedAgents restores valid forkedSkillName onto LocalAgentTaskState', async () => {
    const registered: Record<string, unknown>[] = []
    const res = await rehydrateAdoptedAgents(
      [
        {
          agentId: 'agent-adopted-1',
          agentType: 'general-purpose',
          description: 'adopted forked skill',
          forkedSkillName: 'deploy-check',
        },
      ],
      updater => {
        const next = updater({ tasks: {} })
        for (const task of Object.values(next.tasks ?? {})) {
          registered.push(task as Record<string, unknown>)
        }
      },
      { linkTranscripts: false },
    )

    expect(res.adopted).toBe(1)
    expect(registered).toHaveLength(1)
    expect(registered[0]?.forkedSkillName).toBe('deploy-check')
  })

  test('intercepts duplicate rerun of already-completed adopted forked skill after restart', () => {
    const tasks = {
      'agent-adopted-1': {
        id: 'agent-adopted-1',
        type: 'local_agent',
        status: 'completed',
        agentId: 'agent-adopted-1',
        forkedSkillName: 'code-review',
      },
    }
    expect(hasCompletedAdoptedForkedSkill(tasks, 'code-review')).toBe(true)
    expect(hasCompletedAdoptedForkedSkill(tasks, 'verify')).toBe(false)
    expect(shouldBlockForkedSkillRerun(tasks, 'code-review').blocked).toBe(true)
    expect(shouldBlockForkedSkillRerun(tasks, 'verify').blocked).toBe(false)
  })
})
