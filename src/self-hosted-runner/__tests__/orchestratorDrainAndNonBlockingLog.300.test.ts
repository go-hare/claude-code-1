import { describe, expect, test } from 'bun:test'
import {
  createNonBlockingRunnerLogWriter,
  RUNNER_LOG_RING_MAX_BYTES,
} from '../nonBlockingLog.js'
import { parseOrchestratorArgs } from '../orchestrator.js'

describe('2.1.299/2.1.300 #571/#804 orchestrator --shutdown-drain-sec & non-blocking log', () => {
  test('#571 parseOrchestratorArgs parses --shutdown-drain-sec and validates 0..3600', () => {
    const d0 = parseOrchestratorArgs([])
    expect(d0.shutdownDrainMs).toBe(0)

    const d30 = parseOrchestratorArgs(['--shutdown-drain-sec', '30'])
    expect(d30.shutdownDrainMs).toBe(30_000)

    expect(() =>
      parseOrchestratorArgs(['--shutdown-drain-sec', '3601']),
    ).toThrow(/0 to 3600/)
    expect(() => parseOrchestratorArgs(['--shutdown-drain-sec', '-1'])).toThrow(
      /0 to 3600/,
    )
    expect(() =>
      parseOrchestratorArgs(['--shutdown-drain-sec', '1.5']),
    ).toThrow(/0 to 3600/)
  })

  test('#804 nonBlockingLog keeps latest 256 KiB, counts drops, and announces dropped lines when pipe drains', () => {
    expect(RUNNER_LOG_RING_MAX_BYTES).toBe(262_144)

    let blocked = true
    const written: string[] = []
    let nowMs = 1000
    let scheduledRetry: (() => void) | undefined

    const writer = createNonBlockingRunnerLogWriter({
      maxRingBytes: 100,
      clock: {
        monotonicNow: () => nowMs,
        setTimeout: fn => {
          scheduledRetry = fn
          return () => {
            scheduledRetry = undefined
          }
        },
      },
      io: {
        sameFile: () => false,
        canWriteDirectly: () => true,
        writeSync: (_fd, buf, offset) => {
          if (blocked) {
            throw Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' })
          }
          const slice = buf.subarray(offset).toString('utf8')
          written.push(slice)
          return buf.length - offset
        },
        writeOnAThread: () => undefined,
        sleep: () => {},
      },
    })

    // Write 4 lines of 40 bytes each while blocked -> ring keeps <= 100 bytes, drops older lines
    writer.write('stdout', 'A'.repeat(39))
    writer.write('stdout', 'B'.repeat(39))
    writer.write('stdout', 'C'.repeat(39))
    writer.write('stdout', 'D'.repeat(39))

    const s1 = writer.stats()
    expect(s1.droppedLines).toBe(2)
    expect(s1.queuedBytes).toBeLessThanOrEqual(100)

    // Unblock and trigger retry -> emits drop notice + remaining latest lines
    blocked = false
    nowMs += 3000
    scheduledRetry?.()

    const joined = written.join('')
    expect(joined).toContain('2 log lines to stdout were dropped over 3 s')
    expect(joined).toContain('C'.repeat(39))
    expect(joined).toContain('D'.repeat(39))
    writer.close()
  })
})
