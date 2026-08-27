/**
 * densable 236 #27 — interactive SIGTERM registers remote-cancel abort.
 */
import { describe, expect, test } from 'bun:test'
import { createAbortErrorReason } from '../abortController.js'
import {
  getInteractiveShutdownAbortForTests,
  registerInteractiveShutdownAbort,
} from '../gracefulShutdown.js'

describe('registerInteractiveShutdownAbort (236 #27)', () => {
  test('invokes registered abort with remote-cancel reason', () => {
    const ac = new AbortController()
    registerInteractiveShutdownAbort(() => {
      if (!ac.signal.aborted) {
        ac.abort(createAbortErrorReason('remote-cancel'))
      }
    })
    getInteractiveShutdownAbortForTests()?.()
    expect(ac.signal.aborted).toBe(true)
    expect(ac.signal.reason).toEqual(createAbortErrorReason('remote-cancel'))
    registerInteractiveShutdownAbort(null)
  })
})
