/**
 * densable 2.1.239 footer MJc / ary:
 *   iHs = local_agent completed && DW && isBackgrounded && !cx &&
 *         quietlyParked!==true && keepalive.every(===qFe)
 *   ary = some gpe && evictAfter!==0 && !sXc.has(id) && iHs
 *   mt = !fl() && ary  — fl = screen-reader context
 *   MJc = "/tasks to see subagents"
 * OJc `/diff to hide diff` is hosted in the same footer (willow crate).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { TaskState } from '../../tasks/types.js'
import { IDLE_WINDOW_KEEPALIVE_REASON } from '../task/framework.js'
import {
  hasParkedSubagentsForFooter,
  isParkedIdleWindowSubagent,
} from '../panelIdleSummary.js'

const footer = readFileSync(
  join(
    import.meta.dir,
    '../../components/PromptInput/PromptInputFooterLeftSide.tsx',
  ),
  'utf8',
)
const panel = readFileSync(
  join(import.meta.dir, '../panelIdleSummary.ts'),
  'utf8',
)

function agent(
  id: string,
  extra: Partial<LocalAgentTaskState> = {},
): LocalAgentTaskState {
  return {
    id,
    type: 'local_agent',
    status: 'completed',
    agentType: 'general-purpose',
    description: id,
    startTime: 1,
    pendingMessages: [],
    isBackgrounded: true,
    isIdle: false,
    retain: false,
    diskLoaded: false,
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    ...extra,
  } as LocalAgentTaskState
}

function teammate(id: string): InProcessTeammateTaskState {
  return {
    id,
    type: 'in_process_teammate',
    status: 'running',
    description: id,
    startTime: 1,
    isIdle: false,
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
  } as InProcessTeammateTaskState
}

describe('densable 2.1.239 MJc / ary source lock', () => {
  test('iHs / ary / sXc / jYe expressions match official', () => {
    expect(panel).toContain("e.type === 'local_agent'")
    expect(panel).toContain("e.status === 'completed'")
    expect(panel).toContain('isPanelAgentTask(e)')
    expect(panel).toContain('e.isBackgrounded')
    expect(panel).toContain("'isObserver' in e && e.isObserver === true")
    expect(panel).toContain('e.quietlyParked !== true')
    expect(panel).toContain('IDLE_WINDOW_KEEPALIVE_REASON')
    expect(panel).toContain('n.evictAfter !== 0')
    expect(panel).toContain(
      "if (task.type === 'in_process_teammate') return undefined",
    )
    expect(panel).toContain('o.evictAfter === 0')
  })

  test('footer hosts MJc and mt=!fl()&&ary', () => {
    expect(footer).toContain('/tasks to see subagents')
    expect(footer).toContain('hasParkedSubagentsForFooter')
    expect(footer).toContain('isScreenReaderModeEnabled')
    expect(footer).toContain('key="tasks-subagents"')
    expect(footer).toContain('/diff to hide diff')
    expect(footer).toContain('key="diff-panel"')
    expect(footer).toContain("replTab === 'diff'")
  })

  test('mt suppresses shortcuts and voice, not manage', () => {
    expect(footer).toContain('!hasParkedSubagentsHint')
    expect(footer).toContain('key="manage-tasks"')
    const mjc = footer.indexOf('key="tasks-subagents"')
    const manage = footer.indexOf('key="manage-tasks"')
    expect(mjc).toBeGreaterThan(-1)
    expect(manage).toBeGreaterThan(mjc)
  })
})

describe('densable 2.1.239 iHs', () => {
  test('empty keepalive still passes every(===qFe)', () => {
    expect(isParkedIdleWindowSubagent(agent('a'))).toBe(true)
    expect(
      isParkedIdleWindowSubagent(
        agent('a', {
          keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]),
        }),
      ),
    ).toBe(true)
  })

  test('rejects running, observer, quietlyParked, other keepalive, fg', () => {
    expect(isParkedIdleWindowSubagent(agent('a', { status: 'running' }))).toBe(
      false,
    )
    expect(isParkedIdleWindowSubagent(agent('a', { isObserver: true }))).toBe(
      false,
    )
    expect(
      isParkedIdleWindowSubagent(agent('a', { quietlyParked: true })),
    ).toBe(false)
    expect(
      isParkedIdleWindowSubagent(
        agent('a', { keepaliveReasons: new Set(['agent:x']) }),
      ),
    ).toBe(false)
    expect(
      isParkedIdleWindowSubagent(agent('a', { isBackgrounded: false })),
    ).toBe(false)
    expect(
      isParkedIdleWindowSubagent(agent('a', { agentType: 'main-session' })),
    ).toBe(false)
    expect(isParkedIdleWindowSubagent(teammate('tm'))).toBe(false)
  })
})

describe('densable 2.1.239 ary', () => {
  test('true when a visible iHs row is not the viewed agent', () => {
    const tasks: Record<string, TaskState> = {
      parked: agent('parked'),
      live: agent('live', { status: 'running' }),
    }
    expect(hasParkedSubagentsForFooter(tasks, undefined)).toBe(true)
    expect(hasParkedSubagentsForFooter(tasks, 'live')).toBe(true)
    expect(hasParkedSubagentsForFooter(tasks, 'parked')).toBe(false)
  })

  test('false when evictAfter===0', () => {
    const tasks: Record<string, TaskState> = {
      parked: agent('parked', { evictAfter: 0 }),
    }
    expect(hasParkedSubagentsForFooter(tasks, undefined)).toBe(false)
  })

  test('viewing a teammate does not hide parked local_agents', () => {
    const tasks: Record<string, TaskState> = {
      parked: agent('parked'),
      tm: teammate('tm'),
    }
    expect(hasParkedSubagentsForFooter(tasks, 'tm')).toBe(true)
  })

  test('jYe skips iHs parents so a running child still surfaces them', () => {
    const tasks: Record<string, TaskState> = {
      parked: agent('parked'),
      child: agent('child', {
        status: 'running',
        parentAgentId: 'parked',
      }),
    }
    expect(hasParkedSubagentsForFooter(tasks, 'child')).toBe(true)
  })
})
