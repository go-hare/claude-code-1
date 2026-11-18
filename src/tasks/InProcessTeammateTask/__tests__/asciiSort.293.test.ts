import { describe, expect, test } from 'bun:test'
import { compareAsciiFirst } from '../../../commands.js'
import { getRunningTeammatesSorted } from '../InProcessTeammateTask.js'
import type { InProcessTeammateTaskState } from '../types.js'

function makeTeammate(agentName: string): InProcessTeammateTaskState {
  return {
    id: `t-${agentName}`,
    type: 'in_process_teammate',
    status: 'running',
    description: agentName,
    toolUseId: 'tu-1',
    startTime: 0,
    outputFile: '',
    outputOffset: 0,
    notified: false,
    identity: {
      agentId: `id-${agentName}`,
      agentName,
      teamName: 'team',
      planModeRequired: false,
      parentSessionId: 'parent-1',
    },
    prompt: 'hi',
    abortController: new AbortController(),
    awaitingPlanApproval: false,
    messages: [],
    pendingUserMessages: [],
    isIdle: false,
    shutdownRequested: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
  } as unknown as InProcessTeammateTaskState
}

describe('v2.1.293 #330 — ASCII-first ordering for lists', () => {
  test('compareAsciiFirst places all ASCII names before non-ASCII names', () => {
    const names = ['éclair', 'zebra', 'alpha', '日本語', 'beta']
    const sorted = [...names].sort(compareAsciiFirst)
    expect(sorted).toEqual(['alpha', 'beta', 'zebra', 'éclair', '日本語'])
  })

  test('getRunningTeammatesSorted places ASCII teammate names before non-ASCII names', () => {
    const tasks = {
      a: makeTeammate('éclair'),
      b: makeTeammate('worker-z'),
      c: makeTeammate('worker-a'),
    }
    expect(
      getRunningTeammatesSorted(tasks).map(t => t.identity.agentName),
    ).toEqual(['worker-a', 'worker-z', 'éclair'])
  })
})
