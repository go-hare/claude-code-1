import { describe, expect, test } from 'bun:test'
import {
  createAbortErrorReason,
  getAbortReasonMessage,
  isBackgroundAbortReason,
} from '../abortController.js'

describe('densable J0 / RT abort reason helpers', () => {
  test('createAbortErrorReason returns cached DOMException AbortError', () => {
    const a = createAbortErrorReason('background')
    const b = createAbortErrorReason('background')
    expect(a).toBe(b)
    expect(a.name).toBe('AbortError')
    expect(a.message).toBe('background')
  })

  test('getAbortReasonMessage unwraps DOMException and string', () => {
    expect(getAbortReasonMessage('background')).toBe('background')
    expect(getAbortReasonMessage(createAbortErrorReason('background'))).toBe(
      'background',
    )
    expect(getAbortReasonMessage(new Error('user cancel'))).toBe('user cancel')
    expect(getAbortReasonMessage(undefined)).toBeUndefined()
  })

  test('isBackgroundAbortReason matches string and J0 DOMException', () => {
    expect(isBackgroundAbortReason('background')).toBe(true)
    expect(isBackgroundAbortReason(createAbortErrorReason('background'))).toBe(
      true,
    )
    expect(isBackgroundAbortReason('user')).toBe(false)
    expect(isBackgroundAbortReason(undefined)).toBe(false)
  })

  test('AbortController.abort(J0("background")) is detected by RT', () => {
    const ac = new AbortController()
    ac.abort(createAbortErrorReason('background'))
    expect(ac.signal.aborted).toBe(true)
    expect(isBackgroundAbortReason(ac.signal.reason)).toBe(true)
  })
})
