/**
 * densable 2.1.212 #9:
 * continue:false halt (hook_stopped_continuation) must survive deny / stop /
 * and tool-failure paths; PreToolUse infrastructure errors use ZFu stopReason
 * and must not discard a prior hook permission decision.
 */
import { describe, expect, test } from 'bun:test'

/**
 * Pure helpers mirroring densable LKr / ZFu decisions so we can unit-test the
 * policy without spinning the full toolExecution graph.
 */

function shouldEmitLKr(opts: {
  shouldPreventContinuation: boolean
  aborted: boolean
  path: 'success' | 'deny_hook' | 'catch' | 'stop'
  isAbort?: boolean
  eventStopReason?: string
  decisionReasonType?: string
  behavior?: string
}): boolean {
  if (!opts.shouldPreventContinuation || opts.aborted) return false
  switch (opts.path) {
    case 'success':
      return true
    case 'deny_hook':
      return opts.behavior === 'deny' && opts.decisionReasonType === 'hook'
    case 'catch':
      return !opts.isAbort
    case 'stop':
      // densable: I&&ae.stopReason
      return Boolean(opts.eventStopReason)
  }
}

function resolveInfraStop(opts: {
  lastHookPermissionResult: unknown | undefined
  lastStopReason?: string
}): { kind: 're_yield_permission' } | { kind: 'stop'; stopReason: string } {
  if (opts.lastHookPermissionResult) {
    return { kind: 're_yield_permission' }
  }
  return {
    kind: 'stop',
    stopReason:
      opts.lastStopReason ??
      'PreToolUse hook failed with an unexpected error. The tool call was not executed; other configured hooks may not have completed.',
  }
}

describe('densable LKr emit policy (#9)', () => {
  test('success path emits when continue:false', () => {
    expect(
      shouldEmitLKr({
        shouldPreventContinuation: true,
        aborted: false,
        path: 'success',
      }),
    ).toBe(true)
  })

  test('success path silent without continue:false', () => {
    expect(
      shouldEmitLKr({
        shouldPreventContinuation: false,
        aborted: false,
        path: 'success',
      }),
    ).toBe(false)
  })

  test('deny+hook preserves halt (was dropped pre-212)', () => {
    expect(
      shouldEmitLKr({
        shouldPreventContinuation: true,
        aborted: false,
        path: 'deny_hook',
        behavior: 'deny',
        decisionReasonType: 'hook',
      }),
    ).toBe(true)
  })

  test('deny without hook decisionReason does not LKr', () => {
    expect(
      shouldEmitLKr({
        shouldPreventContinuation: true,
        aborted: false,
        path: 'deny_hook',
        behavior: 'deny',
        decisionReasonType: 'rule',
      }),
    ).toBe(false)
  })

  test('tool catch (fail mid-stream) still LKr', () => {
    expect(
      shouldEmitLKr({
        shouldPreventContinuation: true,
        aborted: false,
        path: 'catch',
        isAbort: false,
      }),
    ).toBe(true)
  })

  test('tool catch abort does not LKr', () => {
    expect(
      shouldEmitLKr({
        shouldPreventContinuation: true,
        aborted: false,
        path: 'catch',
        isAbort: true,
      }),
    ).toBe(false)
  })

  test('stop with event stopReason + continue:false LKr', () => {
    expect(
      shouldEmitLKr({
        shouldPreventContinuation: true,
        aborted: false,
        path: 'stop',
        eventStopReason: 'halt please',
      }),
    ).toBe(true)
  })

  test('infra ZFu stop alone without continue:false does not LKr', () => {
    expect(
      shouldEmitLKr({
        shouldPreventContinuation: false,
        aborted: false,
        path: 'stop',
        eventStopReason:
          'PreToolUse hook failed with an unexpected error. The tool call was not executed; other configured hooks may not have completed.',
      }),
    ).toBe(false)
  })

  test('aborted session never LKr', () => {
    expect(
      shouldEmitLKr({
        shouldPreventContinuation: true,
        aborted: true,
        path: 'success',
      }),
    ).toBe(false)
  })
})

describe('densable PreToolUse infra error ZFu (#9)', () => {
  test('re-yields prior permission decision (not user reject stop)', () => {
    expect(
      resolveInfraStop({
        lastHookPermissionResult: {
          behavior: 'deny',
          decisionReason: { type: 'hook' },
        },
      }),
    ).toEqual({ kind: 're_yield_permission' })
  })

  test('ZFu default when no prior permission', () => {
    const r = resolveInfraStop({ lastHookPermissionResult: undefined })
    expect(r.kind).toBe('stop')
    if (r.kind === 'stop') {
      expect(r.stopReason).toContain('unexpected error')
      expect(r.stopReason).toContain('not executed')
    }
  })

  test('prefers prior continue:false stopReason over ZFu', () => {
    const r = resolveInfraStop({
      lastHookPermissionResult: undefined,
      lastStopReason: 'custom halt',
    })
    expect(r).toEqual({ kind: 'stop', stopReason: 'custom halt' })
  })
})
