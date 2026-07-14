import { describe, expect, test } from 'bun:test'
import {
  canReportSessionIdleWithBgActivity,
  classifyPrintWindDownKind,
  formatPrintBgWaitCeilingMessage,
  formatPrintWindDownMessage,
  getPrintBgWaitCeilingMs,
  isPrintBgWaitForeverTask,
  nextPrintBgWaitGate,
  PRINT_BG_WAIT_CEILING_MS_DEFAULT,
  PRINT_BG_WAIT_GRACE_MS,
  shouldKeepSessionRunningOnDrain,
} from '../printBgWait.js'

describe('getPrintBgWaitCeilingMs (official dEf / ONb)', () => {
  test('defaults to 600000', () => {
    expect(getPrintBgWaitCeilingMs({})).toBe(PRINT_BG_WAIT_CEILING_MS_DEFAULT)
    expect(PRINT_BG_WAIT_CEILING_MS_DEFAULT).toBe(600_000)
  })

  test('0 means wait indefinitely (null)', () => {
    expect(
      getPrintBgWaitCeilingMs({ CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' }),
    ).toBeNull()
  })

  test('parses positive ms', () => {
    expect(
      getPrintBgWaitCeilingMs({
        CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '12000',
      }),
    ).toBe(12_000)
  })
})

describe('nextPrintBgWaitGate (official pEf / B6o)', () => {
  const base = {
    runningBackgroundTasks: [{ id: '1', type: 'local_bash' }],
    inputClosed: true,
    hasMainThreadQueued: false,
    hasActiveTeammates: false,
    hasPendingNotification: false,
    ceilingExceeded: false,
    deadline: null as number | null,
    swept: false,
    now: 1_000_000,
  }

  test('sets grace deadline on first wind-downable idle', () => {
    const r = nextPrintBgWaitGate(base)
    expect(r.shouldSweep).toBe(false)
    expect(r.deadline).toBe(1_000_000 + PRINT_BG_WAIT_GRACE_MS)
    expect(PRINT_BG_WAIT_GRACE_MS).toBe(5_000)
  })

  test('sweeps immediately when ceiling already exceeded', () => {
    const r = nextPrintBgWaitGate({ ...base, ceilingExceeded: true })
    expect(r.shouldSweep).toBe(true)
    expect(r.swept).toBe(true)
  })

  test('does not wind down while local_agent must-wait and no ceiling', () => {
    const r = nextPrintBgWaitGate({
      ...base,
      runningBackgroundTasks: [{ id: 'a', type: 'local_agent' }],
      ceilingExceeded: false,
    })
    expect(r.deadline).toBeNull()
    expect(r.shouldSweep).toBe(false)
  })

  test('after grace deadline, shouldSweep once', () => {
    const deadline = 1_000_000 + PRINT_BG_WAIT_GRACE_MS
    const mid = nextPrintBgWaitGate({
      ...base,
      deadline,
      now: deadline - 1,
    })
    expect(mid.shouldSweep).toBe(false)
    const done = nextPrintBgWaitGate({
      ...base,
      deadline,
      now: deadline,
      swept: false,
    })
    expect(done.shouldSweep).toBe(true)
  })
})

describe('isPrintBgWaitForeverTask / message', () => {
  test('local_agent is forever; local_bash is not', () => {
    expect(isPrintBgWaitForeverTask({ type: 'local_agent' })).toBe(true)
    expect(isPrintBgWaitForeverTask({ type: 'local_bash' })).toBe(false)
  })

  test('ceiling message mentions env override', () => {
    const msg = formatPrintBgWaitCeilingMessage(600_000)
    expect(msg).toContain('600s')
    expect(msg).toContain('CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0')
  })
})

describe('print wind-down messages (official fEf)', () => {
  test('classifies shell / observer / other', () => {
    expect(classifyPrintWindDownKind({ type: 'local_bash' })).toBe('shell')
    expect(classifyPrintWindDownKind({ type: 'monitor_mcp' })).toBe('observer')
    expect(classifyPrintWindDownKind({ type: 'local_agent' })).toBe('other')
  })

  test('messages match official phrasing', () => {
    expect(
      formatPrintWindDownMessage({
        id: 'b1',
        type: 'local_bash',
        description: 'sleep 1',
      }),
    ).toContain('killing background shell b1 ("sleep 1")')
    expect(
      formatPrintWindDownMessage({ id: 'm1', type: 'monitor_mcp' }),
    ).toContain('killing mid-delivery observer m1')
    expect(
      formatPrintWindDownMessage({ id: 'a1', type: 'local_agent' }),
    ).toContain('no longer waiting on background local_agent task a1')
  })
})

describe('BG_TASKS_REPORT_RUNNING (official lEf / cEf)', () => {
  test('blocks idle when report-running and bg active', () => {
    expect(
      canReportSessionIdleWithBgActivity({
        hasActiveTeammates: false,
        hasRunningBgTasks: true,
        hasPendingNotification: false,
        reportRunning: true,
      }),
    ).toBe(false)
    expect(
      canReportSessionIdleWithBgActivity({
        hasActiveTeammates: false,
        hasRunningBgTasks: true,
        hasPendingNotification: false,
        reportRunning: false,
      }),
    ).toBe(true)
  })

  test('lEf keeps open-input running only without report-running activity', () => {
    expect(
      shouldKeepSessionRunningOnDrain({
        inputClosed: false,
        currentState: 'running',
        hasActiveTeammates: false,
        hasRunningBgTasks: false,
        hasPendingNotification: false,
        reportRunning: true,
      }),
    ).toBe(true)
    expect(
      shouldKeepSessionRunningOnDrain({
        inputClosed: true,
        currentState: 'running',
        hasActiveTeammates: false,
        hasRunningBgTasks: true,
        hasPendingNotification: false,
        reportRunning: true,
      }),
    ).toBe(false)
  })
})
