import { afterEach, describe, expect, test } from 'bun:test'
import {
  _resetDebugLoggerForTesting,
  getDebugFileDroppedTotal,
} from '../debug.js'
import {
  _resetStderrBackpressureForTesting,
  getStderrDroppedTotal,
  writeToStderr,
} from '../process.js'

describe('2.1.299 #592/#593 debug & stderr backpressure', () => {
  afterEach(() => {
    _resetStderrBackpressureForTesting()
    _resetDebugLoggerForTesting()
  })

  test('#593 drops mayDrop stderr writes after 1 MiB and 10s backlog, then reports count on drain', () => {
    const origWrite = process.stderr.write
    const origNow = Date.now
    const written: string[] = []
    const drainCbs: Array<() => void> = []
    let nowMs = 1_000_000

    Date.now = () => nowMs
    process.stderr.write = ((
      chunk: string | Uint8Array,
      cb?: (() => void) | BufferEncoding,
    ) => {
      written.push(String(chunk))
      if (typeof cb === 'function') {
        drainCbs.push(cb)
      }
      return false
    }) as typeof process.stderr.write

    try {
      const oneMiB = 'x'.repeat(1024 * 1024)
      writeToStderr(oneMiB, { mayDrop: true })
      expect(getStderrDroppedTotal()).toBe(0)

      // Advance > 10s while 1 MiB is still unflushed
      nowMs += 11_000
      writeToStderr('drop-me-1\n', { mayDrop: true })
      writeToStderr('drop-me-2\n', { mayDrop: true })
      expect(getStderrDroppedTotal()).toBe(2)

      // Non-droppable writes still pass through
      writeToStderr('critical\n', { mayDrop: false })
      expect(written).toContain('critical\n')

      // Flush the 1 MiB write -> emits drop notice
      drainCbs[0]?.()
      expect(
        written.some(s =>
          s.includes('[stderr messages dropped before this line: 2.'),
        ),
      ).toBe(true)
    } finally {
      process.stderr.write = origWrite
      Date.now = origNow
    }
  })

  test('#592 getDebugFileDroppedTotal starts at 0 and resets cleanly', () => {
    _resetDebugLoggerForTesting()
    expect(getDebugFileDroppedTotal()).toBe(0)
  })
})
