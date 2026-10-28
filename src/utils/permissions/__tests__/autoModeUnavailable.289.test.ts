/**
 * densable 2.1.289 vPt / TPt / COo / EPt / cLt consecutive-unavailable hold.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { Tool } from '../../../Tool.js'
import {
  countAutoModeUnavailableResponsesInARow,
  getAutoModeUnavailableResponse,
  resetRequestLatches,
} from '../../../bootstrap/state.js'
import {
  AUTO_MODE_UNAVAILABLE_STREAK_LIMIT,
  autoModeUnavailableAgentStopCopy,
  autoModeUnavailableRunKey,
  autoModeUnavailableToolStopCopy,
  autoModeUnavailableUserStopCopy,
  clearAutoModeUnavailableStreakIfAny,
  holdForConsecutiveAutoModeUnavailable,
  denyAutoModeUnavailableStop,
  holdOnAutoModeUnavailable,
  isConsecutiveUnavailableErrorKind,
  AUTO_MODE_UNAVAILABLE_STOP_REASON,
} from '../autoModeUnavailable.js'

afterEach(() => {
  resetRequestLatches()
})

function immediateTimeout(): (fn: () => void, _ms: number) => () => void {
  return fn => {
    fn()
    return () => {}
  }
}

describe('autoModeUnavailable 289', () => {
  test('autoModeUnavailableRunKey defaults to main', () => {
    expect(autoModeUnavailableRunKey()).toBe('main')
    expect(autoModeUnavailableRunKey(undefined)).toBe('main')
    expect(autoModeUnavailableRunKey('agent-1')).toBe('agent-1')
  })

  test('vPt first N<10 records deny with delay; 10th returns stop recorded:true', async () => {
    const scheduleTimeout = immediateTimeout()
    const signal = new AbortController().signal
    for (let i = 1; i < AUTO_MODE_UNAVAILABLE_STREAK_LIMIT; i++) {
      const result = await holdForConsecutiveAutoModeUnavailable(`req-${i}`, {
        runKey: 'main',
        signal,
        scheduleTimeout,
      })
      expect(result).toEqual({
        kind: 'deny',
        position: i,
        interrupted: false,
      })
    }
    const tenth = await holdForConsecutiveAutoModeUnavailable('req-10', {
      runKey: 'main',
      signal,
      scheduleTimeout,
    })
    expect(tenth).toEqual({
      kind: 'stop',
      position: AUTO_MODE_UNAVAILABLE_STREAK_LIMIT,
      recorded: true,
    })
  })

  test('vPt same request id reentry with position>=10 returns stop recorded:false', async () => {
    const scheduleTimeout = immediateTimeout()
    const signal = new AbortController().signal
    for (let i = 1; i < AUTO_MODE_UNAVAILABLE_STREAK_LIMIT; i++) {
      await holdForConsecutiveAutoModeUnavailable(`req-${i}`, {
        runKey: 'main',
        signal,
        scheduleTimeout,
      })
    }
    const firstStop = await holdForConsecutiveAutoModeUnavailable('req-10', {
      runKey: 'main',
      signal,
      scheduleTimeout,
    })
    expect(firstStop).toEqual({
      kind: 'stop',
      position: 10,
      recorded: true,
    })
    const reentry = await holdForConsecutiveAutoModeUnavailable('req-10', {
      runKey: 'main',
      signal,
      scheduleTimeout,
    })
    expect(reentry).toEqual({
      kind: 'stop',
      position: 10,
      recorded: false,
    })
  })

  test('vPt when cpo and in-row count already >=10 clears streak then treats as position 1', async () => {
    const scheduleTimeout = immediateTimeout()
    const signal = new AbortController().signal
    for (let i = 1; i <= AUTO_MODE_UNAVAILABLE_STREAK_LIMIT; i++) {
      await holdForConsecutiveAutoModeUnavailable(`req-${i}`, {
        runKey: 'main',
        signal,
        scheduleTimeout,
      })
    }
    expect(countAutoModeUnavailableResponsesInARow('main')).toBe(
      AUTO_MODE_UNAVAILABLE_STREAK_LIMIT,
    )
    const next = await holdForConsecutiveAutoModeUnavailable('fresh', {
      runKey: 'main',
      signal,
      scheduleTimeout,
    })
    expect(next).toEqual({
      kind: 'deny',
      position: 1,
      interrupted: false,
    })
    expect(getAutoModeUnavailableResponse('req-10')).toBeUndefined()
    expect(getAutoModeUnavailableResponse('fresh')?.position).toBe(1)
  })

  test('vPt aborted signal returns deny interrupted:true without incrementing past current count', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await holdForConsecutiveAutoModeUnavailable('req', {
      runKey: 'main',
      signal: controller.signal,
      scheduleTimeout: immediateTimeout(),
    })
    expect(result).toEqual({
      kind: 'deny',
      position: 0,
      interrupted: true,
    })
    expect(countAutoModeUnavailableResponsesInARow('main')).toBe(0)
    expect(getAutoModeUnavailableResponse('req')).toBeUndefined()
  })

  test('nie no-ops when count is 0; when count>0 clears that runKey', async () => {
    clearAutoModeUnavailableStreakIfAny('main')
    expect(countAutoModeUnavailableResponsesInARow('main')).toBe(0)
    await holdForConsecutiveAutoModeUnavailable('req-1', {
      runKey: 'main',
      signal: new AbortController().signal,
      scheduleTimeout: immediateTimeout(),
    })
    expect(countAutoModeUnavailableResponsesInARow('main')).toBe(1)
    clearAutoModeUnavailableStreakIfAny('main')
    expect(countAutoModeUnavailableResponsesInARow('main')).toBe(0)
  })

  test('TPt consecutive-unavailable kinds', () => {
    expect(isConsecutiveUnavailableErrorKind(undefined, false)).toBe(false)
    expect(
      isConsecutiveUnavailableErrorKind(
        'server_call_unavailable_timeout',
        true,
      ),
    ).toBe(true)
    expect(
      isConsecutiveUnavailableErrorKind(
        'server_call_unavailable_truncated',
        true,
      ),
    ).toBe(false)
    expect(
      isConsecutiveUnavailableErrorKind('server_unavailable_error', true),
    ).toBe(true)
    expect(isConsecutiveUnavailableErrorKind('server_stream_ended', true)).toBe(
      true,
    )
    expect(
      isConsecutiveUnavailableErrorKind('server_unrecognized_result', true),
    ).toBe(true)
    expect(isConsecutiveUnavailableErrorKind('server_no_result', true)).toBe(
      false,
    )
    expect(isConsecutiveUnavailableErrorKind('server_no_result', false)).toBe(
      true,
    )
    expect(isConsecutiveUnavailableErrorKind('server_unsupported', false)).toBe(
      true,
    )
    expect(
      isConsecutiveUnavailableErrorKind('server_thread_unsupported', false),
    ).toBe(true)
    expect(
      isConsecutiveUnavailableErrorKind('server_thread_unsupported', true),
    ).toBe(false)
  })

  test('COo / cLt / EPt interpolate 10; cLt(undefined) has no proxy clause', () => {
    expect(autoModeUnavailableAgentStopCopy()).toContain('10 responses')
    expect(autoModeUnavailableToolStopCopy('Bash')).toContain(
      'so Bash was not run',
    )
    const generic = autoModeUnavailableUserStopCopy()
    expect(generic).toContain('last 10 responses')
    expect(generic).not.toContain('Requests in this session go through')
    const proxied = autoModeUnavailableUserStopCopy('204.44.121.220:8413')
    expect(proxied).toContain(
      'Requests in this session go through 204.44.121.220:8413',
    )
  })

  test('Y7o onWait emits kind auto_mode_unavailable with attempt/limit/delayMs', async () => {
    const statuses: Array<unknown> = []
    const abort = new AbortController()
    await holdOnAutoModeUnavailable(
      'req-y7o',
      {
        abortController: abort,
        setRetryStatus: status => {
          statuses.push(status)
        },
        scheduleTimeout: immediateTimeout(),
      },
      'tool-use-1',
    )
    expect(statuses[0]).toEqual(
      expect.objectContaining({
        kind: 'auto_mode_unavailable',
        attempt: 1,
        maxRetries: AUTO_MODE_UNAVAILABLE_STREAK_LIMIT,
      }),
    )
    expect(statuses.at(-1)).toBeNull()
  })

  test('X7o deny endsTurn with gold stop reason even when unrecorded', () => {
    const result = denyAutoModeUnavailableStop(
      { name: 'Bash' } as Tool,
      {},
      false,
    )
    expect(result).toEqual({
      behavior: 'deny',
      decisionReason: {
        type: 'classifier',
        classifier: 'auto-mode',
        reason: AUTO_MODE_UNAVAILABLE_STOP_REASON,
        noVerdict: true,
      },
      message: autoModeUnavailableToolStopCopy('Bash'),
      endsTurn: true,
    })
  })
})
