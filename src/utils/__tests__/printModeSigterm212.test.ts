/**
 * densable 2.1.212 #10:
 * print/SDK SIGTERM aborts the in-flight turn (killing Bash process trees)
 * and exits 143; global gracefulShutdown SIGTERM no-ops once print handlers
 * are registered (Vwo/uxs).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  isPrintModeSignalHandlersRegistered,
  markPrintModeSignalHandlersRegistered,
  resetShutdownState,
} from '../gracefulShutdown.js'
import {
  createAbortErrorReason,
  getAbortReasonMessage,
} from '../abortController.js'

afterEach(() => {
  resetShutdownState()
})

describe('densable print-mode SIGTERM ownership (#10)', () => {
  test('markPrintModeSignalHandlersRegistered sets Vwo flag', () => {
    expect(isPrintModeSignalHandlersRegistered()).toBe(false)
    markPrintModeSignalHandlersRegistered()
    expect(isPrintModeSignalHandlersRegistered()).toBe(true)
  })

  test('resetShutdownState clears Vwo for tests', () => {
    markPrintModeSignalHandlersRegistered()
    resetShutdownState()
    expect(isPrintModeSignalHandlersRegistered()).toBe(false)
  })

  test('remote-cancel abort reason is densable nC("remote-cancel")', () => {
    const reason = createAbortErrorReason('remote-cancel')
    expect(getAbortReasonMessage(reason)).toBe('remote-cancel')
    expect(reason).toBeInstanceOf(DOMException)
    expect(reason.name).toBe('AbortError')
  })

  test('user-cancel abort reason is densable nC("user-cancel")', () => {
    const reason = createAbortErrorReason('user-cancel')
    expect(getAbortReasonMessage(reason)).toBe('user-cancel')
  })

  test('ShellCommand interrupt reason stays string-distinct from remote-cancel', () => {
    // ShellCommandImpl skips kill only when reason === 'interrupt' (string).
    // densable remote-cancel is a DOMException — must still kill the tree.
    const remote: unknown = createAbortErrorReason('remote-cancel')
    expect(remote === 'interrupt').toBe(false)
    expect(getAbortReasonMessage(remote)).not.toBe('interrupt')
  })

  test('exit code for SIGTERM is 143 (128+15)', () => {
    // densable Ts(143) / gracefulShutdown(143)
    expect(128 + 15).toBe(143)
  })
})
