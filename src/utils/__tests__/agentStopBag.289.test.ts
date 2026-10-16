import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearAgentStopPending,
  getAgentStopBag,
  isAgentKillLoopSettled,
  isAgentStopPending,
  isTerminalAgentTaskStatus,
  markAgentStopPending,
  registerAgentKillLoop,
  resetAgentStopBagForTests,
  settleAgentKillLoop,
} from '../agentStopBag.js'

afterEach(() => {
  resetAgentStopBagForTests()
})

describe('densable 2.1.289 agent stop bag (be/At/TD/gD/db)', () => {
  test('dSe/tGn/gD pending set', () => {
    expect(isAgentStopPending('a1')).toBe(false)
    markAgentStopPending('a1')
    expect(isAgentStopPending('a1')).toBe(true)
    clearAgentStopPending('a1')
    expect(isAgentStopPending('a1')).toBe(false)
  })

  test('db = !loopsByTaskId.has; settle clears pending', () => {
    expect(isAgentKillLoopSettled('a1')).toBe(true)
    markAgentStopPending('a1')
    registerAgentKillLoop('a1')
    expect(isAgentKillLoopSettled('a1')).toBe(false)
    expect(isAgentStopPending('a1')).toBe(true)
    settleAgentKillLoop('a1')
    expect(isAgentKillLoopSettled('a1')).toBe(true)
    expect(isAgentStopPending('a1')).toBe(false)
  })

  test('Rs terminal statuses', () => {
    expect(isTerminalAgentTaskStatus('completed')).toBe(true)
    expect(isTerminalAgentTaskStatus('failed')).toBe(true)
    expect(isTerminalAgentTaskStatus('killed')).toBe(true)
    expect(isTerminalAgentTaskStatus('running')).toBe(false)
    expect(isTerminalAgentTaskStatus(undefined)).toBe(false)
  })

  test('host bag reset clears sets', () => {
    markAgentStopPending('a1')
    registerAgentKillLoop('a1')
    getAgentStopBag().reset()
    expect(isAgentStopPending('a1')).toBe(false)
    expect(isAgentKillLoopSettled('a1')).toBe(true)
  })
})
