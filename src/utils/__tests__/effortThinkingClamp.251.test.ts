import { APIError } from '@anthropic-ai/sdk'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  analyticsQuerySource,
  decideEffortWhenThinkingDisabled,
  formatEffortClampDebugMessage,
  oncePerSession,
  parseEffortUnsupportedWhenThinkingDisabled,
  querySourceBucket,
  resetEffortThinkingGuardOnceForTests,
  transcriptEffortWhenMechanicalDisabled,
} from '../effortThinkingGuard.js'
import {
  getBootstrapSession,
  resetOnceLatchesOnSessionSwitch,
  resetSessionHostForTests,
  sessionOnceLatchesOf,
} from '../sessionRoot.js'

describe('decideEffortWhenThinkingDisabled (2.1.251 #13)', () => {
  afterEach(() => {
    resetSessionHostForTests()
  })

  test('opus-5 xhigh with thinking off is sent as high', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: true,
        model: 'claude-opus-5',
      }),
    ).toEqual({ action: 'clamp', from: 'xhigh', to: 'high' })
  })

  test('provider id ending in claude-opus-5 clamps max', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'max',
        thinkingOff: true,
        model: 'us.anthropic.claude-opus-5',
      }),
    ).toEqual({ action: 'clamp', from: 'max', to: 'high' })
  })

  test('opus-5 high is unchanged', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'high',
        thinkingOff: true,
        model: 'claude-opus-5',
      }),
    ).toEqual({ action: 'pass' })
  })

  test('opus-5 xhigh with thinking on is unchanged', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: false,
        model: 'claude-opus-5',
      }),
    ).toEqual({ action: 'pass' })
  })

  test('other models pass xhigh when thinking is off (gold GMt does not throw)', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: true,
        model: 'claude-sonnet-4-6',
      }),
    ).toEqual({ action: 'pass' })
  })

  test('mechanical disabled clamps any model above high', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: true,
        mechanical: true,
        model: 'claude-sonnet-4-6',
      }),
    ).toEqual({ action: 'clamp', from: 'xhigh', to: 'high' })
  })

  test('grok-4.6 inherited xhigh with thinking off is not a client throw', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: true,
        model: 'grok-4.6',
      }),
    ).toEqual({ action: 'pass' })
  })

  test('env DISABLE_THINKING omits the field so thinkingOff false does not clamp', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: false,
        model: 'claude-opus-5',
      }),
    ).toEqual({ action: 'pass' })
  })

  test('d6e parses APIError 400 and ignores non-APIError', () => {
    expect(
      parseEffortUnsupportedWhenThinkingDisabled(
        new APIError(
          400,
          {
            message:
              "effort 'xhigh' is not supported when thinking is disabled",
          },
          "effort 'xhigh' is not supported when thinking is disabled",
          new Headers(),
        ),
      ),
    ).toBe('xhigh')
    expect(
      parseEffortUnsupportedWhenThinkingDisabled({
        status: 400,
        message: "effort 'xhigh' is not supported when thinking is disabled",
      }),
    ).toBeNull()
    expect(
      parseEffortUnsupportedWhenThinkingDisabled(
        new APIError(
          500,
          {
            message:
              "effort 'xhigh' is not supported when thinking is disabled",
          },
          "effort 'xhigh' is not supported when thinking is disabled",
          new Headers(),
        ),
      ),
    ).toBeNull()
  })

  test('Xl buckets querySource like gold', () => {
    expect(querySourceBucket(undefined)).toBeUndefined()
    expect(querySourceBucket('repl_main_thread')).toBe('main')
    expect(querySourceBucket('repl_main_thread:compact')).toBe('main')
    expect(querySourceBucket('sdk')).toBe('main')
    expect(querySourceBucket('agent:custom:foo')).toBe('subagent')
    expect(querySourceBucket('hook_agent')).toBe('subagent')
    expect(querySourceBucket('hook_prompt')).toBe('auxiliary')
  })

  test('ip collapses agent:custom:* for analytics', () => {
    expect(analyticsQuerySource('agent:custom:reviewer')).toBe('agent:custom')
    expect(analyticsQuerySource('repl_main_thread')).toBe('repl_main_thread')
    expect(analyticsQuerySource(undefined)).toBe('')
  })

  test('clamp debug names mechanically when Vm', () => {
    expect(formatEffortClampDebugMessage('xhigh', 'high', true)).toContain(
      'thinking is mechanically disabled',
    )
    expect(formatEffortClampDebugMessage('xhigh', 'high', false)).toContain(
      'thinking is disabled',
    )
    expect(formatEffortClampDebugMessage('xhigh', 'high', false)).not.toContain(
      'mechanically',
    )
  })

  test('Du().once fires once per session-root Ge bag', () => {
    resetEffortThinkingGuardOnceForTests()
    expect(oncePerSession('effort_thinking_disabled_clamp')).toBe(true)
    expect(oncePerSession('effort_thinking_disabled_clamp')).toBe(false)
    resetEffortThinkingGuardOnceForTests()
    expect(oncePerSession('effort_thinking_disabled_clamp')).toBe(true)
  })

  test('Du() keys on session.root so forks share Ge', () => {
    resetEffortThinkingGuardOnceForTests()
    const root = getBootstrapSession()
    const fork = root.withProject({ cwd: root.project.cwd })
    expect(sessionOnceLatchesOf(fork)).toBe(sessionOnceLatchesOf(root))
    expect(sessionOnceLatchesOf(root).once('k')).toBe(true)
    expect(sessionOnceLatchesOf(fork).once('k')).toBe(false)
    expect(sessionOnceLatchesOf(root).hasFired('k')).toBe(true)
    sessionOnceLatchesOf(root).resetStreamNoEventsWarningLatch()
    expect(
      sessionOnceLatchesOf(root).hasFired('stream_no_events_fallback_warning'),
    ).toBe(false)
  })

  test('i5n skips cd/hydrate and clears stream_no_events latch otherwise', () => {
    resetEffortThinkingGuardOnceForTests()
    const bag = sessionOnceLatchesOf(getBootstrapSession())
    bag.markFired('stream_no_events_fallback_warning')
    bag.markFired('effort_thinking_disabled_clamp')
    resetOnceLatchesOnSessionSwitch('id', 'cd')
    expect(bag.hasFired('stream_no_events_fallback_warning')).toBe(true)
    resetOnceLatchesOnSessionSwitch('id', 'hydrate')
    expect(bag.hasFired('stream_no_events_fallback_warning')).toBe(true)
    resetOnceLatchesOnSessionSwitch('id', 'clear')
    expect(bag.hasFired('stream_no_events_fallback_warning')).toBe(false)
    expect(bag.hasFired('effort_thinking_disabled_clamp')).toBe(true)
  })

  test('Ye skips transcript effort when thinking is mechanically off', () => {
    expect(
      transcriptEffortWhenMechanicalDisabled(true, 'xhigh'),
    ).toBeUndefined()
    expect(transcriptEffortWhenMechanicalDisabled(false, 'xhigh')).toBe('xhigh')
    expect(
      transcriptEffortWhenMechanicalDisabled(false, undefined),
    ).toBeUndefined()
  })
})
