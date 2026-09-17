/**
 * densable 2.1.246 #13 — ← confirm before restarting workflow subagents.
 * Official Pr / j / ge / Ko / wr.
 */
import { describe, expect, test } from 'bun:test'
import type { TaskState } from '../../tasks/types.js'
import type { SdkWorkflowAgentProgress } from '../../types/workflowProgress.js'
import {
  countWorkflowAgents,
  formatWorkflowAgentsConfirmLabel,
  formatWorkflowAgentsSubtitle,
  shouldConfirmLeftArrowBackground,
} from '../leftArrowConfirm.js'

function agent(
  index: number,
  state: SdkWorkflowAgentProgress['state'],
  extra: Partial<SdkWorkflowAgentProgress> = {},
): SdkWorkflowAgentProgress {
  return { type: 'workflow_agent', index, state, ...extra }
}

function workflow(id: string, progress: SdkWorkflowAgentProgress[]): TaskState {
  return {
    id,
    type: 'local_workflow',
    status: 'running',
    description: 'wf',
    workflowName: 'spec',
    workflowFile: '/tmp/spec.ts',
    workflowProgress: progress,
    progressVersion: progress.length,
    agentCount: progress.length,
    totalTokens: 0,
    totalToolCalls: 0,
  } as unknown as TaskState
}

describe('densable 2.1.246 #13 Pr/j/ge workflowAgents', () => {
  test('j: running only / kept finished / rerun after failed', () => {
    expect(
      formatWorkflowAgentsSubtitle({ running: 0, finished: 2, rerun: 1 }),
    ).toBe('')
    expect(
      formatWorkflowAgentsSubtitle({ running: 1, finished: 0, rerun: 0 }),
    ).toBe('1 running workflow subagent restarts from the beginning.')
    expect(
      formatWorkflowAgentsSubtitle({ running: 2, finished: 3, rerun: 0 }),
    ).toBe(
      '2 running workflow subagents restart from the beginning; 3 finished subagents are kept.',
    )
    expect(
      formatWorkflowAgentsSubtitle({ running: 1, finished: 1, rerun: 1 }),
    ).toBe(
      '1 running workflow subagent restarts from the beginning; 1 finished subagent is kept; 1 that finished after a failed one runs again.',
    )
  })

  test('ge: abandon summary wins; else running+rerun restart count', () => {
    const running = { running: 2, finished: 1, rerun: 1 }
    expect(formatWorkflowAgentsConfirmLabel(true, running)).toBe(
      'Background anyway (tasks will be stopped)',
    )
    expect(formatWorkflowAgentsConfirmLabel(false, running)).toBe(
      'Background anyway (3 subagents restart)',
    )
    expect(
      formatWorkflowAgentsConfirmLabel(false, {
        running: 1,
        finished: 0,
        rerun: 0,
      }),
    ).toBe('Background anyway (1 subagent restarts)')
    expect(
      formatWorkflowAgentsConfirmLabel(false, {
        running: 0,
        finished: 2,
        rerun: 0,
      }),
    ).toBe('Background')
  })

  test('Pr: queued start is not running; done after first error is rerun', () => {
    const eligibility = new Map([['w', true]])
    const tasks = {
      w: workflow('w', [
        agent(0, 'done'),
        agent(1, 'error'),
        agent(2, 'done'),
        agent(3, 'progress'),
        agent(4, 'start', { queuedAt: 10 }),
        agent(5, 'start', { queuedAt: 10, startedAt: 20 }),
      ]),
    }
    expect(countWorkflowAgents(tasks, eligibility)).toEqual({
      running: 2,
      finished: 1,
      rerun: 1,
    })
  })

  test('Ko: finished-only workflow does not trip Pr.running', () => {
    const eligibility = new Map([['w', true]])
    const tasks = {
      w: {
        ...workflow('w', [agent(0, 'done'), agent(1, 'done')]),
        status: 'completed',
      } as unknown as TaskState,
    }
    expect(countWorkflowAgents(tasks, eligibility)).toEqual({
      running: 0,
      finished: 2,
      rerun: 0,
    })
    expect(shouldConfirmLeftArrowBackground(tasks)).toBe(false)
  })

  test('Ko: adopt-ready running workflow forces LAc', () => {
    const tasks = {
      w: {
        ...workflow('w', [agent(0, 'progress')]),
        scriptPath: '/tmp/spec.ts',
        workflowRunId: 'run-1',
        abortController: { abort() {} },
      } as unknown as TaskState,
    }
    expect(shouldConfirmLeftArrowBackground(tasks)).toBe(true)
  })
})
