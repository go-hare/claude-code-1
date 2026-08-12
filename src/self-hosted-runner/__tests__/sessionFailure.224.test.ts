/**
 * densable 2.1.224 #1 residual — Y2h / jjv / YJl / AKn.
 */
import { describe, expect, test } from 'bun:test'
import {
  FAILURE_STDERR_TAIL_MAX,
  buildFailureWorkerEvents,
  buildSessionGoneEndSessionLine,
  isEpochMismatchRunnerError,
  isNotFoundRunnerError,
  isSessionGoneRunnerError,
  isSessionNotActiveRunnerError,
  notifyChildSessionGone,
  postSessionFailureResult,
} from '../sessionFailure.js'

function flagErr(
  name: string,
  flags: Partial<{
    isNotFound: boolean
    isSessionNotActive: boolean
    isEpochMismatch: boolean
  }>,
): Error {
  const e = new Error(name)
  Object.assign(e, flags)
  return e
}

describe('densable 2.1.224 #1 sessionFailure classifiers (QJl/ujv/YJl/AKn)', () => {
  test('isNotFound / isSessionNotActive / isSessionGone / isEpochMismatch', () => {
    expect(isNotFoundRunnerError(flagErr('nf', { isNotFound: true }))).toBe(
      true,
    )
    expect(
      isSessionNotActiveRunnerError(
        flagErr('na', { isSessionNotActive: true }),
      ),
    ).toBe(true)
    expect(isSessionGoneRunnerError(flagErr('nf', { isNotFound: true }))).toBe(
      true,
    )
    expect(
      isSessionGoneRunnerError(flagErr('na', { isSessionNotActive: true })),
    ).toBe(true)
    expect(isSessionGoneRunnerError(new Error('x'))).toBe(false)
    expect(
      isEpochMismatchRunnerError(flagErr('em', { isEpochMismatch: true })),
    ).toBe(true)
  })

  test('densable $e/Ze — notifyChildSessionGone once + end_session line', () => {
    const line = buildSessionGoneEndSessionLine('sess-1')
    expect(line.endsWith('\n')).toBe(true)
    const body = JSON.parse(line.trim()) as {
      type: string
      request_id: string
      request: { subtype: string; reason: string }
    }
    expect(body.type).toBe('control_request')
    expect(body.request_id).toBe('runner-session-gone-sess-1')
    expect(body.request.subtype).toBe('end_session')
    expect(body.request.reason).toBe('session_not_found')

    const writes: string[] = []
    const statuses: string[] = []
    const gone = flagErr('404', { isNotFound: true })
    const r1 = notifyChildSessionGone({
      err: gone,
      source: '/remote',
      sessionId: 'sess-1',
      alreadySent: false,
      endSessionLine: line,
      write: s => writes.push(s),
      onStatus: m => statuses.push(m),
    })
    expect(r1).toEqual({ gone: true, sent: true })
    expect(writes).toEqual([line])
    expect(statuses[0]).toContain('session gone server-side')
    expect(statuses[0]).toContain('/remote')

    const r2 = notifyChildSessionGone({
      err: gone,
      source: 'refreshToken',
      sessionId: 'sess-1',
      alreadySent: true,
      endSessionLine: line,
      write: s => writes.push(s),
      onStatus: m => statuses.push(m),
    })
    expect(r2).toEqual({ gone: true, sent: true })
    expect(writes).toHaveLength(1) // once-only

    const r3 = notifyChildSessionGone({
      err: new Error('transient'),
      source: '/remote',
      sessionId: 'sess-1',
      alreadySent: false,
      endSessionLine: line,
      write: s => writes.push(s),
      onStatus: m => statuses.push(m),
    })
    expect(r3).toEqual({ gone: false, sent: false })
    expect(writes).toHaveLength(1)
  })
})

describe('densable 2.1.224 #1 buildFailureWorkerEvents (jjv)', () => {
  test('assistant + result shape; stderr tail capped (U2h=2000)', () => {
    const events = buildFailureWorkerEvents(7, 'boom')
    expect(events).toHaveLength(2)
    const [assistant, result] = events as [
      {
        type: string
        isApiErrorMessage: boolean
        message: { content: Array<{ text: string }> }
      },
      { type: string; subtype: string; is_error: boolean; errors: string[] },
    ]
    expect(assistant.type).toBe('assistant')
    expect(assistant.isApiErrorMessage).toBe(true)
    expect(assistant.message.content[0]!.text).toContain('exited with code 7')
    expect(assistant.message.content[0]!.text).toContain('boom')
    expect(result.type).toBe('result')
    expect(result.subtype).toBe('error_during_execution')
    expect(result.is_error).toBe(true)
    expect(FAILURE_STDERR_TAIL_MAX).toBe(2_000)

    const long = 'z'.repeat(3_000)
    const [a2] = buildFailureWorkerEvents(null, long) as [
      { message: { content: Array<{ text: string }> } },
    ]
    expect(a2.message.content[0]!.text).toContain('failed to start')
    expect(a2.message.content[0]!.text).toContain('…')
    expect(a2.message.content[0]!.text.includes(long)).toBe(false)
  })
})

describe('densable 2.1.224 #1 postSessionFailureResult (Y2h)', () => {
  test('posted on first attempt', async () => {
    const calls: unknown[] = []
    const r = await postSessionFailureResult({
      apiClient: {
        postWorkerEvents: async (...args) => {
          calls.push(args)
        },
      },
      apiBaseUrl: 'https://api.example',
      sessionId: 's1',
      sessionToken: 't',
      workerEpoch: 3,
      exitCode: 1,
      stderrTail: '',
      onDebug: () => {},
      onStatus: () => {},
      signal: new AbortController().signal,
    })
    expect(r).toBe('posted')
    expect(calls).toHaveLength(1)
  })

  test('session_gone on first reject', async () => {
    const r = await postSessionFailureResult({
      apiClient: {
        postWorkerEvents: async () => {
          throw flagErr('gone', { isNotFound: true })
        },
      },
      apiBaseUrl: 'https://api.example',
      sessionId: 's1',
      sessionToken: 't',
      workerEpoch: 1,
      exitCode: 1,
      stderrTail: '',
      onDebug: () => {},
      onStatus: () => {},
      signal: new AbortController().signal,
    })
    expect(r).toBe('session_gone')
  })

  test('epoch_stale on first reject', async () => {
    const r = await postSessionFailureResult({
      apiClient: {
        postWorkerEvents: async () => {
          throw flagErr('stale', { isEpochMismatch: true })
        },
      },
      apiBaseUrl: 'https://api.example',
      sessionId: 's1',
      sessionToken: 't',
      workerEpoch: 1,
      exitCode: 1,
      stderrTail: '',
      onDebug: () => {},
      onStatus: () => {},
      signal: new AbortController().signal,
    })
    expect(r).toBe('epoch_stale')
  })

  test('retry then posted; skipped when aborted', async () => {
    let n = 0
    const r = await postSessionFailureResult({
      apiClient: {
        postWorkerEvents: async () => {
          n++
          if (n === 1) throw new Error('transient')
        },
      },
      apiBaseUrl: 'https://api.example',
      sessionId: 's1',
      sessionToken: 't',
      workerEpoch: 1,
      exitCode: 2,
      stderrTail: 'x',
      onDebug: () => {},
      onStatus: () => {},
      signal: new AbortController().signal,
      sleepMs: async () => {},
    })
    expect(r).toBe('posted')
    expect(n).toBe(2)

    const ac = new AbortController()
    ac.abort()
    const skipped = await postSessionFailureResult({
      apiClient: {
        postWorkerEvents: async () => {
          throw new Error('should not call')
        },
      },
      apiBaseUrl: 'https://api.example',
      sessionId: 's1',
      sessionToken: 't',
      workerEpoch: 1,
      exitCode: 1,
      stderrTail: '',
      onDebug: () => {},
      onStatus: () => {},
      signal: ac.signal,
    })
    expect(skipped).toBe('skipped')
  })

  test('post_failed after retry', async () => {
    const r = await postSessionFailureResult({
      apiClient: {
        postWorkerEvents: async () => {
          throw new Error('still down')
        },
      },
      apiBaseUrl: 'https://api.example',
      sessionId: 's1',
      sessionToken: 't',
      workerEpoch: 1,
      exitCode: 1,
      stderrTail: '',
      onDebug: () => {},
      onStatus: () => {},
      signal: new AbortController().signal,
      sleepMs: async () => {},
    })
    expect(r).toBe('post_failed')
  })
})
