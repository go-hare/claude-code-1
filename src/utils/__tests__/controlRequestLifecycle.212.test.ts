/**
 * densable 2.1.212 #23 — control_request lifecycle must not complete early.
 */
import { describe, expect, test } from 'bun:test'
import {
  shouldCompleteEventLifecycleImmediately,
  shouldEmitControlFinallyCompleted,
} from '../controlRequestLifecycle.js'

describe('densable #23 control_request lifecycle', () => {
  test('outer loop does not immediately complete control_request', () => {
    expect(shouldCompleteEventLifecycleImmediately('control_request')).toBe(
      false,
    )
  })

  test('outer loop does not immediately complete control_response / bash_command', () => {
    expect(shouldCompleteEventLifecycleImmediately('control_response')).toBe(
      false,
    )
    expect(shouldCompleteEventLifecycleImmediately('bash_command')).toBe(false)
  })

  test('outer loop still completes other non-user events immediately', () => {
    expect(shouldCompleteEventLifecycleImmediately('keep_alive')).toBe(true)
    expect(shouldCompleteEventLifecycleImmediately('system')).toBe(true)
    expect(shouldCompleteEventLifecycleImmediately('assistant')).toBe(true)
  })

  test('user never hits outer immediate completed path', () => {
    expect(shouldCompleteEventLifecycleImmediately('user')).toBe(false)
  })

  test('finally emits completed only when not deferred (sync handler)', () => {
    expect(shouldEmitControlFinallyCompleted(false, true)).toBe(true)
    expect(shouldEmitControlFinallyCompleted(true, true)).toBe(false)
    expect(shouldEmitControlFinallyCompleted(false, false)).toBe(false)
  })
})
