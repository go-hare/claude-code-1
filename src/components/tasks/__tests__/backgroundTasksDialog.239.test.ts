/**
 * densable 2.1.239 xCs (BackgroundTasksDialog):
 *   t5c = type !== mcp_task && type !== monitor_ws
 *   Zqg = local_agent completed && quietlyParked !== true
 *   kCs = list row whose task is Zqg (Enter → foreground, not detail)
 *   r5c = completed local_agent parked-idle filter, else bO
 *   x on monitor_ws → killMonitorWs / oF({userStop, taskStop})
 *   no invented MonitorWs detail host
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getIsInteractive, setIsInteractive } from '../../../bootstrap/state.js'
import type { LocalAgentTaskState } from '../../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { TaskState } from '../../../tasks/types.js'
import { IDLE_WINDOW_KEEPALIVE_REASON } from '../../../utils/task/framework.js'
import {
  canOpenBackgroundTaskDetail,
  isBackgroundTasksDialogRow,
  isCompletedAgentListItem,
  isCompletedUnparkedLocalAgent,
  isStoppableCompletedKeepaliveAgent,
} from '../BackgroundTasksDialog.js'

const dialog = readFileSync(
  join(import.meta.dir, '../BackgroundTasksDialog.tsx'),
  'utf8',
)

function agent(extra: Partial<LocalAgentTaskState> = {}): LocalAgentTaskState {
  return {
    id: extra.id ?? 'a',
    type: 'local_agent',
    status: 'completed',
    agentType: 'general-purpose',
    description: 'a',
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

describe('densable 2.1.239 xCs t5c / Zqg / kCs / r5c', () => {
  test('t5c opens detail for local hosts, not monitor_ws or mcp_task', () => {
    expect(canOpenBackgroundTaskDetail('local_bash')).toBe(true)
    expect(canOpenBackgroundTaskDetail('monitor_mcp')).toBe(true)
    expect(canOpenBackgroundTaskDetail('monitor_ws')).toBe(false)
    expect(canOpenBackgroundTaskDetail('mcp_task')).toBe(false)
  })

  test('Zqg is completed local_agent that is not quietly parked', () => {
    expect(isCompletedUnparkedLocalAgent(agent())).toBe(true)
    expect(isCompletedUnparkedLocalAgent(agent({ quietlyParked: true }))).toBe(
      false,
    )
    expect(isCompletedUnparkedLocalAgent(agent({ status: 'running' }))).toBe(
      false,
    )
  })

  test('kCs is a local_agent list row whose task is Zqg', () => {
    expect(
      isCompletedAgentListItem({ type: 'local_agent', task: agent() }),
    ).toBe(true)
    expect(
      isCompletedAgentListItem({
        type: 'local_agent',
        task: agent({ quietlyParked: true }),
      }),
    ).toBe(false)
    expect(
      isCompletedAgentListItem({ type: 'monitor_ws', task: agent() }),
    ).toBe(false)
  })

  test('r5c keeps parked-idle completed agents and running bO tasks', () => {
    expect(
      isBackgroundTasksDialogRow(
        agent({
          keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]),
        }),
      ),
    ).toBe(true)
    expect(
      isBackgroundTasksDialogRow(
        agent({
          keepaliveReasons: new Set(['agent:other']),
        }),
      ),
    ).toBe(false)
    expect(isBackgroundTasksDialogRow(agent({ isObserver: true }))).toBe(false)
    const running = agent({ status: 'running' }) as TaskState
    expect(isBackgroundTasksDialogRow(running)).toBe(true)
    expect(
      isBackgroundTasksDialogRow(
        agent({ isBackgrounded: false, status: 'running' }),
      ),
    ).toBe(false)
  })
})

describe('densable 2.1.239 xCs source lock', () => {
  test('auto-open and Enter use t5c + Zqg / kCs', () => {
    expect(dialog).toContain('canOpenBackgroundTaskDetail(only.type)')
    expect(dialog).toContain('isCompletedUnparkedLocalAgent(only)')
    expect(dialog).toContain('isCompletedAgentListItem(current)')
    expect(dialog).toContain("onDone('Viewing agent'")
    expect(dialog).toContain('enterTeammateView(current.id, setAppState)')
  })

  test('x stops running monitor_ws via killMonitorWs', () => {
    expect(dialog).toContain("currentSelection.type === 'monitor_ws'")
    expect(dialog).toContain('killMonitorWs(currentSelection.id, setAppState)')
    expect(dialog).toContain("currentSelection?.type === 'monitor_ws'")
  })

  test('does not invent a MonitorWs detail host', () => {
    expect(dialog).toContain("case 'monitor_ws':")
    expect(dialog).not.toContain('MonitorWsDetailDialog')
    expect(dialog).toContain('fall through to list')
    expect(dialog).toMatch(/case 'monitor_ws':\s*[\s\S]*?break;/)
    expect(dialog).not.toMatch(/case 'monitor_ws':\s*[\s\S]*?return null/)
  })

  test('local_agent detail forwards official Qzc onForeground when DW', () => {
    expect(dialog).toContain('isPanelAgentTask(task)')
    expect(dialog).toContain('onForeground=')
    expect(dialog).toContain("onDone('Viewing agent'")
  })

  test('completed agents get their own xCs section', () => {
    expect(dialog).toContain('completedAgentTasks')
    expect(dialog).toContain("{'  '}Completed")
  })
})

describe('densable 2.1.239 xCs sK / copy', () => {
  let prevInteractive: boolean

  beforeEach(() => {
    prevInteractive = getIsInteractive()
    setIsInteractive(true)
  })

  afterEach(() => {
    setIsInteractive(prevInteractive)
  })

  test('sK is completed local_agent with nonempty keepalive Set while interactive', () => {
    expect(
      isStoppableCompletedKeepaliveAgent(
        agent({ keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]) }),
      ),
    ).toBe(true)
    expect(
      isStoppableCompletedKeepaliveAgent(
        agent({ keepaliveReasons: new Set() }),
      ),
    ).toBe(false)
    expect(
      isStoppableCompletedKeepaliveAgent(
        agent({
          status: 'running',
          keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]),
        }),
      ),
    ).toBe(false)
    setIsInteractive(false)
    expect(
      isStoppableCompletedKeepaliveAgent(
        agent({ keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]) }),
      ),
    ).toBe(false)
  })

  test('x and stop hint use sK; title/section/dismiss match official', () => {
    expect(dialog).toContain('isStoppableCompletedKeepaliveAgent')
    expect(dialog).toContain('title="Background"')
    expect(dialog).toContain("{'  '}Cloud agents")
    expect(dialog).toContain("{'  '}Local agents")
    expect(dialog).toContain("{'  '}Dynamic workflows")
    expect(dialog).not.toContain('Remote agents')
    expect(dialog).toContain(
      "onDone('Background dialog dismissed', { display: 'skip' })",
    )
    expect(dialog).toContain("onDone('Viewing agent', { display: 'system' })")
  })

  test('kill-all hint is Z: selected local_agent and running count > 1', () => {
    expect(dialog).toContain("currentSelection.type === 'local_agent'")
    expect(dialog).toContain(
      "count(agentTasks, t => t.status === 'running') > 1",
    )
    expect(dialog).not.toContain("agentTasks.some(t => t.status === 'running')")
  })
})
