import { describe, expect, mock, test } from 'bun:test'
import {
  formatTuiActiveTaskRefuseMessage,
  formatTuiActiveTaskSavedMessage,
  flushBeforeTuiRelaunchCheck,
  getTuiRelaunchBlocker,
  isCommentMonitorTask,
  isTuiBlockingTask,
} from '../tuiRelaunchBlocker.js'

describe('tuiRelaunchBlocker densable 2.1.234 (iyt/gGS/nfo)', () => {
  test('gGS / isTuiBlockingTask skips remote_agent, dream, mcp without abort', () => {
    expect(isTuiBlockingTask({ type: 'local_agent', status: 'running' })).toBe(
      true,
    )
    expect(isTuiBlockingTask({ type: 'local_shell', status: 'pending' })).toBe(
      true,
    )
    expect(isTuiBlockingTask({ type: 'remote_agent', status: 'running' })).toBe(
      false,
    )
    expect(isTuiBlockingTask({ type: 'dream', status: 'running' })).toBe(false)
    expect(isTuiBlockingTask({ type: 'monitor_mcp', status: 'running' })).toBe(
      false,
    )
    expect(
      isTuiBlockingTask({
        type: 'monitor_mcp',
        status: 'running',
        abortController: {},
      }),
    ).toBe(true)
    expect(
      isTuiBlockingTask({ type: 'local_agent', status: 'completed' }),
    ).toBe(false)
  })

  test('ambient monitor_ws only blocks when NOe+live', () => {
    expect(
      isTuiBlockingTask({
        type: 'monitor_ws',
        status: 'running',
        ambient: true,
      }),
    ).toBe(false)
    expect(
      isTuiBlockingTask({
        type: 'monitor_ws',
        status: 'running',
        ambient: true,
        autoReactArmed: true,
      }),
    ).toBe(true)
    expect(
      isTuiBlockingTask({
        type: 'monitor_ws',
        status: 'running',
        ambient: false,
      }),
    ).toBe(true)
  })

  test('NOe / isCommentMonitorTask requires running + autoReactArmed', () => {
    expect(
      isCommentMonitorTask({ status: 'running', autoReactArmed: true }),
    ).toBe(true)
    expect(
      isCommentMonitorTask({ status: 'pending', autoReactArmed: true }),
    ).toBe(false)
    expect(isCommentMonitorTask({ status: 'running' })).toBe(false)
  })

  test('iyt empty + no global monitor ⇒ undefined', () => {
    expect(getTuiRelaunchBlocker({})).toBeUndefined()
    expect(
      getTuiRelaunchBlocker({
        a: { type: 'dream', status: 'running' },
      }),
    ).toBeUndefined()
  })

  test('iyt empty + g3a ⇒ comment_monitor activeTasks:false', () => {
    expect(
      getTuiRelaunchBlocker({}, { isGlobalCommentMonitorActive: () => true }),
    ).toEqual({ kind: 'comment_monitor', activeTasks: false })
  })

  test('iyt all NOe ⇒ comment_monitor; mixed ⇒ tasks', () => {
    expect(
      getTuiRelaunchBlocker({
        a: {
          type: 'monitor_ws',
          status: 'running',
          ambient: true,
          autoReactArmed: true,
        },
      }),
    ).toEqual({ kind: 'comment_monitor', activeTasks: true })
    expect(
      getTuiRelaunchBlocker({
        a: { type: 'local_agent', status: 'running' },
        b: {
          type: 'monitor_ws',
          status: 'running',
          ambient: true,
          autoReactArmed: true,
        },
      }),
    ).toEqual({ kind: 'tasks', activeTasks: true })
    expect(
      getTuiRelaunchBlocker({
        a: { type: 'local_shell', status: 'running' },
      }),
    ).toEqual({ kind: 'tasks', activeTasks: true })
  })

  test('UYh-path refuse + nfo saved copy (en-dash)', () => {
    const refuseTasks = formatTuiActiveTaskRefuseMessage({
      kind: 'tasks',
      activeTasks: true,
    })
    expect(refuseTasks).toContain('work is running in the background')
    expect(refuseTasks).toContain('—')
    const refuseMon = formatTuiActiveTaskRefuseMessage({
      kind: 'comment_monitor',
      activeTasks: true,
    })
    expect(refuseMon).toContain('auto-replying to artifact comments')
    const saved = formatTuiActiveTaskSavedMessage('fullscreen', 'tasks')
    expect(saved).toBe(
      'Staying on the fullscreen renderer without a restart — work is now running in the background; the preference is saved.',
    )
    const savedMon = formatTuiActiveTaskSavedMessage(
      'default',
      'comment_monitor',
    )
    expect(savedMon).toContain('auto-replying to artifact comments')
    expect(savedMon).toContain('the preference is saved.')
  })

  test('xve stand-in flushBeforeTuiRelaunchCheck invokes flush', async () => {
    const flush = mock(async () => {})
    await flushBeforeTuiRelaunchCheck(flush)
    expect(flush).toHaveBeenCalledTimes(1)
    const boom = mock(async () => {
      throw new Error('disk')
    })
    await flushBeforeTuiRelaunchCheck(boom)
    expect(boom).toHaveBeenCalledTimes(1)
  })
})
