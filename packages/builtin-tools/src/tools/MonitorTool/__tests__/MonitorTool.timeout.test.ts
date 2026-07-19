import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isValidMonitorTimeout,
  MONITOR_DEFAULT_TIMEOUT_MS,
  MONITOR_MAX_TIMEOUT_MS,
} from '../MonitorTool.js'

describe('MonitorTool densable jVg timeout_ms', () => {
  const src = readFileSync(join(import.meta.dir, '../MonitorTool.tsx'), 'utf8')

  test('constants match densable V5u / Rss', () => {
    expect(MONITOR_DEFAULT_TIMEOUT_MS).toBe(300_000)
    expect(MONITOR_MAX_TIMEOUT_MS).toBe(3_600_000)
  })

  test('$Vg validation: persistent OR timeout_ms <= Rss', () => {
    expect(
      isValidMonitorTimeout({ persistent: true, timeout_ms: 99_999_999 }),
    ).toBe(true)
    expect(isValidMonitorTimeout({ timeout_ms: MONITOR_MAX_TIMEOUT_MS })).toBe(
      true,
    )
    expect(
      isValidMonitorTimeout({ timeout_ms: MONITOR_MAX_TIMEOUT_MS + 1 }),
    ).toBe(false)
    expect(isValidMonitorTimeout({})).toBe(true) // default V5u
  })

  test('schema + call path include timeout_ms / persistent / Nre timed out', () => {
    expect(src).toContain('timeout_ms')
    expect(src).toContain('persistent')
    expect(src).toContain('MONITOR_DEFAULT_TIMEOUT_MS')
    expect(src).toContain('MONITOR_MAX_TIMEOUT_MS')
    // densable jVg timeout body
    expect(src).toContain('[Monitor timed out \\u2014 re-arm if needed.]')
    expect(src).toContain('enqueueMonitorEventNotification')
    expect(src).toContain('killTask(id, setAppState)')
    expect(src).toContain('clearTimeout(timeoutId)')
    expect(src).toContain('timeoutId.unref')
    // output includes densable timeoutMs:i?0:o
    expect(src).toContain('timeoutMs')
  })

  test('Aio sink still wired with onStdout + finish', () => {
    expect(src).toContain('createMonitorEventSink')
    expect(src).toContain('onStdout: eventSink.onData')
    expect(src).toContain('eventSink.finish()')
    expect(src).toContain("kind: 'monitor'")
  })
})
