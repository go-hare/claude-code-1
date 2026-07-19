import { describe, expect, test } from 'bun:test'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js'
import {
  collapseIdlePanelRows,
  IDLE_COLLAPSE_THRESHOLD,
  idleSummaryLabel,
  isIdleSummaryRow,
  isPanelListTask,
  remapPanelSelectionIndex,
  wouldCollapseIdlePanelRows,
} from '../panelIdleSummary.js'

function local(id: string, isIdle = false): LocalAgentTaskState {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    description: id,
    startTime: 1,
    pendingMessages: [],
    ...(isIdle ? { isIdle: true } : {}),
  } as unknown as LocalAgentTaskState
}

function teammate(id: string, isIdle: boolean): InProcessTeammateTaskState {
  return {
    id,
    type: 'in_process_teammate',
    status: 'running',
    description: id,
    startTime: 1,
    isIdle,
    shutdownRequested: false,
    awaitingPlanApproval: false,
    pendingUserMessages: [],
    identity: {
      agentId: id,
      agentName: id,
      teamName: 't',
      planModeRequired: false,
      parentSessionId: 'p',
    },
    prompt: '',
    permissionMode: 'default',
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    outputFile: '',
    outputOffset: 0,
    notified: false,
  } as unknown as InProcessTeammateTaskState
}

describe('panelIdleSummary densable G7', () => {
  test('isPanelListTask accepts local agents and teammates', () => {
    expect(isPanelListTask(local('a'))).toBe(true)
    expect(isPanelListTask(teammate('b', true))).toBe(true)
    expect(isPanelListTask({ type: 'local_bash' })).toBe(false)
  })

  test('collapseIdlePanelRows no-op when under threshold', () => {
    const rows = [teammate('1', true), teammate('2', true), teammate('3', true)]
    expect(collapseIdlePanelRows(rows, false)).toEqual(rows)
  })

  test('collapseIdlePanelRows collapses excess idle teammates', () => {
    const rows = Array.from({ length: IDLE_COLLAPSE_THRESHOLD + 2 }, (_, i) =>
      teammate(String(i), true),
    )
    const out = collapseIdlePanelRows(rows, false)
    expect(out.length).toBe(IDLE_COLLAPSE_THRESHOLD + 1)
    const summary = out.find(isIdleSummaryRow)
    expect(summary).toBeTruthy()
    if (summary && isIdleSummaryRow(summary)) {
      expect(summary.taskIds.length).toBe(2)
      expect(idleSummaryLabel(summary.taskIds.length)).toBe('2 idle agents')
    }
    expect(wouldCollapseIdlePanelRows(rows)).toBe(true)
  })

  test('expanded skips collapse', () => {
    const rows = Array.from({ length: 5 }, (_, i) => teammate(String(i), true))
    expect(collapseIdlePanelRows(rows, true)).toEqual(rows)
  })

  test('remapPanelSelectionIndex maps predecessor', () => {
    // index 2 was 'b'; 'b' gone → walk back to 'a' (1-based index 1)
    expect(remapPanelSelectionIndex(2, ['a', 'b', 'c'], ['a', 'c'])).toBe(1)
    // index 3 was 'c'; gone → 'a'
    expect(remapPanelSelectionIndex(3, ['a', 'b', 'c'], ['a'])).toBe(1)
    // index 2 was 'b'; next has 'b' at 0 → 1
    expect(remapPanelSelectionIndex(2, ['a', 'b', 'c'], ['b', 'c'])).toBe(1)
    expect(remapPanelSelectionIndex(0, ['a'], ['a'])).toBe(0)
  })
})
