import { describe, expect, test } from 'bun:test'
import {
  formatPrintBudgetHaltStderr,
  formatSubagentBudgetExhaustedMessage,
  isBudgetHaltableTask,
  isMaxBudgetUsdReached,
  shouldHaltBackgroundAgentsForBudget,
} from '../budgetHalt.js'
import type { TaskState } from '../../tasks/types.js'

// cost-tracker getTotalCost is live process state — use large/small caps
// relative to whatever current session cost is (usually 0 in unit tests).

function agent(
  id: string,
  opts: {
    status?: 'running' | 'completed' | 'pending'
    isObserver?: boolean
    isBackgrounded?: boolean
    stoppedByUser?: boolean
  } = {},
): TaskState {
  return {
    id,
    type: 'local_agent',
    status: opts.status ?? 'running',
    description: `agent ${id}`,
    toolUseId: `tu-${id}`,
    startTime: Date.now(),
    totalPausedMs: 0,
    isBackgrounded: opts.isBackgrounded ?? true,
    isObserver: opts.isObserver,
    stoppedByUser: opts.stoppedByUser,
    agentId: id,
    agentType: 'general-purpose',
    messages: [],
  } as unknown as TaskState
}

describe('budgetHalt densable 2.1.217 #20', () => {
  test('Hrr: undefined budget never reached', () => {
    expect(isMaxBudgetUsdReached(undefined)).toBe(false)
  })

  test('Hrr: 0 budget is reached when cost >= 0', () => {
    // session cost is typically 0 in tests
    expect(isMaxBudgetUsdReached(0)).toBe(true)
  })

  test('Hrr: huge budget not reached at zero cost', () => {
    expect(isMaxBudgetUsdReached(1_000_000)).toBe(false)
  })

  test('iSe: non-observer local_agent is haltable; observer is not', () => {
    expect(isBudgetHaltableTask(agent('a'))).toBe(true)
    expect(isBudgetHaltableTask(agent('o', { isObserver: true }))).toBe(false)
  })

  test('$am: needs budget reached + running bg non-observer', () => {
    // not reached
    expect(shouldHaltBackgroundAgentsForBudget(1_000_000, [agent('a')])).toBe(
      false,
    )
    // reached (0) but no tasks
    expect(shouldHaltBackgroundAgentsForBudget(0, [])).toBe(false)
    // reached + observer only → false (iSe excludes observer)
    expect(
      shouldHaltBackgroundAgentsForBudget(0, [
        agent('o', { isObserver: true }),
      ]),
    ).toBe(false)
    // reached + running bg agent
    expect(shouldHaltBackgroundAgentsForBudget(0, [agent('a')])).toBe(true)
    // stoppedByUser skips
    expect(
      shouldHaltBackgroundAgentsForBudget(0, [
        agent('a', { stoppedByUser: true }),
      ]),
    ).toBe(false)
    // not backgrounded (foreground) → mT false
    expect(
      shouldHaltBackgroundAgentsForBudget(0, [
        agent('a', { isBackgrounded: false }),
      ]),
    ).toBe(false)
  })

  test('deny message densable copy', () => {
    const msg = formatSubagentBudgetExhaustedMessage(5)
    expect(msg).toContain('Budget limit reached')
    expect(msg).toContain('$5')
    expect(msg).toContain('New agents cannot be started')
  })

  test('print stderr densable copy', () => {
    const msg = formatPrintBudgetHaltStderr(5)
    expect(msg).toContain('Budget limit reached')
    expect(msg).toContain('stopping background agents')
    expect(msg.endsWith('\n')).toBe(true)
  })
})
