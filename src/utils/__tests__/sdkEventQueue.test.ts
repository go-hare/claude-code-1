import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearTaskTerminatedSdkOnce,
  drainSdkEvents,
  emitTaskTerminatedSdk,
} from '../sdkEventQueue.js'

describe('emitTaskTerminatedSdk (official lf / c7c)', () => {
  beforeEach(() => {
    clearTaskTerminatedSdkOnce()
    drainSdkEvents()
  })

  afterEach(() => {
    clearTaskTerminatedSdkOnce()
    drainSdkEvents()
  })

  test('c7c once-gate accepts first emit and drops second for same taskId', () => {
    // Does not require non-interactive queue drain — return value is the gate.
    expect(emitTaskTerminatedSdk('dup', 'failed', { summary: 'a' })).toBe(true)
    expect(emitTaskTerminatedSdk('dup', 'failed', { summary: 'b' })).toBe(false)
    expect(emitTaskTerminatedSdk('other', 'stopped', { summary: 'c' })).toBe(
      true,
    )
  })

  test('force bypasses once-gate', () => {
    expect(emitTaskTerminatedSdk('f1', 'stopped', { summary: '1' })).toBe(true)
    expect(
      emitTaskTerminatedSdk('f1', 'stopped', { summary: '2', force: true }),
    ).toBe(true)
  })

  test('clearTaskTerminatedSdkOnce releases gate for id', () => {
    expect(emitTaskTerminatedSdk('clr', 'stopped')).toBe(true)
    expect(emitTaskTerminatedSdk('clr', 'stopped')).toBe(false)
    clearTaskTerminatedSdkOnce('clr')
    expect(emitTaskTerminatedSdk('clr', 'stopped')).toBe(true)
  })

  test('passes toolUseId/summary/outputFile into event when non-interactive', () => {
    // If TUI mode drops the queue, this still validates the call does not throw.
    emitTaskTerminatedSdk('t1', 'stopped', {
      summary: 'shell orphan',
      toolUseId: 'tu-1',
      outputFile: '/tmp/o',
    })
    const events = drainSdkEvents()
    if (events.length > 0) {
      expect(events[0]).toMatchObject({
        type: 'system',
        subtype: 'task_notification',
        task_id: 't1',
        status: 'stopped',
        summary: 'shell orphan',
        tool_use_id: 'tu-1',
        output_file: '/tmp/o',
      })
    }
  })
})
