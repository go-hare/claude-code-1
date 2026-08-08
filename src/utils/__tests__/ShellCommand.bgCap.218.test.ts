/**
 * densable 2.1.218 #21 — ShellCommand.background({capMs}) arms kill timer.
 */
import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import { wrapSpawn } from '../ShellCommand.js'
import { TaskOutput } from '../task/TaskOutput.js'

function makeFakeChild(): ChildProcess {
  const ee = new EventEmitter() as ChildProcess & EventEmitter
  // minimal ChildProcess surface used by ShellCommandImpl
  ;(ee as unknown as { pid: number }).pid = 12345
  ;(ee as unknown as { stdout: null }).stdout = null
  ;(ee as unknown as { stderr: null }).stderr = null
  return ee as unknown as ChildProcess
}

describe('densable 2.1.218 #21 ShellCommand.background capMs', () => {
  test('background without capMs succeeds and status is backgrounded', () => {
    const child = makeFakeChild()
    const abort = new AbortController()
    const taskOutput = new TaskOutput('t-bg-cap-1', null)
    // file mode: stdoutToFile true when path is set — TaskOutput constructor
    // with null uses pipe mode; for file mode we just need background to work.
    const cmd = wrapSpawn(child, abort.signal, 60_000, taskOutput)
    expect(cmd.status).toBe('running')
    expect(cmd.background('task-1')).toBe(true)
    expect(cmd.status).toBe('backgrounded')
    // second background fails
    expect(cmd.background('task-1')).toBe(false)
    cmd.cleanup()
  })

  test('background with capMs accepts options (no throw)', () => {
    const child = makeFakeChild()
    const abort = new AbortController()
    const taskOutput = new TaskOutput('t-bg-cap-2', null)
    const cmd = wrapSpawn(child, abort.signal, 60_000, taskOutput)
    // densable: arm #l kill timer — we don't wait for kill, just that API accepts
    expect(cmd.background('task-2', { capMs: 60_000, skipSpill: true })).toBe(
      true,
    )
    expect(cmd.status).toBe('backgrounded')
    cmd.cleanup()
  })

  test('background options type is optional (compat with hooks path)', () => {
    const child = makeFakeChild()
    const abort = new AbortController()
    const taskOutput = new TaskOutput('t-bg-cap-3', null)
    const cmd = wrapSpawn(child, abort.signal, 60_000, taskOutput)
    // hooks still call background(processId) without options
    expect(cmd.background('hook-1')).toBe(true)
    cmd.cleanup()
  })
})
